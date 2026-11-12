'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../app');
const { suggestSeverity } = require('../src/severity');

async function start(opts = {}) {
  const app = createApp({ dataFile: null, version: 'test', degradedMs: 5, opsUser: 'admin', opsPassword: 'secret', agent: { intervalMs: 0, verifyMs: 0 }, quiet: true, ...opts });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
  };
  return { app, server, call, login: () => call('POST', '/api/auth/login', { username: 'admin', password: 'secret' }) };
}

const order = (payment = 'upi') => ({
  items: [{ id: 'p101', qty: 1 }, { id: 'p501', qty: 2 }],
  customer: { name: 'Test Shopper', email: 'shopper@example.com', phone: '9876543210', address: '12 MG Road', city: 'Chennai', pincode: '603203' },
  payment
});

test('health endpoint reports version', async (t) => {
  const { server, call } = await start();
  t.after(() => server.close());
  const r = await call('GET', '/health');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.status, 'ok');
  assert.strictEqual(r.body.version, 'test');
});

test('severity engine ranks payment outages as P1 and cosmetic issues as P4', () => {
  assert.strictEqual(suggestSeverity('UPI payment failed for all orders', 'payments').severity, 'P1');
  assert.strictEqual(suggestSeverity('Product page slow to load', 'catalog').severity, 'P2');
  assert.strictEqual(suggestSeverity('Coupon code not applying', 'checkout').severity, 'P2');
  assert.strictEqual(suggestSeverity('Font alignment typo on footer', 'storefront').severity, 'P4');
});

test('storefront lists products and places an order', async (t) => {
  const { server, call } = await start();
  t.after(() => server.close());
  const products = await call('GET', '/api/products?category=electronics');
  assert.ok(products.body.length >= 3);
  const r = await call('POST', '/api/orders', order());
  assert.strictEqual(r.status, 201);
  assert.match(r.body.id, /^CRT\d+$/);
  assert.strictEqual(r.body.total, 2499 + 2 * 699);
  const track = await call('GET', '/api/orders/' + r.body.id);
  assert.strictEqual(track.body.status, 'confirmed');
});

test('invalid checkout input is rejected', async (t) => {
  const { server, call } = await start();
  t.after(() => server.close());
  const bad = order();
  bad.customer.phone = '123';
  const r = await call('POST', '/api/orders', bad);
  assert.strictEqual(r.status, 400);
});

test('ops API requires login', async (t) => {
  const { server, call, login } = await start();
  t.after(() => server.close());
  assert.strictEqual((await call('GET', '/api/incidents')).status, 401);
  assert.strictEqual((await call('POST', '/api/auth/login', { username: 'admin', password: 'wrong' })).status, 401);
  assert.strictEqual((await login()).status, 200);
  assert.strictEqual((await call('GET', '/api/incidents')).status, 200);
});

test('payment gateway outage auto-creates one de-duplicated P1 incident with revenue impact', async (t) => {
  const { server, call, login } = await start();
  t.after(() => server.close());
  await login();
  await call('PUT', '/api/chaos/payments', { mode: 'down' });
  const first = await call('POST', '/api/orders', order('upi'));
  const second = await call('POST', '/api/orders', order('upi'));
  assert.strictEqual(first.status, 502);
  assert.strictEqual(first.body.incidentRef, second.body.incidentRef);
  const inc = (await call('GET', '/api/incidents/' + first.body.incidentRef)).body;
  assert.strictEqual(inc.severity, 'P1');
  assert.strictEqual(inc.source, 'checkout');
  assert.strictEqual(inc.occurrences, 2);
  assert.strictEqual(inc.impact.failedOrders, 2);
  assert.strictEqual(inc.impact.revenueAtRisk, 2 * (2499 + 2 * 699));
  // Cash on delivery skips the gateway and still works.
  assert.strictEqual((await call('POST', '/api/orders', order('cod'))).status, 201);
});

