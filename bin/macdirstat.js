#!/usr/bin/env node
'use strict';
// More libuv threads = more parallel lstat() calls. Must be set before any fs call.
process.env.UV_THREADPOOL_SIZE ||= '16';

const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { start } = require('../lib/server');

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const startPath = path.resolve(args.find((a, i) => !a.startsWith('--') && (portIdx < 0 || i !== portIdx + 1)) || os.homedir());
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 4280;

start({ startPath, port }).then(({ url }) => {
  console.log(`\n  MacDirStat → ${url}\n  Analyse de ${startPath}…  (Ctrl+C pour quitter)\n`);
  if (process.platform === 'darwin' && !args.includes('--no-open')) execFile('open', [url]);
});
