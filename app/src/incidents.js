'use strict';
// Incident lifecycle, de-duplication, statistics and the automatic service monitor.
const { SERVICES, SLA, suggestSeverity } = require('./severity');

const STATUSES = ['open', 'acknowledged', 'investigating', 'monitoring', 'resolved'];
const SEVERITIES = ['P1', 'P2', 'P3', 'P4'];
const SOURCES = ['manual', 'customer', 'monitor', 'checkout', 'pipeline'];

class IncidentService {
  constructor(store, clock = () => Date.now()) {
    this.store = store;
    this.now = clock;
  }

  get list() {
    return this.store.state.incidents;
  }

  get(id) {
    return this.list.find((i) => i.id === id) || null;
  }

  findOpenByFingerprint(fp) {
    return this.list.find((i) => i.fingerprint === fp && i.status !== 'resolved') || null;
  }

  create(input) {
    const at = new Date(this.now()).toISOString();
    const service = SERVICES[input.service] ? input.service : 'storefront';
    const fingerprint = input.fingerprint || null;

    if (fingerprint) {
      const existing = this.findOpenByFingerprint(fingerprint);
      if (existing) {
        existing.occurrences += 1;
        existing.lastSeenAt = at;
        if (input.impact) {
          existing.impact.failedOrders += input.impact.failedOrders || 0;
          existing.impact.revenueAtRisk += input.impact.revenueAtRisk || 0;
        }
        if (existing.occurrences % 5 === 0 || existing.occurrences <= 3) {
          existing.timeline.push({ at, type: 'repeat', by: 'IncidentFlow', text: 'Seen again (' + existing.occurrences + ' occurrences)' });
        }
        this.store.save();
        return { incident: existing, deduped: true };
      }
    }

    const suggestion = suggestSeverity(input.title + ' ' + (input.description || ''), service);
    const severity = SEVERITIES.includes(input.severity) ? input.severity : suggestion.severity;
    const source = SOURCES.includes(input.source) ? input.source : 'manual';
    const incident = {
      id: 'INC-' + this.store.nextId('incident'),
      title: String(input.title).trim(),
      description: String(input.description || '').trim(),
      service,
      team: SERVICES[service].team,
      severity,
      suggestedSeverity: suggestion.severity,
      severityReason: suggestion.reason,
      status: 'open',
      source,
      reporter: String(input.reporter || 'Anonymous').trim(),
      assignee: input.assignee ? String(input.assignee).trim() : null,
      fingerprint,
      occurrences: 1,
      impact: {
        failedOrders: (input.impact && input.impact.failedOrders) || 0,
        revenueAtRisk: (input.impact && input.impact.revenueAtRisk) || 0
      },
      rootCause: '',
      resolution: '',
      createdAt: at,
      lastSeenAt: at,
      acknowledgedAt: null,
      resolvedAt: null,
      timeline: [{ at, type: 'created', by: input.reporter || 'IncidentFlow',
        text: 'Incident opened from ' + source + ' as ' + severity + ' (' + suggestion.reason + ')' }]
    };
    this.list.unshift(incident);
    this.store.save();
    return { incident, deduped: false };
  }

  update(id, patch, by = 'ops') {
    const inc = this.get(id);
    if (!inc) return null;
    const at = new Date(this.now()).toISOString();
    const log = (type, text) => inc.timeline.push({ at, type, by, text });

    if (patch.severity && SEVERITIES.includes(patch.severity) && patch.severity !== inc.severity) {
      log('severity', 'Severity changed ' + inc.severity + ' → ' + patch.severity);
      inc.severity = patch.severity;
    }
    if (patch.assignee !== undefined && patch.assignee !== inc.assignee) {
      inc.assignee = patch.assignee ? String(patch.assignee).trim() : null;
      log('assign', inc.assignee ? 'Assigned to ' + inc.assignee : 'Unassigned');
    }
    if (typeof patch.rootCause === 'string') inc.rootCause = patch.rootCause.trim();
    if (typeof patch.resolution === 'string') inc.resolution = patch.resolution.trim();
    if (patch.status && STATUSES.includes(patch.status) && patch.status !== inc.status) {
      const from = inc.status;
      inc.status = patch.status;
      if (patch.status !== 'open' && !inc.acknowledgedAt) inc.acknowledgedAt = at;
      if (patch.status === 'resolved') inc.resolvedAt = at;
      if (from === 'resolved') inc.resolvedAt = null; // reopened
      log('status', 'Status ' + from + ' → ' + patch.status);
    }
    if (patch.note && String(patch.note).trim()) log('note', String(patch.note).trim().slice(0, 1000));
    this.store.save();
    return inc;
  }

