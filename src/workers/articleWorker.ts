import { Worker, Job } from 'bullmq';
import { GenerationJob, JobStatus } from '../models/GenerationJob';
import { Article } from '../models/Article';
import { Prompt } from '../models/Prompt';
import { ApiKey } from '../models/ApiKey';
import logger from '../utils/logger';
import axios from 'axios';
import sanitizeHtml from 'sanitize-html';
import FormData from 'form-data';
import path from 'path';
import { promises as fsPromises } from 'fs';
import CloudflareR2Service from '../services/storage.service';
import { GoogleGenAI } from "@google/genai";

const connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
};

interface JobData {
    jobId: number;
    uuid: string;
}

class ArticleGenerationWorker {
    private worker: Worker;
    private storageService: CloudflareR2Service;
    private ai: GoogleGenAI;

    constructor() {
        this.storageService = new CloudflareR2Service();
        this.worker = new Worker('article-generation', this.processJob.bind(this), {
            connection,
            concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2', 10),
            limiter: {
                max: 10,
                duration: 60000,
            },
        });

        this.ai = new GoogleGenAI({});

        this.worker.on('completed', (job) => {
            logger.info(`Job ${job.id} completed successfully`);
        });

        this.worker.on('failed', (job, err) => {
            logger.error(`Job ${job?.id} failed:`, err);
        });

        this.worker.on('error', (err) => {
            logger.error('Worker error:', err);
        });

        logger.info('Article generation worker started');
    }

    private async processJob(job: Job<JobData>): Promise<void> {
        const { jobId } = job.data;
        logger.info(`Processing job ${jobId}`);

        let tempFilePath: string | null = null;
        let generatedImagePath: string | null = null;
        let generatedImageUrl: string | null = null;
        let articlePdfUrl: string | null = null;

        try {
            const generationJob = await GenerationJob.findByPk(jobId);
            if (!generationJob) {
                throw new Error(`Job ${jobId} not found in database`);
            }
            articlePdfUrl = generationJob.pdf_url;

            await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 5);

            const { buffer: pdfBuffer, tempFile } = await this.downloadPdf(generationJob);
            tempFilePath = tempFile; 
            await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 15);

