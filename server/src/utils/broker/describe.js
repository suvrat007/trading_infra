import { formatMoney } from './money.js';

/** Scaled-integer internals -> the string shapes the API and UI consume. */

export const describePosition = (position, mark) => {
  const quantity = BigInt(position.quantity);
  const price = mark ?? position.entryPrice;

  const costBasis = position.entryPrice * quantity;
  const marketValue = price * quantity;

  return {
    symbol: position.symbol,
    quantity: position.quantity,
    entryPrice: formatMoney(position.entryPrice),
    markPrice: formatMoney(price),
    costBasis: formatMoney(costBasis),
    marketValue: formatMoney(marketValue),
    unrealizedPnl: formatMoney(marketValue - costBasis),
    openedAt: position.openedAt,
  };
};

export const describeTrade = (trade) => ({
  id: trade.id,
  symbol: trade.symbol,
  side: trade.side,
  quantity: trade.quantity,
  entryPrice: formatMoney(trade.entryPrice),
  exitPrice: formatMoney(trade.exitPrice),
  pnl: formatMoney(trade.pnl),
  openedAt: trade.openedAt,
  closedAt: trade.closedAt,
});
