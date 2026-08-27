import './env.js';

export const SYMBOL = (process.env.SYMBOL || 'BTCUSDT').toUpperCase();
export const INTERVAL = process.env.INTERVAL || '1m';

export const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/ws';
export const KLINE_STREAM_URL =
  `${BINANCE_WS_BASE}/${SYMBOL.toLowerCase()}@kline_${INTERVAL}`;
