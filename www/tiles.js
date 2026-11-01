/* لایه‌های نقشه با درخواست بومی (بدون محدودیت CORS/Referer مرورگر) و کش آفلاین تایل‌ها */
(function (root) {
'use strict';
const FM = root.FM;
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

// نکته: کلید نشان داخل کد نیست؛ کاربر در برنامه وارد می‌کند.
const LAYERS = [
  { id: 'gsat', name: 'ماهواره گوگل', note: 'تصویر', max: 21, sub: '0123', url: 'https://mt{s}.google.com/vt?lyrs=s&x={x}&y={y}&z={z}' },
  { id: 'ghyb', name: 'ماهواره با برچسب', note: 'ترکیبی', max: 21, sub: '0123', url: 'https://mt{s}.google.com/vt?lyrs=y&x={x}&y={y}&z={z}' },
  { id: 'gmap', name: 'نقشه خیابانی گوگل', note: 'خیابان', max: 21, sub: '0123', url: 'https://mt{s}.google.com/vt?lyrs=m&x={x}&y={y}&z={z}' },
  { id: 'gter', name: 'گوگل Terrain (پستی‌بلندی)', note: 'توپوگرافی', max: 20, sub: '0123', url: 'https://mt{s}.google.com/vt?lyrs=p&x={x}&y={y}&z={z}' },
  { id: 'gtraffic', name: 'ترافیک گوگل (نقشه)', note: 'ترافیک زنده', max: 20, sub: '0123', traffic: true, url: 'https://mt{s}.google.com/vt?lyrs=m,traffic&hl=fa&x={x}&y={y}&z={z}' },
  { id: 'gtrafficsat', name: 'ترافیک گوگل (ماهواره)', note: 'ترافیک زنده', max: 20, sub: '0123', traffic: true, url: 'https://mt{s}.google.com/vt?lyrs=y,traffic&hl=fa&x={x}&y={y}&z={z}' },
  { id: 'osm', name: 'OpenStreetMap', note: 'خیابان', max: 19, sub: 'abc', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
  { id: 'cyclosm', name: 'CycleOSM (دوچرخه/مسیرها)', note: 'مسیرها', max: 20, sub: 'abc', url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png' },
  { id: 'orm', name: 'OpenRailwayMap (راه‌آهن)', note: 'راه‌آهن', max: 19, sub: 'abc', referer: 'https://www.openrailwaymap.org/', url: 'https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png' },
  { id: 'mashhad', name: 'پایه‌ی شهرداری مشهد ۱۴۰۱', note: 'مشهد · پارسل', max: 19, tms: true, iran: true,
    url: 'https://basemap.mashhad.ir/geoserver/gwc/service/tms/1.0.0/MashhadBaseMap1401@EPSG:900913@png/{z}/{x}/{y}.png' },
  { id: 'nsat', name: 'ماهواره نشان', note: 'کلید لازم', max: 18, needsKey: true, iran: true, url: 'https://api.neshan.org/tile/raster/satellite/{z}/{x}/{y}?Api-key={key}' },
  { id: 'nmap', name: 'نقشه نشان', note: 'کلید لازم', max: 18, needsKey: true, iran: true, url: 'https://api.neshan.org/tile/raster/basemap/plate/{z}/{x}/{y}?Api-key={key}' }
];
// لایه‌های رویه (شفاف) که روی هر نقشه‌ی زمینه‌ای قرار می‌گیرند
const OVERLAYS = [
  { id: 'orm', name: 'خطوط راه‌آهن (OpenRailwayMap)', max: 19, sub: 'abc', referer: 'https://www.openrailwaymap.org/', url: 'https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', opacity: 0.9 }
];

/* کش تایل در IndexedDB */
const TileCache = (() => {
  let dbp = null, writes = 0;
  const MAX = 9000, FRESH_MS = 30 * 864e5;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      if (!root.indexedDB) return rej(new Error('no idb'));
      const r = indexedDB.open('fieldmap-tiles', 1);
      r.onupgradeneeded = () => { const s = r.result.createObjectStore('t', { keyPath: 'k' }); s.createIndex('ts', 'ts'); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  async function get(k) { try { const db = await open(); return await rq(db.transaction('t').objectStore('t').get(k)); } catch (e) { return null; } }
  async function put(k, buf, type) {
    try {
      const db = await open();
      await rq(db.transaction('t', 'readwrite').objectStore('t').put({ k, buf, type, ts: Date.now() }));
      if (++writes % 300 === 0) trim(db);
    } catch (e) { /* ignore */ }
  }
  async function trim(db) {
    try {
      const st = db.transaction('t', 'readwrite').objectStore('t'); const n = await rq(st.count());
      if (n <= MAX) return;
      let del = n - MAX + 500;
      const cur = st.index('ts').openCursor();
      cur.onsuccess = () => { const c = cur.result; if (c && del-- > 0) { c.delete(); c.continue(); } };
    } catch (e) { /* ignore */ }
  }
  async function clear() { try { const db = await open(); await rq(db.transaction('t', 'readwrite').objectStore('t').clear()); } catch (e) { /* ignore */ } }
  async function count() { try { const db = await open(); return await rq(db.transaction('t').objectStore('t').count()); } catch (e) { return 0; } }
  return { get, put, clear, count, FRESH_MS };
})();

const b64ToBuf = (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; };
const lastErrAt = {};
function reportError(def, info) {
  const now = Date.now(); if (now - (lastErrAt[def.id] || 0) < 9000) return; lastErrAt[def.id] = now;
  let msg = `خطا در لایه‌ی «${def.name}»: ${info}`;
  if (def.iran && /403|timeout|عدم اتصال|ENOTFOUND|connect|network|Unable/i.test(info)) msg += ' — اگر VPN روشن است، برای این لایه خاموشش کنید (بعضی سرویس‌های ایرانی فقط از اینترنت داخل ایران جواب می‌دهند).';
  else if (!navigator.onLine) msg = 'اینترنت قطع است؛ فقط بخش‌های قبلاً دیده‌شده نمایش داده می‌شوند.';
  FM.toast(msg, 7000);
}

async function fetchNative(def, url) {
  const Http = root.Lib && root.Lib.Http;
  const headers = { 'User-Agent': MOBILE_UA, Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8' };
  if (def.id === 'osm' || def.id === 'cyclosm') headers['User-Agent'] = 'FieldMap/0.3 (Android field survey app)';
  if (def.referer) headers.Referer = def.referer;
  if (!Http) return { direct: true };
  const res = await Http.request({ url, method: 'GET', headers, responseType: 'blob', connectTimeout: 12000, readTimeout: 20000 });
  if (res.status !== 200) throw new Error('HTTP ' + res.status);
  const type = (res.headers && (res.headers['Content-Type'] || res.headers['content-type'])) || 'image/png';
  if (!/^image\//i.test(type)) throw new Error('پاسخ تصویر نیست (' + type.split(';')[0] + ')');
  return { buf: b64ToBuf(res.data), type };
}

const NativeTileLayer = L.TileLayer.extend({
  createTile(coords, done) {
    const img = document.createElement('img'); img.alt = ''; img.setAttribute('role', 'presentation');
    const def = this.options.def, url = this.getTileUrl(coords), key = `${def.id}/${coords.z}/${coords.x}/${coords.y}`;
    const show = (src, revoke) => { img.onload = () => { if (revoke) URL.revokeObjectURL(src); done(null, img); }; img.onerror = () => { if (revoke) URL.revokeObjectURL(src); done(new Error('decode'), img); }; img.src = src; };
    (async () => {
      const cached = await TileCache.get(key);
      if (cached && (Date.now() - cached.ts < TileCache.FRESH_MS || !navigator.onLine)) { show(URL.createObjectURL(new Blob([cached.buf], { type: cached.type })), true); return; }
      try {
        const r = await fetchNative(def, url);
        if (r.direct) { show(url, false); return; }
        TileCache.put(key, r.buf, r.type);
        show(URL.createObjectURL(new Blob([r.buf], { type: r.type })), true);
      } catch (e) {
        if (cached) { show(URL.createObjectURL(new Blob([cached.buf], { type: cached.type })), true); return; }
        reportError(def, e && e.message ? e.message : String(e));
        done(e, img);
      }
    })();
    return img;
  }
});

let baseLayer = null;
const overlayLayers = {};
function makeLayer(def, extra) {
  let url = def.url;
  if (def.needsKey) {
    const key = FM.store.get('neshanKey', '');
    if (!key) { FM.toast('برای لایه‌های نشان، اول کلید API را در «تنظیمات و کلیدها» وارد کنید.'); return null; }
    url = url.replace('{key}', encodeURIComponent(key));
  }
  return new NativeTileLayer(url, Object.assign({ def, subdomains: def.sub || 'abc', tms: !!def.tms, maxNativeZoom: def.max, maxZoom: 22, keepBuffer: 4, updateWhenIdle: false }, extra || {}));
}
function setBase(map, id) {
  const def = LAYERS.find((l) => l.id === id) || LAYERS[0];
  const layer = makeLayer(def, { zIndex: 1 }); if (!layer) return false;
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = layer.addTo(map);
  FM.store.set('base', def.id);
  if (FM.onBaseChange) FM.onBaseChange(def.id);
  return true;
}
function overlayState() { return FM.store.get('overlays', {}); }
function setOverlay(map, id, on, opacity) {
  const def = OVERLAYS.find((o) => o.id === id); if (!def) return;
  const st = overlayState(); const cur = st[id] || { on: false, opacity: def.opacity };
  if (on !== undefined && on !== null) cur.on = on; if (opacity != null) cur.opacity = opacity; st[id] = cur; FM.store.set('overlays', st);
  if (overlayLayers[id]) { map.removeLayer(overlayLayers[id]); delete overlayLayers[id]; }
  if (cur.on) { const l = makeLayer(def, { zIndex: 5, opacity: cur.opacity }); if (l) { overlayLayers[id] = l.addTo(map); } }
}
function restoreOverlays(map) { const st = overlayState(); Object.keys(st).forEach((id) => { if (st[id].on) setOverlay(map, id, true, st[id].opacity); }); }
function setOverlayOpacity(id, op) { const st = overlayState(); if (st[id]) { st[id].opacity = op; FM.store.set('overlays', st); } if (overlayLayers[id]) overlayLayers[id].setOpacity(op); }
function toggleTraffic(map) {
  const cur = FM.store.get('base', 'gsat'), def = LAYERS.find((l) => l.id === cur);
  if (def && def.traffic) { const prev = FM.store.get('baseBeforeTraffic', 'gsat'); setBase(map, prev); return false; }
  FM.store.set('baseBeforeTraffic', cur);
  setBase(map, /^(gsat|ghyb|nsat)$/.test(cur) ? 'gtrafficsat' : 'gtraffic'); return true;
}
FM.tiles = { LAYERS, OVERLAYS, setBase, setOverlay, setOverlayOpacity, restoreOverlays, overlayState, toggleTraffic, TileCache, fetchNative, b64ToBuf };
})(window);
