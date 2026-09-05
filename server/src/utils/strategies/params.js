import { INDICATOR_KEYS } from '../../constants/indicators.js';

/**
 * Parameter validation for strategies.
 *
 * All of these throw. A bad parameter is a programmer or configuration error
 * caught at CONSTRUCTION, before the strategy ever sees a candle — the
 * alternative is a strategy that silently reads `undefined` from the indicator
 * payload and therefore never signals, which looks exactly like a strategy that
 * simply has not found a setup yet.
 */

export function assertPositiveInteger(value, name) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer, received ${value}`);
  }
}

export function assertOrdered(smaller, larger, smallerName, largerName) {
  if (smaller >= larger) {
    throw new TypeError(
      `${smallerName} (${smaller}) must be smaller than ${largerName} (${larger})`
    );
  }
}

export function assertInRange(value, name, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new TypeError(`${name} must be a number between ${min} and ${max}, received ${value}`);
  }
}

/**
 * A strategy reads indicators by wire name. If the engine does not produce that
 * name, say so now and list what is available — rather than letting the
 * strategy read undefined on every candle for the life of the process.
 *
 * This is the seam where the strategy layer's dependency on the indicator
 * engine becomes visible, and it is worth it being visible.
 */
export function assertIndicatorAvailable(key, context) {
  if (INDICATOR_KEYS.includes(key)) return;

  throw new TypeError(
    `${context} needs indicator "${key}", which this engine does not compute. ` +
    `Available: ${INDICATOR_KEYS.join(', ')}`
  );
}

/** Reject unknown parameter names rather than ignoring a typo like `fastPerid`. */
export function assertKnownParams(params, defaults, context) {
  const allowed = Object.keys(defaults);

  for (const key of Object.keys(params)) {
    if (!allowed.includes(key)) {
      throw new TypeError(
        `${context} received unknown parameter "${key}". Expected one of: ${allowed.join(', ')}`
      );
    }
  }
}
