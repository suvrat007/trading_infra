import express from 'express';
import { API_PREFIX } from './constants/http.js';
import { cors } from './middleware/cors.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { auditRouter } from './routes/audit.js';
import { candlesRouter } from './routes/candles.js';
import { healthRouter } from './routes/health.js';

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by'); // do not advertise the stack

  app.use(requestLogger);
  app.use(cors);

  app.use(API_PREFIX, healthRouter);
  app.use(API_PREFIX, candlesRouter);
  app.use(API_PREFIX, auditRouter);

  // Order matters: these must be registered last.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
