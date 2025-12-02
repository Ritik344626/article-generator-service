"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("api_keys", "credits_monthly_limit_usd", {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
      defaultValue: 100.0,
      comment: "Configured monthly credit limit in USD for this key",
    });
    await queryInterface.addColumn("api_keys", "credits_used_usd_month", {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0.0,
      comment: "Total used USD within current month window for this key",
    });
    await queryInterface.addColumn("api_keys", "credits_remaining_usd_month", {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 100.0,
      comment: "Remaining USD within current month window for this key",
    });
    await queryInterface.addColumn("api_keys", "credits_month_start", {
      type: Sequelize.DATE,
      allowNull: true,
      comment: "Start timestamp of current monthly window",
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn("api_keys", "credits_monthly_limit_usd");
    await queryInterface.removeColumn("api_keys", "credits_used_usd_month");
    await queryInterface.removeColumn("api_keys", "credits_remaining_usd_month");
    await queryInterface.removeColumn("api_keys", "credits_month_start");
  },
};
