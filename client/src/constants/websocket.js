export const WS_URL = import.meta.env?.VITE_WS_URL || 'ws://localhost:8080';

export const WS_MESSAGE_TYPE = {
  WELCOME: 'welcome',
  CANDLE: 'candle',
};

// Mirrors the server's backoff: exponential, jittered, capped.
export const WS_BACKOFF_BASE_MS = 1_000;
export const WS_MAX_BACKOFF_MS = 30_000;

export const CONNECTION_STATUS = {
  CONNECTING: 'connecting',
  LIVE: 'live',
  RECONNECTING: 'reconnecting',
  OFFLINE: 'offline',
};
