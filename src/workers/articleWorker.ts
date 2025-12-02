import { Worker, Job } from 'bullmq';
import { GenerationJob, JobStatus } from '../models/GenerationJob';
import { Article } from '../models/Article';
import { Prompt } from '../models/Prompt';
import { ApiKey } from '../models/ApiKey';
import { User } from '../models/User';
import logger from '../utils/logger';
import { computeCostUSD } from '../utils/pricing';
import axios from 'axios';
import sanitizeHtml from 'sanitize-html';
import FormData from 'form-data';
import path from 'path';
import { createReadStream } from 'fs';
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

interface WordPressMediaContext {
    imagePath: string | null;
    imageUrl: string | null;
    existingMediaId?: number | null;
}

interface WordPressPostPayload {
    title: string;
    content: string;
    status?: string;
    author?: number | null;
    featured_media?: number | null | undefined;
    meta?: Record<string, any> | null;
    tags?: Array<number | string> | null;
    categories?: Array<number | string> | null;
}

class ArticleGenerationWorker {
    private worker: Worker;
    private storageService: CloudflareR2Service;
    private ai: GoogleGenAI | null;
    private wpBaseUrl: string;

    constructor() {
        this.storageService = new CloudflareR2Service();
        this.wpBaseUrl = process.env.WP_BASE_URL || 'https://www.samvidalaw.com';
        this.worker = new Worker('article-generation', this.processJob.bind(this), {
            connection,
            concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2', 10),
            limiter: {
                max: 10,
                duration: 60000,
            },
        });

        const geminiApiKey = process.env.GEMINI_API_KEY;
        if (geminiApiKey) {
            this.ai = new GoogleGenAI({ apiKey: geminiApiKey });
        } else {
            this.ai = null;
            logger.warn('GEMINI_API_KEY not configured; Gemini enhancements will be skipped');
        }

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
        let generatedImageUrl: string | null = null;
        let generatedImageMediaId: number | null = null;
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

            const apiKey = await this.selectApiKey(generationJob.provider);
            if (!apiKey) {
                throw new Error(`No active API key found for provider: ${generationJob.provider}`);
            }
            await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 40);

