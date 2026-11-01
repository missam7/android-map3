/* لایه‌های برداری مرجع (سحاک، WFS شهرداری مشهد) و انتخاب پارسل مشهد */
(function (root) {
'use strict';
const FM = root.FM, { $, store, toast, el, esc, dialog, nf } = FM;
const Lb = () => root.Lib;
const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MASHHAD_PAGE = 'https://eservice.mashhad.ir/fa/page/100670-%D8%A7%D8%B7%D9%84%D8%A7%D8%B9%D8%A7%D8%AA-%D9%85%D9%84%DA%A9.html';
let map = null;
const active = {}, status = {};
const DAY = 864e5;

/* ───────────── شبکه ───────────── */
async function gunzip(u8) {
  const ds = new DecompressionStream('gzip');
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer());
}
async function httpBytes(url, headers) {
  const Http = Lb() && Lb().Http; if (!Http) throw new Error('لایه‌ی شبکه‌ی بومی در دسترس نیست');
  const r = await Http.request({ url, method: 'GET', headers, responseType: 'blob', connectTimeout: 15000, readTimeout: 30000 });
  if (r.status !== 200) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  let buf = new Uint8Array(FM.tiles.b64ToBuf(r.data));
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = await gunzip(buf);
  const ct = String((r.headers && (r.headers['Content-Type'] || r.headers['content-type'])) || '').toLowerCase();
  return { buf, ct };
}
async function httpText(url, headers, timeout) {
  const Http = Lb() && Lb().Http; if (!Http) throw new Error('لایه‌ی شبکه‌ی بومی در دسترس نیست');
  const r = await Http.get({ url, headers, responseType: 'text', connectTimeout: 20000, readTimeout: timeout || 60000 });
  if (r.status !== 200) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
}

/* ───────────── سحاک: تایل برداری (MVT) ───────────── */
const SAHAK = {
  mvtProvince: { name: 'استان‌ها (سحاک)', min: 4, max: 8, color: '#ff6600', label: true },
  mvtRegUnit: { name: 'نواحی / واحدهای ثبتی (سحاک)', min: 6, max: 12, color: '#00b562', label: true },
  mvtPlaq: { name: 'پلاک‌های ثبتی (سحاک)', min: 8, max: 12, color: '#c99a00', label: false },
  mvtCadastre: { name: 'کاداستر (سحاک)', min: 12, max: 16, color: '#0094c4', label: false }
};
const NAME_KEYS = ['name', 'Name', 'NAME', 'title', 'label', 'provinceName', 'ProvinceName', 'regUnitName', 'RegUnitName', 'plaqName', 'PlaqName', 'ostan', 'nahie', 'unitName', 'caption', 'text'];
const pickName = (p) => { if (!p) return ''; for (const k of NAME_KEYS) if (p[k] != null && String(p[k]).trim()) return String(p[k]).trim(); return ''; };
let authWarnedAt = 0;
function sahakHeaders() {
  const h = { Authorization: 'Bearer null', Referer: 'https://sahak.ssaa.ir/app/map', Accept: 'application/x-protobuf,*/*', 'User-Agent': UA_DESKTOP, 'Accept-Language': 'fa,en;q=0.8' };
  const c = store.get('sahakCookie', ''); if (c) h.Cookie = c.trim();
  return h;
}
const inflight = new Map();
async function sahakTile(key, cfg, z, x, y) {
  const ck = `sahak/${key}/${z}/${x}/${y}`;
  const cached = await FM.tiles.TileCache.get(ck);
  if (cached && (Date.now() - cached.ts < 30 * DAY || !navigator.onLine)) return cached.buf.byteLength ? new Uint8Array(cached.buf) : null;
  if (inflight.has(ck)) return inflight.get(ck);
  const job = (async () => {
    try {
      const { buf, ct } = await httpBytes(`https://sahak.ssaa.ir/api/mvt/${key}/${z}/${x}/${y}`, sahakHeaders());
      if (/text\/html/.test(ct)) { const e = new Error('AUTH'); e.status = 401; throw e; }
      if (buf.length < 16) { FM.tiles.TileCache.put(ck, new ArrayBuffer(0), 'empty'); return null; }
      FM.tiles.TileCache.put(ck, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'application/x-protobuf');
      return buf;
    } catch (e) {
      if (e.status === 404 || e.status === 204) { FM.tiles.TileCache.put(ck, new ArrayBuffer(0), 'empty'); return null; }
      if (cached && cached.buf.byteLength) return new Uint8Array(cached.buf);
      if (e.status === 401 || e.status === 403 || e.message === 'AUTH') {
        if (Date.now() - authWarnedAt > 15000) { authWarnedAt = Date.now(); toast('دسترسی به سحاک رد شد: کوکی ورود منقضی یا نادرست است. از «تنظیمات و کلیدها» کوکی جدید را وارد کنید.', 8000); }
      } else if (Date.now() - authWarnedAt > 15000) { authWarnedAt = Date.now(); toast(`خطا در «${cfg.name}»: ${e.message}`, 6000); }
      throw e;
    }
  })();
  inflight.set(ck, job);
  try { return await job; } finally { inflight.delete(ck); }
}
const SahakGrid = L.GridLayer.extend({
  initialize(key, cfg) { L.GridLayer.prototype.initialize.call(this, { tileSize: 256, minZoom: cfg.min, maxZoom: 22, zIndex: 6, updateWhenIdle: true, keepBuffer: 2 }); this._key = key; this._cfg = cfg; },
  createTile(coords, done) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const key = this._key, cfg = this._cfg, z = coords.z, nz = Math.min(z, cfg.max), dz = z - nz, f = Math.pow(2, dz);
    const tx = Math.floor(coords.x / f), ty = Math.floor(coords.y / f);
    sahakTile(key, cfg, nz, tx, ty).then((buf) => {
      if (buf) drawMvt(cv.getContext('2d'), buf, key, cfg, f, -(coords.x - tx * f) * 256, -(coords.y - ty * f) * 256);
      done(null, cv);
    }).catch((e) => done(e, cv));
    return cv;
  }
});
function drawMvt(ctx, buf, key, cfg, f, ox, oy) {
  let vt; try { vt = new (Lb().VectorTile)(new (Lb().PbfReader)(buf)); } catch (e) { return; }
  const layer = vt.layers[key] || vt.layers[Object.keys(vt.layers)[0]]; if (!layer) return;
  const sc = 256 * f / (layer.extent || 4096);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = cfg.color; ctx.fillStyle = cfg.color;
  ctx.lineWidth = key === 'mvtProvince' ? 2.4 : key === 'mvtCadastre' ? 1 : 1.6;
  const labels = [];
  for (let i = 0; i < layer.length; i++) {
    const ft = layer.feature(i), rings = ft.loadGeometry();
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    const R = rings.map((r) => r.map((p) => { const x = p.x * sc + ox, y = p.y * sc + oy; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; return [x, y]; }));
    if (maxx < -4 || minx > 260 || maxy < -4 || miny > 260) continue;
    if (ft.type === 1) { ctx.beginPath(); R.forEach((r) => r.forEach(([x, y]) => { ctx.moveTo(x + 2.5, y); ctx.arc(x, y, 2.5, 0, 6.2832); })); ctx.fill(); continue; }
    ctx.beginPath();
    R.forEach((r) => { r.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); if (ft.type === 3) ctx.closePath(); });
    if (ft.type === 3 && key !== 'mvtCadastre' && key !== 'mvtPlaq') { ctx.globalAlpha = 0.07; ctx.fill(); ctx.globalAlpha = 1; }
    ctx.stroke();
    if (cfg.label && ft.type === 3 && maxx - minx > 70 && maxy - miny > 24) { const nm = pickName(ft.properties); const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2; if (nm && cx > 8 && cx < 248 && cy > 8 && cy < 248) labels.push([nm, cx, cy]); }
  }
  if (labels.length) {
    ctx.font = '700 11px Vazirmatn, Tahoma, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)';
    labels.forEach(([t, x, y]) => { ctx.strokeText(t, x, y); ctx.fillStyle = cfg.color; ctx.fillText(t, x, y); });
  }
}

