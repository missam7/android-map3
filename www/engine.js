/* موتور مسیریابی داخلی: گراف جاده از OpenStreetMap (Overpass)، ذخیره‌ی آفلاین در گوشی،
   الگوریتم A* با مسیرهای جایگزین، «کوتاه‌ترین» و «سریع‌ترین»، وزن‌دهی ترافیک و دستورهای پیچ. */
(function (root) {
'use strict';
const FM = root.FM || (root.FM = {});
const RAD = Math.PI / 180, R_EARTH = 6371008.8;
const hav = (la1, lo1, la2, lo2) => { const dLa = (la2 - la1) * RAD, dLo = (lo2 - lo1) * RAD; const a = Math.sin(dLa / 2) ** 2 + Math.cos(la1 * RAD) * Math.cos(la2 * RAD) * Math.sin(dLo / 2) ** 2; return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(a))); };
const brg = (la1, lo1, la2, lo2) => { const y = Math.sin((lo2 - lo1) * RAD) * Math.cos(la2 * RAD); const x = Math.cos(la1 * RAD) * Math.sin(la2 * RAD) - Math.sin(la1 * RAD) * Math.cos(la2 * RAD) * Math.cos((lo2 - lo1) * RAD); return (Math.atan2(y, x) / RAD + 360) % 360; };

/* ───────────── صف اولویت ───────────── */
class Heap {
  constructor() { this.k = []; this.v = []; this.lastK = 0; }
  get size() { return this.k.length; }
  push(key, val) {
    let i = this.k.length; this.k.push(key); this.v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (this.k[p] <= key) break; this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p; }
    this.k[i] = key; this.v[i] = val;
  }
  pop() {
    const topK = this.k[0], topV = this.v[0], lastK = this.k.pop(), lastV = this.v.pop(), n = this.k.length;
    if (n > 0) {
      let i = 0;
      for (;;) { const l = 2 * i + 1; if (l >= n) break; const r = l + 1, m = (r < n && this.k[r] < this.k[l]) ? r : l; if (this.k[m] >= lastK) break; this.k[i] = this.k[m]; this.v[i] = this.v[m]; i = m; }
      this.k[i] = lastK; this.v[i] = lastV;
    }
    this.lastK = topK; return topV;
  }
}

/* ───────────── سرعت و جهت یک‌طرفه ───────────── */
const SPEED = { motorway: 90, motorway_link: 55, trunk: 70, trunk_link: 50, primary: 55, primary_link: 40, secondary: 48, secondary_link: 38, tertiary: 42, tertiary_link: 35, unclassified: 35, residential: 30, living_street: 12, service: 18, road: 25 };
const MAJOR = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link']);
function parseMaxspeed(v) {
  if (v == null) return null; const s = String(v).toLowerCase();
  if (/walk/.test(s)) return 7; const m = /(\d+(?:\.\d+)?)/.exec(s); if (!m) return null;
  let n = parseFloat(m[1]); if (/mph/.test(s)) n *= 1.609; return n > 0 ? n : null;
}
function speedKmh(tags) { const base = SPEED[tags.highway] || 25, ms = parseMaxspeed(tags.maxspeed); return ms ? Math.max(8, Math.min(ms * 0.85, 120)) : base; }
function onewayDir(tags) {
  const o = tags.oneway;
  if (o === '-1' || o === 'reverse') return -1; if (o === 'yes' || o === 'true' || o === '1') return 1; if (o === 'no' || o === 'false' || o === '0') return 0;
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return 1;
  if (tags.highway === 'motorway' || tags.highway === 'motorway_link') return 1;
  return 0;
}

