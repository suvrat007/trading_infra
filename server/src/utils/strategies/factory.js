import { EMAStrategy } from '../../strategies/EMAStrategy.js';
import { MACDStrategy } from '../../strategies/MACDStrategy.js';
import { RSIStrategy } from '../../strategies/RSIStrategy.js';

/** name -> constructor. Adding a strategy is one entry. */
const REGISTRY = {
  ema: EMAStrategy,
  rsi: RSIStrategy,
  macd: MACDStrategy,
};

export const STRATEGY_NAMES = Object.keys(REGISTRY);

export const createStrategy = (name, params = {}) => {
  const Constructor = REGISTRY[String(name).toLowerCase()];

  if (!Constructor) {
    throw new TypeError(
      `Unknown strategy "${name}". Available: ${STRATEGY_NAMES.join(', ')}`
    );
  }

  return new Constructor(params);
};
