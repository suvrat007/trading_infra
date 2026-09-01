import { TOGGLE_GROUPS } from '../constants/indicators.js';

/**
 * Show/hide controls, one per indicator group.
 *
 * Real <input type="checkbox"> elements rather than styled divs: they are
 * focusable, toggle with the keyboard, announce their checked state to screen
 * readers, and pair with a <label> so the whole chip is a click target. None of
 * that comes free with a div and an onClick.
 */
export function IndicatorToggles({ visibility, onToggle }) {
  return (
    <div className="toggles" role="group" aria-label="Indicators">
      {TOGGLE_GROUPS.map((group) => {
        const checked = Boolean(visibility[group.id]);

        return (
          <label
            key={group.id}
            className={`toggle${checked ? ' toggle--on' : ''}`}
            style={checked ? { borderColor: group.color } : undefined}
          >
            <input
              type="checkbox"
              className="toggle__input"
              checked={checked}
              onChange={() => onToggle(group.id)}
            />
            <span className="toggle__swatch" style={{ backgroundColor: group.color }} aria-hidden="true" />
            <span className="toggle__label">{group.label}</span>
          </label>
        );
      })}
    </div>
  );
}