/* ───────────── ساخت گراف (CSR) ───────────── */
// way: { id, n:[شناسه‌ی گره‌ها], g:[lat0,lon0,lat1,lon1,…], t:{برچسب‌ها} }
function buildGraph(ways) {
  const idMap = new Map(), lat = [], lng = [], meta = [];
  const eFrom = [], eTo = [], eLen = [], eTime = [], eWay = [];
  let vmax = 10;
  const seen = new Set();
  for (const w of ways) {
    if (seen.has(w.id)) continue; seen.add(w.id);
    const t = w.t || {}, n = w.n, g = w.g; if (!n || n.length < 2) continue;
    const dir = onewayDir(t), sp = speedKmh(t) / 3.6; if (sp > vmax) vmax = sp;
    const wi = meta.length; meta.push({ name: t['name:fa'] || t.name || '', ref: t.ref || '', hw: t.highway, rb: t.junction === 'roundabout' || t.junction === 'circular', id: w.id });
    const idx = new Array(n.length);
    for (let i = 0; i < n.length; i++) {
      let k = idMap.get(n[i]);
      if (k === undefined) { k = lat.length; idMap.set(n[i], k); lat.push(g[2 * i]); lng.push(g[2 * i + 1]); }
      idx[i] = k;
    }
    for (let i = 0; i + 1 < idx.length; i++) {
      const a = idx[i], b = idx[i + 1]; if (a === b) continue;
      const len = hav(lat[a], lng[a], lat[b], lng[b]), tm = len / sp;
      if (dir >= 0) { eFrom.push(a); eTo.push(b); eLen.push(len); eTime.push(tm); eWay.push(wi); }
      if (dir <= 0) { eFrom.push(b); eTo.push(a); eLen.push(len); eTime.push(tm); eWay.push(wi); }
    }
  }
  const N = lat.length, E = eFrom.length, head = new Int32Array(N + 1);
  for (let i = 0; i < E; i++) head[eFrom[i] + 1]++;
  for (let i = 0; i < N; i++) head[i + 1] += head[i];
  const fill = head.slice(0, N), to = new Int32Array(E), from = new Int32Array(E), len = new Float32Array(E), time = new Float32Array(E), way = new Int32Array(E);
  for (let i = 0; i < E; i++) { const p = fill[eFrom[i]]++; to[p] = eTo[i]; from[p] = eFrom[i]; len[p] = eLen[i]; time[p] = eTime[i]; way[p] = eWay[i]; }
  const G = { N, E, lat: Float64Array.from(lat), lng: Float64Array.from(lng), head, to, from, len, time, way, meta, vmax, grid: null };
  buildGrid(G); return G;
}
const GCELL = 0.002;
function buildGrid(G) {
  const grid = new Map();
  for (let i = 0; i < G.N; i++) { const k = Math.floor(G.lat[i] / GCELL) + ':' + Math.floor(G.lng[i] / GCELL); let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(i); }
  G.grid = grid;
}

