import app from './server';
import config, { validateEnv } from './config/config';
import { mongoConnect } from './config/db.mongo';
import queueService from './services/queue.service';
import emailWorker from './workers/email.worker';
import zkEmailWorker from './workers/zkemail.worker';
import paymentWorker from './workers/payment.worker';
import reconciliationWorker from './workers/reconciliation.worker';
import retentionWorker, {
  initializeRetentionWorker,
} from './workers/retention.worker';
import indexerWorker from './workers/indexer.worker';
import waitlistWorker from './workers/waitlist.worker';
import anonymizationWorker, {
  initializeAnonymizationWorker,
} from './workers/anonymization.worker';
import logger from './utils/logger';

async function startServer() {
  try {
    // Validate required environment variables
    validateEnv();

    // Connect to MongoDB
    await mongoConnect();
    logger.info('âœ“ MongoDB connected');

    // Initialize queue service
    await queueService.initialize();
    logger.info('âœ“ Queue service initialized');

    // Initialize email worker
    await emailWorker.initialize();
    logger.info('âœ“ Email worker initialized');

    // Initialize zkEmail worker
    await zkEmailWorker.initialize();
    logger.info('âœ“ zkEmail worker initialized');

    // Initialize indexer worker
    await indexerWorker.initialize();
    logger.info('âœ“ Indexer worker initialized');

    // Payment worker (processes webhook events via state machine)
    logger.info('âœ“ Payment worker initialized');

    // Reconciliation worker (periodic stale-tx cleanup via state machine)
    logger.info('âœ“ Reconciliation worker initialized');

    // Retention worker (TTL hygiene + anonymization job retries)
    await initializeRetentionWorker();
    logger.info('âœ“ Retention worker initialized');

    await waitlistWorker.initialize();
    logger.info('Waitlist worker initialized');

    // Anonymization worker (post-event PII redaction)
    await initializeAnonymizationWorker();
    logger.info('Anonymization worker initialized');

    // Start Express server
    const server = app.listen(config.port, () => {
      logger.info(`âœ“ Server running on port ${config.port}`);
    });

    server.on('error', (error) => {
      logger.error('Failed to start server:', error);
      void closeAllServices().finally(() => process.exit(1));
    });

    const closeAllServices = async () => {
      const services: Array<[string, () => Promise<void>]> = [
        ['emailWorker', () => emailWorker.close()],
        ['zkEmailWorker', () => zkEmailWorker.close()],
        ['paymentWorker', () => paymentWorker.close()],
        ['reconciliationWorker', () => reconciliationWorker.close()],
        ['waitlistWorker', () => waitlistWorker.close()],
        ['anonymizationWorker', () => anonymizationWorker.close()],
        ['retentionWorker', () => retentionWorker.close()],
        ['indexerWorker', () => Promise.resolve(indexerWorker.stop())],
        ['queueService', () => queueService.close()],
      ];

      let hadError = false;
      for (const [name, close] of services) {
        try {
          await close();
        } catch (error) {
          hadError = true;
          logger.error(`Failed to close ${name}:`, error);
        }
      }
      return hadError;
    };

    // Graceful shutdown
    const gracefulShutdown = async () => {
      logger.info('\nðŸ›‘ Shutting down gracefully...');
      server.close(async () => {
        logger.info('Express server stopped');
        const hadError = await closeAllServices();
        logger.info(
          hadError ? 'Some services failed to close' : 'All services closed',
        );
        process.exit(hadError ? 1 : 0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
