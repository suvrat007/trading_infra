import { ALLOWED_ORIGINS } from '../../constants/http.js';
import { LOG_WS } from '../../constants/logging.js';
import { WS_CLOSE_CODE, WS_MAX_BUFFERED_BYTES } from '../../constants/websocket.js';

/**
 * Origin is a browser guarantee, not a security boundary — it stops a random
 * web page from opening this socket, nothing more. Non-browser clients
 * (scripts, tests, the C++ engine later) send no Origin header at all.
 */
export function isOriginAllowed(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

/**
 * Send one already-serialized payload to one client.
 * Returns false if the client was skipped or dropped.
 */
export function sendToClient(client, payload) {
  if (client.readyState !== client.OPEN) return false;

  // bufferedAmount is what ws has accepted but not yet flushed to the socket.
  // If it is climbing, this client's network is slower than our publish rate;
  // queueing more only grows server memory and never catches up.
  if (client.bufferedAmount > WS_MAX_BUFFERED_BYTES) {
    console.warn(`${LOG_WS} dropping slow client (buffered ${client.bufferedAmount} bytes)`);
    client.close(WS_CLOSE_CODE.TRY_AGAIN_LATER, 'Client too slow');
    return false;
  }

  client.send(payload);
  return true;
}

/**
 * Fan a message out to every client, returning the delivered count.
 * The payload is stringified ONCE and the same buffer is handed to all N
 * clients. Stringifying per client would repeat identical work N times on the
 * hot path — the single cheapest win in a broadcast server.
 */
export function broadcastToClients(clients, message) {
  const payload = JSON.stringify(message);
  let delivered = 0;

  for (const client of clients) {
    if (sendToClient(client, payload)) delivered += 1;
  }

  return delivered;
}

/**
 * One liveness round. Marks every client dead and pings; a live client answers
 * with a pong (handled by the protocol, no app code) and flips the flag back.
 * Anything still marked dead here never answered, so the socket is gone even
 * though no close frame ever arrived.
 */
export function sweepDeadClients(clients) {
  let terminated = 0;

  for (const client of clients) {
    if (client.isAlive === false) {
      console.warn(`${LOG_WS} client failed heartbeat — terminating`);
      client.terminate(); // no close handshake: the peer is already gone
      terminated += 1;
      continue;
    }
    client.isAlive = false;
    client.ping();
  }

  return terminated;
}

export function closeAllClients(clients, code, reason) {
  for (const client of clients) {
    client.close(code, reason);
  }
}
