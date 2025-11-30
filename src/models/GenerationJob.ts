import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

interface GenerationJobAttributes {
  id: number;
  uuid: string;
  user_id: number;
  pdf_url: string;
  prompt_template_id?: number | null;
  prompt_category?: string | null;
  custom_prompt?: string | null;
  prompt_merged?: string | null;
  ai_enhancement: boolean;
  provider: string;
  provider_api_key_id?: number | null;
  model_name?: string | null;
  status: JobStatus;
  progress: number;
  result_article_id?: number | null;
  result_preview?: string | null;
  error?: any | null;
  attempts: number;
  publish_to_wp: boolean;
  wp_config?: any | null;
  generate_hindi_article: boolean;
  started_at?: Date | null;
  finished_at?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

class GenerationJob extends Model<GenerationJobAttributes> implements GenerationJobAttributes {
  public id!: number;
  public uuid!: string;
  public user_id!: number;
  public pdf_url!: string;
  public pdf_storage_path!: string | null;
  public prompt_template_id!: number | null;
  public prompt_category!: string | null;
  public custom_prompt!: string | null;
  public prompt_merged!: string | null;
  public ai_enhancement!: boolean;
  public provider!: string;
  public provider_api_key_id!: number | null;
  public model_name!: string | null;
  public status!: JobStatus;
  public progress!: number;
  public result_article_id!: number | null;
  public result_preview!: string | null;
  public error!: any | null;
  public attempts!: number;
  public publish_to_wp!: boolean;
  public wp_config!: any | null;
  public generate_hindi_article!: boolean;
  public started_at!: Date | null;
  public finished_at!: Date | null;
  public readonly createdAt?: Date;
  public readonly updatedAt?: Date;
}

GenerationJob.init({
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  uuid: {
    type: DataTypes.STRING(36),
    allowNull: false,
    unique: true,
  },
  user_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
  },
  pdf_url: {
    type: DataTypes.STRING(500),
    allowNull: false,
  },
  prompt_template_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
  },
  prompt_category: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  custom_prompt: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  prompt_merged: {
    type: DataTypes.TEXT('long'),
    allowNull: true,
  },
  ai_enhancement: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
  },
  provider: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: 'openai',
  },
  provider_api_key_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
  },
  model_name: {
    type: DataTypes.STRING,
    allowNull: true,
  },
  status: {
    type: DataTypes.ENUM(...Object.values(JobStatus)),
    allowNull: false,
    defaultValue: JobStatus.PENDING,
  },
  progress: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  result_article_id: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: true,
  },
  result_preview: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  error: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  attempts: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0,
  },
  publish_to_wp: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  generate_hindi_article: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  },
  wp_config: {
    type: DataTypes.JSON,
    allowNull: true,
  },
  started_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
  finished_at: {
    type: DataTypes.DATE,
    allowNull: true,
  },
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
}, {
  sequelize,
  timestamps: true,
  modelName: 'GenerationJob',
  tableName: 'generation_jobs',
});

export { GenerationJob };
