import { SIGNAL } from '../constants/strategies.js';
import { assertIndicatorAvailable } from '../utils/strategies/params.js';
import { assertValidStrategyDocument } from '../utils/strategies/dsl/validate.js';
import { compileDocument } from './dsl/compile.js';
import { indicatorsIn } from './dsl/schema.js';
import { Strategy } from './Strategy.js';

/** Runs a user-built rule document: entry opens a position, exit closes it. */
export class RuleStrategy extends Strategy {
  constructor(document) {
    const valid = assertValidStrategyDocument(document);

    super(valid.name, valid.params ?? {});

    this.document = Object.freeze(structuredClone(valid));
    this.timeframe = valid.timeframe;
    this.compiled = compileDocument(valid);

    this.indicators = [...new Set([
      ...indicatorsIn(valid.entry),
      ...indicatorsIn(valid.exit),
    ])];

    // The validator checks names against INDICATOR_KEYS; this checks the engine
    // actually computes them, the same guard EMAStrategy uses.
    for (const key of this.indicators) assertIndicatorAvailable(key, 'RuleStrategy');
  }

  requiredIndicators() {
    return this.indicators;
  }

  /**
   * BOTH trees are evaluated every candle, even the one that cannot act.
   * Skipping the idle tree would leave its cross trackers stale, so the first
   * candle after a position change would compare against an old observation.
   */
  onCandle(candle, indicators, context = {}) {
    const entry = this.compiled.entry.evaluate(candle, indicators);
    const exit = this.compiled.exit.evaluate(candle, indicators);

    if (context.hasPosition === true) return exit === true ? SIGNAL.SELL : null;
    return entry === true ? SIGNAL.BUY : null;
  }

  reset() {
    this.compiled.entry.reset();
    this.compiled.exit.reset();
  }

  describe() {
    return { ...super.describe(), timeframe: this.timeframe, document: this.document };
  }
}
