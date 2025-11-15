'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('prompts', 'title');
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('prompts', 'title', {
      type: Sequelize.STRING,
      allowNull: false,
      after: 'id'
    });
  }
};
