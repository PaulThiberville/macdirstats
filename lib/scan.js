'use strict';
const fsp = require('node:fs/promises');
const path = require('node:path');

const CONCURRENCY = 32; // directories processed in parallel

/** Extension used for coloring: ".jpg" → "jpg", no extension → "" */
function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** Runs `job` for every item of `stack` (which jobs may grow) with bounded concurrency. */
function pool(stack, job) {
  return new Promise((resolve) => {
    let active = 0;
    const pump = () => {
      while (active < CONCURRENCY && stack.length) {
        active++;
        job(stack.pop()).finally(() => {
          active--;
          if (!active && !stack.length) resolve();
          else pump();
        });
      }
    };
    pump();
    if (!active) resolve();
  });
}

/**
 * Scans `rootPath` and returns a tree of { name, size, files, mtime, children?, ext?, parent }.
 * - Size = blocks actually allocated on disk (same as `du`, correct for APFS sparse/dataless files).
 * - Hard links are counted once, and the scan never crosses into another volume.
 * `progress` is mutated live so the UI can poll it; set `progress.aborted = true` to stop.
 */
async function scan(rootPath, progress) {
  const st = await fsp.stat(rootPath);
  if (!st.isDirectory()) throw new Error(`${rootPath} n'est pas un dossier`);

  const root = { name: rootPath, parent: null, size: 0, files: 0, mtime: st.mtimeMs, children: [] };
  const seenInodes = new Set();
  const stack = [[rootPath, root]];

  await pool(stack, async ([dir, node]) => {
    if (progress.aborted) return;
    progress.current = dir;
    let names;
    try {
      names = await fsp.readdir(dir);
    } catch {
      progress.errors++;
      node.denied = true;
      return;
    }
    progress.dirs++;

    await Promise.all(names.map(async (name) => {
      const p = path.join(dir, name);
      let s;
      try { s = await fsp.lstat(p); } catch { progress.errors++; return; }

      if (s.isDirectory()) {
        if (s.dev !== st.dev) return; // other volume (external disk, network share…)
        const child = { name, parent: node, size: 0, files: 0, mtime: s.mtimeMs, children: [] };
        node.children.push(child);
        stack.push([p, child]);
        return;
      }
      if (s.nlink > 1) {
        if (seenInodes.has(s.ino)) return;
        seenInodes.add(s.ino);
      }
      const size = s.blocks * 512;
      node.children.push({ name, parent: node, size, mtime: s.mtimeMs, ext: extOf(name) });
      progress.files++;
      progress.bytes += size;
    }));
  });

  finalize(root);
  return root;
}

/** Post-order pass: aggregates sizes/counts/mtime and sorts children by size. */
function finalize(node) {
  let size = 0, files = 0, mtime = node.mtime;
  for (const c of node.children) {
    if (c.children) finalize(c);
    size += c.size;
    files += c.children ? c.files : 1;
    if (c.mtime > mtime) mtime = c.mtime;
  }
  node.children.sort((a, b) => b.size - a.size);
  Object.assign(node, { size, files, mtime });
}

/** Finds the node at absolute path `p` inside `root`, or null. */
function findNode(root, p) {
  const rel = path.relative(root.name, p);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  let node = root;
  for (const part of rel.split(path.sep).filter(Boolean)) {
    node = node.children?.find((c) => c.name === part);
    if (!node) return null;
  }
  return node;
}

function pathOf(node) {
  const parts = [];
  for (let n = node; n; n = n.parent) parts.unshift(n.name);
  return path.join(...parts);
}

/** Removes a node from the tree and updates its ancestors' totals. */
function removeNode(node) {
  const parent = node.parent;
  parent.children.splice(parent.children.indexOf(node), 1);
  const files = node.children ? node.files : 1;
  for (let n = parent; n; n = n.parent) {
    n.size -= node.size;
    n.files -= files;
  }
}

/**
 * Compact JSON for the UI. Items smaller than `minSize` are merged into one
 * "small items" entry per folder, so the payload stays bounded (~50k nodes)
 * whatever the number of files. Zooming in refetches with finer detail.
 */
function serialize(node, minSize) {
  if (!node.children) return { n: node.name, s: node.size, m: node.mtime, e: node.ext };
  const out = { n: node.name, s: node.size, f: node.files, m: node.mtime, c: [] };
  if (node.denied) out.d = 1;
  let restSize = 0, restCount = 0;
  for (const c of node.children) {
    if (c.size >= minSize) out.c.push(serialize(c, minSize));
    else { restSize += c.size; restCount++; }
  }
  if (restCount) out.c.push({ n: `${restCount} petits éléments`, s: restSize, x: restCount });
  return out;
}

/** Size and file count per extension, largest first. */
function extStats(node, limit = 100) {
  const map = new Map();
  (function walk(n) {
    if (n.children) return n.children.forEach(walk);
    const v = map.get(n.ext) || { e: n.ext, s: 0, f: 0 };
    v.s += n.size;
    v.f++;
    map.set(n.ext, v);
  })(node);
  return [...map.values()].sort((a, b) => b.s - a.s).slice(0, limit);
}

module.exports = { scan, findNode, pathOf, removeNode, serialize, extStats };
