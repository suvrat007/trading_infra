/** Parse a WebSocket frame, returning null instead of throwing on garbage. */
export function parseJsonFrame(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
