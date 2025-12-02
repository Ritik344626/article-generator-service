import { ApiKey } from '../models/ApiKey';
import logger from '../utils/logger';

const maskKey = (key: string) => {
  if (!key) return '';
  if (key.length <= 8) return key.replace(/.(?=.{0}$)/g, '*');
  return key.slice(0, 4) + '****' + key.slice(-4);
};

export class ApiKeyService {
  constructor() {}

  async createKey(details: Partial<ApiKey>, userId: number): Promise<[any, ApiKey | null]> {
    try {
      const limit = Number((details as any).credits_monthly_limit_usd ?? (details as any).credits_monthly_limit ?? 100);
      const created = await ApiKey.create({
        provider: details.provider,
        model_name: details.model_name || null,
        api_key: details.api_key,
        status: details.status || 'active',
        usage_limit: details.usage_limit || null,
        usage_count: 0,
        last_used_at: null,
        created_by: userId,
        credits_monthly_limit_usd: limit,
        credits_used_usd_month: 0,
        credits_remaining_usd_month: limit,
        credits_month_start: new Date(),
      } as any);
      return [null, created];
    } catch (error) {
      logger.error('Error creating API key', error);
      return [error, null];
    }
  }

  async listKeys(userId?: number, provider?: string): Promise<[any, any[] | null]> {
    try {
      const where: any = {};
      if (userId) where.created_by = userId;
      if (provider) where.provider = provider;
      const keys = await ApiKey.findAll({ where });
      const masked = keys.map(k => ({
        id: k.id,
        provider: k.provider,
        model_name: k.model_name,
        api_key: k.api_key,
        status: k.status,
        usage_limit: k.usage_limit,
        usage_count: k.usage_count,
        last_used_at: k.last_used_at,
        created_by: k.created_by,
        createdAt: k.createdAt,
        updatedAt: k.updatedAt,
        credits_monthly_limit_usd: (k as any).credits_monthly_limit_usd,
        credits_used_usd_month: (k as any).credits_used_usd_month,
        credits_remaining_usd_month: (k as any).credits_remaining_usd_month,
        credits_month_start: (k as any).credits_month_start,
      }));
      return [null, masked];
    } catch (error) {
      logger.error('Error listing API keys', error);
      return [error, null];
    }
  }

  async getKeyById(id: string, showFull: boolean, userId?: number): Promise<[any, any | null]> {
    try {
      const key = await ApiKey.findByPk(id);
      if (!key) return [{ message: 'API key not found' }, null];
      if (userId && key.created_by !== userId) {
        return [{ message: 'Unauthorized: not owner of this key' }, null];
      }
      return [null, {
        id: key.id,
        provider: key.provider,
        model_name: key.model_name,
        api_key: showFull ? key.api_key : maskKey(key.api_key),
        status: key.status,
        usage_limit: key.usage_limit,
        usage_count: key.usage_count,
        last_used_at: key.last_used_at,
        created_by: key.created_by,
        createdAt: key.createdAt,
        updatedAt: key.updatedAt,
        credits_monthly_limit_usd: (key as any).credits_monthly_limit_usd,
        credits_used_usd_month: (key as any).credits_used_usd_month,
        credits_remaining_usd_month: (key as any).credits_remaining_usd_month,
        credits_month_start: (key as any).credits_month_start,
      }];
    } catch (error) {
      logger.error('Error fetching API key', error);
      return [error, null];
    }
  }

  async updateKey(id: string, details: Partial<ApiKey>, userId: number): Promise<[any, any | null]> {
    try {
      const key = await ApiKey.findByPk(id);
      if (!key) return [{ message: 'API key not found' }, null];
      if (key.created_by !== userId) return [{ message: 'Unauthorized: not owner of this key' }, null];

      if (details.provider !== undefined) key.provider = details.provider;
      if (details.model_name !== undefined) key.model_name = details.model_name;
      if (details.api_key !== undefined) key.api_key = details.api_key;
      if (details.status !== undefined) key.status = details.status;
      if (details.usage_limit !== undefined) key.usage_limit = details.usage_limit;

      // Update monthly credit limit and optionally reset window
      const hasLimit = (details as any).credits_monthly_limit_usd !== undefined || (details as any).credits_monthly_limit !== undefined;
      if (hasLimit) {
        const newLimit = Number((details as any).credits_monthly_limit_usd ?? (details as any).credits_monthly_limit);
        (key as any).credits_monthly_limit_usd = newLimit;
        // If explicit remaining provided, honor it; else adjust remaining to new_limit - used (not below 0)
        const used = Number((key as any).credits_used_usd_month || 0);
        const providedRemaining = (details as any).credits_remaining_usd_month;
        if (providedRemaining !== undefined) {
          (key as any).credits_remaining_usd_month = Number(providedRemaining);
        } else {
          (key as any).credits_remaining_usd_month = Math.max(0, Number(newLimit - used));
        }
      }

      if ((details as any).reset_month === true) {
        const limit = Number((key as any).credits_monthly_limit_usd || 0);
        (key as any).credits_month_start = new Date();
        (key as any).credits_used_usd_month = 0;
        (key as any).credits_remaining_usd_month = limit;
      }

      await key.save();
      return [null, { id: key.id, provider: key.provider, model_name: key.model_name, api_key: key.api_key, status: key.status, usage_limit: key.usage_limit, usage_count: key.usage_count, last_used_at: key.last_used_at, created_by: key.created_by, credits_monthly_limit_usd: (key as any).credits_monthly_limit_usd, credits_used_usd_month: (key as any).credits_used_usd_month, credits_remaining_usd_month: (key as any).credits_remaining_usd_month, credits_month_start: (key as any).credits_month_start }];
    } catch (error) {
      logger.error('Error updating API key', error);
      return [error, null];
    }
  }

  async deleteKey(id: string, userId: number): Promise<[any, boolean | null]> {
    try {
      const key = await ApiKey.findByPk(id);
      if (!key) return [{ message: 'API key not found' }, null];
      if (key.created_by !== userId) return [{ message: 'Unauthorized: not owner of this key' }, null];
      await key.destroy();
      return [null, true];
    } catch (error) {
      logger.error('Error deleting API key', error);
      return [error, null];
    }
  }

  async markKeyUsed(id: number): Promise<void> {
    try {
      const key = await ApiKey.findByPk(id);
      if (!key) return;
      key.usage_count = (key.usage_count || 0) + 1;
      key.last_used_at = new Date();
      await key.save();
    } catch (error) {
      logger.error('Error marking key used', error);
    }
  }
}
