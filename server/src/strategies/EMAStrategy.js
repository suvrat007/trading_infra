import { CROSS, DEFAULT_STRATEGY_PARAMS, SIGNAL } from '../constants/strategies.js';
import { createCrossTracker } from '../utils/strategies/cross.js';
import {
  assertIndicatorAvailable,
  assertKnownParams,
  assertOrdered,
  assertPositiveInteger,
} from '../utils/strategies/params.js';
import { Strategy } from './Strategy.js';

/**
 * EMA crossover — the canonical trend-following strategy.
 *
 *   fast crosses ABOVE slow  -> BUY   (the "golden cross")
 *   fast crosses BELOW slow  -> SELL  (the "death cross")
 *
 * Worth knowing what it is and is not: crossovers lag by construction, because
 * a moving average is a function of the past. They perform well in trends and
 * badly in ranges, where price oscillates across the average and produces a
 * stream of losing round trips ("whipsaw"). That is a property of the strategy,
 * not a defect in this implementation.
 */
export class EMAStrategy extends Strategy {
  constructor(params = {}) {
    assertKnownParams(params, DEFAULT_STRATEGY_PARAMS.ema, 'EMAStrategy');
    const merged = { ...DEFAULT_STRATEGY_PARAMS.ema, ...params };

    assertPositiveInteger(merged.fastPeriod, 'fastPeriod');
    assertPositiveInteger(merged.slowPeriod, 'slowPeriod');
    assertOrdered(merged.fastPeriod, merged.slowPeriod, 'fastPeriod', 'slowPeriod');

    super(`EMA ${merged.fastPeriod}/${merged.slowPeriod} Crossover`, merged);

    this.fastKey = `ema${merged.fastPeriod}`;
    this.slowKey = `ema${merged.slowPeriod}`;

    // Fail now, loudly, if the engine does not compute these periods.
    assertIndicatorAvailable(this.fastKey, 'EMAStrategy');
    assertIndicatorAvailable(this.slowKey, 'EMAStrategy');

    this.cross = createCrossTracker();
  }

  requiredIndicators() {
    return [this.fastKey, this.slowKey];
  }

  onCandle(candle, indicators) {
    const values = this.readIndicators(indicators);
    if (!values) return null; // warming up, or the engine failed this candle

    const direction = this.cross.update(values[this.fastKey], values[this.slowKey]);

    if (direction === CROSS.UP) return SIGNAL.BUY;
    if (direction === CROSS.DOWN) return SIGNAL.SELL;
    return null;
  }

  reset() {
    this.cross.reset();
  }
}
