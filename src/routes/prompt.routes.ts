import { Router } from "express";
import { PromptController } from "../controllers/prompt.controller";
import { body } from "express-validator";
import passport from "passport";

const validatePromptCreate = [
    body('prompt_text').notEmpty().isString().withMessage('Prompt text is required'),
    body('category').optional().isString(),
];

const validatePromptUpdate = [
    body('prompt_text').optional().notEmpty().isString(),
    body('category').optional().isString(),
];

const promptRouter = Router();
const promptController = new PromptController();

promptRouter.use(passport.authenticate('jwt', { session: false }));

promptRouter.post('/', validatePromptCreate, promptController.createPrompt.bind(promptController));

promptRouter.get('/', promptController.getPrompts.bind(promptController));

promptRouter.get('/:promptId', promptController.getPromptById.bind(promptController));

promptRouter.put('/:promptId', validatePromptUpdate, promptController.updatePrompt.bind(promptController));

promptRouter.delete('/:promptId', promptController.deletePrompt.bind(promptController));

export default promptRouter;
