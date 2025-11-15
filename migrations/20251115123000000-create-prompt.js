'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('prompts', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      title: { type: Sequelize.STRING, allowNull: false },
      prompt_text: { type: Sequelize.TEXT('long'), allowNull: false },
      category: { type: Sequelize.STRING, allowNull: true },
      created_by: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
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

    await queryInterface.addIndex('prompts', ['created_by']);
    await queryInterface.addIndex('prompts', ['category']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('prompts');
  }
};
