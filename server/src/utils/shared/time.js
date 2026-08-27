/** Used by more than one subsystem, so it lives in shared/ rather than either. */
export function isoTime(ms) {
  return new Date(ms).toISOString();
}
