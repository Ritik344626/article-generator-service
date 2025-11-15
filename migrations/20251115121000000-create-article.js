'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('articles', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      title: { type: Sequelize.STRING, allowNull: false },
      content: { type: Sequelize.TEXT('long'), allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'draft' },
      author_wp_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      featured_media_wp_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      meta: { type: Sequelize.JSON, allowNull: true, defaultValue: {} },
      pdf_url: { type: Sequelize.STRING, allowNull: true },
      source_text: { type: Sequelize.TEXT('long'), allowNull: true },
      tags: { type: Sequelize.JSON, allowNull: true, defaultValue: [] },
      categories: { type: Sequelize.JSON, allowNull: true, defaultValue: [] },
      wp_post_id: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      wp_permalink: { type: Sequelize.STRING, allowNull: true },
      published_at: { type: Sequelize.DATE, allowNull: true },
      ai_model: { type: Sequelize.STRING, allowNull: true },
      ai_prompt: { type: Sequelize.TEXT('long'), allowNull: true },
      error: { type: Sequelize.JSON, allowNull: true },
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

    await queryInterface.addIndex('articles', ['status']);
    await queryInterface.addIndex('articles', ['wp_post_id']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('articles');
  }
};
