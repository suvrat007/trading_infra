const money = (value) => Number(value).toFixed(2);
const clock = (ms) => new Date(Number(ms)).toISOString().slice(11, 19);

/** Closed round trips, newest first. Green for profit, red for loss. */
export const TradeBlotter = ({ trades }) => (
  <section className="panel panel--grow">
    <div className="panel__head">
      <h2 className="panel__title">Trades</h2>
      <span className="panel__count">{trades.length}</span>
    </div>

    {trades.length === 0 ? (
      <p className="panel__empty">No closed trades yet</p>
    ) : (
      <div className="tablewrap tablewrap--scroll">
        <table className="table">
          <thead>
            <tr><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Entry</th><th>Exit</th><th>PnL</th></tr>
          </thead>
          <tbody>
            {trades.map((t) => {
              const pnl = Number(t.pnl);
              return (
                <tr key={t.id} className={pnl >= 0 ? 'row--up' : 'row--down'}>
                  <td className="num">{clock(t.closed_at)}</td>
                  <td>{t.symbol}</td>
                  <td>{t.side}</td>
                  <td className="num">{Number(t.quantity)}</td>
                  <td className="num">{money(t.entry_price)}</td>
                  <td className="num">{money(t.exit_price)}</td>
                  <td className={`num ${pnl >= 0 ? 'num--up' : 'num--down'}`}>
                    {pnl >= 0 ? '+' : ''}{money(t.pnl)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </section>
);
