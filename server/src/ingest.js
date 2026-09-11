import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { pool } from './db.js';
import { KLINE_STREAMS, KLINE_STREAM_URL, SYMBOL } from './constants/binance.js';
import { ACTIVE_TIMEFRAMES } from './constants/timeframes.js';
import { STALE_MS } from './constants/connection.js';
import { SQL_INSERT_CANDLE } from './constants/sql.js';
import { LOG_INGEST } from './constants/logging.js';
import { pruneSeries } from './retention.js';
import { backoffDelay } from './utils/ingest/backoff.js';
import { parseJsonFrame } from './utils/ingest/frame.js';
import { isClosedKline, klineToCandle, klineToRow, klineToTick } from './utils/ingest/kline.js';
import { formatCandleLog, formatDuplicateLog } from './utils/ingest/logFormat.js';

// Anything downstream subscribes here instead of reaching into this module.
// One producer, N consumers, no coupling.
export const candles = new EventEmitter();  

let ws = null;
let attempt = 0;
let staleTimer = null;
let stopped = false;
let onConnect = null;

const armStaleTimer = () => {
  clearTimeout(staleTimer);
  staleTimer = setTimeout(() => {
    console.warn(`${LOG_INGEST} no data for ${STALE_MS / 1000}s — forcing reconnect`);
    ws?.terminate(); // terminate, not close: don't wait for a dead peer's FIN
  }, STALE_MS);
};

const persist = async (k) => {
  const res = await pool.query(SQL_INSERT_CANDLE, klineToRow(k));

  if (res.rowCount === 0) {
    console.log(`${LOG_INGEST} ${formatDuplicateLog(k)}`);
    return null;
  }

  // One in, one out. Wrapped separately so a prune failure can never cost us
  // the candle we just stored.
  try {
    await pruneSeries(k.s, k.i);
  } catch (err) {
    console.error(`${LOG_INGEST} prune failed:`, err.message);
  }

  const candle = klineToCandle(k, res.rows[0].id);
  console.log(`${LOG_INGEST} ${formatCandleLog(candle)}`);
  return candle;
};

const connect = () => {
  if (stopped) return;

  console.log(`${LOG_INGEST} connecting -> ${KLINE_STREAM_URL}`);
  ws = new WebSocket(KLINE_STREAM_URL);

  ws.on('open', () => {
    attempt = 0;
    console.log(
      `${LOG_INGEST} connected, streaming ${SYMBOL} ` +
      `[${ACTIVE_TIMEFRAMES.join(', ')}] on ${KLINE_STREAMS.length} stream(s)`
    );
    armStaleTimer();

    // Fires on the FIRST connection and on every reconnect, so startup recovery
    // and outage recovery are the same code path. Deliberately not awaited: a
    // slow backfill must not delay processing of live candles arriving now.
    // With several timeframes this now repairs all of them.
    Promise.resolve(onConnect?.()).catch((err) =>
      console.error(`${LOG_INGEST} onConnect handler failed:`, err.message)
    );
  });

  ws.on('message', async (raw) => {
    armStaleTimer();

    const frame = parseJsonFrame(raw);
    if (!frame) {
      console.error(`${LOG_INGEST} non-JSON frame ignored`);
      return;
    }

    // Combined streams wrap every event as {stream, data}; a single-stream URL
    // sends the event bare. Accept both, so the endpoint can change without
    // touching anything below this line.
    const msg = frame.data ?? frame;
    if (!msg.k) return; // not a kline event

    // Forming bar: broadcast so the chart ticks live, but never store it and
    // never let it reach the strategy — it can still reverse before it closes.
    if (!isClosedKline(msg)) {
      candles.emit('tick', klineToTick(msg.k));
      return;
    }

    try {
      const candle = await persist(msg.k);
      if (candle) candles.emit('candle', candle);
    } catch (err) {
      // Never let a DB failure take down the socket. Losing one candle beats
      // losing the stream; the backfill on the next reconnect repairs the gap.
      console.error(`${LOG_INGEST} insert failed:`, err.message);
    }
  });

  ws.on('error', (err) => console.error(`${LOG_INGEST} socket error:`, err.message));

  ws.on('close', (code, reason) => {
    clearTimeout(staleTimer);
    if (stopped) return;

    const delay = backoffDelay(attempt);
    attempt += 1;

    console.warn(
      `${LOG_INGEST} closed (${code}${reason?.length ? ` ${reason}` : ''}) — ` +
      `reconnecting in ${delay}ms (attempt ${attempt})`
    );
    setTimeout(connect, delay);
  });
};

/**
 * @param {object}   [options]
 * @param {Function} [options.onConnect] called on every successful connection,
 *   first included. Used to trigger gap recovery.
 */
export const startIngest = ({ onConnect: handler = null } = {}) => {
  stopped = false;
  onConnect = handler;
  connect();
};

export const stopIngest = () => {
  stopped = true;
  onConnect = null;
  clearTimeout(staleTimer);
  ws?.close();
};
