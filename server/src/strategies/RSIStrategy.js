import {
  CROSS,
  DEFAULT_STRATEGY_PARAMS,
  RSI_BOUNDS,
  SIGNAL,
} from '../constants/strategies.js';
import { createCrossTracker } from '../utils/strategies/cross.js';
import {
  assertInRange,
  assertIndicatorAvailable,
  assertKnownParams,
  assertOrdered,
  assertPositiveInteger,
} from '../utils/strategies/params.js';
import { Strategy } from './Strategy.js';

/**
 * RSI mean reversion — the opposite thesis to a crossover strategy.
 *
 *   RSI crosses BELOW oversold    -> BUY   (assume the fall is overdone)
 *   RSI crosses ABOVE overbought  -> SELL  (assume the rally is overdone)
 *
 * Note "crosses", not "is". Buying on every candle where RSI < 30 would fire
 * repeatedly all the way down a trend, averaging into a falling market — the
 * classic way this strategy destroys an account. Acting only on the transition
 * gives one signal per excursion.
 *
 * The two thresholds are tracked independently rather than as a single state
 * machine, because on a violent move RSI can pass through both between candles
 * and each crossing is its own event.
 */
export class RSIStrategy extends Strategy {
  constructor(params = {}) {
    assertKnownParams(params, DEFAULT_STRATEGY_PARAMS.rsi, 'RSIStrategy');
    const merged = { ...DEFAULT_STRATEGY_PARAMS.rsi, ...params };

    assertPositiveInteger(merged.period, 'period');
    assertInRange(merged.oversold, 'oversold', RSI_BOUNDS.MIN, RSI_BOUNDS.MAX);
    assertInRange(merged.overbought, 'overbought', RSI_BOUNDS.MIN, RSI_BOUNDS.MAX);
    assertOrdered(merged.oversold, merged.overbought, 'oversold', 'overbought');

    super(`RSI ${merged.period} (${merged.oversold}/${merged.overbought})`, merged);

    this.rsiKey = `rsi${merged.period}`;
    assertIndicatorAvailable(this.rsiKey, 'RSIStrategy');

    this.oversoldCross = createCrossTracker();
    this.overboughtCross = createCrossTracker();
  }

  requiredIndicators() {
    return [this.rsiKey];
  }

  onCandle(candle, indicators) {
    const values = this.readIndicators(indicators);
    if (!values) return null;

    const rsi = values[this.rsiKey];

    // Both trackers see every candle, so neither loses track of which side RSI
    // is on while the other is the one that fired.
    const throughOversold = this.oversoldCross.update(rsi, this.params.oversold);
    const throughOverbought = this.overboughtCross.update(rsi, this.params.overbought);

    if (throughOversold === CROSS.DOWN) return SIGNAL.BUY;
    if (throughOverbought === CROSS.UP) return SIGNAL.SELL;
    return null;
  }

  reset() {
    this.oversoldCross.reset();
    this.overboughtCross.reset();
  }
}
