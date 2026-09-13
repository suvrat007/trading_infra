import { parseMoney } from './money.js';

/** Totals over the books, and parsing persisted rows back into scaled integers. */

export const costBasisOf = (positions) =>
  [...positions].reduce((total, p) => total + p.entryPrice * BigInt(p.quantity), 0n);

export const marketValueOf = (positions, marks) =>
  [...positions].reduce(
    (total, p) => total + (marks.get(p.symbol) ?? p.entryPrice) * BigInt(p.quantity),
    0n
  );

export const realizedPnlOf = (trades) => trades.reduce((total, t) => total + t.pnl, 0n);

export const parsePositionRows = (rows) => rows.map((row) => ({
  symbol: row.symbol,
  quantity: Number(row.quantity),
  entryPrice: parseMoney(row.entry_price),
  openedAt: Number(row.opened_at),
}));

export const parseTradeRows = (rows) => rows.map((row) => ({
  id: row.id,
  symbol: row.symbol,
  side: row.side,
  quantity: Number(row.quantity),
  entryPrice: parseMoney(row.entry_price),
  exitPrice: parseMoney(row.exit_price),
  pnl: parseMoney(row.pnl),
  openedAt: Number(row.opened_at),
  closedAt: Number(row.closed_at),
}));
