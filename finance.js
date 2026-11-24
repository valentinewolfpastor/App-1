// Pure calculation logic for the finance tracker.
// Works in the browser (window.Finance) and in Node (module.exports) for tests.
(function (root) {
  'use strict';

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const pad = (n) => String(n).padStart(2, '0');

  // ---- Dates -----------------------------------------------------------

  /** "YYYY-MM" for a "YYYY-MM-DD" date string. */
  const monthKey = (date) => String(date).slice(0, 7);

  function addMonthsToKey(month, delta) {
    let [y, m] = month.split('-').map(Number);
    m += delta;
    y += Math.floor((m - 1) / 12);
    m = ((m - 1) % 12 + 12) % 12 + 1;
    return `${y}-${pad(m)}`;
  }

  /** Last `count` month keys ending at `endMonth` (inclusive), oldest first. */
  function lastMonths(endMonth, count) {
    const out = [];
    for (let i = count - 1; i >= 0; i--) out.push(addMonthsToKey(endMonth, -i));
    return out;
  }

  /** All month keys from `start` to `end` inclusive. */
  function monthRange(start, end) {
    const out = [];
    for (let m = start; m <= end; m = addMonthsToKey(m, 1)) out.push(m);
    return out;
  }

  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

  /** Add whole months to a YYYY-MM-DD date, keeping the day (clamped to month end). */
  function addMonthsToDate(date, n, day) {
    const [y, m, d] = date.split('-').map(Number);
    const [ny, nm] = addMonthsToKey(`${y}-${pad(m)}`, n).split('-').map(Number);
    return `${ny}-${pad(nm)}-${pad(Math.min(day || d, daysInMonth(ny, nm)))}`;
  }

  function addDays(date, n) {
    const d = new Date(date + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

  // ---- Net worth (monthly check-ins) -----------------------------------

  /**
   * Balance of each account as of `month`: the most recent check-in value at
   * or before that month. Accounts never checked in are omitted.
   * snapshots: { "YYYY-MM": { accountId: balance } }
   */
  function balancesAt(accounts, snapshots, month) {
    const months = Object.keys(snapshots).filter((m) => m <= month).sort();
    const out = {};
    for (const a of accounts) {
      for (let i = months.length - 1; i >= 0; i--) {
        const v = snapshots[months[i]][a.id];
        if (v !== undefined && v !== null && v !== '') { out[a.id] = Number(v); break; }
      }
    }
    return out;
  }

  /** { assets, liabilities, net } as of a month. Liabilities are amounts owed (positive). */
  function netWorthAt(accounts, snapshots, month) {
    const bal = balancesAt(accounts, snapshots, month);
    let assets = 0, liabilities = 0;
    for (const a of accounts) {
      if (!(a.id in bal)) continue;
      if (a.type === 'liability') liabilities += bal[a.id];
      else assets += bal[a.id];
    }
    return { assets: round2(assets), liabilities: round2(liabilities), net: round2(assets - liabilities) };
  }

  /** Net worth for every month from the first check-in to `endMonth`. */
  function netWorthHistory(accounts, snapshots, endMonth) {
    const months = Object.keys(snapshots).sort();
    if (!months.length) return [];
    const last = endMonth && endMonth > months[months.length - 1] ? endMonth : months[months.length - 1];
    return monthRange(months[0], last).map((m) => ({ month: m, checkedIn: m in snapshots, ...netWorthAt(accounts, snapshots, m) }));
  }

  // ---- Bills & subscriptions -------------------------------------------

  const FREQUENCIES = {
    weekly: { label: 'Weekly', perMonth: 52 / 12 },
    monthly: { label: 'Monthly', perMonth: 1 },
    quarterly: { label: 'Every 3 months', perMonth: 1 / 3 },
    yearly: { label: 'Yearly', perMonth: 1 / 12 },
  };

  const monthlyCost = (bill) => (Number(bill.amount) || 0) * (FREQUENCIES[bill.frequency]?.perMonth ?? 1);

  /** Next date on or after `from` that the bill is due, based on its anchor `dueDate`. */
  function nextDueDate(bill, from) {
    const anchor = bill.dueDate;
    if (!anchor || anchor >= from) return anchor;
    if (bill.frequency === 'weekly') {
      const weeks = Math.ceil(daysBetween(anchor, from) / 7);
      return addDays(anchor, weeks * 7);
    }
    const step = { monthly: 1, quarterly: 3, yearly: 12 }[bill.frequency] || 1;
    const day = Number(anchor.slice(8, 10));
    const [ay, am] = anchor.split('-').map(Number);
    const [fy, fm] = from.split('-').map(Number);
    let n = Math.max(0, Math.floor(((fy - ay) * 12 + (fm - am)) / step) - 1);
    let d = addMonthsToDate(anchor, n * step, day);
    while (d < from) { n++; d = addMonthsToDate(anchor, n * step, day); }
    return d;
  }

  /**
   * Totals for recurring payments of one kind: 'bill' (default), 'saving' or 'investing'.
   * Payments with a varying amount (e.g. paying off a credit card) aren't counted.
   */
  function billTotals(bills, kind = 'bill', month) {
    const active = bills.filter((b) => !b.paused && !b.variable && (b.kind || 'bill') === kind && (!month || isActiveIn(b, month)));
    const perMonth = active.reduce((s, b) => s + monthlyCost(b), 0);
    const byCategory = {};
    for (const b of active) byCategory[b.category || 'Other'] = (byCategory[b.category || 'Other'] || 0) + monthlyCost(b);
    return {
      perMonth: round2(perMonth),
      perYear: round2(perMonth * 12),
      byCategory: Object.entries(byCategory).map(([category, total]) => ({ category, total: round2(total) })).sort((a, b) => b.total - a.total),
    };
  }

  /** Bills due within `days` days of `today`, soonest first. */
  function upcomingBills(bills, today, days) {
    const limit = addDays(today, days);
    return bills
      .filter((b) => !b.paused)
      .flatMap((b) => {
        // A payment that only starts later (e.g. a new salary) shows from its first month.
        const from = b.startMonth && `${b.startMonth}-01` > today ? `${b.startMonth}-01` : today;
        const due = nextDueDate(b, from);
        return due && due <= limit && isActiveIn(b, monthKey(due)) ? [{ bill: b, due }] : [];
      })
      .sort((a, b) => a.due.localeCompare(b.due));
  }

  /** Whether a recurring item applies in a month (optional startMonth / endMonth, inclusive). */
  const isActiveIn = (b, month) => (!b.startMonth || month >= b.startMonth) && (!b.endMonth || month <= b.endMonth);

  /** Dates a recurring item is due between `from` and `to` (inclusive). */
  function occurrences(bill, from, to) {
    const out = [];
    if (!bill.dueDate || from > to) return out;
    let d = nextDueDate(bill, from);
    for (let i = 0; d && d <= to && i < 600; i++) {
      if (isActiveIn(bill, monthKey(d))) out.push(d);
      d = nextDueDate(bill, addDays(d, 1));
    }
    return out;
  }

  /**
   * What a month looks like on paper: income in, then rent/bills, the card spending
   * limit, automatic saving and investing, and what's left over.
   */
  function monthlyPlan(bills, accounts, month) {
    const sumKind = (kind) => billTotals(bills, kind, month).perMonth;
    const cards = accounts.filter((a) => !a.archived && a.type === 'liability' && Number(a.monthlyLimit) > 0)
      .map((a) => ({ name: a.name, limit: Number(a.monthlyLimit) }));
    const income = sumKind('income');
    const fixed = sumKind('bill');
    const cardSpending = cards.reduce((s, c) => s + c.limit, 0);
    const saving = sumKind('saving');
    const investing = sumKind('investing');
    return {
      month, income, bills: fixed, cards, cardSpending, saving, investing,
      left: round2(income - fixed - cardSpending - saving - investing),
    };
  }

  // ---- Goals -----------------------------------------------------------

  function goalProgress(goal, today) {
    const target = Number(goal.target) || 0;
    const saved = Number(goal.saved) || 0;
    const remaining = Math.max(0, target - saved);
    let monthsLeft = null, perMonth = null;
    if (goal.targetDate && remaining > 0) {
      const days = daysBetween(today, goal.targetDate);
      monthsLeft = Math.max(0, days / (365.25 / 12));
      perMonth = round2(remaining / Math.max(1, Math.ceil(monthsLeft)));
    }
    return {
      ratio: target > 0 ? Math.min(1, saved / target) : 0,
      remaining: round2(remaining),
      done: target > 0 && saved >= target,
      overdue: !!goal.targetDate && goal.targetDate < today && remaining > 0,
      monthsLeft,
      perMonth,
    };
  }

  /** Amount saved toward a goal: the linked account's latest balance, or the manual amount. */
  const goalAccountIds = (goal) => (goal.accountIds && goal.accountIds.length ? goal.accountIds : goal.accountId ? [goal.accountId] : []);

  function goalSaved(goal, accounts, snapshots, month) {
    const ids = goalAccountIds(goal);
    if (ids.length) {
      const bal = balancesAt(accounts, snapshots, month);
      const known = ids.filter((id) => bal[id] !== undefined);
      if (known.length) return round2(known.reduce((s, id) => s + bal[id], 0));
    }
    return Number(goal.saved) || 0;
  }

  /**
   * Will a goal be reached in time? Counts money already saved, automatic transfers
   * into the goal's accounts, and expected one-off amounts (e.g. a bonus) before the target date.
   */
  function goalPlan(goal, saved, bills, today) {
    const target = Number(goal.target) || 0;
    const ids = goalAccountIds(goal);
    const feeding = bills.filter((b) => !b.paused && !b.variable && ['saving', 'investing'].includes(b.kind) && ids.includes(b.toAccountId));
    const autoPerMonth = round2(feeding.reduce((s, b) => s + monthlyCost(b), 0));
    const end = goal.targetDate || null;
    const lumpList = (goal.expected || []).filter((x) => !x.received && x.date >= today && (!end || x.date <= end));
    const lumps = round2(lumpList.reduce((s, x) => s + (Number(x.amount) || 0), 0));
    const remaining = Math.max(0, target - saved);
    if (!end) {
      const gap = Math.max(0, remaining - lumps);
      return { autoPerMonth, lumps, lumpList, remaining, monthsToReach: gap === 0 ? 0 : autoPerMonth > 0 ? Math.ceil(gap / autoPerMonth) : null };
    }
    const auto = round2(feeding.reduce((s, b) => s + occurrences(b, addDays(today, 1), end).length * (Number(b.amount) || 0), 0));
    const projected = round2(saved + auto + lumps);
    const monthsLeft = Math.max(1, (Number(end.slice(0, 4)) - Number(today.slice(0, 4))) * 12 + Number(end.slice(5, 7)) - Number(today.slice(5, 7)));
    const shortfall = round2(Math.max(0, target - projected));
    return {
      autoPerMonth, auto, lumps, lumpList, remaining, projected, monthsLeft,
      onTrack: projected >= target,
      shortfall,
      extraPerMonth: round2(shortfall / monthsLeft),
      surplus: round2(Math.max(0, projected - target)),
    };
  }

  /** How many months of costs a safety net covers. */
  const monthsCovered = (amount, monthlyCosts) => (monthlyCosts > 0 ? Math.round((amount / monthlyCosts) * 10) / 10 : null);

  /** Cash, investments and retirement totals (assets only; untagged assets count as cash). */
  function assetGroups(accounts, balances) {
    const out = { cash: 0, investments: 0, retirement: 0 };
    for (const a of accounts) {
      if (a.type === 'liability' || !(a.id in balances)) continue;
      out[a.group in out ? a.group : 'cash'] += balances[a.id];
    }
    return { cash: round2(out.cash), investments: round2(out.investments), retirement: round2(out.retirement) };
  }

  /** Months in a row a card bill stayed at or under its limit, counting back from `month`. */
  function underLimitStreak(cardBills, accountId, limit, month) {
    const v = (m) => cardBills[m]?.[accountId];
    let m = v(month) !== undefined ? month : addMonthsToKey(month, -1);
    let streak = 0;
    while (v(m) !== undefined && v(m) <= limit) { streak++; m = addMonthsToKey(m, -1); }
    return streak;
  }

  // ---- Pay-in-full streak ------------------------------------------------

  /**
   * How many months in a row an account was paid off in full, counting back
   * from `month`. If `month` isn't marked yet, counting starts from the month before
   * (so the streak doesn't reset just because this month's payment isn't due yet).
   * paidInFull: { "YYYY-MM": { accountId: true } }
   */
  function payInFullStreak(paidInFull, accountId, month) {
    const isPaid = (m) => !!(paidInFull[m] && paidInFull[m][accountId]);
    let m = isPaid(month) ? month : addMonthsToKey(month, -1);
    let streak = 0;
    while (isPaid(m)) { streak++; m = addMonthsToKey(m, -1); }
    return streak;
  }

  // ---- Bank file import ------------------------------------------------

  function detectDelimiter(text) {
    const firstLines = text.split(/\r?\n/).slice(0, 10).join('\n');
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQ = false;
    for (const ch of firstLines) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch in counts) counts[ch]++;
    }
    const [best, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return count ? best : ',';
  }

  function parseCsv(text, delimiter) {
    const delim = delimiter || detectDelimiter(text);
    text = text.replace(/^﻿/, '');
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
  }

  /** Parse a money string in any common format. Returns NaN if not a number. */
  function parseAmount(raw) {
    let s = String(raw ?? '').trim();
    if (!s) return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/-\s*$/.test(s)) { neg = true; s = s.replace(/-\s*$/, ''); }
    if (/^\s*[-−–]/.test(s) || /[-−–]\s*[\d.,]/.test(s)) neg = true;
    s = s.replace(/[^\d.,]/g, '');
    if (!/\d/.test(s)) return NaN;
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      const dec = lastDot > lastComma ? '.' : ',';
      s = s.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
    } else if (lastComma >= 0) {
      s = /,\d{1,2}$/.test(s) && (s.match(/,/g) || []).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) ? round2(neg ? -n : n) : NaN;
  }

  const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function dateParts(raw) {
    const s = String(raw ?? '').trim();
    let m = s.match(/(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})/);
    if (m) return { a: m[1], b: m[2], c: m[3] };
    m = s.match(/(\d{1,2})[\s\-]+([A-Za-z]{3,})\.?[\s\-,]+(\d{2,4})/);
    if (m) {
      const mi = MONTH_NAMES.indexOf(m[2].slice(0, 3).toLowerCase());
      if (mi >= 0) return { named: true, d: +m[1], mo: mi + 1, y: m[3] };
    }
    m = s.match(/([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{2,4})/);
    if (m) {
      const mi = MONTH_NAMES.indexOf(m[1].slice(0, 3).toLowerCase());
      if (mi >= 0) return { named: true, d: +m[2], mo: mi + 1, y: m[3] };
    }
    return null;
  }

  const fullYear = (y) => (String(y).length <= 2 ? 2000 + Number(y) : Number(y));

  /** Parse a date to YYYY-MM-DD. `format` is 'dmy' or 'mdy' for ambiguous numeric dates. */
  function parseDate(raw, format) {
    const p = dateParts(raw);
    if (!p) return null;
    let y, mo, d;
    if (p.named) { y = fullYear(p.y); mo = p.mo; d = p.d; }
    else if (p.a.length === 4) { y = +p.a; mo = +p.b; d = +p.c; }
    else if (format === 'mdy') { mo = +p.a; d = +p.b; y = fullYear(p.c); }
    else { d = +p.a; mo = +p.b; y = fullYear(p.c); }
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return `${y}-${pad(mo)}-${pad(d)}`;
  }

  /** Guess 'dmy' or 'mdy' from a column of date strings. */
  function guessDateFormat(values, fallback) {
    let dmy = false, mdy = false;
    for (const v of values) {
      const p = dateParts(v);
      if (!p || p.named || p.a.length === 4) continue;
      if (+p.a > 12) dmy = true;
      if (+p.b > 12) mdy = true;
    }
    if (dmy && !mdy) return 'dmy';
    if (mdy && !dmy) return 'mdy';
    // Dotted dates (03.11.2026) are day-first everywhere they're used.
    if (values.some((v) => /^\s*\d{1,2}\.\d{1,2}\.\d{2,4}/.test(String(v ?? '')))) return 'dmy';
    // Otherwise prefer the reading where the dates sit closest together:
    // a bank statement covers a few weeks, not dates scattered across the year.
    const span = (f) => {
      const ds = values.map((v) => parseDate(v, f)).filter(Boolean).sort();
      return ds.length > 1 ? daysBetween(ds[0], ds[ds.length - 1]) : 0;
    };
    const sd = span('dmy'), sm = span('mdy');
    if (sd !== sm) return sd < sm ? 'dmy' : 'mdy';
    return fallback || 'dmy';
  }

  /**
   * Find the header row and guess which column is which.
   * Returns { headerIndex, header, columns: { date, description, amount, debit, credit } } (indexes or -1).
   */
  function guessColumns(table) {
    let headerIndex = 0;
    for (let i = 0; i < Math.min(table.length, 20); i++) {
      if (table[i].some((c) => /date|datum|fecha|data|posted|booking/i.test(c))) { headerIndex = i; break; }
    }
    const header = table[headerIndex] || [];
    const find = (re, exclude = []) => header.findIndex((h, i) => re.test(h) && !exclude.includes(i));
    const date = find(/date|datum|fecha|data|posted|booking/i);
    const debit = find(/debit|withdraw|money out|paid out|outflow|spent|^out$/i);
    const credit = find(/credit(?! card)|deposit|money in|paid in|inflow|received|^in$/i);
    const amount = find(/amount|betrag|montant|importe|bedrag|value|sum/i, [debit, credit]);
    const description = find(/desc|payee|merchant|name|details|memo|narrative|particulars|transaction|beschreibung|libell|concepto|text|reference/i, [date, amount, debit, credit]);
    return { headerIndex, header, columns: { date, description, amount, debit, credit } };
  }

  /**
   * Turn CSV rows into spending entries using a column mapping.
   * mapping: { date, description, amount, debit, credit, dateFormat, mode: 'signed'|'split', spendingSign: 'negative'|'positive' }
   * Returns { rows: [{ date, description, amount, kind: 'out'|'in' }], skipped }
   */
  function mapRows(table, headerIndex, mapping) {
    const rows = [];
    let skipped = 0;
    for (const r of table.slice(headerIndex + 1)) {
      const date = parseDate(r[mapping.date], mapping.dateFormat);
      let value;
      if (mapping.mode === 'split') {
        const out = Math.abs(parseAmount(r[mapping.debit])) || 0;
        const inn = Math.abs(parseAmount(r[mapping.credit])) || 0;
        value = inn - out;
      } else {
        value = parseAmount(r[mapping.amount]);
        if (mapping.spendingSign === 'positive') value = -value;
      }
      if (!date || !Number.isFinite(value) || value === 0) { skipped++; continue; }
      rows.push({
        date,
        description: (mapping.description >= 0 ? r[mapping.description] : '') || '(no description)',
        amount: round2(Math.abs(value)),
        kind: value < 0 ? 'out' : 'in',
      });
    }
    return { rows, skipped };
  }

  // ---- Categories ------------------------------------------------------

  const EXCLUDED = 'Transfers (not spending)';

  const KEYWORDS = [
    ['Groceries', ['grocery', 'supermarket', 'market', 'tesco', 'sainsbury', 'asda', 'aldi', 'lidl', 'carrefour', 'whole foods', 'trader joe', 'kroger', 'safeway', 'walmart', 'costco', 'albert heijn', 'rewe', 'edeka', 'monoprix', 'mercadona', 'coop', 'waitrose', 'morrisons', 'publix', 'migros']],
    ['Dining out', ['restaurant', 'cafe', 'coffee', 'starbucks', 'mcdonald', 'burger', 'pizza', 'kfc', 'subway', 'deliveroo', 'uber eats', 'ubereats', 'doordash', 'just eat', 'grubhub', 'bistro', 'sushi', 'kebab', 'bakery', 'chipotle', 'pret']],
    ['Transport', ['uber', 'lyft', 'bolt', 'taxi', 'shell', 'esso', 'bp', 'chevron', 'exxon', 'texaco', 'fuel', 'petrol', 'gas station', 'parking', 'train', 'rail', 'metro', 'transit', 'tfl', 'bus', 'toll', 'sncf', 'db bahn']],
    ['Subscriptions', ['netflix', 'spotify', 'disney', 'hulu', 'hbo', 'apple.com', 'icloud', 'youtube', 'prime video', 'audible', 'patreon', 'adobe', 'microsoft', 'google storage', 'dropbox', 'chatgpt', 'openai', 'claude', 'anthropic']],
    ['Shopping', ['amazon', 'ebay', 'etsy', 'zara', 'h&m', 'ikea', 'target', 'primark', 'uniqlo', 'zalando', 'asos', 'shein', 'decathlon', 'best buy', 'apple store']],
    ['Health', ['pharmacy', 'chemist', 'boots', 'cvs', 'walgreens', 'doctor', 'dental', 'dentist', 'clinic', 'hospital', 'optician', 'gym', 'fitness']],
    ['Housing & utilities', ['rent', 'mortgage', 'electric', 'energy', 'water', 'gas bill', 'council tax', 'internet', 'broadband', 'vodafone', 'verizon', 'at&t', 't-mobile', 'orange', 'comcast']],
    ['Entertainment', ['cinema', 'theatre', 'theater', 'ticketmaster', 'steam', 'playstation', 'xbox', 'nintendo', 'concert', 'museum']],
    ['Travel', ['airbnb', 'booking.com', 'hotel', 'ryanair', 'easyjet', 'airline', 'airways', 'expedia', 'hostel']],
    ['Cash', ['atm', 'cash withdrawal']],
    [EXCLUDED, ['transfer', 'payment thank you', 'credit card payment', 'savings']],
  ];

  // Keyword must start at a word boundary ("tfl" must not match "neTFLix");
  // short keywords (3 letters or fewer) must be a whole word ("bp", "bus").
  const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keywordRes = new Map();
  function keywordMatch(text, word) {
    if (!keywordRes.has(word)) {
      const tail = word.length <= 3 ? '(?![a-z])' : '';
      keywordRes.set(word, new RegExp(`(?:^|[^a-z])${escapeRe(word)}${tail}`));
    }
    return keywordRes.get(word).test(text);
  }

  const SPENDING_CATEGORIES = [...KEYWORDS.map(([c]) => c).filter((c) => c !== EXCLUDED), 'Other', EXCLUDED];

  /** Stable key for "this merchant", used to remember category choices. */
  const merchantKey = (desc) => String(desc || '').toLowerCase()
    .replace(/\d+/g, ' ').replace(/[^a-z&.' ]+/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').slice(0, 3).join(' ');

  function categorize(description, kind, rules) {
    const key = merchantKey(description);
    if (rules && rules[key]) return rules[key];
    if (kind === 'in') return 'Income';
    const d = String(description || '').toLowerCase();
    for (const [category, words] of KEYWORDS) if (words.some((w) => keywordMatch(d, w))) return category;
    return 'Other';
  }

  /** Spending summary for one month: totals by category, excluding transfers. */
  function spendingSummary(entries, month) {
    const totals = {};
    let spent = 0, income = 0;
    for (const e of entries) {
      if (monthKey(e.date) !== month || e.category === EXCLUDED) continue;
      if (e.kind === 'in') { income += e.amount; continue; }
      spent += e.amount;
      totals[e.category || 'Other'] = (totals[e.category || 'Other'] || 0) + e.amount;
    }
    return {
      spent: round2(spent),
      income: round2(income),
      byCategory: Object.entries(totals).map(([category, total]) => ({ category, total: round2(total) })).sort((a, b) => b.total - a.total),
    };
  }

  const entryKey = (e) => `${e.date}|${e.description}|${e.amount}|${e.kind}`;

  const api = {
    round2, monthKey, addMonthsToKey, lastMonths, monthRange, addDays, daysBetween,
    balancesAt, netWorthAt, netWorthHistory,
    FREQUENCIES, monthlyCost, nextDueDate, billTotals, upcomingBills,
    isActiveIn, occurrences, monthlyPlan,
    goalProgress, goalSaved, goalAccountIds, goalPlan, monthsCovered, assetGroups, underLimitStreak, payInFullStreak,
    detectDelimiter, parseCsv, parseAmount, parseDate, guessDateFormat, guessColumns, mapRows,
    EXCLUDED, SPENDING_CATEGORIES, merchantKey, categorize, spendingSummary, entryKey,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Finance = api;
})(typeof window !== 'undefined' ? window : globalThis);