test('incident lifecycle records timeline and MTTR', async (t) => {
  const { server, call, login } = await start();
  t.after(() => server.close());
  await login();
  const created = await call('POST', '/api/incidents', { title: 'Search results empty for shoes', service: 'catalog' });
  assert.strictEqual(created.status, 201);
  const id = created.body.id;
  await call('PATCH', '/api/incidents/' + id, { status: 'acknowledged', assignee: 'Catalog on-call' });
  const noSummary = await call('PATCH', '/api/incidents/' + id, { status: 'resolved' });
  assert.strictEqual(noSummary.status, 400);
  const done = await call('PATCH', '/api/incidents/' + id, { status: 'resolved', rootCause: 'Stale index', resolution: 'Reindexed catalog' });
  assert.strictEqual(done.body.status, 'resolved');
  assert.ok(done.body.timeline.length >= 4);
  const stats = (await call('GET', '/api/stats')).body;
  assert.strictEqual(stats.resolved, 1);
  assert.ok(stats.mttrMinutes >= 0);
});

test('latency monitor opens an incident when a service is degraded', async (t) => {
  const { server, call, login } = await start({ monitor: { latencyMs: 20, minSamples: 3 }, degradedMs: 40 });
  t.after(() => server.close());
  await login();
  await call('PUT', '/api/chaos/catalog', { mode: 'degraded' });
  for (let i = 0; i < 4; i++) await call('GET', '/api/products');
  const list = (await call('GET', '/api/incidents?service=catalog')).body;
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].source, 'monitor');
  const status = (await call('GET', '/api/status')).body;
  assert.notStrictEqual(status.overall, 'operational');
});

test('agent fixes a known payment gateway outage by failing over, then resolves the incident itself', async (t) => {
  const { app, server, call, login } = await start();
  t.after(() => server.close());
  await login();
  await call('POST', '/api/faults/pay-gateway-down');
  const failed = await call('POST', '/api/orders', order('upi'));
  assert.strictEqual(failed.status, 502);
  const agent = app.locals.agent;
  agent.tick();
  let inc = (await call('GET', '/api/incidents/' + failed.body.incidentRef)).body;
  assert.strictEqual(inc.agent.attempts[0].action, 'failover');
  agent.tick();
  inc = (await call('GET', '/api/incidents/' + failed.body.incidentRef)).body;
  assert.strictEqual(inc.status, 'resolved');
  assert.strictEqual(inc.agent.status, 'fixed');
  assert.strictEqual((await call('POST', '/api/orders', order('upi'))).status, 201);
});

test('a new failure the agent does not know is escalated immediately, without guessing', async (t) => {
  const { app, server, call, login } = await start();
  t.after(() => server.close());
  await login();
  await call('PUT', '/api/chaos/checkout', { mode: 'down' });        // manual break: cause unknown to the agent
  const failed = await call('POST', '/api/orders', order('cod'));
  app.locals.agent.tick();
  const inc = (await call('GET', '/api/incidents/' + failed.body.incidentRef)).body;
  assert.strictEqual(inc.agent.status, 'escalated');
  assert.strictEqual(inc.agent.attempts.length, 0);
  assert.strictEqual(inc.escalation.engineer, 'Luv Arora');
  assert.match(inc.escalation.reason, /new failure/);
  assert.strictEqual((await call('GET', '/api/chaos')).body.checkout, 'down');  // agent did not touch it
});

