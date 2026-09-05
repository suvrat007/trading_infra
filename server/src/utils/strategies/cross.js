import { CROSS } from '../../constants/strategies.js';

/**
 * Detects when one series crosses another.
 *
 * This is THE stateful piece of the whole system, and deliberately so. A cross
 * is defined by two consecutive observations — "a is now above b and was below"
 * — so it cannot be derived from a single candle no matter how many indicators
 * come with it. The engine that computes indicators is stateless; a strategy
 * cannot be.
 *
 * Isolating that state here means each strategy holds one small, resettable
 * object rather than scattering `this.previousSomething` across a class body,
 * and it can be tested exhaustively on its own.
 */
export function createCrossTracker() {
  // null = nothing observed yet, so no cross is possible.
  let previousAbove = null;

  return {
    /**
     * Feed one observation. Returns CROSS.UP when `a` has just risen above `b`,
     * CROSS.DOWN when it has just fallen below, and null otherwise.
     */
    update(a, b) {
      // Warmup: an indicator that has not produced a value yet must not be
      // treated as zero, and must not advance the state — otherwise the first
      // real value would look like a cross against nothing.
      if (a === null || a === undefined || !Number.isFinite(a)) return null;
      if (b === null || b === undefined || !Number.isFinite(b)) return null;

      // Exactly equal carries no directional information. Deliberately leave
      // the previous side intact: if the lines touch and then separate the same
      // way they came, that is not a cross, and treating equality as a side
      // would manufacture two spurious signals.
      if (a === b) return null;

      const isAbove = a > b;
      const wasAbove = previousAbove;
      previousAbove = isAbove;

      // First real observation establishes the side; a cross needs a previous.
      if (wasAbove === null) return null;
      if (isAbove === wasAbove) return null;

      return isAbove ? CROSS.UP : CROSS.DOWN;
    },

    /** Forget the previous side — used when a strategy is swapped or restarted. */
    reset() {
      previousAbove = null;
    },

    /** Exposed for tests and diagnostics; null until the first real value. */
    get previousAbove() {
      return previousAbove;
    },
  };
}
