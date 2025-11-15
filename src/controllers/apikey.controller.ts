import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { ApiKeyService } from '../services/apikey.service';
import { createResponse } from '../utils/utils';
import { User } from '../models/User';

export class ApiKeyController {
  private apiKeyService: ApiKeyService;

  constructor() {
    this.apiKeyService = new ApiKeyService();
  }

  async createKey(req: Request, res: Response) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return createResponse(res, { status: false, payload: errors.array() });
    }
    const authUser = req.user as User;
    const body = req.body;
    const [error, key] = await this.apiKeyService.createKey(body, authUser.id);
    if (error) return createResponse(res, { status: false, payload: error });
    return createResponse(res, { status: true, payload: { key_id: key?.id } });
  }

  async listKeys(req: Request, res: Response) {
    const authUser = req.user as User;
    const { provider, mine } = req.query;
    const userFilter = mine === 'true' ? authUser.id : undefined;
    const [error, keys] = await this.apiKeyService.listKeys(userFilter, provider ? String(provider) : undefined);
    if (error) return createResponse(res, { status: false, payload: error });
    return createResponse(res, { status: true, payload: keys });
  }

  async getKey(req: Request, res: Response) {
    const authUser = req.user as User;
    const { show_full } = req.query;
    const [error, key] = await this.apiKeyService.getKeyById(req.params.keyId, show_full === 'true', authUser.id);
    if (error) return createResponse(res, { status: false, payload: error });
    return createResponse(res, { status: true, payload: key });
  }

  async updateKey(req: Request, res: Response) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return createResponse(res, { status: false, payload: errors.array() });
    }
    const authUser = req.user as User;
    const [error, key] = await this.apiKeyService.updateKey(req.params.keyId, req.body, authUser.id);
    if (error) return createResponse(res, { status: false, payload: error });
    return createResponse(res, { status: true, payload: key });
  }

  async deleteKey(req: Request, res: Response) {
    const authUser = req.user as User;
    const [error, deleted] = await this.apiKeyService.deleteKey(req.params.keyId, authUser.id);
    if (error) return createResponse(res, { status: false, payload: error });
    return createResponse(res, { status: true, payload: { deleted } });
  }
}
