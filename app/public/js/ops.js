/* IncidentFlow ops console */
(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const STATUSES = ['open', 'acknowledged', 'investigating', 'monitoring', 'resolved'];
  const SRC = { manual: 'Reported by ops', customer: 'Customer report', monitor: 'Auto: monitor', checkout: 'Auto: checkout', pipeline: 'Jenkins pipeline' };
  let meta = { services: {}, sla: {}, version: '' };
  let user = null;
  let refresh;

  async function api(url, opts = {}) {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', ...opts });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.includes('/auth/')) { user = null; renderLogin(); throw new Error('Session expired'); }
    if (!res.ok) throw new Error(body.error || 'Request failed');
    return body;
  }
  const ago = (iso) => {
    if (!iso) return '—';
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    if (m < 1440) return Math.floor(m / 60) + ' h ' + (m % 60) + ' min ago';
    return Math.floor(m / 1440) + ' d ago';
  };
  const fmtTime = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const svcName = (k) => (meta.services[k] ? meta.services[k].name : k);
  const mins = (m) => (m < 60 ? m + ' min' : (Math.round(m / 6) / 10) + ' h');
  function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status'); document.body.appendChild(t); setTimeout(() => t.remove(), 2400); }

  // ---------- login ----------
  function renderLogin(msg) {
    clearInterval(refresh);
    app.innerHTML = '<div class="login"><form class="card" id="lf">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px"><img src="/img/incidentflow.svg" width="34" height="34" alt=""><h1>IncidentFlow</h1></div>' +
      '<p class="muted" style="margin:0 0 18px">Sign in to manage incidents for the Cartora store.</p>' +
      (msg ? '<div class="err">' + esc(msg) + '</div>' : '') +
      '<label class="f">Username<input name="username" autocomplete="username" required></label>' +
      '<label class="f">Password<input name="password" type="password" autocomplete="current-password" required></label>' +
      '<button class="btn dark" style="width:100%;justify-content:center">Sign in</button>' +
      '<p class="muted" style="font-size:12px;margin:14px 0 0">Back to the <a href="/">Cartora store</a> • <a href="/status">public status page</a></p></form></div>';
    $('#lf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
        user = r.user; route();
      } catch (err) { renderLogin(err.message); }
    });
  }

  // ---------- layout ----------
  function shell(active, content, openP1 = 0) {
    const nav = (href, label, key, extra = '') => '<a class="nav ' + (active === key ? 'on' : '') + '" href="' + href + '"><span>' + label + '</span>' + extra + '</a>';
    app.innerHTML = '<div class="shell"><aside class="side">' +
      '<a class="brand" href="#/"><img src="/img/incidentflow.svg" alt="">IncidentFlow</a><div class="brand-sub">Cartora operations</div>' +
      nav('#/', 'Overview', 'dash', openP1 ? '<span class="badge">' + openP1 + ' P1</span>' : '') +
      nav('#/incidents', 'Incidents', 'list') +
      nav('#/new', 'Declare incident', 'new') +
      nav('#/services', 'Services & fault injection', 'svc') +
      nav('/status', 'Public status page', '') +
      nav('/', 'Open storefront', '') +
      '<div class="side-foot">Signed in as <strong>' + esc(user) + '</strong><br>Build ' + esc(meta.version) + '<br><button id="logout">Sign out</button></div>' +
      '</aside><main id="main">' + content + '</main></div>';
    $('#logout').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }); user = null; renderLogin(); });
  }

  function incTable(list, compact) {
    if (!list.length) return '<div class="empty">No incidents here. When the store detects a problem it will appear automatically.</div>';
    return '<table><thead><tr><th>ID</th><th>Sev</th><th>Incident</th>' + (compact ? '' : '<th class="hide-sm">Service</th><th class="hide-sm">Team</th>') + '<th>Status</th><th class="hide-sm">Opened</th></tr></thead><tbody>' +
      list.map((i) => '<tr class="click" data-go="#/i/' + i.id + '"><td class="id">' + i.id + '</td><td><span class="sev ' + i.severity + '">' + i.severity + '</span></td>' +
        '<td><a href="#/i/' + i.id + '" style="color:inherit;text-decoration:none;font-weight:600">' + esc(i.title) + '</a><div class="src">' + SRC[i.source] +
        (i.occurrences > 1 ? ' • seen ' + i.occurrences + '×' : '') + (i.impact.failedOrders ? ' • ' + i.impact.failedOrders + ' failed orders' : '') + '</div>' +
        (i.status !== 'resolved' && i.sla && (i.sla.ackBreached || i.sla.resolveBreached) ? '<div class="breach">SLA breached</div>' : '') + '</td>' +
        (compact ? '' : '<td class="hide-sm">' + esc(svcName(i.service)) + '</td><td class="hide-sm">' + esc(i.assignee || i.team) + '</td>') +
        '<td><span class="st ' + i.status + '">' + i.status + '</span></td><td class="hide-sm muted">' + ago(i.createdAt) + '</td></tr>').join('') +
      '</tbody></table>';
  }

  // ---------- views ----------
  async function dashboard() {
    const [s, active, orders] = await Promise.all([api('/api/stats'), api('/api/incidents?status=active'), api('/api/orders')]);
    const sevBars = ['P1', 'P2', 'P3', 'P4'].map((k) => {
      const n = s.bySeverity[k]; const max = Math.max(1, ...Object.values(s.bySeverity));
      return '<div><span class="sev ' + k + '">' + k + '</span><i><b style="width:' + (n / max * 100) + '%;background:var(--' + k.toLowerCase() + ')"></b></i><span>' + n + '</span></div>';
    }).join('');
    shell('dash',
      '<div class="head"><div><h1>Overview</h1><span class="muted">Live view of Cartora incidents and service health. Refreshes every 10 seconds.</span></div><a class="btn primary" href="#/new">Declare incident</a></div>' +
      '<div class="kpis">' +
        kpi('Open incidents', s.open) + kpi('Open P1 (critical)', s.openCritical, s.openCritical > 0) +
        kpi('Mean time to acknowledge', mins(s.mttaMinutes)) + kpi('Mean time to resolve', mins(s.mttrMinutes)) +
        kpi('Failed orders (open)', s.failedOrders, s.failedOrders > 0) + kpi('Revenue at risk', inr(s.revenueAtRisk), s.revenueAtRisk > 0) +
      '</div>' +
      '<div class="cols"><div class="card"><div class="head" style="margin-bottom:6px"><h2 style="margin:0">Active incidents</h2><a href="#/incidents">View all</a></div>' + incTable(active.slice(0, 8), true) + '</div>' +
      '<div style="display:grid;gap:16px">' +
        '<div class="card"><h2>Service health</h2>' + Object.entries(s.services).map(([k, v]) =>
          '<div class="svc-row"><span><span class="dot ' + v.mode + '"></span>' + esc(svcName(k)) + '</span><span class="muted" style="font-size:12px">' + (v.samples ? 'p95 ' + v.p95 + ' ms • ' + Math.round(v.errorRate * 100) + '% errors' : 'no traffic yet') + '</span></div>').join('') + '</div>' +
        '<div class="card"><h2>Open by severity</h2><div class="bars">' + sevBars + '</div>' +
          '<p class="muted" style="margin:14px 0 0;font-size:13px">' + s.autoDetected + ' of ' + s.total + ' incidents were detected automatically • ' + s.slaBreaches + ' open SLA breaches</p></div>' +
        '<div class="card"><h2>Store today</h2><dl class="facts"><dt>Orders placed</dt><dd>' + s.orders.today + '</dd><dt>Revenue</dt><dd>' + inr(s.orders.revenueToday) + '</dd><dt>Last order</dt><dd>' + (orders[0] ? esc(orders[0].id) + ', ' + ago(orders[0].createdAt) : '—') + '</dd></dl></div>' +
      '</div></div>', s.openCritical);
    refresh = setInterval(() => { if (location.hash === '' || location.hash === '#/') dashboard().catch(() => {}); }, 10000);
  }
  const kpi = (label, val, hot) => '<div class="kpi ' + (hot ? 'hot' : '') + '"><span>' + label + '</span><strong>' + val + '</strong></div>';

  async function list() {
    const p = new URLSearchParams(location.hash.split('?')[1] || '');
    if (!p.has('status')) p.set('status', 'active');
    const items = await api('/api/incidents?' + p.toString());
    const sel = (name, opts) => '<select name="' + name + '"><option value="">' + opts[0] + '</option>' + opts.slice(1).map(([v, l]) => '<option value="' + v + '"' + (p.get(name) === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>';
    shell('list', '<div class="head"><h1>Incidents</h1><a class="btn primary" href="#/new">Declare incident</a></div>' +
      '<form class="filters" id="flt">' +
        sel('status', ['All statuses', ['active', 'Active (not resolved)'], ...STATUSES.map((x) => [x, x[0].toUpperCase() + x.slice(1)])]) +
        sel('severity', ['All severities', ['P1', 'P1 Critical'], ['P2', 'P2 High'], ['P3', 'P3 Medium'], ['P4', 'P4 Low']]) +
        sel('service', ['All services', ...Object.entries(meta.services).map(([k, v]) => [k, v.name])]) +
        '<input name="q" placeholder="Search ID or title" value="' + esc(p.get('q') || '') + '">' +
      '</form><div class="card" style="padding:6px 8px">' + incTable(items) + '</div>');
    $('#flt').addEventListener('change', (e) => applyFilter(e.currentTarget));
    $('#flt').addEventListener('submit', (e) => { e.preventDefault(); applyFilter(e.currentTarget); });
  }
  function applyFilter(form) {
    const q = new URLSearchParams();
    for (const [k, v] of new FormData(form)) q.set(k, v);
    location.hash = '#/incidents?' + q.toString();
  }

  async function detail(id) {
    const i = await api('/api/incidents/' + id);
    const idx = STATUSES.indexOf(i.status);
    const sla = meta.sla[i.severity];
    const next = { open: ['acknowledged', 'Acknowledge'], acknowledged: ['investigating', 'Start investigating'], investigating: ['monitoring', 'Fix deployed, monitor'], monitoring: ['resolved', 'Resolve'], resolved: ['investigating', 'Reopen'] }[i.status];
    shell('list', '<p style="margin:0 0 8px"><a href="#/incidents">← All incidents</a></p>' +
      '<div class="head"><div><span class="sev ' + i.severity + '">' + i.severity + '</span> <span class="st ' + i.status + '">' + i.status + '</span> <span class="muted">' + i.id + '</span><h1 style="margin-top:6px">' + esc(i.title) + '</h1></div>' +
        '<button class="btn ' + (next[0] === 'resolved' ? 'green' : 'dark') + '" id="advance">' + next[1] + '</button></div>' +
      '<div class="flow">' + STATUSES.map((s, n) => '<span class="' + (n < idx ? 'done' : n === idx ? 'cur' : '') + '">' + s + '</span>').join('') + '</div>' +
      '<div class="cols"><div style="display:grid;gap:16px">' +
        '<div class="card"><h2>What happened</h2><p style="margin:0">' + (esc(i.description) || '<span class="muted">No description</span>') + '</p></div>' +
        '<div class="card"><h2>Update</h2><div id="uerr"></div><form id="uf">' +
          '<div class="row2"><label class="f">Severity<select name="severity">' + ['P1', 'P2', 'P3', 'P4'].map((s) => '<option' + (s === i.severity ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></label>' +
          '<label class="f">Assigned to<input name="assignee" value="' + esc(i.assignee || '') + '" placeholder="' + esc(i.team) + ' on-call"></label></div>' +
          '<label class="f">Add a timeline note<textarea name="note" rows="2" placeholder="What did you check or change?"></textarea></label>' +
          '<label class="f">Root cause<textarea name="rootCause" rows="2">' + esc(i.rootCause) + '</textarea></label>' +
          '<label class="f">Resolution summary (needed to resolve)<textarea name="resolution" rows="2">' + esc(i.resolution) + '</textarea></label>' +
          '<button class="btn primary">Save update</button></form></div>' +
        '<div class="card"><h2>Timeline</h2><ul class="timeline">' + i.timeline.slice().reverse().map((t) => '<li class="' + t.type + '"><time>' + fmtTime(t.at) + ' • ' + esc(t.by) + '</time><div>' + esc(t.text) + '</div></li>').join('') + '</ul></div>' +
      '</div><div style="display:grid;gap:16px">' +
        '<div class="card"><h2>Details</h2><dl class="facts">' +
          '<dt>Service</dt><dd>' + esc(svcName(i.service)) + '</dd><dt>Owning team</dt><dd>' + esc(i.team) + '</dd><dt>Source</dt><dd>' + SRC[i.source] + '</dd>' +
          '<dt>Reported by</dt><dd>' + esc(i.reporter) + '</dd><dt>Opened</dt><dd>' + fmtTime(i.createdAt) + '</dd><dt>Last seen</dt><dd>' + ago(i.lastSeenAt) + '</dd>' +
          '<dt>Occurrences</dt><dd>' + i.occurrences + '</dd><dt>Failed orders</dt><dd>' + i.impact.failedOrders + '</dd><dt>Revenue at risk</dt><dd>' + inr(i.impact.revenueAtRisk) + '</dd></dl></div>' +
        '<div class="card"><h2>SLA (' + i.severity + ' ' + sla.label + ')</h2><dl class="facts">' +
          '<dt>Acknowledge within</dt><dd>' + mins(sla.ackMin) + (i.sla.ackBreached ? ' <span class="breach">breached</span>' : '') + '</dd>' +
          '<dt>Resolve within</dt><dd>' + mins(sla.resolveMin) + (i.sla.resolveBreached ? ' <span class="breach">breached</span>' : '') + '</dd>' +
          '<dt>Acknowledged</dt><dd>' + (i.acknowledgedAt ? fmtTime(i.acknowledgedAt) : 'Not yet') + '</dd><dt>Resolved</dt><dd>' + (i.resolvedAt ? fmtTime(i.resolvedAt) : 'Not yet') + '</dd></dl></div>' +
        '<div class="card"><h2>Severity suggestion</h2><p style="margin:0">IncidentFlow suggested <span class="sev ' + i.suggestedSeverity + '">' + i.suggestedSeverity + '</span></p><p class="muted" style="margin:6px 0 0;font-size:13px">' + esc(i.severityReason) + '</p></div>' +
      '</div></div>');
    const save = async (extra) => {
      const f = Object.fromEntries(new FormData($('#uf')));
      try {
        await api('/api/incidents/' + id, { method: 'PATCH', body: JSON.stringify({ ...f, assignee: f.assignee || null, ...extra }) });
        toast(extra && extra.status ? 'Status set to ' + extra.status : 'Update saved'); detail(id);
      } catch (err) { $('#uerr').innerHTML = '<div class="err">' + esc(err.message) + '</div>'; }
    };
    $('#uf').addEventListener('submit', (e) => { e.preventDefault(); save(); });
    $('#advance').addEventListener('click', () => save({ status: next[0] }));
  }

  function create() {
    shell('new', '<div class="head"><h1>Declare incident</h1></div><div class="card" style="max-width:720px"><div id="nerr"></div><form id="nf">' +
      '<label class="f">Title<input name="title" required minlength="5" maxlength="140" placeholder="e.g. Card payments failing for HDFC customers"></label>' +
      '<div class="row2"><label class="f">Affected service<select name="service">' + Object.entries(meta.services).map(([k, v]) => '<option value="' + k + '">' + esc(v.name) + ' (' + esc(v.team) + ')</option>').join('') + '</select></label>' +
      '<label class="f">Severity<select name="severity"><option value="">Use suggestion</option><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select></label></div>' +
      '<div class="hint" id="sugg">Start typing a title to get a severity suggestion.</div>' +
      '<label class="f">Description<textarea name="description" rows="4" placeholder="What are customers seeing? Since when?"></textarea></label>' +
      '<label class="f">Assign to (optional)<input name="assignee" placeholder="e.g. Payments on-call"></label>' +
      '<button class="btn primary">Declare incident</button></form></div>');
    let t;
    const suggest = () => { clearTimeout(t); t = setTimeout(async () => {
      const f = new FormData($('#nf'));
      const text = (f.get('title') + ' ' + f.get('description')).trim();
      if (text.length < 4) return;
      const s = await api('/api/severity/suggest?text=' + encodeURIComponent(text) + '&service=' + f.get('service'));
      $('#sugg').innerHTML = 'Suggested severity: <span class="sev ' + s.severity + '">' + s.severity + '</span> ' + esc(meta.sla[s.severity].label) + '. ' + esc(s.reason) + '.';
    }, 250); };
    $('#nf').addEventListener('input', suggest);
    $('#nf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const i = await api('/api/incidents', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
        toast(i.id + ' declared'); location.hash = '#/i/' + i.id;
      } catch (err) { $('#nerr').innerHTML = '<div class="err">' + esc(err.message) + '</div>'; }
    });
  }

  async function services() {
    const s = await api('/api/stats');
    shell('svc', '<div class="head"><div><h1>Services & fault injection</h1><span class="muted">Switch a service to degraded or down to see IncidentFlow detect the problem from real store traffic.</span></div></div>' +
      '<div class="card">' + Object.entries(s.services).map(([k, v]) =>
        '<div class="svc-row"><span><span class="dot ' + v.mode + '"></span><strong>' + esc(svcName(k)) + '</strong> <span class="muted">• ' + esc(meta.services[k].team) + (meta.services[k].revenueCritical ? ' • revenue-critical' : '') + '</span></span>' +
        '<span class="seg" role="group" aria-label="Mode for ' + esc(svcName(k)) + '">' + ['healthy', 'degraded', 'down'].map((m) => '<button data-svc="' + k + '" data-mode="' + m + '" class="' + m + (v.mode === m ? ' on' : '') + '" aria-pressed="' + (v.mode === m) + '">' + m + '</button>').join('') + '</span>' +
        '<div class="meta"><span>' + v.requests + ' requests</span><span>' + v.errors + ' errors</span><span>p95 ' + v.p95 + ' ms (last ' + v.samples + ')</span><span>error rate ' + Math.round(v.errorRate * 100) + '%</span></div></div>').join('') +
      '</div><p class="muted" style="font-size:13px">Detection rules: an incident opens when 30% or more of the last 20 calls fail, when p95 latency goes above 1,200 ms, or immediately when a customer order fails at checkout. Repeated failures are grouped into the same incident.</p>');
  }

  document.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]');
    if (go && !e.target.closest('a')) { location.hash = go.dataset.go; return; }
    const b = e.target.closest('[data-svc]');
    if (b) {
      await api('/api/chaos/' + b.dataset.svc, { method: 'PUT', body: JSON.stringify({ mode: b.dataset.mode }) });
      toast(svcName(b.dataset.svc) + ' set to ' + b.dataset.mode); services();
    }
  });

  async function route() {
    clearInterval(refresh);
    if (!user) return renderLogin();
    const h = location.hash.replace(/^#\/?/, '');
    const [path] = h.split('?');
    try {
      if (!path) await dashboard();
      else if (path === 'incidents') await list();
      else if (path.startsWith('i/')) await detail(path.slice(2));
      else if (path === 'new') create();
      else if (path === 'services') await services();
      else await dashboard();
    } catch (err) {
      if (user) shell('', '<div class="card empty">' + esc(err.message) + '</div>');
    }
  }

  window.addEventListener('hashchange', route);
  (async () => {
    meta = await api('/api/meta');
    try { user = (await api('/api/auth/me')).user; } catch { user = null; }
    route();
  })();
})();
