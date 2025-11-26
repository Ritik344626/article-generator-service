'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('generation_jobs', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      uuid: {
        type: Sequelize.STRING(36),
        allowNull: false,
        unique: true,
      },
      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
      },
      pdf_url: {
        type: Sequelize.STRING(500),
        allowNull: false,
      },
      pdf_storage_path: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      prompt_template_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
      },
      prompt_category: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      custom_prompt: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      prompt_merged: {
        type: Sequelize.TEXT('long'),
        allowNull: true,
      },
      ai_enhancement: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      provider: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: 'openai',
      },
      provider_api_key_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
      },
      model_name: {
        type: Sequelize.STRING,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('pending', 'processing', 'completed', 'failed', 'cancelled'),
        allowNull: false,
        defaultValue: 'pending',
      },
      progress: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      result_article_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: true,
      },
      result_preview: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      error: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      attempts: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      publish_to_wp: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      wp_config: {
        type: Sequelize.JSON,
        allowNull: true,
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      finished_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
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

    await queryInterface.addIndex('generation_jobs', ['uuid']);
    await queryInterface.addIndex('generation_jobs', ['user_id']);
    await queryInterface.addIndex('generation_jobs', ['status']);
    await queryInterface.addIndex('generation_jobs', ['provider']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('generation_jobs');
  }
};