/* نزدیک‌ترین قطعه‌ی جاده به یک نقطه (با ساخت گره‌ی مجازی) */
function snap(G, la, lo, maxM) {
  const kx = Math.cos(la * RAD) * 111320, ky = 110540;
  const cx = Math.floor(la / GCELL), cy = Math.floor(lo / GCELL);
  let best = null;
  for (let ring = 1; ring <= 6; ring++) {
    for (let ix = cx - ring; ix <= cx + ring; ix++) {
      for (let iy = cy - ring; iy <= cy + ring; iy++) {
        if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy)) !== ring && ring > 1) continue;
        const arr = G.grid.get(ix + ':' + iy); if (!arr) continue;
        for (const u of arr) {
          for (let e = G.head[u]; e < G.head[u + 1]; e++) {
            const v = G.to[e];
            const ax = (G.lng[u] - lo) * kx, ay = (G.lat[u] - la) * ky, bx = (G.lng[v] - lo) * kx, by = (G.lat[v] - la) * ky;
            const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
            const d = Math.hypot(ax + t * dx, ay + t * dy);
            if (!best || d < best.dist) best = { dist: d, u, v, t, e };
          }
        }
      }
    }
    if (best && best.dist < ring * GCELL * 90000 * 0.6) break; // نزدیک‌تر از حلقه‌ی بعدی: کافی است
  }
  if (!best || best.dist > (maxM || 600)) return null;
  const { u, v, t, e } = best;
  let er = -1; for (let k = G.head[v]; k < G.head[v + 1]; k++) if (G.to[k] === u && G.way[k] === G.way[e]) { er = k; break; }
  return { u, v, t, e, er, dist: best.dist, lat: G.lat[u] + (G.lat[v] - G.lat[u]) * t, lng: G.lng[u] + (G.lng[v] - G.lng[u]) * t };
}
function startOptions(G, s) { // از نقطه‌ی مجازی به کدام گره‌ها می‌شود رفت
  const out = [];
  if (s.t < 1e-6) out.push({ to: s.u, cost: 0, len: 0, e: s.e, frac: 0 });       // دقیقاً روی گره: همه‌ی مسیرهای خروجی آزاد است
  if (s.t > 1 - 1e-6) out.push({ to: s.v, cost: 0, len: 0, e: s.e, frac: 1 });
  if (s.e >= 0) out.push({ to: s.v, cost: (1 - s.t) * G.time[s.e], len: (1 - s.t) * G.len[s.e], e: s.e, frac: 1 - s.t });
  if (s.er >= 0) out.push({ to: s.u, cost: s.t * G.time[s.er], len: s.t * G.len[s.er], e: s.er, frac: s.t });
  return out;
}
function endOptions(G, s) { // از کدام گره‌ها می‌شود به نقطه‌ی مجازی رسید
  const m = new Map();
  if (s.t < 1e-6) m.set(s.u, { cost: 0, len: 0, e: s.e, frac: 0 });
  if (s.t > 1 - 1e-6) m.set(s.v, { cost: 0, len: 0, e: s.e, frac: 1 });
  if (m.size) return m;
  if (s.e >= 0) m.set(s.u, { cost: s.t * G.time[s.e], len: s.t * G.len[s.e], e: s.e, frac: s.t });
  if (s.er >= 0) { const c = { cost: (1 - s.t) * G.time[s.er], len: (1 - s.t) * G.len[s.er], e: s.er, frac: 1 - s.t }; if (!m.has(s.v) || c.cost < m.get(s.v).cost) m.set(s.v, c); }
  return m;
}

/* ───────────── A* ───────────── */
function astar(G, S, E, mode, mult) {
  const N = G.N, target = N, g = new Float64Array(N + 1).fill(Infinity), prev = new Int32Array(N + 1).fill(-1), prevE = new Int32Array(N + 1).fill(-1), closed = new Uint8Array(N + 1);
  const so = startOptions(G, S), eo = endOptions(G, E);
  if (!so.length || !eo.size) return null;
  const vmax = G.vmax, dlat = E.lat, dlng = E.lng;
  const h = mode === 't' ? (u) => hav(G.lat[u], G.lng[u], dlat, dlng) / vmax : (u) => hav(G.lat[u], G.lng[u], dlat, dlng);
  const heap = new Heap(), startVia = new Map();
  for (const o of so) { const c = mode === 't' ? o.cost : o.len; if (c < g[o.to]) { g[o.to] = c; prev[o.to] = -2; startVia.set(o.to, o); heap.push(c + h(o.to), o.to); } }
  while (heap.size) {
    const u = heap.pop();
    if (closed[u]) continue; closed[u] = 1;
    if (u === target) break;
    const eIn = eo.get(u);
    if (eIn) { const c = g[u] + (mode === 't' ? eIn.cost * (mult ? mult[eIn.e] : 1) : eIn.len); if (c < g[target]) { g[target] = c; prev[target] = u; heap.push(c, target); } }
    for (let e = G.head[u]; e < G.head[u + 1]; e++) {
      const v = G.to[e]; if (closed[v]) continue;
      const c = mode === 't' ? G.time[e] * (mult ? mult[e] : 1) : G.len[e], nd = g[u] + c;
      if (nd < g[v]) { g[v] = nd; prev[v] = u; prevE[v] = e; heap.push(nd + h(v), v); }
    }
  }
  if (!isFinite(g[target])) return null;
  // بازسازی مسیر
  const nodes = [], edges = []; let u = prev[target]; const endOpt = eo.get(u);
  for (;;) { nodes.push(u); if (prev[u] === -2) break; edges.push(prevE[u]); u = prev[u]; }
  nodes.reverse(); edges.reverse();
  const sv = startVia.get(nodes[0]);
  let dist = sv.len + endOpt.len, time = sv.cost + endOpt.cost;
  for (const e of edges) { dist += G.len[e]; time += G.time[e]; }
  return { nodes, edges, sv, ev: endOpt, dist, time, S, E };
}

