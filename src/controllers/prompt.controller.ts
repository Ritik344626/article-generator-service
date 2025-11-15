import { Request, Response } from "express";
import { validationResult } from "express-validator";
import { PromptService } from "../services/prompt.service";
import { Prompt } from "../models/Prompt";
import { createResponse } from "../utils/utils";
import { User } from "../models/User";

export class PromptController {
    private promptService: PromptService;

    constructor() {
        this.promptService = new PromptService();
    }

    async createPrompt(req: Request, res: Response) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return createResponse(res, { status: false, payload: errors.array() });
        }

        const authUser = req.user as User;
        const promptDetails = req.body as Prompt;
        
        const [error, prompt] = await this.promptService.createPrompt(promptDetails, authUser.id);
        if (error) {
            return createResponse(res, { status: false, payload: error });
        }
        return createResponse(res, { status: true, payload: { prompt } });
    }

    async updatePrompt(req: Request, res: Response) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return createResponse(res, { status: false, payload: errors.array() });
        }

        const authUser = req.user as User;
        const promptDetails = req.body as Prompt;
        const promptId = req.params.promptId;

        const [error, prompt] = await this.promptService.updatePrompt(promptId, promptDetails, authUser.id);
        if (error) {
            return createResponse(res, { status: false, payload: error });
        }
        return createResponse(res, { status: true, payload: { prompt } });
    }

    async deletePrompt(req: Request, res: Response) {
        const authUser = req.user as User;
        const promptId = req.params.promptId;

        const [error, isDeleted] = await this.promptService.deletePrompt(promptId, authUser.id);
        if (error) {
            return createResponse(res, { status: false, payload: error });
        }
        return createResponse(res, { status: true, payload: { isDeleted } });
    }

    async getPrompts(req: Request, res: Response) {
        const authUser = req.user as User;
        const { my, category } = req.query;

        // If 'my' query param is true, filter by user's prompts
        const userId = my === 'true' ? authUser.id : undefined;
        const categoryFilter = category ? String(category) : undefined;

        const [error, prompts] = await this.promptService.getPrompts(userId, categoryFilter);
        if (error) {
            return createResponse(res, { status: false, payload: error });
        }
        return createResponse(res, { status: true, payload: prompts });
    }

    async getPromptById(req: Request, res: Response) {
        const promptId = req.params.promptId;

        const [error, prompt] = await this.promptService.getPromptById(promptId);
        if (error) {
            return createResponse(res, { status: false, payload: error });
        }
        return createResponse(res, { status: true, payload: prompt });
    }
}
