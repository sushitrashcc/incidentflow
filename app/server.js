'use strict';
const { createApp } = require('./app');

const port = Number(process.env.PORT || 3000);
const app = createApp();
const server = app.listen(port, () => {
  console.log('IncidentFlow ' + (process.env.APP_VERSION || 'dev') + ' listening on port ' + port);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log('Received ' + sig + ', shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
