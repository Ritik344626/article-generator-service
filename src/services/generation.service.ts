import { GenerationJob, JobStatus } from '../models/GenerationJob';
import { Prompt } from '../models/Prompt';
import { ApiKey } from '../models/ApiKey';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { generationQueue } from '../workers/queue';

interface CreateJobInput {
  pdf_url?: string;
  pdf_file_path?: string;
  prompt_template_id?: number;
  prompt_category?: string;
  custom_prompt?: string;
  ai_enhancement?: boolean;
  model_provider?: string;
  model_name?: string;
  publish_to_wp?: boolean;
  wp_config?: {
    author_wp_id?: number;
    featured_media_wp_id?: number;
    tags?: string[];
    categories?: string[];
    meta?: any;
  };
}

export class GenerationService {
  constructor() {}

  async createJob(input: CreateJobInput, userId: number): Promise<[any, GenerationJob | null]> {
    try {
      // Validate input
      if (!input.pdf_url && !input.pdf_file_path) {
        return [{ message: 'Either pdf_url or uploaded file is required' }, null];
      }

      if (!input.prompt_template_id && !input.prompt_category && !input.custom_prompt) {
        return [{ message: 'Either prompt_template_id, prompt_category, or custom_prompt is required' }, null];
      }

      const uuid = uuidv4();
      const provider = input.model_provider || 'openai';
      
      // Convert file path to file:// URL if uploaded
      let pdfUrl = input.pdf_url || '';
      if (!pdfUrl && input.pdf_file_path) {
        // Convert absolute path to file:// URL
        pdfUrl = `file://${input.pdf_file_path}`;
      }
      
      // Create job record
      const job = await GenerationJob.create({
        uuid,
        user_id: userId,
        pdf_url: pdfUrl,
        prompt_template_id: input.prompt_template_id || null,
        prompt_category: input.prompt_category || null,
        custom_prompt: input.custom_prompt || null,
        ai_enhancement: input.ai_enhancement !== false,
        provider,
        model_name: input.model_name || null,
        status: JobStatus.PENDING,
        progress: 0,
        attempts: 0,
        publish_to_wp: input.publish_to_wp || true,
        wp_config: input.wp_config || null,
      } as any);

      // Add to queue
      await generationQueue.add('generate-article', {
        jobId: job.id,
        uuid: job.uuid,
      }, {
        jobId: job.uuid,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: false,
        removeOnFail: false,
      });

      logger.info(`Job ${uuid} created and queued for user ${userId}`);
      return [null, job];
    } catch (error) {
      logger.error('Error creating generation job', error);
      return [error, null];
    }
  }

  async getJobById(jobId: string, userId?: number): Promise<[any, GenerationJob | null]> {
    try {
      const where: any = { uuid: jobId };
      if (userId) {
        where.user_id = userId;
      }

      const job = await GenerationJob.findOne({ where });
      if (!job) {
        return [{ message: 'Job not found' }, null];
      }

      return [null, job];
    } catch (error) {
      logger.error('Error fetching job', error);
      return [error, null];
    }
  }

  async listJobs(userId?: number, status?: string, limit = 50, offset = 0): Promise<[any, any]> {
    try {
      const where: any = {};
      if (userId) {
        where.user_id = userId;
      }
      if (status) {
        where.status = status;
      }

      const { count, rows } = await GenerationJob.findAndCountAll({
        where,
        limit,
        offset,
        order: [['createdAt', 'DESC']],
      });

      return [null, { total: count, jobs: rows, limit, offset }];
    } catch (error) {
      logger.error('Error listing jobs', error);
      return [error, null];
    }
  }

  async cancelJob(jobId: string, userId: number): Promise<[any, boolean | null]> {
    try {
      const [err, job] = await this.getJobById(jobId, userId);
      if (err || !job) {
        return [err || { message: 'Job not found' }, null];
      }

      if (job.status === JobStatus.COMPLETED || job.status === JobStatus.FAILED) {
        return [{ message: 'Cannot cancel completed or failed job' }, null];
      }

      if (job.status === JobStatus.CANCELLED) {
        return [{ message: 'Job already cancelled' }, null];
      }

      job.status = JobStatus.CANCELLED;
      job.finished_at = new Date();
      await job.save();

      // Try to remove from queue if pending
      const queueJob = await generationQueue.getJob(job.uuid);
      if (queueJob) {
        await queueJob.remove();
      }

      logger.info(`Job ${jobId} cancelled by user ${userId}`);
      return [null, true];
    } catch (error) {
      logger.error('Error cancelling job', error);
      return [error, null];
    }
  }

  async updateJobStatus(jobId: number, status: JobStatus, data: any = {}): Promise<void> {
    try {
      const job = await GenerationJob.findByPk(jobId);
      if (!job) return;

      job.status = status;
      if (data.progress !== undefined) job.progress = data.progress;
      if (data.error) job.error = data.error;
      if (data.result_article_id) job.result_article_id = data.result_article_id;
      if (data.result_preview) job.result_preview = data.result_preview;
      if (data.provider_api_key_id) job.provider_api_key_id = data.provider_api_key_id;
      if (data.prompt_merged) job.prompt_merged = data.prompt_merged;
      
      if (status === JobStatus.PROCESSING && !job.started_at) {
        job.started_at = new Date();
      }
      
      if (status === JobStatus.COMPLETED || status === JobStatus.FAILED) {
        job.finished_at = new Date();
        job.progress = status === JobStatus.COMPLETED ? 100 : job.progress;
      }

      job.attempts = (job.attempts || 0) + 1;
      await job.save();
    } catch (error) {
      logger.error('Error updating job status', error);
    }
  }

  async selectApiKey(provider: string, userId?: number): Promise<ApiKey | null> {
    try {
      const where: any = { provider, status: 'active' };
      
      // Try user's keys first
      if (userId) {
        const userKey = await ApiKey.findOne({
          where: { ...where, created_by: userId },
          order: [['usage_count', 'ASC']],
        });
        if (userKey && (!userKey.usage_limit || userKey.usage_count < userKey.usage_limit)) {
          return userKey;
        }
      }

      // Fallback to system keys (any active key with capacity)
      const systemKey = await ApiKey.findOne({
        where,
        order: [['usage_count', 'ASC']],
      });

      if (systemKey && (!systemKey.usage_limit || systemKey.usage_count < systemKey.usage_limit)) {
        return systemKey;
      }

      return null;
    } catch (error) {
      logger.error('Error selecting API key', error);
      return null;
    }
  }
}
