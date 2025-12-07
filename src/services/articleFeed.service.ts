import { QueryTypes } from 'sequelize';
import { sequelize } from '../config/database';
import { JobStatus } from '../models/GenerationJob';
import { ApiKey } from '../models/ApiKey';
import { User } from '../models/User';

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
    prompt_category: string | null;
    user_id: number | null;
    user_name: string | null;
    user_email: string | null;
    user_display_name: string | null;
    user_roles: any;
    error: any | null;
}

export class ArticleFeedService {
    private readonly allowedSortColumns: Record<string, string> = {
        title: 'title',
        status: 'status',
        created_at: 'created_at',
        updated_at: 'updated_at',
        progress: 'progress',
    };

    async listFeed(query: ArticleFeedQuery, currentUser?: User) {
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

        let actualArticleStatus = query.articleStatus;
        let actualJobStatus = query.jobStatus;
        let explicitJobStatusFilter = false;
        let explicitArticleStatusFilter = false;
        
        if (actualArticleStatus?.length) {
            const jobStatusValues = Object.values(JobStatus);
            const isJobStatus = actualArticleStatus.some(s => jobStatusValues.includes(s as any));
            
            if (isJobStatus) {
                actualJobStatus = actualArticleStatus;
                actualArticleStatus = undefined;
                explicitJobStatusFilter = true;
            } else {
                explicitArticleStatusFilter = true;
            }
        }

        if (actualJobStatus?.length) {
            explicitJobStatusFilter = true;
        }

        if (actualArticleStatus?.length) {
            baseReplacements.articleStatuses = actualArticleStatus;
            articleFilters.push('a.status IN (:articleStatuses)');
        }

        const jobStatuses = actualJobStatus?.length ? actualJobStatus : [JobStatus.PENDING, JobStatus.PROCESSING, JobStatus.FAILED];
        baseReplacements.jobStatuses = jobStatuses;
        jobFilters.push('gj.status IN (:jobStatuses)');

        const includeArticles = typeFilter !== 'job' && !explicitJobStatusFilter;
        const includeJobs = typeFilter !== 'article' && !explicitArticleStatusFilter;

        if (!includeArticles && !includeJobs) {
            throw new Error('Invalid type filter. Expected "article" or "job".');
        }

        const isAdmin = this.isAdminUser(currentUser);
        const currentUserId = currentUser?.id;

        if (!isAdmin) {
            if (!currentUserId) {
                throw new Error('Authenticated user context required to filter feed results');
            }

            if (includeArticles) {
                articleFilters.push('ua.id = :currentUserId');
            }

            if (includeJobs) {
                jobFilters.push('gj.user_id = :currentUserId');
            }

            baseReplacements.currentUserId = currentUserId;
        }

        const articleWhereClause = articleFilters.length ? `WHERE ${articleFilters.join(' AND ')}` : '';
        const jobWhereClause = jobFilters.length ? `WHERE ${jobFilters.join(' AND ')}` : '';

        const processingTitle = process.env.JOB_PROCESSING_PLACEHOLDER_TITLE || 'Processing Article...';
        baseReplacements.processingTitle = processingTitle;

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
                    NULL AS provider,
                    p.category AS prompt_category,
                    ua.id AS user_id,
                    ua.name AS user_name,
                    ua.email AS user_email,
                    ua.user_display_name AS user_display_name,
                    ua.roles AS user_roles,
                    NULL AS error
                FROM articles a
                LEFT JOIN prompts p ON a.prompt_template_id = p.id
                LEFT JOIN generation_jobs agj ON agj.result_article_id = COALESCE(a.translation_of_article_id, a.id)
                LEFT JOIN users ua ON ua.id = agj.user_id
                ${articleWhereClause}
            `);
        }

        if (includeJobs) {
            segments.push(`
                SELECT
                    gj.id AS record_id,
                    COALESCE(gj.result_preview, :processingTitle) AS title,
                    gj.status AS status,
                    'job' AS record_type,
                    gj.uuid AS uuid,
                    gj.progress AS progress,
                    gj.createdAt AS created_at,
                    gj.updatedAt AS updated_at,
                    NULL AS featured_image_url,
                    gj.pdf_url AS pdf_url,
                    gj.provider AS provider,
                    gj.prompt_category AS prompt_category,
                    uj.id AS user_id,
                    uj.name AS user_name,
                    uj.email AS user_email,
                    uj.user_display_name AS user_display_name,
                    uj.roles AS user_roles,
                    gj.error AS error
                FROM generation_jobs gj
                LEFT JOIN users uj ON uj.id = gj.user_id
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
                prompt_category: row.prompt_category,
                createdBy: this.buildCreatedBy(row),
                error: row.error || null,
            })),
        };
    }

    private buildCreatedBy(row: ArticleFeedRow) {
        if (!row.user_id) {
            return null;
        }

        return {
            id: row.user_id,
            name: row.user_name,
            email: row.user_email,
            displayName: row.user_display_name,
            roles: this.deserializeRoles(row.user_roles) || [],
        };
    }

    private deserializeRoles(value: any): string[] | null {
        if (!value) {
            return null;
        }

        if (Array.isArray(value)) {
            return value.filter(Boolean).map((role) => String(role));
        }

        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) {
                    return parsed.filter(Boolean).map((role) => String(role));
                }
            } catch {
                return [value];
            }
        }

        return null;
    }

    private isAdminUser(user?: User): boolean {
        if (!user?.roles) return false;

        let roles = user.roles;

        if (typeof roles === 'string') {
            try {
                roles = JSON.parse(roles);
            } catch (err) {
                console.log('Failed to parse roles:', roles);
                return false;
            }
        }

        console.log("Parsed roles:", roles);

        if (!Array.isArray(roles)) return false;

        return roles.some((role) =>
            typeof role === 'string' &&
            ['administrator', 'admin'].includes(role.toLowerCase())
        );
    }

    /**
     * Get article statistics for dashboard
     */
    async getArticleStats(currentUser?: User) {
        const isAdmin = this.isAdminUser(currentUser);
        const userId = currentUser?.id;

        let articleQuery = `
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
                SUM(CASE WHEN status = 'publish' THEN 1 ELSE 0 END) as published
            FROM articles
        `;
        let jobQuery = `
            SELECT 
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM generation_jobs
        `;

        const queryReplacements: Record<string, any> = {};

        if (!isAdmin && userId) {
            queryReplacements.userId = userId;
            articleQuery += `
                WHERE id IN (
                    SELECT DISTINCT a.id FROM articles a
                    LEFT JOIN generation_jobs agj ON agj.result_article_id = COALESCE(a.translation_of_article_id, a.id)
                    WHERE agj.user_id = :userId
                )
            `;
            jobQuery += `
                WHERE user_id = :userId
            `;
        }

        const [articleResults] = await sequelize.query<any>(articleQuery, { 
            replacements: queryReplacements,
            type: QueryTypes.SELECT 
        });
        const [jobResults] = await sequelize.query<any>(jobQuery, { 
            replacements: queryReplacements,
            type: QueryTypes.SELECT 
        });

        let apiKey = null;
        if (isAdmin) {
            apiKey = await ApiKey.findOne({
                where: { provider: 'openai', status: 'active' },
                order: [["credits_remaining_usd_month", "DESC"]],
            });
        }

        const limit = apiKey ? Number((apiKey as any).credits_monthly_limit_usd ?? 0) : null;
        const remaining = apiKey ? Number((apiKey as any).credits_remaining_usd_month ?? 0) : null;
        const used = apiKey ? Number((apiKey as any).credits_used_usd_month ?? (limit != null ? (limit - (remaining || 0)) : 0)) : null;
        const percent_remaining = limit && limit > 0 && remaining != null
            ? Number(((remaining / limit) * 100).toFixed(2))
            : null;

        const articleTotal = parseInt(articleResults?.total || 0);
        const draftCount = parseInt(articleResults?.draft || 0);
        const publishedCount = parseInt(articleResults?.published || 0);
        const pendingCount = parseInt(jobResults?.pending || 0);
        const processingCount = parseInt(jobResults?.processing || 0);
        const failedCount = parseInt(jobResults?.failed || 0);

        return {
            total: articleTotal + processingCount + failedCount,
            draft: draftCount,
            published: publishedCount,
            pending: pendingCount,
            processing: processingCount,
            failed: failedCount,
            credits: isAdmin ? {
                provider: apiKey?.provider || 'openai',
                remaining_usd: remaining,
            } : null,
        };
    }
}

export default ArticleFeedService;