import { memo } from 'react';

/**
 * Timeframe picker.
 *
 * Every button comes from the server's list. A timeframe with no rows yet is
 * shown but disabled — which is the normal state for 1d in the first day of
 * running, and far less confusing than hiding it and having it appear later.
 */
const TimeframeSelectorImpl = ({ timeframes, selected, onSelect }) => {
  if (timeframes.length === 0) return null;

  return (
    <div className="timeframes" role="group" aria-label="Timeframe">
      {timeframes.map((timeframe) => {
        const empty = timeframe.count === 0;

        return (
          <button
            key={timeframe.id}
            type="button"
            className={`timeframes__btn${timeframe.id === selected ? ' timeframes__btn--on' : ''}`}
            onClick={() => onSelect(timeframe.id)}
            disabled={empty || !timeframe.active}
            title={
              empty
                ? `No ${timeframe.label} candles stored yet`
                : `${timeframe.count.toLocaleString()} candles in ${timeframe.table}`
            }
            aria-pressed={timeframe.id === selected}
          >
            {timeframe.label}
          </button>
        );
      })}
    </div>
  );
};

export const TimeframeSelector = memo(TimeframeSelectorImpl);
