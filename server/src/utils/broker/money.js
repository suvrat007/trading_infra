/**
 * Exact money arithmetic on scaled integers.
 *
 * Everything else in this system keeps prices as strings precisely so no
 * rounding error can touch them. Doing the broker's arithmetic in JS floats
 * would throw that away at the last step — and cash and PnL are the two numbers
 * where it matters most, because errors ACCUMULATE across every trade rather
 * than being recomputed from scratch like an indicator.
 *
 * Indicators had no choice: an EMA multiplier is irrational and a standard
 * deviation needs a square root, neither of which exists in exact decimal. The
 * broker only ever adds, subtracts and multiplies by a whole quantity — all
 * exactly representable. So there is no excuse for a float here.
 *
 * Representation: a BigInt scaled by 10^8, matching NUMERIC(18,8) in Postgres,
 * which is also the precision Binance quotes. "78000.5" is 7800050000000n.
 */

export const MONEY_SCALE = 8;
const FACTOR = 10n ** BigInt(MONEY_SCALE);

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/**
 * Decimal string -> scaled BigInt.
 *
 * Rejects excess precision rather than truncating it. Silently dropping digits
 * from money is exactly the class of bug this module exists to prevent, and
 * every real input here (Binance, NUMERIC(18,8)) already fits in 8 places —
 * so more than 8 significant decimals means something upstream is wrong.
 */
export const parseMoney = (value) => {
  const text = String(value).trim();

  if (!DECIMAL_PATTERN.test(text)) {
    throw new TypeError(`Not a decimal amount: "${value}"`);
  }

  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');

  if (fraction.length > MONEY_SCALE) {
    const excess = fraction.slice(MONEY_SCALE);
    // Trailing zeros carry no value, so "1.000000000" is fine; "1.000000001" is not.
    if (/[1-9]/.test(excess)) {
      throw new TypeError(
        `"${value}" has more than ${MONEY_SCALE} decimal places; refusing to truncate money`
      );
    }
  }

  const padded = (fraction + '0'.repeat(MONEY_SCALE)).slice(0, MONEY_SCALE);
  const scaled = BigInt(whole) * FACTOR + BigInt(padded);

  return negative ? -scaled : scaled;
};

/** Scaled BigInt -> decimal string, always with exactly MONEY_SCALE places. */
export const formatMoney = (scaled) => {
  const negative = scaled < 0n;
  const absolute = negative ? -scaled : scaled;

  const whole = absolute / FACTOR;
  const fraction = (absolute % FACTOR).toString().padStart(MONEY_SCALE, '0');

  return `${negative ? '-' : ''}${whole}.${fraction}`;
};

/**
 * Cost of `quantity` whole units at `priceScaled`.
 *
 * Scaled x integer stays scaled, so no rescaling and no rounding step — which
 * is the whole reason quantities are whole units in this design.
 */
export const notional = (priceScaled, quantity) => priceScaled * BigInt(quantity);

/**
 * How many whole units `cashScaled` can buy at `priceScaled`.
 *
 * Both operands carry the same scale, so it cancels and BigInt division floors
 * — exactly the "no fractional units" rule, for free and without a Math.floor
 * on a float that might have landed at 2.9999999999999996.
 */
export const affordableUnits = (cashScaled, priceScaled) => {
  if (priceScaled <= 0n) return 0;
  return Number(cashScaled / priceScaled);
};

/**
 * For JSON and logs ONLY.
 *
 * This is the lossy exit. Never feed the result back into a calculation — the
 * scaled BigInt is the value of record, and this is a rendering of it.
 */
export const toNumber = (scaled) => Number(formatMoney(scaled));