/* ───────────── WFS شهرداری مشهد (GeoJSON) ───────────── */
const WFS_SERVERS = ['https://sditile2.mashhad.ir/geoserver/wfs', 'https://basemap.mashhad.ir/geoserver/wfs'];
const WFS = {
  mantaghe: { name: 'مناطق شهرداری مشهد', typeName: 'BaseMap:marz_mantaghe', color: '#ff2222', weight: 3, fill: 0.04, minLabelZoom: 11 },
  districts: { name: 'شهرستان‌ها', typeName: 'Newosm:districts', color: '#ff7b00', weight: 2.5, fill: 0.02, minLabelZoom: 9 },
  subdistricts: { name: 'بخش‌ها', typeName: 'Newosm:subdistricts', color: '#2277ff', weight: 2, fill: 0.02, minLabelZoom: 11 }
};
const CUSTOM_COLORS = ['#c2185b', '#00897b', '#6a1b9a', '#ef6c00', '#455a64', '#558b2f'];
function customDefs() { return store.get('wfsCustom', []).reduce((o, c, i) => { o[c.id] = { name: c.name, typeName: c.typeName, color: CUSTOM_COLORS[i % CUSTOM_COLORS.length], weight: 2.2, fill: 0.03, minLabelZoom: 12, custom: true }; return o; }, {}); }
const allDefs = () => Object.assign({}, WFS, customDefs());
function normalizeFc(j) {
  if (!j || typeof j !== 'object') return null;
  if (j.type === 'FeatureCollection' && Array.isArray(j.features) && j.features.length) return j;
  if (j.type === 'Feature' && j.geometry) return { type: 'FeatureCollection', features: [j] };
  return null;
}
function extractGeojson(text) {
  try { const fc = normalizeFc(JSON.parse(String(text).trim())); if (fc) return fc; } catch (e) { /* ادامه */ }
  const re = /\{\s*"type"\s*:\s*"FeatureCollection"/g; let m;
  while ((m = re.exec(text)) !== null) {
    let depth = 0, inStr = false, esc2 = false, end = -1;
    for (let i = m.index; i < text.length; i++) { const c = text[i]; if (inStr) { if (esc2) esc2 = false; else if (c === '\\') esc2 = true; else if (c === '"') inStr = false; } else if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i; break; } } }
    if (end > m.index) { try { const fc = normalizeFc(JSON.parse(text.slice(m.index, end + 1))); if (fc) return fc; } catch (e) { /* ادامه */ } }
  }
  return null;
}
async function loadWfs(def) {
  const ck = 'wfs/' + def.typeName, enc = new TextEncoder(), dec = new TextDecoder();
  const cached = await FM.tiles.TileCache.get(ck);
  if (cached && Date.now() - cached.ts < 7 * DAY) { const fc = extractGeojson(dec.decode(cached.buf)); if (fc) return fc; }
  let lastErr = null;
  for (const base of WFS_SERVERS) {
    try {
      const url = base + '?service=WFS&version=1.0.0&request=GetFeature&typeName=' + encodeURIComponent(def.typeName) + '&srsname=EPSG:4326&outputFormat=application/json';
      const text = await httpText(url, { 'User-Agent': UA_MOBILE, Accept: 'application/json,*/*' }, 90000);
      const fc = extractGeojson(text);
      if (fc) { FM.tiles.TileCache.put(ck, enc.encode(JSON.stringify(fc)).buffer, 'application/json'); return fc; }
      lastErr = new Error('پاسخ سرور GeoJSON نبود');
    } catch (e) { lastErr = e; }
  }
  if (cached) { const fc = extractGeojson(dec.decode(cached.buf)); if (fc) return fc; }
  throw lastErr || new Error('بدون پاسخ');
}
function propsTable(p, max) {
  const t = el('table', { class: 'pop-tbl' }); let n = 0;
  Object.keys(p || {}).forEach((k) => { if (n >= (max || 14) || p[k] == null || typeof p[k] === 'object' || String(p[k]) === '') return; n++; t.appendChild(el('tr', {}, [el('th', { text: k }), el('td', { text: String(p[k]) })])); });
  return t;
}
const wfsRenderer = () => (wfsRenderer.r = wfsRenderer.r || L.canvas({ padding: 0.3 }));
function wfsPopup(f, def) {
  const p = f.properties || {}, w = el('div', { class: 'pop' });
  w.appendChild(el('div', { class: 'pop-title', text: pickNameAny(p) || '(بدون نام)' })); w.appendChild(el('div', { class: 'pop-sub', text: def.name }));
  w.appendChild(propsTable(p));
  const btns = el('div', { class: 'pop-btns' });
  btns.appendChild(el('button', { type: 'button', text: 'افزودن به پروژه', onclick: () => {
    const props = Object.assign({}, flat(p), { name: pickNameAny(p) || def.name, source: def.name, stroke: def.color, fill: def.color, 'fill-opacity': 0.08 });
    FM.project.addFeature({ type: 'Feature', properties: props, geometry: f.geometry }); toast('به لایه‌ی «نقاط و ترسیمات» افزوده شد.'); map.closePopup();
  } }));
  w.appendChild(btns); return w;
}
function flat(p) { const o = {}; Object.keys(p || {}).forEach((k) => { if (p[k] != null && typeof p[k] !== 'object') o[k] = p[k]; }); return o; }
function pickNameAny(p) {
  for (const k of ['zoneName', 'name', 'Name', 'NAME', 'title', 'label', 'نام', 'district', 'subdistrict', 'REGION']) if (p && p[k] != null && String(p[k]).trim()) return String(p[k]).trim();
  const s = Object.values(p || {}).find((v) => typeof v === 'string' && v && v.trim() && v.length < 50); return s ? s.trim() : '';
}
function buildWfsLayer(fc, def) {
  const group = L.layerGroup(), labels = L.layerGroup();
  const gj = L.geoJSON(fc, {
    renderer: wfsRenderer(),
    style: { color: def.color, weight: def.weight, opacity: 0.95, fillColor: def.color, fillOpacity: def.fill },
    pointToLayer: (f, ll) => L.circleMarker(ll, { radius: 5, color: '#fff', weight: 1.5, fillColor: def.color, fillOpacity: 1 }),
    onEachFeature(f, ly) {
      ly.bindPopup(() => wfsPopup(f, def), { maxWidth: 300 });
      const nm = pickNameAny(f.properties || {});
      if (nm && ly.getBounds) { const b = ly.getBounds(); if (b.isValid()) labels.addLayer(L.marker(b.getCenter(), { interactive: false, keyboard: false, icon: L.divIcon({ className: 'ref-label', html: `<span style="color:${esc(def.color)}">${esc(nm)}</span>`, iconSize: [0, 0] }) })); }
    }
  });
  group.addLayer(gj);
  const sync = () => { const on = map.getZoom() >= def.minLabelZoom; if (on && !group.hasLayer(labels)) group.addLayer(labels); else if (!on && group.hasLayer(labels)) group.removeLayer(labels); };
  group.on('add', () => { map.on('zoomend', sync); sync(); }); group.on('remove', () => map.off('zoomend', sync));
  group._count = fc.features.length; return group;
}

