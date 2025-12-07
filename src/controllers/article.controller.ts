import { Request, Response } from 'express';
import { ArticleFeedService } from '../services/articleFeed.service';
import { Article } from '../models/Article';
import { createResponse } from '../utils/utils';
import { User } from '../models/User';

export class ArticleController {
    private feedService: ArticleFeedService;

    constructor() {
        this.feedService = new ArticleFeedService();
    }

    async getById(req: Request, res: Response) {
        try {
            const articleId = req.params.id;
            
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

    async list(req: Request, res: Response) {
        try {
            const authUser = req.user as User;

            const query = {
                page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
                limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
                search: req.query.search as string | undefined,
                sortBy: req.query.sort_by as any,
                sortOrder: req.query.sort_order as 'asc' | 'desc' | undefined,
                type: req.query.type as 'article' | 'job' | undefined,
                articleStatus: req.query.article_status
                    ? (req.query.article_status as string).split(',').map((s) => s.trim()).filter(Boolean)
                    : undefined,
                jobStatus: req.query.job_status
                    ? (req.query.job_status as string).split(',').map((s) => s.trim()).filter(Boolean)
                    : undefined,
            };

            const payload = await this.feedService.listFeed(query, authUser);
            return createResponse(res, { status: true, payload });
        } catch (error: any) {
            return createResponse(res, {
                status: false,
                payload: { message: error.message },
                code: 400,
            });
        }
    }

    async getStats(req: Request, res: Response) {
        try {
            const authUser = req.user as User;
            const stats = await this.feedService.getArticleStats(authUser);
            return createResponse(res, { status: true, payload: stats });
        } catch (error: any) {
            return createResponse(res, {
                status: false,
                payload: { message: error.message },
                code: 400,
            });
        }
    }
}

export default ArticleController;