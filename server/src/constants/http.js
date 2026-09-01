import './env.js';

export const PORT = Number(process.env.PORT || 4000);
export const API_PREFIX = '/api';

// Browsers refuse cross-origin reads unless the server opts in. The Vite dev
// server runs on a different port than this API, so it is cross-origin.
export const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000'
)
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Give in-flight requests a chance to finish before forcing the process down.
export const SHUTDOWN_TIMEOUT_MS = 10_000;

export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

export const ERROR_CODE = {
  INVALID_SYMBOL: 'INVALID_SYMBOL',
  INVALID_INTERVAL: 'INVALID_INTERVAL',
  INVALID_LIMIT: 'INVALID_LIMIT',
  INVALID_FLAG: 'INVALID_FLAG',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL: 'INTERNAL',
};
