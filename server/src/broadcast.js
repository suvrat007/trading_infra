import { WebSocketServer } from 'ws';
import { INTERVAL, SYMBOL } from './constants/binance.js';
import { LOG_WS } from './constants/logging.js';
import { WS_CLOSE_CODE, WS_HEARTBEAT_MS, WS_PORT } from './constants/websocket.js';
import {
  broadcastToClients,
  closeAllClients,
  isOriginAllowed,
  sweepDeadClients,
} from './utils/broadcast/client.js';
import { buildCandleMessage, buildWelcomeMessage } from './utils/broadcast/message.js';

let wss = null;
let heartbeatTimer = null;
let unsubscribe = null;

function handleConnection(ws, req) {
  const { origin } = req.headers;

  if (!isOriginAllowed(origin)) {
    console.warn(`${LOG_WS} rejected connection from origin ${origin}`);
    ws.close(WS_CLOSE_CODE.POLICY_VIOLATION, 'Origin not allowed');
    return;
  }

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // A client error (reset connection) must not become an unhandled 'error'
  ws.on('error', (err) => console.error(`${LOG_WS} client error:`, err.message));

  ws.on('close', () => {
    const remaining = wss ? Math.max(wss.clients.size - 1, 0) : 0;
    console.log(`${LOG_WS} client disconnected (${remaining} remaining)`);
  });

  ws.send(JSON.stringify(buildWelcomeMessage({ symbol: SYMBOL, interval: INTERVAL })));
  console.log(`${LOG_WS} client connected (${wss.clients.size} total)`);
}

function startHeartbeat() {
  heartbeatTimer = setInterval(() => sweepDeadClients(wss.clients), WS_HEARTBEAT_MS);
  heartbeatTimer.unref();
}


export function startBroadcast(source) {
  wss = new WebSocketServer({ port: WS_PORT });

  wss.on('listening', () => {
    console.log(`${LOG_WS} broadcast server listening on ws://localhost:${WS_PORT}`);
  });
  wss.on('connection', handleConnection);
  wss.on('error', (err) => console.error(`${LOG_WS} server error:`, err.message));

  const onCandle = (candle) => {
    const delivered = broadcastToClients(wss.clients, buildCandleMessage(candle));
    if (delivered > 0) {
      console.log(`${LOG_WS} broadcast candle ${candle.open_time} to ${delivered} client(s)`);
    }
  };

  source.on('candle', onCandle);
  unsubscribe = () => source.off('candle', onCandle);

  startHeartbeat();
  return wss;
}

export async function stopBroadcast() {
  clearInterval(heartbeatTimer);
  unsubscribe?.();

  if (!wss) return;

  // reconnect logic can back off instead of retrying instantly.
  closeAllClients(wss.clients, WS_CLOSE_CODE.GOING_AWAY, 'Server shutting down');

  await new Promise((resolve) => wss.close(resolve));
  wss = null;
}
