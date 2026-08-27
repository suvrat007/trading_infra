export const MS_PER_SECOND = 1_000;

// lightweight-charts theming. Kept here so the chart component stays logic-only.
export const CHART_OPTIONS = {
  layout: {
    background: { color: '#0e1116' },
    textColor: '#a9b1ba',
    attributionLogo: false,
  },
  grid: {
    vertLines: { color: '#1b212b' },
    horzLines: { color: '#1b212b' },
  },
  rightPriceScale: { borderColor: '#2a323d' },
  timeScale: {
    borderColor: '#2a323d',
    timeVisible: true,
    secondsVisible: false,
  },
  crosshair: { mode: 0 }, // 0 = Normal: crosshair follows the pointer freely
  autoSize: true,
};

export const CANDLESTICK_OPTIONS = {
  upColor: '#26a15e',
  downColor: '#e0413e',
  borderUpColor: '#26a15e',
  borderDownColor: '#e0413e',
  wickUpColor: '#26a15e',
  wickDownColor: '#e0413e',
};

// Price formatting: BTCUSDT trades with 2 decimals of practical significance.
export const PRICE_FORMAT = {
  type: 'price',
  precision: 2,
  minMove: 0.01,
};
