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
    accounts: [], snapshots: {}, bills: [], goals: [], spending: [], rules: {}, lastBackup: null,
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
    if (data && Array.isArray(data.transactions) && !data.version) return migrateV1(data);
    return { ...emptyState(), ...data, settings: { ...emptyState().settings, ...(data && data.settings) } };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
      const old = localStorage.getItem(OLD_STORAGE_KEY);
      if (old) return normalize(JSON.parse(old));
    } catch (e) { console.warn('Could not load saved data', e); }
    return emptyState();
  }

  let state = load();

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { toast('Could not save. Browser storage is unavailable or full.'); }
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
    renderCheckin();
    renderBills();
    renderGoals();
    renderSpending();
    $('#settings-form').currency.value = state.settings.currency;
    $('#last-backup').textContent = state.lastBackup ? `Last backup downloaded on ${dayLabel(state.lastBackup)}.` : 'You have not downloaded a backup yet.';
  }

  const activeAccounts = () => state.accounts.filter((a) => !a.archived);
  const latestSpendingMonth = () => state.spending.reduce((m, e) => (e.date.slice(0, 7) > m ? e.date.slice(0, 7) : m), '');

  // ---- Overview --------------------------------------------------------

  function renderOverview() {
    const month = thisMonth();
    const today = localToday();

    // Nudge
    const nudge = $('#checkin-nudge');
    if (!state.accounts.length) {
      nudge.hidden = false;
      $('#checkin-nudge-text').textContent = 'Welcome! Start by adding your accounts and their balances. It takes about 5 minutes.';
    } else if (!state.snapshots[month]) {
      nudge.hidden = false;
      $('#checkin-nudge-text').textContent = `Time for your ${monthLong(month)} check-in. Update your balances to see how you're doing.`;
    } else nudge.hidden = true;

    // Net worth
    const history = Finance.netWorthHistory(state.accounts, state.snapshots, month);
    if (history.length) {
      const now = history[history.length - 1];
      $('#ov-networth').textContent = money(now.net);
      $('#ov-networth').className = 'value' + (now.net < 0 ? ' neg' : '');
      const prev = history[history.length - 2];
      if (prev) {
        const diff = Finance.round2(now.net - prev.net);
        $('#ov-networth-sub').innerHTML = `<span class="${diff >= 0 ? 'pos' : 'neg'}">${diff >= 0 ? '▲' : '▼'} ${esc(money(Math.abs(diff)))}</span> since ${esc(monthShort(prev.month))}`;
      } else $('#ov-networth-sub').textContent = `${money(now.assets)} have · ${money(now.liabilities)} owe`;
    } else {
      $('#ov-networth').textContent = '—';
      $('#ov-networth-sub').textContent = 'Do your first check-in';
    }
    renderNetWorthChart(history.slice(-24));

    // Bills
    const bt = Finance.billTotals(state.bills);
    $('#ov-bills').textContent = money(bt.perMonth);
    $('#ov-bills-sub').textContent = state.bills.length ? `${money(bt.perYear)} per year` : 'No bills added yet';
    const up = Finance.upcomingBills(state.bills, today, 30);
    $('#ov-upcoming').innerHTML = up.length
      ? `<ul class="list">${up.map((u) => `<li><span class="when">${esc(dueLabel(u.due))}</span><span>${esc(u.bill.name)}</span><span class="amt">${esc(money(u.bill.amount))}</span></li>`).join('')}</ul>
         <p class="muted total-line">Total: ${esc(money(up.reduce((s, u) => s + Number(u.bill.amount), 0)))}</p>`
      : empty(state.bills.length ? 'Nothing due in the next 30 days.' : 'Add your bills and subscriptions to see what\'s coming up.');

    // Goals
    const saved = state.goals.reduce((s, g) => s + (Number(g.saved) || 0), 0);
    const target = state.goals.reduce((s, g) => s + (Number(g.target) || 0), 0);
    $('#ov-goals').textContent = money(saved);
    $('#ov-goals-sub').textContent = state.goals.length ? `of ${money(target)} across ${state.goals.length} goal${state.goals.length === 1 ? '' : 's'}` : 'No goals yet';
    $('#ov-goal-list').innerHTML = state.goals.length
      ? state.goals.map((g) => { const p = Finance.goalProgress(g, today); return barRow(g.name, p.ratio, `${Math.round(p.ratio * 100)}%`, p.done ? 'done' : ''); }).join('')
      : empty('Set a goal, like an emergency fund or a holiday.');

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
      $('#ov-spent-sub').textContent = 'Import a bank file';
      $('#ov-spending-title').firstChild.textContent = 'Spending ';
      $('#ov-spending').innerHTML = empty('Import a file from your bank on the Spending tab to see where your money goes.');
    }
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

  // ---- Check-in --------------------------------------------------------

  const ciMonth = $('#ci-month');

  function renderCheckin() {
    const month = ciMonth.value || thisMonth();
    const saved = state.snapshots[month] || {};
    const carried = Finance.balancesAt(state.accounts, state.snapshots, Finance.addMonthsToKey(month, -1));
    const accounts = activeAccounts();

    const row = (a) => {
      const v = a.id in saved ? saved[a.id] : carried[a.id];
      return `<div class="ci-row">
        <span class="ci-name">${esc(a.name)}</span>
        <input type="number" step="0.01" inputmode="decimal" data-acct="${a.id}" value="${v ?? ''}" placeholder="0" aria-label="${esc(a.name)} balance">
        <button type="button" class="icon-btn" data-edit-acct="${a.id}" title="Rename">Edit</button>
        <button type="button" class="icon-btn" data-remove-acct="${a.id}" title="Remove">✕</button>
      </div>`;
    };
    const assets = accounts.filter((a) => a.type !== 'liability');
    const liabs = accounts.filter((a) => a.type === 'liability');
    $('#ci-assets').innerHTML = assets.map(row).join('') || empty('Add your bank accounts, savings, investments…');
    $('#ci-liabs').innerHTML = liabs.map(row).join('') || empty('Credit cards, loans, mortgage… (if any)');

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
    save();
    toast(`Check-in saved for ${monthLong(month)}`);
  });

  $('#ci-form').addEventListener('click', (e) => {
    const editId = e.target.dataset.editAcct, removeId = e.target.dataset.removeAcct;
    if (editId) {
      const a = state.accounts.find((x) => x.id === editId);
      const f = $('#acct-form');
      f.id.value = a.id; f.name.value = a.name; f.type.value = a.type;
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
  function resetAcctForm() {
    acctForm.reset(); acctForm.id.value = '';
    $('#acct-form-title').textContent = 'Add an account';
    $('#acct-cancel').hidden = true;
  }
  acctForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = acctForm.id.value;
    const existing = state.accounts.find((a) => a.id === id);
    if (existing) { existing.name = acctForm.name.value.trim(); existing.type = acctForm.type.value; }
    else state.accounts.push({ id: uid(), name: acctForm.name.value.trim(), type: acctForm.type.value });
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
    const t = Finance.billTotals(state.bills);
    $('#bills-month').textContent = money(t.perMonth);
    $('#bills-year').textContent = money(t.perYear);
    $('#bills-count').textContent = String(state.bills.length);

    const rows = state.bills.map((b) => ({ b, due: Finance.nextDueDate(b, today) })).sort((a, z) => (a.due || '').localeCompare(z.due || ''));
    $('#bill-list').innerHTML = rows.length ? `<ul class="list bills">${rows.map(({ b, due }) => `
      <li>
        <div class="bill-main"><strong>${esc(b.name)}</strong>
          <span class="muted">${esc(Finance.FREQUENCIES[b.frequency]?.label || '')} · next ${esc(dueLabel(due))} · <span class="pill">${esc(b.category)}</span></span></div>
        <div class="bill-amt"><span class="amt">${esc(money(b.amount))}</span>
          ${b.frequency !== 'monthly' ? `<span class="muted">${esc(money(Finance.monthlyCost(b)))}/mo</span>` : ''}</div>
        <div class="row-actions"><button class="icon-btn" data-edit-bill="${b.id}">Edit</button><button class="icon-btn" data-del-bill="${b.id}">✕</button></div>
      </li>`).join('')}</ul>`
      : empty('No bills yet. Add rent, utilities, phone, insurance, streaming services, gym…');

    const max = t.byCategory[0]?.total || 1;
    $('#bill-cats').innerHTML = t.byCategory.length ? t.byCategory.map((c) => barRow(c.category, c.total / max, money(c.total))).join('') : empty('Add bills to see the breakdown.');
  }

  function resetBillForm() {
    billForm.reset(); billForm.id.value = '';
    billForm.dueDate.value = localToday();
    $('#bill-form-title').textContent = 'Add a bill or subscription';
    $('#bill-cancel').hidden = true;
  }
  billForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = billForm;
    const bill = { id: f.id.value || uid(), name: f.name.value.trim(), amount: Finance.round2(Number(f.amount.value)), frequency: f.frequency.value, dueDate: f.dueDate.value, category: f.category.value };
    const i = state.bills.findIndex((b) => b.id === bill.id);
    if (i >= 0) state.bills[i] = bill; else state.bills.push(bill);
    resetBillForm();
    save();
    toast(i >= 0 ? 'Bill updated' : 'Bill added');
  });
  $('#bill-cancel').addEventListener('click', resetBillForm);
  $('#bill-list').addEventListener('click', (e) => {
    const editId = e.target.dataset.editBill, delId = e.target.dataset.delBill;
    if (editId) {
      const b = state.bills.find((x) => x.id === editId);
      for (const k of ['id', 'name', 'amount', 'frequency', 'dueDate', 'category']) billForm[k].value = b[k];
      $('#bill-form-title').textContent = 'Edit bill';
      $('#bill-cancel').hidden = false;
      billForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (delId && confirm('Delete this bill?')) {
      state.bills = state.bills.filter((b) => b.id !== delId);
      save();
    }
  });
  billForm.name.addEventListener('change', () => {
    // Pre-pick a sensible category from the name, if the user hasn't chosen one.
    if (billForm.category.value !== 'Housing' || billForm.id.value) return;
    const n = billForm.name.value.toLowerCase();
    const guess = /rent|mortgage/.test(n) ? 'Housing' : /electric|water|gas|energy|heating/.test(n) ? 'Utilities'
      : /phone|mobile|internet|broadband|wifi/.test(n) ? 'Phone & internet' : /insurance/.test(n) ? 'Insurance'
      : /netflix|spotify|disney|hbo|prime|apple|icloud|youtube|subscription|adobe|chatgpt|claude/.test(n) ? 'Subscriptions'
      : /car|bus|train|transit|parking|fuel/.test(n) ? 'Transport' : /loan|credit|card/.test(n) ? 'Loans & credit'
      : /gym|fitness|health|doctor|dental/.test(n) ? 'Health & fitness' : null;
    if (guess) billForm.category.value = guess;
  });

  // ---- Goals -----------------------------------------------------------

  const goalForm = $('#goal-form');

  function renderGoals() {
    const today = localToday();
    $('#goal-cards').innerHTML = state.goals.length ? state.goals.map((g) => {
      const p = Finance.goalProgress(g, today);
      let detail;
      if (p.done) detail = '<span class="pos">Goal reached! 🎉</span>';
      else if (p.overdue) detail = `<span class="neg">Target date passed</span> · ${esc(money(p.remaining))} to go`;
      else if (p.perMonth != null) detail = `${esc(money(p.remaining))} to go · save <strong>${esc(money(p.perMonth))}/month</strong> to reach it by ${esc(monthLong(g.targetDate.slice(0, 7)))}`;
      else detail = `${esc(money(p.remaining))} to go`;
      return `<div class="card goal">
        <div class="goal-head"><h2>${esc(g.name)}</h2><span class="goal-pct">${Math.round(p.ratio * 100)}%</span></div>
        <div class="bar-track big"><div class="bar-fill ${p.done ? 'done' : ''}" style="width:${(p.ratio * 100).toFixed(1)}%"></div></div>
        <p class="goal-amounts"><strong>${esc(money(g.saved))}</strong> of ${esc(money(g.target))}</p>
        <p class="muted">${detail}</p>
        <form class="goal-add" data-goal="${g.id}">
          <input type="number" step="0.01" inputmode="decimal" name="delta" placeholder="Amount" aria-label="Amount to add" required>
          <button type="submit" name="op" value="add">Add</button>
          <button type="submit" name="op" value="sub" class="ghost">Take out</button>
        </form>
        <div class="row-actions left"><button class="icon-btn" data-edit-goal="${g.id}">Edit</button><button class="icon-btn" data-del-goal="${g.id}">Delete</button></div>
      </div>`;
    }).join('') : `<div class="card">${empty('No goals yet. Examples: an emergency fund (3 months of expenses), a holiday, a deposit for a home.')}</div>`;
  }

  function resetGoalForm() {
    goalForm.reset(); goalForm.id.value = '';
    $('#goal-form-title').textContent = 'Add a savings goal';
    $('#goal-cancel').hidden = true;
  }
  goalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = goalForm;
    const goal = { id: f.id.value || uid(), name: f.name.value.trim(), target: Finance.round2(Number(f.target.value)), saved: Finance.round2(Number(f.saved.value) || 0), targetDate: f.targetDate.value || '' };
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
      $('#goal-form-title').textContent = 'Edit goal';
      $('#goal-cancel').hidden = false;
      goalForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (delId && confirm('Delete this goal?')) {
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

  $('#export-json').addEventListener('click', () => {
    state.lastBackup = localToday();
    download(`finance-backup-${localToday()}.json`, JSON.stringify(state, null, 2), 'application/json');
    save();
  });

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
    state = emptyState();
    state.settings.currency = currency;
    save();
    toast('All data erased');
  });

  $('#load-sample').addEventListener('click', () => {
    if ((state.accounts.length || state.bills.length || state.goals.length) && !confirm('Replace your current data with sample data?')) return;
    state = sampleData();
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
      { id: ids.inv, name: 'Investments', type: 'asset' },
      { id: ids.cc, name: 'Credit card', type: 'liability' },
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
    ].map((b) => ({ id: uid(), ...b }));
    s.goals = [
      { id: uid(), name: 'Emergency fund', target: 8000, saved: 5200, targetDate: Finance.addDays(t, 270) },
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
  resetBillForm();
  render();
  try {
    const v = sessionStorage.getItem('finance-tracker:view');
    if (v && $(`#view-${v}`)) showView(v);
  } catch (e) { /* ignore */ }
})();