  slaState(inc, nowMs = this.now()) {
    const sla = SLA[inc.severity];
    const created = Date.parse(inc.createdAt);
    const ackDue = created + sla.ackMin * 60000;
    const resolveDue = created + sla.resolveMin * 60000;
    const ackBreached = inc.acknowledgedAt ? Date.parse(inc.acknowledgedAt) > ackDue : nowMs > ackDue;
    const resolveBreached = inc.resolvedAt ? Date.parse(inc.resolvedAt) > resolveDue : nowMs > resolveDue;
    return { ackDue: new Date(ackDue).toISOString(), resolveDue: new Date(resolveDue).toISOString(), ackBreached, resolveBreached };
  }

  stats() {
    const all = this.list;
    const open = all.filter((i) => i.status !== 'resolved');
    const resolved = all.filter((i) => i.resolvedAt);
    const acked = all.filter((i) => i.acknowledgedAt);
    const avgMin = (arr, from, to) => arr.length
      ? Math.round(arr.reduce((s, i) => s + (Date.parse(i[to]) - Date.parse(i[from])), 0) / arr.length / 60000 * 10) / 10
      : 0;
    const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, open.filter((i) => i.severity === s).length]));
    const byService = {};
    for (const i of open) byService[i.service] = (byService[i.service] || 0) + 1;
    return {
      total: all.length,
      open: open.length,
      openCritical: open.filter((i) => i.severity === 'P1').length,
      resolved: resolved.length,
      mttaMinutes: avgMin(acked, 'createdAt', 'acknowledgedAt'),
      mttrMinutes: avgMin(resolved, 'createdAt', 'resolvedAt'),
      slaBreaches: open.filter((i) => { const s = this.slaState(i); return s.ackBreached || s.resolveBreached; }).length,
      failedOrders: open.reduce((s, i) => s + i.impact.failedOrders, 0),
      revenueAtRisk: open.reduce((s, i) => s + i.impact.revenueAtRisk, 0),
      bySeverity,
      byService,
      autoDetected: all.filter((i) => i.source === 'monitor' || i.source === 'checkout').length
    };
  }
}

// Watches every API call per service. When the recent error rate or latency
// crosses a threshold it opens (or de-duplicates into) an incident by itself.
class ServiceMonitor {
  constructor(incidents, opts = {}) {
    this.incidents = incidents;
    this.window = opts.window || 20;
    this.minSamples = opts.minSamples || 6;
    this.errorRate = opts.errorRate || 0.3;
    this.latencyMs = opts.latencyMs || 1200;
    this.samples = {};
    this.totals = {};
  }

  record(service, ms, ok) {
    const buf = (this.samples[service] = this.samples[service] || []);
    buf.push({ ms, ok });
    if (buf.length > this.window) buf.shift();
    const t = (this.totals[service] = this.totals[service] || { requests: 0, errors: 0 });
    t.requests += 1;
    if (!ok) t.errors += 1;
    this.evaluate(service);
  }

  summary(service) {
    const buf = this.samples[service] || [];
    if (!buf.length) return { samples: 0, errorRate: 0, p95: 0 };
    const sorted = buf.map((s) => s.ms).sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    return { samples: buf.length, errorRate: buf.filter((s) => !s.ok).length / buf.length, p95: Math.round(p95) };
  }

  evaluate(service) {
    const s = this.summary(service);
    if (s.samples < this.minSamples) return;
    const name = SERVICES[service] ? SERVICES[service].name : service;
    if (s.errorRate >= this.errorRate) {
      this.incidents.create({
        title: name + ' error rate at ' + Math.round(s.errorRate * 100) + '%',
        description: 'Automatic alert: ' + Math.round(s.errorRate * 100) + '% of the last ' + s.samples + ' requests to ' + name + ' failed.',
        service, source: 'monitor', reporter: 'IncidentFlow Monitor', fingerprint: service + ':error-rate'
      });
    } else if (s.p95 >= this.latencyMs) {
      this.incidents.create({
        title: name + ' responses slow (p95 ' + s.p95 + ' ms)',
        description: 'Automatic alert: p95 latency of ' + name + ' is ' + s.p95 + ' ms over the last ' + s.samples + ' requests (threshold ' + this.latencyMs + ' ms).',
        service, source: 'monitor', reporter: 'IncidentFlow Monitor', fingerprint: service + ':latency'
      });
    }
  }
}

module.exports = { IncidentService, ServiceMonitor, STATUSES, SEVERITIES };
