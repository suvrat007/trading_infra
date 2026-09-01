import { useCallback, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { TOGGLE_GROUPS } from '../constants/indicators.js';
import { selectVisibility, visibilityToggled } from '../store/indicatorVisibilitySlice.js';

/**
 * Bridges Redux visibility state to the chart.
 *
 * The state lives in Redux because it drives checkboxes — real DOM that React
 * must render. The chart is told imperatively, because it is a canvas React
 * does not own. This hook is the seam between those two worlds, and it is the
 * only place that knows both exist.
 *
 * Toggling never re-seeds data: it flips a `visible` flag on series that still
 * hold their points, so turning a group back on is instant.
 */

export function useIndicatorVisibility(chartRef) {
  const visibility = useSelector(selectVisibility);
  const dispatch = useDispatch();

  useEffect(() => {
    for (const group of TOGGLE_GROUPS) {
      chartRef.current?.setGroupVisible(group.id, Boolean(visibility[group.id]));
    }
  }, [visibility, chartRef]);

  const toggle = useCallback(
    (groupId) => dispatch(visibilityToggled(groupId)),
    [dispatch]
  );

  return { visibility, toggle };
}
