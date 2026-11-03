/* ترافیک: استخراج وضعیت ترافیک از تایل‌های گوگل.
   روش: برای هر تایل، دو تصویر گرفته می‌شود (نقشه‌ی ساده و همان نقشه با ترافیک). پیکسل‌هایی که بین این دو فرق دارند
   فقط رنگ ترافیک هستند؛ سپس رنگ‌شان به چهار سطح (روان، کند، سنگین، بسیار سنگین) تبدیل می‌شود. */
(function (root) {
'use strict';
const FM = root.FM || (root.FM = {});
const Z = 15, TS = 256, TTL = 4 * 60 * 1000, MAX_TILES = 140;
const FACTOR = [1, 1, 0.65, 0.4, 0.22];            // ضریب سرعت برای سطح 0..4 (۰ = بدون اطلاعات)
const NAMES = ['بدون اطلاعات', 'روان', 'کند', 'سنگین', 'بسیار سنگین'], COLORS = ['#8a97a0', '#2fb36b', '#f2a900', '#e5372a', '#8b1a1a'];

function hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx];
}
// رنگ پیکسل ترافیک → سطح 1..4 (۰ یعنی ترافیک نیست)
function classifyPixel(r, g, b) {
  const [h, s, v] = hsv(r, g, b);
  if (s < 0.33 || v < 0.3) return 0;
  if (h >= 75 && h <= 170) return 1;
  if (h >= 18 && h < 75) return 2;
  if (h < 18 || h >= 335) return v < 0.62 ? 4 : 3;
  return 0;
}
// A و B: داده‌ی RGBA دو تصویر هم‌اندازه (بدون ترافیک / با ترافیک)
function diffLevels(A, B, w, h) {
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < out.length; p++, i += 4) {
    if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) < 70) continue;
    out[p] = classifyPixel(B[i], B[i + 1], B[i + 2]);
  }
  return out;
}

