/**
 * Which indicators the chart draws, where, and how.
 *
 * The `key` of each entry is the wire name the backend sends — the same string
 * in the REST `indicators` object and in a live candle's `indicators` field.
 * That single shared name is the entire contract between the two sides.
 *
 * `group` exists so related series behave as one unit: Bollinger Bands are
 * three lines but one idea, and MACD is three series but one panel.
 */

/** Pane 0 is the price chart; each panel gets its own pane below it. */
export const PRICE_PANE = 0;

// ---------------------------------------------------------------------------
// Overlays — drawn on the price pane, in price units
// ---------------------------------------------------------------------------

/**
 * Note bbMiddle IS an SMA(20) — that is the definition of Bollinger Bands — so
 * it sits exactly underneath the SMA 20 line when both are shown. It is drawn
 * dashed and dimmer so the overlap reads as intentional rather than as a bug.
 */
export const OVERLAY_SERIES = [
  { key: 'sma20', group: 'sma20', label: 'SMA 20', type: 'line', color: '#e0a445', lineWidth: 2, lineStyle: 'solid' },
  { key: 'ema20', group: 'ema20', label: 'EMA 20', type: 'line', color: '#45a0e0', lineWidth: 2, lineStyle: 'solid' },
  { key: 'bbUpper', group: 'bollinger', label: 'BB Upper', type: 'line', color: '#9b8ae0', lineWidth: 1, lineStyle: 'solid' },
  { key: 'bbMiddle', group: 'bollinger', label: 'BB Middle', type: 'line', color: '#6f6494', lineWidth: 1, lineStyle: 'dashed' },
  { key: 'bbLower', group: 'bollinger', label: 'BB Lower', type: 'line', color: '#9b8ae0', lineWidth: 1, lineStyle: 'solid' },
].map((definition) => ({ ...definition, paneIndex: PRICE_PANE }));

// ---------------------------------------------------------------------------
// Panels — separate panes below the price, with their own scales
// ---------------------------------------------------------------------------

/**
 * RSI and MACD cannot be overlaid on price: RSI lives on 0-100 and MACD
 * oscillates around zero in price-difference units. Drawn on the price scale
 * they would either be invisible or flatten the candles into a line.
 */
export const PANEL_DEFINITIONS = [
  {
    id: 'rsi',
    paneIndex: 1,
    label: 'RSI 14',
    height: 120,

    // RSI is bounded 0-100 by construction, so the scale is pinned rather than
    // autoscaled. Let it autoscale and the 70/30 lines drift around the pane
    // as the data range changes, which destroys the whole point of fixed
    // overbought/oversold thresholds.
    fixedScale: { min: 0, max: 100 },

    series: [
      { key: 'rsi14', label: 'RSI 14', type: 'line', color: '#e0a445', lineWidth: 2, lineStyle: 'solid' },
    ],
    priceLines: [
      { value: 70, color: '#e0413e', lineStyle: 'dashed', title: '70' },
      { value: 50, color: '#3a4453', lineStyle: 'dotted', title: '' },
      { value: 30, color: '#26a15e', lineStyle: 'dashed', title: '30' },
    ],
  },
  {
    id: 'macd',
    paneIndex: 2,
    label: 'MACD 12/26/9',
    height: 120,

    // Histogram is declared FIRST so the two lines draw on top of the bars.
    series: [
      {
        key: 'macdHistogram',
        label: 'Histogram',
        type: 'histogram',
        color: '#4a5568',
        positiveColor: 'rgba(38, 161, 94, 0.6)',
        negativeColor: 'rgba(224, 65, 62, 0.6)',
      },
      { key: 'macd', label: 'MACD', type: 'line', color: '#45a0e0', lineWidth: 2, lineStyle: 'solid' },
      { key: 'macdSignal', label: 'Signal', type: 'line', color: '#e0a445', lineWidth: 2, lineStyle: 'solid' },
    ],
    priceLines: [{ value: 0, color: '#3a4453', lineStyle: 'dashed', title: '' }],
  },
];

/** Flattened panel series, each carrying the pane and group it belongs to. */
export const PANEL_SERIES = PANEL_DEFINITIONS.flatMap((panel) =>
  panel.series.map((definition) => ({
    ...definition,
    paneIndex: panel.paneIndex,
    group: panel.id,
  }))
);

// ---------------------------------------------------------------------------
// Toggles
// ---------------------------------------------------------------------------

/** Overlay groups, in the order they appear in the control bar. */
export const OVERLAY_GROUPS = [
  { id: 'sma20', label: 'SMA 20' },
  { id: 'ema20', label: 'EMA 20' },
  { id: 'bollinger', label: 'Bollinger' },
];

/**
 * One toggle per GROUP, not per series — Bollinger is three lines and MACD is
 * three series, but each is one idea and one checkbox. `kind` matters because
 * hiding an overlay just hides lines, while hiding a panel must also collapse
 * the empty pane it would leave behind.
 */
export const TOGGLE_GROUPS = [
  ...OVERLAY_GROUPS.map((group) => ({
    ...group,
    kind: 'overlay',
    color: OVERLAY_SERIES.find((series) => series.group === group.id)?.color,
  })),
  ...PANEL_DEFINITIONS.map((panel) => ({
    id: panel.id,
    label: panel.label,
    kind: 'panel',
    color: panel.series.find((series) => series.type === 'line')?.color,
  })),
];

/**
 * Everything the chart draws, in one list.
 *
 * Creating, seeding and updating series is identical whether a series sits on
 * the price pane or in a panel — only `paneIndex` and `type` differ. Keeping
 * one list means CandleChart has a single loop for each operation instead of
 * separate code paths for overlays and panels.
 */
export const ALL_INDICATOR_SERIES = [...OVERLAY_SERIES, ...PANEL_SERIES];
