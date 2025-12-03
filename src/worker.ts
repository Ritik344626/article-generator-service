#!/usr/bin/env ts-node

/**
 * Article Generation Worker Startup Script
 * 
 * This script starts the background worker that processes article generation jobs.
 * Run: npm run worker
 */

import ArticleGenerationWorker from './workers/articleWorker';
import logger from './utils/logger';
import { connectToDatabase } from './config/database';

async function startWorker() {
  try {
    // Connect to database
    await connectToDatabase();
    
    // Start worker
    const worker = new ArticleGenerationWorker();
    logger.info('Worker process started successfully');

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully');
      await worker.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down gracefully');
      await worker.close();
      process.exit(0);
    });

    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });

  } catch (error) {
    logger.error('Failed to start worker:', error);
    process.exit(1);
  }
}

startWorker();
