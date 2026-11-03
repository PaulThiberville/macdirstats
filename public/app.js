'use strict';
const $ = (id) => document.getElementById(id);

// ---------- Formatting ----------
const nf = new Intl.NumberFormat('fr-FR');
const df = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
function fmtSize(b) { // decimal units, like the Finder
  const u = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let i = 0;
  while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
  return `${b.toFixed(b >= 100 || i === 0 ? 0 : 1).replace('.', ',')} ${u[i]}`;
}
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1).replace('.', ',')} %` : '–');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ---------- API ----------
async function api(url, body) {
  const r = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-token': window.TOKEN, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------- State ----------
const S = {
  rootPath: '',
  view: null,        // { path, tree, exts }
  selected: null,
  hover: null,
  ext: null,         // highlighted extension
  expanded: new Set(),
  colors: new Map(), // ext -> { base, light, dark }
};

// ---------- Colors ----------
const PALETTE = [
  [232, 85, 68], [168, 72, 60], [12, 90, 64], [42, 95, 58], [330, 80, 66], [195, 85, 55], [275, 70, 66],
  [100, 55, 52], [20, 70, 50], [215, 70, 62], [350, 70, 58], [60, 70, 50], [180, 55, 45], [300, 50, 55],
];
const hsl = (h, s, l) => `hsl(${h} ${s}% ${l}%)`;
const OTHER = { base: hsl(222, 12, 38), light: hsl(222, 12, 48), dark: hsl(222, 14, 26) };
function buildColors(exts) {
  S.colors = new Map();
  exts.slice(0, PALETTE.length).forEach((x, i) => {
    const [h, s, l] = PALETTE[i];
    S.colors.set(x.e, { base: hsl(h, s, l), light: hsl(h, s, Math.min(l + 14, 85)), dark: hsl(h, s - 10, l - 20) });
  });
}
const colorOf = (n) => S.colors.get(n.e) || OTHER;
const isDir = (n) => !!n.c;

// ---------- Loading ----------
function annotate(node, p, parent) {
  node.p = p;
  node.parent = parent;
  if (node.c) for (const c of node.c) annotate(c, c.x ? null : `${p === '/' ? '' : p}/${c.n}`, node);
}

async function load(path, selectPath) {
  try {
    const data = await api(`/api/tree?path=${encodeURIComponent(path)}`);
    annotate(data.tree, data.path, null);
    S.rootPath = data.rootPath;
    S.view = data;
    S.ext = null;
    S.hover = null;
    $('tooltip').hidden = true;
    S.expanded = new Set([data.tree]);
    buildColors(data.exts);
    const sel = selectPath && findByPath(data.tree, selectPath);
    if (document.activeElement !== $('pathInput')) $('pathInput').value = data.rootPath;
    select(sel || data.tree, false);
    renderCrumbs();
    renderTypes();
    renderSummary();
    drawMap();
  } catch (e) { toast(e.message); }
}

function findByPath(node, p) {
  if (node.p === p) return node;
  if (!node.c || !p.startsWith(node.p)) return null;
  for (const c of node.c) { const f = findByPath(c, p); if (f) return f; }
  return null;
}

const zoom = (node) => {
  while (node && !isDir(node)) node = node.parent; // file or "small items" → its folder
  if (node && node !== S.view.tree) load(node.p);
};
const goUp = () => {
  if (S.view.path === S.rootPath) return;
  load(S.view.path.slice(0, S.view.path.lastIndexOf('/')) || '/', S.view.path);
};

// ---------- Scan progress ----------
async function poll() {
  const st = await api('/api/status');
  const p = st.progress;
  $('scanOverlay').hidden = !st.scanning;
  if (st.scanning) {
    $('scFiles').textContent = nf.format(p.files);
    $('scSize').textContent = fmtSize(p.bytes);
    $('scTime').textContent = `${Math.round((Date.now() - st.startedAt) / 1000)} s`;
    $('scCurrent').textContent = `‎${p.current}`;
    return setTimeout(poll, 250);
  }
  if (st.error) return toast(st.error);
  S.scan = st;
  load(st.rootPath);
}

async function startScan(path) {
  try {
    await api('/api/scan', { path });
    poll();
  } catch (e) { toast(e.message); }
}

// ---------- Summary / crumbs ----------
function renderSummary() {
  const t = S.view.rootTotals;
  const st = S.scan;
  const secs = ((st.finishedAt - st.startedAt) / 1000).toFixed(1).replace('.', ',');
  $('summary').innerHTML =
    `<span><b>${fmtSize(t.s)}</b> utilisés</span><span><b>${nf.format(t.f)}</b> fichiers</span><span>analysé en ${secs} s</span>` +
    (st.progress.errors ? `<span class="warn" title="Donnez l'« Accès complet au disque » à votre Terminal (Réglages Système › Confidentialité et sécurité)">⚠ ${nf.format(st.progress.errors)} inaccessibles</span>` : '');
}

function renderCrumbs() {
  const root = S.rootPath;
  const rel = S.view.path.slice(root.length).split('/').filter(Boolean);
  const items = [[root, root === '/' ? 'Macintosh HD' : root.split('/').pop() || root]];
  rel.forEach((part, i) => items.push([`${root === '/' ? '' : root}/${rel.slice(0, i + 1).join('/')}`, part]));
  $('crumbs').innerHTML = items.map(([p, n]) => `<button data-p="${esc(p)}">${esc(n)}</button>`).join('<span class="sep">›</span>');
  $('upBtn').disabled = items.length === 1;
}
$('crumbs').addEventListener('click', (e) => { const p = e.target.dataset?.p; if (p && p !== S.view.path) load(p); });

// ---------- Types panel ----------
function renderTypes() {
  const total = S.view.tree.s;
  $('types').innerHTML = S.view.exts.map((x) => {
    const c = S.colors.get(x.e) || OTHER;
    const cls = S.ext === null ? '' : S.ext === x.e ? 'on' : 'off';
    return `<div class="type ${cls}" data-e="${esc(x.e)}">
      <span class="swatch" style="background:${c.base}"></span>
      <span>${x.e ? `.${esc(x.e)}` : '<small>sans extension</small>'} <small>· ${nf.format(x.f)}</small></span>
      <span class="num">${fmtSize(x.s)}</span><small class="num">${pct(x.s, total)}</small></div>`;
  }).join('');
  $('clearExt').hidden = S.ext === null;
}
$('types').addEventListener('click', (e) => {
  const el = e.target.closest('.type');
  if (!el) return;
  S.ext = S.ext === el.dataset.e ? null : el.dataset.e;
  renderTypes();
  drawMap();
});
$('clearExt').onclick = () => { S.ext = null; renderTypes(); drawMap(); };

// ---------- Tree (virtualized) ----------
const ROW = 26;
let rows = [];

function buildRows() {
  rows = [];
  (function walk(n, depth) {
    rows.push([n, depth]);
    if (n.c && S.expanded.has(n)) for (const c of n.c) walk(c, depth + 1);
  })(S.view.tree, 0);
  $('treeInner').style.height = `${rows.length * ROW}px`;
  renderTree();
}

function renderTree() {
  const el = $('tree');
  const from = Math.max(0, Math.floor(el.scrollTop / ROW) - 5);
  const to = Math.min(rows.length, from + Math.ceil(el.clientHeight / ROW) + 10);
  let html = '';
  for (let i = from; i < to; i++) {
    const [n, d] = rows[i];
    const parentSize = n.parent ? n.parent.s : n.s;
    const name = d === 0 ? n.p.split('/').pop() || n.p : n.n;
    const ico = n.x ? 'agg' : isDir(n) ? 'dir' : '';
    const style = ico ? '' : `style="background:${colorOf(n).base}"`;
    html += `<div class="row${n === S.selected ? ' sel' : ''}" data-i="${i}" style="top:${i * ROW}px">
      <div class="name" style="padding-left:${d * 14}px">
        <span class="caret${S.expanded.has(n) ? ' open' : ''}">${n.c?.length ? '▶' : ''}</span>
        <i class="ico ${ico}" ${style}></i><span title="${esc(n.p || n.n)}">${esc(name)}</span>
        ${n.d ? '<span class="denied" title="Accès refusé">⚠</span>' : ''}
      </div>
      <div class="sizecell num">${fmtSize(n.s)}<div class="bar" style="width:60px"><i style="width:${parentSize ? (n.s / parentSize) * 100 : 0}%"></i></div></div>
      <span class="num"><small>${n.c ? nf.format(n.f ?? n.x) : n.x ? nf.format(n.x) : ''}</small></span>
    </div>`;
  }
  $('treeInner').innerHTML = html;
}
$('tree').addEventListener('scroll', () => requestAnimationFrame(renderTree));

function toggle(n) {
  if (!n.c?.length) return;
  S.expanded.has(n) ? S.expanded.delete(n) : S.expanded.add(n);
  buildRows();
}
$('treeInner').addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const [n] = rows[row.dataset.i];
  if (e.target.classList.contains('caret')) toggle(n);
  else select(n, false);
});
$('treeInner').addEventListener('dblclick', (e) => {
  const row = e.target.closest('.row');
  if (row) zoom(rows[row.dataset.i][0]);
});

// ---------- Selection ----------
function select(n, fromMap) {
  S.selected = n;
  for (let p = n.parent; p; p = p.parent) S.expanded.add(p); // reveal in tree
  buildRows();
  if (fromMap) {
    const i = rows.findIndex((r) => r[0] === n);
    const el = $('tree');
    if (i * ROW < el.scrollTop || (i + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = i * ROW - el.clientHeight / 2;
  }
  showInfo(n);
  drawOverlay();
}

function showInfo(n) {
  const total = S.view.tree.s;
  $('selSwatch').style.background = isDir(n) ? 'linear-gradient(135deg,#8a9bff,#5b6cff)' : n.x ? '#4b5266' : colorOf(n).base;
  $('selName').textContent = n.n;
  $('selPath').textContent = n.p || 'Fichiers regroupés : zoomez sur le dossier parent pour les voir';
  $('selStats').innerHTML =
    `<div><b>${fmtSize(n.s)}</b><small>taille</small></div><div><b>${pct(n.s, total)}</b><small>de la vue</small></div>` +
    (n.c ? `<div><b>${nf.format(n.f)}</b><small>fichiers</small></div>` : '') +
    (n.m ? `<div><b>${df.format(n.m)}</b><small>modifié</small></div>` : '');
  const actionable = !!n.p;
  $('zoomBtn').disabled = !isDir(n) || n === S.view.tree;
  $('revealBtn').disabled = !actionable;
  $('trashBtn').disabled = !actionable || n.p === S.rootPath;
}

$('zoomBtn').onclick = () => zoom(S.selected);
$('upBtn').onclick = goUp;
$('revealBtn').onclick = () => api('/api/reveal', { path: S.selected.p }).catch((e) => toast(e.message));
$('trashBtn').onclick = async () => {
  const n = S.selected;
  if (!confirm(`Mettre « ${n.n} » (${fmtSize(n.s)}) à la corbeille ?`)) return;
  try {
    await api('/api/trash', { path: n.p });
    load(S.view.path === n.p ? n.parent.p : S.view.path);
  } catch (e) { toast(e.message); }
};

// ---------- Treemap ----------
const map = $('map'), overlay = $('overlay');
const ctx = map.getContext('2d'), octx = overlay.getContext('2d');
let rects = []; // drawn rectangles, parents before children
let W = 0, H = 0;

/** Squarified treemap (Bruls et al.): lays `items` (sorted desc) into the rect. */
function squarify(items, x, y, w, h, cb) {
  const total = items.reduce((a, n) => a + n.s, 0);
  if (total <= 0) return;
  const scale = (w * h) / total;
  let i = 0;
  while (i < items.length && w > 0 && h > 0) {
    const side = Math.min(w, h);
    const first = items[i].s * scale;
    let sum = 0, best = Infinity, j = i;
    while (j < items.length) {
      const a = items[j].s * scale;
      const s = sum + a;
      const worst = Math.max((side * side * first) / (s * s), (s * s) / (side * side * a));
      if (worst > best) break;
      best = worst; sum = s; j++;
    }
    const thick = sum / side;
    let off = 0;
    for (let k = i; k < j; k++) {
      const len = (items[k].s * scale) / thick;
      if (w >= h) cb(items[k], x, y + off, thick, len);
      else cb(items[k], x + off, y, len, thick);
      off += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    i = j;
  }
}

function drawMap() {
  if (!S.view) return;
  const dpr = window.devicePixelRatio || 1;
  const box = $('mapWrap').getBoundingClientRect();
  W = box.width; H = box.height;
  for (const c of [map, overlay]) { c.width = W * dpr; c.height = H * dpr; c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0); }
  rects = [];
  ctx.fillStyle = '#0e1117';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  drawNode(S.view.tree, 0, 0, W, H, 0);
  drawOverlay();
}

function drawNode(n, x, y, w, h, depth) {
  if (w < 0.5 || h < 0.5) return;
  rects.push({ n, x, y, w, h });
  if (!n.c) return drawLeaf(n, x, y, w, h);

  const kids = n.c.filter((k) => k.s > 0);
  if (w < 5 || h < 5 || !kids.length) {
    ctx.fillStyle = hsl(222, 14, 22);
    return ctx.fillRect(x, y, w, h);
  }
  // Folder frame with a header label when there is room
  const header = depth > 0 && w > 70 && h > 44 ? 17 : 0;
  ctx.fillStyle = hsl(225, 16, Math.min(9 + depth * 2.5, 22));
  ctx.fillRect(x, y, w, h);
  if (header) {
    ctx.font = '600 11px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(231,234,240,.85)';
    label(`${n.n}  ·  ${fmtSize(n.s)}`, x + 6, y + 9, w - 12);
  }
  const pad = depth === 0 ? 0 : w > 20 && h > 20 ? 2 : 1;
  squarify(kids, x + pad, y + pad + header, w - pad * 2, h - pad * 2 - header,
    (k, kx, ky, kw, kh) => drawNode(k, kx, ky, kw, kh, depth + 1));
}

function drawLeaf(n, x, y, w, h) {
  const dim = S.ext !== null && (n.x || n.e !== S.ext);
  ctx.globalAlpha = dim ? 0.12 : 1;
  if (n.x) { // aggregated small items: hatched
    ctx.fillStyle = hsl(222, 12, 26);
    ctx.fillRect(x, y, w, h);
  } else {
    const c = colorOf(n);
    const g = w > 4 && h > 4 ? 1 : 0;
    if (g) { // "cushion" shading, WinDirStat-like but softer
      const grad = ctx.createLinearGradient(x, y, x + w, y + h);
      grad.addColorStop(0, c.light);
      grad.addColorStop(0.55, c.base);
      grad.addColorStop(1, c.dark);
      ctx.fillStyle = grad;
    } else ctx.fillStyle = c.base;
    const inset = w > 3 && h > 3 ? 0.5 : 0;
    if (w > 10 && h > 10) {
      ctx.beginPath();
      ctx.roundRect(x + inset, y + inset, w - inset * 2, h - inset * 2, 3);
      ctx.fill();
    } else ctx.fillRect(x + inset, y + inset, w - inset * 2, h - inset * 2);
  }
  if (w > 64 && h > 28) {
    ctx.font = '600 12px -apple-system, system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 4;
    label(n.n, x + 6, y + 11, w - 12);
    if (h > 44) { ctx.font = '500 11px -apple-system, system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)'; label(fmtSize(n.s), x + 6, y + 25, w - 12); }
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

function label(text, x, y, maxW) {
  if (ctx.measureText(text).width > maxW) {
    while (text.length > 1 && ctx.measureText(`${text}…`).width > maxW) text = text.slice(0, -1);
    text += '…';
  }
  if (maxW > 14) ctx.fillText(text, x, y);
}

const rectOf = (n) => rects.find((r) => r.n === n);
function hit(px, py) {
  for (let i = rects.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return r;
  }
  return null;
}

function drawOverlay() {
  octx.clearRect(0, 0, W, H);
  const outline = (r, color, width) => {
    if (!r) return;
    octx.strokeStyle = color; octx.lineWidth = width;
    octx.strokeRect(r.x + width / 2, r.y + width / 2, Math.max(0, r.w - width), Math.max(0, r.h - width));
  };
  if (S.hover && S.hover.n.parent) outline(rectOf(S.hover.n.parent), 'rgba(255,255,255,.25)', 1);
  if (S.hover) {
    octx.fillStyle = 'rgba(255,255,255,.12)';
    octx.fillRect(S.hover.x, S.hover.y, S.hover.w, S.hover.h);
    outline(S.hover, 'rgba(255,255,255,.9)', 1.5);
  }
  if (S.selected && S.selected !== S.view?.tree) {
    const r = rectOf(S.selected);
    outline(r, '#3ee6c4', 2.5);
  }
}

overlay.addEventListener('mousemove', (e) => {
  const r = hit(e.offsetX, e.offsetY);
  if (r?.n !== S.hover?.n) { S.hover = r; drawOverlay(); }
  const tip = $('tooltip');
  if (!r) { tip.hidden = true; return; }
  const n = r.n;
  tip.innerHTML = `<b>${esc(n.n)}</b><div class="big">${fmtSize(n.s)}</div>
    <small>${pct(n.s, S.view.tree.s)} de la vue${n.c ? ` · ${nf.format(n.f)} fichiers` : ''}${n.m ? ` · ${df.format(n.m)}` : ''}</small>
    ${n.p ? `<small style="margin-top:4px">${esc(n.p)}</small>` : ''}`;
  tip.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  tip.style.left = `${Math.min(e.offsetX + 16, W - tw - 8)}px`;
  tip.style.top = `${e.offsetY + 16 + th > H ? e.offsetY - th - 12 : e.offsetY + 16}px`;
});
overlay.addEventListener('mouseleave', () => { S.hover = null; $('tooltip').hidden = true; drawOverlay(); });
overlay.addEventListener('click', (e) => { const r = hit(e.offsetX, e.offsetY); if (r) select(r.n, true); });
overlay.addEventListener('dblclick', (e) => { const r = hit(e.offsetX, e.offsetY); if (r) zoom(r.n); });

let resizeRaf;
new ResizeObserver(() => { cancelAnimationFrame(resizeRaf); resizeRaf = requestAnimationFrame(drawMap); }).observe($('mapWrap'));

// ---------- Keyboard & scan form ----------
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || !S.view) return;
  if (e.key === 'Backspace' || e.key === 'Escape') { e.preventDefault(); goUp(); }
  if (e.key === 'Enter' && S.selected) zoom(S.selected);
});
$('scanForm').addEventListener('submit', (e) => { e.preventDefault(); startScan($('pathInput').value.trim() || S.rootPath); });
$('pickBtn').onclick = async () => {
  try {
    const { path } = await api('/api/pick', {});
    if (path) startScan(path);
  } catch (e) { toast(e.message); }
};

poll();
