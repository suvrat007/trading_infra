import { ENGINE_ACTION } from '../../constants/engine.js';

/**
 * Unix epoch MICROSECONDS.
 *
 * Date.now() is milliseconds, which is far too coarse: the engine answers in
 * ~14us, so a millisecond clock would report every round trip as 0 or 1.
 * performance.timeOrigin is the process start as a Unix epoch millisecond
 * float, and performance.now() adds sub-millisecond monotonic time since then —
 * so the sum is wall-clock time at microsecond resolution.
 *
 * It matters that this is wall clock and not a monotonic counter: the C++ side
 * reads std::chrono::system_clock, and two processes can only compare
 * timestamps that share an origin. process.hrtime.bigint() would be more
 * precise and completely incomparable across processes.
 */
export const nowMicros = () => Math.round((performance.timeOrigin + performance.now()) * 1000);

/**
 * One candle plus its indicators, as the engine expects it.
 *
 * Prices stay STRINGS. The engine parses them to double for comparison but
 * echoes the original string back on the signal, so the value that reaches
 * PaperBroker is byte-for-byte what came out of Postgres. Sending numbers here
 * would put a float in the money path for the first time in the system.
 */
export const buildEngineFrame = (candle) => ({
  candle: {
    symbol: candle.symbol,
    interval: candle.interval,
    open_time: candle.open_time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  },
  // null indicators mean the engine failed this candle; the C++ side treats a
  // missing key and a null value identically, as "still warming up".
  indicators: candle.indicators ?? {},
  sent_at_us: nowMicros(),
});

/**
 * Parse one signal frame. Returns null rather than throwing: a malformed frame
 * from the engine must not take the Node process down either.
 */
export const parseEngineSignal = (raw) => {
  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const action = parsed.action;
  if (!Object.values(ENGINE_ACTION).includes(action)) return null;
  if (typeof parsed.price !== 'string' || parsed.price === '') return null;

  return {
    action,
    price: parsed.price,
    symbol: parsed.symbol ?? null,
    openTime: Number(parsed.candle_time ?? parsed.timestamp ?? 0),
    strategyName: parsed.strategyName ?? 'C++ engine',
    engineLatencyUs: Number(parsed.engine_latency_us ?? 0),
    // Nanoseconds: the strategy call alone is too fast to resolve in us.
    strategyNs: Number(parsed.strategy_ns ?? 0),
    engineSentAtUs: Number(parsed.engine_sent_at_us ?? 0),
  };
};

/** Signals the broker can act on. HOLD is informational only. */
export const isActionable = (signal) =>
  signal.action === ENGINE_ACTION.BUY || signal.action === ENGINE_ACTION.SELL;