/* ───────────── مدیریت روشن/خاموش ───────────── */
function refOn() { return store.get('refOn', {}); }
function setRefOn(id, v) { const s = refOn(); if (v) s[id] = true; else delete s[id]; store.set('refOn', s); }
async function toggleRef(id, on) {
  if (!on) { if (active[id]) { map.removeLayer(active[id]); delete active[id]; } setRefOn(id, false); status[id] = ''; renderRefList(); return; }
  const sk = SAHAK[id];
  if (sk) {
    if (!store.get('sahakCookie', '')) { toast('برای لایه‌های سحاک، کوکی ورود را در «تنظیمات و کلیدها» وارد کنید.', 5000); renderRefList(); return; }
    active[id] = new SahakGrid(id, sk).addTo(map); setRefOn(id, true); status[id] = `از زوم ${nf(sk.min)} به بعد دیده می‌شود`; renderRefList(); return;
  }
  const def = allDefs()[id]; if (!def) return;
  status[id] = 'در حال دریافت…'; renderRefList();
  try {
    const fc = await loadWfs(def);
    if (active[id]) map.removeLayer(active[id]);
    active[id] = buildWfsLayer(fc, def).addTo(map); setRefOn(id, true); status[id] = nf(fc.features.length) + ' عارضه';
  } catch (e) {
    status[id] = 'خطا: ' + e.message; setRefOn(id, false);
    toast(`دریافت «${def.name}» ممکن نشد (${e.message}). اگر VPN روشن است خاموشش کنید؛ سرورهای شهرداری معمولاً فقط از اینترنت داخل ایران جواب می‌دهند.`, 8000);
  }
  renderRefList();
}
function renderRefList() {
  const box = $('#ref-list'); if (!box) return; box.textContent = '';
  const mk = (id, name, note) => {
    const cb = el('input', { type: 'checkbox' }); cb.checked = !!active[id];
    cb.addEventListener('change', () => toggleRef(id, cb.checked));
    const row = el('label', { class: 'chk refrow' }, [cb, el('span', { class: 'rn', text: name }), el('small', { text: status[id] || note || '' })]);
    box.appendChild(row);
  };
  Object.keys(SAHAK).forEach((id) => mk(id, SAHAK[id].name, 'نیاز به کوکی'));
  const defs = allDefs(); Object.keys(defs).forEach((id) => mk(id, defs[id].name, defs[id].custom ? 'سرور شهرداری' : ''));
}
async function restoreRefs() {
  const on = refOn();
  for (const id of Object.keys(on)) { if (SAHAK[id] && !store.get('sahakCookie', '')) continue; await toggleRef(id, true); }
}

