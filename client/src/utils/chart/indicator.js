import { LineStyle } from 'lightweight-charts';
import { toChartTime } from './candle.js';

const LINE_STYLES = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
};

const lineStyleOf = (name) => LINE_STYLES[name] ?? LineStyle.Solid;

/**
 * Colour a histogram bar by its sign.
 * MACD's histogram is the whole reason to draw it as bars rather than a line:
 * the crossover is where it flips sign, and colour makes that readable at a
 * glance instead of requiring the reader to find the zero line.
 */
function histogramColor(value, definition) {
  if (value >= 0) return definition.positiveColor ?? definition.color;
  return definition.negativeColor ?? definition.color;
}

/**
 * Turn one aligned indicator series into chart data.
 *
 * The backend guarantees series[i] describes candles[i], with null wherever the
 * indicator has no value yet. lightweight-charts will not accept a null value,
 * so nulls are DROPPED — the series simply begins at its first real value.
 *
 * Dropping is safe precisely because the nulls are always a leading run: an
 * indicator warms up once and then produces a value for every candle. If a null
 * could appear in the middle, dropping it would silently connect across the gap
 * and draw a line through data that does not exist; that case would need
 * whitespace points instead.
 */
export function toSeriesData(candles, series, definition) {
  if (!Array.isArray(series)) return [];

  const isHistogram = definition?.type === 'histogram';
  const points = [];

  for (let i = 0; i < candles.length; i += 1) {
    const value = series[i];
    if (value === null || value === undefined || !Number.isFinite(value)) continue;

    const point = { time: toChartTime(candles[i].open_time), value };
    if (isHistogram) point.color = histogramColor(value, definition);

    points.push(point);
  }

  return points;
}

/** One live value -> a single point, matching what toSeriesData would produce. */
export function toSeriesPoint(time, value, definition) {
  const point = { time, value };
  if (definition?.type === 'histogram') point.color = histogramColor(value, definition);
  return point;
}

/** Definition -> lightweight-charts series options. */
export function toSeriesOptions(definition) {
  const base = {
    // Overlays would otherwise each add their own axis label and horizontal
    // price line, burying the candle's own last-price marker under five of them.
    // Panels read their values from the legend instead.
    lastValueVisible: false,
    priceLineVisible: false,
    crosshairMarkerVisible: false,
  };

  if (definition.type === 'histogram') {
    return { ...base, color: definition.color, base: 0 };
  }

  return {
    ...base,
    color: definition.color,
    lineWidth: definition.lineWidth ?? 2,
    lineStyle: lineStyleOf(definition.lineStyle),
  };
}

/**
 * Pin a pane's scale to a fixed range.
 *
 * Returned as an autoscale provider rather than set on the price scale, because
 * this is the series' own claim about its range — RSI is 0-100 by construction,
 * not by configuration.
 */
export function toFixedScaleOptions(fixedScale) {
  if (!fixedScale) return {};

  return {
    autoscaleInfoProvider: () => ({
      priceRange: { minValue: fixedScale.min, maxValue: fixedScale.max },
    }),
  };
}

/** Definition -> createPriceLine() options for a threshold marker. */
export function toPriceLineOptions(line) {
  return {
    price: line.value,
    color: line.color,
    lineWidth: 1,
    lineStyle: lineStyleOf(line.lineStyle),
    axisLabelVisible: Boolean(line.title),
    title: line.title ?? '',
  };
}
