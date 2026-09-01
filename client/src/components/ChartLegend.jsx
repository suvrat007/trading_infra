import { OVERLAY_SERIES, PANEL_DEFINITIONS, PANEL_SERIES } from '../constants/indicators.js';

/**
 * Names every series on the chart and shows its current value.
 *
 * Nine unlabelled series across three panes are unreadable, and the panes
 * themselves carry no titles. Values come from the latest candle's
 * `indicators`, so this doubles as a live readout. Step 5 turns these rows into
 * toggles.
 */

/** RSI is the one series where the number itself carries a verdict. */
function rsiTone(value) {
  if (typeof value !== 'number') return '';
  if (value >= 70) return ' legend__value--high';
  if (value <= 30) return ' legend__value--low';
  return '';
}

function LegendRow({ definition, value }) {
  const tone = definition.key === 'rsi14' ? rsiTone(value) : '';

  return (
    <li className="legend__item">
      <span
        className="legend__swatch"
        style={{
          backgroundColor: definition.color,
          // Mirror the dashed line style so the swatch matches the chart.
          opacity: definition.lineStyle === 'dashed' ? 0.55 : 1,
          height: definition.type === 'histogram' ? '8px' : '2px',
        }}
        aria-hidden="true"
      />
      <span className="legend__label">{definition.label}</span>
      <span className={`legend__value${tone}`}>
        {typeof value === 'number' ? value.toFixed(2) : '—'}
      </span>
    </li>
  );
}

export function ChartLegend({ values, visibility }) {
  const shown = (groupId) => visibility?.[groupId] !== false;
  const overlays = OVERLAY_SERIES.filter((definition) => shown(definition.group));
  const panels = PANEL_DEFINITIONS.filter((panel) => shown(panel.id));

  // Everything hidden: drop the box entirely rather than leave an empty frame.
  if (overlays.length === 0 && panels.length === 0) return null;

  return (
    <div className="legend">
      {overlays.length > 0 && (
      <ul className="legend__group">
        {overlays.map((definition) => (
          <LegendRow key={definition.key} definition={definition} value={values?.[definition.key]} />
        ))}
      </ul>
      )}

      {panels.map((panel) => (
        <ul className="legend__group" key={panel.id}>
          <li className="legend__heading">{panel.label}</li>
          {PANEL_SERIES.filter((definition) => definition.group === panel.id).map((definition) => (
            <LegendRow key={definition.key} definition={definition} value={values?.[definition.key]} />
          ))}
        </ul>
      ))}
    </div>
  );
}
