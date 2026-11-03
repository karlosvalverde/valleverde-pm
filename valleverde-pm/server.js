#!/usr/bin/env node
// Valleverde PM local server.
// Serves the app from ./app on http://localhost:8080, only to this computer.
// It has no data of its own: your workspace lives in the browser.
// Usage: npm start   (or: node server.js --open)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

if (Number(process.versions.node.split('.')[0]) < 18) {
  console.error(`Valleverde PM needs Node.js 18 or newer. You have ${process.versions.node}.`);
  process.exit(1);
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'app');
// Keep the port fixed: the browser keeps your workspace per address, so a different
// port opens a separate, empty workspace.
const PORT = Number(process.env.PORT) || 8080;
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const SECURITY = {
  'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-cache',
};

const server = http.createServer(async (req, res) => {
  const send = (status, body, type = 'text/plain; charset=utf-8') => {
    res.writeHead(status, { 'Content-Type': type, ...SECURITY });
    res.end(body);
  };
  if (!HOSTS.has(req.headers.host || '')) return send(403, 'Forbidden');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed');

  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return send(400, 'Bad request'); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) return send(403, 'Forbidden');
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return send(404, 'Not found');

  try { send(200, await readFile(file), type); }
  catch { send(404, 'Not found'); }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Valleverde PM may already be running: open http://localhost:${PORT}\n`);
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Valleverde PM is running at ${url}\n  Only this computer can open it. Press Ctrl+C to stop.\n`);
  if (process.argv.includes('--open')) {
    const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
      : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
    try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch {}
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { console.log('\n  Valleverde PM stopped.'); process.exit(0); });
