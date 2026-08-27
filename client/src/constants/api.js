export const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || 'http://localhost:4000';
export const CANDLES_ENDPOINT = '/api/candles';

export const DEFAULT_SYMBOL = 'BTCUSDT';
export const DEFAULT_INTERVAL = '1m';
export const DEFAULT_LIMIT = 200;

// Abort a stalled fetch rather than leaving the UI on a spinner forever.
export const FETCH_TIMEOUT_MS = 10_000;
