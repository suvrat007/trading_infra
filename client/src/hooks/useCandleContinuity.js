import { useCallback, useEffect, useRef } from 'react';
import { DEFAULT_INTERVAL, GAP_REFETCH_DEBOUNCE_MS } from '../constants/api.js';
import {
  CANDLE_ORDER,
  classifyCandle,
  intervalToMs,
  isDrawable,
} from '../utils/stream/continuity.js';

/**
 * Keeps the chart's timeline honest.
 *
 * Two jobs, both driven by one arithmetic check per candle and zero extra
 * network traffic in the normal case:
 *
 *  1. Drop a STALE candle before it reaches the chart. The library throws on an
 *     out-of-order timestamp, and that throw would land partway through
 *     updating ten series — candle drawn, some indicator lines drawn, the rest
 *     not, and an uncaught error in the socket handler.
 *
 *  2. Notice a GAP and repair it with ONE debounced refetch. Requesting history
 *     on every message would double the request count and defeat the point of
 *     having a socket; requesting only on a real discontinuity costs nothing
 *     until something actually goes wrong.
 *
 * State lives in refs, not state: the chart is drawn imperatively and none of
 * this should trigger a React render.
 */
export const useCandleContinuity = ({ interval = DEFAULT_INTERVAL, onGap } = {}) => {
  const lastOpenTimeRef = useRef(null);
  const gapTimerRef = useRef(null);
  const onGapRef = useRef(onGap);
  onGapRef.current = onGap;

  const intervalMs = intervalToMs(interval);

  useEffect(() => () => clearTimeout(gapTimerRef.current), []);

  /**
   * Called after history is (re)loaded, so the next live candle is compared
   * against what is actually on screen rather than against a pre-outage value.
   */
  const syncTo = useCallback((openTime) => {
    lastOpenTimeRef.current = openTime ?? null;

    // History has just been replaced, so any repair already queued is moot.
    clearTimeout(gapTimerRef.current);
    gapTimerRef.current = null;
  }, []);

  /**
   * @returns {{order: string, missing: number, drawable: boolean}}
   */
  const accept = useCallback((openTime) => {
    const result = classifyCandle(openTime, lastOpenTimeRef.current, intervalMs);
    const drawable = isDrawable(result.order);

    // Only advance on candles we actually drew, and never move the marker
    // backwards — a stale candle must not rewrite where the chart believes it is.
    if (drawable) lastOpenTimeRef.current = Math.max(openTime, lastOpenTimeRef.current ?? openTime);

    if (result.order === CANDLE_ORDER.GAP) {
      // Debounced: a burst of gaps during a flaky period collapses into one
      // refetch after things settle, instead of one per gap.
      clearTimeout(gapTimerRef.current);
      gapTimerRef.current = setTimeout(() => {
        gapTimerRef.current = null;
        onGapRef.current?.(result.missing);
      }, GAP_REFETCH_DEBOUNCE_MS);
    }

    return { ...result, drawable };
  }, [intervalMs]);

  return { accept, syncTo };
};
