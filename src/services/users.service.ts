import { User } from '../models/User';
import logger from '../utils/logger';
import * as https from 'https';
import jwt from 'jsonwebtoken';

export class UserService {

    constructor() { }

    async createUser(userDetails: User): Promise<[null | any, User | null]> {
        try {
            const user = userDetails as any;
            const savedUser = await User.create(user);
            return [null, savedUser];
        } catch (error) {
            logger.error('Error', error);
            return [error, null];
        }
    }

    async samvidaLogin(username: string, password: string): Promise<[null | any, { user: User, token: string } | null]> {
        try {
            const postData = JSON.stringify({ username, password });
            const url = new URL('https://www.samvidalaw.com/wp-json/jwt-auth/v1/token');

            const responseBody: any = await new Promise((resolve, reject) => {
                const reqOptions = {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(postData),
                    }
                } as any;

                const request = https.request(url, reqOptions, (resp) => {
                    let data = '';
                    resp.on('data', (chunk) => { data += chunk; });
                    resp.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(parsed);
                        } catch (err) {
                            reject(err);
                        }
                    });
                });

                request.on('error', (err) => reject(err));
                request.write(postData);
                request.end();
            });

            const samvidaToken = responseBody?.token || responseBody?.data?.token || responseBody?.auth_token || null;
            const email = responseBody?.user_email || responseBody?.data?.user_email || responseBody?.user?.email || responseBody?.data?.email || null;
            const user_nicename = responseBody?.user_nicename || responseBody?.data?.user_nicename || null;
            const user_display_name = responseBody?.user_display_name || responseBody?.data?.user_display_name || responseBody?.user?.name || responseBody?.data?.name || username;
            const externalRoles = responseBody?.roles || responseBody?.data?.roles || null;

            if (!email) {
                return [{ message: 'Email not returned from samvida provider' }, null];
            }

            let user = await User.findOne({ where: { email } });
            if (user) {
                user.samvida_token = samvidaToken;
                user.user_nicename = user_nicename;
                user.user_display_name = user_display_name;
                user.roles = externalRoles;
                await user.save();
                const ourToken = jwt.sign({ id: user.id, email: user.email, role: user.roles }, process.env.JWT_SECRET || 'check', { expiresIn: '7d' });
                return [null, { user, token: ourToken }];
            }

            const newUser: any = { name: user_display_name, email, samvida_token: samvidaToken, user_nicename, user_display_name, external_roles: externalRoles ? JSON.stringify(externalRoles) : null, roles: externalRoles };
            const savedUser = await User.create(newUser);
            const ourToken = jwt.sign({ id: (savedUser as User).id, email: (savedUser as User).email, role: externalRoles }, process.env.JWT_SECRET || 'check', { expiresIn: '7d' });
            return [null, { user: savedUser, token: ourToken }];
        } catch (error) {
            logger.error('Samvida login error', error);
            return [error, null];
        }
    }

    async updateUser(userId: string, userDetails: User): Promise<[null | any, User | null]> {
        try {
            const { name, email } = userDetails as any;
            const [error, user] = await this.getUserById(userId);
            if (user) {
                user.name = name;
                user.email = email;
                const updatedUser = await user.save();
                return [null, updatedUser]
            }
            return [error, null]
        } catch (error) {
            logger.error('Error', error);
            return [error, null]
        }
    }

    async deleteUser(userId: string): Promise<[null | any, boolean | null]> {
        try {
            const [error, user] = await this.getUserById(userId);
            if (user) {
                await user.destroy();
                return [null, true];
            }
            return [error, null];
        } catch (error) {
            logger.error('Error', error);
            return [error, null];
        }
    }

    async getUsers(filter?: Object): Promise<[null | any, Array<User> | null]> {
        try {
            let filters = {};
            if (filter) {
                filters = { ...filter };
            }
            const users = await User.findAll(filters);
            if (!users || users.length === 0) {
                return [null, []];
            }
            return [null, users];
        } catch (error) {
            logger.error('Error', error);
            return [error, null];
        }
    }

    async getUserById(userId: string): Promise<[null | any, User | null]> {
        try {
            const user = await User.findByPk(userId);
            return [null, user];
        } catch (error) {
            logger.error('Error', error);
            return [error, null];
        }
    }
}
