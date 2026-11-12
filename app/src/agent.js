'use strict';
// IncidentFlow self-healing agent.
//
// For every automatically detected incident it runs a small loop:
//   OBSERVE -> DIAGNOSE -> ACT (from a fixed playbook) -> VERIFY -> RESOLVE or ESCALATE
// It only uses safe, reversible actions, tries at most `maxAttempts` times and
// then hands the incident to the owning team's on-call engineer with a ticket.
const { SERVICES } = require('./severity');

const ONCALL = {
  Payments: 'Vaibhav Shelke',
  Checkout: 'Luv Arora',
  'Web Platform': 'Luv Arora',
  Catalog: 'Shashwat Mishra',
  'Supply Chain': 'Shashwat Mishra',
  Logistics: 'Vaibhav Shelke'
};

const ACTIONS = {
  failover: 'Fail over payments to the backup gateway',
  restart: 'Restart the service worker',
  'restart-payments': 'Restart the payment worker and reset its connection pool'
};

class RemediationAgent {
  constructor({ store, incidents, monitor, opts = {} }) {
    this.store = store;
    this.incidents = incidents;
    this.monitor = monitor;
    this.verifyMs = opts.verifyMs !== undefined ? opts.verifyMs : 12000;
    this.maxAttempts = opts.maxAttempts || 2;
    const st = store.state;
    if (typeof st.agentEnabled !== 'boolean') st.agentEnabled = opts.enabled !== false;
    if (!st.paymentRoute) st.paymentRoute = 'primary';
    if (!Array.isArray(st.agentLog)) st.agentLog = [];
    if (!Array.isArray(st.tickets)) st.tickets = [];
    if (!st.seq.ticket) st.seq.ticket = 1000;
    this.timer = null;
    if (opts.intervalMs !== 0) {
      this.timer = setInterval(() => { try { this.tick(); } catch (err) { console.error('agent tick failed', err); } }, opts.intervalMs || 2000);
      this.timer.unref();
    }
  }

  get enabled() { return this.store.state.agentEnabled; }
  set enabled(v) { this.store.state.agentEnabled = !!v; this.log(null, 'info', 'Agent ' + (v ? 'enabled' : 'paused') + ' by ops'); }

  log(incidentId, kind, text) {
    const log = this.store.state.agentLog;
    log.unshift({ at: new Date().toISOString(), incidentId, kind, text });
    if (log.length > 100) log.length = 100;
  }

  note(inc, text) {
    inc.timeline.push({ at: new Date().toISOString(), type: 'agent', by: 'IncidentFlow Agent', text });
  }

  // Is the service healthy right now? (synthetic probe, not counted as shopper traffic)
  probe(service) {
    const chaos = this.store.state.chaos;
    if (service === 'payments') {
      const mode = this.store.state.paymentRoute === 'backup' ? chaos.payments_backup : chaos.payments;
      return mode === 'healthy';
    }
    return (chaos[service] || 'healthy') === 'healthy';
  }

  diagnose(inc) {
    const fp = inc.fingerprint || '';
    let service = inc.service;
    let symptom = 'failing';
    if (fp.endsWith(':latency')) symptom = 'slow';
    const m = fp.match(/^checkout:([a-z_]+)/);
    if (m) service = m[1];
    const playbook = service === 'payments' ? ['failover', 'restart-payments'] : ['restart', 'restart'];
    return { service, symptom, playbook };
  }

  act(inc, action, service) {
    const st = this.store.state;
    if (action === 'failover') {
      if (st.paymentRoute === 'backup') return 'Payments are already routed to the backup gateway';
      st.paymentRoute = 'backup';
      this.monitor.reset('payments');
      return 'Switched payment traffic from the primary to the backup gateway';
    }
    // Restart: clears transient faults (degraded = leaking/stuck worker), cannot fix hard outages (down).
    const key = service;
    const before = st.chaos[key];
    if (before === 'degraded') st.chaos[key] = 'healthy';
    this.monitor.reset(service);
    return 'Restarted the ' + (SERVICES[service] ? SERVICES[service].name : service) + ' worker' +
      (before === 'down' ? ' (dependency still not responding)' : '');
  }

  escalate(inc, reason) {
    const team = inc.team;
    const engineer = ONCALL[team] || 'On-call engineer';
    const id = 'DEV-' + (++this.store.state.seq.ticket);
    const tried = (inc.agent.attempts || []).map((a, i) => (i + 1) + '. ' + ACTIONS[a.action] + ' - ' + a.result).join('; ');
    const ticket = {
      id, incidentId: inc.id, title: inc.title, team, engineer, status: 'open', severity: inc.severity,
      createdAt: new Date().toISOString(), reason, tried: tried || 'No automatic fix available for this type of incident'
    };
    this.store.state.tickets.unshift(ticket);
    inc.agent.status = 'escalated';
    inc.escalation = { ticket: id, team, engineer, reason, at: ticket.createdAt };
    inc.assignee = engineer + ' (' + team + ' on-call)';
    this.note(inc, 'Escalated to ' + engineer + ' (' + team + ' on-call), ticket ' + id + ': ' + reason);
    this.log(inc.id, 'escalated', inc.id + ' escalated to ' + engineer + ' - ticket ' + id);
  }

  startWork(inc) {
    const d = this.diagnose(inc);
    inc.agent = { status: 'working', diagnosis: d, attempts: [], nextAt: 0, startedAt: new Date().toISOString() };
    if (inc.status === 'open') {
      this.incidents.update(inc.id, { status: 'investigating' }, 'IncidentFlow Agent');
    }
    const what = d.symptom === 'slow' ? 'responding slowly' : 'failing';
    this.note(inc, 'Agent picked up the incident. Diagnosis: ' + (SERVICES[d.service] ? SERVICES[d.service].name : d.service) +
      ' is ' + what + '. Playbook: ' + d.playbook.map((a) => ACTIONS[a]).join(', then ') + '.');
    this.log(inc.id, 'detect', inc.id + ': diagnosed ' + (SERVICES[d.service] ? SERVICES[d.service].name : d.service) + ' ' + what);
  }

