import { Router } from 'express';
import passport from 'passport';
import ArticleController from '../controllers/article.controller';

const articleRouter = Router();
const controller = new ArticleController();

articleRouter.use(passport.authenticate('jwt', { session: false }));

articleRouter.get('/stats', controller.getStats.bind(controller));
articleRouter.get('/:id', controller.getById.bind(controller));
articleRouter.get('/', controller.list.bind(controller));

export default articleRouter;