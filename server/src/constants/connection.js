// No frame at all for this long means a half-open socket: TCP still looks
// alive but nothing is flowing. Force a reconnect instead of going dark.
export const STALE_MS = 90_000;

export const BACKOFF_BASE_MS = 1_000;
export const MAX_BACKOFF_MS = 30_000;
