import { memo } from 'react';
import { useStrategyBuilder } from '../hooks/useStrategyBuilder.js';
import { OPERAND_KINDS, OPERATORS, PRICE_FIELDS } from '../utils/strategy/builder.js';

const Operand = ({ kind, value, indicators, onKind, onValue, disabled }) => (
  <>
    <select className="rule__kind" value={kind} onChange={(e) => onKind(e.target.value)} disabled={disabled}>
      {OPERAND_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
    </select>

    {kind === 'const' ? (
      <input
        className="rule__value" type="number" value={value} placeholder="0"
        onChange={(e) => onValue(e.target.value)} disabled={disabled}
      />
    ) : (
      <select className="rule__value" value={value} onChange={(e) => onValue(e.target.value)} disabled={disabled}>
        <option value="">choose…</option>
        {(kind === 'price' ? PRICE_FIELDS : indicators).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    )}
  </>
);

const Section = ({ side, title, hint, section, errors, indicators, builder }) => (
  <div className="rules">
    <div className="rules__head">
      <h3 className="rules__title">{title}</h3>
      <select
        className="rules__combinator"
        value={section.combinator}
        onChange={(e) => builder.setCombinator(side, e.target.value)}
        disabled={builder.busy}
      >
        <option value="all">all must be true</option>
        <option value="any">any may be true</option>
      </select>
    </div>

    <p className="rules__hint">{hint}</p>

    {section.rows.map((row) => {
      const rowErrors = errors[row.rowId] ?? [];

      return (
        <div key={row.rowId} className={`rule${rowErrors.length ? ' rule--bad' : ''}`}>
          <div className="rule__line">
            <Operand
              kind={row.leftKind} value={row.leftValue} indicators={indicators} disabled={builder.busy}
              onKind={(v) => builder.setRowField(side, row.rowId, 'leftKind', v)}
              onValue={(v) => builder.setRowField(side, row.rowId, 'leftValue', v)}
            />

            <select
              className="rule__op" value={row.op} disabled={builder.busy}
              onChange={(e) => builder.setRowField(side, row.rowId, 'op', e.target.value)}
            >
              {OPERATORS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>

            <Operand
              kind={row.rightKind} value={row.rightValue} indicators={indicators} disabled={builder.busy}
              onKind={(v) => builder.setRowField(side, row.rowId, 'rightKind', v)}
              onValue={(v) => builder.setRowField(side, row.rowId, 'rightValue', v)}
            />

            <button
              type="button" className="rule__remove" title="Remove condition"
              onClick={() => builder.removeRow(side, row.rowId)}
              disabled={builder.busy || section.rows.length === 1}
            >×</button>
          </div>

          {rowErrors.map((e, i) => <p key={i} className="rule__error">{e.message}</p>)}
        </div>
      );
    })}

    <button
      type="button" className="btn btn--ghost"
      onClick={() => builder.addRow(side, indicators[0])}
      disabled={builder.busy}
    >+ condition</button>
  </div>
);

/**
 * Builds a rule strategy from the indicators the server says it computes.
 * Nothing here is hardcoded — remove an indicator server-side and it vanishes.
 */
const StrategyBuilderImpl = ({ indicators = [], timeframes = [], timeframe = '1m' }) => {
  const builder = useStrategyBuilder({ timeframe });
  const { draft, status, rowErrors } = builder;

  return (
    <section className="panel panel--builder">
      <div className="panel__head">
        <h2 className="panel__title">Strategy builder</h2>
        {builder.editingId && <span className="badge badge--off">editing #{builder.editingId}</span>}
      </div>

      <div className="builder__meta">
        <label className="field">
          <span className="field__label">name</span>
          <input
            className="field__input" value={draft.name} placeholder="Pullback in an uptrend"
            onChange={(e) => builder.setField('name', e.target.value)} disabled={builder.busy}
          />
        </label>

        <label className="field">
          <span className="field__label">timeframe</span>
          <select
            className="field__input" value={draft.timeframe} disabled={builder.busy}
            onChange={(e) => builder.setField('timeframe', e.target.value)}
          >
            {timeframes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      </div>

      <Section
        side="entry" title="Entry" hint="When to open a position"
        section={draft.entry} errors={rowErrors.entry} indicators={indicators} builder={builder}
      />
      <Section
        side="exit" title="Exit" hint="When to close it"
        section={draft.exit} errors={rowErrors.exit} indicators={indicators} builder={builder}
      />

      {rowErrors.document.map((e, i) => (
        <p key={i} className="panel__error">{e.path ? `${e.path}: ` : ''}{e.message}</p>
      ))}

      <div className="form__actions">
        <button type="button" className="btn btn--primary" onClick={builder.save} disabled={builder.busy || !builder.valid}>
          {builder.editingId ? 'Update' : 'Save'}
        </button>
        <button type="button" className="btn" onClick={builder.reset} disabled={builder.busy}>New</button>
      </div>

      {status && <p className={status.kind === 'ok' ? 'panel__note' : 'panel__error'}>{status.message}</p>}

      {builder.saved.length > 0 && (
        <div className="saved">
          <h3 className="rules__title">Saved</h3>
          {builder.saved.map((s) => (
            <div key={s.id} className="saved__row">
              <button type="button" className="saved__name" onClick={() => builder.load(s)} disabled={builder.busy}>
                {s.name}
                <span className="saved__meta">{s.document.timeframe} · {s.indicators.join(' ')}</span>
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => builder.start(s.id)} disabled={builder.busy}>Run</button>
              <button type="button" className="rule__remove" onClick={() => builder.remove(s.id)} disabled={builder.busy}>×</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

export const StrategyBuilder = memo(StrategyBuilderImpl);