/* افزودن لایه‌ی دلخواه از فهرست WFS شهرداری */
async function addWfsDialog() {
  const body = el('div', {}, [el('p', { class: 'hint', text: 'فهرست لایه‌های سرور شهرداری مشهد دریافت می‌شود. برای نواحی/محله‌ها عبارتی مثل nahi یا mahale یا «ناحیه» را جستجو کنید.' })]);
  const search = el('input', { type: 'text', class: 'field', placeholder: 'جستجو در نام لایه‌ها…' }); body.appendChild(search);
  const list = el('div', { class: 'wfs-list' }, [el('div', { class: 'hint', text: 'در حال دریافت فهرست…' })]); body.appendChild(list);
  const manual = el('input', { type: 'text', class: 'field', placeholder: 'یا نام کامل لایه، مثل BaseMap:marz_mantaghe', dir: 'ltr' }); body.appendChild(manual);
  let types = [], chosen = null;
  const render = () => {
    const q = search.value.trim().toLowerCase(); list.textContent = '';
    const items = types.filter((t) => !q || (t.name + ' ' + t.title).toLowerCase().includes(q)).slice(0, 80);
    if (!items.length) list.appendChild(el('div', { class: 'hint', text: types.length ? 'موردی پیدا نشد.' : 'فهرست دریافت نشد؛ نام لایه را دستی وارد کنید.' }));
    items.forEach((t) => { const b = el('button', { type: 'button', class: 'wfs-item' + (chosen === t.name ? ' on' : ''), html: `<b dir="ltr">${esc(t.name)}</b><small>${esc(t.title)}</small>` }); b.addEventListener('click', () => { chosen = t.name; manual.value = t.name; render(); }); list.appendChild(b); });
  };
  search.addEventListener('input', render);
  (async () => {
    for (const base of WFS_SERVERS) {
      try {
        const xml = await httpText(base + '?service=WFS&version=1.0.0&request=GetCapabilities', { 'User-Agent': UA_MOBILE }, 40000);
        const doc = new DOMParser().parseFromString(xml, 'text/xml');
        types = Array.from(doc.getElementsByTagName('FeatureType')).map((ft) => { const g = (n) => { const e = ft.getElementsByTagName(n)[0]; return e ? e.textContent.trim() : ''; }; return { name: g('Name'), title: g('Title') }; }).filter((t) => t.name);
        if (types.length) break;
      } catch (e) { /* سرور بعدی */ }
    }
    render();
  })();
  const r = await dialog({ title: 'افزودن لایه‌ی برداری از سرور شهرداری', body, focus: false, buttons: [{ label: 'انصراف', value: null }, { label: 'افزودن', primary: true, value: () => manual.value.trim() }] });
  if (!r) return;
  const tn = r, nm = (types.find((t) => t.name === tn) || {}).title || tn.split(':').pop();
  const list2 = store.get('wfsCustom', []); const id = 'wfs:' + tn;
  if (!list2.some((c) => c.id === id)) { list2.push({ id, name: nm, typeName: tn }); store.set('wfsCustom', list2); }
  renderRefList(); toggleRef(id, true);
}

