import { DataTypes, Model } from 'sequelize';
import { sequelize } from '../config/database';

interface ApiKeyAttributes {
  id: number;
  provider: string;
  model_name?: string | null;
  api_key: string;
  status: string;
  usage_limit?: number | null; 
  usage_count: number;
  last_used_at?: Date | null;
  created_by: number;
  createdAt?: Date;
  updatedAt?: Date;
  credits_monthly_limit_usd?: number | null;
  credits_used_usd_month?: number;
  credits_remaining_usd_month?: number;
  credits_month_start?: Date | null;
}

class ApiKey extends Model<ApiKeyAttributes> implements ApiKeyAttributes {
  public id!: number;
  public provider!: string;
  public model_name!: string | null;
  public api_key!: string;
  public status!: string;
  public usage_limit!: number | null;
  public usage_count!: number;
  public last_used_at!: Date | null;
  public created_by!: number;
  public readonly createdAt?: Date;
  public readonly updatedAt?: Date;
  public credits_monthly_limit_usd!: number | null;
  public credits_used_usd_month!: number;
  public credits_remaining_usd_month!: number;
  public credits_month_start!: Date | null;
}

ApiKey.init({
  id: {
    type: DataTypes.INTEGER.UNSIGNED,
    autoIncrement: true,
    primaryKey: true,
  },
  provider: { type: DataTypes.STRING, allowNull: false },
  model_name: { type: DataTypes.STRING, allowNull: true },
  api_key: { type: DataTypes.TEXT, allowNull: false },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'active' },
  usage_limit: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  usage_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  last_used_at: { type: DataTypes.DATE, allowNull: true },
  created_by: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  credits_monthly_limit_usd: { type: DataTypes.DECIMAL(10, 2), allowNull: true, defaultValue: 100.0 },
  credits_used_usd_month: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0.0 },
  credits_remaining_usd_month: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 100.0 },
  credits_month_start: { type: DataTypes.DATE, allowNull: true },
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
  modelName: 'ApiKey',
  tableName: 'api_keys',
});

export { ApiKey, ApiKeyAttributes };