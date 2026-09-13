import { EMAStrategy } from '../../strategies/EMAStrategy.js';
import { MACDStrategy } from '../../strategies/MACDStrategy.js';
import { RSIStrategy } from '../../strategies/RSIStrategy.js';
import { RuleStrategy } from '../../strategies/RuleStrategy.js';

/** name -> constructor. Adding a strategy is one entry. */
const REGISTRY = {
  ema: EMAStrategy,
  rsi: RSIStrategy,
  macd: MACDStrategy,
  rule: RuleStrategy,
};

/** `rule` is excluded: it takes a document, not tunable params, so it has no place
 *  in the params-driven picker. Saved rules get their own list in the UI. */
export const STRATEGY_NAMES = Object.keys(REGISTRY).filter((name) => name !== 'rule');

export const createStrategy = (name, params = {}) => {
  const Constructor = REGISTRY[String(name).toLowerCase()];

  if (!Constructor) {
    throw new TypeError(
      `Unknown strategy "${name}". Available: ${STRATEGY_NAMES.join(', ')}`
    );
  }

  return new Constructor(params);
};
