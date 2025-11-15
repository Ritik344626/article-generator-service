import { DataTypes, Model } from "sequelize";
import { sequelize } from "../config/database";

interface UserAttributes {
    id: number;
    name: string;
    email: string;
    samvida_token: string;
    samvida_user_id: number;
    user_nicename: string;
    user_display_name: string;
    roles: string[];
    createdAt?: Date;
    updatedAt?: Date;
}

class User extends Model<UserAttributes> implements UserAttributes {
    public id!: number;
    public name!: string;
    public email!: string;
    public samvida_token!: string;
    public samvida_user_id!: number;
    public user_nicename!: string;
    public user_display_name!: string;
    public roles!: string[];
    public readonly createdAt?: Date;
    public readonly updatedAt?: Date;
}

User.init(
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            autoIncrement: true,
            primaryKey: true,
        },
        name: { type: DataTypes.STRING, allowNull: false },
        email: { type: DataTypes.STRING, allowNull: false },
        samvida_token: { type: DataTypes.STRING, allowNull: false },
        samvida_user_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
        user_nicename: { type: DataTypes.STRING, allowNull: false },
        user_display_name: { type: DataTypes.STRING, allowNull: false },
        roles: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
        createdAt: {
            allowNull: false,
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
        updatedAt: {
            allowNull: false,
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    },
    {
        sequelize,
        timestamps: true,
        modelName: 'User',
        tableName: 'users',
    }
);

export { User };