test('engineer teaches the agent; the next time the same failure happens the agent fixes it on its own', async (t) => {
  const { app, server, call, login } = await start();
  t.after(() => server.close());
  await login();
  const agent = app.locals.agent;
  // 1st occurrence: unknown -> escalated
  await call('PUT', '/api/chaos/checkout', { mode: 'down' });
  const first = (await call('POST', '/api/orders', order('cod'))).body.incidentRef;
  agent.tick();
  assert.strictEqual((await call('GET', '/api/incidents/' + first)).body.agent.status, 'escalated');
  // engineer fixes it, teaches the agent and resolves
  await call('PUT', '/api/chaos/checkout', { mode: 'healthy' });
  const kb = await call('POST', '/api/knowledge', { title: 'Checkout workers hung', service: 'checkout', symptom: 'down', action: 'restart', notes: 'Restarting the checkout worker fixed it', incidentId: first });
  assert.strictEqual(kb.status, 201);
  assert.match(kb.body.id, /^KB-\d+$/);
  assert.strictEqual((await call('POST', '/api/knowledge', { service: 'checkout', symptom: 'down', action: 'failover' })).status, 400); // wrong fix for this service
  await call('PATCH', '/api/incidents/' + first, { status: 'resolved', resolution: 'Restarted checkout worker' });
  // 2nd occurrence: the agent now knows what to do
  await call('PUT', '/api/chaos/checkout', { mode: 'down' });
  const second = (await call('POST', '/api/orders', order('cod'))).body.incidentRef;
  assert.notStrictEqual(second, first);
  agent.tick(); agent.tick();
  const inc = (await call('GET', '/api/incidents/' + second)).body;
  assert.strictEqual(inc.agent.status, 'fixed');
  assert.strictEqual(inc.agent.diagnosis.knowledge, kb.body.id);
  assert.match(inc.resolution, /knowledge KB-/);
  assert.strictEqual((await call('POST', '/api/orders', order('cod'))).status, 201);
  const k = (await call('GET', '/api/knowledge')).body;
  assert.strictEqual(k.learned[0].timesUsed, 1);
});

test('customer reports always go to an engineer', async (t) => {
  const { app, server, call, login } = await start();
  t.after(() => server.close());
  await login();
  const r = await call('POST', '/api/support/report', { title: 'Coupon FESTIVE10 not applying', service: 'checkout' });
  app.locals.agent.tick();
  const inc = (await call('GET', '/api/incidents/' + r.body.ticket)).body;
  assert.strictEqual(inc.agent.status, 'escalated');
});

const { SCENARIOS } = require('../src/faults');
for (const sc of SCENARIOS) {
  test('scenario "' + sc.title + '" is detected and ' + (sc.fixable ? 'fixed by the agent' : 'escalated to an engineer'), async (t) => {
    const { app, server, call, login } = await start({ monitor: { latencyMs: 20, minSamples: 3 }, degradedMs: 40 });
    t.after(() => server.close());
    await login();
    const placed = (await call('POST', '/api/orders', order('cod'))).body.id;
    assert.strictEqual((await call('POST', '/api/faults/' + sc.id)).status, 200);
    // shopper traffic
    for (let i = 0; i < 4; i++) await call('GET', '/api/products');
    for (let i = 0; i < 4; i++) await call('GET', '/api/products/p10' + (1 + i));
    await call('POST', '/api/orders', order('cod'));
    await call('POST', '/api/orders', order('upi'));
    for (let i = 0; i < 4; i++) await call('GET', '/api/orders/' + placed);
    const opened = (await call('GET', '/api/incidents?status=active')).body;
    assert.ok(opened.length >= 1, 'an incident should open for ' + sc.id);
    for (let i = 0; i < 10; i++) app.locals.agent.tick();
    const all = (await call('GET', '/api/incidents')).body.filter((x) => x.agent);
    assert.ok(all.length >= 1);
    if (sc.fixable) {
      for (const x of all) assert.strictEqual(x.agent.status, 'fixed', sc.id + ': ' + x.title + ' -> ' + x.agent.status);
      // the store works again
      assert.strictEqual((await call('POST', '/api/orders', order('upi'))).status, 201);
      const prods = (await call('GET', '/api/products')).body;
      assert.ok(prods.length > 0);
    } else {
      assert.ok(all.some((x) => x.agent.status === 'escalated' && x.escalation && /^DEV-/.test(x.escalation.ticket)), sc.id + ' should escalate');
    }
  });
}

test('metrics endpoint exposes service health and incident numbers for Prometheus', async (t) => {
  const { server, call, login } = await start();
  t.after(() => server.close());
  await login();
  let m = (await call('GET', '/metrics')).body;
  assert.match(m, /incidentflow_service_up\{service="payments",name="Payment Gateway"\} 1/);
  assert.match(m, /# TYPE incidentflow_orders_total counter/);
  await call('POST', '/api/faults/search-index-corrupt');
  m = (await call('GET', '/metrics')).body;
  assert.match(m, /incidentflow_service_up\{service="catalog",name="Catalog & Search"\} 0/);
});
