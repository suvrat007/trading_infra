import { useEffect, useState } from 'react';

/**
 * Strategy selection and parameters.
 *
 * The form is generated from `status.defaults` — the server decides which
 * strategies exist and which parameters each takes. Adding a strategy on the
 * backend makes it appear here with the right inputs and no frontend change.
 */
export const StrategyControls = ({ status, error, busy, onStart, onStop }) => {
  const [name, setName] = useState('');
  const [params, setParams] = useState({});

  // Seed from whatever is running, or from the defaults for the first option.
  useEffect(() => {
    if (!status || name) return;

    const current = status.strategy?.type?.replace('Strategy', '').toLowerCase();
    const initial = status.available.includes(current) ? current : status.available[0];

    setName(initial);
    setParams({ ...status.defaults[initial] });
  }, [status, name]);

  if (!status) return <section className="panel"><h2 className="panel__title">Strategy</h2><p className="panel__empty">Loading…</p></section>;

  const selectStrategy = (next) => {
    setName(next);
    setParams({ ...status.defaults[next] });
  };

  // Inputs are numeric but held as strings so a half-typed "1" does not become
  // 1 and fight the user; conversion happens once, on submit.
  const setParam = (key, value) => setParams((current) => ({ ...current, [key]: value }));

  const submit = (event) => {
    event.preventDefault();
    onStart(name, Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, Number(value)])
    ));
  };

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Strategy</h2>
        <span className={`badge badge--${status.running ? 'on' : 'off'}`}>
          {status.running ? 'Running' : 'Stopped'}
        </span>
      </div>

      {status.strategy && (
        <p className="panel__note">{status.strategy.name}</p>
      )}

      <form className="form" onSubmit={submit}>
        <label className="field">
          <span className="field__label">Strategy</span>
          <select
            className="field__input"
            value={name}
            onChange={(event) => selectStrategy(event.target.value)}
            disabled={busy}
          >
            {status.available.map((option) => (
              <option key={option} value={option}>{option.toUpperCase()}</option>
            ))}
          </select>
        </label>

        {Object.entries(params).map(([key, value]) => (
          <label className="field" key={key}>
            <span className="field__label">{key}</span>
            <input
              className="field__input"
              type="number"
              value={value}
              onChange={(event) => setParam(key, event.target.value)}
              disabled={busy}
            />
          </label>
        ))}

        <div className="form__actions">
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {status.running ? 'Restart' : 'Start'}
          </button>
          <button
            type="button"
            className="btn"
            onClick={onStop}
            disabled={busy || !status.running}
          >
            Stop
          </button>
        </div>
      </form>

      {error && <p className="panel__error">{error}</p>}

      <p className="panel__hint">
        Stopping liquidates every open position at the last traded price.
      </p>
    </section>
  );
};
