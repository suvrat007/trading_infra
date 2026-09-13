import { MIN_QUANTITY, REJECT_REASON, SIDE, STARTING_BALANCE } from './constants/broker.js';
import { affordableUnits, formatMoney, notional, parseMoney } from './utils/broker/money.js';
import { describePosition, describeTrade } from './utils/broker/describe.js';
import { reject, validateOrder } from './utils/broker/orders.js';
import {
  costBasisOf,
  marketValueOf,
  parsePositionRows,
  parseTradeRows,
  realizedPnlOf,
} from './utils/broker/books.js';

/**
 * Virtual broker. No DB handle, no pipeline imports — replayable in a test.
 * Long only, one position per symbol, perfect instant fills.
 */
export class PaperBroker {
  constructor({ startingBalance = STARTING_BALANCE } = {}) {
    this.startingBalance = parseMoney(startingBalance);
    if (this.startingBalance < 0n) throw new TypeError('startingBalance cannot be negative');

    this.cash = this.startingBalance;
    this.positions = new Map();
    this.marks = new Map();
    this.trades = [];
    this.nextTradeId = 1;
  }

  mark(symbol, price) {
    const scaled = parseMoney(price);
    if (scaled > 0n) this.marks.set(symbol, scaled);
  }

  /** @param {string} price candle close as a string, never a float. */
  executeOrder(signal, price, symbol) {
    const { rejection, priceScaled } = validateOrder(signal, price, symbol);
    if (rejection) return rejection;

    this.marks.set(symbol, priceScaled);

    return signal === SIDE.BUY
      ? this.#openLong(symbol, priceScaled)
      : this.#closeLong(symbol, priceScaled);
  }

  #openLong(symbol, priceScaled) {
    if (this.positions.has(symbol)) {
      return reject(REJECT_REASON.ALREADY_LONG,
        `Already holding ${this.positions.get(symbol).quantity} ${symbol}`);
    }

    // BigInt division floors — that is the whole-units rule, for free.
    const quantity = affordableUnits(this.cash, priceScaled);

    if (quantity < MIN_QUANTITY) {
      return reject(REJECT_REASON.INSUFFICIENT_FUNDS,
        `${formatMoney(this.cash)} cannot buy ${MIN_QUANTITY} ${symbol} at ${formatMoney(priceScaled)}`);
    }

    const cost = notional(priceScaled, quantity);

    // Unreachable by construction; the balance floor is worth asserting anyway.
    if (cost > this.cash) {
      return reject(REJECT_REASON.INSUFFICIENT_FUNDS, 'Cost exceeds available cash');
    }

    this.cash -= cost;

    const position = { symbol, quantity, entryPrice: priceScaled, openedAt: Date.now() };
    this.positions.set(symbol, position);

    return {
      accepted: true,
      side: SIDE.BUY,
      symbol,
      quantity,
      price: formatMoney(priceScaled),
      cost: formatMoney(cost),
      balance: formatMoney(this.cash),
      position: this.#describe(position),
    };
  }

  #closeLong(symbol, priceScaled) {
    const position = this.positions.get(symbol);

    // Normal: a strategy's first crossover often sells into a flat book.
    if (!position) return reject(REJECT_REASON.NO_POSITION, `No open position in ${symbol}`);

    const proceeds = notional(priceScaled, position.quantity);
    const pnl = (priceScaled - position.entryPrice) * BigInt(position.quantity);

    this.cash += proceeds;
    this.positions.delete(symbol);

    const trade = {
      id: this.nextTradeId++,
      symbol,
      side: SIDE.BUY, // direction of the position that closed
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      exitPrice: priceScaled,
      pnl,
      openedAt: position.openedAt,
      closedAt: Date.now(),
    };
    this.trades.push(trade);

    return {
      accepted: true,
      side: SIDE.SELL,
      symbol,
      quantity: position.quantity,
      price: formatMoney(priceScaled),
      proceeds: formatMoney(proceeds),
      balance: formatMoney(this.cash),
      trade: describeTrade(trade),
    };
  }

  #describe(position) {
    return describePosition(position, this.marks.get(position.symbol));
  }

  /** Liquidate at the last seen price — an unwatched open position is worse. */
  closeAllPositions() {
    const results = [];

    for (const symbol of [...this.positions.keys()]) {
      const mark = this.marks.get(symbol);

      if (!mark) {
        results.push(reject(REJECT_REASON.NO_MARK_PRICE,
          `No price seen for ${symbol}; cannot value the position`));
        continue;
      }

      results.push(this.#closeLong(symbol, mark));
    }

    return results;
  }

  hasPosition(symbol) {
    return this.positions.has(symbol);
  }

  getPositions() {
    return [...this.positions.values()].map((position) => this.#describe(position));
  }

  getTrades() {
    return this.trades.map(describeTrade);
  }

  /**
   * Cash is DERIVED, not stored: starting - open cost basis + realized PnL.
   * Both terms come from the tables, so the balance cannot disagree with them.
   */
  restore({ positions = [], trades = [] }) {
    this.positions.clear();
    this.trades = parseTradeRows(trades);

    for (const position of parsePositionRows(positions)) {
      this.positions.set(position.symbol, position);
    }

    this.nextTradeId = this.trades.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    this.cash = this.startingBalance
      - costBasisOf(this.positions.values())
      + realizedPnlOf(this.trades);

    if (this.cash < 0n) {
      throw new Error(`Restored cash is negative (${formatMoney(this.cash)}); books are inconsistent`);
    }

    return this.getSummary();
  }

  /** Uninvested cash, not equity — see getSummary(). */
  getBalance() {
    return formatMoney(this.cash);
  }

  /** Cash + market value. Balance alone drops on every buy, which is not a loss. */
  getSummary() {
    const positionValue = marketValueOf(this.positions.values(), this.marks);
    const equity = this.cash + positionValue;

    return {
      startingBalance: formatMoney(this.startingBalance),
      balance: formatMoney(this.cash),
      positionValue: formatMoney(positionValue),
      equity: formatMoney(equity),
      realizedPnl: formatMoney(realizedPnlOf(this.trades)),
      unrealizedPnl: formatMoney(positionValue - costBasisOf(this.positions.values())),
      totalPnl: formatMoney(equity - this.startingBalance),
      openPositions: this.positions.size,
      closedTrades: this.trades.length,
    };
  }
}
