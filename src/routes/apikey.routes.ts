import { Router } from 'express';
import passport from 'passport';
import { body } from 'express-validator';
import { ApiKeyController } from '../controllers/apikey.controller';

const apiKeyRouter = Router();
const controller = new ApiKeyController();

const validateCreate = [
  body('provider').notEmpty().isString(),
  body('api_key').notEmpty().isString(),
  body('model_name').optional().isString(),
  body('status').optional().isString(),
  body('usage_limit').optional().isInt({ min: 1 }),
];

const validateUpdate = [
  body('provider').optional().notEmpty().isString(),
  body('api_key').optional().notEmpty().isString(),
  body('model_name').optional().isString(),
  body('status').optional().isString(),
  body('usage_limit').optional().isInt({ min: 1 }),
];

apiKeyRouter.use(passport.authenticate('jwt', { session: false }));

apiKeyRouter.post('/', validateCreate, controller.createKey.bind(controller));
apiKeyRouter.get('/', controller.listKeys.bind(controller));
apiKeyRouter.get('/:keyId', controller.getKey.bind(controller));
apiKeyRouter.put('/:keyId', validateUpdate, controller.updateKey.bind(controller));
apiKeyRouter.delete('/:keyId', controller.deleteKey.bind(controller));

export default apiKeyRouter;
