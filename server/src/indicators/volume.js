import {
  assertCandles,
  assertPeriod,
  assertVolumes,
  nulls,
  typicalPrices,
} from './math.js';
import { sma } from './trend.js';

/**
 * Volume indicators — using the one field price-only indicators throw away.
 *
 * Volume is what separates a move people participated in from a move that
 * happened on nothing. Every function here takes candles with a `volume`.
 */

/**
 * On-Balance Volume: a running total that adds the day's volume on an up close
 * and subtracts it on a down close.
 *
 * The absolute number is meaningless — it depends entirely on where you started
 * counting. Only its SLOPE carries information, and the classic read is
 * divergence: price making new highs while OBV does not means the move is not
 * being supported by participation.
 */
export function obv(candles) {
  assertCandles(candles, 'candles');
  assertVolumes(candles, 'candles');

  const out = new Array(candles.length).fill(0);

  for (let i = 1; i < candles.length; i += 1) {
    const change = candles[i].close - candles[i - 1].close;

    if (change > 0) out[i] = out[i - 1] + candles[i].volume;
    else if (change < 0) out[i] = out[i - 1] - candles[i].volume;
    else out[i] = out[i - 1]; // unchanged close contributes nothing
  }

  return out;
}

/**
 * Rolling VWAP: volume-weighted average price over the last `period` candles.
 *
 * Worth being precise about, because it differs from the VWAP traders quote:
 * true VWAP is ANCHORED and resets at the start of each session, so it answers
 * "what is the average fill price today". Crypto has no session — it trades
 * continuously — so an anchored reset would be arbitrary. A rolling window is
 * the honest analogue here, but it is not the same number a stock trader means.
 */
export function rollingVwap(candles, period = 20) {
  assertCandles(candles, 'candles');
  assertVolumes(candles, 'candles');
  assertPeriod(period, 'period');

  const typical = typicalPrices(candles);
  const out = nulls(candles.length);

  for (let i = period - 1; i < candles.length; i += 1) {
    let priceVolume = 0;
    let volumeTotal = 0;

    for (let w = i - period + 1; w <= i; w += 1) {
      priceVolume += typical[w] * candles[w].volume;
      volumeTotal += candles[w].volume;
    }

    // A window with no traded volume has no volume-weighted price.
    out[i] = volumeTotal === 0 ? null : priceVolume / volumeTotal;
  }

  return out;
}

/**
 * Money Flow Index: RSI's construction, but each move is weighted by the money
 * that changed hands (typical price x volume) instead of counted equally.
 *
 * Often called "volume-weighted RSI". Same 0-100 scale, same 80/20 (rather than
 * 70/30) convention for extremes.
 */
export function mfi(candles, period = 14) {
  assertCandles(candles, 'candles');
  assertVolumes(candles, 'candles');
  assertPeriod(period, 'period');

  const typical = typicalPrices(candles);
  const out = nulls(candles.length);
  if (candles.length <= period) return out;

  const positive = new Array(candles.length).fill(0);
  const negative = new Array(candles.length).fill(0);

  for (let i = 1; i < candles.length; i += 1) {
    const flow = typical[i] * candles[i].volume;
    if (typical[i] > typical[i - 1]) positive[i] = flow;
    else if (typical[i] < typical[i - 1]) negative[i] = flow;
  }

  for (let i = period; i < candles.length; i += 1) {
    let positiveTotal = 0;
    let negativeTotal = 0;

    for (let w = i - period + 1; w <= i; w += 1) {
      positiveTotal += positive[w];
      negativeTotal += negative[w];
    }

    if (positiveTotal === 0 && negativeTotal === 0) out[i] = 50;
    else if (negativeTotal === 0) out[i] = 100;
    else if (positiveTotal === 0) out[i] = 0;
    else out[i] = 100 - 100 / (1 + positiveTotal / negativeTotal);
  }

  return out;
}

/**
 * Accumulation/Distribution Line.
 *
 * The multiplier ((close-low) - (high-close)) / (high-low) asks where in the
 * candle's range the close landed: +1 at the very high, -1 at the very low,
 * 0 exactly mid-range. Multiply by volume and accumulate.
 *
 * Unlike OBV it uses the close's POSITION within the bar rather than just its
 * direction, so a bar that gapped up but closed near its low is correctly
 * treated as distribution rather than accumulation.
 */
export function accumulationDistribution(candles) {
  assertCandles(candles, 'candles');
  assertVolumes(candles, 'candles');

  const out = new Array(candles.length).fill(0);
  let cumulative = 0;

  for (let i = 0; i < candles.length; i += 1) {
    const { high, low, close, volume } = candles[i];
    const range = high - low;

    // A doji with zero range has no meaningful close position.
    const multiplier = range === 0 ? 0 : ((close - low) - (high - close)) / range;

    cumulative += multiplier * volume;
    out[i] = cumulative;
  }

  return out;
}

/**
 * Chaikin Money Flow: the same money-flow volume as A/D, but summed over a
 * fixed window and normalized by volume instead of accumulated forever.
 *
 * That bounds it to -1..+1, which makes it comparable across time and symbols —
 * the thing A/D and OBV cannot do because their level is arbitrary.
 */
export function chaikinMoneyFlow(candles, period = 20) {
  assertCandles(candles, 'candles');
  assertVolumes(candles, 'candles');
  assertPeriod(period, 'period');

  const moneyFlowVolume = candles.map(({ high, low, close, volume }) => {
    const range = high - low;
    return range === 0 ? 0 : (((close - low) - (high - close)) / range) * volume;
  });

  const out = nulls(candles.length);

  for (let i = period - 1; i < candles.length; i += 1) {
    let flowTotal = 0;
    let volumeTotal = 0;

    for (let w = i - period + 1; w <= i; w += 1) {
      flowTotal += moneyFlowVolume[w];
      volumeTotal += candles[w].volume;
    }

    out[i] = volumeTotal === 0 ? null : flowTotal / volumeTotal;
  }

  return out;
}

/** Average traded volume — the baseline you compare a volume spike against. */
export function volumeSma(candles, period = 20) {
  assertCandles(candles, 'candles');
  assertVolumes(candles, 'candles');

  return sma(candles.map((candle) => candle.volume), period);
}
