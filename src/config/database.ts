import { configDotenv } from "dotenv";
import logger from "../utils/logger";
import { Sequelize } from "sequelize";
configDotenv();

export const sequelize = new Sequelize({
    dialect: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '', 10) || 3306,
    database: process.env.DB_NAME || 'nodesql',
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || '',
    logging: false,
})

export const connectToDatabase = async () => {
    try {
        console.log('Connecting to database...', process.env.DB_NAME, process.env.DB_HOST, process.env.DB_USERNAME);
        await sequelize.authenticate();
        logger.info(`Connection successful and connected to db: ${sequelize.getDatabaseName()}`)

        await sequelize.sync({ force: false });
        logger.info('All models were synchronized successfully.');
    } catch (error) {
        console.error('Error in connecting to DB: ', error);
        await disconnectFromDatabase();
    }
}

export const disconnectFromDatabase = async () => {
    try {
        await sequelize.close();
        logger.debug('Disconnected from DB');
        process.exit(0);
    } catch (error) {
        logger.error('Error in disconnecting DB: ', error);
        process.exit(1);
    }
};

