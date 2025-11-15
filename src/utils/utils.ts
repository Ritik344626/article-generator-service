import { configDotenv } from "dotenv";
import { Response } from "express";
import { hash } from 'bcrypt'
import logger from "./logger";
import { User } from "../models/User";
configDotenv();

interface StatusResponse {
    status: boolean;
    payload?: any;
    code?: number;
}

interface JsonFormat {
    status: boolean;
    data?: any;
    error?: any;
    message?: string;
}

export const createResponse = (res: Response, { status, code, payload }: StatusResponse) => {
    const statusCode = code ? code : (status ? 200 : 500);
    const jsonData: JsonFormat = {
        status
    }
    jsonData[status ? 'data' : 'error'] = payload
    if (!status && statusCode === 500) {
        jsonData.message = 'Internal server error';
    }
    return res.status(statusCode).json(jsonData);
}

export const hashPassword = async (plainPassword: string): Promise<string> => {
    try {
        const salt = parseInt(process.env.SALT || '', 10) || 10;
        const hashPassword = await hash(plainPassword, salt);
        return hashPassword;
    } catch (error) {
        logger.error('Password hash failed');
        throw new Error('Password hash failed');
    }
}

export const formatUser = (user: User) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    samvida_user_id: (user as any).samvida_user_id || null,
    user_nicename: (user as any).user_nicename || null,
    user_display_name: (user as any).user_display_name || null,
    roles: user.roles || [],
})