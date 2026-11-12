'use strict';
const { createApp } = require('./app');

const port = Number(process.env.PORT || 3000);
const app = createApp();
const server = app.listen(port, () => {
  const log = app.locals.logger;
  log('OK', 'app', 'IncidentFlow ' + (process.env.APP_VERSION || 'dev') + ' started on port ' + port + ' - store, ops console and agent RUNNING');
  log('INFO', 'app', 'Live log: failures, incidents, agent actions and recoveries appear here');
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    app.locals.logger('WARN', 'app', 'Received ' + sig + ', shutting down (new version being deployed)');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
