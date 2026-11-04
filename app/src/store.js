'use strict';
// Small JSON-file data store. The file lives on a Docker volume (/data) so
// incidents and orders survive container redeployments.
const fs = require('fs');
const path = require('path');

function emptyState() {
  return {
    seq: { incident: 1000, order: 50000 },
    incidents: [],
    orders: [],
    chaos: {}
  };
}

class Store {
  constructor(file) {
    this.file = file || null; // null = in-memory only (tests)
    this.state = emptyState();
    if (this.file && fs.existsSync(this.file)) {
      try {
        this.state = Object.assign(emptyState(), JSON.parse(fs.readFileSync(this.file, 'utf8')));
      } catch (err) {
        console.error('Could not read data file, starting empty:', err.message);
      }
    }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.file); // atomic replace
  }

  nextId(kind) {
    this.state.seq[kind] += 1;
    return this.state.seq[kind];
  }
}

module.exports = { Store };