/* ───────────── مسیرهای جایگزین ───────────── */
function overlapRatio(G, a, b) {
  const set = new Set(a.edges); let shared = 0;
  for (const e of b.edges) if (set.has(e)) shared += G.len[e];
  return shared / Math.max(1, Math.min(a.dist - 1, b.dist - 1));
}
function findRoutes(G, S, E, mult0) {
  const out = [], mult = new Float32Array(G.E).fill(1);
  if (mult0) for (let i = 0; i < G.E; i++) mult[i] = mult0[i];
  const fastest = astar(G, S, E, 't', mult); if (!fastest) return [];
  fastest.label = 'fast'; out.push(fastest);
  const pen = new Float32Array(mult); let cur = fastest;
  for (let it = 0; it < 4 && out.length < 3; it++) {
    for (const e of cur.edges) pen[e] = Math.min(pen[e] * 1.8, 40);
    const alt = astar(G, S, E, 't', pen); if (!alt) break; cur = alt;
    const tooSimilar = out.some((r) => overlapRatio(G, r, alt) > 0.75);
    if (!tooSimilar && alt.time <= fastest.time * 1.9) { alt.label = 'alt'; out.push(alt); }
  }
  const shortest = astar(G, S, E, 'd', null);
  if (shortest && !out.some((r) => overlapRatio(G, r, shortest) > 0.97)) { shortest.label = 'short'; out.push(shortest); }
  return out;
}

