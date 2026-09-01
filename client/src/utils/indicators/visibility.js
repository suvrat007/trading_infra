import { TOGGLE_GROUPS } from '../../constants/indicators.js';

/**
 * The initial visibility map: every group on.
 *
 * Derived from TOGGLE_GROUPS rather than written out, so adding an indicator
 * cannot leave a group missing from the store and silently undefined.
 */
export function defaultVisibility() {
  return Object.fromEntries(TOGGLE_GROUPS.map((group) => [group.id, true]));
}