  step(inc, now) {
    const ag = inc.agent;
    if (ag.status === 'working') {
      const n = ag.attempts.length;
      if (n >= this.maxAttempts) {
        return this.escalate(inc, 'automatic fixes did not restore the service after ' + n + ' attempts');
      }
      const action = ag.diagnosis.playbook[n] || ag.diagnosis.playbook[ag.diagnosis.playbook.length - 1];
      const result = this.act(inc, action, ag.diagnosis.service);
      ag.attempts.push({ action, at: new Date(now).toISOString(), result: 'pending' });
      ag.status = 'verifying';
      ag.nextAt = now + this.verifyMs;
      this.note(inc, 'Attempt ' + (n + 1) + '/' + this.maxAttempts + ': ' + result + '. Verifying for ' + Math.round(this.verifyMs / 1000) + ' s.');
      this.log(inc.id, 'action', inc.id + ': ' + result);
      return;
    }
    if (ag.status === 'verifying' && now >= ag.nextAt) {
      const ok = this.probe(ag.diagnosis.service);
      const last = ag.attempts[ag.attempts.length - 1];
      if (ok) {
        last.result = 'worked';
        ag.status = 'fixed';
        this.monitor.reset(ag.diagnosis.service);
        this.note(inc, 'Verification passed: synthetic checks on ' + (SERVICES[ag.diagnosis.service] || { name: ag.diagnosis.service }).name + ' succeeded.');
        this.incidents.update(inc.id, {
          status: 'resolved',
          assignee: 'IncidentFlow Agent',
          rootCause: inc.rootCause || ('Automatically diagnosed: ' + (SERVICES[ag.diagnosis.service] || { name: ag.diagnosis.service }).name + ' ' +
            (ag.diagnosis.symptom === 'slow' ? 'responding slowly' : 'failing') + '.'),
          resolution: 'Auto-remediated by the IncidentFlow agent: ' + ACTIONS[last.action].toLowerCase() + '. No engineer needed.'
        }, 'IncidentFlow Agent');
        this.log(inc.id, 'fixed', inc.id + ' fixed automatically (' + ACTIONS[last.action].toLowerCase() + ')');
      } else {
        last.result = 'did not help';
        ag.status = 'working';
        this.note(inc, 'Verification failed: the service is still unhealthy after attempt ' + ag.attempts.length + '.');
        this.log(inc.id, 'verify', inc.id + ': attempt ' + ag.attempts.length + ' did not help');
      }
    }
  }

  tick(now = Date.now()) {
    const st = this.store.state;
    if (!st.agentEnabled) return;
    let changed = false;
    for (const inc of this.incidents.list) {
      if (inc.status === 'resolved') continue;
      if (!inc.agent) {
        if (inc.source === 'monitor' || inc.source === 'checkout') {
          this.startWork(inc); this.step(inc, now); changed = true;
        } else if (inc.source === 'pipeline') {
          inc.agent = { status: 'working', attempts: [], diagnosis: { service: inc.service, symptom: 'deploy', playbook: [] } };
          this.note(inc, 'Agent picked up the incident: a failed deployment needs a code fix, which the agent cannot make.');
          this.escalate(inc, 'deployment failed in Jenkins; the previous version is still serving traffic');
          changed = true;
        }
        continue;
      }
      if (inc.agent.status === 'working' || inc.agent.status === 'verifying') {
        const before = JSON.stringify(inc.agent);
        this.step(inc, now);
        if (JSON.stringify(inc.agent) !== before) changed = true;
      }
    }
    // Fail back to the primary gateway once it is healthy and nothing is in progress.
    if (st.paymentRoute === 'backup' && st.chaos.payments === 'healthy') {
      const busy = this.incidents.list.some((i) => i.status !== 'resolved' && i.agent && i.agent.diagnosis &&
        i.agent.diagnosis.service === 'payments' && (i.agent.status === 'working' || i.agent.status === 'verifying'));
      if (!busy) {
        st.paymentRoute = 'primary';
        this.log(null, 'info', 'Primary payment gateway healthy again: switched traffic back to primary');
        changed = true;
      }
    }
    if (changed) this.store.save();
  }

  // Close the developer ticket when an engineer resolves the incident.
  onResolved(inc) {
    if (!inc.escalation) return;
    const t = this.store.state.tickets.find((x) => x.id === inc.escalation.ticket);
    if (t && t.status !== 'closed') {
      t.status = 'closed';
      t.closedAt = new Date().toISOString();
      this.log(inc.id, 'info', 'Ticket ' + t.id + ' closed: ' + inc.id + ' resolved by ' + (inc.assignee || 'engineer'));
      this.store.save();
    }
  }

  summary() {
    const all = this.incidents.list.filter((i) => i.agent);
    return {
      enabled: this.store.state.agentEnabled,
      paymentRoute: this.store.state.paymentRoute,
      fixed: all.filter((i) => i.agent.status === 'fixed').length,
      escalated: all.filter((i) => i.agent.status === 'escalated').length,
      working: all.filter((i) => i.agent.status === 'working' || i.agent.status === 'verifying').length,
      openTickets: this.store.state.tickets.filter((t) => t.status === 'open').length
    };
  }

  stop() { if (this.timer) clearInterval(this.timer); }
}

module.exports = { RemediationAgent, ONCALL, ACTIONS };
