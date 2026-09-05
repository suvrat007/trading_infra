import test from 'node:test';
import assert from 'node:assert/strict';

import { PaperBroker } from '../src/PaperBroker.js';
import { REJECT_REASON, SIDE } from '../src/constants/broker.js';
import {
  affordableUnits,
  formatMoney,
  notional,
  parseMoney,
  toNumber,
} from '../src/utils/broker/money.js';

// ---------------------------------------------------------------------------
// money
// ---------------------------------------------------------------------------

test('money: round-trips decimal strings exactly', () => {
  for (const value of ['0.00000000', '1.00000000', '78000.12345678', '-42.50000000']) {
    assert.equal(formatMoney(parseMoney(value)), value);
  }
});

test('money: normalizes to 8 decimal places', () => {
  assert.equal(formatMoney(parseMoney('100')), '100.00000000');
  assert.equal(formatMoney(parseMoney('0.5')), '0.50000000');
  assert.equal(formatMoney(parseMoney('78000.5')), '78000.50000000');
});

test('money: refuses to truncate real precision, allows trailing zeros', () => {
  assert.doesNotThrow(() => parseMoney('1.000000000'), 'trailing zeros carry no value');
  assert.throws(() => parseMoney('1.000000001'), /refusing to truncate/);
  assert.throws(() => parseMoney('abc'), TypeError);
  assert.throws(() => parseMoney(''), TypeError);
});

test('money: exact where floats are not', () => {
  // 0.1 + 0.2 !== 0.3 in IEEE 754. Here it must be exact.
  const sum = parseMoney('0.1') + parseMoney('0.2');
  assert.equal(formatMoney(sum), '0.30000000');

  // A thousand additions of a third of a cent must not drift.
  let total = 0n;
  for (let i = 0; i < 1000; i += 1) total += parseMoney('0.00333333');
  assert.equal(formatMoney(total), '3.33333000');
});

test('money: affordableUnits floors, and never divides by zero', () => {
  assert.equal(affordableUnits(parseMoney('10000'), parseMoney('78000')), 0);
  assert.equal(affordableUnits(parseMoney('10000'), parseMoney('3000')), 3);
  assert.equal(affordableUnits(parseMoney('9000'), parseMoney('3000')), 3, 'exact fit');
  assert.equal(affordableUnits(parseMoney('8999.99999999'), parseMoney('3000')), 2);
  assert.equal(affordableUnits(parseMoney('100'), 0n), 0);
});

test('money: notional is exact for large quantities', () => {
  assert.equal(formatMoney(notional(parseMoney('0.00000001'), 100000000)), '1.00000000');
  assert.equal(toNumber(parseMoney('78000.5')), 78000.5);
});

// ---------------------------------------------------------------------------
// broker — happy path
// ---------------------------------------------------------------------------

test('broker: starts flat with the full balance', () => {
  const broker = new PaperBroker();

  assert.equal(broker.getBalance(), '10000.00000000');
  assert.deepEqual(broker.getPositions(), []);
  assert.deepEqual(broker.getTrades(), []);
  assert.equal(broker.getSummary().equity, '10000.00000000');
});

test('broker: BUY spends whole units and leaves the remainder as cash', () => {
  const broker = new PaperBroker({ startingBalance: '10000' });

  const result = broker.executeOrder(SIDE.BUY, '3000', 'TESTUSDT');

  assert.equal(result.accepted, true);
  assert.equal(result.quantity, 3, 'floor(10000/3000)');
  assert.equal(result.cost, '9000.00000000');
  assert.equal(broker.getBalance(), '1000.00000000', 'change stays as cash');
});

test('broker: a round trip realizes exact PnL and returns cash', () => {
  const broker = new PaperBroker({ startingBalance: '10000' });

  broker.executeOrder(SIDE.BUY, '2000', 'TESTUSDT');   // 5 units, 10000 spent
  const sell = broker.executeOrder(SIDE.SELL, '2500', 'TESTUSDT');

  assert.equal(sell.accepted, true);
  assert.equal(sell.trade.pnl, '2500.00000000', '(2500 - 2000) x 5');
  assert.equal(broker.getBalance(), '12500.00000000');
  assert.deepEqual(broker.getPositions(), [], 'position closed');
  assert.equal(broker.getTrades().length, 1);
  assert.equal(broker.getSummary().totalPnl, '2500.00000000');
});

