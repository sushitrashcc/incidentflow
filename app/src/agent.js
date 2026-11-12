'use strict';
// IncidentFlow self-healing agent.
//
// For every automatically detected incident it runs a small loop:
//   OBSERVE -> DIAGNOSE -> ACT (from a fixed playbook) -> VERIFY -> RESOLVE or ESCALATE
// It only uses safe, reversible actions, tries at most `maxAttempts` times and
// then hands the incident to the owning team's on-call engineer with a ticket.
const { SERVICES } = require('./severity');
const { ACTION_LABELS, byId } = require('./faults');

const ONCALL = {
  Payments: 'Vaibhav Shelke',
  Checkout: 'Luv Arora',
  'Web Platform': 'Luv Arora',
  Catalog: 'Shashwat Mishra',
  'Supply Chain': 'Shashwat Mishra',
  Logistics: 'Vaibhav Shelke'
};

const ACTIONS = ACTION_LABELS;

// Which remediation actions make sense for each service (used when engineers teach the agent).
const ALLOWED = {
  payments: ['failover', 'reset-pool', 'restart'],
  catalog: ['reindex', 'scale-out', 'restart'],
  inventory: ['restart', 'scale-out'],
  checkout: ['flush-cache', 'restart'],
  cart: ['flush-cache', 'restart'],
  notifications: ['restart-queue', 'restart'],
  shipping: ['courier-failover', 'restart'],
  storefront: ['scale-out', 'restart']
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
    if (!st.faults || typeof st.faults !== 'object') st.faults = {};
    if (!st.courierRoute) st.courierRoute = 'primary';
    if (typeof st.pendingEmails !== 'number') st.pendingEmails = 0;
    if (!Array.isArray(st.knowledge)) st.knowledge = [];
    if (!st.seq.kb) st.seq.kb = 0;
    this.timer = null;
    if (opts.intervalMs !== 0) {
      this.timer = setInterval(() => { try { this.tick(); } catch (err) { console.error('agent tick failed', err); } }, opts.intervalMs || 2000);
      this.timer.unref();
    }
  }

  get enabled() { return this.store.state.agentEnabled; }
  set enabled(v) { this.store.state.agentEnabled = !!v; this.log(null, 'info', 'Agent ' + (v ? 'enabled' : 'paused') + ' by ops'); }

  log(incidentId, kind, text, quiet) {
    if (this.logger && !quiet) {
      const lv = { detect: 'AGENT', action: 'AGENT', verify: 'WARN', fixed: 'OK', escalated: 'ERROR', info: 'INFO' }[kind] || 'INFO';
      const label = { detect: 'DIAGNOSED: ', action: 'ACTION: ', verify: 'VERIFY FAILED: ', fixed: 'FIXED: ', escalated: 'ESCALATED: ', info: '' }[kind] || '';
      this.logger(lv, kind === 'info' ? 'ops' : 'agent', label + text);
    }
    const log = this.store.state.agentLog;
    log.unshift({ at: new Date().toISOString(), incidentId, kind, text });
    if (log.length > 100) log.length = 100;
  }

  note(inc, text) {
    inc.timeline.push({ at: new Date().toISOString(), type: 'agent', by: 'IncidentFlow Agent', text });
  }

  // What a call to the service experiences right now, taking failovers into account.
  effectiveMode(service) {
    const st = this.store.state;
    if (service === 'payments') return st.paymentRoute === 'backup' ? (st.chaos.payments_backup || 'healthy') : (st.chaos.payments || 'healthy');
    if (service === 'shipping' && st.courierRoute === 'backup') return st.faults.shipping === 'courier-partner-outage' ? 'down' : 'healthy';
    return st.chaos[service] || 'healthy';
  }

  // Is the service healthy right now? (synthetic probe, not counted as shopper traffic)
  probe(service) {
    if (service === 'catalog' && this.store.state.faults.catalog === 'search-index-corrupt') return false;
    return this.effectiveMode(service) === 'healthy';
  }

  diagnose(inc) {
    const fp = inc.fingerprint || '';
    let service = inc.service;
    let symptom = 'failing';
    if (fp.endsWith(':latency')) symptom = 'slow';
    // Checkout failures are fingerprinted 'checkout:<failing service>'; monitor alerts use '<service>:error-rate|latency'.
    const m = inc.source === 'checkout' && fp.match(/^checkout:([a-z_]+)/);
    if (m) service = m[1];
    const sc = byId(this.store.state.faults[service]);
    // Built-in knowledge first, then what engineers have taught the agent.
    const kb = sc ? null : this.store.state.knowledge.find((k) => k.service === service && k.symptom === (symptom === 'slow' ? 'slow' : 'down'));
    const playbook = sc ? sc.playbook : kb ? [kb.action] : [];
    const finding = sc ? sc.diagnostic : kb ? 'matches learned knowledge ' + kb.id + ' (' + kb.title + ')' : null;
    return { service, symptom, playbook, scenario: sc ? sc.id : null, knowledge: kb ? kb.id : null, finding };
  }

  // Engineers add a failure and its fix to the agent's knowledge base.
  learn({ title, service, symptom, action, notes, incidentId, by }) {
    if (!SERVICES[service]) throw new Error('Unknown service');
    if (!['down', 'slow'].includes(symptom)) throw new Error('Symptom must be down or slow');
    if (!(ALLOWED[service] || []).includes(action)) throw new Error('That fix does not apply to ' + SERVICES[service].name);
    const st = this.store.state;
    const existing = st.knowledge.find((k) => k.service === service && k.symptom === symptom);
    const entry = existing || { id: 'KB-' + (++st.seq.kb), createdAt: new Date().toISOString(), timesUsed: 0 };
    Object.assign(entry, { title: String(title || '').trim().slice(0, 140) || SERVICES[service].name + ' ' + symptom, service, symptom, action,
      notes: String(notes || '').trim().slice(0, 1000), learnedFrom: incidentId || entry.learnedFrom || null, by: by || 'engineer', updatedAt: new Date().toISOString() });
    if (!existing) st.knowledge.unshift(entry);
    const inc = incidentId ? this.incidents.get(incidentId) : null;
    if (inc) {
      inc.taught = entry.id;
      this.note(inc, (by || 'Engineer') + ' taught the agent (' + entry.id + '): when ' + SERVICES[service].name + ' is ' + symptom + ', ' + ACTIONS[action].toLowerCase() + '.');
    }
    if (this.logger) this.logger('OK', 'knowledge', 'LEARNED ' + entry.id + ': "' + entry.title + '" (' + SERVICES[service].name + ' ' + symptom + ') -> ' + ACTIONS[action] + '  [taught by ' + (by || 'engineer') + ']');
    this.log(inc ? inc.id : null, 'info', 'Agent learned ' + entry.id + ': ' + entry.title + ' -> ' + ACTIONS[action], true);
    this.store.save();
    return entry;
  }

  // Apply one remediation action. It only changes the system when it is the right fix
  // for what is actually wrong; outages outside our control are not fixable.
  act(inc, action, service) {
    const st = this.store.state;
    const sc = byId(st.faults[service]);
    const name = SERVICES[service] ? SERVICES[service].name : service;
    if (this.probe(service)) return name + ' is already healthy again (fixed together with a related incident)';
    const kb = inc.agent && inc.agent.diagnosis && inc.agent.diagnosis.knowledge ? st.knowledge.find((k) => k.id === inc.agent.diagnosis.knowledge) : null;
    if (kb && kb.action === action) {
      kb.timesUsed = (kb.timesUsed || 0) + 1;
      kb.lastUsedAt = new Date().toISOString();
      if (action !== 'failover' && action !== 'courier-failover') {
        st.chaos[service] = 'healthy';
        this.monitor.reset(service);
        let extra = '';
        if (action === 'restart-queue' && st.pendingEmails) { extra = '; resent ' + st.pendingEmails + ' pending confirmation emails'; st.pendingEmails = 0; }
        return ACTIONS[action] + extra + ' (learned fix ' + kb.id + ')';
      }
    }
    if (action === 'failover') {
      if (st.paymentRoute === 'backup') return 'Payments are already routed to the backup gateway';
      st.paymentRoute = 'backup';
      this.monitor.reset('payments');
      return 'Switched payment traffic from the primary to the backup gateway';
    }
    if (action === 'courier-failover') {
      st.courierRoute = 'backup';
      this.monitor.reset('shipping');
      return 'Switched order tracking to the backup courier API';
    }
    this.monitor.reset(service);
    const fixes = sc && sc.fixable && sc.fixedBy === action;
    if (fixes) {
      for (const k of Object.keys(sc.chaos)) st.chaos[k] = 'healthy';
      delete st.faults[service];
      let extra = '';
      if (action === 'restart-queue' && st.pendingEmails) { extra = '; resent ' + st.pendingEmails + ' pending confirmation emails'; st.pendingEmails = 0; }
      return ACTIONS[action] + extra;
    }
    if (!sc && (action === 'restart' || action === 'restart-payments') && st.chaos[service] === 'degraded') {
      st.chaos[service] = 'healthy';
      return 'Restarted the ' + name + ' worker';
    }
    return ACTIONS[action] + ' (done, but ' + (sc ? sc.diagnostic : name + ' still not responding') + ')';
  }

  escalate(inc, reason) {
    const team = inc.team;
    const engineer = ONCALL[team] || 'On-call engineer';
    const tried = (inc.agent.attempts || []).map((a, i) => (i + 1) + '. ' + ACTIONS[a.action] + ' - ' + a.result).join('; ');
    // Related incidents on the same service share one open ticket instead of paging twice.
    let ticket = this.store.state.tickets.find((t) => t.status === 'open' && t.service === inc.service);
    if (ticket) {
      ticket.incidentIds = [...new Set([...(ticket.incidentIds || [ticket.incidentId]), inc.id])];
    } else {
      ticket = {
        id: 'DEV-' + (++this.store.state.seq.ticket), incidentId: inc.id, incidentIds: [inc.id], service: inc.service, title: inc.title, team, engineer,
        status: 'open', severity: inc.severity, createdAt: new Date().toISOString(), reason, tried: tried || 'No automatic fix available for this type of incident'
      };
      this.store.state.tickets.unshift(ticket);
    }
    const id = ticket.id;
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
      ' is ' + what + (d.finding ? '; diagnostic check: ' + d.finding : '') + (d.playbook.length ? '. Playbook: ' + d.playbook.map((a) => ACTIONS[a]).join(', then ') : '') + '.');
    this.log(inc.id, 'detect', inc.id + ': ' + (SERVICES[d.service] ? SERVICES[d.service].name : d.service) + ' ' + what + (d.finding ? ' (' + d.finding + ')' : ''));
    if (!d.playbook.length) {
      this.note(inc, 'This is a NEW failure: nothing in the agent\'s knowledge base matches ' + (SERVICES[d.service] ? SERVICES[d.service].name : d.service) +
        ' ' + what + '. The agent will not guess; handing over to an engineer.');
      this.escalate(inc, 'new failure the agent has not seen before (not in its knowledge base). Please fix it and use "Teach the agent" so it can handle it next time');
    }
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
            (ag.diagnosis.symptom === 'slow' ? 'responding slowly' : 'failing') + (ag.diagnosis.finding ? ' (' + ag.diagnosis.finding + ')' : '') + '.'),
          resolution: 'Auto-remediated by the IncidentFlow agent: ' + ACTIONS[last.action].toLowerCase() +
            (ag.diagnosis.knowledge ? ' (using knowledge ' + ag.diagnosis.knowledge + ' taught by an engineer)' : '') + '. No engineer needed.'
        }, 'IncidentFlow Agent');
        this.log(inc.id, 'fixed', inc.id + ' fixed automatically (' + ACTIONS[last.action].toLowerCase() + ')' + (ag.diagnosis.knowledge ? ' using learned knowledge ' + ag.diagnosis.knowledge : ''));
      } else {
        last.result = 'did not help';
        ag.status = 'working';
        this.note(inc, 'Verification failed: the service is still unhealthy after attempt ' + ag.attempts.length + '.');
        this.log(inc.id, 'verify', inc.id + ': attempt ' + ag.attempts.length + ' did not help');
      }
    }
  }

  // Print a line whenever a service changes between RUNNING / DEGRADED / DOWN.
  watchHealth() {
    if (!this.logger) return;
    this.lastHealth = this.lastHealth || {};
    const names = Object.keys(SERVICES);
    for (const svc of names) {
      const mode = this.effectiveMode(svc);
      const state = (svc === 'catalog' && this.store.state.faults.catalog === 'search-index-corrupt') || mode === 'down' ? 'DOWN' : mode === 'degraded' ? 'DEGRADED' : 'RUNNING';
      const prev = this.lastHealth[svc];
      this.lastHealth[svc] = state;
      if (prev === undefined || prev === state) continue;
      const name = SERVICES[svc].name;
      const via = svc === 'payments' && this.store.state.paymentRoute === 'backup' ? ' (via backup gateway)'
        : svc === 'shipping' && this.store.state.courierRoute === 'backup' ? ' (via backup courier API)' : '';
      if (state === 'RUNNING') this.logger('OK', svc, name + ' is RUNNING again' + via);
      else this.logger(state === 'DOWN' ? 'ERROR' : 'WARN', svc, name + ' is ' + state);
      if (state === 'RUNNING' && names.every((k) => this.lastHealth[k] === 'RUNNING')) {
        this.logger('OK', 'health', 'All ' + names.length + ' services RUNNING');
      }
    }
  }

  tick(now = Date.now()) {
    const st = this.store.state;
    this.watchHealth();
    if (!st.agentEnabled) return;
    let changed = false;
    for (const inc of this.incidents.list) {
      if (inc.status === 'resolved') continue;
      if (!inc.agent) {
        if (inc.source === 'monitor' || inc.source === 'checkout') {
          this.startWork(inc);
          if (inc.agent.status === 'working') this.step(inc, now);
          changed = true;
        } else if (inc.source === 'customer') {
          inc.agent = { status: 'working', attempts: [], diagnosis: { service: inc.service, symptom: 'reported', playbook: [] } };
          this.note(inc, 'Agent picked up a customer report. Problems described by shoppers need a human to investigate.');
          this.escalate(inc, 'reported by a customer; the agent cannot verify or fix customer-reported problems on its own');
          changed = true;
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
    const stillOpen = t && (t.incidentIds || [t.incidentId]).some((iid) => { const o = this.incidents.get(iid); return o && o.status !== 'resolved'; });
    if (t && t.status !== 'closed' && !stillOpen) {
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
      courierRoute: this.store.state.courierRoute,
      fixed: all.filter((i) => i.agent.status === 'fixed').length,
      escalated: all.filter((i) => i.agent.status === 'escalated').length,
      working: all.filter((i) => i.agent.status === 'working' || i.agent.status === 'verifying').length,
      openTickets: this.store.state.tickets.filter((t) => t.status === 'open').length,
      learned: this.store.state.knowledge.length
    };
  }

  stop() { if (this.timer) clearInterval(this.timer); }
}

module.exports = { RemediationAgent, ONCALL, ACTIONS, ALLOWED };
