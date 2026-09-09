const money = (value) => (value === undefined || value === null ? '—' : Number(value).toFixed(2));

const signClass = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '';
  return n > 0 ? ' num--up' : ' num--down';
};

/** Cash, equity and open positions. Updates on every account frame. */
export const AccountPanel = ({ account }) => {
  if (!account) {
    return <section className="panel"><h2 className="panel__title">Account</h2><p className="panel__empty">Loading…</p></section>;
  }

  const positions = account.positions ?? [];

  return (
    <section className="panel">
      <h2 className="panel__title">Account</h2>

      <dl className="stats">
        <div className="stat"><dt>Cash</dt><dd>{money(account.balance)}</dd></div>
        <div className="stat"><dt>Equity</dt><dd>{money(account.equity)}</dd></div>
        <div className="stat">
          <dt>Realized</dt>
          <dd className={signClass(account.realizedPnl)}>{money(account.realizedPnl)}</dd>
        </div>
        <div className="stat">
          <dt>Unrealized</dt>
          <dd className={signClass(account.unrealizedPnl)}>{money(account.unrealizedPnl)}</dd>
        </div>
      </dl>

      <h3 className="panel__sub">Open positions</h3>

      {positions.length === 0 ? (
        <p className="panel__empty">Flat</p>
      ) : (
        <div className="tablewrap">
          <table className="table">
            <thead>
              <tr><th>Symbol</th><th>Qty</th><th>Entry</th><th>Mark</th><th>Unreal.</th></tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.symbol}>
                  <td>{p.symbol}</td>
                  <td className="num">{p.quantity}</td>
                  <td className="num">{money(p.entryPrice)}</td>
                  <td className="num">{money(p.markPrice)}</td>
                  <td className={`num${signClass(p.unrealizedPnl)}`}>{money(p.unrealizedPnl)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};
