// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./finance.js');

const accounts = [
  { id: 'chk', name: 'Checking', type: 'asset' },
  { id: 'sav', name: 'Savings', type: 'asset' },
  { id: 'cc', name: 'Card', type: 'liability' },
];
const snapshots = {
  '2026-08': { chk: 1000, sav: 5000, cc: 300 },
  '2026-10': { chk: 1500, cc: 100 }, // savings not updated -> carried forward
};

test('balances carry forward from the last check-in', () => {
  assert.deepEqual(F.balancesAt(accounts, snapshots, '2026-09'), { chk: 1000, sav: 5000, cc: 300 });
  assert.deepEqual(F.balancesAt(accounts, snapshots, '2026-11'), { chk: 1500, sav: 5000, cc: 100 });
  assert.deepEqual(F.balancesAt(accounts, snapshots, '2026-07'), {});
});

test('net worth and history', () => {
  assert.deepEqual(F.netWorthAt(accounts, snapshots, '2026-10'), { assets: 6500, liabilities: 100, net: 6400 });
  const h = F.netWorthHistory(accounts, snapshots, '2026-11');
  assert.deepEqual(h.map((x) => x.month), ['2026-08', '2026-09', '2026-10', '2026-11']);
  assert.deepEqual(h.map((x) => x.net), [5700, 5700, 6400, 6400]);
  assert.deepEqual(h.map((x) => x.checkedIn), [true, false, true, false]);
});

