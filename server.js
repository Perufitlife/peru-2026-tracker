const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = 8080;
const DIR = __dirname;
const AUTO_SYNC_MINUTES = 10;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

let syncing = false;
let lastSync = null;
let lastError = null;

function runSync(callback) {
  if (syncing) {
    if (callback) callback({ status: 'already_running' });
    return;
  }
  syncing = true;
  console.log(`[SYNC] Starting at ${new Date().toLocaleString('es-PE')}...`);

  execFile('node', [path.join(DIR, 'fetch-data.js')], { timeout: 120000 }, (err, stdout, stderr) => {
    syncing = false;
    if (err) {
      console.log('[SYNC] Error:', err.message);
      lastError = err.message;
      if (callback) callback({ status: 'error', message: err.message });
      return;
    }
    console.log('[SYNC] Done!');
    lastSync = new Date();
    lastError = null;

    // Auto-push to GitHub (data.json + history.json)
    execFile('git', ['add', 'data.json', 'history.json'], { cwd: DIR }, () => {
      execFile('git', ['commit', '-m', `Sync ${new Date().toISOString()}`], { cwd: DIR }, (commitErr) => {
        if (commitErr) {
          console.log('[GIT] Nothing to commit or error:', commitErr.message.split('\n')[0]);
        } else {
          execFile('git', ['push'], { cwd: DIR }, (pushErr) => {
            if (pushErr) console.log('[PUSH] Error:', pushErr.message);
            else console.log('[PUSH] Done!');
          });
        }
      });
    });
    if (callback) callback({ status: 'ok' });
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Sync endpoint
  if (req.url === '/api/sync') {
    runSync(result => {
      const code = result.status === 'error' ? 500 : 200;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  // Status endpoint
  if (req.url === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      syncing,
      lastSync: lastSync ? lastSync.toISOString() : null,
      lastError,
      autoSyncMinutes: AUTO_SYNC_MINUTES,
    }));
    return;
  }

  // Static files — strip query params
  let urlPath = req.url.split('?')[0];
  let filePath = urlPath === '/' ? '/index.html' : urlPath;
  filePath = path.join(DIR, filePath);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`Sync endpoint: GET /api/sync`);
  console.log(`Auto-sync: cada ${AUTO_SYNC_MINUTES} minutos`);

  // Sincronización automática al arrancar (después de 5 segundos para dar tiempo)
  setTimeout(() => {
    console.log('[AUTO-SYNC] Sync inicial al arrancar...');
    runSync();
  }, 5000);

  // Timer recurrente cada N minutos
  setInterval(() => {
    if (!syncing) {
      console.log(`[AUTO-SYNC] Sync cada ${AUTO_SYNC_MINUTES} min...`);
      runSync();
    } else {
      console.log('[AUTO-SYNC] Saltado: sync anterior aun en progreso');
    }
  }, AUTO_SYNC_MINUTES * 60 * 1000);
});
