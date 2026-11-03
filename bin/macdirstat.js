#!/usr/bin/env node
'use strict';
// More libuv threads = more parallel lstat() calls. Must be set before any fs call.
process.env.UV_THREADPOOL_SIZE ||= '16';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { scan, findNode, pathOf, removeNode, serialize, extStats } = require('../lib/scan');

const PUBLIC = path.join(__dirname, '..', 'public');
const MAX_NODES = 50000; // detail budget sent to the browser per view
const TOKEN = crypto.randomBytes(16).toString('hex');

// ---------- CLI ----------
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const startPath = path.resolve((args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port')) || os.homedir());
let port = Number(opt('--port', 4280));

// ---------- Scan state ----------
let state = { root: null, progress: null, startedAt: 0, finishedAt: 0, error: null };

function startScan(p) {
  if (state.progress) state.progress.aborted = true; // cancel previous scan
  const progress = { files: 0, dirs: 0, bytes: 0, errors: 0, current: p, aborted: false };
  state = { root: null, rootPath: p, progress, startedAt: Date.now(), finishedAt: 0, error: null };
  const current = state;
  scan(p, progress)
    .then((root) => { if (!progress.aborted) Object.assign(current, { root, finishedAt: Date.now() }); })
    .catch((e) => { current.error = e.message; current.finishedAt = Date.now(); });
}

// ---------- Helpers ----------
const run = (cmd, argv) => new Promise((resolve, reject) =>
  execFile(cmd, argv, (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))));

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}

function requireNode(p) {
  const node = state.root && typeof p === 'string' ? findNode(state.root, path.resolve(p)) : null;
  if (!node) throw Object.assign(new Error('Élément introuvable'), { status: 404 });
  return node;
}

// ---------- API ----------
const routes = {
  'GET /api/status': () => {
    const { rootPath, progress: p, startedAt, finishedAt, error, root } = state;
    return {
      rootPath, error, startedAt, finishedAt,
      scanning: !root && !error,
      progress: { files: p.files, dirs: p.dirs, bytes: p.bytes, errors: p.errors, current: p.current },
    };
  },

  'POST /api/scan': ({ path: p }) => {
    const abs = path.resolve(String(p || '').replace(/^~(?=$|\/)/, os.homedir()));
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      throw Object.assign(new Error(`Dossier introuvable : ${abs}`), { status: 400 });
    }
    startScan(abs);
    return { ok: true };
  },

  'GET /api/tree': (_, url) => {
    const node = requireNode(url.searchParams.get('path') || state.rootPath);
    return {
      path: pathOf(node),
      rootPath: state.rootPath,
      rootTotals: { s: state.root.size, f: state.root.files },
      tree: serialize(node, Math.max(1, node.size / MAX_NODES)),
      exts: extStats(node),
    };
  },

  'POST /api/reveal': async ({ path: p }) => {
    await run('open', ['-R', pathOf(requireNode(p))]);
    return { ok: true };
  },

  'POST /api/trash': async ({ path: p }) => {
    const node = requireNode(p);
    if (!node.parent) throw Object.assign(new Error('Impossible de supprimer la racine'), { status: 400 });
    // Finder "delete" moves to the Trash (recoverable). The path is passed as argv, never interpolated.
    await run('osascript', ['-e', 'on run argv', '-e',
      'tell application "Finder" to delete (POSIX file (item 1 of argv))', '-e', 'end run', pathOf(node)]);
    removeNode(node);
    return { ok: true };
  },

  'POST /api/pick': async () => {
    try {
      const p = await run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Dossier à analyser")']);
      return { path: p.replace(/\/$/, '') || '/' };
    } catch {
      return { path: null }; // cancelled
    }
  },
};

// ---------- HTTP ----------
const STATIC = { '/app.js': 'text/javascript', '/style.css': 'text/css' };

const server = http.createServer(async (req, res) => {
  // Only accept requests addressed to us (protects against DNS rebinding).
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) return send(res, 403, { error: 'Forbidden' });
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/') {
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('__TOKEN__', TOKEN);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(html);
  }
  if (STATIC[url.pathname]) {
    res.writeHead(200, { 'content-type': STATIC[url.pathname] });
    return fs.createReadStream(path.join(PUBLIC, url.pathname)).pipe(res);
  }

  const route = routes[`${req.method} ${url.pathname}`];
  if (!route) return send(res, 404, { error: 'Not found' });
  // Custom header => other websites can't call the API (no CORS preflight allowed).
  if (req.headers['x-token'] !== TOKEN) return send(res, 403, { error: 'Forbidden' });
  try {
    send(res, 200, await route(req.method === 'POST' ? await readBody(req) : {}, url));
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') return server.listen(++port, '127.0.0.1');
  throw e;
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://localhost:${port}`;
  console.log(`\n  MacDirStat → ${url}\n  Analyse de ${startPath}…  (Ctrl+C pour quitter)\n`);
  if (process.platform === 'darwin' && !flag('--no-open')) execFile('open', [url]);
});

startScan(startPath);
