import { MS_PER_SECOND } from '../../constants/chart.js';

/**
 * Trades -> cumulative realized PnL points.
 *
 * Two things the chart library requires that the raw data does not guarantee:
 * strictly ascending times, and no duplicates. Trades arrive newest-first and
 * several can close within the same second, so sort first and keep only the
 * running total at each second.
 */
export const toPnlSeries = (trades) => {
  if (!trades || trades.length === 0) return [];

  const ordered = [...trades].sort((a, b) => Number(a.closed_at) - Number(b.closed_at));

  const byTime = new Map();
  let cumulative = 0;

  for (const trade of ordered) {
    cumulative += Number(trade.pnl);
    // Later trades in the same second overwrite earlier ones, leaving the
    // running total — which is what a cumulative curve should show.
    byTime.set(Math.floor(Number(trade.closed_at) / MS_PER_SECOND), cumulative);
  }

  return [...byTime.entries()].map(([time, value]) => ({ time, value }));
};

/** Markers for the candle chart, derived from persisted trades. */
export const toTradeMarkers = (trades, intervalMs) => {
  const toBar = (ms) => Math.floor(Number(ms) / intervalMs) * (intervalMs / MS_PER_SECOND);

  return [...trades].flatMap((trade) => [
    { time: toBar(trade.opened_at), side: 'BUY' },
    { time: toBar(trade.closed_at), side: 'SELL' },
  ]);
};
