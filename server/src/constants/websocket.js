import './env.js';

export const WS_PORT = Number(process.env.WS_PORT || 8080);

// How often we ping every client. A browser tab that was closed by killing the
// process, or a laptop that went to sleep, never sends a close frame — without
// this the server holds those sockets open forever and leaks memory.
export const WS_HEARTBEAT_MS = 30_000;

// A client that cannot drain 1 MB is not keeping up with a 1m candle feed.
// Dropping it protects every other client: an unbounded send queue is how one
// slow consumer turns into server-wide memory growth.
export const WS_MAX_BUFFERED_BYTES = 1_048_576;

export const WS_MESSAGE_TYPE = {
  WELCOME: 'welcome',
  CANDLE: 'candle',
};

// RFC 6455 close codes.
export const WS_CLOSE_CODE = {
  GOING_AWAY: 1001,       // server shutting down
  POLICY_VIOLATION: 1008, // origin not allowed
  TRY_AGAIN_LATER: 1013,  // dropped for backpressure
};
