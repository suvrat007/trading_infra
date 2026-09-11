import express from 'express';
import { API_PREFIX } from './constants/http.js';
import { cors } from './middleware/cors.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { accountRouter } from './routes/account.js';
import { auditRouter } from './routes/audit.js';
import { candlesRouter } from './routes/candles.js';
import { strategyRouter } from './routes/strategy.js';
import { timeframesRouter } from './routes/timeframes.js';
import { healthRouter } from './routes/health.js';

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by'); // do not advertise the stack

  // POST bodies are small config objects; cap the size so a bad client
  // cannot buffer megabytes into memory.
  app.use(express.json({ limit: '16kb' }));
  app.use(requestLogger);
  app.use(cors);

  app.use(API_PREFIX, healthRouter);
  app.use(API_PREFIX, candlesRouter);
  app.use(API_PREFIX, auditRouter);
  app.use(API_PREFIX, accountRouter);
  app.use(API_PREFIX, strategyRouter);
  app.use(API_PREFIX, timeframesRouter);

  // Order matters: these must be registered last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
