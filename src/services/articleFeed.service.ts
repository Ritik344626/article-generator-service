import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/database';
import { JobStatus } from '../models/GenerationJob';

export interface ArticleFeedQuery {
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: 'title' | 'status' | 'created_at' | 'updated_at' | 'progress';
    sortOrder?: 'asc' | 'desc';
    type?: 'article' | 'job';
    articleStatus?: string[];
    jobStatus?: string[];
}

interface ArticleFeedRow {
    record_id: number;
    title: string;
    status: string;
    record_type: 'article' | 'job';
    uuid: string | null;
    progress: number | null;
    created_at: Date;
    updated_at: Date;
    featured_image_url: string | null;
    pdf_url: string | null;
    provider: string | null;
}

export class ArticleFeedService {
    private readonly allowedSortColumns: Record<string, string> = {
        title: 'title',
        status: 'status',
        created_at: 'created_at',
        updated_at: 'updated_at',
        progress: 'progress',
    };

    async listFeed(query: ArticleFeedQuery) {
        const page = Math.max(Number(query.page) || 1, 1);
        const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
        const offset = (page - 1) * limit;
        const sortBy = this.allowedSortColumns[query.sortBy || 'created_at'] || 'created_at';
        const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
        const typeFilter = query.type;

        const search = query.search?.trim();
        const articleFilters: string[] = [];
        const jobFilters: string[] = [];
        const baseReplacements: Record<string, any> = {};

        if (search) {
            baseReplacements.search = `%${search}%`;
            articleFilters.push('(a.title LIKE :search OR a.content LIKE :search)');
            jobFilters.push('(gj.custom_prompt LIKE :search OR gj.prompt_category LIKE :search OR gj.result_preview LIKE :search)');
        }

        if (query.articleStatus?.length) {
            baseReplacements.articleStatuses = query.articleStatus;
            articleFilters.push('a.status IN (:articleStatuses)');
        }

        const jobStatuses = query.jobStatus?.length ? query.jobStatus : [JobStatus.PENDING, JobStatus.PROCESSING];
        baseReplacements.jobStatuses = jobStatuses;
        jobFilters.push('gj.status IN (:jobStatuses)');

        const includeArticles = typeFilter !== 'job';
        const includeJobs = typeFilter !== 'article';

        if (!includeArticles && !includeJobs) {
            throw new Error('Invalid type filter. Expected "article" or "job".');
        }

        const articleWhereClause = articleFilters.length ? `WHERE ${articleFilters.join(' AND ')}` : '';
        const jobWhereClause = jobFilters.length ? `WHERE ${jobFilters.join(' AND ')}` : '';

        const segments: string[] = [];

        if (includeArticles) {
            segments.push(`
                SELECT
                    a.id AS record_id,
                    a.title AS title,
                    a.status AS status,
                    'article' AS record_type,
                    NULL AS uuid,
                    NULL AS progress,
                    a.createdAt AS created_at,
                    a.updatedAt AS updated_at,
                    a.featured_image_url AS featured_image_url,
                    a.pdf_url AS pdf_url,
                    NULL AS provider
                FROM articles a
                ${articleWhereClause}
            `);
        }

        if (includeJobs) {
            segments.push(`
                SELECT
                    gj.id AS record_id,
                    COALESCE(gj.result_preview, gj.custom_prompt, gj.prompt_category, CONCAT('Job ', gj.uuid)) AS title,
                    gj.status AS status,
                    'job' AS record_type,
                    gj.uuid AS uuid,
                    gj.progress AS progress,
                    gj.createdAt AS created_at,
                    gj.updatedAt AS updated_at,
                    NULL AS featured_image_url,
                    gj.pdf_url AS pdf_url,
                    gj.provider AS provider
                FROM generation_jobs gj
                ${jobWhereClause}
            `);
        }

        const unionQuery = segments.join('\nUNION ALL\n');

        const baseQuery = `
            SELECT * FROM (
                ${unionQuery}
            ) AS combined
        `;

        const countQuery = `
            SELECT COUNT(*) as total FROM (
                ${unionQuery}
            ) AS combined_count
        `;

        const listQuery = `${baseQuery} ORDER BY ${sortBy} ${sortOrder} LIMIT :limit OFFSET :offset`;

        const [items, countRows] = await Promise.all([
            sequelize.query<ArticleFeedRow>(listQuery, {
                replacements: { ...baseReplacements, limit, offset },
                type: QueryTypes.SELECT,
            }),
            sequelize.query<{ total: number }>(countQuery, {
                replacements: baseReplacements,
                type: QueryTypes.SELECT,
            }),
        ]);

        const total = countRows?.[0]?.total || 0;

        return {
            total,
            page,
            limit,
            items: items.map((row) => ({
                id: row.record_id,
                title: row.title,
                status: row.status,
                type: row.record_type,
                uuid: row.uuid,
                progress: row.progress,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                featured_image_url: row.featured_image_url,
                pdf_url: row.pdf_url,
                provider: row.provider,
            })),
        };
    }
}

export default ArticleFeedService;