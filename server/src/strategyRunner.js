import { publish } from './broadcast.js';
import { ACTIVE_STRATEGY, SIGNAL } from './constants/strategies.js';
import { LOG_STRATEGY } from './constants/logging.js';
import { PaperBroker } from './PaperBroker.js';
import { buildAccountMessage, buildSignalMessage } from './utils/broadcast/message.js';
import { closePosition, loadBooks, savePosition } from './utils/broker/persistence.js';
import { STRATEGY_NAMES, createStrategy } from './utils/strategies/factory.js';
import { DEFAULT_STRATEGY_PARAMS } from './constants/strategies.js';
import { INDICATOR_KEYS } from './constants/indicators.js';
import { DEFAULT_TIMEFRAME } from './constants/timeframes.js';
import { ENGINE_ACTION, ENGINE_ENABLED, ENGINE_TRADES } from './constants/engine.js';
import { recordNodeDecision } from './utils/engine/compare.js';
import { nowMicros } from './utils/engine/frame.js';

/**
 * Runs one strategy against the live candle stream and executes its signals.
 *
 * Subscribes to the ENRICHED stream — strategies read indicator values, so it
 * must sit after the indicator engine. Another observer, like continuity: it
 * consumes an emitter and emits nothing back into the pipeline.
 */

let broker = null;
let strategy = null;
let unsubscribe = null;
let candleSource = null;
let running = false;

/**
 * Whether THIS path may reach the broker.
 *
 * Exactly one engine executes at a time. In cpp mode the JavaScript strategy
 * still runs and still records its decision — that is what makes the two
 * comparable — but it stops short of placing an order.
 */
let executes = !ENGINE_TRADES;

/** Broker state is in memory; the tables are the durable record of it. */
const persist = async (result) => {
  if (result.trade) {
    // One transaction: a crash between the delete and the insert would leave
    // restored cash wrong by exactly this trade's PnL.
    await closePosition(result.symbol, result.trade);
    return;
  }

  if (result.position) {
    await savePosition({
      symbol: result.position.symbol,
      quantity: result.position.quantity,
      entryPrice: result.position.entryPrice,
      openedAt: result.position.openedAt,
    });
  }
};

/**
 * Fill a signal, persist it, and tell the browser.
 *
 * Extracted from onCandle so the C++ engine reaches the broker through exactly
 * the same code the JavaScript strategy does. Two execution paths would mean
 * two places to get position accounting wrong, and any divergence between them
 * would be a difference in the plumbing rather than in the strategy — which is
 * precisely what Phase 5 sets out to measure.
 *
 * `price` is the decimal string, never a number.
 */
export const executeSignal = async ({ signal, symbol, price, openTime, strategyName }) => {
  const result = broker.executeOrder(signal, price, symbol);

  console.log(
    `${LOG_STRATEGY} ${strategyName} -> ${signal} ${symbol} @ ${price} : ` +
    (result.accepted
      ? `FILLED ${result.quantity} unit(s), balance ${result.balance}`
      : `REJECTED ${result.reason}`)
  );

  if (result.accepted) await persist(result);

  publish(buildSignalMessage({
    signal,
    symbol,
    price,
    openTime,
    strategy: strategyName,
    result,
  }));

  if (result.accepted) publish(buildAccountMessage(broker));

  return result;
};