test('month helpers wrap across years', () => {
  assert.deepEqual(F.lastMonths('2026-02', 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(F.addMonthsToKey('2026-01', -1), '2025-12');
  assert.equal(F.addMonthsToKey('2026-12', 1), '2027-01');
});

test('next due date for each frequency', () => {
  assert.equal(F.nextDueDate({ dueDate: '2026-01-31', frequency: 'monthly' }, '2026-02-10'), '2026-02-28');
  assert.equal(F.nextDueDate({ dueDate: '2026-01-31', frequency: 'monthly' }, '2026-03-01'), '2026-03-31');
  assert.equal(F.nextDueDate({ dueDate: '2026-01-15', frequency: 'monthly' }, '2026-11-15'), '2026-11-15');
  assert.equal(F.nextDueDate({ dueDate: '2025-03-01', frequency: 'yearly' }, '2026-11-24'), '2027-03-01');
  assert.equal(F.nextDueDate({ dueDate: '2026-01-10', frequency: 'quarterly' }, '2026-11-24'), '2027-01-10');
  assert.equal(F.nextDueDate({ dueDate: '2026-11-02', frequency: 'weekly' }, '2026-11-24'), '2026-11-30');
  assert.equal(F.nextDueDate({ dueDate: '2026-12-05', frequency: 'monthly' }, '2026-11-24'), '2026-12-05');
});

test('bill totals and upcoming', () => {
  const bills = [
    { name: 'Rent', amount: 1200, frequency: 'monthly', dueDate: '2026-01-01', category: 'Housing' },
    { name: 'Insurance', amount: 600, frequency: 'yearly', dueDate: '2026-12-01', category: 'Insurance' },
    { name: 'Gym', amount: 10, frequency: 'weekly', dueDate: '2026-11-23', category: 'Health' },
    { name: 'Old', amount: 99, frequency: 'monthly', dueDate: '2026-01-01', paused: true },
  ];
  const t = F.billTotals(bills);
  assert.equal(t.perMonth, F.round2(1200 + 50 + 10 * 52 / 12));
  assert.equal(t.byCategory[0].category, 'Housing');
  const up = F.upcomingBills(bills, '2026-11-24', 14);
  assert.deepEqual(up.map((u) => [u.bill.name, u.due]), [['Gym', '2026-11-30'], ['Rent', '2026-12-01'], ['Insurance', '2026-12-01'], ['Gym', '2026-12-07']].slice(0, 3));
});

test('goal progress', () => {
  const g = F.goalProgress({ target: 5000, saved: 2000, targetDate: '2027-05-24' }, '2026-11-24');
  assert.equal(g.remaining, 3000);
  assert.equal(g.perMonth, 500);
  assert.equal(g.done, false);
  assert.equal(F.goalProgress({ target: 100, saved: 150 }, '2026-11-24').done, true);
  assert.equal(F.goalProgress({ target: 100, saved: 10, targetDate: '2026-01-01' }, '2026-11-24').overdue, true);
});

test('parseAmount handles many formats', () => {
  const cases = { '-45.10': -45.1, '1,234.56': 1234.56, '1.234,56': 1234.56, '-1.234,56 €': -1234.56, '(12.00)': -12,
    '12.00-': -12, '$ -3.5': -3.5, '45,1': 45.1, '1,000': 1000, '1.000': 1000, '': NaN, 'abc': NaN, '£2,500.00': 2500 };
  for (const [s, v] of Object.entries(cases)) {
    if (Number.isNaN(v)) assert.ok(Number.isNaN(F.parseAmount(s)), s);
    else assert.equal(F.parseAmount(s), v, s);
  }
});

test('parseDate and format guessing', () => {
  assert.equal(F.parseDate('2026-11-03', 'mdy'), '2026-11-03');
  assert.equal(F.parseDate('03/11/2026', 'dmy'), '2026-11-03');
  assert.equal(F.parseDate('03/11/2026', 'mdy'), '2026-03-11');
  assert.equal(F.parseDate('3.11.26', 'dmy'), '2026-11-03');
  assert.equal(F.parseDate('24 Nov 2026'), '2026-11-24');
  assert.equal(F.parseDate('Nov 24, 2026'), '2026-11-24');
  assert.equal(F.parseDate('31/02/2026', 'dmy'), null);
  assert.equal(F.guessDateFormat(['01/02/2026', '25/02/2026']), 'dmy');
  assert.equal(F.guessDateFormat(['02/01/2026', '02/25/2026']), 'mdy');
  assert.equal(F.guessDateFormat(['01/02/2026'], 'mdy'), 'mdy');
  assert.equal(F.guessDateFormat(['03.11.2026', '07.11.2026'], 'mdy'), 'dmy');
  assert.equal(F.guessDateFormat(['03/11/2026', '07/11/2026', '09/11/2026'], 'mdy'), 'dmy'); // Nov 3–9, not Mar–Sep
  assert.equal(F.guessDateFormat(['11/03/2026', '11/07/2026', '11/09/2026'], 'dmy'), 'mdy');
});

test('bank CSV: semicolons, preamble, signed amounts', () => {
  const csv = '﻿Account;12345\n\nBooking date;Description;Amount\n03.11.2026;"TESCO STORES 123";-45,10\n05.11.2026;Salary ACME;2.500,00\n06.11.2026;Junk;\n';
  const table = F.parseCsv(csv);
  const g = F.guessColumns(table);
  assert.equal(g.headerIndex, 1);
  assert.deepEqual(g.columns, { date: 0, description: 1, amount: 2, debit: -1, credit: -1 });
  const { rows, skipped } = F.mapRows(table, g.headerIndex, { ...g.columns, mode: 'signed', spendingSign: 'negative', dateFormat: 'dmy' });
  assert.equal(skipped, 1);
  assert.deepEqual(rows, [
    { date: '2026-11-03', description: 'TESCO STORES 123', amount: 45.1, kind: 'out' },
    { date: '2026-11-05', description: 'Salary ACME', amount: 2500, kind: 'in' },
  ]);
});

test('bank CSV: separate debit and credit columns', () => {
  const table = F.parseCsv('Date,Details,Money Out,Money In\n2026-11-01,Netflix,15.99,\n2026-11-02,Refund,,20\n');
  const g = F.guessColumns(table);
  assert.equal(g.columns.debit, 2);
  assert.equal(g.columns.credit, 3);
  const { rows } = F.mapRows(table, g.headerIndex, { ...g.columns, mode: 'split', dateFormat: 'dmy' });
  assert.deepEqual(rows.map((r) => [r.kind, r.amount]), [['out', 15.99], ['in', 20]]);
});

test('categorize uses remembered rules, then keywords', () => {
  assert.equal(F.categorize('TESCO STORES 3321', 'out', {}), 'Groceries');
  assert.equal(F.categorize('NETFLIX.COM 866', 'out', {}), 'Subscriptions');
  assert.equal(F.categorize('Mystery shop', 'out', {}), 'Other');
  assert.equal(F.categorize('Employer Ltd', 'in', {}), 'Income');
  const rules = { [F.merchantKey('Mystery shop 0042')]: 'Shopping' };
  assert.equal(F.categorize('MYSTERY SHOP 9911', 'out', rules), 'Shopping');
});

test('spending summary excludes transfers and separates income', () => {
  const entries = [
    { date: '2026-11-01', amount: 50, kind: 'out', category: 'Groceries' },
    { date: '2026-11-02', amount: 30, kind: 'out', category: 'Groceries' },
    { date: '2026-11-03', amount: 500, kind: 'out', category: F.EXCLUDED },
    { date: '2026-11-04', amount: 2000, kind: 'in', category: 'Income' },
    { date: '2026-10-04', amount: 99, kind: 'out', category: 'Other' },
  ];
  assert.deepEqual(F.spendingSummary(entries, '2026-11'), { spent: 80, income: 2000, byCategory: [{ category: 'Groceries', total: 80 }] });
});