/* ───────────── انتخاب پارسل مشهد ───────────── */
let parcelHi = null;
const clearParcel = () => { if (parcelHi) { map.removeLayer(parcelHi); parcelHi = null; } };
const parcelMode = () => FM.store.get('base', '') === 'mashhad' || store.get('parcelManual', false);
async function parcelClick(ll) {
  clearParcel();
  const token = store.get('mashhadToken', '');
  if (!token) { await dialog({ title: 'توکن پارسل مشهد لازم است', body: '<p>برای استعلام پارسل باید توکن سرویس <b>websdi.mashhad.ir</b> را در «تنظیمات و کلیدها» وارد کنید. همان مقدار <code dir="ltr">MASHHAD_API_KEY</code> داخل فایل <code dir="ltr">server.js</code> قدیمی شماست.</p>' }); return; }
  toast('در حال استعلام پلاک…', 2000);
  const cql = `INTERSECTS(wkb_geometry,POINT(${ll.lat} ${ll.lng}))`;
  const url = 'https://websdi.mashhad.ir/api/proxy/geotajak/wfs?service=wfs&request=GetFeature&outputFormat=application/json&typeName=geotajak:features&srsname=EPSG:4326&count=1&startIndex=0&CQL_FILTER=' + encodeURIComponent(cql);
  let gj;
  try {
    const r = await Lb().Http.get({ url, headers: { Accept: 'application/json', Authorization: 'Bearer ' + token, 'User-Agent': UA_MOBILE }, responseType: 'json', connectTimeout: 15000, readTimeout: 25000 });
    if (r.status === 401 || r.status === 403) { toast('توکن پارسل نامعتبر یا منقضی است (HTTP ' + r.status + ').', 6000); return; }
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    gj = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  } catch (e) { toast('استعلام پلاک ممکن نشد: ' + e.message + ' — اگر VPN روشن است خاموشش کنید.', 6500); return; }
  const feat = (gj && gj.features || [])[0];
  if (!feat) { toast('در این نقطه پلاکی یافت نشد.', 3000); return; }
  parcelHi = L.geoJSON(feat.geometry, { style: { color: '#ff3b30', weight: 3, fillColor: '#ff3b30', fillOpacity: 0.25 }, interactive: false }).addTo(map);
  const p = feat.properties || {};
  let code = p.Code; if (!code) for (const k of Object.keys(p)) if (/nosazi|code/i.test(k) && /^\d/.test(String(p[k]))) { code = p[k]; break; }
  let area = 0; try { const polys = feat.geometry.type === 'Polygon' ? [feat.geometry.coordinates] : feat.geometry.type === 'MultiPolygon' ? feat.geometry.coordinates : []; area = polys.reduce((a, pl) => a + FM.geodesicArea(pl[0].slice(0, -1).map(FM.ll2)), 0); } catch (e) { /* ignore */ }
  const w = el('div', { class: 'pop parcel' });
  w.appendChild(el('div', { class: 'pop-sub', text: 'کد نوسازی' }));
  w.appendChild(el('div', { class: 'nosazi', dir: 'ltr', text: code || '—' }));
  if (area) w.appendChild(el('div', { class: 'pop-desc', text: 'مساحت تقریبی: ' + FM.fmtArea(area) }));
  w.appendChild(propsTable(p));
  const btns = el('div', { class: 'pop-btns' });
  const add = (label, fn) => btns.appendChild(el('button', { type: 'button', text: label, onclick: fn }));
  if (code) add('کپی کد', async () => { try { await navigator.clipboard.writeText(String(code)); toast('کد کپی شد.'); } catch (e) { toast('کد: ' + code, 5000); } });
  add('ذخیره‌ی پارسل در پروژه', () => {
    FM.project.addFeature({ type: 'Feature', geometry: feat.geometry, properties: Object.assign({}, flat(p), { name: code ? String(code) : 'پارسل', source: 'websdi', stroke: '#ff3b30', fill: '#ff3b30', 'fill-opacity': 0.2, area_m2: Math.round(area) }) });
    toast('پارسل در پروژه ذخیره شد.'); map.closePopup();
  });
  if (code) add('گزارش‌های شهرداری', async () => {
    try { await navigator.clipboard.writeText(String(code)); } catch (e) { /* ignore */ }
    toast('کد کپی شد؛ در صفحه‌ی شهرداری وارد کنید (عرصه / پروانه / پایان‌کار).', 5000);
    try { await Lb().App.openUrl({ url: MASHHAD_PAGE }); } catch (e) { window.open(MASHHAD_PAGE, '_blank'); }
  });
  if (FM.route) { add('مبدا', () => { FM.route.setOrigin(ll); map.closePopup(); }); add('مقصد', () => { FM.route.setDest(ll); map.closePopup(); }); }
  w.appendChild(btns);
  L.popup({ maxWidth: 320, autoPan: true }).setLatLng(ll).setContent(w).on('remove', clearParcel).openOn(map);
}

function init(m) { map = m; renderRefList(); restoreRefs(); }
FM.vec = { init, renderRefList, addWfsDialog, parcelClick, parcelMode, toggleRef, _t: { extractGeojson, drawMvt, sahakTile, loadWfs, SahakGrid } };
})(window);