/* ───────────── خروجی: خط مسیر و دستورها ───────────── */
function legsOf(G, r) {
  const legs = [], { nodes, edges, S, E } = r;
  const nm = (e) => G.meta[G.way[e]];
  legs.push({ a: [S.lat, S.lng], b: [G.lat[nodes[0]], G.lng[nodes[0]]], way: G.way[r.sv.e], len: r.sv.len, from: -1, to: nodes[0] });
  for (let i = 0; i < edges.length; i++) { const e = edges[i], u = G.from[e], v = G.to[e]; legs.push({ a: [G.lat[u], G.lng[u]], b: [G.lat[v], G.lng[v]], way: G.way[e], len: G.len[e], from: u, to: v }); }
  const last = nodes[nodes.length - 1];
  legs.push({ a: [G.lat[last], G.lng[last]], b: [E.lat, E.lng], way: G.way[r.ev.e], len: r.ev.len, from: last, to: -1 });
  return legs.filter((l) => l.len > 0.01 || l === legs[0]);
}
const angDiff = (a, b) => ((b - a + 540) % 360) - 180;
function makeSteps(G, r) {
  const legs = legsOf(G, r), meta = (l) => G.meta[l.way];
  const outOther = (node, fromNode) => { let n = 0; for (let e = G.head[node]; e < G.head[node + 1]; e++) if (G.to[e] !== fromNode) n++; return n; };
  const steps = []; let acc = 0, startIdx = 0;
  const nameOf = (l) => meta(l).name || meta(l).ref || '';
  steps.push({ type: 'depart', mod: '', name: nameOf(legs[0]), dist: 0, loc: legs[0].a });
  let i = 0;
  while (i < legs.length - 1) {
    const l = legs[i], nx = legs[i + 1], node = l.to; acc += l.len;
    const rbCur = meta(l).rb, rbNext = meta(nx).rb;
    let emitted = null;
    if (!rbCur && rbNext) { // ورود به میدان: شمردن خروجی‌ها
      let j = i + 1, exits = 0;
      while (j < legs.length && meta(legs[j]).rb) { const nd = legs[j].to; if (nd >= 0) { let hasOut = false; for (let e = G.head[nd]; e < G.head[nd + 1]; e++) if (!G.meta[G.way[e]].rb) { hasOut = true; break; } if (hasOut) exits++; } j++; }
      emitted = { type: 'roundabout', mod: '', exit: Math.max(1, exits), name: legs[Math.min(j, legs.length - 1)] ? nameOf(legs[Math.min(j, legs.length - 1)]) : '', loc: l.b };
      steps[steps.length - 1].dist = acc - startIdx; startIdx = acc; steps.push(emitted);
      for (let q = i + 1; q < j; q++) acc += legs[q].len; i = j; continue;
    }
    const a1 = brg(l.a[0], l.a[1], l.b[0], l.b[1]), a2 = brg(nx.a[0], nx.a[1], nx.b[0], nx.b[1]), ang = angDiff(a1, a2), abs = Math.abs(ang);
    const changed = nx.way !== l.way, nameChanged = nameOf(l) !== nameOf(nx);
    const junction = node >= 0 && outOther(node, l.from) >= 2;
    if (abs >= 28 && (junction || changed)) {
      const side = ang < 0 ? 'left' : 'right';
      const mod = abs > 160 ? 'uturn' : abs > 115 ? 'sharp ' + side : abs > 55 ? side : 'slight ' + side;
      steps[steps.length - 1].dist = acc - startIdx; startIdx = acc; steps.push({ type: 'turn', mod, name: nameOf(nx), dist: 0, loc: l.b });
    } else if (changed && nameChanged && junction && nameOf(nx)) {
      steps[steps.length - 1].dist = acc - startIdx; startIdx = acc; steps.push({ type: 'new name', mod: 'straight', name: nameOf(nx), dist: 0, loc: l.b });
    }
    i++;
  }
  acc += legs[legs.length - 1].len;
  steps[steps.length - 1].dist = acc - startIdx;
  steps.push({ type: 'arrive', mod: '', name: '', dist: 0, loc: legs[legs.length - 1].b });
  return steps;
}
function toRoute(G, r) {
  const coords = [[r.S.lat, r.S.lng]];
  for (const n of r.nodes) coords.push([G.lat[n], G.lng[n]]);
  coords.push([r.E.lat, r.E.lng]);
  return { coords, distance: r.dist, duration: r.time, steps: makeSteps(G, r), provider: 'own', label: r.label, wayIds: null };
}

