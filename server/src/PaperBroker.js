import { MIN_QUANTITY, REJECT_REASON, SIDE, STARTING_BALANCE } from './constants/broker.js';
import {
  affordableUnits,
  formatMoney,
  notional,
  parseMoney,
} from './utils/broker/money.js';

/**
 * Virtual broker. No DB handle, no pipeline imports — replayable in a test.
 *
 * Assumptions: long only, one position per symbol, perfect instant fills
 * (no slippage, spread, fees or partial fills).
 */

export class PaperBroker {
  constructor({ startingBalance = STARTING_BALANCE } = {}) {
    this.startingBalance = parseMoney(startingBalance);

    if (this.startingBalance < 0n) {
      throw new TypeError('startingBalance cannot be negative');
    }

    this.cash = this.startingBalance;

    // symbol -> { symbol, quantity, entryPrice, openedAt }
    this.positions = new Map();

    // symbol -> latest seen price, for marking open positions to market
    this.marks = new Map();

    this.trades = [];
    this.nextTradeId = 1;
  }

  /** Latest price, for marking open positions between orders. */
  mark(symbol, price) {
    const scaled = parseMoney(price);
    if (scaled > 0n) this.marks.set(symbol, scaled);
  }

  /** @param {string} price candle close as a string, never a float. */
  executeOrder(signal, price, symbol) {
    if (signal !== SIDE.BUY && signal !== SIDE.SELL) {
      return this.#reject(REJECT_REASON.INVALID_SIGNAL, `Unknown signal "${signal}"`);
    }

    if (typeof symbol !== 'string' || symbol.trim() === '') {
      return this.#reject(REJECT_REASON.INVALID_SYMBOL, 'Symbol must be a non-empty string');
    }

    let priceScaled;
    try {
      priceScaled = parseMoney(price);
    } catch (err) {
      return this.#reject(REJECT_REASON.INVALID_PRICE, err.message);
    }

    if (priceScaled <= 0n) {
      return this.#reject(REJECT_REASON.INVALID_PRICE, `Price must be positive, got ${price}`);
    }

    this.marks.set(symbol, priceScaled);

    return signal === SIDE.BUY
      ? this.#openLong(symbol, priceScaled)
      : this.#closeLong(symbol, priceScaled);
  }

  #reject(reason, detail) {
    return { accepted: false, reason, detail };
  }

  #openLong(symbol, priceScaled) {
    if (this.positions.has(symbol)) {
      return this.#reject(
        REJECT_REASON.ALREADY_LONG,
        `Already holding ${this.positions.get(symbol).quantity} ${symbol}`
      );
    }

    // BigInt division floors — that is the whole-units rule, for free.
    const quantity = affordableUnits(this.cash, priceScaled);

    if (quantity < MIN_QUANTITY) {
      return this.#reject(
        REJECT_REASON.INSUFFICIENT_FUNDS,
        `${formatMoney(this.cash)} cannot buy ${MIN_QUANTITY} ${symbol} at ${formatMoney(priceScaled)}`
      );
    }

    const cost = notional(priceScaled, quantity);

    // Unreachable by construction; the balance floor is worth asserting anyway.
    if (cost > this.cash) {
      return this.#reject(REJECT_REASON.INSUFFICIENT_FUNDS, 'Cost exceeds available cash');
    }

    this.cash -= cost;

    const position = {
      symbol,
      quantity,
      entryPrice: priceScaled,
      openedAt: Date.now(),
    };
    this.positions.set(symbol, position);

    return {
      accepted: true,
      side: SIDE.BUY,
      symbol,
      quantity,
      price: formatMoney(priceScaled),
      cost: formatMoney(cost),
      balance: formatMoney(this.cash),
      position: this.#describePosition(position),
    };
  }

  #closeLong(symbol, priceScaled) {
    const position = this.positions.get(symbol);

    if (!position) {
      // Normal: a strategy's first crossover often sells into a flat book.
      return this.#reject(REJECT_REASON.NO_POSITION, `No open position in ${symbol}`);
    }

    const proceeds = notional(priceScaled, position.quantity);

    // Exact: scaled integers times a whole quantity.
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
      trade: this.#describeTrade(trade),
    };
  }

  #describePosition(position) {
    const mark = this.marks.get(position.symbol) ?? position.entryPrice;
    const quantity = BigInt(position.quantity);

    const costBasis = position.entryPrice * quantity;
    const marketValue = mark * quantity;

    return {
      symbol: position.symbol,
      quantity: position.quantity,
      entryPrice: formatMoney(position.entryPrice),
      markPrice: formatMoney(mark),
      costBasis: formatMoney(costBasis),
      marketValue: formatMoney(marketValue),
      unrealizedPnl: formatMoney(marketValue - costBasis),
      openedAt: position.openedAt,
    };
  }

  #describeTrade(trade) {
    return {
      id: trade.id,
      symbol: trade.symbol,
      side: trade.side,
      quantity: trade.quantity,
      entryPrice: formatMoney(trade.entryPrice),
      exitPrice: formatMoney(trade.exitPrice),
      pnl: formatMoney(trade.pnl),
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
    };
  }

  /** Open positions, each marked to the latest price seen. */
  getPositions() {
    return [...this.positions.values()].map((position) => this.#describePosition(position));
  }

  /** Closed trades, oldest first, each with its realized PnL. */
  getTrades() {
    return this.trades.map((trade) => this.#describeTrade(trade));
  }

  /** Uninvested cash, not equity — see getSummary(). */
  getBalance() {
    return formatMoney(this.cash);
  }

  /** Cash + market value. Balance alone drops on every buy, which is not a loss. */
  getSummary() {
    const positions = this.getPositions();

    const positionValue = [...this.positions.values()].reduce(
      (total, position) =>
        total + (this.marks.get(position.symbol) ?? position.entryPrice) * BigInt(position.quantity),
      0n
    );

    const realizedPnl = this.trades.reduce((total, trade) => total + trade.pnl, 0n);
    const equity = this.cash + positionValue;

    return {
      startingBalance: formatMoney(this.startingBalance),
      balance: formatMoney(this.cash),
      positionValue: formatMoney(positionValue),
      equity: formatMoney(equity),
      realizedPnl: formatMoney(realizedPnl),
      unrealizedPnl: formatMoney(positionValue - this.#costBasisTotal()),
      totalPnl: formatMoney(equity - this.startingBalance),
      openPositions: positions.length,
      closedTrades: this.trades.length,
    };
  }

  #costBasisTotal() {
    return [...this.positions.values()].reduce(
      (total, position) => total + position.entryPrice * BigInt(position.quantity),
      0n
    );
  }
}
