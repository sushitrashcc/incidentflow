'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../app');
const { suggestSeverity } = require('../src/severity');

async function start(opts = {}) {
  const app = createApp({ dataFile: null, version: 'test', degradedMs: 5, opsUser: 'admin', opsPassword: 'secret', ...opts });
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
