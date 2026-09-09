import './env.js';

/** Virtual starting cash. A string, because it is money — see utils/broker/money.js. */
export const STARTING_BALANCE = process.env.STARTING_BALANCE || '10000.00';

export const SIDE = {
  BUY: 'BUY',
  SELL: 'SELL',
};

/**
 * Orders are rejected far more often than they fail.
 *
 * A rejection is a normal business outcome — no cash, no position, nothing to
 * do — not an exception. Returning a reason instead of throwing means the
 * caller handles "did not trade" the same way it handles "traded", and the
 * reason is recorded rather than swallowed.
 */
export const REJECT_REASON = {
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  ALREADY_LONG: 'ALREADY_LONG',
  NO_POSITION: 'NO_POSITION',
  INVALID_PRICE: 'INVALID_PRICE',
  INVALID_SIGNAL: 'INVALID_SIGNAL',
  INVALID_SYMBOL: 'INVALID_SYMBOL',
  NO_MARK_PRICE: 'NO_MARK_PRICE',
};

/**
 * Whole units only, at least one per order.
 *
 * Worth being explicit about what this means here: BTC trades around $78,000,
 * so one whole unit costs roughly eight times the entire starting balance. On
 * BTCUSDT this broker can never open a position — every BUY is rejected with
 * INSUFFICIENT_FUNDS, correctly and by design.
 *
 * That is a property of the constraints, not a bug, and the rejection is
 * returned and logged rather than silently doing nothing, so it looks like a
 * refused order instead of a broken strategy. Three ways out, all of them a
 * configuration change rather than a code change: raise STARTING_BALANCE,
 * allow fractional units (the NUMERIC(18,8) columns already support 8 decimal
 * places), or trade a cheaper symbol.
 */
export const MIN_QUANTITY = 1;
export const ALLOW_FRACTIONAL = false;
