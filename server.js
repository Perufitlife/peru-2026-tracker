const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = 8080;
const DIR = __dirname;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
};

let syncing = false;

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Sync endpoint
  if (req.url === '/api/sync') {
    if (syncing) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'already_running' }));
      return;
    }
    syncing = true;
    console.log('[SYNC] Starting...');
    execFile('node', [path.join(DIR, 'fetch-data.js')], { timeout: 120000 }, (err, stdout, stderr) => {
      syncing = false;
      if (err) {
        console.log('[SYNC] Error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: err.message }));
      } else {
        console.log('[SYNC] Done!');
        console.log(stdout);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      }
    });
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
  console.log('Sync endpoint: GET /api/sync');
});
