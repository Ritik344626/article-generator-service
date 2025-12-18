import { configDotenv } from "dotenv";
import { User } from "../models/User";
import { createResponse } from "../utils/utils";
import { NextFunction, Request, Response } from "express";
import passport from 'passport';
import { ExtractJwt, Strategy as JwtStrategy, StrategyOptions } from 'passport-jwt';
configDotenv();

declare global {
    namespace Express {
        interface Request {
            user?: User;
        }
    }
}

const options: StrategyOptions = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: process.env.JWT_SECRET || '',
};

const passportConfig = (passportObj: any) => {
    passportObj.use(new JwtStrategy(options, async (jwtPayload, done) => {
        try {
            const user = await User.findByPk((jwtPayload as any).id);
            if (!user) {
                return done(null, false, { message: 'Unable to find user' });
            }
            return done(null, user);
        } catch (error) {
            console.error('Authentication error:', error);
            return done(error, false);
        }
    }));
};

// Roles are removed; this middleware verifies a user is authenticated
export const isAuthorizedRole = (_roles: Array<string>) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const roles = _roles || [];
        const user: User | undefined = req.user as User;
        if (!user) {
            return createResponse(res, { status: false, code: 403, payload: { message: 'Insufficient permission' } })
        }
        // check internal role first
        if (roles.length > 0 && !roles.includes((user as any).role)) {
            return createResponse(res, { status: false, code: 403, payload: { message: 'Insufficient permission' } })
        }
        next();
    }
}

export default passportConfig;