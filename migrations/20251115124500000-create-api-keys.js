'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable('api_keys', {
      id: {
        type: Sequelize.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true,
      },
      provider: { type: Sequelize.STRING, allowNull: false },
      model_name: { type: Sequelize.STRING, allowNull: true },
      api_key: { type: Sequelize.TEXT, allowNull: false },
      status: { type: Sequelize.STRING, allowNull: false, defaultValue: 'active' },
      usage_limit: { type: Sequelize.INTEGER.UNSIGNED, allowNull: true },
      usage_count: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      last_used_at: { type: Sequelize.DATE, allowNull: true },
      created_by: { type: Sequelize.INTEGER.UNSIGNED, allowNull: false },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.NOW },
      updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.NOW },
    });

    await queryInterface.addIndex('api_keys', ['provider']);
    await queryInterface.addIndex('api_keys', ['created_by']);
    await queryInterface.addIndex('api_keys', ['status']);
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.dropTable('api_keys');
  }
};
