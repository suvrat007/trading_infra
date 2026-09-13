/**
 * Abstract base for every trading strategy.
 *
 * JavaScript has no `abstract` keyword, so "abstract" is enforced at runtime by
 * two guards: the constructor refuses to build a bare Strategy, and onCandle()
 * throws unless a subclass replaces it. Both fail immediately and name the
 * class, rather than producing an object that silently never signals.
 *
 * The contract deliberately mirrors the Strategy pattern: the runner holds a
 * reference of this type and calls onCandle() without knowing or caring which
 * concrete strategy it has. Adding a strategy therefore requires no change to
 * the runner, the broker, the database, or the frontend.
 */
export class Strategy {
  /**
   * @param {string} name  human-readable, shown in logs and the UI
   * @param {object} params  frozen after construction — see below
   */
  constructor(name, params = {}) {
    if (new.target === Strategy) {
      throw new TypeError('Strategy is abstract and cannot be instantiated directly');
    }

    if (typeof name !== 'string' || name.trim() === '') {
      throw new TypeError('Strategy name must be a non-empty string');
    }

    this.name = name;

    // Frozen because a strategy's parameters define what its recorded trades
    // MEAN. Mutating fastPeriod halfway through a session would silently make
    // the trade history describe two different strategies under one name.
    this.params = Object.freeze({ ...params });
  }

  getName() {
    return this.name;
  }

  getParams() {
    return this.params;
  }

  /**
   * Wire names this strategy reads from the indicator payload.
   *
   * Declared rather than discovered so the wiring layer can verify at STARTUP
   * that the engine produces them, instead of finding out through a strategy
   * that never fires.
   *
   * @returns {string[]}
   */
  requiredIndicators() {
    return [];
  }

  /**
   * Called once per CLOSED candle.
   *
   * @param {object} candle      the candle that just closed (prices are strings)
   * @param {object} indicators  latest scalar value per wire name; may be null
   *                             if the engine failed, and individual values may
   *                             be null while an indicator is still warming up
   * @param {object} [context]   { hasPosition } — for strategies whose exit
   *                             depends on whether we are holding
   * @returns {'BUY'|'SELL'|null}  null on almost every candle
   */
  // eslint-disable-next-line no-unused-vars
  onCandle(candle, indicators, context) {
    throw new Error(`${this.constructor.name} must implement onCandle(candle, indicators)`);
  }

  /**
   * Discard any accumulated state (crossover history, and later position
   * awareness). Called when a strategy is swapped in, or after a gap in the
   * candle stream large enough that the previous relationship is meaningless.
   */
  reset() {}

  /**
   * Pull this strategy's required indicators out of the payload.
   *
   * Returns null if the payload is missing or any required value has not warmed
   * up yet — so subclasses can bail with a single check instead of testing each
   * value. Warmup is a normal condition, not an error.
   *
   * @protected
   */
  readIndicators(indicators) {
    if (!indicators) return null;

    const values = {};

    for (const key of this.requiredIndicators()) {
      const value = indicators[key];
      if (value === null || value === undefined || !Number.isFinite(value)) return null;
      values[key] = value;
    }

    return values;
  }

  /** Stable shape for logs, API responses and the UI. */
  describe() {
    return {
      name: this.getName(),
      type: this.constructor.name,
      params: this.getParams(),
      indicators: this.requiredIndicators(),
    };
  }
}
