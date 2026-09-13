import { REJECT_REASON, SIDE } from '../../constants/broker.js';
import { parseMoney } from './money.js';

export const reject = (reason, detail) => ({ accepted: false, reason, detail });

/** @returns {{rejection}|{priceScaled}} — shape of the order, before any state is touched. */
export const validateOrder = (signal, price, symbol) => {
  if (signal !== SIDE.BUY && signal !== SIDE.SELL) {
    return { rejection: reject(REJECT_REASON.INVALID_SIGNAL, `Unknown signal "${signal}"`) };
  }

  if (typeof symbol !== 'string' || symbol.trim() === '') {
    return { rejection: reject(REJECT_REASON.INVALID_SYMBOL, 'Symbol must be a non-empty string') };
  }

  let priceScaled;
  try {
    priceScaled = parseMoney(price);
  } catch (err) {
    return { rejection: reject(REJECT_REASON.INVALID_PRICE, err.message) };
  }

  if (priceScaled <= 0n) {
    return { rejection: reject(REJECT_REASON.INVALID_PRICE, `Price must be positive, got ${price}`) };
  }

  return { priceScaled };
};
