import { DataTypes, Model } from "sequelize";
import { sequelize } from "../config/database";

interface ArticleAttributes {
    id: number;
    title: string;
    content: string;
    status: string;
    author_wp_id?: number | null;
    featured_media_wp_id?: number | null;
    meta?: any;
    pdf_url?: string | null;
    source_text?: string | null;
    tags?: string[] | number[] | null;
    categories?: string[] | number[] | null;
    wp_post_id?: number | null;
    wp_permalink?: string | null;
    published_at?: Date | null;
    ai_model?: string | null;
    ai_prompt?: string | null;
    error?: any | null;
    createdAt?: Date;
    updatedAt?: Date;
}

class Article extends Model<ArticleAttributes> implements ArticleAttributes {
    public id!: number;
    public title!: string;
    public content!: string;
    public status!: string;
    public author_wp_id!: number | null;
    public featured_media_wp_id!: number | null;
    public meta!: any;
    public pdf_url!: string | null;
    public source_text!: string | null;
    public tags!: string[] | number[] | null;
    public categories!: string[] | number[] | null;
    public wp_post_id!: number | null;
    public wp_permalink!: string | null;
    public published_at!: Date | null;
    public ai_model!: string | null;
    public ai_prompt!: string | null;
    public error!: any | null;
    public readonly createdAt?: Date;
    public readonly updatedAt?: Date;
}

Article.init(
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            autoIncrement: true,
            primaryKey: true,
        },
        title: { type: DataTypes.STRING, allowNull: false },
        content: { type: DataTypes.TEXT('long'), allowNull: false },
        status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'draft' },
        author_wp_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        featured_media_wp_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        meta: { type: DataTypes.JSON, allowNull: true, defaultValue: {} },
        pdf_url: { type: DataTypes.STRING, allowNull: true },
        source_text: { type: DataTypes.TEXT('long'), allowNull: true },
        tags: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
        categories: { type: DataTypes.JSON, allowNull: true, defaultValue: [] },
        wp_post_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        wp_permalink: { type: DataTypes.STRING, allowNull: true },
        published_at: { type: DataTypes.DATE, allowNull: true },
        ai_model: { type: DataTypes.STRING, allowNull: true },
        ai_prompt: { type: DataTypes.TEXT('long'), allowNull: true },
        error: { type: DataTypes.JSON, allowNull: true },
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
        modelName: 'Article',
        tableName: 'articles',
    }
);

export { Article };
