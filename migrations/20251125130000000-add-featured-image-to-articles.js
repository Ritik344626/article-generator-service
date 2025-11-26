'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('articles', 'featured_image_url', {
      type: Sequelize.STRING(1000),
      allowNull: true,
    });
  },

  down: async (queryInterface) => {
    await queryInterface.removeColumn('articles', 'featured_image_url');
  },
};
