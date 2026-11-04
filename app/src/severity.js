'use strict';
// IncidentFlow severity engine.
// Suggests a priority (P1 = critical ... P4 = low) from the words in a report
// and from how close the affected service is to revenue.

const SERVICES = {
  storefront: { name: 'Storefront', team: 'Web Platform', revenueCritical: false },
  catalog: { name: 'Catalog & Search', team: 'Catalog', revenueCritical: false },
  cart: { name: 'Cart', team: 'Checkout', revenueCritical: true },
  checkout: { name: 'Checkout', team: 'Checkout', revenueCritical: true },
  payments: { name: 'Payment Gateway', team: 'Payments', revenueCritical: true },
  inventory: { name: 'Inventory', team: 'Supply Chain', revenueCritical: false },
  shipping: { name: 'Shipping & Tracking', team: 'Logistics', revenueCritical: false },
  notifications: { name: 'Email & SMS', team: 'Web Platform', revenueCritical: false }
};

const RULES = [
  { level: 1, words: ['outage', 'down', 'not loading', 'cannot place order', "can't place order", 'payment failed', 'payment failure',
    'gateway timeout', 'checkout failing', 'checkout failed', 'all orders', 'data loss', 'breach', 'double charged', 'charged twice', '500', '502', '503'] },
  { level: 2, words: ['slow', 'latency', 'timeout', 'timing out', 'intermittent', 'partial', 'refund', 'stock mismatch',
    'out of stock', 'oversold', 'inventory', 'error', 'failed', 'otp not received', 'not delivered'] },
  { level: 3, words: ['coupon', 'promo', 'discount', 'search', 'filter', 'image', 'tracking', 'email', 'sms', 'wrong price'] },
  { level: 4, words: ['typo', 'cosmetic', 'alignment', 'colour', 'color', 'font', 'suggestion', 'minor'] }
];

// Time limits per severity (minutes) to acknowledge and to resolve.
const SLA = {
  P1: { ackMin: 5, resolveMin: 60, label: 'Critical' },
  P2: { ackMin: 15, resolveMin: 240, label: 'High' },
  P3: { ackMin: 60, resolveMin: 1440, label: 'Medium' },
  P4: { ackMin: 240, resolveMin: 4320, label: 'Low' }
};

function suggestSeverity(text, service) {
  const hay = ' ' + String(text || '').toLowerCase() + ' ';
  let level = 4;
  const matched = [];
  for (const rule of RULES) {
    for (const w of rule.words) {
      const re = new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)');
      if (re.test(hay)) {
        matched.push(w);
        if (rule.level < level) level = rule.level;
      }
    }
  }
  let reason = matched.length ? 'Matched: ' + [...new Set(matched)].slice(0, 4).join(', ') : 'No impact keywords found';
  const svc = SERVICES[service];
  // A problem on a revenue-critical service is raised by one level (P3 -> P2, P2 -> P1).
  if (svc && svc.revenueCritical && level > 1 && level < 4) {
    level -= 1;
    reason += '; raised one level because ' + svc.name + ' is revenue-critical';
  }
  return { severity: 'P' + level, reason };
}

module.exports = { SERVICES, SLA, suggestSeverity };
