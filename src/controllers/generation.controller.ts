import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { GenerationService } from '../services/generation.service';
import { createResponse } from '../utils/utils';
import { User } from '../models/User';
import { Article } from '../models/Article';

export class GenerationController {
  private generationService: GenerationService;

  constructor() {
    this.generationService = new GenerationService();
  }

  async createJob(req: Request, res: Response) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return createResponse(res, { status: false, payload: errors.array() });
      }

      const authUser = req.user as User;
      
      // Convert relative path to absolute path if file was uploaded
      let pdfFilePath: string | undefined = undefined;
      if (req.file) {
        const path = await import('path');
        pdfFilePath = path.resolve(req.file.path);
      }
      
      const input = {
        pdf_url: req.body.pdf_url,
        pdf_file_path: pdfFilePath,
        prompt_template_id: req.body.prompt_template_id ? parseInt(req.body.prompt_template_id) : undefined,
        prompt_category: req.body.prompt_category,
        custom_prompt: req.body.custom_prompt,
        ai_enhancement: req.body.ai_enhancement !== 'false' && req.body.ai_enhancement !== false,
        model_provider: req.body.model_provider || 'openai',
        model_name: req.body.model_name,
        publish_to_wp: req.body.publish_to_wp === 'true' || req.body.publish_to_wp === true,
        wp_config: req.body.wp_config ? JSON.parse(req.body.wp_config) : undefined,
      };

      const [error, job] = await this.generationService.createJob(input, authUser.id);
      if (error) {
        return createResponse(res, { status: false, payload: error, code: 400 });
      }

      return createResponse(res, {
        status: true,
        code: 202,
        payload: {
          jobId: job!.uuid,
          status: job!.status,
          progress: job!.progress,
          createdAt: job!.createdAt,
          detail_url: `/api/v1/generate/${job!.uuid}`,
        },
      });
    } catch (error: any) {
      return createResponse(res, {
        status: false,
        payload: { message: error.message },
        code: 500,
      });
    }
  }

  async getJob(req: Request, res: Response) {
    try {
      const authUser = req.user as User;
      const jobId = req.params.jobId;

      const [error, job] = await this.generationService.getJobById(jobId, authUser.id);
      if (error) {
        return createResponse(res, { status: false, payload: error, code: 404 });
      }

      const response: any = {
        id: job!.id,
        uuid: job!.uuid,
        user_id: job!.user_id,
        pdf_url: job!.pdf_url,
        prompt_source: {
          template_id: job!.prompt_template_id,
          category: job!.prompt_category,
          custom_prompt: job!.custom_prompt,
        },
        ai_enhancement: job!.ai_enhancement,
        provider: job!.provider,
        model_name: job!.model_name,
        status: job!.status,
        progress: job!.progress,
        result_article_id: job!.result_article_id,
        result_preview: job!.result_preview,
        error: job!.error,
        attempts: job!.attempts,
        createdAt: job!.createdAt,
        started_at: job!.started_at,
        finished_at: job!.finished_at,
      };

      if (job!.result_article_id) {
        response.result_article_url = `/api/v1/articles/${job!.result_article_id}`;
      }

      return createResponse(res, { status: true, payload: response });
    } catch (error: any) {
      return createResponse(res, {
        status: false,
        payload: { message: error.message },
        code: 500,
      });
    }
  }

  async listJobs(req: Request, res: Response) {
    try {
      const authUser = req.user as User;
      const { mine, status, limit, offset } = req.query;

      const userId = mine === 'true' ? authUser.id : undefined;
      const [error, result] = await this.generationService.listJobs(
        userId,
        status as string,
        limit ? parseInt(limit as string) : 50,
        offset ? parseInt(offset as string) : 0
      );

      if (error) {
        return createResponse(res, { status: false, payload: error });
      }

      return createResponse(res, { status: true, payload: result });
    } catch (error: any) {
      return createResponse(res, {
        status: false,
        payload: { message: error.message },
        code: 500,
      });
    }
  }

  async cancelJob(req: Request, res: Response) {
    try {
      const authUser = req.user as User;
      const jobId = req.params.jobId;

      const [error, cancelled] = await this.generationService.cancelJob(jobId, authUser.id);
      if (error) {
        return createResponse(res, { status: false, payload: error, code: 400 });
      }

      return createResponse(res, { status: true, payload: { cancelled } });
    } catch (error: any) {
      return createResponse(res, {
        status: false,
        payload: { message: error.message },
        code: 500,
      });
    }
  }

  async getArticle(req: Request, res: Response) {
    try {
      const articleId = req.params.articleId;
      const article = await Article.findByPk(articleId);

      if (!article) {
        return createResponse(res, {
          status: false,
          payload: { message: 'Article not found' },
          code: 404,
        });
      }

      return createResponse(res, { status: true, payload: article });
    } catch (error: any) {
      return createResponse(res, {
        status: false,
        payload: { message: error.message },
        code: 500,
      });
    }
  }
}