/* ───────────── کش جاده‌ها در IndexedDB + Overpass ───────────── */
const CELL = 0.05, OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const CLASSES_M = 'motorway|trunk|primary|secondary|tertiary|unclassified|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const CLASSES_F = CLASSES_M + '|residential|living_street|service|road';
const Store = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { if (!root.indexedDB) return rej(new Error('no idb')); const r = indexedDB.open('fieldmap-roads', 1); r.onupgradeneeded = () => r.result.createObjectStore('cells', { keyPath: 'k' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    async get(k) { try { return await rq((await open()).transaction('cells').objectStore('cells').get(k)); } catch (e) { return null; } },
    async put(rec) { try { await rq((await open()).transaction('cells', 'readwrite').objectStore('cells').put(rec)); } catch (e) { /* ignore */ } },
    async count() { try { return await rq((await open()).transaction('cells').objectStore('cells').count()); } catch (e) { return 0; } },
    async clear() { try { await rq((await open()).transaction('cells', 'readwrite').objectStore('cells').clear()); } catch (e) { /* ignore */ } }
  };
})();
function overpassQuery(cx, cy, tier) {
  const s = cx * CELL, w = cy * CELL, n = (cx + 1) * CELL, e = (cy + 1) * CELL, cls = tier === 'M' ? CLASSES_M : CLASSES_F;
  return `[out:json][timeout:120];way["highway"~"^(${cls})$"]["access"!~"^(no|private)$"]["motor_vehicle"!~"^(no|private)$"]["service"!~"^(parking_aisle|driveway|emergency_access|drive-through)$"](${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)});out tags geom;`;
}
function parseOverpass(j) {
  const ways = [];
  for (const el of (j && j.elements) || []) {
    if (el.type !== 'way' || !el.geometry || !el.nodes || el.geometry.length !== el.nodes.length) continue;
    const g = new Array(el.geometry.length * 2);
    el.geometry.forEach((p, i) => { g[2 * i] = p.lat; g[2 * i + 1] = p.lon; });
    const t = el.tags || {}, keep = { highway: t.highway };
    ['name', 'name:fa', 'ref', 'oneway', 'junction', 'maxspeed'].forEach((k) => { if (t[k] !== undefined) keep[k] = t[k]; });
    ways.push({ id: el.id, n: el.nodes, g, t: keep });
  }
  return ways;
}
async function fetchCell(cx, cy, tier) {
  const Http = root.Lib && root.Lib.Http; if (!Http) throw new Error('لایه‌ی شبکه‌ی بومی در دسترس نیست');
  const body = 'data=' + encodeURIComponent(overpassQuery(cx, cy, tier)); let lastErr = null;
  for (const url of OVERPASS) {
    try {
      const r = await Http.post({ url, headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, data: body, responseType: 'json', connectTimeout: 20000, readTimeout: 120000 });
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const j = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      if (!j || !Array.isArray(j.elements)) throw new Error('پاسخ نامعتبر');
      return parseOverpass(j);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('بدون پاسخ از سرور نقشه‌ی جاده');
}
async function getCell(cx, cy, tier, onStatus, offlineOnly) {
  const k = `${cx}:${cy}`; let rec = await Store.get(k);
  const ok = rec && (tier === 'M' || rec.tier === 'F') && (Date.now() - rec.ts < 120 * 864e5);
  if (ok) return rec.ways;
  if (offlineOnly) { if (rec) return rec.ways; throw new Error('داده‌ی جاده‌ی این محدوده روی گوشی ذخیره نیست'); }
  try {
    if (onStatus) onStatus(`دریافت جاده‌های محدوده (${cx},${cy})…`);
    const ways = await fetchCell(cx, cy, tier);
    await Store.put({ k, tier, ways, ts: Date.now() }); return ways;
  } catch (e) { if (rec) return rec.ways; throw e; }
}
const cellOf = (la, lo) => [Math.floor(la / CELL), Math.floor(lo / CELL)];
function corridor(o, d) {
  const dLat = Math.abs(o.lat - d.lat), dLng = Math.abs(o.lng - d.lng), span = Math.max(dLat, dLng);
  const margin = Math.max(0.02, Math.min(0.3, span * 0.25));
  const s = Math.min(o.lat, d.lat) - margin, n = Math.max(o.lat, d.lat) + margin, w = Math.min(o.lng, d.lng) - margin, e = Math.max(o.lng, d.lng) + margin;
  return { s, n, w, e, span };
}
function plannedCells(o, d) {
  const c = corridor(o, d), [cx0, cy0] = cellOf(c.s, c.w), [cx1, cy1] = cellOf(c.n, c.e), list = [];
  for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
    const cla = (cx + 0.5) * CELL, clo = (cy + 0.5) * CELL;
    const near = Math.min(hav(cla, clo, o.lat, o.lng), hav(cla, clo, d.lat, d.lng)) < 7000 || c.span < 0.15;
    list.push({ cx, cy, tier: near ? 'F' : 'M' });
  }
  return { list, span: c.span };
}
let lastGraph = { key: '', G: null };
async function loadGraph(o, d, onStatus, offlineOnly) {
  const { list, span } = plannedCells(o, d);
  if (span > 0.9) throw new Error('فاصله برای موتور داخلی زیاد است (بیش از حدود ۹۰ کیلومتر).');
  if (list.length > 90) throw new Error('محدوده‌ی مسیر برای موتور داخلی بزرگ است.');
  const key = list.map((c) => c.cx + ':' + c.cy + c.tier).join(',');
  if (lastGraph.key === key && lastGraph.G) return lastGraph.G;
  const ways = [];
  for (let i = 0; i < list.length; i++) { const c = list[i]; if (onStatus) onStatus(`جاده‌ها ${i + 1}/${list.length}…`); const w = await getCell(c.cx, c.cy, c.tier, onStatus, offlineOnly); for (const x of w) ways.push(x); }
  if (onStatus) onStatus('ساخت گراف جاده…');
  const G = buildGraph(ways); lastGraph = { key, G }; return G;
}
// ضریب ترافیک روی یال‌های مهم (یال‌های محلی بدون اطلاعات ترافیک ضریب ۱ می‌گیرند)
function trafficMult(G, factorAt) {
  const mult = new Float32Array(G.E).fill(1);
  if (!factorAt) return mult;
  for (let e = 0; e < G.E; e++) {
    if (!MAJOR.has(G.meta[G.way[e]].hw)) continue;
    const u = G.from[e], v = G.to[e], f = factorAt((G.lat[u] + G.lat[v]) / 2, (G.lng[u] + G.lng[v]) / 2);
    if (f > 0 && f < 1) mult[e] = 1 / f;
  }
  return mult;
}
async function route(o, d, opts) {
  opts = opts || {}; const status = opts.onStatus || (() => {});
  const G = await loadGraph(o, d, status, !!opts.offlineOnly);
  status('پیدا کردن نزدیک‌ترین جاده…');
  const S = snap(G, o.lat, o.lng), E = snap(G, d.lat, d.lng);
  if (!S) throw new Error('مبدا به جاده‌ی شناخته‌شده نزدیک نیست (بیش از ۶۰۰ متر).');
  if (!E) throw new Error('مقصد به جاده‌ی شناخته‌شده نزدیک نیست (بیش از ۶۰۰ متر).');
  status('محاسبه‌ی مسیر…');
  const mult = trafficMult(G, opts.factorAt);
  const rs = findRoutes(G, S, E, mult);
  if (!rs.length) throw new Error('بین این دو نقطه مسیری در داده‌ی جاده پیدا نشد (ممکن است جاده‌ها یک‌طرفه یا ناقص باشند).');
  return rs.map((r) => { const x = toRoute(G, r); x.trafficAdjusted = !!opts.factorAt; x.staticDuration = x.trafficAdjusted ? computeStatic(G, r) : undefined; return x; });
}
function computeStatic(G, r) { let t = r.sv.cost + r.ev.cost; for (const e of r.edges) t += G.time[e]; return t; }
async function downloadArea(b, onProgress) {
  const [cx0, cy0] = cellOf(b.getSouth(), b.getWest()), [cx1, cy1] = cellOf(b.getNorth(), b.getEast());
  const total = (cx1 - cx0 + 1) * (cy1 - cy0 + 1); if (total > 30) throw new Error(`محدوده بزرگ است (${total} بلوک). نقشه را کمی بزرگ‌نمایی کنید (حداکثر ۳۰ بلوک ≈ ۱۵۰۰ کیلومترمربع).`);
  let n = 0; for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) { await getCell(cx, cy, 'F', null, false); n++; if (onProgress) onProgress(n, total); }
  return total;
}
FM.engine = { route, downloadArea, cacheCount: () => Store.count(), clearCache: async () => { lastGraph = { key: '', G: null }; await Store.clear(); }, _t: { buildGraph, snap, astar, findRoutes, makeSteps, toRoute, parseOverpass, overpassQuery, plannedCells, trafficMult, speedKmh, onewayDir, parseMaxspeed, Heap, hav } };
})(typeof window !== 'undefined' ? window : globalThis);
