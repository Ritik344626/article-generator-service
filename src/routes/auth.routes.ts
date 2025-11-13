import { NextFunction, Request, Response, Router } from "express";
import { createResponse, formatUser } from "../utils/utils";
import { configDotenv } from "dotenv";
import { UserController } from "../controllers/user.controller";
configDotenv();

const AuthRouter = Router();
const userController = new UserController();

// POST /auth/login (Samvida)
AuthRouter.post('/login', userController.samvidaLogin.bind(userController));

export default AuthRouter;
