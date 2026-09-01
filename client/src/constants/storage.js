/**
 * Persistence configuration for the Redux store.
 *
 * `PERSIST_VERSION` is the migration handle. Bump it whenever the shape of a
 * persisted slice changes incompatibly — redux-persist will then discard the
 * stored state (or run a migration) instead of rehydrating a shape the current
 * reducers do not understand.
 */
export const PERSIST_KEY = 'lli';
export const PERSIST_VERSION = 1;

/**
 * Only these slices survive a reload.
 *
 * An allowlist rather than a denylist: a slice added later must be opted in
 * deliberately, so nothing accidentally starts persisting server data or
 * transient UI state that should reset.
 */
export const PERSISTED_SLICES = ['indicatorVisibility'];
