import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const modelName = process.argv[2];
const attributesArg = process.argv[3];

if (!modelName || !attributesArg) {
  console.error('Usage: npm run generate:model <ModelName> <attributes>');
  process.exit(1);
}

const attributes = attributesArg.split(',').map(attr => {
  const [name, type] = attr.split(':');
  return { name, type };
});

// Model content
const modelContent = `
import { DataTypes, Model } from "sequelize";
import { sequelize } from "./database";

interface ${modelName}Attributes {
    id: number;
    ${attributes.map(attr => `${attr.name}: ${attr.type};`).join('\n    ')}
    createdAt?: Date;
    updatedAt?: Date;
}

class ${modelName} extends Model<${modelName}Attributes> implements ${modelName}Attributes {
    public id!: number;
    ${attributes.map(attr => `public ${attr.name}!: ${attr.type};`).join('\n    ')}
    public readonly createdAt?: Date;
    public readonly updatedAt?: Date;
}

${modelName}.init(
    {
        id: {
            type: DataTypes.INTEGER.UNSIGNED,
            autoIncrement: true,
            primaryKey: true,
        },
        ${attributes.map(attr => {
          if (attr.type === 'UserRole' || attr.type === 'Gender') {
            return `${attr.name}: { type: DataTypes.ENUM(...Object.values(${attr.type})), allowNull: false },`;
          }
          return `${attr.name}: { type: DataTypes.${attr.type.toUpperCase()}, allowNull: false },`;
        }).join('\n        ')}
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
        modelName: '${modelName}',
        tableName: '${modelName.toLowerCase()}s',
    }
);

export { ${modelName} };
`;

// Write model file
const modelFilePath = join(__dirname, '../src/models', `${modelName}.ts`);
writeFileSync(modelFilePath, modelContent.trim(), { encoding: 'utf8' });

// Migration content
const migrationContent = `
'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('${modelName.toLowerCase()}s', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      ${attributes.map(attr => {
        if (attr.type === 'UserRole' || attr.type === 'Gender') {
          return `${attr.name}: { type: Sequelize.ENUM(...Object.values(${attr.type})), allowNull: false },`;
        }
        return `${attr.name}: { type: Sequelize.${attr.type.toUpperCase()}, allowNull: false },`;
      }).join('\n      ')}
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('${modelName.toLowerCase()}s');
  }
};
`;

// Check if migrations folder exists, create if not
const migrationsDir = join(__dirname, '../migrations');
if (!existsSync(migrationsDir)) {
  mkdirSync(migrationsDir, { recursive: true });
}

// Generate a unique migration file path
const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
let migrationFilePath = join(migrationsDir, `${timestamp}-create-${modelName.toLowerCase()}.js`);
let counter = 1;
while (existsSync(migrationFilePath)) {
  migrationFilePath = join(migrationsDir, `${timestamp}-create-${modelName.toLowerCase()}-${counter}.js`);
  counter++;
}

// Write migration file
writeFileSync(migrationFilePath, migrationContent.trim(), { encoding: 'utf8' });

console.log(`Model ${modelName} generated successfully at ${modelFilePath}`);
console.log(`Migration for ${modelName} generated successfully at ${migrationFilePath}`);