            const { articleHtml, imageSummary, usage: genUsage } = await this.generateArticleWithPDF(
                finalPrompt,
                pdfBuffer,
                apiKey,
                generationJob.provider,
                generationJob.model_name
            );
            // Track usage from generation
            await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 75);

            let workingArticleHtml = articleHtml;
            if (generationJob.ai_enhancement) {
                await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 78);
                workingArticleHtml = await this.enhanceArticleWithGemini(articleHtml, {
                    basePrompt: finalPrompt,
                    customPrompt: generationJob.custom_prompt,
                    imageSummary,
                    pdfUrl: generationJob.pdf_url,
                    jobId,
                });
            }

            const sanitizedHtml = this.sanitizeHtml(workingArticleHtml);
            await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 80);

            const title = this.extractTitle(sanitizedHtml) || 'Generated Article';

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
                jobId,
                generationJob,
            );

            generatedImageUrl = imageResult.sourceUrl;
            generatedImageMediaId = imageResult.mediaId;
            await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 85);

            const resolvedPdfUrl = await this.resolveArticlePdfUrl(articlePdfUrl, tempFilePath, generationJob);

            const baseMeta = this.applySeoDefaults(
                generationJob.wp_config?.meta,
                title,
                sanitizedHtml
            );
            const wpTags = Array.isArray(generationJob.wp_config?.tags) ? generationJob.wp_config?.tags : [];
            const wpCategories = Array.isArray(generationJob.wp_config?.categories) ? generationJob.wp_config?.categories : [];
            const featuredMediaId = generatedImageMediaId
                ?? generationJob.wp_config?.featured_media_wp_id
                ?? null;

            const article = await Article.create({
                title,
                content: sanitizedHtml,
                status: 'draft',
                prompt_template_id: generationJob.prompt_template_id || null,
                pdf_url: resolvedPdfUrl || generationJob.pdf_url,
                source_text: 'Generated from PDF using GPT-4 Vision',
                ai_model: `${generationJob.provider}/${generationJob.model_name || 'default'}`,
                ai_prompt: finalPrompt.substring(0, 5000),
                author_wp_id: generationJob.wp_config?.author_wp_id || null,
                featured_media_wp_id: featuredMediaId,
                meta: baseMeta,
                tags: wpTags,
                categories: wpCategories,
                featured_image_url: generatedImageUrl,
                translation_of_article_id: null,
            } as any);

            await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 90);

            // if (generationJob.publish_to_wp) {
            //     await this.publishToWordPress(article, generationJob, {
            //         imagePath: null,
            //         imageUrl: generatedImageUrl,
            //         existingMediaId: generatedImageMediaId,
            //     });
            // }

            let hindiArticle: Article | null = null;
            let totalPromptTokens = genUsage?.promptTokens || 0;
            let totalCompletionTokens = genUsage?.completionTokens || 0;

            if (generationJob.generate_hindi_article) {
                logger.info(`Generating Hindi translation for article ${article.id} (job ${jobId})`);
                await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 92);

                const { html: hindiHtml, usage: hiUsage } = await this.translateArticleToHindi(
                    sanitizedHtml,
                    apiKey,
                    generationJob.provider,
                    generationJob.model_name
                );

                if (hiUsage) {
                    totalPromptTokens += hiUsage.promptTokens || 0;
                    totalCompletionTokens += hiUsage.completionTokens || 0;
                }

                const sanitizedHindiHtml = this.sanitizeHtml(hindiHtml);
                const hindiTitle = this.extractTitle(sanitizedHindiHtml) || `${title} (Hindi)`;

                const hindiMetaBase = this.cloneMeta(generationJob.wp_config?.meta);
                hindiMetaBase.translation_language = 'hi';
                hindiMetaBase.translation_of_article_id = article.id;
                const hindiMeta = this.applySeoDefaults(
                    hindiMetaBase,
                    hindiTitle,
                    sanitizedHindiHtml
                );

                hindiArticle = await Article.create({
                    title: hindiTitle,
                    content: sanitizedHindiHtml,
                    status: 'draft',
                    prompt_template_id: generationJob.prompt_template_id || null,
                    pdf_url: resolvedPdfUrl || generationJob.pdf_url,
                    source_text: `Hindi translation of article ${article.id}`,
                    ai_model: `${generationJob.provider}/${generationJob.model_name || 'default'}`,
                    ai_prompt: 'Hindi translation of generated article',
                    author_wp_id: generationJob.wp_config?.author_wp_id || null,
                    featured_media_wp_id: article.featured_media_wp_id || generationJob.wp_config?.featured_media_wp_id || null,
                    meta: hindiMeta,
                    tags: wpTags,
                    categories: wpCategories,
                    featured_image_url: article.featured_image_url,
                    translation_of_article_id: article.id,
                } as any);

                // if (generationJob.publish_to_wp) {
                //     await this.publishToWordPress(hindiArticle, generationJob, {
                //         imagePath: null,
                //         imageUrl: generatedImageUrl,
                //         existingMediaId: generatedImageMediaId || article.featured_media_wp_id || generationJob.wp_config?.featured_media_wp_id || null,
                //     });
                // }

                await this.updateJobProgress(generationJob, JobStatus.PROCESSING, 95);

                const englishMeta = this.applySeoDefaults(article.meta, title, sanitizedHtml);
                englishMeta.hindi_translation_article_id = hindiArticle.id;
                article.meta = englishMeta;
                await article.save();
            }

            await this.updateApiKeyUsage(apiKey);

            // After successful content generation, estimate and deduct credit usage against API key (global)
            try {
                const modelName = generationJob.model_name || 'gpt-4o-mini';
                const costUsd = computeCostUSD(modelName, totalPromptTokens, totalCompletionTokens);
                if (costUsd > 0) {
                    await this.deductApiKeyCredits(apiKey, costUsd);
                }
            } catch (e) {
                logger.warn('Failed to deduct API key credits (usage compute error)', e);
            }

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

            throw error;
        }
    }

    private async deductApiKeyCredits(apiKey: ApiKey, costUsd: number): Promise<void> {
        const now = new Date();
        const monthStart = apiKey.credits_month_start ? new Date(apiKey.credits_month_start as any) : null;
        const needsReset = !monthStart || monthStart.getMonth() !== now.getMonth() || monthStart.getFullYear() !== now.getFullYear();

        if (needsReset) {
            const limit = Number(apiKey.credits_monthly_limit_usd || 100);
            apiKey.credits_month_start = now as any;
            apiKey.credits_used_usd_month = 0 as any;
            apiKey.credits_remaining_usd_month = limit as any;
        }

        const used = Number(apiKey.credits_used_usd_month || 0);
        const remaining = Number(apiKey.credits_remaining_usd_month || 0);
        const newUsed = Number((used + costUsd).toFixed(4));
        const newRemaining = Number((remaining - costUsd).toFixed(4));

        apiKey.credits_used_usd_month = Math.max(0, newUsed) as any;
        apiKey.credits_remaining_usd_month = Math.max(0, newRemaining) as any;

        await apiKey.save();

        const limit = Number(apiKey.credits_monthly_limit_usd || 100);
        const threshold = limit * 0.2;
        if (Number(apiKey.credits_remaining_usd_month) <= threshold) {
            logger.info(`Global API key low credits warning: remaining $${apiKey.credits_remaining_usd_month} (<= 20% of $${limit})`);
            // Optionally: enqueue a notification job or emit an event
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
            if (job.pdf_url.startsWith('file://')) {
                const fs = await import('fs');
                const filePath = job.pdf_url.replace('file://', '');
                logger.info(`Reading PDF from local file: ${filePath}`);
                const buffer = fs.readFileSync(filePath);
                return { buffer, tempFile: filePath };
            }

            const buffer = await this.fetchRemotePdf(job.pdf_url);
            return { buffer, tempFile: null };
        } catch (error: any) {
            logger.error('Error downloading PDF:', error?.response?.data || error?.message || error);
            throw new Error(`Failed to download PDF: ${error?.message || 'Unknown error'}`);
        }
    }

    private buildPdfRequestHeaders(targetUrl: string): Record<string, string> {
        const headers: Record<string, string> = {
            'User-Agent': process.env.PDF_FETCH_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
            'Accept-Language': process.env.PDF_FETCH_ACCEPT_LANGUAGE || 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
        };

        const refererOverride = process.env.PDF_FETCH_REFERER;
        if (refererOverride) {
            headers['Referer'] = refererOverride;
        } else {
            try {
                const url = new URL(targetUrl);
                headers['Referer'] = url.origin;
            } catch (error) {
                logger.warn('Failed to derive referer from URL', error);
            }
        }

        if (process.env.PDF_FETCH_AUTH_HEADER) {
            headers['Authorization'] = process.env.PDF_FETCH_AUTH_HEADER;
        }

        if (process.env.PDF_FETCH_COOKIE) {
            headers['Cookie'] = process.env.PDF_FETCH_COOKIE;
        }

        return headers;
    }

    private async fetchRemotePdf(url: string): Promise<Buffer> {
        const headers = this.buildPdfRequestHeaders(url);

        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: Number(process.env.PDF_FETCH_TIMEOUT_MS || 60000),
            maxContentLength: 50 * 1024 * 1024,
            maxRedirects: 5,
            headers,
            validateStatus: (status) => status >= 200 && status < 400,
        });

        const contentType = response.headers['content-type'];
        if (contentType && !contentType.toLowerCase().includes('pdf')) {
            logger.warn(`Remote content-type is ${contentType}, expected application/pdf`);
        }

        const byteLength = Buffer.byteLength(response.data);
        logger.info(`PDF downloaded from URL (${byteLength} bytes)`);
        return Buffer.from(response.data);
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

        if (job.custom_prompt) {
            basePrompt += `\n\nAdditional Instructions: ${job.custom_prompt}`;
        }

        return basePrompt;
    }

    private async selectApiKey(provider : string): Promise<ApiKey | null> {
        const where: any = {
            provider: provider,
            status: 'active',
        };

        const userKey = await ApiKey.findOne({
            where: { ...where },
            order: [['usage_count', 'ASC']],
        });

        if (userKey && (!userKey.usage_limit || userKey.usage_count < userKey.usage_limit)) {
            return userKey;
        }

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
    ): Promise<{ articleHtml: string; imageSummary: string; usage?: { promptTokens: number; completionTokens: number } }> {

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

        const articleMatch = raw.match(/<article_html>([\s\S]*?)<\/article_html>/i);
        const summaryMatch = raw.match(/<image_summary>([\s\S]*?)<\/image_summary>/i);

        const articleHtml = articleMatch ? articleMatch[1].trim() : "";
        const imageSummary = summaryMatch ? summaryMatch[1].trim() : "";

        if (!articleHtml) {
            logger.warn("OpenAI response missing <article_html> tag. Raw output truncated to 2000 chars:", raw.substring(0, 2000));
        }

        if (!imageSummary) {
            logger.warn("OpenAI response missing <image_summary> tag. Falling back to article content for image context.");
        }

        const usageRaw = res.data?.usage || {};
        const promptTokens = usageRaw.prompt_tokens ?? usageRaw.input_tokens ?? 0;
        const completionTokens = usageRaw.completion_tokens ?? usageRaw.output_tokens ?? 0;

        return { articleHtml, imageSummary, usage: { promptTokens, completionTokens } };
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
    ): Promise<{ articleHtml: string; imageSummary: string; usage?: { promptTokens: number; completionTokens: number } }> {

        if (provider !== "openai") {
            throw new Error("Only OpenAI provider supported for PDF");
        }

        const model = modelName || "gpt-4.1-mini";

        const fileId = await this.uploadPdfToOpenAI(pdfBuffer, apiKey.api_key);
        logger.info(`PDF uploaded → ${fileId}`);

        return await this.callOpenAIWithUploadedPdf(prompt, fileId, apiKey.api_key, model);
    }

    private getGeminiClient(): GoogleGenAI | null {
        if (this.ai) {
            return this.ai;
        }

        const geminiApiKey = process.env.GEMINI_API_KEY;
        if (!geminiApiKey) {
            return null;
        }

        this.ai = new GoogleGenAI({ apiKey: geminiApiKey });
        return this.ai;
    }

    private async enhanceArticleWithGemini(
        articleHtml: string,
        context: {
            basePrompt: string;
            customPrompt?: string | null;
            imageSummary?: string | null;
            pdfUrl?: string | null;
            jobId: number;
        }
    ): Promise<string> {
        if (!articleHtml?.trim()) {
            return articleHtml;
        }

        const geminiClient = this.getGeminiClient();
        if (!geminiClient) {
            logger.warn(`Gemini API key missing, skipping enhancement for job ${context.jobId}`);
            return articleHtml;
        }

        const model = process.env.GEMINI_ENHANCEMENT_MODEL || 'gemini-2.5-flash';
        const temperatureEnv = Number(process.env.GEMINI_ENHANCEMENT_TEMPERATURE);
        const maxTokensEnv = Number(process.env.GEMINI_ENHANCEMENT_MAX_TOKENS);
        const temperature = Number.isFinite(temperatureEnv) ? temperatureEnv : 0.35;
        const maxOutputTokens = Number.isFinite(maxTokensEnv) ? maxTokensEnv : 6000;

        const guidance = [
            'You are a senior legal editor. Polish the HTML article below using the provided context.',
            'Goals:',
            '- Preserve every HTML tag and attribute unless restructuring improves clarity.',
            '- Strengthen readability, coherence, cross-linking sentences, and SEO value.',
            '- Use only facts present in the provided context; never introduce new facts.',
            '- Return ONLY the enhanced HTML, no explanations or markdown.'
        ].join('\n');

        const contextSections: string[] = [];
        if (context.basePrompt) {
            contextSections.push(`Original generation instructions:\n${context.basePrompt}`);
        }
        if (context.customPrompt) {
            contextSections.push(`Custom user instructions:\n${context.customPrompt}`);
        }
        if (context.imageSummary) {
            contextSections.push(`Case summary context:\n${context.imageSummary}`);
        }
        if (context.pdfUrl) {
            contextSections.push(`Reference PDF URL: ${context.pdfUrl}`);
        }

        const payload = [
            guidance,
            contextSections.length ? contextSections.join('\n\n') : '',
            'Original HTML (keep structure while refining wording):',
            articleHtml,
        ].filter(Boolean).join('\n\n');

        try {
            const response = await geminiClient.models.generateContent({
                model,
                contents: [
                    { role: "user", parts: [{ text: payload }] }
                ],
                config: {
                    temperature,
                    maxOutputTokens,
                },
            });

            const enhanced = this.extractTextFromGeminiResponse(response).trim();
            if (!enhanced) {
                logger.warn(`Gemini enhancement returned empty output for job ${context.jobId}`);
                return articleHtml;
            }

            logger.info(`Gemini enhancement succeeded for job ${context.jobId}`);
            return enhanced;
        } catch (error: any) {
            logger.warn(
                `Gemini enhancement failed for job ${context.jobId}:`,
                JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
            );
            return articleHtml;
        }
    }

    private extractTextFromGeminiResponse(response: any): string {
        if (!response) {
            return '';
        }

        try {
            if (typeof response.text === 'function') {
                return response.text();
            }
            if (typeof response.text === 'string') {
                return response.text;
            }
        } catch (error) {
            logger.warn('Failed to read Gemini response via text()', error);
        }

        const candidates = response?.response?.candidates || response?.candidates;
        if (Array.isArray(candidates) && candidates.length > 0) {
            const parts = candidates[0]?.content?.parts;
            if (Array.isArray(parts)) {
                return parts.map((part: any) => part?.text || '').join('').trim();
            }
        }

        return '';
    }

    private async translateArticleToHindi(
        htmlContent: string,
        apiKey: ApiKey,
        provider: string,
        modelName?: string | null
    ): Promise<{ html: string; usage?: { promptTokens: number; completionTokens: number } }> {
        if (!htmlContent?.trim()) {
            throw new Error('Cannot translate empty article content');
        }

        if (provider !== 'openai') {
            throw new Error('Hindi translation currently supports only the OpenAI provider');
        }

        const model = modelName || 'gpt-4.1-mini';
        const systemPrompt = `You are a professional legal translator. Translate the provided HTML article into Hindi.
Keep every HTML tag, attribute, number, and formatting exactly the same, only change the human-readable text to Hindi.
Do not summarize, omit, or add any content. Return ONLY the translated HTML, with no explanations.`;

        const response = await axios.post(
            'https://api.openai.com/v1/responses',
            {
                model,
                input: [
                    {
                        role: 'system',
                        content: [
                            {
                                type: 'input_text',
                                text: systemPrompt,
                            },
                        ],
                    },
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'input_text',
                                text: htmlContent,
                            },
                        ],
                    },
                ],
                max_output_tokens: 8000,
            },
            {
                headers: {
                    Authorization: `Bearer ${apiKey.api_key}`,
                    'Content-Type': 'application/json',
                },
                timeout: 180000,
            }
        );

        const translatedHtml = response.data?.output?.[0]?.content?.[0]?.text?.trim();
        if (!translatedHtml) {
            logger.error('Hindi translation failed, unexpected response', response.data);
            throw new Error('Failed to translate article to Hindi');
        }

        const usageRaw = response.data?.usage || {};
        const promptTokens = usageRaw.prompt_tokens ?? usageRaw.input_tokens ?? 0;
        const completionTokens = usageRaw.completion_tokens ?? usageRaw.output_tokens ?? 0;

        return { html: translatedHtml, usage: { promptTokens, completionTokens } };
    }

    private async generateFeaturedImage(
        title: string,
        html: string,
        apiKey: ApiKey,
        jobId: number,
        job: GenerationJob,
    ): Promise<{ mediaId: number; sourceUrl: string }> {
        if (!html?.trim()) {
            throw new Error('Cannot generate featured image without article content');
        }

        const prompt = this.buildImagePrompt(title, html);
        if (!prompt) {
            throw new Error('Failed to build image prompt for featured image generation');
        }

        const geminiApiKey = await this.selectApiKey('gemini');
        const imageBuffer = await this.generateGeminiImage(prompt, geminiApiKey ?? apiKey, jobId);

        if (!imageBuffer) {
            throw new Error('Gemini image generation returned empty output');
        }

        return this.uploadGeneratedImageToWordPress(imageBuffer, job, jobId);
    }

    private async generateGeminiImage(
        prompt: string,
        apiKey: ApiKey,
        jobId: number,
    ): Promise<Buffer | null> {

        const url =
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent";

        try {
            const response = await fetch(`${url}?key=${apiKey.api_key}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }]
                }),
            });

            const data = await response.json();

            const parts = data?.candidates?.[0]?.content?.parts;
            if (!Array.isArray(parts)) {
                logger.warn("Missing parts array in response", data);
                return null;
            }

            let base64: string | null = null;

            for (const part of parts) {
                if (part.inlineData?.data) {
                    base64 = part.inlineData.data;
                    break;
                }
            }

            if (!base64) {
                logger.warn("No Base64 inlineData.image found", data);
                return null;
            }

            const cleanBase64 = base64.replace(/\s+/g, "").trim();

            return Buffer.from(cleanBase64, "base64");

        } catch (error) {
            logger.warn("Failed to generate image", error);
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

    private async uploadGeneratedImageToWordPress(
        buffer: Buffer,
        job: GenerationJob,
        jobId: number,
    ): Promise<{ mediaId: number; sourceUrl: string }> {
        const wpUser = await User.findByPk(job.user_id);
        if (!wpUser) {
            throw new Error(`Unable to upload featured image: user ${job.user_id} not found`);
        }

        if (!wpUser.samvida_token) {
            throw new Error(`Unable to upload featured image: user ${job.user_id} missing Samvida token`);
        }

        const maxAttempts = Number(process.env.WP_IMAGE_UPLOAD_MAX_ATTEMPTS || 3);
        const retryDelayMs = Number(process.env.WP_IMAGE_UPLOAD_RETRY_DELAY_MS || 3000);
        const fileName = `article-${jobId}-${Date.now()}.png`;
        let lastError: any = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const uploadResult = await this.uploadImageToWordPress(
                    wpUser.samvida_token,
                    null,
                    null,
                    buffer,
                    fileName,
                );

                logger.info(`Uploaded featured image to WordPress media ${uploadResult.mediaId} for job ${job.id} (attempt ${attempt})`);
                return uploadResult;
            } catch (error: any) {
                lastError = error;
                logger.warn(`Attempt ${attempt}/${maxAttempts} to upload featured image for job ${job.id} failed`, error?.response?.data || error?.message || error);
                if (attempt < maxAttempts) {
                    await this.delay(retryDelayMs * attempt);
                }
            }
        }

        throw new Error(`Failed to upload featured image to WordPress after ${maxAttempts} attempts: ${lastError?.message || 'Unknown error'}`);
    }


    private stripHtml(input: string): string {
        return input.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    private async delay(ms: number): Promise<void> {
        if (ms <= 0) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, ms));
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

    private cloneMeta(meta: any): Record<string, any> {
        if (!meta || typeof meta !== 'object') {
            return {};
        }

        try {
            return JSON.parse(JSON.stringify(meta));
        } catch (error) {
            logger.warn('Failed to deep-clone meta payload, falling back to shallow copy');
            return { ...meta };
        }
    }

    private applySeoDefaults(metaInput: any, title: string, htmlContent: string): Record<string, any> {
        const meta = this.cloneMeta(metaInput);

        const titleCandidate = typeof meta.rank_math_title === 'string' ? meta.rank_math_title.trim() : '';
        if (!titleCandidate) {
            meta.rank_math_title = title;
        }

        const descriptionCandidate = typeof meta.rank_math_description === 'string'
            ? meta.rank_math_description.trim()
            : '';
        if (!descriptionCandidate) {
            const plain = this.stripHtml(htmlContent || '').slice(0, 300).trim();
            meta.rank_math_description = plain;
        }

        return meta;
    }

    private extractTitle(html: string): string | null {
        const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
        if (h1Match) {
            return h1Match[1].replace(/<[^>]*>/g, '').trim();
        }
        return null;
    }

    private async publishToWordPress(
        article: Article,
        job: GenerationJob,
        mediaContext: WordPressMediaContext = { imagePath: null, imageUrl: null, existingMediaId: null }
    ): Promise<void> {
        try {
            const wpUser = await User.findByPk(job.user_id);
            if (!wpUser) {
                throw new Error(`Unable to publish to WordPress: user ${job.user_id} not found`);
            }

            if (!wpUser.samvida_token) {
                throw new Error(`Unable to publish to WordPress: user ${job.user_id} missing Samvida token`);
            }

            const token = wpUser.samvida_token;
            let featuredMediaId = mediaContext?.existingMediaId
                ?? article.featured_media_wp_id
                ?? job.wp_config?.featured_media_wp_id
                ?? null;

            if (mediaContext?.existingMediaId && !article.featured_media_wp_id) {
                article.featured_media_wp_id = mediaContext.existingMediaId;
                if (mediaContext.imageUrl && !article.featured_image_url) {
                    article.featured_image_url = mediaContext.imageUrl;
                }
                await article.save();
            }

            if (!featuredMediaId && (mediaContext?.imagePath || mediaContext?.imageUrl)) {
                logger.info(`Uploading featured image for article ${article.id} to WordPress`);
                const uploadResult = await this.uploadImageToWordPress(token, mediaContext.imagePath, mediaContext.imageUrl);
                featuredMediaId = uploadResult.mediaId;
                article.featured_media_wp_id = uploadResult.mediaId;
                article.featured_image_url = uploadResult.sourceUrl;
                await article.save();
            }

            const wpPostPayload: WordPressPostPayload = {
                title: article.title,
                content: article.content,
                status: 'draft',
                author: job.wp_config?.author_wp_id || wpUser.samvida_user_id || null,
                featured_media: featuredMediaId,
                meta: this.applySeoDefaults(article.meta, article.title, article.content),
                tags: job.wp_config?.tags || null,
                categories: job.wp_config?.categories || null,
            };

            const wpPost = await this.createWordPressDraft(token, wpPostPayload);

            article.wp_post_id = wpPost.id;
            article.wp_permalink = wpPost.link;
            article.status = wpPost.status || article.status;
            article.author_wp_id = wpPost.author ?? article.author_wp_id;
            await article.save();

            logger.info(`Article ${article.id} pushed to WordPress post ${wpPost.id}`);
        } catch (error: any) {
            logger.error('Error publishing to WordPress:', error?.response?.data || error?.message || error);
            const existingError = article.error && typeof article.error === 'object' ? article.error : {};
            article.error = {
                ...existingError,
                wordpress: error?.response?.data || { message: error?.message || 'WordPress publish failed' },
            };
            await article.save();
            throw error;
        }
    }

    private getWordPressEndpoint(pathname: string): string {
        const base = this.wpBaseUrl.replace(/\/+$/, '');
        const suffix = pathname.startsWith('/') ? pathname : `/${pathname}`;
        return `${base}${suffix}`;
    }

    private async uploadImageToWordPress(
        token: string,
        imagePath?: string | null,
        fallbackUrl?: string | null,
        buffer?: Buffer | null,
        explicitFileName?: string,
    ): Promise<{ mediaId: number; sourceUrl: string }> {
        if (!imagePath && !fallbackUrl && !buffer) {
            throw new Error('No image available to upload to WordPress');
        }

        const formData = new FormData();
        const fileName = explicitFileName
            || (imagePath ? path.basename(imagePath) : `article-${Date.now()}.png`);

        if (buffer) {
            formData.append('file', buffer, { filename: fileName });
        } else if (imagePath) {
            formData.append('file', createReadStream(imagePath), { filename: fileName });
        } else if (fallbackUrl) {
            const response = await axios.get(fallbackUrl, {
                responseType: 'arraybuffer',
                timeout: 120000,
            });
            formData.append('file', Buffer.from(response.data), { filename: fileName });
        }

        const wpResponse = await axios.post(
            this.getWordPressEndpoint('/wp-json/wp/v2/media'),
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    Authorization: `Bearer ${token}`,
                },
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 120000,
            }
        );

        const mediaId = wpResponse.data?.id;
        const sourceUrl = wpResponse.data?.source_url || wpResponse.data?.guid?.rendered;

        if (!mediaId || !sourceUrl) {
            logger.warn('Unexpected WordPress media response', wpResponse.data);
            throw new Error('WordPress media upload failed: missing id/source_url');
        }

        logger.info(`Uploaded featured image to WordPress media ${mediaId}`);
        return { mediaId, sourceUrl };
    }

    private sanitizeWordPressPayload(payload: WordPressPostPayload): Record<string, any> {
        const body: Record<string, any> = {
            title: payload.title,
            content: payload.content,
            status: payload.status || 'draft',
        };

        if (payload.author !== undefined && payload.author !== null) {
            body.author = payload.author;
        }

        if (payload.featured_media !== undefined && payload.featured_media !== null) {
            body.featured_media = payload.featured_media;
        }

        if (payload.meta && typeof payload.meta === 'object' && Object.keys(payload.meta).length > 0) {
            body.meta = payload.meta;
        }

        if (Array.isArray(payload.tags) && payload.tags.length > 0) {
            body.tags = payload.tags;
        }

        if (Array.isArray(payload.categories) && payload.categories.length > 0) {
            body.categories = payload.categories;
        }

        return body;
    }

    private async createWordPressDraft(token: string, payload: WordPressPostPayload): Promise<any> {
        const body = this.sanitizeWordPressPayload(payload);
        const response = await axios.post(
            this.getWordPressEndpoint('/wp-json/wp/v2/posts'),
            body,
            {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                timeout: 120000,
            }
        );

        return response.data;
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
