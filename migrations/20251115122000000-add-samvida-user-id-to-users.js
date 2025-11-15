'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('users', 'samvida_user_id', {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      after: 'samvida_token'
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('users', 'samvida_user_id');
  }
};
