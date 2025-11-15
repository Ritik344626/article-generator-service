import { DataTypes, Model } from "sequelize";
import { sequelize } from "../config/database";

interface PromptAttributes {
    id: number;
    prompt_text: string;
    category?: string | null;
    created_by: number;
    createdAt?: Date;
    updatedAt?: Date;
}

class Prompt extends Model<PromptAttributes> implements PromptAttributes {
    public id!: number;
    public prompt_text!: string;
    public category!: string | null;
    public created_by!: number;
    public readonly createdAt?: Date;
    public readonly updatedAt?: Date;
}

Prompt.init(
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            autoIncrement: true,
            primaryKey: true,
        },
        prompt_text: { type: DataTypes.TEXT('long'), allowNull: false },
        category: { type: DataTypes.STRING, allowNull: true },
        created_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
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
        modelName: 'Prompt',
        tableName: 'prompts',
    }
);

export { Prompt };
