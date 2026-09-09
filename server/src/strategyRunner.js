import { publish } from './broadcast.js';
import { ACTIVE_STRATEGY, SIGNAL } from './constants/strategies.js';
import { LOG_STRATEGY } from './constants/logging.js';
import { PaperBroker } from './PaperBroker.js';
import { buildAccountMessage, buildSignalMessage } from './utils/broadcast/message.js';
import { closePosition, loadBooks, savePosition } from './utils/broker/persistence.js';
import { STRATEGY_NAMES, createStrategy } from './utils/strategies/factory.js';
import { DEFAULT_STRATEGY_PARAMS } from './constants/strategies.js';
import { INDICATOR_KEYS } from './constants/indicators.js';

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

const onCandle = async (candle) => {
  try {
    // Mark first: unrealized PnL should track price even on candles with no signal.
    broker.mark(candle.symbol, candle.close);

    const signal = strategy.onCandle(candle, candle.indicators);
    if (signal !== SIGNAL.BUY && signal !== SIGNAL.SELL) return;

    const result = broker.executeOrder(signal, candle.close, candle.symbol);

    console.log(
      `${LOG_STRATEGY} ${strategy.getName()} -> ${signal} ${candle.symbol} @ ${candle.close} : ` +
      (result.accepted
        ? `FILLED ${result.quantity} unit(s), balance ${result.balance}`
        : `REJECTED ${result.reason}`)
    );

    if (result.accepted) await persist(result);

    publish(buildSignalMessage({
      signal,
      symbol: candle.symbol,
      price: candle.close,
      openTime: candle.open_time,
      strategy: strategy.getName(),
      result,
    }));

    if (result.accepted) publish(buildAccountMessage(broker));
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
