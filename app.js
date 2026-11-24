/* global Finance */
(function () {
  'use strict';

  const STORAGE_KEY = 'finance-tracker:v2';
  const OLD_STORAGE_KEY = 'finance-tracker:v1';
  const BILL_CATEGORIES = ['Housing', 'Utilities', 'Phone & internet', 'Insurance', 'Subscriptions', 'Transport', 'Loans & credit', 'Health & fitness', 'Other'];

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const localToday = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const thisMonth = () => localToday().slice(0, 7);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- State -----------------------------------------------------------

  const emptyState = () => ({
    version: 2, settings: { currency: 'USD' },
    accounts: [], snapshots: {}, snapshotDates: {}, contributions: {}, paidInFull: {}, cardBills: {}, bills: [], goals: [], todos: [], review: null,
    spending: [], rules: {}, lastBackup: null,
  });

  /** Convert data from the first version of the app (transaction based). */
  function migrateV1(old) {
    const s = emptyState();
    s.settings = { ...s.settings, ...old.settings };
    s.accounts = (old.accounts || []).map((a) => ({ id: a.id, name: a.name, type: a.type }));
    if (s.accounts.length) {
      const raw = {};
      for (const a of old.accounts) raw[a.id] = (a.type === 'liability' ? -1 : 1) * (Number(a.openingBalance) || 0);
      for (const t of old.transactions || []) {
        if (t.type === 'income' && t.accountId in raw) raw[t.accountId] += t.amount;
        if (t.type === 'expense' && t.accountId in raw) raw[t.accountId] -= t.amount;
        if (t.type === 'transfer') { if (t.accountId in raw) raw[t.accountId] -= t.amount; if (t.toAccountId in raw) raw[t.toAccountId] += t.amount; }
      }
      s.snapshots[thisMonth()] = Object.fromEntries(old.accounts.map((a) => [a.id, Finance.round2(a.type === 'liability' ? -raw[a.id] : raw[a.id])]));
    }
    return s;
  }

  function normalize(data) {
    if (data && Array.isArray(data.transactions) && !data.version) data = migrateV1(data);
    const s = { ...emptyState(), ...data, settings: { ...emptyState().settings, ...(data && data.settings) } };
    if (!s.review || !Array.isArray(s.review.items)) s.review = defaultReview(s);
    if (!s.review.months) s.review.months = {};
    return s;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
      const old = localStorage.getItem(OLD_STORAGE_KEY);
      if (old) return normalize(JSON.parse(old));
    } catch (e) { console.warn('Could not load saved data', e); }
    return normalize(emptyState());
  }

  let state = load();

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save. Browser storage is unavailable or full.'); }
  }

  function save() {
    persist();
    render();
  }

  // ---- Formatting ------------------------------------------------------

  let fmt, fmtCompact;
  function updateFormatters() {
    const currency = state.settings.currency || 'USD';
    fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    fmtCompact = new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 });
  }
  const money = (n) => fmt.format(n || 0);
  const signedMoney = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt.format(Math.abs(n || 0));
  const monthLong = (m) => new Date(m + '-01T00:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const monthShort = (m) => new Date(m + '-01T00:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  const dayLabel = (d) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  function dueLabel(d) {
    const n = Finance.daysBetween(localToday(), d);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n < 7) return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long' });
    return dayLabel(d);
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  function barRow(name, ratio, amount, cls = '') {
    const pct = Math.max(0, Math.min(1, ratio)) * 100;
    return `<div class="bar-row"><span class="name" title="${esc(name)}">${esc(name)}</span>
      <div class="bar-track"><div class="bar-fill ${cls}" style="width:${pct.toFixed(1)}%"></div></div>
      <span class="amt">${esc(amount)}</span></div>`;
  }
  const empty = (msg) => `<p class="empty">${msg}</p>`;

  // ---- Navigation ------------------------------------------------------

  function showView(name) {
    $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    // The chart sizes itself to the screen, so redraw it once its tab is visible.
    if (name === 'overview') requestAnimationFrame(renderOverview);
    try { sessionStorage.setItem('finance-tracker:view', name); } catch (e) { /* ignore */ }
    window.scrollTo(0, 0);
  }
  $$('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) showView(g.dataset.goto);
  });

  // ---- Render ----------------------------------------------------------

  function render() {
    updateFormatters();
    renderOverview();
    renderReview();
    renderCheckin();
    renderBills();
    renderGoals();
    renderSpending();
    $('#settings-form').currency.value = state.settings.currency;
    $('#last-backup').textContent = state.lastBackup ? `Last backup downloaded on ${dayLabel(state.lastBackup)}.` : 'You have not downloaded a backup yet.';
  }

  const activeAccounts = () => state.accounts.filter((a) => !a.archived);
  const KIND_LABELS = { saving: 'saving', investing: 'investing', income: 'income' };
  const kindPill = (b) => (KIND_LABELS[b.kind] ? `<span class="pill ${b.kind}">${KIND_LABELS[b.kind]}</span>` : '');
  const todoItem = (t) => `<li class="${t.done ? 'done' : ''}">
    <label class="check"><input type="checkbox" data-todo="${t.id}" ${t.done ? 'checked' : ''}> <span>${esc(t.text)}${todoMeta(t)}</span></label>
  </li>`;
  function todoMeta(t) {
    const due = t.dueDate && !t.done ? `<span class="due ${t.dueDate < localToday() ? 'late' : Finance.daysBetween(localToday(), t.dueDate) <= 14 ? 'soon' : ''}">${esc(dueText(t.dueDate))}</span>` : '';
    const note = t.note ? `<span class="todo-note">${esc(t.note)}</span>` : '';
    return due || note ? ` ${due}${note}` : '';
  }

  // Ticking a checkbox works from any screen (overview, goals, check-in).
  document.addEventListener('change', (e) => {
    const pif = e.target.dataset.pif, todo = e.target.dataset.todo;
    if (pif) {
      const month = e.target.dataset.month || thisMonth();
      state.paidInFull[month] = { ...(state.paidInFull[month] || {}), [pif]: e.target.checked };
      // Inside the check-in form, don't redraw it: that would wipe balances typed but not saved yet.
      if (e.target.closest('#ci-form')) { persist(); renderOverview(); } else save();
      if (e.target.checked) {
        const streak = Finance.payInFullStreak(state.paidInFull, pif, month);
        toast(streak > 1 ? `Nice! ${streak} months in a row paid in full.` : 'Nice! Marked as paid in full.');
      }
    } else if (todo) {
      const t = state.todos.find((x) => x.id === todo);
      if (!t) return;
      t.done = e.target.checked;
      save();
      if (t.done) toast(`Done: "${t.text}" 🎉`);
    }
  });
  const latestSpendingMonth = () => state.spending.reduce((m, e) => (e.date.slice(0, 7) > m ? e.date.slice(0, 7) : m), '');

  // ---- Overview --------------------------------------------------------

  function renderOverview() {
    const month = thisMonth();
    const today = localToday();

    // This month: review progress + a few signals
    const box = $('#ov-month');
    if (!state.accounts.length) {
      box.innerHTML = `<span>Welcome! Start by adding your accounts and their balances. It takes about 5 minutes.</span>
        <button class="primary" data-goto="checkin">Add accounts</button>`;
    } else {
      const rp = reviewProgress(month);
      const signals = [];
      for (const a of cardAccounts()) {
        const bill = state.cardBills[month]?.[a.id];
        const limit = Number(a.monthlyLimit) || 0;
        if (bill !== undefined && limit) signals.push(`<span class="chip ${bill <= limit ? 'ok' : 'bad'}">${esc(a.name)} bill ${esc(money(bill))} ${bill <= limit ? '✓ under' : '✗ over'} ${esc(fmtCompact.format(limit))}</span>`);
        else if (limit) signals.push(`<span class="chip">${esc(a.name)} bill: not entered yet</span>`);
      }
      const sn = safetyNetInfo();
      if (sn) signals.push(`<span class="chip">Safety net covers ${sn.months} months</span>`);
      const next = state.todos.filter((t) => !t.done && t.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      if (next) signals.push(`<span class="chip ${next.dueDate < today ? 'bad' : ''}">Next: ${esc(shorten(next.text, 42))} · ${esc(dueText(next.dueDate))}</span>`);
      const done = rp.done === rp.total;
      box.innerHTML = `<div class="ov-month-main">
          <strong>${esc(monthLong(month))} review</strong>
          <span class="muted">${done ? '✓ All done. Nice work!' : `${rp.done} of ${rp.total} steps done`}</span>
          <div class="bar-track"><div class="bar-fill ${done ? 'done' : ''}" style="width:${(rp.total ? (rp.done / rp.total) * 100 : 0).toFixed(1)}%"></div></div>
        </div>
        <button class="${done ? '' : 'primary'}" data-goto="review">${done ? 'View review' : rp.done ? 'Continue review' : 'Start review'}</button>
        ${signals.length ? `<div class="chips">${signals.join('')}</div>` : ''}`;
    }

    // Net worth
    const history = Finance.netWorthHistory(state.accounts, state.snapshots, month);
    if (history.length) {
      const now = history[history.length - 1];
      $('#ov-networth').textContent = money(now.net);
      $('#ov-networth').className = 'value' + (now.net < 0 ? ' neg' : '');
      const prev = history[history.length - 2];
      const g = Finance.assetGroups(state.accounts, Finance.balancesAt(state.accounts, state.snapshots, month));
      const parts = [];
      if (prev) {
        const diff = Finance.round2(now.net - prev.net);
        parts.push(`<span class="${diff >= 0 ? 'pos' : 'neg'}">${diff >= 0 ? '▲' : '▼'} ${esc(money(Math.abs(diff)))}</span> since ${esc(monthShort(prev.month))}`);
      }
      if (g.investments || g.retirement) {
        parts.push(`Cash ${esc(fmtCompact.format(g.cash))} · Invested ${esc(fmtCompact.format(g.investments))} · Retirement ${esc(fmtCompact.format(g.retirement))}${now.liabilities ? ` · Owe ${esc(fmtCompact.format(now.liabilities))}` : ''}`);
      } else if (!prev) parts.push(`${esc(money(now.assets))} have · ${esc(money(now.liabilities))} owe`);
      $('#ov-networth-sub').innerHTML = parts.join('<br>');
    } else {
      $('#ov-networth').textContent = '—';
      $('#ov-networth-sub').textContent = 'Do your first check-in';
    }
    renderNetWorthChart(history.slice(-24));
    renderInvestments(month);

    // Monthly plan
    const plan = Finance.monthlyPlan(state.bills, state.accounts, month);
    const later = nextDifferentPlan(plan);
    if (plan.income) {
      $('#ov-left').textContent = money(plan.left);
      $('#ov-left').className = 'value ' + (plan.left < 0 ? 'neg' : 'pos');
      $('#ov-left-sub').textContent = later ? `${money(later.left)} from ${monthShort(later.month)}` : 'after bills, card, saving & investing';
    } else {
      $('#ov-left').textContent = '—';
      $('#ov-left').className = 'value';
      $('#ov-left-sub').textContent = 'Add your income on the Recurring tab';
    }
    $('#ov-plan').innerHTML = plan.income || plan.bills ? planTable(plan, later) : empty('Add your income, bills and automatic transfers on the Recurring tab to see your monthly plan.');

    // Coming up
    const up = Finance.upcomingBills(state.bills, today, 30);
    $('#ov-upcoming').innerHTML = up.length
      ? `<ul class="list">${up.map((u) => `<li><span class="when">${esc(dueLabel(u.due))}</span><span>${esc(u.bill.name)} ${kindPill(u.bill)}</span><span class="amt ${u.bill.kind === 'income' ? 'pos' : ''}">${u.bill.variable ? '<span class="muted">full balance</span>' : (u.bill.kind === 'income' ? '+' : '') + esc(money(u.bill.amount))}</span></li>`).join('')}</ul>`
      : empty(state.bills.length ? 'Nothing due in the next 30 days.' : 'Add your rent, bills, income and automatic transfers to see what\'s coming up.');

    // My goals (short term on the overview)
    const shortTodos = state.todos.filter((t) => t.horizon !== 'long');
    const longTodos = state.todos.filter((t) => t.horizon === 'long');
    $('#ov-todos').innerHTML = state.todos.length
      ? `<ul class="todo-list compact">${shortTodos.map(todoItem).join('')}</ul>${longTodos.length ? `<p class="muted todo-long-line">Long term: ${longTodos.map((t) => esc(t.text)).join(' · ')}</p>` : ''}`
      : empty('Write down your goals on the Goals tab.');

    // Credit card: paid in full + spending limit
    const cards = cardAccounts();
    $('#ov-pif-card').hidden = !cards.length;
    $('#ov-pif').innerHTML = cards.map((a) => cardSummary(a, month, true)).join('');

    // Savings goals
    const goals = state.goals.map((g) => ({ ...g, saved: Finance.goalSaved(g, state.accounts, state.snapshots, month) }));
    const saved = goals.reduce((s, g) => s + g.saved, 0);
    const target = goals.reduce((s, g) => s + (Number(g.target) || 0), 0);
    $('#ov-goals').textContent = money(saved);
    $('#ov-goals-sub').textContent = goals.length ? `of ${money(target)} across ${goals.length} goal${goals.length === 1 ? '' : 's'}` : 'No savings goals yet';
    $('#ov-goal-list').innerHTML = goals.length
      ? goals.map((g) => {
        const p = Finance.goalProgress(g, today);
        return `<div class="ov-goal">${barRow(g.name, p.ratio, `${fmtCompact.format(g.saved)} / ${fmtCompact.format(g.target)}`, p.done ? 'done' : '')}
          <p class="muted ov-goal-sub">${goalStatusLine(g, true)}</p></div>`;
      }).join('')
      : empty('Set a savings goal, like a safety net or a house deposit.');

    // Spending
    const sm = latestSpendingMonth();
    if (sm) {
      const s = Finance.spendingSummary(state.spending, sm);
      $('#ov-spent-label').textContent = `Spent in ${monthShort(sm)}`;
      $('#ov-spent').textContent = money(s.spent);
      $('#ov-spent-sub').textContent = s.byCategory[0] ? `Most on ${s.byCategory[0].category}` : '';
      $('#ov-spending-title').firstChild.textContent = `Spending in ${monthLong(sm)} `;
      const max = s.byCategory[0]?.total || 1;
      $('#ov-spending').innerHTML = s.byCategory.length ? s.byCategory.slice(0, 6).map((c) => barRow(c.category, c.total / max, money(c.total))).join('') : empty('No spending this month.');
    } else {
      $('#ov-spent-label').textContent = 'Spent';
      $('#ov-spent').textContent = '—';
      $('#ov-spent-sub').textContent = 'Import a bank or card file';
      $('#ov-spending-title').firstChild.textContent = 'Spending ';
      $('#ov-spending').innerHTML = empty('Import a statement file from your bank or card on the Spending tab to see where your money goes.');
    }
  }

  const isInvestment = (a) => a.type !== 'liability' && a.group === 'investments' && !a.archived;
  const monthEnd = (m) => `${m}-${String(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()).padStart(2, '0')}`;

  /** Automatic transfers into an account since the previous check-in (a starting guess the user can change). */
  function defaultContribution(accountId, month, prevMonth) {
    const from = Finance.addDays(state.snapshotDates[prevMonth] || monthEnd(prevMonth), 1);
    const to = month === thisMonth() ? localToday() : monthEnd(month);
    return Finance.round2(state.bills
      .filter((b) => !b.paused && ['saving', 'investing'].includes(b.kind) && b.toAccountId === accountId)
      .reduce((s, b) => s + Finance.occurrences(b, from, to).length * (Number(b.amount) || 0), 0));
  }

  const pctText = (p) => (p == null ? '' : `${p >= 0 ? '+' : '−'}${Math.abs(p * 100).toFixed(1)}%`);

  function renderInvestments(month) {
    const accts = state.accounts.filter(isInvestment);
    $('#ov-invest-card').hidden = !accts.length;
    if (!accts.length) return;
    const rows = accts.map((a) => ({ a, r: Finance.investmentReturns(a.id, state.snapshots, state.contributions, month, a.investedBefore) })).filter((x) => x.r);
    if (!rows.length) { $('#ov-invest').innerHTML = empty('Save a check-in with your investment balances to start tracking.'); return; }
    const since = rows.reduce((m, x) => (x.r.startMonth < m ? x.r.startMonth : m), rows[0].r.startMonth);
    $('#ov-invest-since').textContent = `tracking since ${monthShort(since)}`;
    const hasAllTime = rows.some((x) => x.r.allTimeGain !== undefined);
    const tot = rows.reduce((t, { r }) => {
      const last = r.periods[r.periods.length - 1];
      t.current += r.current; t.added += r.added; t.gain += r.gain; t.base += r.startBalance + r.added;
      t.last += last ? last.gain : 0;
      if (r.allTimeGain !== undefined) { t.allGain += r.allTimeGain; t.invested += r.invested; }
      return t;
    }, { current: 0, added: 0, gain: 0, base: 0, last: 0, allGain: 0, invested: 0 });
    const g = (v, p) => `<span class="${v >= 0 ? 'pos' : 'neg'}">${esc(signedMoney(v))}</span>${p != null ? ` <span class="muted">${pctText(p)}</span>` : ''}`;
    const anyPeriods = rows.some((x) => x.r.periods.length);
    $('#ov-invest').innerHTML = `<div class="table-wrap"><table class="table inv">
      <thead><tr><th>Account</th><th class="num">Balance</th><th class="num">Put in</th><th class="num">Earned</th><th class="num">Last month</th>${hasAllTime ? '<th class="num">All time</th>' : ''}</tr></thead>
      <tbody>${rows.map(({ a, r }) => {
        const last = r.periods[r.periods.length - 1];
        return `<tr><td>${esc(a.name)}${a.holding ? ` <span class="pill">${esc(a.holding)}</span>` : ''}</td>
          <td class="num">${esc(money(r.current))}</td>
          <td class="num">${esc(money(r.added))}</td>
          <td class="num">${r.periods.length ? g(r.gain, r.pct) : '<span class="muted">–</span>'}</td>
          <td class="num">${last ? g(last.gain, last.pct) : '<span class="muted">–</span>'}</td>
          ${hasAllTime ? `<td class="num">${r.allTimeGain !== undefined ? g(r.allTimeGain, r.allTimePct) : '<span class="muted">–</span>'}</td>` : ''}</tr>`;
      }).join('')}
      <tr class="plan-total"><td><strong>Total</strong></td><td class="num"><strong>${esc(money(tot.current))}</strong></td><td class="num">${esc(money(tot.added))}</td>
        <td class="num">${anyPeriods ? g(tot.gain, tot.base > 0 ? tot.gain / tot.base : null) : '<span class="muted">–</span>'}</td>
        <td class="num">${anyPeriods ? g(tot.last, null) : '<span class="muted">–</span>'}</td>
        ${hasAllTime ? `<td class="num">${tot.invested ? g(tot.allGain, tot.allGain / tot.invested) : ''}</td>` : ''}</tr>
      </tbody></table></div>
      <p class="muted inv-note">${anyPeriods
        ? '<strong>Earned</strong> = change in balance minus the money you put in, since tracking started. <strong>Put in</strong> = your transfers since then.'
        : `Your first earnings show up after your next check-in. Each month the app subtracts the money you put in (it pre-fills your automatic transfers) from the change in balance, so you see what the investments actually made.`}
        ${hasAllTime ? '' : ' Want an all-time figure? Edit an account on the Check-in tab and enter "Total put in so far" (Fidelity calls it <em>cost basis</em>).'}</p>`;
  }

  const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  function dueText(d) {
    const n = Finance.daysBetween(localToday(), d);
    if (n < 0) return `overdue since ${dayLabel(d)}`;
    if (n === 0) return 'today';
    if (n < 45) return `by ${dayLabel(d)}`;
    return `by ${monthShort(d.slice(0, 7))}`;
  }

  /** The first month in the next year whose plan differs (e.g. a raise starting in January). */
  function nextDifferentPlan(plan) {
    for (let i = 1; i <= 12; i++) {
      const m = Finance.addMonthsToKey(plan.month, i);
      const p = Finance.monthlyPlan(state.bills, state.accounts, m);
      if (Math.abs(p.left - plan.left) >= 1) return p;
    }
    return null;
  }

  function planTable(plan, later) {
    const col = (p, key, sign) => `<td class="num ${sign > 0 ? 'pos' : ''}">${p[key] ? (sign > 0 ? '+' : '−') + esc(money(p[key])) : '—'}</td>`;
    const row = (label, key, sign) => (plan[key] || (later && later[key]) ? `<tr><td>${label}</td>${col(plan, key, sign)}${later ? col(later, key, sign) : ''}</tr>` : '');
    const cardLabel = plan.cards.length ? `${plan.cards.map((c) => esc(c.name)).join(', ')} (your limit)` : '';
    const leftCell = (p) => `<td class="num"><strong class="${p.left < 0 ? 'neg' : 'pos'}">${p.left < 0 ? '−' : '+'}${esc(money(Math.abs(p.left)))}</strong></td>`;
    let tip = '';
    const ref = later && later.left > plan.left ? later : plan;
    if (plan.left < 0) tip = `<p class="plan-tip bad">You're planning to spend more than you earn this month. Look at the card limit or the automatic transfers.</p>`;
    else if (ref.left > 0) {
      const sn = state.goals.find((g) => g.isSafetyNet);
      tip = `<p class="plan-tip">💡 Decide where the ${esc(money(ref.left))} left over goes${sn ? `, for example your ${esc(sn.name.toLowerCase())}` : ''}. Money with no plan tends to get spent.</p>`;
    }
    if (plan.cards.length) tip += `<p class="muted plan-note">This counts your card at its spending limit. Spending more on the card comes straight out of what's left.</p>`;
    return `<table class="table plan">
      ${later ? `<thead><tr><th></th><th class="num">${esc(monthShort(plan.month))}</th><th class="num">From ${esc(monthShort(later.month))}</th></tr></thead>` : ''}
      <tbody>
        ${row('Income', 'income', 1)}
        ${row('Rent &amp; bills', 'bills', -1)}
        ${cardLabel ? row(cardLabel, 'cardSpending', -1) : ''}
        ${row('Automatic saving', 'saving', -1)}
        ${row('Automatic investing', 'investing', -1)}
        <tr class="plan-total"><td><strong>Left over</strong></td>${leftCell(plan)}${later ? leftCell(later) : ''}</tr>
      </tbody></table>${tip}`;
  }

  const cardAccounts = () => activeAccounts().filter((a) => a.type === 'liability' && (a.payInFull || Number(a.monthlyLimit) > 0));

  /** Paid-in-full dots and bill-vs-limit bars for a card. */
  function cardSummary(a, month, withTick) {
    const months = Finance.lastMonths(month, 6);
    const limit = Number(a.monthlyLimit) || 0;
    const pifStreak = Finance.payInFullStreak(state.paidInFull, a.id, month);
    const limitStreak = limit ? Finance.underLimitStreak(state.cardBills, a.id, limit, month) : 0;
    const bills = months.map((m) => state.cardBills[m]?.[a.id]);
    const maxBill = Math.max(limit, ...bills.filter((v) => v !== undefined), 1);
    const cols = months.map((m, i) => {
      const paid = state.paidInFull[m]?.[a.id];
      const v = bills[i];
      const h = v !== undefined ? Math.max(4, (v / maxBill) * 64) : 0;
      const cls = v === undefined ? '' : !limit || v <= limit ? 'ok' : 'bad';
      return `<div class="cc-col" title="${esc(monthLong(m))}: ${v !== undefined ? 'bill ' + esc(money(v)) : 'no bill entered'}${paid ? ', paid in full' : ''}">
        <div class="cc-bar-area">${limit ? `<div class="cc-limit" style="bottom:${((limit / maxBill) * 64).toFixed(1)}px"></div>` : ''}<div class="cc-bar ${cls}" style="height:${h.toFixed(1)}px"></div></div>
        <span class="cc-amt">${v !== undefined ? esc(fmtCompact.format(v)) : '–'}</span>
        <span class="cc-pif ${paid ? 'paid' : m === month ? 'pending' : ''}">${paid ? '✓' : ''}</span>
        <span class="cc-month">${esc(monthShort(m).split(' ')[0])}</span>
      </div>`;
    }).join('');
    const streaks = [
      a.payInFull ? (pifStreak ? `🔥 Paid in full ${pifStreak} month${pifStreak === 1 ? '' : 's'} in a row` : 'Paid in full: no streak yet') : '',
      limit ? (limitStreak ? `✓ Under ${fmtCompact.format(limit)} ${limitStreak} month${limitStreak === 1 ? '' : 's'} in a row` : `Goal: bill under ${money(limit)}`) : '',
    ].filter(Boolean);
    return `<div class="pif">
      <div class="pif-head"><strong>${esc(a.name)}</strong></div>
      <p class="muted cc-streaks">${streaks.map(esc).join('<br>')}</p>
      ${bills.some((v) => v !== undefined) ? `<div class="cc-chart">${cols}</div>
      ${limit ? '<p class="muted cc-legend"><span class="cc-key ok"></span>under limit <span class="cc-key bad"></span>over limit <span class="cc-key line"></span>limit · ✓ paid in full</p>' : ''}` : '<p class="empty">Your monthly bills will show here as a chart once you enter the first one.</p>'}
      ${withTick ? `<p class="muted">Enter the bill and tick "paid in full" in your <button class="link" data-goto="review">monthly review</button>.</p>` : ''}
    </div>`;
  }

  /** Safety net goal and how many months of costs it covers. */
  function safetyNetInfo() {
    const g = state.goals.find((x) => x.isSafetyNet);
    if (!g) return null;
    const plan = Finance.monthlyPlan(state.bills, state.accounts, thisMonth());
    const costs = plan.bills + plan.cardSpending;
    const saved = Finance.goalSaved(g, state.accounts, state.snapshots, thisMonth());
    if (!costs) return null;
    return { goal: g, saved, costs, months: Finance.monthsCovered(saved, costs), targetMonths: Finance.monthsCovered(Number(g.target) || 0, costs) };
  }

  /** Upcoming milestones of a goal (e.g. $300K by Dec 2027 on the way to $500K), each with its own projection. */
  function milestoneStatus(g, today) {
    return (g.milestones || [])
      .filter((m) => Number(m.target) > 0 && m.date && m.date >= today && (!g.targetDate || m.date < g.targetDate))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((m) => ({ ...m, target: Number(m.target), gp: Finance.goalPlan({ ...g, target: Number(m.target), targetDate: m.date }, g.saved, state.bills, today) }));
  }

  /** One-line status for a savings goal: on track / short / months covered. */
  function goalStatusLine(g, brief) {
    const today = localToday();
    const p = Finance.goalProgress(g, today);
    if (p.done) return '<span class="pos">Goal reached! 🎉</span>';
    const gp = Finance.goalPlan(g, g.saved, state.bills, today);
    const bits = [];
    if (g.isSafetyNet) {
      const sn = safetyNetInfo();
      if (sn) bits.push(`Covers <strong>${sn.months} months</strong> of costs (target ${sn.targetMonths})`);
    }
    const nextMs = milestoneStatus(g, today)[0];
    if (nextMs) {
      bits.push(`${esc(fmtCompact.format(nextMs.target))} by ${esc(monthShort(nextMs.date.slice(0, 7)))}: ${nextMs.gp.onTrack ? '<span class="pos">on track ✓</span>' : `<span class="neg">short ${esc(fmtCompact.format(nextMs.gp.shortfall))}</span>`}`);
    }
    if (g.targetDate) {
      if (nextMs) bits.push(`${esc(fmtCompact.format(g.target))} by ${esc(monthShort(g.targetDate.slice(0, 7)))}: ${gp.onTrack ? '<span class="pos">on track ✓</span>' : `<span class="neg">short ${esc(fmtCompact.format(gp.shortfall))}</span>`}`);
      else if (gp.onTrack) bits.push(`<span class="pos">On track ✓</span> projected ${esc(fmtCompact.format(gp.projected))} by ${esc(monthShort(g.targetDate.slice(0, 7)))}`);
      else bits.push(`<span class="neg">Short ${esc(fmtCompact.format(gp.shortfall))}</span>: needs ${esc(money(gp.extraPerMonth))}/month more`);
    } else if (gp.autoPerMonth > 0) {
      bits.push(`${esc(money(gp.autoPerMonth))}/month goes in automatically${gp.monthsToReach ? `: about ${gp.monthsToReach} months to go` : ''}`);
    } else if (!brief || !bits.length) {
      bits.push(`${esc(money(p.remaining))} to go · nothing goes in automatically`);
    }
    return bits.join(' · ');
  }

  function renderNetWorthChart(points) {
    const el = $('#ov-chart');
    if (points.length < 2) {
      el.innerHTML = empty(points.length ? 'Your chart will appear after your second monthly check-in.' : 'Do your first check-in to start tracking your net worth.');
      return;
    }
    const W = Math.max(300, Math.round(el.clientWidth) || 720), H = W < 500 ? 200 : 240, padL = 60, padR = 28, padT = 12, padB = 26;
    const vals = points.map((p) => p.net);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 100; hi += Math.abs(hi) * 0.1 || 100; }
    const span = hi - lo; lo -= span * 0.1; hi += span * 0.1;
    if (lo > 0 && lo < span) lo = 0;
    const x = (i) => padL + (i / (points.length - 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net worth by month">`;
    for (let i = 0; i <= 4; i++) {
      const v = lo + ((hi - lo) / 4) * i;
      svg += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end">${esc(fmtCompact.format(v))}</text>`;
    }
    if (lo < 0 && hi > 0) svg += `<line class="zero" x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}"/>`;
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.net).toFixed(1)}`).join('');
    const base = y(Math.max(lo, 0) === lo ? lo : 0);
    svg += `<path class="area" d="${line}L${x(points.length - 1)},${base}L${x(0)},${base}Z"/><path class="line" d="${line}"/>`;
    const every = Math.ceil(points.length / Math.max(3, Math.floor(W / 90)));
    points.forEach((p, i) => {
      svg += `<circle class="dot${p.checkedIn ? '' : ' hollow'}" cx="${x(i)}" cy="${y(p.net)}" r="${points.length > 18 ? 2.5 : 3.5}"><title>${esc(monthLong(p.month))}: ${esc(money(p.net))}${p.checkedIn ? '' : ' (no check-in, carried forward)'}</title></circle>`;
      if (i % every === 0 || i === points.length - 1) svg += `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(monthShort(p.month))}</text>`;
    });
    el.innerHTML = svg + '</svg>';
  }

  let resizeTimer, lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderOverview, 150);
  });

  // ---- Monthly review ----------------------------------------------------

  const REVIEW_SECTIONS = { pay: 'Pay & confirm', update: 'Update', reflect: 'Reflect' };

  function defaultReview(s) {
    const cards = (s.accounts || []).filter((a) => !a.archived && a.type === 'liability' && (a.payInFull || Number(a.monthlyLimit) > 0));
    return {
      items: [
        { section: 'pay', type: 'task', text: 'Pay rent and bills' },
        ...cards.map((a) => ({ section: 'pay', type: 'card', accountId: a.id, text: `Pay off ${a.name} in full` })),
        { section: 'pay', type: 'task', text: 'Check the automatic transfers went through' },
        { section: 'update', type: 'checkin', text: 'Update account balances' },
        { section: 'update', type: 'import', text: 'Import bank and card statements, and look at where the money went' },
        { section: 'reflect', type: 'goals', text: 'Review my goals and tick off what\'s done' },
        { section: 'reflect', type: 'task', text: 'Look at my biggest purchases: which ones weren\'t worth it?' },
        { section: 'reflect', type: 'note', text: 'Write a note for this month' },
        { section: 'reflect', type: 'backup', text: 'Download a backup' },
      ].map((x) => ({ id: uid(), ...x })),
      months: {},
    };
  }

  /** Make sure every card that's paid in full or has a limit has a review step. */
  function syncReviewCards() {
    const items = state.review.items;
    for (const a of cardAccounts()) {
      if (items.some((i) => i.type === 'card' && i.accountId === a.id)) continue;
      const at = items.findIndex((i) => i.section !== 'pay');
      items.splice(at < 0 ? items.length : at, 0, { id: uid(), section: 'pay', type: 'card', accountId: a.id, text: `Pay off ${a.name} in full` });
    }
    state.review.items = items.filter((i) => i.type !== 'card' || state.accounts.some((a) => a.id === i.accountId && !a.archived));
  }

  const reviewMonth = (m) => state.review.months[m] || (state.review.months[m] = { done: {}, note: '' });

  function isReviewDone(item, m) {
    const rm = state.review.months[m] || { done: {}, note: '' };
    switch (item.type) {
      case 'card': return !!state.paidInFull[m]?.[item.accountId];
      case 'checkin': return !!state.snapshots[m];
      case 'note': return !!(rm.note || '').trim();
      case 'backup': return !!(state.lastBackup && state.lastBackup.startsWith(m)) || !!rm.done[item.id];
      default: return !!rm.done[item.id];
    }
  }

  function reviewProgress(m) {
    const items = state.review.items;
    const done = items.filter((i) => isReviewDone(i, m)).length;
    return { done, total: items.length };
  }

  const rvMonth = $('#rv-month');

  function renderReview() {
    syncReviewCards();
    const m = rvMonth.value || thisMonth();
    const rm = state.review.months[m] || { done: {}, note: '' };
    const p = reviewProgress(m);
    $('#rv-title').textContent = `${monthLong(m)} review`;
    $('#rv-bar').style.width = `${p.total ? (p.done / p.total) * 100 : 0}%`;
    $('#rv-bar').classList.toggle('done', p.done === p.total && p.total > 0);
    $('#rv-progress').textContent = p.done === p.total && p.total ? `✓ All ${p.total} steps done. You're on top of things!` : `${p.done} of ${p.total} steps done`;

    const itemHtml = (it, idx) => {
      const done = isReviewDone(it, m);
      let box, extra = '';
      const auto = { checkin: 'Ticks itself when you save your check-in', note: 'Ticks itself when you write a note', backup: 'Ticks itself when you download a backup' }[it.type];
      if (it.type === 'card') {
        box = `<input type="checkbox" data-pif="${it.accountId}" data-month="${m}" ${done ? 'checked' : ''}>`;
        const a = state.accounts.find((x) => x.id === it.accountId);
        const limit = Number(a?.monthlyLimit) || 0;
        const bill = state.cardBills[m]?.[it.accountId];
        const ratio = limit && bill !== undefined ? bill / limit : 0;
        extra = `<div class="rv-card">
          <label class="inline-label">Bill amount <input type="number" step="0.01" min="0" inputmode="decimal" data-card-bill="${it.accountId}" value="${bill ?? ''}" placeholder="0.00"></label>
          ${limit ? `<div class="rv-limit"><div class="bar-track"><div class="bar-fill ${bill !== undefined ? (ratio > 1 ? 'over' : 'done') : ''}" style="width:${Math.min(1, ratio) * 100}%"></div></div>
            <span class="muted">${bill !== undefined ? `${esc(money(bill))} of your ${esc(money(limit))} limit${ratio > 1 ? ` · <span class="neg">${esc(money(bill - limit))} over</span>` : ' · <span class="pos">under ✓</span>'}` : `Limit: ${esc(money(limit))}`}</span></div>` : ''}
        </div>`;
      } else {
        box = `<input type="checkbox" data-rv-item="${it.id}" ${done ? 'checked' : ''} ${auto && it.type !== 'backup' ? 'disabled' : ''}>`;
      }
      if (it.type === 'checkin') extra = `<button class="small" data-goto="checkin">${done ? 'View check-in' : 'Open check-in'}</button>`;
      if (it.type === 'import') extra = `<button class="small" data-goto="spending">Open Spending</button>`;
      if (it.type === 'goals') extra = `<button class="small" data-goto="goals">Open Goals</button>`;
      if (it.type === 'backup') extra = `<button class="small export-backup">Download backup</button>`;
      if (it.type === 'note') extra = `<textarea data-rv-note rows="3" placeholder="What went well? What will I do differently next month?">${esc(rm.note || '')}</textarea>`;
      return `<div class="rv-item ${done ? 'done' : ''}">
        <div class="rv-line">
          <label class="check">${box} <span>${esc(it.text)}</span></label>
          <button class="icon-btn rv-del" data-rv-del="${it.id}" title="Remove this step" aria-label="Remove step">✕</button>
        </div>
        ${auto ? `<p class="muted rv-hint">${auto}</p>` : ''}
        ${extra}
      </div>`;
    };

    $('#rv-sections').innerHTML = Object.entries(REVIEW_SECTIONS).map(([key, title], si) => {
      const items = state.review.items.filter((i) => i.section === key);
      if (!items.length) return '';
      const d = items.filter((i) => isReviewDone(i, m)).length;
      return `<div class="card rv-section"><h2><span class="rv-num">${si + 1}</span> ${esc(title)} <span class="muted right">${d}/${items.length}</span></h2>${items.map(itemHtml).join('')}</div>`;
    }).join('');

    // History
    const months = new Set([...Object.keys(state.review.months), ...Object.keys(state.snapshots), ...Object.keys(state.cardBills), ...Object.keys(state.paidInFull)]);
    const past = [...months].filter((x) => x !== m && x <= thisMonth()).sort().reverse().slice(0, 12);
    $('#rv-history').innerHTML = past.length ? `<ul class="list rv-hist">${past.map((x) => {
      const pp = reviewProgress(x);
      const note = (state.review.months[x]?.note || '').trim();
      const cards = cardAccounts().map((a) => {
        const v = state.cardBills[x]?.[a.id];
        if (v === undefined) return '';
        const limit = Number(a.monthlyLimit) || 0;
        return `${esc(a.name)} ${esc(money(v))}${limit ? (v <= limit ? ' ✓' : ' ✗') : ''}`;
      }).filter(Boolean).join(' · ');
      return `<li><div class="bill-main"><strong>${esc(monthLong(x))}</strong>
          <span class="muted">${pp.done}/${pp.total} steps${cards ? ' · ' + cards : ''}</span>
          ${note ? `<span class="rv-note-past">“${esc(note)}”</span>` : ''}</div>
          <button class="small" data-rv-open="${x}">Open</button></li>`;
    }).join('')}</ul>` : empty('Your past monthly reviews will show up here.');
  }

  rvMonth.addEventListener('input', renderReview);
  $('#view-review').addEventListener('change', (e) => {
    const t = e.target;
    const m = rvMonth.value || thisMonth();
    if (t.dataset.rvItem) {
      reviewMonth(m).done[t.dataset.rvItem] = t.checked;
      save();
    } else if (t.dataset.cardBill) {
      state.cardBills[m] = { ...(state.cardBills[m] || {}) };
      if (t.value === '') delete state.cardBills[m][t.dataset.cardBill];
      else state.cardBills[m][t.dataset.cardBill] = Finance.round2(Number(t.value));
      save();
      const a = state.accounts.find((x) => x.id === t.dataset.cardBill);
      const v = state.cardBills[m][t.dataset.cardBill];
      if (v !== undefined && Number(a?.monthlyLimit) > 0) toast(v <= a.monthlyLimit ? `Under your ${money(a.monthlyLimit)} limit. Well done! 🎉` : `${money(v - a.monthlyLimit)} over your limit. Let's aim lower next month.`);
    } else if (t.matches('[data-rv-note]')) {
      reviewMonth(m).note = t.value;
      save();
    }
  });
  // Save the note while typing (without redrawing, so the cursor stays put).
  $('#view-review').addEventListener('input', (e) => {
    if (!e.target.matches('[data-rv-note]')) return;
    reviewMonth(rvMonth.value || thisMonth()).note = e.target.value;
    persist();
  });
  $('#view-review').addEventListener('click', (e) => {
    const del = e.target.dataset.rvDel, open = e.target.dataset.rvOpen;
    if (del) {
      const it = state.review.items.find((i) => i.id === del);
      if (it && confirm(`Remove "${it.text}" from your monthly checklist?`)) {
        state.review.items = state.review.items.filter((i) => i.id !== del);
        if (it.type === 'card') toast('Tip: to stop tracking this card, untick "pay in full" and clear the limit on the account.');
        save();
      }
    } else if (open) {
      rvMonth.value = open;
      renderReview();
      window.scrollTo(0, 0);
    }
  });
  $('#rv-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const text = f.text.value.trim();
    if (!text) return;
    const items = state.review.items;
    // Insert at the end of its section.
    let at = -1;
    items.forEach((i, idx) => { if (i.section === f.section.value) at = idx; });
    const item = { id: uid(), section: f.section.value, type: 'task', text };
    if (at < 0) items.push(item); else items.splice(at + 1, 0, item);
    f.text.value = '';
    save();
    toast('Step added');
  });

  // ---- Calendar reminder (.ics) ------------------------------------------

  function downloadReminder() {
    const next = Finance.addMonthsToKey(thisMonth(), 1).replace('-', '');
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Finance Tracker//Monthly review//EN', 'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:monthly-money-review-${uid()}@finance-tracker`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${next}01T090000`,
      `DTEND:${next}01T093000`,
      'RRULE:FREQ=MONTHLY;BYMONTHDAY=1',
      'SUMMARY:Monthly money review',
      'DESCRIPTION:Open Finance Tracker and go through your monthly review (about 30 minutes).',
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Monthly money review', 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n');
    download('monthly-money-review.ics', ics, 'text/calendar');
    toast('Open the downloaded file to add it to your calendar.');
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('.ics-btn')) downloadReminder();
    if (e.target.closest('.export-backup')) exportBackup();
  });

  // ---- Check-in --------------------------------------------------------

  const ciMonth = $('#ci-month');

  function renderCheckin() {
    const month = ciMonth.value || thisMonth();
    const saved = state.snapshots[month] || {};
    const carried = Finance.balancesAt(state.accounts, state.snapshots, Finance.addMonthsToKey(month, -1));
    const accounts = activeAccounts();

    const prevMonth = Object.keys(state.snapshots).filter((x) => x < month && state.snapshots[x]).sort().pop();
    const row = (a) => {
      const v = a.id in saved ? saved[a.id] : carried[a.id];
      let inv = '';
      if (isInvestment(a)) {
        const prevBal = prevMonth ? Finance.balancesAt(state.accounts, state.snapshots, prevMonth)[a.id] : undefined;
        if (prevBal === undefined) {
          inv = `<div class="ci-inv muted">Starting point: from here on, the app tracks what this account earns.</div>`;
        } else {
          const stored = state.contributions[month]?.[a.id];
          const added = stored !== undefined ? stored : defaultContribution(a.id, month, prevMonth);
          inv = `<div class="ci-inv" data-inv-row="${a.id}" data-prev="${prevBal}">
            <label class="inline-label">Put in since ${esc(monthShort(prevMonth))} <input type="number" step="0.01" inputmode="decimal" data-added="${a.id}" value="${added}" aria-label="Money put in since last check-in"></label>
            <span class="ci-gain"></span>
          </div>`;
        }
      }
      return `<div class="ci-row">
        <span class="ci-name">${esc(a.name)}${a.joint ? ' <span class="pill">joint</span>' : ''}${a.group === 'retirement' ? ' <span class="pill">retirement</span>' : a.group === 'investments' ? ` <span class="pill">${esc(a.holding || 'invested')}</span>` : ''}</span>
        <input type="number" step="0.01" inputmode="decimal" data-acct="${a.id}" value="${v ?? ''}" placeholder="0" aria-label="${esc(a.name)} balance">
        <button type="button" class="icon-btn" data-edit-acct="${a.id}" title="Rename">Edit</button>
        <button type="button" class="icon-btn" data-remove-acct="${a.id}" title="Remove">✕</button>
        ${inv}
      </div>`;
    };
    const assets = accounts.filter((a) => a.type !== 'liability');
    const liabs = accounts.filter((a) => a.type === 'liability');
    $('#ci-assets').innerHTML = assets.map(row).join('') || empty('Add your bank accounts, savings, investments…');
    $('#ci-liabs').innerHTML = liabs.map(row).join('') || empty('Credit cards, loans, mortgage… (if any)');

    const pif = liabs.filter((a) => a.payInFull);
    $('#ci-pif').hidden = !pif.length;
    $('#ci-pif').innerHTML = pif.map((a) => `<label class="check"><input type="checkbox" data-pif="${a.id}" data-month="${month}" ${state.paidInFull[month]?.[a.id] ? 'checked' : ''}>
      Paid off <strong>${esc(a.name)}</strong> in full in ${esc(monthLong(month))}</label>`).join('');

    const prevMonths = Object.keys(state.snapshots).filter((m) => m < month).sort();
    $('#ci-status').textContent = !accounts.length ? ''
      : state.snapshots[month] ? `✓ Saved for ${monthLong(month)}`
      : prevMonths.length ? `Not saved yet. Showing balances from ${monthLong(prevMonths[prevMonths.length - 1])}.` : 'Not saved yet';
    updateCheckinTotals();

    // History
    const h = Finance.netWorthHistory(state.accounts, state.snapshots, thisMonth()).reverse();
    $('#ci-history').innerHTML = h.length ? h.map((p, i) => {
      const prev = h[i + 1];
      const diff = prev ? p.net - prev.net : null;
      return `<tr class="${p.checkedIn ? '' : 'muted-row'}">
        <td>${esc(monthLong(p.month))}${p.checkedIn ? '' : ' <span class="pill">no check-in</span>'}</td>
        <td class="num">${esc(money(p.assets))}</td><td class="num">${esc(money(p.liabilities))}</td>
        <td class="num"><strong>${esc(money(p.net))}</strong></td>
        <td class="num ${diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}">${diff == null ? '' : esc(signedMoney(diff))}</td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty">No check-ins yet.</td></tr>';
  }

  function updateCheckinTotals() {
    let have = 0, owe = 0;
    for (const input of $$('#ci-form input[data-acct]')) {
      const a = state.accounts.find((x) => x.id === input.dataset.acct);
      const v = Number(input.value) || 0;
      if (a.type === 'liability') owe += v; else have += v;
    }
    const net = have - owe;
    // Live "earned" figure for investment accounts.
    for (const r of $$('#ci-form [data-inv-row]')) {
      const id = r.dataset.invRow;
      const bal = Number($(`input[data-acct="${id}"]`).value) || 0;
      const added = Number($(`input[data-added="${id}"]`, r).value) || 0;
      const prev = Number(r.dataset.prev) || 0;
      const gain = bal - prev - added;
      const pct = prev + added > 0 ? gain / (prev + added) : 0;
      $('.ci-gain', r).innerHTML = `Earned <strong class="${gain >= 0 ? 'pos' : 'neg'}">${esc(signedMoney(gain))}</strong> <span class="muted">(${pctText(pct)})</span>`;
    }
    $('#ci-assets-total').textContent = money(have);
    $('#ci-liabs-total').textContent = money(owe);
    $('#ci-net').textContent = money(net);
    const month = ciMonth.value || thisMonth();
    const prevMonth = Object.keys(state.snapshots).filter((m) => m < month).sort().pop();
    if (prevMonth) {
      const diff = net - Finance.netWorthAt(state.accounts, state.snapshots, prevMonth).net;
      $('#ci-change').textContent = `(${signedMoney(diff)} vs ${monthShort(prevMonth)})`;
    } else $('#ci-change').textContent = '';
  }

  ciMonth.addEventListener('input', renderCheckin);
  $('#ci-form').addEventListener('input', updateCheckinTotals);
  $('#ci-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const month = ciMonth.value || thisMonth();
    if (!activeAccounts().length) { toast('Add an account first (below)'); return; }
    const snap = { ...(state.snapshots[month] || {}) };
    for (const input of $$('#ci-form input[data-acct]')) snap[input.dataset.acct] = Finance.round2(Number(input.value) || 0);
    state.snapshots[month] = snap;
    const added = {};
    for (const input of $$('#ci-form input[data-added]')) added[input.dataset.added] = Finance.round2(Number(input.value) || 0);
    if (Object.keys(added).length) state.contributions[month] = { ...(state.contributions[month] || {}), ...added };
    state.snapshotDates[month] = month === thisMonth() ? localToday() : monthEnd(month);
    save();
    toast(`Check-in saved for ${monthLong(month)}`);
  });

  $('#ci-form').addEventListener('click', (e) => {
    const editId = e.target.dataset.editAcct, removeId = e.target.dataset.removeAcct;
    if (editId) {
      const a = state.accounts.find((x) => x.id === editId);
      const f = $('#acct-form');
      f.id.value = a.id; f.name.value = a.name; f.type.value = a.type;
      f.joint.checked = !!a.joint; f.payInFull.checked = !!a.payInFull;
      f.group.value = a.group || 'cash'; f.monthlyLimit.value = a.monthlyLimit || '';
      f.holding.value = a.holding || ''; f.investedBefore.value = a.investedBefore ?? '';
      syncAcctForm();
      $('#acct-form-title').textContent = 'Edit account';
      $('#acct-cancel').hidden = false;
      f.scrollIntoView({ behavior: 'smooth', block: 'center' });
      f.name.focus();
    } else if (removeId) {
      const a = state.accounts.find((x) => x.id === removeId);
      const hasHistory = Object.values(state.snapshots).some((s) => removeId in s);
      if (!hasHistory) {
        if (!confirm(`Remove "${a.name}"?`)) return;
        state.accounts = state.accounts.filter((x) => x.id !== removeId);
      } else {
        const month = ciMonth.value || thisMonth();
        if (!confirm(`Remove "${a.name}"? (e.g. you closed it or paid it off)\n\nIts past balances stay in your history. From ${monthLong(month)} on it counts as 0.`)) return;
        a.archived = true;
        state.snapshots[month] = { ...(state.snapshots[month] || {}), [removeId]: 0 };
      }
      save();
    }
  });

  const acctForm = $('#acct-form');
  function syncAcctForm() {
    const liab = acctForm.type.value === 'liability';
    $$('.pif-only', acctForm).forEach((el) => { el.hidden = !liab; });
    $$('.asset-only', acctForm).forEach((el) => { el.hidden = liab; });
    $$('.inv-only', acctForm).forEach((el) => { el.hidden = liab || acctForm.group.value !== 'investments'; });
  }
  acctForm.type.addEventListener('change', syncAcctForm);
  acctForm.group.addEventListener('change', syncAcctForm);
  function resetAcctForm() {
    acctForm.reset(); acctForm.id.value = '';
    $('#acct-form-title').textContent = 'Add an account';
    $('#acct-cancel').hidden = true;
    syncAcctForm();
  }
  acctForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = acctForm.id.value;
    const existing = state.accounts.find((a) => a.id === id);
    const fields = {
      name: acctForm.name.value.trim(), type: acctForm.type.value, joint: acctForm.joint.checked,
      payInFull: acctForm.type.value === 'liability' && acctForm.payInFull.checked,
      group: acctForm.type.value === 'asset' ? acctForm.group.value : undefined,
      monthlyLimit: acctForm.type.value === 'liability' && Number(acctForm.monthlyLimit.value) > 0 ? Number(acctForm.monthlyLimit.value) : undefined,
      holding: acctForm.type.value === 'asset' && acctForm.group.value === 'investments' ? acctForm.holding.value.trim() : undefined,
      investedBefore: acctForm.type.value === 'asset' && acctForm.group.value === 'investments' && acctForm.investedBefore.value !== '' ? Number(acctForm.investedBefore.value) : undefined,
    };
    if (existing) Object.assign(existing, fields);
    else state.accounts.push({ id: uid(), ...fields });
    resetAcctForm();
    save();
    toast(existing ? 'Account updated' : 'Account added. Enter its balance above and save.');
    if (!existing) $('#ci-form').scrollIntoView({ behavior: 'smooth' });
  });
  $('#acct-cancel').addEventListener('click', resetAcctForm);

  // ---- Bills -----------------------------------------------------------

  const billForm = $('#bill-form');
  billForm.category.innerHTML = BILL_CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('');

  function renderBills() {
    const today = localToday();
    const m = thisMonth();
    const t = Finance.billTotals(state.bills, 'bill', m);
    $('#bills-month').textContent = money(t.perMonth);
    $('#bills-year').textContent = `${money(t.perYear)} per year`;
    $('#saving-month').textContent = money(Finance.billTotals(state.bills, 'saving', m).perMonth);
    $('#investing-month').textContent = money(Finance.billTotals(state.bills, 'investing', m).perMonth);
    const plan = Finance.monthlyPlan(state.bills, state.accounts, m);
    const later = nextDifferentPlan(plan);
    $('#income-month').textContent = money(plan.income);
    $('#income-sub').textContent = later && later.income !== plan.income ? `${money(later.income)} from ${monthShort(later.month)}` : '';

    const assetOpts = activeAccounts().filter((a) => a.type !== 'liability').map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
    const prevTo = billForm.toAccountId.value;
    billForm.toAccountId.innerHTML = '<option value="">(not set)</option>' + assetOpts;
    billForm.toAccountId.value = prevTo;

    const rows = state.bills
      .filter((b) => !b.endMonth || b.endMonth >= m)
      .map((b) => ({ b, due: Finance.nextDueDate(b, b.startMonth && `${b.startMonth}-01` > today ? `${b.startMonth}-01` : today) }))
      .sort((a, z) => (a.due || '').localeCompare(z.due || ''));
    const span = (b) => [b.startMonth ? `from ${monthShort(b.startMonth)}` : '', b.endMonth ? `until ${monthShort(b.endMonth)}` : ''].filter(Boolean).join(' ');
    const toName = (b) => { const a = state.accounts.find((x) => x.id === b.toAccountId); return a ? ` → ${a.name}` : ''; };
    const item = ({ b, due }) => `
      <li>
        <div class="bill-main"><strong>${esc(b.name)}</strong>
          <span class="muted">${esc(Finance.FREQUENCIES[b.frequency]?.label || '')} · next ${esc(dueLabel(due))}${span(b) ? ` · ${esc(span(b))}` : ''}${esc(toName(b))}${(b.kind || 'bill') === 'bill' ? ` · <span class="pill">${esc(b.category)}</span>` : ''}</span></div>
        <div class="bill-amt">${b.variable ? '<span class="muted">full balance</span>' : `<span class="amt ${b.kind === 'income' ? 'pos' : ''}">${b.kind === 'income' ? '+' : ''}${esc(money(b.amount))}</span>`}
          ${!b.variable && b.frequency !== 'monthly' ? `<span class="muted">${esc(money(Finance.monthlyCost(b)))}/mo</span>` : ''}</div>
        <div class="row-actions"><button class="icon-btn" data-edit-bill="${b.id}">Edit</button><button class="icon-btn" data-del-bill="${b.id}">✕</button></div>
      </li>`;
    const groups = [
      ['Income', rows.filter(({ b }) => b.kind === 'income')],
      ['Bills & expenses', rows.filter(({ b }) => (b.kind || 'bill') === 'bill')],
      ['Automatic saving & investing', rows.filter(({ b }) => ['saving', 'investing'].includes(b.kind))],
    ].filter(([, list]) => list.length);
    $('#bill-list').innerHTML = rows.length
      ? groups.map(([title, list]) => `<h3>${title}</h3><ul class="list bills">${list.map(item).join('')}</ul>`).join('')
      : empty('Nothing yet. Add rent, utilities, phone, insurance, subscriptions, and automatic transfers to savings or investments.');

    const max = t.byCategory[0]?.total || 1;
    $('#bill-cats').innerHTML = t.byCategory.length ? t.byCategory.map((c) => barRow(c.category, c.total / max, money(c.total))).join('') : empty('Add bills to see the breakdown.');
  }

  function syncBillForm() {
    const f = billForm;
    $('.bill-only', f).hidden = f.kind.value !== 'bill';
    $('.to-only', f).hidden = !['saving', 'investing'].includes(f.kind.value);
    f.variable.closest('label').hidden = f.kind.value !== 'bill';
    if (f.kind.value !== 'bill') f.variable.checked = false;
    f.amount.required = !f.variable.checked;
    f.amount.disabled = f.variable.checked;
    if (f.variable.checked) f.amount.value = '';
  }
  billForm.kind.addEventListener('change', syncBillForm);
  billForm.variable.addEventListener('change', syncBillForm);

  function resetBillForm() {
    billForm.reset(); billForm.id.value = '';
    billForm.kind.value = 'bill';
    billForm.dueDate.value = localToday();
    $('#bill-form-title').textContent = 'Add a recurring payment';
    $('#bill-cancel').hidden = true;
    syncBillForm();
  }
  billForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = billForm;
    const kind = f.kind.value;
    const bill = {
      id: f.id.value || uid(), name: f.name.value.trim(), kind, variable: kind === 'bill' && f.variable.checked,
      amount: kind === 'bill' && f.variable.checked ? 0 : Finance.round2(Number(f.amount.value)),
      frequency: f.frequency.value, dueDate: f.dueDate.value,
      category: kind === 'bill' ? f.category.value : { saving: 'Saving', investing: 'Investing', income: 'Income' }[kind],
      toAccountId: ['saving', 'investing'].includes(kind) ? f.toAccountId.value : '',
      startMonth: f.startMonth.value || '', endMonth: f.endMonth.value || '',
    };
    if (bill.startMonth && bill.endMonth && bill.endMonth < bill.startMonth) { toast('The end month is before the start month'); return; }
    if (bill.startMonth && bill.dueDate.slice(0, 7) < bill.startMonth) bill.dueDate = `${bill.startMonth}${bill.dueDate.slice(7)}`;
    const i = state.bills.findIndex((b) => b.id === bill.id);
    if (i >= 0) state.bills[i] = bill; else state.bills.push(bill);
    resetBillForm();
    save();
    toast(i >= 0 ? 'Updated' : 'Added');
  });
  $('#bill-cancel').addEventListener('click', resetBillForm);
  $('#bill-list').addEventListener('click', (e) => {
    const editId = e.target.dataset.editBill, delId = e.target.dataset.delBill;
    if (editId) {
      const b = state.bills.find((x) => x.id === editId);
      for (const k of ['id', 'name', 'amount', 'frequency', 'dueDate', 'startMonth', 'endMonth']) billForm[k].value = b[k] ?? '';
      billForm.toAccountId.value = b.toAccountId || '';
      billForm.kind.value = b.kind || 'bill';
      billForm.variable.checked = !!b.variable;
      if (BILL_CATEGORIES.includes(b.category)) billForm.category.value = b.category;
      syncBillForm();
      $('#bill-form-title').textContent = 'Edit recurring payment';
      $('#bill-cancel').hidden = false;
      billForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (delId && confirm('Delete this recurring payment?')) {
      state.bills = state.bills.filter((b) => b.id !== delId);
      save();
    }
  });
  billForm.name.addEventListener('change', () => {
    // Pre-pick a sensible type and category from the name, if the user hasn't chosen one.
    if (billForm.id.value) return;
    const n = billForm.name.value.toLowerCase();
    if (billForm.kind.value === 'bill') {
      if (/pay ?check|salary|wages|payroll/.test(n)) billForm.kind.value = 'income';
      else if (/invest|brokerage|401|ira\b|etf|stocks|index fund|robo|fidelity|vanguard/.test(n)) billForm.kind.value = 'investing';
      else if (/saving|transfer to|emergency fund/.test(n)) billForm.kind.value = 'saving';
      syncBillForm();
    }
    if (billForm.category.value !== 'Housing') return;
    const guess = /rent|mortgage/.test(n) ? 'Housing' : /electric|water|gas|energy|heating/.test(n) ? 'Utilities'
      : /phone|mobile|internet|broadband|wifi/.test(n) ? 'Phone & internet' : /insurance/.test(n) ? 'Insurance'
      : /netflix|spotify|disney|hbo|prime|apple|icloud|youtube|subscription|adobe|chatgpt|claude/.test(n) ? 'Subscriptions'
      : /car|bus|train|transit|parking|fuel/.test(n) ? 'Transport' : /loan|credit|card/.test(n) ? 'Loans & credit'
      : /gym|fitness|health|doctor|dental/.test(n) ? 'Health & fitness' : null;
    if (guess) billForm.category.value = guess;
  });

  // ---- Goals -----------------------------------------------------------

  const goalForm = $('#goal-form');
  const todoForm = $('#todo-form');

  function renderGoals() {
    const today = localToday();
    const month = thisMonth();

    // My goals checklist
    const list = (horizon) => {
      const items = state.todos.filter((t) => (t.horizon === 'long') === (horizon === 'long'))
        .sort((a, b) => a.done - b.done); // keep the user's order; finished goals go last
      return items.length ? items.map((t) => `<li class="${t.done ? 'done' : ''}">
        <label class="check"><input type="checkbox" data-todo="${t.id}" ${t.done ? 'checked' : ''}> <span>${esc(t.text)}${todoMeta(t)}</span></label>
        <span class="row-actions"><button class="icon-btn" data-edit-todo="${t.id}">Edit</button><button class="icon-btn" data-del-todo="${t.id}" title="Delete">✕</button></span>
      </li>`).join('') : '<li class="empty">Nothing here yet.</li>';
    };
    $('#todo-short').innerHTML = list('short');
    $('#todo-long').innerHTML = list('long');

    // Account picker for savings goals (keeps ticks while the form is open)
    const ticked = new Set($$('#goal-accounts input:checked').map((i) => i.value));
    $('#goal-accounts').innerHTML = activeAccounts().filter((a) => a.type !== 'liability')
      .map((a) => `<label class="check"><input type="checkbox" value="${a.id}" ${ticked.has(a.id) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')
      || '<span class="muted">Add accounts on the Check-in tab first.</span>';
    syncGoalForm();

    $('#goal-cards').innerHTML = state.goals.length ? state.goals.map((goal) => {
      const g = { ...goal, saved: Finance.goalSaved(goal, state.accounts, state.snapshots, month) };
      const ids = Finance.goalAccountIds(goal);
      const linked = ids.map((id) => state.accounts.find((a) => a.id === id)).filter(Boolean);
      const p = Finance.goalProgress(g, today);
      const gp = Finance.goalPlan(g, g.saved, state.bills, today);
      const lines = [];
      if (!p.done && g.targetDate) {
        lines.push(`<p class="goal-verdict ${gp.onTrack ? 'ok' : 'bad'}">${gp.onTrack
          ? `✓ On track: projected <strong>${esc(money(gp.projected))}</strong> by ${esc(monthLong(g.targetDate.slice(0, 7)))}${gp.surplus ? ` (${esc(money(gp.surplus))} to spare)` : ''}`
          : `Short by <strong>${esc(money(gp.shortfall))}</strong>. Save about <strong>${esc(money(gp.extraPerMonth))}/month</strong> more to reach it by ${esc(monthLong(g.targetDate.slice(0, 7)))}`}</p>`);
        const parts = [`${esc(money(g.saved))} now`];
        if (gp.auto) parts.push(`${esc(money(gp.auto))} from automatic transfers (${esc(money(gp.autoPerMonth))}/month)`);
        if (gp.lumps) parts.push(`${esc(money(gp.lumps))} expected`);
        lines.push(`<p class="muted">How we got there: ${parts.join(' + ')}${gp.lumps || gp.auto ? ` = ${esc(money(gp.projected))}` : ''}.</p>`);
      } else if (!p.done) {
        lines.push(`<p class="muted">${goalStatusLine(g, false)}</p>`);
        if (gp.autoPerMonth === 0) {
          const left = Finance.monthlyPlan(state.bills, state.accounts, month);
          const later = nextDifferentPlan(left);
          const spare = Math.max(left.left, later ? later.left : 0);
          if (spare > 0) lines.push(`<p class="muted">💡 If you moved your ${esc(money(spare))} monthly leftover here, you'd reach it in about <strong>${Math.ceil(Math.max(0, p.remaining - gp.lumps) / spare)} months</strong>.</p>`);
        }
      } else lines.push('<p class="pos">Goal reached! 🎉</p>');
      if (g.isSafetyNet && g.targetDate) {
        const sn = safetyNetInfo();
        if (sn) lines.push(`<p class="muted">Covers ${sn.months} months of costs (target ${sn.targetMonths}).</p>`);
      }
      const expected = (goal.expected || []).map((x, i) => ({ ...x, i })).filter((x) => !x.received);
      const ms = milestoneStatus(g, today);
      const markers = ms.filter((m) => m.target < g.target).map((m) => `<span class="ms-mark" style="left:${((m.target / g.target) * 100).toFixed(1)}%" title="Milestone: ${esc(money(m.target))} by ${esc(monthLong(m.date.slice(0, 7)))}"></span>`).join('');
      const msBlock = ms.length ? `<div class="milestones"><span class="field-label">Milestones on the way</span>${ms.map((m) => `<div class="ms-row">
          <span><strong>${esc(money(m.target))}</strong> by ${esc(monthLong(m.date.slice(0, 7)))}</span>
          <span class="${m.gp.onTrack ? 'pos' : 'neg'}">${m.gp.onTrack ? `✓ on track (projected ${esc(fmtCompact.format(m.gp.projected))})` : `short ${esc(money(m.gp.shortfall))}: +${esc(money(m.gp.extraPerMonth))}/month`}</span>
        </div>`).join('')}</div>` : '';
      return `<div class="card goal">
        <div class="goal-head"><h2>${esc(g.name)}</h2><span class="goal-pct">${Math.round(p.ratio * 100)}%</span></div>
        <div class="bar-track big ms-track"><div class="bar-fill ${p.done ? 'done' : ''}" style="width:${(p.ratio * 100).toFixed(1)}%"></div>${markers}</div>
        <p class="goal-amounts"><strong>${esc(money(g.saved))}</strong> of ${esc(money(g.target))}${g.targetDate ? ` · by ${esc(monthLong(g.targetDate.slice(0, 7)))}` : ''}</p>
        ${msBlock}
        ${lines.join('')}
        ${expected.length ? `<div class="expected"><span class="field-label">Expected money</span>${expected.map((x) => `<div class="exp-row">
            <span>${esc(x.label || 'Expected')} · ${esc(money(x.amount))} · ${esc(dayLabel(x.date))}${x.date < today ? ' <span class="neg">(date passed)</span>' : ''}</span>
            <button class="small" data-received="${goal.id}:${x.i}" title="Mark as arrived. The money is now in your accounts, so it's counted from your check-in instead.">Arrived ✓</button></div>`).join('')}</div>` : ''}
        ${linked.length ? `<p class="muted linked">Tracks ${linked.map((a) => `<strong>${esc(a.name)}</strong>`).join(' + ')}. Updates with your check-in.</p>`
          : `<form class="goal-add" data-goal="${g.id}">
          <input type="number" step="0.01" inputmode="decimal" name="delta" placeholder="Amount" aria-label="Amount to add" required>
          <button type="submit" name="op" value="add">Add</button>
          <button type="submit" name="op" value="sub" class="ghost">Take out</button>
        </form>`}
        <div class="row-actions left"><button class="icon-btn" data-edit-goal="${g.id}">Edit</button><button class="icon-btn" data-del-goal="${g.id}">Delete</button></div>
      </div>`;
    }).join('') : `<div class="card">${empty('No savings goals yet. Examples: a safety net (3–6 months of costs), a down payment, a holiday.')}</div>`;
  }

  // ---- My goals (checklist) ----
  function resetTodoForm() {
    const horizon = todoForm.horizon.value;
    todoForm.reset(); todoForm.id.value = '';
    todoForm.horizon.value = horizon;
    todoForm.querySelector('button[type=submit]').textContent = 'Add';
    $('#todo-cancel').hidden = true;
  }
  todoForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = todoForm.text.value.trim();
    if (!text) return;
    const fields = { text, horizon: todoForm.horizon.value, dueDate: todoForm.dueDate.value || '', note: todoForm.note.value.trim() };
    const existing = state.todos.find((t) => t.id === todoForm.id.value);
    if (existing) Object.assign(existing, fields);
    else state.todos.push({ id: uid(), done: false, ...fields });
    resetTodoForm();
    save();
  });
  $('#todo-cancel').addEventListener('click', resetTodoForm);
  $('#view-goals').addEventListener('click', (e) => {
    const editId = e.target.dataset.editTodo, delId = e.target.dataset.delTodo, rec = e.target.dataset.received;
    if (editId) {
      const t = state.todos.find((x) => x.id === editId);
      todoForm.id.value = t.id; todoForm.text.value = t.text; todoForm.horizon.value = t.horizon || 'short';
      todoForm.dueDate.value = t.dueDate || ''; todoForm.note.value = t.note || '';
      todoForm.querySelector('button[type=submit]').textContent = 'Save';
      $('#todo-cancel').hidden = false;
      todoForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
      todoForm.text.focus();
    } else if (delId && confirm('Delete this goal?')) {
      state.todos = state.todos.filter((t) => t.id !== delId);
      save();
    } else if (rec) {
      const [gid, i] = rec.split(':');
      const g = state.goals.find((x) => x.id === gid);
      const x = g?.expected?.[Number(i)];
      if (!x) return;
      if (!confirm(`Mark "${x.label || 'expected money'}" (${money(x.amount)}) as arrived?\n\nAfter this, it's counted through your account balances. Remember to update them in your check-in.`)) return;
      x.received = true;
      save();
      toast('Marked as arrived. Update your balances in the check-in.');
    }
  });

  // ---- Savings goals ----
  function syncGoalForm() {
    $('.manual-only', goalForm).hidden = $$('#goal-accounts input:checked').length > 0;
  }
  $('#goal-accounts').addEventListener('change', syncGoalForm);

  function expectedRow(x = {}) {
    return `<div class="exp-edit">
      <input type="text" data-exp="label" placeholder="e.g. Year-end bonus" value="${esc(x.label || '')}" aria-label="What">
      <input type="number" data-exp="amount" step="0.01" min="0" placeholder="Amount" value="${x.amount ?? ''}" aria-label="Amount">
      <input type="date" data-exp="date" value="${esc(x.date || '')}" aria-label="When">
      <button type="button" class="icon-btn" data-exp-del title="Remove">✕</button>
    </div>`;
  }
  $('#goal-add-expected').addEventListener('click', () => $('#goal-expected').insertAdjacentHTML('beforeend', expectedRow()));

  function milestoneRow(m = {}) {
    return `<div class="exp-edit ms-edit">
      <input type="number" data-ms="target" step="1" min="0" placeholder="Amount, e.g. 300000" value="${m.target ?? ''}" aria-label="Milestone amount">
      <input type="date" data-ms="date" value="${esc(m.date || '')}" aria-label="Milestone date">
      <button type="button" class="icon-btn" data-exp-del title="Remove">✕</button>
    </div>`;
  }
  $('#goal-add-milestone').addEventListener('click', () => $('#goal-milestones').insertAdjacentHTML('beforeend', milestoneRow()));
  $('#goal-milestones').addEventListener('click', (e) => { if (e.target.matches('[data-exp-del]')) e.target.closest('.exp-edit').remove(); });
  $('#goal-expected').addEventListener('click', (e) => { if (e.target.matches('[data-exp-del]')) e.target.closest('.exp-edit').remove(); });

  function resetGoalForm() {
    goalForm.reset(); goalForm.id.value = '';
    $$('#goal-accounts input').forEach((i) => { i.checked = false; });
    $('#goal-expected').innerHTML = '';
    $('#goal-milestones').innerHTML = '';
    $('#goal-form-title').textContent = 'Add a savings goal';
    $('#goal-cancel').hidden = true;
    syncGoalForm();
  }
  goalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = goalForm;
    const old = state.goals.find((g) => g.id === f.id.value);
    const expected = $$('#goal-expected .exp-edit').map((row) => ({
      label: $('[data-exp=label]', row).value.trim(),
      amount: Finance.round2(Number($('[data-exp=amount]', row).value) || 0),
      date: $('[data-exp=date]', row).value,
    })).filter((x) => x.amount > 0 && x.date);
    // Keep amounts already marked as arrived.
    for (const x of old?.expected || []) if (x.received) expected.push(x);
    const goal = {
      id: f.id.value || uid(), name: f.name.value.trim(), target: Finance.round2(Number(f.target.value)),
      saved: Finance.round2(Number(f.saved.value) || 0), targetDate: f.targetDate.value || '',
      accountIds: $$('#goal-accounts input:checked').map((i) => i.value),
      expected, isSafetyNet: f.isSafetyNet.checked,
      milestones: $$('#goal-milestones .ms-edit').map((row) => ({
        target: Finance.round2(Number($('[data-ms=target]', row).value) || 0),
        date: $('[data-ms=date]', row).value,
      })).filter((m) => m.target > 0 && m.date),
    };
    if (goal.isSafetyNet) for (const g of state.goals) if (g.id !== goal.id) g.isSafetyNet = false;
    const i = state.goals.findIndex((g) => g.id === goal.id);
    if (i >= 0) state.goals[i] = goal; else state.goals.push(goal);
    resetGoalForm();
    save();
    toast(i >= 0 ? 'Goal updated' : 'Goal added');
  });
  $('#goal-cancel').addEventListener('click', resetGoalForm);
  $('#goal-cards').addEventListener('submit', (e) => {
    e.preventDefault();
    const g = state.goals.find((x) => x.id === e.target.dataset.goal);
    const amt = Math.abs(Number(e.target.delta.value) || 0);
    const op = e.submitter?.value === 'sub' ? -1 : 1;
    if (!g || !amt) return;
    const wasDone = Finance.goalProgress(g, localToday()).done;
    g.saved = Finance.round2(Math.max(0, (Number(g.saved) || 0) + op * amt));
    save();
    const nowDone = Finance.goalProgress(g, localToday()).done;
    toast(nowDone && !wasDone ? `You reached "${g.name}"! 🎉` : `${op > 0 ? 'Added' : 'Took out'} ${money(amt)}`);
  });
  $('#goal-cards').addEventListener('click', (e) => {
    const editId = e.target.dataset.editGoal, delId = e.target.dataset.delGoal;
    if (editId) {
      const g = state.goals.find((x) => x.id === editId);
      for (const k of ['id', 'name', 'target', 'saved', 'targetDate']) goalForm[k].value = g[k] ?? '';
      goalForm.isSafetyNet.checked = !!g.isSafetyNet;
      const ids = new Set(Finance.goalAccountIds(g));
      $$('#goal-accounts input').forEach((i) => { i.checked = ids.has(i.value); });
      $('#goal-expected').innerHTML = (g.expected || []).filter((x) => !x.received).map(expectedRow).join('');
      $('#goal-milestones').innerHTML = (g.milestones || []).map(milestoneRow).join('');
      syncGoalForm();
      $('#goal-form-title').textContent = 'Edit savings goal';
      $('#goal-cancel').hidden = false;
      goalForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (delId && confirm('Delete this savings goal?')) {
      state.goals = state.goals.filter((g) => g.id !== delId);
      save();
    }
  });

  // ---- Spending: import ------------------------------------------------

  let pending = null; // { table, headerIndex, mapping }

  const allCategories = () => [...new Set([...Finance.SPENDING_CATEGORIES, 'Income', ...Object.values(state.rules), ...state.spending.map((e) => e.category)])]
    .sort((a, b) => (a === Finance.EXCLUDED) - (b === Finance.EXCLUDED) || a.localeCompare(b));

  $('#csv-file').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    const table = Finance.parseCsv(await file.text());
    if (table.length < 2) { toast('That file looks empty. Is it a CSV export?'); return; }
    const g = Finance.guessColumns(table);
    const c = g.columns;
    const body = table.slice(g.headerIndex + 1);
    const mode = c.amount < 0 && c.debit >= 0 && c.credit >= 0 ? 'split' : 'signed';
    const date = c.date >= 0 ? c.date : 0;
    const amount = c.amount >= 0 ? c.amount : Math.max(0, g.header.length - 1);
    const values = body.map((r) => Finance.parseAmount(r[amount])).filter((v) => Number.isFinite(v) && v !== 0);
    const positives = values.filter((v) => v > 0).length;
    const fallbackFmt = /^en-US|^en-PH/.test(navigator.language) ? 'mdy' : 'dmy';
    pending = {
      table, headerIndex: g.headerIndex,
      mapping: {
        date, description: c.description, amount, debit: c.debit >= 0 ? c.debit : 0, credit: c.credit >= 0 ? c.credit : 0, mode,
        spendingSign: values.length && positives / values.length > 0.8 ? 'positive' : 'negative',
        dateFormat: Finance.guessDateFormat(body.map((r) => r[date]), fallbackFmt),
      },
    };
    const opts = g.header.map((h, i) => `<option value="${i}">${esc(h || `Column ${i + 1}`)}</option>`).join('');
    for (const sel of $$('#map-form select[data-map]')) {
      const k = sel.dataset.map;
      if (['date', 'amount', 'debit', 'credit'].includes(k)) sel.innerHTML = opts;
      if (k === 'description') sel.innerHTML = '<option value="-1">(none)</option>' + opts;
      sel.value = String(pending.mapping[k]);
    }
    $('#import-panel').hidden = false;
    renderImportPreview();
    $('#import-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  $('#map-form').addEventListener('change', (e) => {
    const k = e.target.dataset.map;
    if (!k || !pending) return;
    pending.mapping[k] = ['mode', 'spendingSign', 'dateFormat'].includes(k) ? e.target.value : Number(e.target.value);
    renderImportPreview();
  });

  function pendingRows() {
    const { rows, skipped } = Finance.mapRows(pending.table, pending.headerIndex, pending.mapping);
    const existing = new Set(state.spending.map(Finance.entryKey));
    const fresh = rows.filter((r) => !existing.has(Finance.entryKey(r)));
    return { rows, fresh, skipped, dupes: rows.length - fresh.length };
  }

  function renderImportPreview() {
    const split = pending.mapping.mode === 'split';
    $$('.m-signed').forEach((el) => { el.hidden = split; });
    $$('.m-split').forEach((el) => { el.hidden = !split; });
    const { rows, fresh, skipped, dupes } = pendingRows();
    $('#import-preview').innerHTML = rows.slice(0, 8).map((r) => `<tr>
      <td>${esc(r.date)}</td><td class="desc">${esc(r.description)}</td>
      <td class="num ${r.kind === 'out' ? 'neg' : 'pos'}">${r.kind === 'out' ? '−' : '+'}${esc(money(r.amount))}</td>
      <td>${esc(Finance.categorize(r.description, r.kind, state.rules))}</td></tr>`).join('')
      || '<tr><td colspan="4" class="empty">No rows could be read. Try different columns or date format.</td></tr>';
    const parts = [`${rows.length} transactions found`];
    if (dupes) parts.push(`${dupes} already imported`);
    if (skipped) parts.push(`${skipped} rows skipped (no date or amount)`);
    $('#import-summary').textContent = parts.join(' · ') + (rows.length > 8 ? '. Showing the first 8.' : '.');
    $('#import-go').textContent = `Import ${fresh.length} transaction${fresh.length === 1 ? '' : 's'}`;
    $('#import-go').disabled = !fresh.length;
  }

  $('#import-go').addEventListener('click', () => {
    const { fresh } = pendingRows();
    for (const r of fresh) state.spending.push({ id: uid(), ...r, category: Finance.categorize(r.description, r.kind, state.rules) });
    const months = [...new Set(fresh.map((r) => r.date.slice(0, 7)))].sort();
    pending = null;
    $('#import-panel').hidden = true;
    if (months.length) spMonthChoice = months[months.length - 1];
    save();
    toast(`Imported ${fresh.length} transactions`);
  });
  $('#import-cancel').addEventListener('click', () => { pending = null; $('#import-panel').hidden = true; });

  // ---- Spending: view --------------------------------------------------

  let spMonthChoice = '';

  function renderSpending() {
    const months = [...new Set(state.spending.map((e) => e.date.slice(0, 7)))].sort().reverse();
    const sel = $('#sp-month');
    if (!months.includes(spMonthChoice)) spMonthChoice = months[0] || '';
    sel.innerHTML = months.length ? months.map((m) => `<option value="${m}">${esc(monthLong(m))}</option>`).join('') : '<option value="">No data yet</option>';
    sel.value = spMonthChoice;

    const cats = allCategories();
    const catFilter = $('#sp-cat-filter');
    const prevFilter = catFilter.value;
    catFilter.innerHTML = '<option value="">All categories</option>' + cats.map((c) => `<option>${esc(c)}</option>`).join('');
    catFilter.value = cats.includes(prevFilter) ? prevFilter : '';

    const s = Finance.spendingSummary(state.spending, spMonthChoice);
    $('#sp-spent').textContent = months.length ? money(s.spent) : '—';
    $('#sp-income').textContent = months.length ? money(s.income) : '—';
    const left = s.income - s.spent;
    $('#sp-left').textContent = months.length ? money(left) : '—';
    $('#sp-left').className = 'value ' + (left < 0 ? 'neg' : 'pos');
    const max = s.byCategory[0]?.total || 1;
    $('#sp-cats').innerHTML = months.length
      ? (s.byCategory.map((c) => barRow(c.category, c.total / max, `${money(c.total)} · ${Math.round((c.total / (s.spent || 1)) * 100)}%`)).join('') || empty('No spending this month.'))
      : empty('Import a bank file above to see where your money goes.');
    $('#sp-delete-month').hidden = !months.length;
    renderSpendingTable();
  }

  function renderSpendingTable() {
    const q = $('#sp-search').value.trim().toLowerCase();
    const cat = $('#sp-cat-filter').value;
    const cats = allCategories();
    const rows = state.spending
      .filter((e) => e.date.startsWith(spMonthChoice || '~'))
      .filter((e) => !cat || e.category === cat)
      .filter((e) => !q || e.description.toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date));
    $('#sp-body').innerHTML = rows.length ? rows.map((e) => `<tr class="${e.category === Finance.EXCLUDED ? 'muted-row' : ''}">
      <td>${esc(dayLabel(e.date))}</td><td class="desc">${esc(e.description)}</td>
      <td><select data-cat="${e.id}" aria-label="Category">${cats.map((c) => `<option${c === e.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new">+ New category…</option></select></td>
      <td class="num ${e.kind === 'out' ? '' : 'pos'}">${e.kind === 'out' ? '−' : '+'}${esc(money(e.amount))}</td></tr>`).join('')
      : `<tr><td colspan="4" class="empty">${state.spending.length ? 'No transactions match.' : 'Nothing imported yet.'}</td></tr>`;
    $('#sp-count').textContent = rows.length ? `${rows.length} shown` : '';
  }

  $('#sp-month').addEventListener('change', (e) => { spMonthChoice = e.target.value; renderSpending(); });
  $('#sp-search').addEventListener('input', renderSpendingTable);
  $('#sp-cat-filter').addEventListener('change', renderSpendingTable);
  $('#sp-body').addEventListener('change', (e) => {
    const id = e.target.dataset.cat;
    if (!id) return;
    const entry = state.spending.find((x) => x.id === id);
    let category = e.target.value;
    if (category === '__new') {
      category = (prompt('Name of the new category:') || '').trim();
      if (!category) { e.target.value = entry.category; return; }
    }
    const key = Finance.merchantKey(entry.description);
    state.rules[key] = category;
    let others = 0;
    for (const x of state.spending) {
      if (Finance.merchantKey(x.description) === key && x.kind === entry.kind) { if (x.id !== id && x.category !== category) others++; x.category = category; }
    }
    save();
    toast(`Saved. "${key || entry.description}" will be ${category} from now on` + (others ? ` (also updated ${others} other${others === 1 ? '' : 's'})` : ''));
  });
  $('#sp-delete-month').addEventListener('click', () => {
    if (!spMonthChoice || !confirm(`Delete all imported transactions for ${monthLong(spMonthChoice)}? Your category choices are kept.`)) return;
    state.spending = state.spending.filter((e) => !e.date.startsWith(spMonthChoice));
    save();
  });

  // ---- Data ------------------------------------------------------------

  $('#settings-form').currency.addEventListener('change', (e) => { state.settings.currency = e.target.value; save(); });

  function download(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportBackup() {
    state.lastBackup = localToday();
    download(`finance-backup-${localToday()}.json`, JSON.stringify(state, null, 2), 'application/json');
    save();
    toast('Backup downloaded. Keep it somewhere safe, like iCloud Drive.');
  }
  $('#export-json').addEventListener('click', exportBackup);

  $('#import-json').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.accounts)) throw new Error('This is not a Finance Tracker backup');
      if (!confirm('Replace everything in the app with this backup?')) return;
      state = normalize(data);
      save();
      toast('Backup restored');
    } catch (err) { toast(`Could not restore: ${err.message}`); }
  });

  $('#reset-all').addEventListener('click', () => {
    if (!confirm('Erase ALL your data? This cannot be undone. Consider downloading a backup first.')) return;
    const currency = state.settings.currency;
    state = normalize(emptyState());
    state.settings.currency = currency;
    save();
    toast('All data erased');
  });

  $('#load-sample').addEventListener('click', () => {
    if ((state.accounts.length || state.bills.length || state.goals.length) && !confirm('Replace your current data with sample data?')) return;
    state = normalize(sampleData());
    save();
    showView('overview');
    toast('Sample data loaded. Use "Erase all data" when you\'re ready to start for real.');
  });

  function sampleData() {
    const s = emptyState();
    s.settings.currency = state.settings.currency;
    const ids = { bank: uid(), sav: uid(), inv: uid(), cc: uid(), car: uid() };
    s.accounts = [
      { id: ids.bank, name: 'Bank account', type: 'asset' },
      { id: ids.sav, name: 'Savings', type: 'asset' },
      { id: ids.inv, name: 'Investments', type: 'asset', group: 'investments' },
      { id: ids.cc, name: 'Credit card', type: 'liability', payInFull: true, monthlyLimit: 1500 },
      { id: ids.car, name: 'Car loan', type: 'liability' },
    ];
    Finance.lastMonths(thisMonth(), 12).forEach((m, i) => {
      const wobble = ((i * 53) % 7) * 90 - 270;
      s.snapshots[m] = {
        [ids.bank]: Finance.round2(2100 + wobble + i * 20),
        [ids.sav]: 4000 + i * 450,
        [ids.inv]: Finance.round2(9000 * (1 + 0.006 * i) + ((i * 37) % 5) * 120 - 240),
        [ids.cc]: Finance.round2(600 + ((i * 29) % 6) * 70),
        [ids.car]: 9800 - i * 310,
      };
    });
    const t = localToday();
    const day = (n) => `${thisMonth()}-${String(n).padStart(2, '0')}`;
    s.bills = [
      { name: 'Rent', amount: 1350, frequency: 'monthly', dueDate: day(1), category: 'Housing' },
      { name: 'Electricity & gas', amount: 95, frequency: 'monthly', dueDate: day(8), category: 'Utilities' },
      { name: 'Phone', amount: 25, frequency: 'monthly', dueDate: day(14), category: 'Phone & internet' },
      { name: 'Internet', amount: 35, frequency: 'monthly', dueDate: day(20), category: 'Phone & internet' },
      { name: 'Netflix', amount: 15.49, frequency: 'monthly', dueDate: day(11), category: 'Subscriptions' },
      { name: 'Spotify', amount: 11.99, frequency: 'monthly', dueDate: day(27), category: 'Subscriptions' },
      { name: 'Gym', amount: 39, frequency: 'monthly', dueDate: day(3), category: 'Health & fitness' },
      { name: 'Car insurance', amount: 720, frequency: 'yearly', dueDate: Finance.addDays(t, 40), category: 'Insurance' },
      { name: 'Car loan payment', amount: 310, frequency: 'monthly', dueDate: day(25), category: 'Loans & credit' },
      { name: 'Amazon Prime', amount: 95, frequency: 'yearly', dueDate: Finance.addDays(t, 12), category: 'Subscriptions' },
      { name: 'Credit card: pay in full', amount: 0, variable: true, frequency: 'monthly', dueDate: day(1), category: 'Loans & credit' },
      { name: 'Transfer to savings', amount: 450, kind: 'saving', frequency: 'monthly', dueDate: day(2), category: 'Saving', toAccountId: ids.sav },
      { name: 'Index fund', amount: 200, kind: 'investing', frequency: 'monthly', dueDate: day(5), category: 'Investing', toAccountId: ids.inv },
      { name: 'Paycheck', amount: 3400, kind: 'income', frequency: 'monthly', dueDate: day(1), category: 'Income' },
    ].map((b) => ({ id: uid(), kind: 'bill', ...b }));
    for (const m of Finance.lastMonths(Finance.addMonthsToKey(thisMonth(), -1), 4)) s.paidInFull[m] = { [ids.cc]: true };
    Finance.lastMonths(Finance.addMonthsToKey(thisMonth(), -1), 5).forEach((m, i) => { s.cardBills[m] = { [ids.cc]: [1720, 1480, 1390, 1610, 1350][i] }; });
    s.todos = [
      { text: 'Build a 3-month emergency fund', horizon: 'short', done: false },
      { text: 'Cancel subscriptions I don\'t use', horizon: 'short', done: true },
      { text: 'Book a meeting with a financial advisor', horizon: 'short', done: false },
      { text: 'Save for a house deposit', horizon: 'long', done: false },
      { text: 'Pay off the car loan', horizon: 'long', done: false },
    ].map((x) => ({ id: uid(), ...x }));
    s.goals = [
      { id: uid(), name: 'Emergency fund', target: 12000, saved: 0, accountIds: [ids.sav], targetDate: Finance.addDays(t, 270), isSafetyNet: true },
      { id: uid(), name: 'Summer holiday', target: 2000, saved: 650, targetDate: Finance.addDays(t, 200) },
      { id: uid(), name: 'New laptop', target: 1200, saved: 1200, targetDate: '' },
    ];
    const prev = Finance.addMonthsToKey(thisMonth(), -1);
    const shops = [
      ['TESCO STORES 2231', 64.2], ['ALDI 118', 41.75], ['STARBUCKS #882', 5.4], ['UBER *TRIP', 14.3], ['SHELL 0921', 58],
      ['AMAZON MKTPLACE', 32.99], ['NETFLIX.COM', 15.49], ['DELIVEROO', 27.8], ['ZARA ONLINE', 49.95], ['BOOTS PHARMACY', 12.6],
      ['TESCO STORES 2231', 58.1], ['PIZZA EXPRESS', 38.5], ['CINEMA CITY', 22], ['LOCAL HARDWARE CO', 18.25], ['RENT PAYMENT', 1350],
      ['TRANSFER TO SAVINGS', 450], ['LIDL 4421', 36.4], ['TFL TRAVEL', 31.2],
    ];
    for (const m of [prev, thisMonth()]) {
      const maxDay = m === thisMonth() ? Math.max(1, Number(t.slice(8, 10))) : 28;
      shops.forEach(([desc, amt], i) => {
        const date = `${m}-${String(1 + ((i * 5) % maxDay)).padStart(2, '0')}`;
        s.spending.push({ id: uid(), date, description: desc, amount: Finance.round2(amt * (m === prev ? 1.08 : 1)), kind: 'out', category: Finance.categorize(desc, 'out', {}) });
      });
      s.spending.push({ id: uid(), date: `${m}-01`, description: 'ACME LTD SALARY', amount: 3400, kind: 'in', category: 'Income' });
    }
    return s;
  }

  // ---- Init ------------------------------------------------------------

  ciMonth.value = thisMonth();
  rvMonth.value = thisMonth();
  // Opening the review from anywhere starts at the current month.
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-goto="review"], .tab[data-view="review"]') && rvMonth.value !== thisMonth()) { rvMonth.value = thisMonth(); renderReview(); }
  }, true);
  resetBillForm();
  render();
  try {
    const v = sessionStorage.getItem('finance-tracker:view');
    if (v && $(`#view-${v}`)) showView(v);
  } catch (e) { /* ignore */ }
})();