const onCandle = async (candle) => {
  try {
    // A rule strategy declares the timeframe it trades; anything else is not
    // its candle. The socket now carries all five.
    const wanted = strategy.timeframe ?? DEFAULT_TIMEFRAME;
    if (candle.interval !== wanted) return;

    // Mark first: unrealized PnL should track price even on candles with no
    // signal. This happens in every mode, including when C++ does the trading —
    // marking is bookkeeping, not execution.
    broker.mark(candle.symbol, candle.close);

    // Timed for the Phase 7 comparison. Measures the strategy call ALONE, the
    // same span the C++ side times, so the two numbers describe the same work.
    const startedAt = nowMicros();
    const signal = strategy.onCandle(candle, candle.indicators, {
      hasPosition: broker.hasPosition(candle.symbol),
    });
    const strategyUs = nowMicros() - startedAt;

    const actionable = signal === SIGNAL.BUY || signal === SIGNAL.SELL;

    // Recorded even when this path is not trading, so shadow and cpp modes can
    // check the two engines against each other candle by candle.
    if (ENGINE_ENABLED) {
      recordNodeDecision({
        openTime: candle.open_time,
        action: actionable ? signal : ENGINE_ACTION.HOLD,
        strategyUs,
      });
    }

    if (!actionable) return;

    // In cpp mode the C++ signal is authoritative; running both would double
    // every order.
    if (!executes) {
      console.log(`${LOG_STRATEGY} ${strategy.getName()} -> ${signal} (not executed: C++ is trading)`);
      return;
    }

    await executeSignal({
      signal,
      symbol: candle.symbol,
      price: candle.close,
      openTime: candle.open_time,
      strategyName: strategy.getName(),
    });
  } catch (err) {
    // Trading is downstream of the data pipeline; a failure here must not stop
    // candles being ingested, stored or broadcast.
    console.error(`${LOG_STRATEGY} failed on candle ${candle.open_time}:`, err.message);
  }
};

const subscribe = () => {
  if (unsubscribe || !candleSource) return;
  candleSource.on('candle', onCandle);
  unsubscribe = () => candleSource.off('candle', onCandle);
  running = true;
};

const unsubscribeNow = () => {
  unsubscribe?.();
  unsubscribe = null;
  running = false;
};

export const startStrategyRunner = async (source, { strategyName = ACTIVE_STRATEGY } = {}) => {
  candleSource = source;
  strategy = createStrategy(strategyName);
  broker = new PaperBroker();

  const summary = broker.restore(await loadBooks());

  console.log(
    `${LOG_STRATEGY} ${strategy.getName()} | restored ${summary.openPositions} position(s), ` +
    `${summary.closedTrades} trade(s), balance ${summary.balance}, equity ${summary.equity}`
  );

  if (!executes) {
    console.log(`${LOG_STRATEGY} decisions only — the C++ engine is executing`);
  }

  subscribe();
  return { broker, strategy };
};

/** Swap the strategy and (re)subscribe. Throws on invalid params. */
export const startStrategy = ({ name, params = {} }) => {
  // Construct BEFORE unsubscribing, so a bad request leaves the running
  // strategy untouched rather than stopping it and then failing.
  const next = createStrategy(name, params);

  unsubscribeNow();
  strategy = next;
  strategy.reset();
  subscribe();

  console.log(`${LOG_STRATEGY} started ${strategy.getName()}`);
  return getStrategyStatus();
};

/** Stop trading and liquidate everything at the last seen price. */
export const stopStrategy = async () => {
  unsubscribeNow();
  strategy?.reset();

  const closed = [];

  for (const result of broker?.closeAllPositions() ?? []) {
    if (!result.accepted) {
      console.warn(`${LOG_STRATEGY} could not close: ${result.reason}`);
      continue;
    }

    await persist(result);
    closed.push(result.trade);
    console.log(`${LOG_STRATEGY} closed ${result.symbol} @ ${result.price}, pnl ${result.trade.pnl}`);
  }

  if (closed.length > 0) publish(buildAccountMessage(broker));

  console.log(`${LOG_STRATEGY} stopped, ${closed.length} position(s) liquidated`);
  return { ...getStrategyStatus(), closed };
};

/** Everything the UI needs to render controls without hardcoding anything. */
export const getStrategyStatus = () => ({
  running,
  executes,
  timeframe: strategy?.timeframe ?? DEFAULT_TIMEFRAME,
  strategy: strategy ? strategy.describe() : null,
  available: STRATEGY_NAMES,
  defaults: DEFAULT_STRATEGY_PARAMS,
  computedIndicators: INDICATOR_KEYS,
  account: broker ? broker.getSummary() : null,
});

export const stopStrategyRunner = () => {
  unsubscribeNow();
  strategy?.reset();
  candleSource = null;
};

/** The REST layer reads live state from here, not from the tables. */
export const getBroker = () => broker;
export const getStrategy = () => strategy;
