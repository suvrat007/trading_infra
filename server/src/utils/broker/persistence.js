import { pool } from '../../db.js';
import {
  SQL_DELETE_POSITION,
  SQL_INSERT_POSITION,
  SQL_INSERT_TRADE,
  SQL_SELECT_ALL_TRADES,
  SQL_SELECT_POSITIONS,
  SQL_SELECT_TRADES,
} from '../../constants/sql.js';

/** Persistence for the broker's books. The broker itself stays I/O free. */

export const savePosition = async (position) => {
  const { rows } = await pool.query(SQL_INSERT_POSITION, [
    position.symbol,
    position.quantity,
    position.entryPrice,
    position.openedAt,
  ]);
  return rows[0]?.id ?? null;
};

export const deletePosition = async (symbol) => {
  const { rowCount } = await pool.query(SQL_DELETE_POSITION, [symbol]);
  return rowCount;
};

/**
 * Close a position and record the trade ATOMICALLY.
 *
 * Two writes, one transaction. Restored cash is derived as
 * `starting - open cost basis + realized PnL`, so a crash between them would
 * drop the position from the cost basis without adding its PnL — the books
 * would silently be wrong by exactly that trade's profit.
 */
export const closePosition = async (symbol, trade) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(SQL_DELETE_POSITION, [symbol]);

    const { rows } = await client.query(SQL_INSERT_TRADE, [
      trade.symbol,
      trade.side,
      trade.quantity,
      trade.entryPrice,
      trade.exitPrice,
      trade.pnl,
      trade.openedAt,
      trade.closedAt,
    ]);

    await client.query('COMMIT');
    return rows[0].id;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/** Everything the broker needs to rebuild its state, oldest trade first. */
export const loadBooks = async () => {
  const [positions, trades] = await Promise.all([
    pool.query(SQL_SELECT_POSITIONS),
    pool.query(SQL_SELECT_ALL_TRADES),
  ]);

  return { positions: positions.rows, trades: trades.rows };
};

export const loadTrades = async (limit) => {
  const { rows } = await pool.query(SQL_SELECT_TRADES, [limit]);
  return rows;
};
