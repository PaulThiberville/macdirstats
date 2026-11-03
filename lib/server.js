'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { scan, findNode, pathOf, removeNode, serialize, extStats } = require('./scan');

const PUBLIC = path.join(__dirname, '..', 'public');
const MAX_NODES = 50000; // detail budget sent to the browser per view

const run = (cmd, argv) => new Promise((resolve, reject) =>
  execFile(cmd, argv, (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))));

/** Default macOS actions via system commands (used by the CLI). Electron injects its own. */
const macActions = {
  reveal: (p) => run('open', ['-R', p]),
  // Finder "delete" moves to the Trash. The path is passed as argv, never interpolated.
  trash: (p) => run('osascript', ['-e', 'on run argv', '-e',
    'tell application "Finder" to delete (POSIX file (item 1 of argv))', '-e', 'end run', p]),
  pick: () => run('osascript', ['-e', 'POSIX path of (choose folder with prompt "Dossier à analyser")'])
    .then((p) => p.replace(/\/$/, '') || '/', () => null),
};

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Starts the local server and a first scan of `startPath`.
 * Resolves with the URL once listening (on `port`, or the next free one).
 */
function start({ startPath = os.homedir(), port = 4280, actions = macActions } = {}) {
  const TOKEN = crypto.randomBytes(16).toString('hex');
  let state;

  function startScan(p) {
    if (state?.progress) state.progress.aborted = true; // cancel previous scan
    const progress = { files: 0, dirs: 0, bytes: 0, errors: 0, current: p, aborted: false };
    const current = (state = { root: null, rootPath: p, progress, startedAt: Date.now(), finishedAt: 0, error: null });
    scan(p, progress)
      .then((root) => { if (!progress.aborted) Object.assign(current, { root, finishedAt: Date.now() }); })
      .catch((e) => Object.assign(current, { error: e.message, finishedAt: Date.now() }));
  }

  function requireNode(p) {
    const node = state.root && typeof p === 'string' ? findNode(state.root, path.resolve(p)) : null;
    if (!node) throw httpError(404, 'Élément introuvable');
    return node;
  }

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
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw httpError(400, `Dossier introuvable : ${abs}`);
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
      await actions.reveal(pathOf(requireNode(p)));
      return { ok: true };
    },

    'POST /api/trash': async ({ path: p }) => {
      const node = requireNode(p);
      if (!node.parent) throw httpError(400, 'Impossible de supprimer la racine');
      await actions.trash(pathOf(node));
      removeNode(node);
      return { ok: true };
    },

    'POST /api/pick': async () => ({ path: await actions.pick() }),
  };

  const STATIC = { '/app.js': 'text/javascript', '/style.css': 'text/css' };

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

  startScan(path.resolve(startPath));

  return new Promise((resolve, reject) => {
    server.on('error', (e) => (e.code === 'EADDRINUSE' ? server.listen(++port, '127.0.0.1') : reject(e)));
    server.on('listening', () => resolve({ url: `http://localhost:${server.address().port}`, server }));
    server.listen(port, '127.0.0.1');
  });
}

module.exports = { start };