            const finalPrompt = await this.buildPromptForPdf(generationJob);
            generationJob.prompt_merged = finalPrompt;
            await generationJob.save();
            await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 30);

            const apiKey = await this.selectApiKey(generationJob);
            if (!apiKey) {
                throw new Error(`No active API key found for provider: ${generationJob.provider}`);
            }
            await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 40);

            const { articleHtml, imageSummary } = await this.generateArticleWithPDF(
                finalPrompt,
                pdfBuffer,
                apiKey,
                generationJob.provider,
                generationJob.model_name
            );
            await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 75);

            const sanitizedHtml = this.sanitizeHtml(articleHtml);
            await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 80);

            const title = this.extractTitle(sanitizedHtml) || 'Generated Article';

            console.log({imageSummary})

            let imageContextForPrompt = (imageSummary && imageSummary.trim().length > 0)
                ? imageSummary
                : sanitizedHtml;

            if (imageContextForPrompt.length > 2500) {
                imageContextForPrompt = imageContextForPrompt.substring(0, 2500);
}

            const imageResult = await this.generateFeaturedImage(
                title,
                imageContextForPrompt,
                apiKey,
                generationJob.provider,
                jobId,
            );

            if (imageResult) {
                generatedImagePath = imageResult.absolutePath;
                generatedImageUrl = imageResult.fileUrl;
                await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 85);
            }

            const resolvedPdfUrl = await this.resolveArticlePdfUrl(articlePdfUrl, tempFilePath, generationJob);

            const article = await Article.create({
                title,
                content: sanitizedHtml,
                status: 'draft',
                pdf_url: resolvedPdfUrl || generationJob.pdf_url,
                source_text: 'Generated from PDF using GPT-4 Vision',
                ai_model: `${generationJob.provider}/${generationJob.model_name || 'default'}`,
                ai_prompt: finalPrompt.substring(0, 5000),
                author_wp_id: generationJob.wp_config?.author_wp_id || null,
                featured_media_wp_id: generationJob.wp_config?.featured_media_wp_id || null,
                meta: generationJob.wp_config?.meta || {},
                tags: generationJob.wp_config?.tags || [],
                categories: generationJob.wp_config?.categories || [],
                featured_image_url: generatedImageUrl,
            } as any);

            await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 90);

            // Step 9: Optionally publish to WordPress
            if (generationJob.publish_to_wp) {
                await this.publishToWordPress(article, generationJob);
            }

            // Step 10: Update API key usage
            await this.updateApiKeyUsage(apiKey);

            // Step 11: Mark job as completed
            generationJob.status = JobStatus.COMPLETED;
            generationJob.progress = 100;
            generationJob.result_article_id = article.id;
            generationJob.result_preview = sanitizedHtml.substring(0, 500);
            generationJob.provider_api_key_id = apiKey.id;
            generationJob.finished_at = new Date();
            await generationJob.save();

            logger.info(`Job ${jobId} completed - Article ${article.id} created`);

            this.cleanupTempFile(tempFilePath);
        } catch (error: any) {
            logger.error(`Job ${jobId} failed:`, error);

            const generationJob = await GenerationJob.findByPk(jobId);
            if (generationJob) {
                generationJob.status = JobStatus.FAILED;
                generationJob.error = {
                    message: error.message,
                    stack: error.stack,
                    timestamp: new Date(),
                };
                generationJob.finished_at = new Date();
                await generationJob.save();
            }

            const maxAttempts = job.opts.attempts || 1;
            const currentAttempt = job.attemptsMade;
            const isFinalAttempt = currentAttempt >= maxAttempts;

            if (isFinalAttempt) {
                logger.info(`Final attempt (${currentAttempt}/${maxAttempts}) failed, cleaning up temp file`);
                this.cleanupTempFile(tempFilePath);
            } else {
                logger.info(`Attempt ${currentAttempt}/${maxAttempts} failed, keeping temp file for retry`);
            }

            this.cleanupTempFile(generatedImagePath, 'generated image');

            throw error;
        }
    }

    private async updateJobProgress(job: GenerationJob, status: JobStatus, progress: number): Promise<void> {
        job.status = status;
        job.progress = progress;
        await job.save();
    }

    private cleanupTempFile(filePath: string | null, label = 'temporary file'): void {
        if (!filePath) return;

        try {
            const fs = require('fs');
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logger.info(`Deleted ${label}: ${filePath}`);
            }
        } catch (error: any) {
            logger.warn(`Failed to delete ${label}: ${filePath}`, error);
        }
    }

    private async downloadPdf(job: GenerationJob): Promise<{ buffer: Buffer; tempFile: string | null }> {
        try {
            // Check if it's a local file:// URL
            if (job.pdf_url.startsWith('file://')) {
                const fs = await import('fs');
                const filePath = job.pdf_url.replace('file://', '');
                logger.info(`Reading PDF from local file: ${filePath}`);
                const buffer = fs.readFileSync(filePath);

                // Return buffer and file path for cleanup later
                return { buffer, tempFile: filePath };
            }

            // Download PDF from URL directly to memory
            const response = await axios.get(job.pdf_url, {
                responseType: 'arraybuffer',
                timeout: 60000,
                maxContentLength: 50 * 1024 * 1024, // 50MB max
            });

            logger.info(`PDF downloaded from URL (${Buffer.byteLength(response.data)} bytes)`);
            return { buffer: Buffer.from(response.data), tempFile: null };
        } catch (error: any) {
            logger.error('Error downloading PDF:', error);
            throw new Error(`Failed to download PDF: ${error.message}`);
        }
    }

    private async buildPromptForPdf(job: GenerationJob): Promise<string> {
        let basePrompt = '';

        // Load template if specified
        if (job.prompt_template_id) {
            const template = await Prompt.findByPk(job.prompt_template_id);
            if (template) {
                basePrompt = template.prompt_text;
            }
        } else if (job.prompt_category) {
            const template = await Prompt.findOne({
                where: { category: job.prompt_category },
            });
            if (template) {
                basePrompt = template.prompt_text;
            }
        }

        // Default prompt if none found
        if (!basePrompt) {
            if (job.ai_enhancement) {
                basePrompt = `You are an expert content writer. Analyze the PDF document and convert it into a well-structured, engaging HTML article. 
                        Add proper headings (<h1>, <h2>, <h3>), paragraphs (<p>), lists (<ul>, <ol>), and formatting. 
                        Make the content SEO-friendly and reader-friendly. Add insights and improve clarity where needed.
                        Maintain the document's original meaning while making it comprehensive and professional.`;
            } else {
                basePrompt = `Convert the PDF document into a clean HTML article. 
                        Preserve the original content as much as possible. Add proper HTML structure with headings (<h1>, <h2>, <h3>), 
                        paragraphs (<p>), and lists (<ul>, <ol>). Do not add new content or modify the meaning.`;
            }
        }

        // Add custom prompt if provided
        if (job.custom_prompt) {
            basePrompt += `\n\nAdditional Instructions: ${job.custom_prompt}`;
        }

        return basePrompt;
    }

    private async selectApiKey(job: GenerationJob): Promise<ApiKey | null> {
        const where: any = {
            provider: job.provider,
            status: 'active',
        };

        // Try user's keys first
        const userKey = await ApiKey.findOne({
            where: { ...where, created_by: job.user_id },
            order: [['usage_count', 'ASC']],
        });

        if (userKey && (!userKey.usage_limit || userKey.usage_count < userKey.usage_limit)) {
            return userKey;
        }

        // Fallback to any active key
        const systemKey = await ApiKey.findOne({
            where,
            order: [['usage_count', 'ASC']],
        });

        if (systemKey && (!systemKey.usage_limit || systemKey.usage_count < systemKey.usage_limit)) {
            return systemKey;
        }

        return null;
    }

    private async callOpenAIWithUploadedPdf(
        prompt: string,
        fileId: string,
        apiKey: string,
        model: string
    ): Promise<{ articleHtml: string; imageSummary: string }> {

        const systemText = `
            You are an expert legal content writer and case analyst.
            1) Convert the supplied PDF into a clean, well-structured, SEO-friendly HTML article using semantic tags (<h1>, <h2>, <h3>, <p>, <ul>, <ol>, etc.). Preserve facts from the PDF without inventing new facts.
            2) ALSO produce a separate detailed legal-context summary between 800 and 1000 words (follow very strictly) for use by an image-generation model. The summary should include: case type, parties/roles (petitioner/respondent/etc.), court or authority, relevant statutes/sections if present, chronology of key events, orders/notices/appeals/execution steps, and current procedural status. Do NOT invent facts.

            Output MUST be EXACTLY in this XML format (nothing outside these tags):

            <article_html>
            ... full cleaned HTML article here ...
            </article_html>

            <image_summary>
            ... plain text 600-800 word summary here ...
            </image_summary>
            `;

        const res = await axios.post(
            "https://api.openai.com/v1/responses",
            {
                model,
                input: [
                    {
                        role: "system",
                        content: [
                            {
                                type: "input_text",
                                text: systemText
                            }
                        ]
                    },
                    {
                        role: "user",
                        content: [
                            { type: "input_text", text: prompt },
                            { type: "input_file", file_id: fileId }
                        ]
                    }
                ],
                max_output_tokens: 10000
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json"
                },
                timeout: 240000
            }
        );

        const raw = res.data?.output?.[0]?.content?.[0]?.text;
        if (!raw) {
            logger.error("Unexpected OpenAI response structure:", res.data);
            throw new Error("Failed to extract OpenAI response text");
        }

        // Extract <article_html> and <image_summary>
        const articleMatch = raw.match(/<article_html>([\s\S]*?)<\/article_html>/i);
        const summaryMatch = raw.match(/<image_summary>([\s\S]*?)<\/image_summary>/i);

        const articleHtml = articleMatch ? articleMatch[1].trim() : "";
        const imageSummary = summaryMatch ? summaryMatch[1].trim() : "";

        if (!articleHtml) {
            // If AI didn't return article_html, log full raw text for debugging
            logger.warn("OpenAI response missing <article_html> tag. Raw output truncated to 2000 chars:", raw.substring(0, 2000));
        }

        if (!imageSummary) {
            logger.warn("OpenAI response missing <image_summary> tag. Falling back to article content for image context.");
        }

        return { articleHtml, imageSummary };
    }

    private async uploadPdfToOpenAI(
        pdfBuffer: Buffer,
        apiKey: string
    ): Promise<string> {
        const formData = new FormData();
        formData.append("file", pdfBuffer, "document.pdf");
        formData.append("purpose", "assistants");

        const upload = await axios.post(
            "https://api.openai.com/v1/files",
            formData,
            {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    ...formData.getHeaders(),
                },
            }
        );

        return upload.data.id;
    }

    private async generateArticleWithPDF(
        prompt: string,
        pdfBuffer: Buffer,
        apiKey: ApiKey,
        provider: string,
        modelName?: string | null
    ): Promise<{ articleHtml: string; imageSummary: string }> {

        if (provider !== "openai") {
            throw new Error("Only OpenAI provider supported for PDF");
        }

        const model = modelName || "gpt-4.1-mini";

        const fileId = await this.uploadPdfToOpenAI(pdfBuffer, apiKey.api_key);
        logger.info(`PDF uploaded → ${fileId}`);

        return await this.callOpenAIWithUploadedPdf(prompt, fileId, apiKey.api_key, model);
    }

    private async generateFeaturedImage(
        title: string,
        html: string,
        apiKey: ApiKey,
        provider: string,
        jobId: number,
    ): Promise<{ absolutePath: string; fileUrl: string } | null> {
        if (!html?.trim()) {
            logger.info(`Skipping image generation for job ${jobId} - empty content`);
            return null;
        }

        const prompt = this.buildImagePrompt(title, html);
        if (!prompt) {
            return null;
        }

        switch (provider.toLowerCase()) {
            case 'openai':
                return this.callOpenAIImageGeneration(prompt, apiKey, jobId);
            case 'gemini':
                return this.generateGeminiImage(prompt, apiKey, jobId);
            default:
                logger.info(`Skipping image generation - unsupported provider: ${provider}`);
                return null;
        }
    }

    // New helper method for the existing OpenAI logic
    private async callOpenAIImageGeneration(
        prompt: string,
        apiKey: ApiKey,
        jobId: number,
    ): Promise<{ absolutePath: string; fileUrl: string } | null> {
        const model = process.env.IMAGE_GENERATION_MODEL || 'dall-e-3';
        const size = process.env.IMAGE_GENERATION_SIZE || '1024x1024';

        try {
            const response = await axios.post(
                'https://api.openai.com/v1/images/generations',
                {
                    model,
                    prompt,
                    size,
                },
                {
                    headers: {
                        Authorization: `Bearer ${apiKey.api_key}`,
                        'Content-Type': 'application/json',
                    },
                    timeout: 120000,
                }
            );

            const imageUrl = response.data?.data?.[0]?.url;
            if (!imageUrl) {
                logger.warn('OpenAI image response missing url payload', response.data);
                return null;
            }

            // Reuse existing download and save logic
            const buffer = await this.downloadImage(imageUrl, jobId);
            return await this.saveImageBuffer(buffer, jobId);
        } catch (error: any) {
            logger.warn('Failed to generate featured image with OpenAI', error?.response?.data || error);
            return null;
        }
    }

    private async generateGeminiImage(
        prompt: string,
        apiKey: ApiKey,
        jobId: number,
    ): Promise<{ absolutePath: string; fileUrl: string } | null> {
        
        // 🛑 Use the dedicated Imagen model for best results and correct API path
        const aiClient = new GoogleGenAI({ apiKey: apiKey.api_key });
        const model = process.env.IMAGE_GENERATION_MODEL || "gemini-2.5-flash-image";
        const aspectRatio = process.env.IMAGE_GENERATION_SIZE || '1:1'; 
        
        // The SDK handles endpoint, versioning, and JSON payload correctly.
        try {
            const modelList = await aiClient.models.list();

            console.dir({modelList}, {depth: 4});

            const response = await aiClient.models.generateImages({
                model: model,
                prompt: prompt,
                config: { 
                    numberOfImages: 1,
                    aspectRatio: aspectRatio, 
                    outputMimeType: "image/png",
                },
            });

            // The SDK response structure for generateImages is simple
            const base64Image = response.generatedImages?.[0]?.image?.imageBytes;

            if (!base64Image) {
                logger.warn('Gemini SDK image response missing Base64 payload', response);
                return null;
            }

            // Decode Base64 and save (reuse your existing logic)
            const buffer = Buffer.from(base64Image, 'base64');
            return await this.saveImageBuffer(buffer, jobId);

        } catch (error: any) {
            // Error handling will catch SDK-specific errors as well
            logger.warn('Failed to generate featured image with Gemini SDK', error);
            return null;
        }
    }

    private buildImagePrompt(title: string, summary: string): string {
        if (!summary || !summary.trim()) return '';

        return `
            Create a stylized Indian flat-cartoon illustration for the article titled "${title}".

            Base the illustration ONLY on the following legal-case summary (600-800 words). Do NOT invent facts; depict what is described.

            SUMMARY:
            ${summary}

            Visual guidance:
            - Include only elements directly relevant to the summary (judge, lawyers, litigants, clerks, courtroom interior, courthouse exterior, district office, documents, notices, etc. as applicable).
            - If the summary mentions a 'rent' or 'eviction' issue, depict landlord/tenant and receipts; if it mentions 'public demand recovery', depict district/recovery office and officers.
            - Use a soft pastel / warm palette, simple shapes, clean outlines, and consistent character proportions (Indian flat-cartoon / Ghibli-inspired).
            - Avoid surreal elements, extra limbs, or distorted anatomy.
            - Do NOT include readable text or labels in the image (documents may show blurred marks only).
            - Focus on clear storytelling that matches the summary.

            Return a single image concept suited for a 1024x1024 feature image.
            `.trim();
    }


    private stripHtml(input: string): string {
        return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    private async downloadImage(imageUrl: string, jobId: number): Promise<Buffer> {
        const response = await axios.get(imageUrl, {
            responseType: 'arraybuffer',
            timeout: 120000,
        });

        logger.info(`Downloaded generated image for job ${jobId}`);
        return Buffer.from(response.data);
    }

    private async saveImageBuffer(buffer: Buffer, jobId: number): Promise<{ absolutePath: string; fileUrl: string }> {
        const uploadsRoot = process.env.UPLOAD_DIR
            ? path.resolve(process.env.UPLOAD_DIR)
            : path.resolve(process.cwd(), 'uploads');
        const outputDir = process.env.GENERATED_IMAGE_DIR
            ? path.resolve(process.env.GENERATED_IMAGE_DIR)
            : path.join(uploadsRoot, 'images');

        await fsPromises.mkdir(outputDir, { recursive: true });

        const fileName = `article-${jobId}-${Date.now()}.png`;
        const absolutePath = path.join(outputDir, fileName);
        await fsPromises.writeFile(absolutePath, buffer);

        const publicBase = process.env.GENERATED_IMAGE_PUBLIC_URL?.replace(/\/+$/, '');
        const fileUrl = publicBase ? `${publicBase}/${fileName}` : `file://${absolutePath}`;

        logger.info(`Featured image stored at ${absolutePath}`);

        return { absolutePath, fileUrl };
    }

    private async resolveArticlePdfUrl(
        currentUrl: string | null,
        tempFilePath: string | null,
        job: GenerationJob
    ): Promise<string | null> {
        if (!this.storageService.isEnabled()) {
            return currentUrl;
        }

        if (!tempFilePath) {
            return currentUrl;
        }

        if (!currentUrl || !currentUrl.startsWith('file://')) {
            return currentUrl;
        }

        try {
            const keyPrefix = path.posix.join('users', String(job.user_id));
            const uploadResult = await this.storageService.uploadPdfFromPath(tempFilePath, keyPrefix);
            logger.info(`Uploaded PDF for job ${job.id} to Cloudflare R2`);
            return uploadResult.url;
        } catch (error) {
            logger.warn(`Failed to upload PDF for job ${job.id} to Cloudflare R2`, error);
            return currentUrl;
        }
    }


    private sanitizeHtml(html: string): string {
        return sanitizeHtml(html, {
            allowedTags: [
                'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'p', 'br', 'hr',
                'ul', 'ol', 'li',
                'strong', 'em', 'u', 'b', 'i',
                'a', 'img',
                'blockquote', 'pre', 'code',
                'table', 'thead', 'tbody', 'tr', 'th', 'td',
                'div', 'span',
            ],
            allowedAttributes: {
                'a': ['href', 'title', 'target'],
                'img': ['src', 'alt', 'title', 'width', 'height'],
                'div': ['class'],
                'span': ['class'],
                'code': ['class'],
            },
            allowedSchemes: ['http', 'https', 'mailto'],
        });
    }

    private extractTitle(html: string): string | null {
        const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
        if (h1Match) {
            return h1Match[1].replace(/<[^>]*>/g, '').trim();
        }
        return null;
    }

    private async publishToWordPress(article: Article, job: GenerationJob): Promise<void> {
        try {
            logger.info(`Publishing article ${article.id} to WordPress (not implemented)`);

            // Example implementation:
            // const wpResponse = await axios.post(
            //   `${process.env.WP_URL}/wp-json/wp/v2/posts`,
            //   {
            //     title: article.title,
            //     content: article.content,
            //     status: 'draft',
            //     author: job.wp_config?.author_wp_id,
            //     featured_media: job.wp_config?.featured_media_wp_id,
            //     meta: job.wp_config?.meta,
            //   },
            //   {
            //     headers: {
            //       'Authorization': `Bearer ${wpToken}`,
            //     },
            //   }
            // );

            // article.wp_post_id = wpResponse.data.id;
            // article.wp_permalink = wpResponse.data.link;
            // await article.save();
        } catch (error: any) {
            logger.error('Error publishing to WordPress:', error);
        }
    }

    private async updateApiKeyUsage(apiKey: ApiKey): Promise<void> {
        apiKey.usage_count = (apiKey.usage_count || 0) + 1;
        apiKey.last_used_at = new Date();
        await apiKey.save();
    }

    public async close(): Promise<void> {
        await this.worker.close();
        logger.info('Article generation worker stopped');
    }
}

if (require.main === module) {
    const worker = new ArticleGenerationWorker();

    process.on('SIGTERM', async () => {
        await worker.close();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        await worker.close();
        process.exit(0);
    });
}

export default ArticleGenerationWorker;
