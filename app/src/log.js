'use strict';
// Colour-coded, one-line-per-event console log. View it live on the server with:
//   sudo docker logs -f --tail 50 incidentflow
const C = { INFO: '\x1b[36m', OK: '\x1b[32m', WARN: '\x1b[33m', ERROR: '\x1b[31m', ALERT: '\x1b[35m', AGENT: '\x1b[94m', DIM: '\x1b[2m', BOLD: '\x1b[1m', RESET: '\x1b[0m' };

function createLogger({ quiet = false, color = process.env.LOG_COLOR !== '0' } = {}) {
  const last = new Map();
  const log = (level, component, message) => {
    if (quiet) return;
    const t = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false });
    const lv = level.padEnd(5);
    const comp = String(component).padEnd(12);
    console.log(color
      ? C.DIM + t + C.RESET + '  ' + (C[level] || '') + C.BOLD + lv + C.RESET + '  ' + C.DIM + comp + C.RESET + ' ' + (C[level] || '') + message + C.RESET
      : t + '  ' + lv + '  ' + comp + ' ' + message);
  };
  // Same as log(), but at most once per `ms` for the same key (keeps bursts of traffic readable).
  log.throttled = (key, ms, level, component, message) => {
    const now = Date.now();
    if (now - (last.get(key) || 0) < ms) return;
    last.set(key, now);
    log(level, component, message);
  };
  return log;
}

module.exports = { createLogger };
