import { CROSS, DEFAULT_STRATEGY_PARAMS, SIGNAL } from '../constants/strategies.js';
import { PERIODS } from '../constants/indicators.js';
import { createCrossTracker } from '../utils/strategies/cross.js';
import {
  assertKnownParams,
  assertOrdered,
  assertPositiveInteger,
} from '../utils/strategies/params.js';
import { Strategy } from './Strategy.js';

/**
 * MACD signal-line crossover.
 *
 *   MACD crosses ABOVE signal  -> BUY
 *   MACD crosses BELOW signal  -> SELL
 *
 * Equivalent to the histogram changing sign, since the histogram IS
 * macd - signal. Underneath it is still a moving-average crossover, but between
 * two already-smoothed series rather than price and one average, which filters
 * some of the noise a raw EMA cross reacts to.
 *
 * Unlike EMAStrategy the periods here are not free. The engine publishes ONE
 * MACD, computed at its configured periods, under the fixed wire names `macd`
 * and `macdSignal`. Accepting different periods would produce a strategy whose
 * name claims 5/35/5 while it reads 12/26/9 values — trades recorded under a
 * label that does not describe them — so it is rejected outright.
 */
export class MACDStrategy extends Strategy {
  constructor(params = {}) {
    assertKnownParams(params, DEFAULT_STRATEGY_PARAMS.macd, 'MACDStrategy');
    const merged = { ...DEFAULT_STRATEGY_PARAMS.macd, ...params };

    assertPositiveInteger(merged.fastPeriod, 'fastPeriod');
    assertPositiveInteger(merged.slowPeriod, 'slowPeriod');
    assertPositiveInteger(merged.signalPeriod, 'signalPeriod');
    assertOrdered(merged.fastPeriod, merged.slowPeriod, 'fastPeriod', 'slowPeriod');

    const engine = {
      fastPeriod: PERIODS.MACD_FAST,
      slowPeriod: PERIODS.MACD_SLOW,
      signalPeriod: PERIODS.MACD_SIGNAL,
    };

    for (const key of Object.keys(engine)) {
      if (merged[key] !== engine[key]) {
        throw new TypeError(
          `MACDStrategy ${key}=${merged[key]} does not match the engine MACD ` +
          `configuration (${engine.fastPeriod}/${engine.slowPeriod}/${engine.signalPeriod}). ` +
          'The wire carries one MACD; change PERIODS.MACD_* to use other periods.'
        );
      }
    }

    super(
      `MACD ${merged.fastPeriod}/${merged.slowPeriod}/${merged.signalPeriod} Crossover`,
      merged
    );

    this.cross = createCrossTracker();
  }

  requiredIndicators() {
    return ['macd', 'macdSignal'];
  }

  onCandle(candle, indicators) {
    const values = this.readIndicators(indicators);
    if (!values) return null;

    const direction = this.cross.update(values.macd, values.macdSignal);

    if (direction === CROSS.UP) return SIGNAL.BUY;
    if (direction === CROSS.DOWN) return SIGNAL.SELL;
    return null;
  }

  reset() {
    this.cross.reset();
  }
}
