/* تشخیص خودکار مرزهای اداری یک نقطه (روی خود گوشی و بدون اینترنت):
   استان، شهرستان، بخش، منطقه/ناحیه‌ی شهرداری، ناحیه‌ی ثبتی و پلاک ثبتی.
   منابع: استان‌های داخل برنامه، لایه‌های WFS شهرداری (پس از اولین دریافت ذخیره می‌شوند) و بسته‌های مرزی واردشده توسط کاربر. */
(function (root) {
'use strict';
const FM = root.FM || (root.FM = {});
const CATS = [
  { id: 'province', label: 'استان' }, { id: 'county', label: 'شهرستان' }, { id: 'bakhsh', label: 'بخش' },
  { id: 'muni_region', label: 'منطقه‌ی شهرداری' }, { id: 'muni_district', label: 'ناحیه‌ی شهرداری' },
  { id: 'reg_zone', label: 'ناحیه‌ی ثبتی' }, { id: 'plaque', label: 'پلاک ثبتی' }
];
const WFS_CATS = { mantaghe: 'muni_region', districts: 'county', subdistricts: 'bakhsh' };
const NAME_KEYS = ['NAME_FA', 'name_fa', 'FA_NAME', 'nameFa', 'نام', 'name', 'Name', 'NAME', 'zoneName', 'title', 'label', 'regUnitName', 'RegUnitName', 'plaqName', 'PlaqName', 'provinceName', 'ProvinceName', 'ostan', 'nahie', 'unitName', 'caption', 'text'];
const clean = (s) => String(s == null ? '' : s).replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\s+/g, ' ').trim();   // یکسان‌سازی «ي» و «ك» عربی
function pickName(p, nameProp) {
  if (!p) return '';
  if (nameProp && p[nameProp] != null && clean(p[nameProp])) return clean(p[nameProp]);
  for (const k of NAME_KEYS) if (p[k] != null && clean(p[k])) return clean(p[k]);
  const s = Object.values(p).find((v) => typeof v === 'string' && clean(v) && clean(v).length < 60); return s ? clean(s) : '';
}

/* ───────────── نمایه‌ی فضایی ───────────── */
function polysOf(g) {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates]; if (g.type === 'MultiPolygon') return g.coordinates;
  if (g.type === 'GeometryCollection') return [].concat(...g.geometries.map(polysOf)); return [];
}
const CELL = 0.05;
function buildIndex(features, nameProp) {
  const feats = [], grid = new Map(), big = [];
  for (const f of features) {
    const polys = polysOf(f.geometry); if (!polys.length) continue;
    const name = pickName(f.properties, nameProp); if (!name) continue;
    let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
    const rings = polys.map((poly) => poly.map((r) => { const a = new Float64Array(r.length * 2); r.forEach((c, i) => { a[2 * i] = c[0]; a[2 * i + 1] = c[1]; if (c[0] < minx) minx = c[0]; if (c[0] > maxx) maxx = c[0]; if (c[1] < miny) miny = c[1]; if (c[1] > maxy) maxy = c[1]; }); return a; }));
    const idx = feats.length; feats.push({ name, rings, bbox: [minx, miny, maxx, maxy], area: (maxx - minx) * (maxy - miny) });
    const cx0 = Math.floor(minx / CELL), cx1 = Math.floor(maxx / CELL), cy0 = Math.floor(miny / CELL), cy1 = Math.floor(maxy / CELL);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 300) { big.push(idx); continue; }
    for (let x = cx0; x <= cx1; x++) for (let y = cy0; y <= cy1; y++) { const k = x + ':' + y; let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(idx); }
  }
  return { feats, grid, big };
}
function inRing(x, y, a) {
  let inside = false; const n = a.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = a[2 * i], yi = a[2 * i + 1], xj = a[2 * j], yj = a[2 * j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inFeature(f, x, y) {
  const b = f.bbox; if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
  for (const poly of f.rings) { if (!inRing(x, y, poly[0])) continue; let hole = false; for (let h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) { hole = true; break; } if (!hole) return true; }
  return false;
}
function findIn(index, lat, lng) {
  const cand = (index.grid.get(Math.floor(lng / CELL) + ':' + Math.floor(lat / CELL)) || []).concat(index.big);
  let best = null;
  for (const i of cand) { const f = index.feats[i]; if (inFeature(f, lng, lat) && (!best || f.area < best.area)) best = f; }
  return best ? best.name : null;
}

/* ───────────── بسته‌ها ───────────── */
const packs = new Map(); // id → { id, cat, label, source, count, index }
const status = { loading: false, lastError: '' };
const addPack = (id, cat, label, source, features, nameProp) => { const index = buildIndex(features, nameProp); packs.set(id, { id, cat, label, source, count: index.feats.length, index }); return index.feats.length; };

const PK = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => { if (!root.indexedDB) return rej(new Error('no idb')); const r = indexedDB.open('fieldmap-packs', 1); r.onupgradeneeded = () => r.result.createObjectStore('packs', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    async all() { try { return await rq((await open()).transaction('packs').objectStore('packs').getAll()); } catch (e) { return []; } },
    async put(p) { try { await rq((await open()).transaction('packs', 'readwrite').objectStore('packs').put(p)); return true; } catch (e) { return false; } },
    async del(id) { try { await rq((await open()).transaction('packs', 'readwrite').objectStore('packs').delete(id)); } catch (e) { /* ignore */ } }
  };
})();

const BUNDLED = [
  { file: 'data/provinces.json', id: 'bundled:province', cat: 'province', label: 'استان‌ها', nameProp: 'name' },
  { file: 'data/mashhad_limits_districts.geojson', id: 'bundled:county', cat: 'county', label: 'شهرستان‌ها', nameProp: null },
  { file: 'data/mashhad_limits_subdistricts.geojson', id: 'bundled:bakhsh', cat: 'bakhsh', label: 'بخش‌ها', nameProp: null },
  { file: 'data/mashhad_limits_mantaghe.geojson', id: 'bundled:muni_region', cat: 'muni_region', label: 'مناطق شهرداری مشهد', nameProp: null },
  { file: 'data/mashhad_nahie.geojson', id: 'bundled:muni_district', cat: 'muni_district', label: 'نواحی شهرداری مشهد', nameProp: null },
  { file: 'data/reg_unit.geojson', id: 'bundled:reg_zone', cat: 'reg_zone', label: 'نواحی ثبتی', nameProp: null },
  { file: 'data/plaq.geojson', id: 'bundled:plaque', cat: 'plaque', label: 'پلاک‌های ثبتی', nameProp: null }
];
async function loadBundled() {
  for (const b of BUNDLED) {
    try {
      const r = await fetch(b.file);
      if (!r.ok) continue;                       // فایل نبود؟ بی‌سروصدا رد شو
      const fc = await r.json();
      if (!fc || !Array.isArray(fc.features) || !fc.features.length) continue;
      addPack(b.id, b.cat, b.label, 'داخل برنامه', fc.features, b.nameProp);
      if (FM.geo.onChange) FM.geo.onChange();     // فهرست بعد از هر فایل تازه می‌شود
      await new Promise((res) => setTimeout(res, 0));   // نفس‌گیری تا رابط قفل نشود
    } catch (e) { status.lastError = b.label + ': ' + e.message; }
  }
}
async function loadWfsCaches() {
  if (!FM.vec || !FM.vec.getCachedWfs) return;
  for (const key of Object.keys(WFS_CATS)) {
    try { const fc = await FM.vec.getCachedWfs(key); if (fc) addPack('wfs:' + key, WFS_CATS[key], FM.vec.WFS[key].name, 'سرور شهرداری (ذخیره‌شده)', fc.features); } catch (e) { /* ignore */ }
  }
}
async function loadUserPacks() { for (const p of await PK.all()) addPack(p.id, p.cat, p.label, p.source || 'فایل واردشده', p.features, p.nameProp); }
let bgStarted = false;
async function fetchMissingWfs() { // یک‌بار در هر اجرا؛ اگر اینترنت باشد لایه‌های شهرداری را می‌گیرد و برای همیشه ذخیره می‌کند
  if (bgStarted || !navigator.onLine || !FM.vec || !FM.vec.fetchWfsByKey) return; bgStarted = true; status.loading = true;
  for (const key of Object.keys(WFS_CATS)) {
    if (packs.has('wfs:' + key)) continue;
    try { const fc = await FM.vec.fetchWfsByKey(key); if (fc) { addPack('wfs:' + key, WFS_CATS[key], FM.vec.WFS[key].name, 'سرور شهرداری', fc.features); if (FM.geo.onChange) FM.geo.onChange(); } } catch (e) { status.lastError = e.message; }
  }
  status.loading = false; if (FM.geo.onChange) FM.geo.onChange();
}
async function init() {
  await loadBundled(); await loadUserPacks(); await loadWfsCaches();
  if (FM.geo.onChange) FM.geo.onChange();
  setTimeout(fetchMissingWfs, 5000);
}

/* ───────────── پرسش ───────────── */
function lookup(lat, lng) {
  const out = {};
  for (const c of CATS) {
    let name = null;
    for (const p of packs.values()) { if (p.cat !== c.id) continue; const n = findIn(p.index, lat, lng); if (n) { name = n; break; } }
    if (name) out[c.id] = name;
  }
  return out;
}
function describe(lat, lng) {
  const info = lookup(lat, lng), lines = [];
  for (const c of CATS) if (info[c.id]) lines.push(`${c.label}: ${info[c.id]}`);
  return { info, lines, text: lines.join('\n') };
}
const hasAdmin = (text) => /(?:^|\n)(استان|شهرستان|منطقه‌ی شهرداری|ناحیه‌ی شهرداری|ناحیه‌ی ثبتی|پلاک ثبتی|بخش): /.test(text || '');
function withAdminText(lat, lng, userText) {
  const d = describe(lat, lng); if (!d.text) return userText || '';
  if (!userText) return d.text; if (hasAdmin(userText)) return userText; return d.text + '\n' + userText;
}

/* ───────────── مدیریت بسته‌ها ───────────── */
function statusList() {
  return CATS.map((c) => { const ps = [...packs.values()].filter((p) => p.cat === c.id); return { cat: c.id, label: c.label, ok: ps.length > 0, count: ps.reduce((a, p) => a + p.count, 0), sources: ps.map((p) => p.source), packs: ps }; });
}
async function importPack(features, cat, label, nameProp, source) {
  const id = 'user:' + cat + ':' + FM.uid();
  const slim = features.filter((f) => f.geometry && polysOf(f.geometry).length).map((f) => ({ type: 'Feature', properties: { [nameProp || 'name']: f.properties && f.properties[nameProp || 'name'] }, geometry: f.geometry }));
  const n = addPack(id, cat, label, source || 'فایل واردشده', slim, nameProp);
  if (!n) { packs.delete(id); throw new Error('هیچ چندضلعی‌ای با نام معتبر پیدا نشد؛ ستون نام را بررسی کنید.'); }
  await PK.put({ id, cat, label, source: source || 'فایل واردشده', nameProp, features: slim, ts: Date.now() });
  if (FM.geo.onChange) FM.geo.onChange(); return n;
}
async function removePack(id) { packs.delete(id); await PK.del(id); if (FM.geo.onChange) FM.geo.onChange(); }
/* ───────────── آدرس خیابانی از نشان (آنلاین) ───────────── */
const addrCache = new Map();
async function address(lat, lng) {
  const k = lat.toFixed(5) + ',' + lng.toFixed(5);
  if (addrCache.has(k)) return addrCache.get(k);
  const key = FM.store.get('neshanKey', '') || (root.FM_DEFAULTS && root.FM_DEFAULTS.neshanKey) || '';
  if (!key || !navigator.onLine) return null;
  const job = (async () => {
    try {
      const url = `https://api.neshan.org/v5/reverse?lat=${lat}&lng=${lng}`;
      const Http = root.Lib && root.Lib.Http;
      let j;
      if (Http) {
        const r = await Http.get({ url, headers: { 'Api-Key': key }, responseType: 'json', connectTimeout: 10000, readTimeout: 15000 });
        if (r.status !== 200) return null;
        j = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
      } else { const r = await fetch(url, { headers: { 'Api-Key': key } }); if (!r.ok) return null; j = await r.json(); }
      if (!j || j.status !== 'OK') return null;
      return { route: clean(j.route_name), neighbourhood: clean(j.neighbourhood), city: clean(j.city),
               state: clean(j.state), zone: clean(j.municipality_zone), full: clean(j.formatted_address) };
    } catch (e) { return null; }
  })();
  addrCache.set(k, job);
  if (addrCache.size > 300) addrCache.delete(addrCache.keys().next().value);
  return job;
}
async function describeFull(lat, lng) {
  const d = describe(lat, lng), a = await address(lat, lng);
  if (!a) return d;
  const extra = [];
  if (a.city && !d.info.county) extra.push('شهر: ' + a.city);
  if (a.neighbourhood) extra.push('محله: ' + a.neighbourhood);
  if (a.route) extra.push('معبر: ' + a.route);
  if (a.full) extra.push('آدرس: ' + a.full);
  if (!extra.length) return d;
  return { info: Object.assign({}, d.info, { street: a.route, neighbourhood: a.neighbourhood, address: a.full }),
           lines: d.lines.concat(extra), text: d.lines.concat(extra).join('\n') };
}
FM.geo = { init, lookup, describe, describeFull, address, withAdminText, hasAdmin, CATS, statusList, importPack, removePack, pickName, fetchMissingWfs, status, onChange: null, _t: { buildIndex, findIn, inRing, polysOf, addPack, packs, WFS_CATS } };
})(typeof window !== 'undefined' ? window : globalThis);