/* ───────────── تایل‌ها ───────────── */
const lru = new Map();
function lruPut(k, v) { lru.delete(k); lru.set(k, v); while (lru.size > 420) lru.delete(lru.keys().next().value); }
function tileXY(lat, lng, z) {
  const n = Math.pow(2, z), x = (lng + 180) / 360 * n, s = Math.sin(lat * Math.PI / 180), y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n;
  return { x: Math.floor(x), y: Math.floor(y), px: Math.floor((x - Math.floor(x)) * TS), py: Math.floor((y - Math.floor(y)) * TS) };
}
const urlOf = (traffic, z, x, y) => `https://mt1.google.com/vt?lyrs=${traffic ? 'm,traffic' : 'm'}&hl=en&x=${x}&y=${y}&z=${z}`;
async function decode(buf, type) {
  const blob = new Blob([buf], { type }), bmp = await createImageBitmap(blob);
  const cv = root.OffscreenCanvas ? new OffscreenCanvas(TS, TS) : Object.assign(document.createElement('canvas'), { width: TS, height: TS });
  const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, TS, TS); return ctx.getImageData(0, 0, TS, TS).data;
}
async function loadTile(z, x, y) {
  const k = `${z}/${x}/${y}`, hit = lru.get(k);
  if (hit && Date.now() - hit.t < TTL) return hit.levels;
  const ck = 'trf/' + k, cached = await FM.tiles.TileCache.get(ck);
  if (cached && Date.now() - cached.ts < TTL && cached.buf.byteLength === TS * TS) { const lv = new Uint8Array(cached.buf); lruPut(k, { t: cached.ts, levels: lv }); return lv; }
  try {
    const [a, b] = await Promise.all([FM.tiles.fetchNative({ id: 'gtraffic-base' }, urlOf(false, z, x, y)), FM.tiles.fetchNative({ id: 'gtraffic' }, urlOf(true, z, x, y))]);
    if (a.direct || b.direct) return null;
    const [da, db] = await Promise.all([decode(a.buf, a.type), decode(b.buf, b.type)]);
    const lv = diffLevels(da, db, TS, TS); lruPut(k, { t: Date.now(), levels: lv });
    FM.tiles.TileCache.put(ck, lv.buffer.slice(0), 'application/x-traffic'); return lv;
  } catch (e) { lruPut(k, { t: Date.now() - TTL + 30000, levels: null }); return null; }
}
async function pool(items, n, fn) { let i = 0; const run = async () => { while (i < items.length) { const it = items[i++]; await fn(it); } }; await Promise.all(Array.from({ length: n }, run)); }
// آماده‌سازی تایل‌های یک محدوده (bounds: {s,w,n,e})؛ پیش از پرسش‌های هم‌زمان levelAt
async function prepare(b, onProgress) {
  const a = tileXY(b.n, b.w, Z), c = tileXY(b.s, b.e, Z), list = [];
  for (let x = a.x; x <= c.x; x++) for (let y = a.y; y <= c.y; y++) list.push([x, y]);
  if (list.length > MAX_TILES) return { ok: false, tiles: list.length, reason: 'محدوده بزرگ است' };
  let done = 0, good = 0; await pool(list, 6, async ([x, y]) => { const lv = await loadTile(Z, x, y); if (lv) good++; done++; if (onProgress) onProgress(done, list.length); });
  return { ok: good > 0, tiles: list.length, loaded: good };
}
// تایل‌های اطراف یک یا چند خط‌مسیر (برای مسیرهای بلند که مستطیلشان خیلی بزرگ می‌شود)
async function prepareAlong(lines, onProgress) {
  const set = new Map();
  for (const coords of lines) {
    let prev = null;
    for (const c of coords) {
      const steps = prev ? Math.max(1, Math.ceil(hav(prev, c) / 300)) : 1;
      for (let k = 1; k <= steps; k++) {
        const la = prev ? prev[0] + (c[0] - prev[0]) * k / steps : c[0], lo = prev ? prev[1] + (c[1] - prev[1]) * k / steps : c[1], t = tileXY(la, lo, Z);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) set.set(`${t.x + dx}/${t.y + dy}`, [t.x + dx, t.y + dy]);
      }
      prev = c;
    }
  }
  const list = [...set.values()]; if (list.length > 220) return { ok: false, tiles: list.length, reason: 'مسیر خیلی بلند است' };
  let done = 0, good = 0; await pool(list, 6, async ([x, y]) => { const lv = await loadTile(Z, x, y); if (lv) good++; done++; if (onProgress) onProgress(done, list.length); });
  return { ok: good > 0, tiles: list.length, loaded: good };
}
function levelAt(lat, lng, radius) {
  const t = tileXY(lat, lng, Z), hit = lru.get(`${Z}/${t.x}/${t.y}`); if (!hit || !hit.levels) return 0;
  const r = radius == null ? 3 : radius; let best = 0;
  for (let dy = -r; dy <= r; dy++) { const yy = t.py + dy; if (yy < 0 || yy >= TS) continue; for (let dx = -r; dx <= r; dx++) { const xx = t.px + dx; if (xx < 0 || xx >= TS) continue; const l = hit.levels[yy * TS + xx]; if (l > best) best = l; } }
  return best;
}
const factorAt = (lat, lng) => FACTOR[levelAt(lat, lng)];
function available(lat, lng) { const t = tileXY(lat, lng, Z), hit = lru.get(`${Z}/${t.x}/${t.y}`); return !!(hit && hit.levels); }

/* ───────────── امتیازدهی یک مسیر ───────────── */
const hav = (a, b) => FM.haversine ? FM.haversine({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }) : 0;
function scoreRoute(coords, baseDuration, adjust) {
  const samples = []; let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i], d = hav(a, b); if (d < 1) continue;
    const n = Math.max(1, Math.round(d / 90));
    for (let k = 0; k < n; k++) { const t0 = k / n, t1 = (k + 1) / n, m = (k + 0.5) / n; samples.push({ a: [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], b: [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1], len: d / n, level: levelAt(a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m) }); total += d / n; }
  }
  if (!samples.length) return { segments: [], est: baseDuration, delay: 0, covered: 0, jam: 0 };
  const segments = []; let cur = null, est = 0, known = 0, jam = 0;
  for (const s of samples) {
    if (!cur || cur.level !== s.level) { cur = { level: s.level, coords: [s.a], len: 0 }; segments.push(cur); }
    cur.coords.push(s.b); cur.len += s.len;
    est += (baseDuration * s.len / total) / FACTOR[s.level]; if (s.level > 0) known += s.len; if (s.level >= 3) jam += s.len;
  }
  return { segments, est: adjust === false ? baseDuration : est, delay: adjust === false ? 0 : est - baseDuration, covered: known / total, jam, total };
}
function summary(score) {
  const by = [0, 0, 0, 0, 0]; (score.segments || []).forEach((s) => { by[s.level] += s.len; });
  const tot = by.reduce((a, b) => a + b, 0) || 1; return by.map((v) => v / tot);
}
FM.traffic = { prepare, prepareAlong, levelAt, factorAt, available, scoreRoute, summary, COLORS, NAMES, FACTOR, _t: { classifyPixel, diffLevels, tileXY, urlOf, lru } };
})(typeof window !== 'undefined' ? window : globalThis);
