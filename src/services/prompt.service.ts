import { Prompt } from '../models/Prompt';
import logger from '../utils/logger';

export class PromptService {

    constructor() { }

    async createPrompt(promptDetails: Partial<Prompt>, userId: number): Promise<[null | any, Prompt | null]> {
        try {
            const prompt = await Prompt.create({
                ...promptDetails,
                created_by: userId
            } as any);
            return [null, prompt];
        } catch (error) {
            logger.error('Error creating prompt', error);
            return [error, null];
        }
    }

    async updatePrompt(promptId: string, promptDetails: Partial<Prompt>, userId: number): Promise<[null | any, Prompt | null]> {
        try {
            const [error, prompt] = await this.getPromptById(promptId);
            if (error) {
                return [error, null];
            }
            if (!prompt) {
                return [{ message: 'Prompt not found' }, null];
            }
            
            // Check if user owns this prompt
            if (prompt.created_by !== userId) {
                return [{ message: 'Unauthorized: You can only update your own prompts' }, null];
            }

            if (promptDetails.prompt_text !== undefined) prompt.prompt_text = promptDetails.prompt_text;
            if (promptDetails.category !== undefined) prompt.category = promptDetails.category;

            const updatedPrompt = await prompt.save();
            return [null, updatedPrompt];
        } catch (error) {
            logger.error('Error updating prompt', error);
            return [error, null];
        }
    }

    async deletePrompt(promptId: string, userId: number): Promise<[null | any, boolean | null]> {
        try {
            const [error, prompt] = await this.getPromptById(promptId);
            if (error) {
                return [error, null];
            }
            if (!prompt) {
                return [{ message: 'Prompt not found' }, null];
            }

            // Check if user owns this prompt
            if (prompt.created_by !== userId) {
                return [{ message: 'Unauthorized: You can only delete your own prompts' }, null];
            }

            await prompt.destroy();
            return [null, true];
        } catch (error) {
            logger.error('Error deleting prompt', error);
            return [error, null];
        }
    }

    async getPrompts(userId?: number, category?: string): Promise<[null | any, Array<Prompt> | null]> {
        try {
            const filters: any = { where: {} };
            
            if (userId) {
                filters.where.created_by = userId;
            }
            if (category) {
                filters.where.category = category;
            }

            const prompts = await Prompt.findAll(filters);
            return [null, prompts || []];
        } catch (error) {
            logger.error('Error fetching prompts', error);
            return [error, null];
        }
    }

    async getPromptById(promptId: string): Promise<[null | any, Prompt | null]> {
        try {
            const prompt = await Prompt.findByPk(promptId);
            if (!prompt) {
                return [{ message: 'Prompt not found' }, null];
            }
            return [null, prompt];
        } catch (error) {
            logger.error('Error fetching prompt', error);
            return [error, null];
        }
    }
}
