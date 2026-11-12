'use strict';
// Catalogue of realistic e-commerce failures that can be injected for demos and tests.
// Each scenario says how it breaks the store (`chaos`), what a diagnostic check on the
// service reports, which actions the agent should try, and whether those actions can
// actually fix it (`fixable: false` models outages outside our control).

const SCENARIOS = [
  {
    id: 'pay-gateway-down', fixedBy: 'failover', service: 'payments', title: 'Payment gateway outage',
    effect: 'UPI and card payments fail at checkout',
    diagnostic: 'primary gateway returns 503 for every authorisation; backup gateway healthy',
    chaos: { payments: 'down' }, playbook: ['failover', 'reset-pool'], fixable: true
  },
  {
    id: 'pay-pool-exhausted', fixedBy: 'reset-pool', service: 'payments', title: 'Payment connection pool exhausted',
    effect: 'payments time out after a traffic burst',
    diagnostic: 'connection pool 100/100 in use, 0 idle, requests queued',
    chaos: { payments: 'down' }, playbook: ['reset-pool', 'failover'], fixable: true
  },
  {
    id: 'search-index-corrupt', fixedBy: 'reindex', service: 'catalog', title: 'Search index corrupted',
    effect: 'catalogue and search return no products',
    diagnostic: 'search index holds 0 documents; product database holds 18',
    chaos: {}, playbook: ['reindex', 'restart'], fixable: true
  },
  {
    id: 'traffic-spike', fixedBy: 'scale-out', service: 'catalog', title: 'Flash-sale traffic spike',
    effect: 'product listings slow down',
    diagnostic: 'CPU 97% on 1 catalogue worker, request queue growing',
    chaos: { catalog: 'degraded' }, playbook: ['scale-out', 'restart'], fixable: true
  },
  {
    id: 'inventory-sync-stuck', fixedBy: 'restart', service: 'inventory', title: 'Inventory sync worker stuck',
    effect: 'stock checks and checkout become slow',
    diagnostic: 'stock sync job holding a table lock for 14 min',
    chaos: { inventory: 'degraded' }, playbook: ['restart', 'restart'], fixable: true
  },
  {
    id: 'session-cache-full', fixedBy: 'flush-cache', service: 'checkout', title: 'Checkout session cache full',
    effect: 'orders fail before payment',
    diagnostic: 'session cache at 100% memory, evictions failing',
    chaos: { checkout: 'down' }, playbook: ['flush-cache', 'restart'], fixable: true
  },
  {
    id: 'email-queue-stuck', fixedBy: 'restart-queue', service: 'notifications', title: 'Order email queue stuck',
    effect: 'orders go through but confirmation emails and SMS are not sent',
    diagnostic: 'email queue consumer disconnected, backlog growing',
    chaos: { notifications: 'down' }, playbook: ['restart-queue', 'restart'], fixable: true
  },
  {
    id: 'courier-rate-limited', fixedBy: 'courier-failover', service: 'shipping', title: 'Courier tracking API rate-limited',
    effect: 'order tracking pages fail',
    diagnostic: 'courier API answering 429 Too Many Requests',
    chaos: { shipping: 'down' }, playbook: ['courier-failover', 'restart'], fixable: true
  },
  {
    id: 'all-payment-providers-down', fixedBy: null, service: 'payments', title: 'All payment providers down',
    effect: 'both the primary and the backup gateway are unavailable',
    diagnostic: 'primary and backup gateways both return 503',
    chaos: { payments: 'down', payments_backup: 'down' }, playbook: ['failover', 'reset-pool'], fixable: false
  },
  {
    id: 'courier-partner-outage', fixedBy: null, service: 'shipping', title: 'All courier partners down',
    effect: 'tracking fails on the primary and the backup courier API',
    diagnostic: 'primary and backup courier APIs unreachable',
    chaos: { shipping: 'down' }, playbook: ['courier-failover', 'restart'], fixable: false
  }
];

const ACTION_LABELS = {
  failover: 'Fail over payments to the backup gateway',
  'reset-pool': 'Reset the payment connection pool',
  reindex: 'Rebuild the search index from the product database',
  'scale-out': 'Scale the catalogue service out from 1 to 3 workers',
  restart: 'Restart the service worker',
  'restart-payments': 'Restart the payment worker',
  'flush-cache': 'Flush and resize the session cache',
  'restart-queue': 'Restart the email queue consumer and resend pending emails',
  'courier-failover': 'Switch tracking to the backup courier API'
};

const byId = (id) => SCENARIOS.find((s) => s.id === id) || null;

module.exports = { SCENARIOS, ACTION_LABELS, byId };