test('broker: a losing round trip is equally exact', () => {
  const broker = new PaperBroker({ startingBalance: '10000' });

  broker.executeOrder(SIDE.BUY, '2000', 'TESTUSDT');
  const sell = broker.executeOrder(SIDE.SELL, '1900', 'TESTUSDT');

  assert.equal(sell.trade.pnl, '-500.00000000');
  assert.equal(broker.getBalance(), '9500.00000000');
  assert.equal(broker.getSummary().totalPnl, '-500.00000000');
});

test('broker: unrealized PnL follows the mark, and equity ignores where value sits', () => {
  const broker = new PaperBroker({ startingBalance: '10000' });
  broker.executeOrder(SIDE.BUY, '2000', 'TESTUSDT'); // 5 units

  let [position] = broker.getPositions();
  assert.equal(position.unrealizedPnl, '0.00000000', 'at entry, nothing is unrealized');
  assert.equal(broker.getSummary().equity, '10000.00000000', 'buying does not change equity');

  broker.mark('TESTUSDT', '2300');
  [position] = broker.getPositions();

  assert.equal(position.markPrice, '2300.00000000');
  assert.equal(position.marketValue, '11500.00000000');
  assert.equal(position.unrealizedPnl, '1500.00000000');
  assert.equal(broker.getSummary().equity, '11500.00000000');
  assert.equal(broker.getSummary().realizedPnl, '0.00000000', 'nothing closed yet');
});

// ---------------------------------------------------------------------------
// broker — rejections
// ---------------------------------------------------------------------------

test('broker: BTC at 78k on a 10k balance can never fill', () => {
  const broker = new PaperBroker({ startingBalance: '10000' });

  const result = broker.executeOrder(SIDE.BUY, '78000.50', 'BTCUSDT');

  assert.equal(result.accepted, false);
  assert.equal(result.reason, REJECT_REASON.INSUFFICIENT_FUNDS);
  assert.match(result.detail, /cannot buy 1 BTCUSDT/);
  assert.equal(broker.getBalance(), '10000.00000000', 'a rejection costs nothing');
});

test('broker: balance never goes below zero', () => {
  const broker = new PaperBroker({ startingBalance: '10000' });

  broker.executeOrder(SIDE.BUY, '3000', 'TESTUSDT');  // 3 units, 1000 left
  const second = broker.executeOrder(SIDE.BUY, '3000', 'OTHERUSDT');

  assert.equal(second.accepted, false);
  assert.equal(second.reason, REJECT_REASON.INSUFFICIENT_FUNDS);
  assert.equal(broker.getBalance(), '1000.00000000');
  assert.ok(parseMoney(broker.getBalance()) >= 0n);
});

test('broker: a second BUY in the same symbol is rejected, not averaged in', () => {
  const broker = new PaperBroker({ startingBalance: '10000' });

  broker.executeOrder(SIDE.BUY, '1000', 'TESTUSDT');
  const second = broker.executeOrder(SIDE.BUY, '1000', 'TESTUSDT');

  assert.equal(second.accepted, false);
  assert.equal(second.reason, REJECT_REASON.ALREADY_LONG);
  assert.equal(broker.getPositions().length, 1, 'still exactly one position');
});

test('broker: SELL with nothing open is a rejection, never a short', () => {
  const broker = new PaperBroker({ startingBalance: '10000' });

  const result = broker.executeOrder(SIDE.SELL, '1000', 'TESTUSDT');

  assert.equal(result.accepted, false);
  assert.equal(result.reason, REJECT_REASON.NO_POSITION);
  assert.equal(broker.getBalance(), '10000.00000000');
  assert.deepEqual(broker.getPositions(), []);
});

