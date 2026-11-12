'use strict';
// IncidentFlow: Cloud-Native Incident Management System for e-commerce.
// Serves the Cartora storefront, its REST API and the IncidentFlow ops console.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Store } = require('./src/store');
const catalog = require('./src/catalog');
const { SERVICES, SLA, suggestSeverity } = require('./src/severity');
const { IncidentService, ServiceMonitor } = require('./src/incidents');
const { RemediationAgent, ONCALL } = require('./src/agent');

const CHAOS_MODES = ['healthy', 'degraded', 'down'];

function createApp(opts = {}) {
  const version = opts.version || process.env.APP_VERSION || 'dev';
  const store = new Store(opts.dataFile !== undefined ? opts.dataFile : process.env.DATA_FILE);
  const incidents = new IncidentService(store);
  const monitor = new ServiceMonitor(incidents, opts.monitor);
  const degradedMs = Number(opts.degradedMs || process.env.CHAOS_LATENCY_MS || 1600);
  const opsUser = opts.opsUser || process.env.OPS_USER || 'admin';
  const opsPassword = opts.opsPassword || process.env.OPS_PASSWORD || 'incidentflow';
  const secret = opts.sessionSecret || process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  const startedAt = Date.now();
  const httpTotals = { requests: 0, errors5xx: 0 };

  for (const key of [...Object.keys(SERVICES), 'payments_backup']) {
    if (!CHAOS_MODES.includes(store.state.chaos[key])) store.state.chaos[key] = 'healthy';
  }
  const agent = new RemediationAgent({ store, incidents, monitor, opts: opts.agent || (process.env.AGENT_VERIFY_MS ? { verifyMs: Number(process.env.AGENT_VERIFY_MS) } : {}) });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin'
    });
    httpTotals.requests += 1;
    res.on('finish', () => { if (res.statusCode >= 500) httpTotals.errors5xx += 1; });
    next();
  });

  // ---------- helpers ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  class ServiceError extends Error {
    constructor(service, message) { super(message); this.service = service; }
  }

  // Simulates a call to an internal service, honouring the chaos switches,
  // and reports the outcome to the monitor.
  async function callService(service, fn) {
    let mode = store.state.chaos[service] || 'healthy';
    let label = SERVICES[service].name;
    if (service === 'payments' && store.state.paymentRoute === 'backup') {
      mode = store.state.chaos.payments_backup || 'healthy';
      label = 'Backup payment gateway';
    }
    const t0 = Date.now();
    try {
      if (mode === 'degraded') await sleep(degradedMs + Math.floor(Math.random() * 300));
      if (mode === 'down') {
        await sleep(40);
        throw new ServiceError(service, label + ' is not responding (upstream timeout)');
      }
      const out = await fn();
      monitor.record(service, Date.now() - t0, true);
      return out;
    } catch (err) {
      monitor.record(service, Date.now() - t0, false);
      throw err;
    }
  }

  // ---------- ops session (signed cookie) ----------
  const sign = (v) => crypto.createHmac('sha256', secret).update(v).digest('base64url');
  function makeToken(user) {
    const body = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + 12 * 3600 * 1000 })).toString('base64url');
    return body + '.' + sign(body);
  }
  function readToken(req) {
    const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith('if_session='));
    if (!raw) return null;
    const [body, sig] = raw.slice('if_session='.length).split('.');
    if (!body || !sig) return null;
    const expected = sign(body);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
      const data = JSON.parse(Buffer.from(body, 'base64url').toString());
      return data.exp > Date.now() ? data.u : null;
    } catch { return null; }
  }
  function requireOps(req, res, next) {
    const user = readToken(req);
    if (!user) return bad(res, 'Login required', 401);
    req.opsUser = user;
    next();
  }
  const safeEqual = (a, b) => {
    const x = crypto.createHash('sha256').update(String(a)).digest();
    const y = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(x, y);
  };

  // ---------- platform endpoints ----------
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'incidentflow', version, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
  });

  app.get('/metrics', (req, res) => {
    const s = incidents.stats();
    const lines = [
      '# HELP incidentflow_http_requests_total HTTP requests served',
      '# TYPE incidentflow_http_requests_total counter',
      'incidentflow_http_requests_total ' + httpTotals.requests,
      'incidentflow_http_5xx_total ' + httpTotals.errors5xx,
      '# HELP incidentflow_incidents_open Open incidents by severity',
      '# TYPE incidentflow_incidents_open gauge'
    ];
    for (const [sev, n] of Object.entries(s.bySeverity)) lines.push('incidentflow_incidents_open{severity="' + sev + '"} ' + n);
    lines.push('incidentflow_mttr_minutes ' + s.mttrMinutes, 'incidentflow_revenue_at_risk_inr ' + s.revenueAtRisk);
    for (const key of Object.keys(SERVICES)) {
      const m = monitor.summary(key);
      lines.push('incidentflow_service_p95_ms{service="' + key + '"} ' + m.p95);
      lines.push('incidentflow_service_error_rate{service="' + key + '"} ' + m.errorRate.toFixed(3));
    }
    res.type('text/plain').send(lines.join('\n') + '\n');
  });

  // ---------- storefront API ----------
  app.get('/api/categories', (req, res) => res.json(catalog.categories));

  app.get('/api/products', async (req, res) => {
    try {
      const list = await callService('catalog', async () => catalog.listProducts({ category: str(req.query.category, 40), q: str(req.query.q, 80) }));
      res.json(list);
    } catch (err) { bad(res, err.message, 503); }
  });

  app.get('/api/products/:id', async (req, res) => {
    const p = catalog.findProduct(req.params.id);
    if (!p) return bad(res, 'Product not found', 404);
    try {
      const stock = await callService('inventory', async () => p.stock);
      res.json({ ...p, stock });
    } catch (err) { res.json({ ...p, stock: null, stockError: 'Live stock unavailable' }); }
  });

  app.post('/api/orders', async (req, res) => {
    const b = req.body || {};
    const items = Array.isArray(b.items) ? b.items.slice(0, 20) : [];
    const c = b.customer || {};
    const customer = {
      name: str(c.name, 80), email: str(c.email, 120), phone: str(c.phone, 15),
      address: str(c.address, 200), city: str(c.city, 60), pincode: str(c.pincode, 6)
    };
    const payment = ['upi', 'card', 'cod'].includes(b.payment) ? b.payment : null;
    if (!items.length) return bad(res, 'Your cart is empty');
    if (!customer.name || !/^\S+@\S+\.\S+$/.test(customer.email)) return bad(res, 'Please enter your name and a valid email');
    if (!/^\d{10}$/.test(customer.phone)) return bad(res, 'Please enter a 10 digit mobile number');
    if (!customer.address || !customer.city || !/^\d{6}$/.test(customer.pincode)) return bad(res, 'Please enter a complete delivery address with a 6 digit PIN code');
    if (!payment) return bad(res, 'Choose a payment method');

    const lines = [];
    for (const it of items) {
      const p = catalog.findProduct(it && it.id);
      const qty = Math.max(1, Math.min(10, parseInt(it && it.qty, 10) || 1));
      if (!p) return bad(res, 'Unknown product in cart');
      lines.push({ id: p.id, name: p.name, price: p.price, qty });
    }
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const shippingFee = subtotal >= 999 ? 0 : 49;
    const total = subtotal + shippingFee;

    const checkoutFailure = (service, err) => {
      const label = { upi: 'UPI', card: 'Card', cod: 'COD' }[payment];
      const title = service === 'payments'
        ? 'Payment failure: ' + label + ' gateway timeout at checkout'
        : SERVICES[service].name + ' failure during checkout';
      const { incident } = incidents.create({
        title,
        description: 'Customer orders are failing at checkout. Last error: ' + err.message,
        service, source: 'checkout', reporter: 'Checkout service',
        fingerprint: 'checkout:' + service + (service === 'payments' ? ':' + payment : ''),
        impact: { failedOrders: 1, revenueAtRisk: total }
      });
      return res.status(502).json({
        error: service === 'payments'
          ? 'We could not confirm your payment. No money has been deducted. Please try again or choose another payment method.'
          : 'We could not place your order right now. Please try again in a few minutes.',
        incidentRef: incident.id
      });
    };

    try {
      await callService('checkout', async () => null);
    } catch (err) { return checkoutFailure('checkout', err); }
    try {
      await callService('inventory', async () => null);
    } catch (err) { return checkoutFailure('inventory', err); }
    if (payment !== 'cod') {
      try {
        await callService('payments', async () => null);
      } catch (err) { return checkoutFailure('payments', err); }
    }

    const order = {
      id: 'CRT' + store.nextId('order'),
      items: lines, subtotal, shippingFee, total, payment,
      customer,
      status: 'confirmed',
      createdAt: new Date().toISOString(),
      eta: new Date(Date.now() + 4 * 86400000).toISOString()
    };
    store.state.orders.unshift(order);
    if (store.state.orders.length > 500) store.state.orders.length = 500;
    store.save();

    let notification = 'sent';
    try {
      await callService('notifications', async () => null);
    } catch (err) {
      notification = 'failed';
      incidents.create({
        title: 'Order confirmation emails not being sent',
        description: 'Orders are placed but confirmation email/SMS failed. Last error: ' + err.message,
        service: 'notifications', source: 'checkout', reporter: 'Checkout service', fingerprint: 'notifications:order-confirmation'
      });
    }
    res.status(201).json({ ...order, notification });
  });

  app.get('/api/orders/:id', async (req, res) => {
    const o = store.state.orders.find((x) => x.id === req.params.id);
    if (!o) return bad(res, 'Order not found', 404);
    try {
      const tracking = await callService('shipping', async () => ({ courier: 'Cartora Express', stage: 'Packed at warehouse', eta: o.eta }));
      res.json({ id: o.id, status: o.status, total: o.total, items: o.items, createdAt: o.createdAt, tracking });
    } catch (err) {
      res.json({ id: o.id, status: o.status, total: o.total, items: o.items, createdAt: o.createdAt, tracking: null, trackingError: 'Tracking is temporarily unavailable' });
    }
  });

  // "Report a problem" widget for shoppers.
  app.post('/api/support/report', (req, res) => {
    const b = req.body || {};
    const title = str(b.title, 140);
    if (title.length < 5) return bad(res, 'Please describe the problem in a few words');
    const service = SERVICES[b.service] ? b.service : 'storefront';
    const { incident } = incidents.create({
      title, description: str(b.description, 2000), service, source: 'customer', reporter: str(b.reporter, 80) || 'Shopper'
    });
    res.status(201).json({ ticket: incident.id, message: 'Thanks! Our team is looking into it.' });
  });

  // Public status page data (no internal details).
  app.get('/api/status', (req, res) => {
    const open = incidents.list.filter((i) => i.status !== 'resolved');
    const services = Object.entries(SERVICES).map(([key, s]) => {
      const active = open.filter((i) => i.service === key);
      const worst = active.reduce((w, i) => (i.severity < w ? i.severity : w), 'P9');
      const state = worst === 'P1' ? 'outage' : worst === 'P2' ? 'degraded' : active.length ? 'minor' : 'operational';
      return { key, name: s.name, state };
    });
    res.json({
      overall: services.some((s) => s.state === 'outage') ? 'outage' : services.some((s) => s.state !== 'operational') ? 'degraded' : 'operational',
      services,
      incidents: open.filter((i) => i.severity === 'P1' || i.severity === 'P2').slice(0, 5)
        .map((i) => ({ id: i.id, title: i.title, status: i.status, severity: i.severity, since: i.createdAt })),
      updatedAt: new Date().toISOString()
    });
  });

  // ---------- IncidentFlow ops API ----------
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    if (!safeEqual(username || '', opsUser) || !safeEqual(password || '', opsPassword)) return bad(res, 'Invalid username or password', 401);
    res.set('Set-Cookie', 'if_session=' + makeToken(opsUser) + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200');
    res.json({ user: opsUser });
  });
  app.post('/api/auth/logout', (req, res) => {
    res.set('Set-Cookie', 'if_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    res.json({ ok: true });
  });
  app.get('/api/auth/me', requireOps, (req, res) => res.json({ user: req.opsUser }));

  app.get('/api/meta', (req, res) => res.json({ services: SERVICES, sla: SLA, version }));

  app.get('/api/severity/suggest', (req, res) => res.json(suggestSeverity(str(req.query.text, 500), str(req.query.service, 40))));

  app.get('/api/incidents', requireOps, (req, res) => {
    let list = incidents.list;
    const { status, severity, service, q } = req.query;
    if (status === 'active') list = list.filter((i) => i.status !== 'resolved');
    else if (status) list = list.filter((i) => i.status === status);
    if (severity) list = list.filter((i) => i.severity === severity);
    if (service) list = list.filter((i) => i.service === service);
    if (q) { const n = String(q).toLowerCase(); list = list.filter((i) => (i.id + ' ' + i.title).toLowerCase().includes(n)); }
    res.json(list.map((i) => ({ ...i, timeline: undefined, sla: incidents.slaState(i) })));
  });

  app.post('/api/incidents', requireOps, (req, res) => {
    const b = req.body || {};
    const title = str(b.title, 140);
    if (title.length < 5) return bad(res, 'Title must be at least 5 characters');
    if (b.service && !SERVICES[b.service]) return bad(res, 'Unknown service');
    const { incident } = incidents.create({
      title, description: str(b.description, 2000), service: b.service, severity: b.severity,
      source: b.source === 'pipeline' ? 'pipeline' : 'manual', reporter: str(b.reporter, 80) || req.opsUser, assignee: str(b.assignee, 80) || null
    });
    res.status(201).json(incident);
  });

  app.get('/api/incidents/:id', requireOps, (req, res) => {
    const inc = incidents.get(req.params.id);
    if (!inc) return bad(res, 'Incident not found', 404);
    res.json({ ...inc, sla: incidents.slaState(inc) });
  });

  app.patch('/api/incidents/:id', requireOps, (req, res) => {
    const b = req.body || {};
    if (b.status === 'resolved' && !str(b.resolution, 1000) && !(incidents.get(req.params.id) || {}).resolution) {
      return bad(res, 'Add a resolution summary before resolving');
    }
    const inc = incidents.update(req.params.id, {
      status: b.status, severity: b.severity, assignee: b.assignee,
      note: str(b.note, 1000), rootCause: typeof b.rootCause === 'string' ? str(b.rootCause, 1000) : undefined,
      resolution: typeof b.resolution === 'string' ? str(b.resolution, 1000) : undefined
    }, req.opsUser);
    if (!inc) return bad(res, 'Incident not found', 404);
    if (inc.status === 'resolved') agent.onResolved(inc);
    res.json({ ...inc, sla: incidents.slaState(inc) });
  });

  app.get('/api/stats', requireOps, (req, res) => {
    const health = Object.fromEntries(Object.keys(SERVICES).map((k) => [k, { mode: store.state.chaos[k], ...monitor.summary(k), ...(monitor.totals[k] || { requests: 0, errors: 0 }) }]));
    const today = new Date().toISOString().slice(0, 10);
    const ordersToday = store.state.orders.filter((o) => o.createdAt.startsWith(today));
    res.json({ ...incidents.stats(), agent: agent.summary(), services: health, orders: { today: ordersToday.length, revenueToday: ordersToday.reduce((s, o) => s + o.total, 0), total: store.state.orders.length } });
  });

  app.get('/api/orders', requireOps, (req, res) => res.json(store.state.orders.slice(0, 25)));

  // Fault injection ("chaos") switches used to demonstrate detection.
  app.get('/api/chaos', requireOps, (req, res) => res.json(store.state.chaos));
  app.put('/api/chaos/:service', requireOps, (req, res) => {
    const svc = req.params.service;
    const mode = (req.body || {}).mode;
    if (!SERVICES[svc] && svc !== 'payments_backup') return bad(res, 'Unknown service', 404);
    if (!CHAOS_MODES.includes(mode)) return bad(res, 'Mode must be healthy, degraded or down');
    const prev = store.state.chaos[svc];
    store.state.chaos[svc] = mode;
    if (mode === 'healthy' && prev !== 'healthy' && SERVICES[svc]) {
      for (const inc of incidents.list.filter((i) => i.service === svc && i.status !== 'resolved' && i.source !== 'customer')) {
        incidents.update(inc.id, { note: SERVICES[svc].name + ' reported healthy again; watch metrics before resolving' }, 'IncidentFlow Monitor');
      }
    }
    store.save();
    res.json(store.state.chaos);
  });

  // ---------- self-healing agent ----------
  app.get('/api/agent', requireOps, (req, res) => {
    res.json({ ...agent.summary(), maxAttempts: agent.maxAttempts, verifySeconds: Math.round(agent.verifyMs / 1000),
      oncall: ONCALL, log: store.state.agentLog.slice(0, 40), tickets: store.state.tickets.slice(0, 30) });
  });
  app.put('/api/agent', requireOps, (req, res) => {
    agent.enabled = !!(req.body || {}).enabled;
    store.save();
    res.json(agent.summary());
  });
  app.put('/api/agent/route', requireOps, (req, res) => {
    const route = (req.body || {}).route;
    if (!['primary', 'backup'].includes(route)) return bad(res, 'Route must be primary or backup');
    store.state.paymentRoute = route;
    agent.log(null, 'info', 'Payment route set to ' + route + ' by ' + req.opsUser);
    store.save();
    res.json(agent.summary());
  });

  // ---------- pages ----------
  const pub = path.join(__dirname, 'public');
  app.use(express.static(pub, { maxAge: '1h', index: false }));
  app.get('/ops', (req, res) => res.sendFile(path.join(pub, 'ops', 'index.html')));
  app.get('/status', (req, res) => res.sendFile(path.join(pub, 'status.html')));
  app.get('/', (req, res) => res.sendFile(path.join(pub, 'index.html')));
  app.use('/api', (req, res) => bad(res, 'Not found', 404));
  app.use((req, res) => res.status(404).sendFile(path.join(pub, 'index.html')));

  app.locals.store = store;
  app.locals.incidents = incidents;
  app.locals.agent = agent;
  return app;
}

module.exports = { createApp };
