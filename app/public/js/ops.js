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
  const AG = {
    working: ['ag-work', 'Agent working'], verifying: ['ag-work', 'Agent verifying fix'],
    fixed: ['ag-ok', 'Fixed by agent'], escalated: ['ag-esc', 'Escalated']
  };
  const agBadge = (i) => i.agent && AG[i.agent.status]
    ? '<span class="ag ' + AG[i.agent.status][0] + '">' + AG[i.agent.status][1] + (i.escalation ? ' \u2192 ' + esc(i.escalation.engineer.split(' ')[0]) + ' (' + esc(i.escalation.ticket) + ')' : '') + '</span>' : '';
  const LOGK = { detect: 'Diagnosed', action: 'Action', verify: 'Verify', fixed: 'Fixed', escalated: 'Escalated', info: 'Info' };
  const logList = (log, n) => !log.length ? '<div class="empty">No agent activity yet. Break a service on the Services page to see it work.</div>'
    : '<ul class="alog">' + log.slice(0, n).map((l) => '<li class="k-' + l.kind + '"><time>' + new Date(l.at).toLocaleTimeString('en-IN') + '</time><b>' + LOGK[l.kind] + '</b><span>' + esc(l.text) + '</span></li>').join('') + '</ul>';
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
      '<p class="muted" style="font-size:12px;margin:14px 0 0">Back to the <a href="/">Cartora store</a> \u2022 <a href="/status">public status page</a></p></form></div>';
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
      nav('#/agent', 'Self-healing agent', 'agent') +
      nav('#/knowledge', 'Agent knowledge', 'kb') +
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
        (i.occurrences > 1 ? ' \u2022 seen ' + i.occurrences + '\u00d7' : '') + (i.impact.failedOrders ? ' \u2022 ' + i.impact.failedOrders + ' failed orders' : '') + ' ' + agBadge(i) + '</div>' +
        (i.status !== 'resolved' && i.sla && (i.sla.ackBreached || i.sla.resolveBreached) ? '<div class="breach">SLA breached</div>' : '') + '</td>' +
        (compact ? '' : '<td class="hide-sm">' + esc(svcName(i.service)) + '</td><td class="hide-sm">' + esc(i.assignee || i.team) + '</td>') +
        '<td><span class="st ' + i.status + '">' + i.status + '</span></td><td class="hide-sm muted">' + ago(i.createdAt) + '</td></tr>').join('') +
      '</tbody></table>';
  }

  // ---------- views ----------
  async function dashboard() {
    const [s, active, orders, ag] = await Promise.all([api('/api/stats'), api('/api/incidents?status=active'), api('/api/orders'), api('/api/agent')]);
    const sevBars = ['P1', 'P2', 'P3', 'P4'].map((k) => {
      const n = s.bySeverity[k]; const max = Math.max(1, ...Object.values(s.bySeverity));
      return '<div><span class="sev ' + k + '">' + k + '</span><i><b style="width:' + (n / max * 100) + '%;background:var(--' + k.toLowerCase() + ')"></b></i><span>' + n + '</span></div>';
    }).join('');
    shell('dash',
      '<div class="head"><div><h1>Overview</h1><span class="muted">Live view of Cartora incidents and service health. Refreshes every few seconds.</span></div><a class="btn primary" href="#/new">Declare incident</a></div>' +
      '<div class="kpis">' +
        kpi('Open incidents', s.open) + kpi('Open P1 (critical)', s.openCritical, s.openCritical > 0) +
        kpi('Mean time to acknowledge', mins(s.mttaMinutes)) + kpi('Mean time to resolve', mins(s.mttrMinutes)) +
        kpi('Failed orders (open)', s.failedOrders, s.failedOrders > 0) + kpi('Revenue at risk', inr(s.revenueAtRisk), s.revenueAtRisk > 0) +
      '</div>' +
      '<div class="cols"><div class="card"><div class="head" style="margin-bottom:6px"><h2 style="margin:0">Active incidents</h2><a href="#/incidents">View all</a></div>' + incTable(active.slice(0, 8), true) + '</div>' +
      '<div style="display:grid;gap:16px">' +
        '<div class="card agent-card"><div class="head" style="margin-bottom:8px"><h2 style="margin:0">Self-healing agent</h2><span class="ag ' + (ag.enabled ? 'ag-ok' : 'ag-esc') + '">' + (ag.enabled ? 'On' : 'Paused') + '</span></div>' +
          '<div class="agstats"><div><strong>' + ag.fixed + '</strong><span>fixed automatically</span></div><div><strong>' + ag.escalated + '</strong><span>escalated to engineers</span></div><div><strong>' + ag.working + '</strong><span>in progress</span></div></div>' +
          '<p class="muted" style="margin:8px 0;font-size:13px">Payments routed to the <b>' + ag.paymentRoute + '</b> gateway \u2022 ' + ag.openTickets + ' open developer tickets</p>' +
          logList(ag.log, 5) + '<p style="margin:8px 0 0"><a href="#/agent">Open agent activity</a></p></div>' +
        '<div class="card"><h2>Service health</h2>' + Object.entries(s.services).map(([k, v]) =>
          '<div class="svc-row"><span><span class="dot ' + v.mode + '"></span>' + esc(svcName(k)) + '</span><span class="muted" style="font-size:12px">' + (v.samples ? 'p95 ' + v.p95 + ' ms \u2022 ' + Math.round(v.errorRate * 100) + '% errors' : 'no traffic yet') + '</span></div>').join('') + '</div>' +
        '<div class="card"><h2>Open by severity</h2><div class="bars">' + sevBars + '</div>' +
          '<p class="muted" style="margin:14px 0 0;font-size:13px">' + s.autoDetected + ' of ' + s.total + ' incidents were detected automatically \u2022 ' + s.slaBreaches + ' open SLA breaches</p></div>' +
        '<div class="card"><h2>Store today</h2><dl class="facts"><dt>Orders placed</dt><dd>' + s.orders.today + '</dd><dt>Revenue</dt><dd>' + inr(s.orders.revenueToday) + '</dd><dt>Last order</dt><dd>' + (orders[0] ? esc(orders[0].id) + ', ' + ago(orders[0].createdAt) : '—') + '</dd></dl></div>' +
      '</div></div>', s.openCritical);
    refresh = setInterval(() => { if (location.hash === '' || location.hash === '#/') dashboard().catch(() => {}); }, 4000);
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
    if (i.agent && i.agent.status === 'escalated' && !i.taught && !KB) KB = await api('/api/knowledge').catch(() => null);
    const idx = STATUSES.indexOf(i.status);
    const sla = meta.sla[i.severity];
    const next = { open: ['acknowledged', 'Acknowledge'], acknowledged: ['investigating', 'Start investigating'], investigating: ['monitoring', 'Fix deployed, monitor'], monitoring: ['resolved', 'Resolve'], resolved: ['investigating', 'Reopen'] }[i.status];
    shell('list', '<p style="margin:0 0 8px"><a href="#/incidents">\u2190 All incidents</a></p>' +
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
        '<div class="card"><h2>Timeline</h2><ul class="timeline">' + i.timeline.slice().reverse().map((t) => '<li class="' + t.type + '"><time>' + fmtTime(t.at) + ' \u2022 ' + esc(t.by) + '</time><div>' + esc(t.text) + '</div></li>').join('') + '</ul></div>' +
      '</div><div style="display:grid;gap:16px">' + agentCard(i) +
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
    const tf = $('#tf');
    if (tf) tf.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/knowledge', { method: 'POST', body: JSON.stringify({ ...Object.fromEntries(new FormData(tf)), service: i.service, incidentId: i.id }) });
        toast('Agent learned ' + r.id + '. Now resolve the incident.'); detail(id);
      } catch (err) { $('#terr').innerHTML = '<div class="err">' + esc(err.message) + '</div>'; }
    });
    if (i.agent && (i.agent.status === 'working' || i.agent.status === 'verifying')) {
      refresh = setInterval(() => { if (location.hash === '#/i/' + id && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('form'))) detail(id).catch(() => {}); }, 3000);
    }
    $('#advance').addEventListener('click', () => save({ status: next[0] }));
  }

  function agentCard(i) {
    if (!i.agent) return '';
    const a = i.agent;
    const AN = { failover: 'Fail over to backup payment gateway', 'reset-pool': 'Reset payment connection pool', reindex: 'Rebuild search index',
      'scale-out': 'Scale out catalogue workers (1 \u2192 3)', restart: 'Restart service worker', 'restart-payments': 'Restart payment worker',
      'flush-cache': 'Flush session cache', 'restart-queue': 'Restart email queue and resend emails', 'courier-failover': 'Switch to backup courier API' };
    return '<div class="card agent-card"><h2>Self-healing agent ' + agBadge(i) + '</h2>' +
      (a.diagnosis && a.diagnosis.finding ? '<p style="margin:0 0 8px;font-size:13.5px"><b>Diagnostic check:</b> ' + esc(a.diagnosis.finding) + '</p>' : '') +
      (a.attempts.length ? '<ol class="attempts">' + a.attempts.map((x) => '<li><b>' + AN[x.action] + '</b> <span class="res r-' + x.result.replace(/ /g, '-') + '">' + x.result + '</span></li>').join('') + '</ol>' : '') +
      (i.escalation ? '<div class="ticket"><strong>Ticket ' + esc(i.escalation.ticket) + '</strong> assigned to <strong>' + esc(i.escalation.engineer) + '</strong> (' + esc(i.escalation.team) + ' on-call)<br><span class="muted">' + esc(i.escalation.reason) + '</span></div>' : '') +
      (a.diagnosis && a.diagnosis.knowledge ? '<p class="muted" style="margin:6px 0 0">Used learned knowledge <a href="#/knowledge">' + esc(a.diagnosis.knowledge) + '</a>.</p>' : '') +
      (a.status === 'fixed' ? '<p class="muted" style="margin:6px 0 0">Resolved without an engineer.</p>' : '') + '</div>' + teachCard(i);
  }

  // Shown on escalated incidents: the engineer records the fix so the agent can apply it next time.
  let KB = null;
  function teachCard(i) {
    if (!i.agent || i.agent.status !== 'escalated' || !meta.services[i.service]) return '';
    if (i.taught) return '<div class="card teach"><h2>Agent knowledge</h2><p style="margin:0">Learned as <a href="#/knowledge"><b>' + esc(i.taught) + '</b></a>. Next time this happens, the agent fixes it on its own.</p></div>';
    if (!KB) return '';
    const sym = i.agent.diagnosis && i.agent.diagnosis.symptom === 'slow' ? 'slow' : 'down';
    const acts = (KB.allowed[i.service] || ['restart']);
    return '<div class="card teach"><h2>Teach the agent</h2><p class="muted" style="margin:0 0 10px;font-size:13px">The agent did not know how to fix this. Tell it what worked, and it will fix this failure by itself next time.</p>' +
      '<div id="terr"></div><form id="tf">' +
      '<label class="f">Failure name<input name="title" maxlength="140" value="' + esc(i.title) + '"></label>' +
      '<div class="row2"><label class="f">Service<input value="' + esc(svcName(i.service)) + '" disabled></label>' +
      '<label class="f">Symptom<select name="symptom"><option value="down"' + (sym === 'down' ? ' selected' : '') + '>Down / failing</option><option value="slow"' + (sym === 'slow' ? ' selected' : '') + '>Slow</option></select></label></div>' +
      '<label class="f">Fix the agent should apply<select name="action">' + acts.map((x) => '<option value="' + x + '">' + esc(KB.actions[x]) + '</option>').join('') + '</select></label>' +
      '<label class="f">How you fixed it (notes for the team)<textarea name="notes" rows="2" placeholder="e.g. Checkout workers were hung; restarting them fixed it"></textarea></label>' +
      '<button class="btn green">Save to agent knowledge</button></form></div>';
  }

  async function knowledgePage() {
    const k = await api('/api/knowledge');
    KB = k;
    const svcOpts = Object.entries(k.services).map(([v, n]) => '<option value="' + v + '">' + esc(n) + '</option>').join('');
    shell('kb', '<div class="head"><div><h1>Agent knowledge</h1><span class="muted">What the self-healing agent knows how to fix. Anything not listed here is a new failure: the agent escalates it to an engineer instead of guessing. Engineers add new entries from an escalated incident or below.</span></div></div>' +
      '<div class="cols"><div style="display:grid;gap:16px">' +
        '<div class="card"><h2>Learned from engineers (' + k.learned.length + ')</h2>' + (k.learned.length ? '<table><thead><tr><th>ID</th><th>Failure</th><th>Fix</th><th>Used</th><th></th></tr></thead><tbody>' +
          k.learned.map((e) => '<tr><td class="id">' + esc(e.id) + '</td><td><b>' + esc(e.title) + '</b><div class="src">' + esc(k.services[e.service]) + ' ' + esc(e.symptom) + (e.learnedFrom ? ' \u2022 from ' + esc(e.learnedFrom) : '') + ' \u2022 by ' + esc(e.by) + '</div>' + (e.notes ? '<div class="src">' + esc(e.notes) + '</div>' : '') + '</td><td>' + esc(k.actions[e.action]) + '</td><td>' + (e.timesUsed || 0) + '\u00d7</td><td><button class="btn ghost" style="padding:4px 10px;font-size:12px" data-forget="' + esc(e.id) + '">Remove</button></td></tr>').join('') + '</tbody></table>'
          : '<div class="empty">Nothing learned yet. Break a service manually on the Services page (an unknown failure), let the agent escalate it, then use "Teach the agent" on the incident.</div>') + '</div>' +
        '<div class="card"><h2>Built-in knowledge (' + k.builtin.length + ')</h2><table><thead><tr><th>Failure</th><th>Agent tries</th><th>Outcome</th></tr></thead><tbody>' +
          k.builtin.map((b) => '<tr><td><b>' + esc(b.title) + '</b><div class="src">' + esc(k.services[b.service]) + '</div></td><td>' + b.playbook.map((x, n) => (n + 1) + '. ' + esc(k.actions[x])).join('<br>') + '</td><td>' + (b.fixable ? '<span class="ag ag-ok">Fixes it</span>' : '<span class="ag ag-esc">Escalates</span>') + '</td></tr>').join('') + '</tbody></table></div>' +
      '</div><div class="card"><h2>Add knowledge</h2><div id="kerr"></div><form id="kf">' +
        '<label class="f">Failure name<input name="title" required maxlength="140" placeholder="e.g. Shipping label printer queue stuck"></label>' +
        '<label class="f">Service<select name="service" id="ksvc">' + svcOpts + '</select></label>' +
        '<label class="f">Symptom<select name="symptom"><option value="down">Down / failing</option><option value="slow">Slow</option></select></label>' +
        '<label class="f">Fix the agent should apply<select name="action" id="kact"></select></label>' +
        '<label class="f">Notes<textarea name="notes" rows="3" placeholder="How was it fixed, any checks to do first"></textarea></label>' +
        '<button class="btn primary">Add to knowledge base</button></form>' +
        '<p class="muted" style="font-size:12.5px;margin:12px 0 0">One entry per service and symptom: saving again for the same pair updates it.</p></div></div>');
    const fillActs = () => { const sv = $('#ksvc').value; $('#kact').innerHTML = (k.allowed[sv] || ['restart']).map((x) => '<option value="' + x + '">' + esc(k.actions[x]) + '</option>').join(''); };
    $('#ksvc').addEventListener('change', fillActs); fillActs();
    $('#kf').addEventListener('submit', async (e) => {
      e.preventDefault();
      try { const r = await api('/api/knowledge', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); toast('Agent learned ' + r.id); knowledgePage(); }
      catch (err) { $('#kerr').innerHTML = '<div class="err">' + esc(err.message) + '</div>'; }
    });
  }

  async function agentPage() {
    const ag = await api('/api/agent');
    shell('agent', '<div class="head"><div><h1>Self-healing agent</h1><span class="muted">For every auto-detected incident the agent diagnoses, tries a safe fix, verifies it for ' + ag.verifySeconds + ' s, and resolves it. After ' + ag.maxAttempts + ' failed attempts it stops and escalates to the on-call engineer with a ticket.</span></div>' +
      '<button class="btn ' + (ag.enabled ? 'ghost' : 'green') + '" id="agToggle">' + (ag.enabled ? 'Pause agent' : 'Turn agent on') + '</button></div>' +
      '<div class="kpis" style="grid-template-columns:repeat(4,minmax(0,1fr))">' + kpi('Fixed automatically', ag.fixed) + kpi('Escalated to engineers', ag.escalated, ag.escalated > 0) + kpi('In progress', ag.working) + kpi('Learned from engineers', ag.learned) + '</div>' +
      '<div class="cols"><div class="card"><h2>Live activity</h2>' + logList(ag.log, 30) + '</div><div style="display:grid;gap:16px">' +
        '<div class="card"><h2>Playbook</h2><table><thead><tr><th>Failure</th><th>Agent tries</th><th>Outcome</th></tr></thead><tbody>' +
          ag.scenarios.map((sc) => '<tr><td>' + esc(sc.title) + '</td><td>' + sc.playbook.map((x, n) => (n + 1) + '. ' + esc(ag.actions[x])).join('<br>') + '</td><td>' +
            (sc.fixable ? '<span class="ag ag-ok">Fixes it</span>' : '<span class="ag ag-esc">Escalates</span>') + '</td></tr>').join('') +
          '<tr><td>Jenkins deployment failed</td><td>None (needs a code fix)</td><td><span class="ag ag-esc">Escalates</span></td></tr></tbody></table></div>' +
        '<div class="card"><h2>Developer tickets</h2>' + (ag.tickets.length ? '<table><thead><tr><th>Ticket</th><th>Incident</th><th>Assigned to</th><th>Status</th></tr></thead><tbody>' +
          ag.tickets.map((t) => '<tr class="click" data-go="#/i/' + t.incidentId + '"><td class="id">' + esc(t.id) + '</td><td>' + esc(t.incidentId) + '<div class="src">' + esc(t.title) + '</div></td><td>' + esc(t.engineer) + '<div class="src">' + esc(t.team) + ' on-call</div></td><td><span class="st ' + (t.status === 'open' ? 'open' : 'resolved') + '">' + t.status + '</span></td></tr>').join('') + '</tbody></table>' : '<div class="empty">No tickets. Everything so far was fixed automatically.</div>') + '</div>' +
        '<div class="card"><h2>On-call roster</h2><dl class="facts">' + Object.entries(ag.oncall).map(([t, n]) => '<dt>' + esc(t) + '</dt><dd>' + esc(n) + '</dd>').join('') + '</dl></div>' +
      '</div></div>');
    $('#agToggle').addEventListener('click', async () => { await api('/api/agent', { method: 'PUT', body: JSON.stringify({ enabled: !ag.enabled }) }); toast(ag.enabled ? 'Agent paused' : 'Agent turned on'); agentPage(); });
    refresh = setInterval(() => { if (location.hash === '#/agent') agentPage().catch(() => {}); }, 3000);
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
    const [s, chaos, ag, fl] = await Promise.all([api('/api/stats'), api('/api/chaos'), api('/api/agent'), api('/api/faults')]);
    const activeIds = Object.values(fl.active);
    const scenCard = '<div class="card" style="margin-bottom:16px"><div class="head" style="margin-bottom:10px"><div><h2 style="margin:0">Inject an e-commerce failure</h2>' +
      '<span class="muted" style="font-size:13px">Pick a failure, then send shopper traffic. IncidentFlow detects it and the agent ' + (ag.enabled ? 'tries to fix it on its own.' : 'is paused, so it waits for an engineer.') + '</span></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="traffic">Send shopper traffic</button><button class="btn ghost" id="clearFaults">Clear all failures</button></div></div>' +
      '<div class="scen">' + fl.scenarios.map((sc) => '<button class="scen-item' + (activeIds.includes(sc.id) ? ' on' : '') + '" data-fault="' + sc.id + '">' +
        '<strong>' + esc(sc.title) + '</strong><span>' + esc(sc.effect) + '</span>' +
        (sc.fixable ? '<em class="ag ag-ok">Agent can fix</em>' : '<em class="ag ag-esc">Needs an engineer</em>') + (activeIds.includes(sc.id) ? '<em class="ag ag-work">Active</em>' : '') + '</button>').join('') + '</div></div>';
    const backupRow = '<div class="svc-row"><span><span class="dot ' + chaos.payments_backup + '"></span><strong>Backup payment gateway</strong> <span class="muted">\u2022 Payments \u2022 standby provider \u2022 traffic now on <b>' + ag.paymentRoute + '</b></span></span>' +
      '<span class="seg" role="group" aria-label="Mode for backup payment gateway">' + ['healthy', 'degraded', 'down'].map((m) => '<button data-svc="payments_backup" data-mode="' + m + '" class="' + m + (chaos.payments_backup === m ? ' on' : '') + '" aria-pressed="' + (chaos.payments_backup === m) + '">' + m + '</button>').join('') + '</span>' +
      '<div class="meta"><span>Used only when the agent fails payments over from the primary gateway</span></div></div>';
    shell('svc', '<div class="head"><div><h1>Services & fault injection</h1><span class="muted">Switch a service to degraded or down to see IncidentFlow detect the problem from real store traffic.</span></div></div>' +
      scenCard + '<h2 style="margin:8px 0 10px">Individual services</h2><div class="card">' + Object.entries(s.services).map(([k, v]) =>
        '<div class="svc-row"><span><span class="dot ' + v.mode + '"></span><strong>' + esc(svcName(k)) + '</strong> <span class="muted">\u2022 ' + esc(meta.services[k].team) + (meta.services[k].revenueCritical ? ' \u2022 revenue-critical' : '') + '</span></span>' +
        '<span class="seg" role="group" aria-label="Mode for ' + esc(svcName(k)) + '">' + ['healthy', 'degraded', 'down'].map((m) => '<button data-svc="' + k + '" data-mode="' + m + '" class="' + m + (v.mode === m ? ' on' : '') + '" aria-pressed="' + (v.mode === m) + '">' + m + '</button>').join('') + '</span>' +
        '<div class="meta"><span>' + v.requests + ' requests</span><span>' + v.errors + ' errors</span><span>p95 ' + v.p95 + ' ms (last ' + v.samples + ')</span><span>error rate ' + Math.round(v.errorRate * 100) + '%</span></div></div>' + (k === 'payments' ? backupRow : '')).join('') +
      '</div><p class="muted" style="font-size:13px">Switching a service by hand here is an <b>unknown</b> failure: the agent has no knowledge of it, so it escalates to an engineer until someone teaches it a fix. "degraded" models a stuck or leaking worker that a restart clears; "down" models an outage of the provider itself that a restart cannot fix. Detection rules: an incident opens when 30% or more of the last 20 calls fail, when p95 latency goes above 1,200 ms, or immediately when a customer order fails at checkout. Repeated failures are grouped into the same incident.</p>');
    $('#clearFaults').addEventListener('click', async () => { await api('/api/faults', { method: 'DELETE' }); toast('All failures cleared'); services(); });
    $('#traffic').addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Sending traffic\u2026';
      const cust = { name: 'Demo Shopper', email: 'demo@example.com', phone: '9000012345', address: '4 Anna Salai', city: 'Chennai', pincode: '600002' };
      const post = (pay) => fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: 'p103', qty: 1 }], customer: cust, payment: pay }) }).catch(() => {});
      const jobs = [];
      for (let n = 0; n < 6; n++) { jobs.push(fetch('/api/products').catch(() => {})); jobs.push(fetch('/api/products/p10' + (1 + (n % 4))).catch(() => {})); }
      await Promise.all(jobs);
      await post('cod'); await post('upi');
      const orders = await api('/api/orders').catch(() => []);
      if (orders[0]) for (let n = 0; n < 4; n++) await fetch('/api/orders/' + orders[0].id).catch(() => {});
      toast('Sent shopper traffic: 12 page views, 2 orders, 4 tracking checks');
      services();
    });
  }

  document.addEventListener('click', async (e) => {
    const go = e.target.closest('[data-go]');
    if (go && !e.target.closest('a')) { location.hash = go.dataset.go; return; }
    const fg = e.target.closest('[data-forget]');
    if (fg) { await api('/api/knowledge/' + fg.dataset.forget, { method: 'DELETE' }); toast('Removed ' + fg.dataset.forget); return knowledgePage(); }
    const f = e.target.closest('[data-fault]');
    if (f) {
      await api('/api/faults/' + f.dataset.fault, { method: 'POST' });
      toast('Injected: ' + f.querySelector('strong').textContent + '. Now send shopper traffic.');
      return services();
    }
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
      else if (path === 'agent') await agentPage();
      else if (path === 'knowledge') await knowledgePage();
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
