import { Request, Response } from "express";
import { validationResult } from "express-validator";
import { UserService } from "../services/users.service";
import { User } from "../models/User";
import { createResponse, formatUser } from "../utils/utils";
import { SequelizeScopeError } from "sequelize";

export class UserController {
    private userService: UserService;

    constructor() {
        this.userService = new UserService();
    }

    async samvidaLogin(req: Request, res: Response) {
        const { username, password } = req.body;
        if (!username || !password) {
            return createResponse(res, { status: false, payload: { message: 'username and password required' } });
        }
            const [err, result] = await this.userService.samvidaLogin(username, password);
            if (err) {
                return createResponse(res, { status: false, payload: err });
            }
            if (!result) {
                return createResponse(res, { status: false, payload: 'User creation failed' });
            }
            const { user, token } = result;
            const payload = formatUser(user, token);
            return createResponse(res, { status: true, payload });
    }

    async createUser(req: Request, res: Response) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return createResponse(res, { status: false, payload: errors.array() })
        }
        const userDetails = req.body as User;
        const [error, user] = await this.userService.createUser(userDetails);
        if (error) {
            return createResponse(res, { status: false, payload: error });
        }
        return createResponse(res, { status: true, payload: { user } });
    }

    async updateUser(req: Request, res: Response) {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return createResponse(res, { status: false, payload: errors.array() })
        }
        const userDetails = req.body as User;
        const [error, user] = await this.userService.updateUser(req.params.userId, userDetails);
        if (error) {
            createResponse(res, { status: false, payload: error });
        }
        return createResponse(res, { status: true, payload: { user } });
    }

    async deleteUser(req: Request, res: Response) {
        const [error, isDeleted] = await this.userService.deleteUser(req.params.userId);
        if (error) {
            return createResponse(res, { status: false, payload: error });
        }
        return createResponse(res, { status: true, payload: { isDeleted } });
    }

    async getUsers(req: Request, res: Response) {
        const [error, users] = await this.userService.getUsers();
        if (error) {
            let errors = error;
            if (error instanceof SequelizeScopeError) errors = error.message;
            return createResponse(res, { status: false, payload: errors });
        }
        return createResponse(res, { status: true, payload: users });
    }

    async getUserById(req: Request, res: Response) {
        let userId = req.params.userId;
        const authUser = req.user as User;
        // If no userId provided, default to authenticated user's id
        if (!userId && authUser) {
            userId = String(authUser.id);
        }
        const [error, user] = await this.userService.getUserById(userId);
        if (error) {
            let errors = error;
            if (error instanceof SequelizeScopeError) errors = error.message;
            return createResponse(res, { status: false, payload: errors });
        }
        return createResponse(res, { status: true, payload: user });
    }
}