test('broker: bad inputs are rejected, not thrown', () => {
  const broker = new PaperBroker({ startingBalance: '10000' });

  assert.equal(broker.executeOrder('HOLD', '100', 'X').reason, REJECT_REASON.INVALID_SIGNAL);
  assert.equal(broker.executeOrder(SIDE.BUY, '0', 'X').reason, REJECT_REASON.INVALID_PRICE);
  assert.equal(broker.executeOrder(SIDE.BUY, '-5', 'X').reason, REJECT_REASON.INVALID_PRICE);
  assert.equal(broker.executeOrder(SIDE.BUY, 'abc', 'X').reason, REJECT_REASON.INVALID_PRICE);
  assert.equal(broker.executeOrder(SIDE.BUY, '100', '').reason, REJECT_REASON.INVALID_SYMBOL);
});

test('broker: constructor rejects a negative starting balance', () => {
  assert.throws(() => new PaperBroker({ startingBalance: '-1' }), TypeError);
});

// ---------------------------------------------------------------------------
// broker — accounting invariants
// ---------------------------------------------------------------------------

test('broker: cash + position value always equals starting balance + realized PnL', () => {
  const broker = new PaperBroker({ startingBalance: '10000' });

  const sequence = [
    [SIDE.BUY, '1000'], [SIDE.SELL, '1100'],
    [SIDE.BUY, '900'],  [SIDE.SELL, '800'],
    [SIDE.BUY, '1200'],
  ];

  for (const [side, price] of sequence) {
    broker.executeOrder(side, price, 'TESTUSDT');

    const summary = broker.getSummary();
    const cashAndValue = parseMoney(summary.balance) + parseMoney(summary.positionValue);
    const expected = parseMoney(summary.startingBalance) + parseMoney(summary.realizedPnl);

    assert.equal(
      formatMoney(cashAndValue),
      formatMoney(expected),
      `books must balance after ${side} @ ${price}`
    );
  }
});

test('broker: many round trips do not drift', () => {
  const broker = new PaperBroker({ startingBalance: '10000' });

  // A price that has no exact float representation, cycled 200 times.
  for (let i = 0; i < 200; i += 1) {
    broker.executeOrder(SIDE.BUY, '0.10000000', 'TESTUSDT');
    broker.executeOrder(SIDE.SELL, '0.10000000', 'TESTUSDT');
  }

  assert.equal(broker.getBalance(), '10000.00000000', 'flat round trips must return exactly');
  assert.equal(broker.getSummary().realizedPnl, '0.00000000');
  assert.equal(broker.getTrades().length, 200);
});

test('broker: trades are ordered oldest first and carry both prices', () => {
  const broker = new PaperBroker({ startingBalance: '10000' });

  broker.executeOrder(SIDE.BUY, '1000', 'TESTUSDT');
  broker.executeOrder(SIDE.SELL, '1100', 'TESTUSDT');
  broker.executeOrder(SIDE.BUY, '1200', 'TESTUSDT');
  broker.executeOrder(SIDE.SELL, '1300', 'TESTUSDT');

  const trades = broker.getTrades();

  assert.deepEqual(trades.map((t) => t.id), [1, 2]);
  assert.equal(trades[0].entryPrice, '1000.00000000');
  assert.equal(trades[0].exitPrice, '1100.00000000');
  assert.ok(trades[0].closedAt >= trades[0].openedAt);
});

test('broker: holds independent positions in different symbols', () => {
  const broker = new PaperBroker({ startingBalance: '10000' });

  broker.executeOrder(SIDE.BUY, '1000', 'AAAUSDT');  // 10 units, 0 left
  const second = broker.executeOrder(SIDE.BUY, '1', 'BBBUSDT');

  assert.equal(second.accepted, false, 'no cash left for a second symbol');
  assert.equal(broker.getPositions().length, 1);

  broker.executeOrder(SIDE.SELL, '1000', 'AAAUSDT');
  const third = broker.executeOrder(SIDE.BUY, '2500', 'BBBUSDT');

  assert.equal(third.accepted, true);
  assert.equal(third.quantity, 4);
});
