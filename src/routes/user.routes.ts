import { Router } from "express";
import { UserController } from "../controllers/user.controller";
import { ValidationChain, body } from "express-validator";
import passport from "passport";
import { isAuthorizedRole } from "../middlewares/passport.config";

const validateUserDetails = [
    body('email').notEmpty().isEmail(),
    body('name').optional().notEmpty().isString(),
];

const validateUpdateUserDetails: ValidationChain[] = [
    body('email').optional().notEmpty().isEmail(),
    body('name').optional().notEmpty().isString(),
];

const userRouter = Router();
const userController = new UserController();

userRouter.post('/', validateUserDetails, userController.createUser.bind(userController));
userRouter.get('/', passport.authenticate('jwt', { session: false }), isAuthorizedRole(['user']), userController.getUsers.bind(userController));
userRouter.put('/user/:userId?', passport.authenticate('jwt', { session: false }), isAuthorizedRole(['user']), validateUpdateUserDetails, userController.updateUser.bind(userController));
userRouter.get('/user/:userId?', passport.authenticate('jwt', { session: false }), isAuthorizedRole(['user']), userController.getUserById.bind(userController));
userRouter.delete('/user/:userId?', passport.authenticate('jwt', { session: false }), isAuthorizedRole(['user']), userController.deleteUser.bind(userController));

export default userRouter;