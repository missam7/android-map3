/* ورودی/خروجی داده‌ها: KML، KMZ، GeoJSON، GPX، Shapefile، DXF، فایل‌های نقطه‌ای (txt/csv/xlsx/pts) و خروجی‌ها.
   همه‌ی توابع این فایل مستقل از رابط کاربری‌اند و فقط به window.Lib وابسته‌اند. */
(function (root) {
'use strict';
const lib = () => root.Lib;

/* ───────────── سیستم مختصات ───────────── */
const CRS = {
  def(id) {
    if (!id || id === 'wgs84') return 'WGS84';
    if (id === 'merc') return 'EPSG:3857';
    const m = /^utm:(\d{1,2})([NS])$/i.exec(id);
    if (m) return `+proj=utm +zone=${+m[1]}${m[2].toUpperCase() === 'S' ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
    throw new Error('سیستم مختصات نامعتبر: ' + id);
  },
  toWgs(id) {
    if (!id || id === 'wgs84') return (c) => c;
    const t = lib().proj4(CRS.def(id), 'WGS84');
    return (c) => { const p = t.forward([c[0], c[1]]); return c.length > 2 ? [p[0], p[1], c[2]] : [p[0], p[1]]; };
  },
  fromWgs(id) {
    if (!id || id === 'wgs84') return (c) => c;
    const t = lib().proj4('WGS84', CRS.def(id));
    return (c) => { const p = t.forward([c[0], c[1]]); return c.length > 2 ? [p[0], p[1], c[2]] : [p[0], p[1]]; };
  },
  utmZone(lng) { return Math.min(60, Math.max(1, Math.floor((lng + 180) / 6) + 1)); },
  utmId(lat, lng) { return 'utm:' + CRS.utmZone(lng) + (lat < 0 ? 'S' : 'N'); },
  label(id) {
    if (!id || id === 'wgs84') return 'WGS84 (درجه)';
    if (id === 'merc') return 'Web Mercator';
    const m = /^utm:(\d+)([NS])$/i.exec(id);
    return m ? `UTM زون ${m[1]}${m[2].toUpperCase()}` : id;
  },
  // اعداد UTM یک نقطه (برای نمایش)
  utmOf(lat, lng, forceId) {
    const id = forceId || CRS.utmId(lat, lng);
    const p = CRS.fromWgs(id)([lng, lat]);
    const m = /^utm:(\d+)([NS])$/i.exec(id);
    return { id, zone: +m[1], hemi: m[2].toUpperCase(), easting: p[0], northing: p[1] };
  },
  wkt(id) {
    const m = /^utm:(\d+)([NS])$/i.exec(id || '');
    if (!m) return 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
    const z = +m[1], south = m[2].toUpperCase() === 'S';
    return `PROJCS["WGS_1984_UTM_Zone_${z}${m[2].toUpperCase()}",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",${south ? '10000000.0' : '0.0'}],PARAMETER["Central_Meridian",${z * 6 - 183}.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;
  }
};

function mapGeom(g, fn) {
  if (!g) return g;
  if (g.type === 'GeometryCollection') return { type: g.type, geometries: (g.geometries || []).map((x) => mapGeom(x, fn)) };
  const m = (c) => (Array.isArray(c[0]) ? c.map(m) : fn(c));
  return { type: g.type, coordinates: m(g.coordinates) };
}
function reprojectFeatures(features, fn) { return features.map((f) => ({ ...f, geometry: mapGeom(f.geometry, fn) })); }
function eachCoord(g, cb) {
  if (!g) return;
  if (g.type === 'GeometryCollection') { (g.geometries || []).forEach((x) => eachCoord(x, cb)); return; }
  const w = (c) => { if (Array.isArray(c[0])) c.forEach(w); else cb(c); };
  if (g.coordinates) w(g.coordinates);
}
function looksProjected(features) {
  let n = 0, proj = false;
  for (const f of features) {
    eachCoord(f.geometry, (c) => { n++; if (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) proj = true; });
    if (proj || n > 300) break;
  }
  return proj;
}

/* ───────────── ابزارهای متن و فایل ───────────── */
const baseName = (fn) => String(fn || 'layer').replace(/\.[^.]+$/, '');
const extOf = (fn) => (String(fn || '').match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
function decodeText(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let t = new TextDecoder('utf-8').decode(u8);
  if (t.indexOf('\ufffd') !== -1) { try { t = new TextDecoder('windows-1256').decode(u8); } catch (e) { /* ignore */ } }
  return t.replace(/^\uFEFF/, '');
}
const readBuf = (file) => (file.arrayBuffer ? file.arrayBuffer() : Promise.resolve(file));
const faDigits = (s) => String(s).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 1776).replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 1632).replace(/٫/g, '.');
function isNumStr(s) { return /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/.test(faDigits(s).trim()); }
function toNum(v) {
  if (typeof v === 'number') return v;
  const s = faDigits(v).trim();
  if (!isNumStr(s)) return NaN;
  return parseFloat(s.replace(',', '.'));
}

/* ───────────── GeoJSON ───────────── */
function normalizeGeoJSON(obj) {
  if (Array.isArray(obj)) obj = { type: 'FeatureCollection', features: obj };
  if (!obj || !obj.type) throw new Error('فایل GeoJSON معتبر نیست.');
  if (obj.type === 'FeatureCollection') return obj.features || [];
  if (obj.type === 'Feature') return [obj];
  if (/^(Point|MultiPoint|LineString|MultiLineString|Polygon|MultiPolygon|GeometryCollection)$/.test(obj.type)) return [{ type: 'Feature', properties: {}, geometry: obj }];
  throw new Error('ساختار JSON شبیه GeoJSON نیست.');
}
function parseGeoJSON(text, filename) {
  let obj; try { obj = JSON.parse(text); } catch (e) { throw new Error('فایل JSON خوانده نشد: ' + e.message); }
  const features = normalizeGeoJSON(obj).filter((f) => f && f.geometry).map((f) => ({ type: 'Feature', geometry: f.geometry, properties: f.properties || {} }));
  let crs;
  const nm = obj && obj.crs && obj.crs.properties && obj.crs.properties.name;
  if (nm) {
    const m = /(?:EPSG[:]{1,2})(\d+)/i.exec(nm);
    if (m) { const c = +m[1]; if (c === 4326 || c === 4258) crs = 'wgs84'; else if (c >= 32601 && c <= 32660) crs = 'utm:' + (c - 32600) + 'N'; else if (c >= 32701 && c <= 32760) crs = 'utm:' + (c - 32700) + 'S'; else if (c === 3857) crs = 'merc'; }
  }
  return { layers: [{ name: baseName(filename), features }], crs };
}

/* ───────────── KML / KMZ / GPX ───────────── */
function parseXml(text) {
  const doc = new root.DOMParser().parseFromString(text, 'text/xml');
  return doc;
}
function folderPathOf(el) {
  const names = [];
  for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) {
    const tag = (p.localName || p.nodeName || '').toLowerCase();
    if (tag === 'folder' || tag === 'document') {
      for (let ch = p.firstChild; ch; ch = ch.nextSibling) {
        if (ch.nodeType === 1 && (ch.localName || ch.nodeName).toLowerCase() === 'name') { names.unshift((ch.textContent || '').trim()); break; }
      }
    }
  }
  return names;
}
function parseKML(text, filename) {
  const doc = parseXml(text);
  const gj = lib().togeojson.kml(doc, { skipNullGeometry: true });
  const feats = (gj.features || []).filter((f) => f.geometry);
  const pms = Array.from(doc.getElementsByTagName('Placemark'));
  const groups = new Map();
  const sameCount = pms.length === feats.length;
  feats.forEach((f, i) => {
    let g = baseName(filename);
    if (sameCount) { const path = folderPathOf(pms[i]); if (path.length) g = path.length > 1 ? path.slice(1).join(' / ') : path[0]; }
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ type: 'Feature', geometry: f.geometry, properties: f.properties || {} });
  });
  const layers = Array.from(groups, ([name, features]) => ({ name: name || baseName(filename), features }));
  return { layers: layers.length ? layers : [{ name: baseName(filename), features: [] }], crs: 'wgs84' };
}
async function parseKMZ(buf, filename) {
  const zip = await lib().JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => /\.kml$/i.test(n) && !zip.files[n].dir);
  if (!names.length) throw new Error('داخل KMZ فایل KML پیدا نشد.');
  const pick = names.find((n) => /(^|\/)doc\.kml$/i.test(n)) || names[0];
  const text = await zip.files[pick].async('string');
  return parseKML(text, filename);
}
function parseGPX(text, filename) {
  const doc = parseXml(text);
  const gj = lib().togeojson.gpx(doc);
  const feats = (gj.features || []).filter((f) => f.geometry).map((f) => ({ type: 'Feature', geometry: f.geometry, properties: f.properties || {} }));
  const pts = feats.filter((f) => f.geometry.type === 'Point'), lines = feats.filter((f) => f.geometry.type !== 'Point');
  const layers = [];
  if (pts.length) layers.push({ name: baseName(filename) + (lines.length ? ' (نقاط)' : ''), features: pts });
  if (lines.length) layers.push({ name: baseName(filename) + (pts.length ? ' (مسیرها)' : ''), features: lines });
  return { layers: layers.length ? layers : [{ name: baseName(filename), features: [] }], crs: 'wgs84' };
}

/* ───────────── Shapefile ───────────── */
function hasBadChars(features) {
  let bad = 0;
  for (const f of features) for (const k in f.properties || {}) { const v = f.properties[k]; if (typeof v === 'string' && v.indexOf('\ufffd') !== -1) bad++; }
  return bad > 0;
}
function shapeToLayer(parts, name) {
  // parts: {shp, dbf, prj, cpg} — ArrayBuffer/Uint8Array و رشته
  const run = async (cpg) => lib().shp({ shp: parts.shp, dbf: parts.dbf, prj: parts.prj, cpg });
  return (async () => {
    let cpg = parts.cpg ? String(typeof parts.cpg === 'string' ? parts.cpg : decodeText(parts.cpg)).trim() : undefined;
    let fc = await run(cpg);
    if (parts.dbf && hasBadChars(fc.features)) { try { const alt = await run('windows-1256'); if (!hasBadChars(alt.features)) fc = alt; } catch (e) { /* ignore */ } }
    return { name, features: fc.features.filter((f) => f.geometry).map((f) => ({ type: 'Feature', geometry: f.geometry, properties: f.properties || {} })), hasPrj: !!parts.prj };
  })();
}
async function parseShapeZip(buf, filename) {
  const zip = await lib().JSZip.loadAsync(buf);
  const byBase = {};
  for (const n of Object.keys(zip.files)) {
    if (zip.files[n].dir || n.indexOf('__MACOSX') !== -1) continue;
    const m = /^(.*)\.(shp|dbf|prj|cpg)$/i.exec(n); if (!m) continue;
    (byBase[m[1]] = byBase[m[1]] || {})[m[2].toLowerCase()] = zip.files[n];
  }
  const bases = Object.keys(byBase).filter((b) => byBase[b].shp);
  if (!bases.length) throw new Error('داخل zip فایل .shp پیدا نشد.');
  const layers = []; let allPrj = true;
  for (const b of bases) {
    const e = byBase[b];
    const parts = { shp: await e.shp.async('uint8array') };
    if (e.dbf) parts.dbf = await e.dbf.async('uint8array');
    if (e.prj) parts.prj = await e.prj.async('string');
    if (e.cpg) parts.cpg = await e.cpg.async('string');
    const l = await shapeToLayer(parts, bases.length === 1 ? baseName(filename) : b.split('/').pop());
    allPrj = allPrj && l.hasPrj; delete l.hasPrj; layers.push(l);
  }
  return { layers, crs: allPrj ? 'wgs84' : undefined };
}
async function parseShapeLoose(files) {
  const byBase = {};
  for (const f of files) {
    const m = /^(.*)\.(shp|dbf|prj|cpg)$/i.exec(f.name); if (!m) continue;
    (byBase[m[1]] = byBase[m[1]] || {})[m[2].toLowerCase()] = f;
  }
  const layers = []; let allPrj = true;
  for (const b of Object.keys(byBase)) {
    const e = byBase[b]; if (!e.shp) continue;
    const parts = { shp: new Uint8Array(await readBuf(e.shp)) };
    if (e.dbf) parts.dbf = new Uint8Array(await readBuf(e.dbf));
    if (e.prj) parts.prj = decodeText(await readBuf(e.prj));
    if (e.cpg) parts.cpg = decodeText(await readBuf(e.cpg));
    const l = await shapeToLayer(parts, b); allPrj = allPrj && l.hasPrj; delete l.hasPrj; layers.push(l);
  }
  if (!layers.length) throw new Error('فایل .shp انتخاب نشده است (برای شیپ‌فایل باید .shp و .dbf و .prj را با هم انتخاب کنید).');
  return { layers, crs: allPrj ? 'wgs84' : undefined };
}

/* ───────────── DXF ───────────── */
const ACI_RGB = (() => {
  const t = new Array(256).fill(null);
  const STD = [[255,0,0],[255,255,0],[0,255,0],[0,255,255],[0,0,255],[255,0,255],[255,255,255],[128,128,128],[192,192,192]];
  for (let i = 1; i <= 9; i++) t[i] = STD[i - 1];
  const GRAY = [[60,60,60],[100,100,100],[140,140,140],[180,180,180],[220,220,220],[255,255,255]];
  for (let i = 250; i <= 255; i++) t[i] = GRAY[i - 250];
  const V = [0, 63, 127, 191, 255], LEVELS = [255, 204, 153, 127, 76];
  for (let aci = 10; aci <= 249; aci++) {
    const h = Math.floor((aci - 10) / 10), s = (aci - 10) % 10, seg = Math.floor(h / 4), k = h % 4;
    let hue;
    switch (seg) {
      case 0: hue = [255, V[k], 0]; break; case 1: hue = [V[4 - k], 255, 0]; break; case 2: hue = [0, 255, V[k]]; break;
      case 3: hue = [0, V[4 - k], 255]; break; case 4: hue = [V[k], 0, 255]; break; default: hue = [255, 0, V[4 - k]];
    }
    const Lv = LEVELS[Math.floor(s / 2)];
    t[aci] = (s % 2 === 0) ? hue.map((c) => Math.round(c * Lv / 255)) : hue.map((c) => Math.round((c * Lv / 255 + Lv) / 2));
  }
  return t;
})();
const aciToHex = (aci) => { const r = ACI_RGB[aci]; return r ? '#' + r.map((v) => v.toString(16).padStart(2, '0')).join('') : null; };
function hexToRgb(hex) {
  hex = String(hex || '').replace('#', ''); if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const n = parseInt(hex, 16); return isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function nearestAci(hex) {
  if (!hex) return 7;
  const [r, g, b] = hexToRgb(hex); let best = 7, bd = Infinity;
  for (let a = 1; a <= 255; a++) { const c = ACI_RGB[a]; if (!c) continue; const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2; if (d < bd) { bd = d; best = a; } }
  return best;
}

function parseDXF(text, filename) {
  const raw = text.split(/\r\n|\r|\n/), pairs = [];
  for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([parseInt(raw[i].trim(), 10), raw[i + 1]]);
  // جدول لایه‌ها (رنگ هر لایه)
  const layerAci = {}, layerTrue = {};
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1].trim() === 'LAYER') {
      let name = null, aci = null, tc = null, j = i + 1;
      for (; j < pairs.length && pairs[j][0] !== 0; j++) {
        const [c, v] = pairs[j];
        if (c === 2) name = v.trim(); else if (c === 62) aci = Math.abs(parseInt(v, 10)); else if (c === 420) { const n = parseInt(v, 10); if (isFinite(n)) tc = '#' + (n & 0xFFFFFF).toString(16).padStart(6, '0'); }
      }
      if (name !== null) { if (aci !== null) layerAci[name] = aci; if (tc) layerTrue[name] = tc; }
      i = j - 1;
    }
  }
  const layerColor = (ln) => layerTrue[ln] || (layerAci[ln] ? aciToHex(layerAci[ln]) : null) || '#00cc88';
  // موجودیت‌ها
  let i = 0;
  while (i < pairs.length && !(pairs[i][0] === 2 && pairs[i][1].trim() === 'ENTITIES')) i++;
  const ents = []; let cur = null;
  for (i++; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0) { if (cur) ents.push(cur); const t = v.trim(); if (t === 'ENDSEC' || t === 'EOF') { cur = null; break; } cur = { type: t, p: [] }; }
    else if (cur) cur.p.push([c, v]);
  }
  if (cur) ents.push(cur);
  const first = (e, code) => { const x = e.p.find((q) => q[0] === code); return x ? x[1] : undefined; };
  const num = (e, code, d) => { const v = first(e, code); const n = v === undefined ? NaN : parseFloat(v); return isFinite(n) ? n : d; };
  const decode = (s) => String(s).replace(/%%[cC]/g, '⌀').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%');
  const decodeM = (s) => {
    let t = String(s).replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\P/g, '\n').replace(/\\~/g, ' ');
    for (let k = 0; k < 6; k++) { t = t.replace(/\{\\[a-zA-Z][^;{}]*;([^{}]*)\}/g, '$1').replace(/\\[a-zA-Z][^;\\{}]*;/g, '').replace(/\\[LOKlok]/g, '').replace(/[{}]/g, ''); }
    return decode(t).trim();
  };
  const colorOf = (e, ln) => {
    const tc = first(e, 420); if (tc !== undefined) { const n = parseInt(tc, 10); if (isFinite(n)) return '#' + (n & 0xFFFFFF).toString(16).padStart(6, '0'); }
    const a = first(e, 62); const aci = a === undefined ? 256 : Math.abs(parseInt(a, 10));
    if (aci > 0 && aci < 256) return aciToHex(aci) || layerColor(ln);
    return layerColor(ln);
  };
  const feats = [];
  const push = (ln, color, geometry, extra) => {
    const props = Object.assign({ name: ln || '0', layer: ln || '0', color, stroke: color }, extra || {});
    feats.push({ type: 'Feature', geometry, properties: props });
  };
  const ring = (v, closed) => {
    if (v.length < 2) return null;
    if (closed && v.length >= 3) { const r = v.slice(); const a = r[0], b = r[r.length - 1]; if (a[0] !== b[0] || a[1] !== b[1]) r.push(a); return { type: 'Polygon', coordinates: [r] }; }
    return { type: 'LineString', coordinates: v };
  };
  for (let k = 0; k < ents.length; k++) {
    const e = ents[k], ln = (first(e, 8) || '0').trim(), color = colorOf(e, ln);
    switch (e.type) {
      case 'POINT': { const x = num(e, 10), y = num(e, 20); if (isFinite(x) && isFinite(y)) push(ln, color, { type: 'Point', coordinates: [x, y] }, { 'marker-color': color }); break; }
      case 'LINE': { const x1 = num(e, 10), y1 = num(e, 20), x2 = num(e, 11), y2 = num(e, 21); if ([x1, y1, x2, y2].every(isFinite)) push(ln, color, { type: 'LineString', coordinates: [[x1, y1], [x2, y2]] }); break; }
      case 'CIRCLE': { const x = num(e, 10), y = num(e, 20), r = num(e, 40, 0); if (isFinite(x) && isFinite(y)) push(ln, color, { type: 'Point', coordinates: [x, y] }, { isCircle: true, radius: r, 'fill-opacity': 0.05 }); break; }
      case 'ARC': {
        const x = num(e, 10), y = num(e, 20), r = num(e, 40, 0); let a0 = num(e, 50, 0), a1 = num(e, 51, 360);
        if (!isFinite(x) || !isFinite(y) || !(r > 0)) break;
        while (a1 <= a0) a1 += 360;
        const n = Math.max(4, Math.ceil((a1 - a0) / 4)), v = [];
        for (let q = 0; q <= n; q++) { const a = (a0 + (a1 - a0) * q / n) * Math.PI / 180; v.push([x + r * Math.cos(a), y + r * Math.sin(a)]); }
        push(ln, color, { type: 'LineString', coordinates: v }); break;
      }
      case 'LWPOLYLINE': {
        const v = []; let px = null;
        for (const [c, val] of e.p) { if (c === 10) px = parseFloat(val); else if (c === 20 && px !== null) { v.push([px, parseFloat(val)]); px = null; } }
        const g = ring(v.filter((q) => isFinite(q[0]) && isFinite(q[1])), (num(e, 70, 0) & 1) === 1); if (g) push(ln, color, g, g.type === 'Polygon' ? { fill: color, 'fill-opacity': 0.05 } : {}); break;
      }
      case 'POLYLINE': {
        const flags = num(e, 70, 0); const v = []; let j = k + 1;
        for (; j < ents.length && ents[j].type !== 'SEQEND'; j++) {
          if (ents[j].type === 'VERTEX' && !((num(ents[j], 70, 0) & 128) && !(num(ents[j], 70, 0) & 64))) { const x = num(ents[j], 10), y = num(ents[j], 20); if (isFinite(x) && isFinite(y)) v.push([x, y]); }
        }
        k = j;
        if (flags & (16 | 64)) break; // مش — پشتیبانی نمی‌شود
        const g = ring(v, (flags & 1) === 1); if (g) push(ln, color, g, g.type === 'Polygon' ? { fill: color, 'fill-opacity': 0.05 } : {}); break;
      }
      case 'SPLINE': {
        const fit = [], ctl = []; let fx = null, cx = null;
        for (const [c, val] of e.p) {
          if (c === 11) fx = parseFloat(val); else if (c === 21 && fx !== null) { fit.push([fx, parseFloat(val)]); fx = null; }
          else if (c === 10) cx = parseFloat(val); else if (c === 20 && cx !== null) { ctl.push([cx, parseFloat(val)]); cx = null; }
        }
        const v = fit.length >= 2 ? fit : ctl; const g = ring(v, false); if (g) push(ln, color, g); break;
      }
      case 'TEXT': case 'MTEXT': {
        const x = num(e, 10), y = num(e, 20); if (!isFinite(x) || !isFinite(y)) break;
        let label;
        if (e.type === 'MTEXT') label = decodeM(e.p.filter((q) => q[0] === 3 || q[0] === 1).map((q) => q[1]).join(''));
        else label = decode(first(e, 1) || '').trim();
        if (label) push(ln, color, { type: 'Point', coordinates: [x, y] }, { name: label.substring(0, 200), isText: true, textHeight: num(e, 40, 1), rotation: num(e, 50, 0) });
        break;
      }
      case 'INSERT': { const x = num(e, 10), y = num(e, 20); if (isFinite(x) && isFinite(y)) push(ln, color, { type: 'Point', coordinates: [x, y] }, { name: (first(e, 2) || 'Block').trim(), block: (first(e, 2) || '').trim(), 'marker-color': color }); break; }
      default: break;
    }
  }
  const groups = new Map();
  feats.forEach((f) => { const n = f.properties.layer; if (!groups.has(n)) groups.set(n, []); groups.get(n).push(f); });
  const layers = Array.from(groups, ([name, features]) => ({ name: groups.size === 1 ? `${baseName(filename)} — ${name}` : name, features, style: { color: layerColor(name) } }));
  // اگر مختصات به‌وضوح درجه بود، سیستم مختصات معلوم است
  let crs; if (!looksProjected(feats) && feats.length) crs = 'wgs84';
  return { layers: layers.length ? layers : [{ name: baseName(filename), features: [] }], crs, dxfNoCrs: true };
}

/* ───────────── فایل‌های نقطه‌ای (txt / csv / xlsx / pts …) ───────────── */
function splitLine(line, d) {
  if (d === ' ') return line.trim().split(/\s+/);
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === d) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out.map((s) => s.trim());
}
function detectDelimiter(lines) {
  const sample = lines.slice(0, 15); let best = ' ', bestScore = -1;
  for (const d of [',', ';', '\t', '|', ' ']) {
    const counts = sample.map((l) => splitLine(l, d).length);
    const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)];
    if (mode < 2) continue;
    const same = counts.filter((c) => c === mode).length / counts.length;
    const score = same * 10 + Math.min(mode, 8) / 10;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}
function textToRows(text) {
  let lines = text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l && !/^(#|\/\/|;)/.test(l));
  // فایل‌های .pts معمولاً خط اول فقط تعداد نقاط است
  if (lines.length > 1 && /^\d+$/.test(lines[0]) && /\s|,|;|\t/.test(lines[1])) lines = lines.slice(1);
  if (!lines.length) return [];
  const d = detectDelimiter(lines);
  return lines.map((l) => splitLine(l, d));
}
const HDR = {
  name: /^(id|name|point|pt|pid|pnt|no|num|number|label|station|شماره|نام|نقطه|ش|کد ?نقطه)$/i,
  x: /^(x|e|east|easting|lon|lng|long|longitude|طول|شرقی|مختصات ?x)$/i,
  y: /^(y|n|north|northing|lat|latitude|عرض|شمالی|مختصات ?y)$/i,
  z: /^(z|h|elev|elevation|height|alt|altitude|ارتفاع)$/i,
  code: /^(code|desc|description|note|notes|remark|remarks|feature|کد|توضیح|توضیحات|شرح)$/i
};
function analyzeTable(rows) {
  const n = rows.length; if (!n) throw new Error('فایل خالی است.');
  const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
  const r0 = rows[0], r1 = rows[1] || [];
  let header = false;
  for (let c = 0; c < width; c++) {
    if (r1[c] !== undefined && r1[c] !== '' && isNumStr(r1[c]) && r0[c] !== undefined && r0[c] !== '' && !isNumStr(r0[c])) header = true;
  }
  if (n === 1) header = r0.some((x) => x !== '' && !isNumStr(x));
  const data = header ? rows.slice(1) : rows;
  const names = []; for (let c = 0; c < width; c++) names.push(header && String(r0[c] || '').trim() ? String(r0[c]).trim() : 'ستون ' + (c + 1));
  const sample = data.slice(0, 40);
  const colNum = (c) => sample.every((r) => r[c] === undefined || r[c] === '' || isNumStr(r[c])) && sample.some((r) => r[c] !== undefined && r[c] !== '');
  const colCoordLike = (c) => {
    if (!colNum(c)) return false;
    const vs = sample.map((r) => toNum(r[c])).filter((v) => isFinite(v));
    return vs.some((v) => Math.abs(v - Math.round(v)) > 1e-9) || vs.some((v) => Math.abs(v) >= 1000);
  };
  const map = { name: -1, x: -1, y: -1, z: -1, code: -1 };
  if (header) {
    names.forEach((h, c) => { for (const k of ['name', 'x', 'y', 'z', 'code']) if (map[k] < 0 && HDR[k].test(h)) { map[k] = c; break; } });
  }
  if (map.x < 0 || map.y < 0) {
    let a = -1;
    for (let c = 0; c + 1 < width; c++) if (colCoordLike(c) && colCoordLike(c + 1)) { a = c; break; }
    if (a >= 0) {
      map.x = a; map.y = a + 1;
      if (map.name < 0 && a > 0) map.name = a - 1;
      if (map.z < 0 && a + 2 < width && colNum(a + 2)) map.z = a + 2;
      if (map.code < 0) { for (let c = (map.z >= 0 ? map.z : a + 1) + 1; c < width; c++) { map.code = c; break; } }
    }
  }
  // مفهوم دو ستون مختصات: درجه / UTM و ترتیب
  let crs = 'wgs84', swap = false;
  if (map.x >= 0 && map.y >= 0) {
    const va = sample.map((r) => toNum(r[map.x])).filter(isFinite), vb = sample.map((r) => toNum(r[map.y])).filter(isFinite);
    const med = (arr) => arr.slice().sort((p, q) => p - q)[Math.floor(arr.length / 2)];
    const ma = med(va), mb = med(vb);
    if (Math.abs(ma) <= 180 && Math.abs(mb) <= 180) {
      crs = 'wgs84';
      // اگر ستون اول شبیه عرض ایران و دومی شبیه طول باشد، جابه‌جا می‌کنیم
      if (!header || !(HDR.x.test(names[map.x]) && HDR.y.test(names[map.y]))) {
        if (ma >= 24 && ma <= 40 && mb >= 43 && mb <= 64) swap = true;
        else if (!(ma >= 43 && ma <= 64 && mb >= 24 && mb <= 40) && Math.abs(ma) <= 90 && Math.abs(mb) > Math.abs(ma)) swap = true;
      }
    } else {
      crs = 'utm';
      if (ma >= 1000000 && mb < 1000000) swap = true;
    }
  }
  return { header, names, data, map, crs, swap, width };
}
function tableToFeatures(table, map, opts) {
  const { data, names } = table;
  const crsId = opts.crs || 'wgs84', swap = !!opts.swap;
  const toWgs = CRS.toWgs(crsId);
  const feats = []; let skipped = 0, seq = 0;
  const used = new Set(Object.values(map).filter((c) => c >= 0));
  for (const r of data) {
    let a = toNum(r[map.x]), b = toNum(r[map.y]);
    if (!isFinite(a) || !isFinite(b)) { skipped++; continue; }
    // تعریف: ستون «x» همان محور شرقی/طول و ستون «y» شمالی/عرض است؛ swap برای فایل‌هایی که برعکس‌اند
    let X = swap ? b : a, Y = swap ? a : b;
    const w = toWgs([X, Y]);
    if (!isFinite(w[0]) || !isFinite(w[1]) || Math.abs(w[1]) > 90 || Math.abs(w[0]) > 180) { skipped++; continue; }
    const z = map.z >= 0 ? toNum(r[map.z]) : NaN;
    const props = {};
    seq++;
    props.name = map.name >= 0 && r[map.name] !== undefined && String(r[map.name]).trim() !== '' ? String(r[map.name]).trim() : String(seq);
    if (isFinite(z)) props.z = z;
    if (map.code >= 0 && r[map.code] !== undefined && String(r[map.code]).trim() !== '') props.code = String(r[map.code]).trim();
    names.forEach((h, c) => { if (!used.has(c) && r[c] !== undefined && String(r[c]).trim() !== '') props[h] = r[c]; });
    feats.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: isFinite(z) ? [w[0], w[1], z] : [w[0], w[1]] } });
  }
  return { features: feats, skipped };
}
async function parseTableFile(file, buf) {
  const ext = extOf(file.name);
  let rows;
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm' || ext === 'ods') {
    const wb = lib().XLSX.read(new Uint8Array(buf), { type: 'array' });
    let pick = null;
    for (const sn of wb.SheetNames) { const aoa = lib().XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' }); if (aoa.some((r) => r.some((c) => c !== ''))) { pick = aoa; break; } }
    if (!pick) throw new Error('فایل اکسل داده‌ای ندارد.');
    rows = pick.filter((r) => r.some((c) => c !== ''));
  } else {
    rows = textToRows(decodeText(buf));
  }
  const t = analyzeTable(rows); t.fileName = file.name; return t;
}

/* ───────────── ورودی اصلی ───────────── */
const TABLE_EXT = new Set(['txt', 'csv', 'tsv', 'dat', 'pts', 'xyz', 'asc', 'xlsx', 'xls', 'xlsm', 'ods', 'prn', 'pnt', 'neu', 'enz']);
async function parseFiles(files) {
  files = Array.from(files);
  const out = [];
  const shpLoose = files.filter((f) => /\.(shp|dbf|prj|cpg)$/i.test(f.name));
  if (shpLoose.length) {
    const r = await parseShapeLoose(shpLoose);
    out.push(Object.assign({ kind: 'vector', fileName: shpLoose[0].name }, r));
  }
  for (const f of files) {
    if (shpLoose.includes(f)) continue;
    const ext = extOf(f.name);
    try {
      let r;
      if (ext === 'geojson' || ext === 'json' || ext === 'topojson') {
        const text = decodeText(await readBuf(f)); let probe = null; try { probe = JSON.parse(text); } catch (e) { /* خطا در parseGeoJSON گزارش می‌شود */ }
        if (probe && probe.format === 'fieldmap-project' && probe.project) { out.push({ kind: 'project', fileName: f.name, project: probe.project }); continue; }
        r = parseGeoJSON(text, f.name);
      }
      else if (ext === 'kml') r = parseKML(decodeText(await readBuf(f)), f.name);
      else if (ext === 'kmz') r = await parseKMZ(await readBuf(f), f.name);
      else if (ext === 'gpx') r = parseGPX(decodeText(await readBuf(f)), f.name);
      else if (ext === 'dxf') r = parseDXF(decodeText(await readBuf(f)), f.name);
      else if (ext === 'dwg') throw new Error('فرمت DWG در گوشی پشتیبانی نمی‌شود؛ فایل را در اتوکد به DXF تبدیل کنید.');
      else if (ext === 'zip') {
        const buf = await readBuf(f), zip = await lib().JSZip.loadAsync(buf);
        const names = Object.keys(zip.files);
        if (names.some((n) => /\.shp$/i.test(n))) r = await parseShapeZip(buf, f.name);
        else if (names.some((n) => /\.kml$/i.test(n))) r = await parseKMZ(buf, f.name);
        else throw new Error('داخل zip نه شیپ‌فایل بود و نه KML.');
      }
      else if (TABLE_EXT.has(ext)) { const t = await parseTableFile(f, await readBuf(f)); out.push({ kind: 'table', fileName: f.name, table: t }); continue; }
      else throw new Error('فرمت .' + ext + ' شناخته نشد.');
      // CRS: اگر معلوم نیست و مختصات «تصویرشده» است باید از کاربر پرسید
      let needsCrs = false;
      if (r.crs === undefined) { const all = [].concat(...r.layers.map((l) => l.features)); needsCrs = looksProjected(all); if (!needsCrs) r.crs = 'wgs84'; }
      out.push({ kind: 'vector', fileName: f.name, layers: r.layers, crs: r.crs, needsCrs });
    } catch (e) { out.push({ kind: 'error', fileName: f.name, error: e.message || String(e) }); }
  }
  return out;
}
function applyCrs(imp, crsId) {
  const fn = CRS.toWgs(crsId);
  imp.layers.forEach((l) => { l.features = reprojectFeatures(l.features, fn); });
  imp.crs = crsId; imp.needsCrs = false; return imp;
}

/* ───────────── خروجی‌ها ───────────── */
const esc = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
const STYLE_KEYS = new Set(['stroke', 'stroke-width', 'stroke-opacity', 'fill', 'fill-opacity', 'marker-color', 'marker-size', 'color', 'styleUrl', 'icon', 'visibility', 'isText', 'textHeight', 'rotation', 'isCircle', 'radius', '_label', '_lx', '_ly', '_lh']);
function kmlColor(hex, opacity) {
  const [r, g, b] = hexToRgb(hex || '#e8641b'); const a = Math.round(255 * (opacity == null ? 1 : opacity));
  const h = (v) => v.toString(16).padStart(2, '0'); return h(a) + h(b) + h(g) + h(r);
}
function kmlGeom(g) {
  const pt = (c) => `${c[0]},${c[1]}${c.length > 2 ? ',' + c[2] : ''}`;
  const ring = (r) => `<LinearRing><coordinates>${r.map(pt).join(' ')}</coordinates></LinearRing>`;
  const poly = (p) => `<Polygon><outerBoundaryIs>${ring(p[0])}</outerBoundaryIs>${p.slice(1).map((r) => `<innerBoundaryIs>${ring(r)}</innerBoundaryIs>`).join('')}</Polygon>`;
  switch (g.type) {
    case 'Point': return `<Point><coordinates>${pt(g.coordinates)}</coordinates></Point>`;
    case 'LineString': return `<LineString><tessellate>1</tessellate><coordinates>${g.coordinates.map(pt).join(' ')}</coordinates></LineString>`;
    case 'Polygon': return poly(g.coordinates);
    case 'MultiPoint': return `<MultiGeometry>${g.coordinates.map((c) => `<Point><coordinates>${pt(c)}</coordinates></Point>`).join('')}</MultiGeometry>`;
    case 'MultiLineString': return `<MultiGeometry>${g.coordinates.map((l) => `<LineString><coordinates>${l.map(pt).join(' ')}</coordinates></LineString>`).join('')}</MultiGeometry>`;
    case 'MultiPolygon': return `<MultiGeometry>${g.coordinates.map(poly).join('')}</MultiGeometry>`;
    case 'GeometryCollection': return `<MultiGeometry>${g.geometries.map(kmlGeom).join('')}</MultiGeometry>`;
    default: return '';
  }
}
function toKML(layers, docName) {
  const placemark = (f, layerColor) => {
    const p = f.properties || {}, g = f.geometry; if (!g) return '';
    const col = p.stroke || p['marker-color'] || p.color || layerColor || '#e8641b';
    let style;
    if (g.type === 'Point' || g.type === 'MultiPoint') {
      const ICONS = { circle: 'shapes/placemark_circle', square: 'shapes/placemark_square', diamond: 'shapes/placemark_square', triangle: 'shapes/triangle', star: 'shapes/star', cross: 'shapes/cross-hairs', x: 'shapes/cross-hairs', pin: 'paddle/wht-blank', flag: 'shapes/flag', target: 'shapes/target' };
      const sc = p.size ? Math.max(0.6, Math.min(1.8, p.size / 22)) : 1;
      style = `<Style><IconStyle><color>${kmlColor(col)}</color><scale>${sc.toFixed(2)}</scale><Icon><href>http://maps.google.com/mapfiles/kml/${ICONS[p.symbol] || ICONS.circle}.png</href></Icon></IconStyle></Style>`;
    }
    else if (/Polygon/.test(g.type)) style = `<Style><LineStyle><color>${kmlColor(col)}</color><width>${p['stroke-width'] || 2}</width></LineStyle><PolyStyle><color>${kmlColor(p.fill || col, p['fill-opacity'] == null ? 0.25 : p['fill-opacity'])}</color></PolyStyle></Style>`;
    else style = `<Style><LineStyle><color>${kmlColor(col)}</color><width>${p['stroke-width'] || 3}</width></LineStyle></Style>`;
    const ext = Object.keys(p).filter((k) => k !== 'name' && k !== 'description' && !STYLE_KEYS.has(k) && p[k] != null && typeof p[k] !== 'object')
      .map((k) => `<Data name="${esc(k)}"><value>${esc(p[k])}</value></Data>`).join('');
    return `<Placemark><name>${esc(p.name || '')}</name>${p.description ? `<description>${esc(p.description)}</description>` : ''}${style}${ext ? `<ExtendedData>${ext}</ExtendedData>` : ''}${kmlGeom(g)}</Placemark>`;
  };
  const body = layers.map((l) => `<Folder><name>${esc(l.name)}</name>${l.features.map((f) => placemark(f, l.style && l.style.color)).join('')}</Folder>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(docName || 'FieldMap')}</name>${body}</Document></kml>`;
}
function toGPX(layers, docName) {
  const wpt = [], trk = [];
  const pt = (c) => `lat="${c[1]}" lon="${c[0]}"`;
  layers.forEach((l) => l.features.forEach((f) => {
    const g = f.geometry, p = f.properties || {}; if (!g) return;
    const nm = `<name>${esc(p.name || '')}</name>${p.description ? `<desc>${esc(p.description)}</desc>` : ''}`;
    const addPoint = (c) => wpt.push(`<wpt ${pt(c)}>${c.length > 2 ? `<ele>${c[2]}</ele>` : (isFinite(p.z) ? `<ele>${p.z}</ele>` : '')}${nm}</wpt>`);
    const seg = (line) => `<trkseg>${line.map((c) => `<trkpt ${pt(c)}>${c.length > 2 ? `<ele>${c[2]}</ele>` : ''}</trkpt>`).join('')}</trkseg>`;
    if (g.type === 'Point') addPoint(g.coordinates);
    else if (g.type === 'MultiPoint') g.coordinates.forEach(addPoint);
    else if (g.type === 'LineString') trk.push(`<trk>${nm}${seg(g.coordinates)}</trk>`);
    else if (g.type === 'MultiLineString') trk.push(`<trk>${nm}${g.coordinates.map(seg).join('')}</trk>`);
    else if (g.type === 'Polygon') trk.push(`<trk>${nm}${g.coordinates.map(seg).join('')}</trk>`);
    else if (g.type === 'MultiPolygon') trk.push(`<trk>${nm}${g.coordinates.map((pl) => pl.map(seg).join('')).join('')}</trk>`);
  }));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FieldMap" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${esc(docName || 'FieldMap')}</name></metadata>${wpt.join('')}${trk.join('')}</gpx>`;
}
function toDXF(layers, crsId, opts) {
  opts = opts || {};
  const CRLF = '\r\n', fn = CRS.fromWgs(crsId);
  const fmt = (v) => { let n = Number(v); if (!isFinite(n)) n = 0; let s = n.toFixed(4); if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, ''); return s === '' || s === '-' || parseFloat(s) === 0 ? '0' : s; };
  const safe = (nm) => (String(nm || 'Layer').replace(/[^A-Za-z0-9_\-]/g, '_').replace(/_+/g, '_').substring(0, 31)) || 'Layer';
  const encText = (s) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/[^\x20-\x7e]/g, (ch) => '\\U+' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).substring(0, 250);
  const pair = (c, v) => `${c}${CRLF}${String(v)}${CRLF}`;
  const proj = (c) => { const p = fn(c); return [p[0], p[1], c.length > 2 ? c[2] : 0]; };
  // لایه‌ها: هر لایه‌ی پروژه (و لایه‌ی اصلی DXF اگر وجود داشته باشد) یک لایه‌ی DXF
  const layerNames = [], layerColors = new Map(), used = new Set();
  const dxfLayerOf = (l, f) => {
    const raw = (f.properties && f.properties.layer && layers.length === 1) ? f.properties.layer : l.name;
    const col = nearestAci((f.properties && (f.properties.stroke || f.properties['marker-color'] || f.properties.color)) || (l.style && l.style.color));
    let stem = safe(raw), nm = stem, i = 2;
    while (used.has(nm) && layerColors.get(nm) !== col) nm = `${stem.substring(0, 27)}_${i++}`;
    if (!used.has(nm)) { used.add(nm); layerNames.push(nm); layerColors.set(nm, col); }
    return { nm, col };
  };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const track = (c) => { if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0]; if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1]; };
  const items = [];
  layers.forEach((l) => l.features.forEach((f) => {
    const g = f.geometry; if (!g || !g.coordinates) return;
    const { nm, col } = dxfLayerOf(l, f);
    items.push({ f, g, nm, col });
    eachCoord(g, (c) => track(proj(c)));
  }));
  if (!isFinite(minX)) { minX = 0; maxX = 100; minY = 0; maxY = 100; }
  const textH = opts.textHeight || Math.max(maxX - minX, maxY - minY, 1) / 120;
  let ent = '';
  const poly = (nm, col, pts, closed) => {
    pts = pts.map(proj); if (closed && pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
    if (pts.length < 2) return;
    ent += pair(0, 'POLYLINE') + pair(8, nm) + pair(62, col) + pair(66, 1) + pair(70, closed ? 1 : 0) + pair(10, 0) + pair(20, 0) + pair(30, 0);
    pts.forEach((c) => { ent += pair(0, 'VERTEX') + pair(8, nm) + pair(10, fmt(c[0])) + pair(20, fmt(c[1])) + pair(30, fmt(c[2])); });
    ent += pair(0, 'SEQEND') + pair(8, nm);
  };
  const text = (nm, col, c, h, s) => { ent += pair(0, 'TEXT') + pair(8, nm) + pair(62, col) + pair(10, fmt(c[0] + h * 0.6)) + pair(20, fmt(c[1] + h * 0.3)) + pair(30, fmt(c[2])) + pair(40, fmt(h)) + pair(1, encText(s)); };
  items.forEach(({ f, g, nm, col }) => {
    const p = f.properties || {}, co = g.coordinates;
    const point = (c) => {
      const q = proj(c);
      if (p.isCircle && isFinite(p.radius)) ent += pair(0, 'CIRCLE') + pair(8, nm) + pair(62, col) + pair(10, fmt(q[0])) + pair(20, fmt(q[1])) + pair(30, fmt(q[2])) + pair(40, fmt(p.radius));
      else if (p.isText) text(nm, col, q, (isFinite(p.textHeight) && p.textHeight > 0) ? p.textHeight : textH, p.name);
      else {
        ent += pair(0, 'POINT') + pair(8, nm) + pair(62, col) + pair(10, fmt(q[0])) + pair(20, fmt(q[1])) + pair(30, fmt(q[2]));
        if (opts.labels !== false && p.name) text(nm, col, q, textH, p.name);
      }
    };
    if (g.type === 'Point') point(co); else if (g.type === 'MultiPoint') co.forEach(point);
    else if (g.type === 'LineString') poly(nm, col, co, false); else if (g.type === 'MultiLineString') co.forEach((l) => poly(nm, col, l, false));
    else if (g.type === 'Polygon') co.forEach((r) => poly(nm, col, r, true)); else if (g.type === 'MultiPolygon') co.forEach((pl) => pl.forEach((r) => poly(nm, col, r, true)));
  });
  if (!layerNames.length) { layerNames.push('Layer'); layerColors.set('Layer', 7); }
  let d = '';
  d += pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$ACADVER') + pair(1, 'AC1009') + pair(9, '$INSBASE') + pair(10, 0) + pair(20, 0) + pair(30, 0) + pair(9, '$EXTMIN') + pair(10, fmt(minX)) + pair(20, fmt(minY)) + pair(30, 0) + pair(9, '$EXTMAX') + pair(10, fmt(maxX)) + pair(20, fmt(maxY)) + pair(30, 0) + pair(0, 'ENDSEC');
  d += pair(0, 'SECTION') + pair(2, 'TABLES') + pair(0, 'TABLE') + pair(2, 'LTYPE') + pair(70, 1) + pair(0, 'LTYPE') + pair(2, 'CONTINUOUS') + pair(70, 64) + pair(3, 'Solid line') + pair(72, 65) + pair(73, 0) + pair(40, 0) + pair(0, 'ENDTAB');
  d += pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, layerNames.length);
  layerNames.forEach((n) => { d += pair(0, 'LAYER') + pair(2, n) + pair(70, 0) + pair(62, layerColors.get(n) || 7) + pair(6, 'CONTINUOUS'); });
  d += pair(0, 'ENDTAB') + pair(0, 'ENDSEC');
  d += pair(0, 'SECTION') + pair(2, 'ENTITIES') + ent + pair(0, 'ENDSEC') + pair(0, 'EOF');
  return d;
}
function vertexRows(layers, crsId) {
  const rows = [], fn = CRS.fromWgs(crsId);
  const push = (l, p, type, seq, c) => {
    const lat = c[1], lng = c[0], u = crsId && crsId !== 'wgs84' ? null : CRS.utmOf(lat, lng);
    const q = crsId && crsId !== 'wgs84' ? fn([lng, lat]) : [u.easting, u.northing];
    const zone = crsId && crsId !== 'wgs84' ? (CRS.label(crsId)) : `${u.zone}${u.hemi}`;
    rows.push([l.name, p.name || '', type, seq, +lat.toFixed(8), +lng.toFixed(8), +q[0].toFixed(3), +q[1].toFixed(3), zone, c.length > 2 ? c[2] : (isFinite(p.z) ? p.z : ''), p.code || '', p.description || '']);
  };
  layers.forEach((l) => l.features.forEach((f) => {
    const g = f.geometry, p = f.properties || {}; if (!g) return;
    const lines = (cs) => cs.forEach((c, i) => push(l, p, g.type, i + 1, c));
    if (g.type === 'Point') push(l, p, 'Point', 1, g.coordinates);
    else if (g.type === 'MultiPoint') g.coordinates.forEach((c, i) => push(l, p, 'Point', i + 1, c));
    else if (g.type === 'LineString') lines(g.coordinates);
    else if (g.type === 'MultiLineString') g.coordinates.forEach(lines);
    else if (g.type === 'Polygon') g.coordinates.forEach(lines);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((pl) => pl.forEach(lines));
  }));
  return rows;
}
const CSV_HEAD = ['layer', 'name', 'type', 'seq', 'lat', 'lng', 'easting_or_x', 'northing_or_y', 'zone_or_crs', 'z', 'code', 'description'];
function toCSV(layers, crsId) {
  const q = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '\uFEFF' + [CSV_HEAD].concat(vertexRows(layers, crsId)).map((r) => r.map(q).join(',')).join('\r\n');
}
function toXLSX(layers, crsId) {
  const X = lib().XLSX, wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([CSV_HEAD].concat(vertexRows(layers, crsId))), 'Points');
  return new Uint8Array(X.write(wb, { type: 'array', bookType: 'xlsx' }));
}
function flatProps(p) {
  const o = {}; Object.keys(p || {}).forEach((k) => { const v = p[k]; if (v == null || typeof v === 'object' || STYLE_KEYS.has(k)) return; o[k] = (typeof v === 'number' || typeof v === 'string') ? v : String(v); });
  return o;
}
// نوشتن DBF با UTF-8 (کتابخانه‌ی shp-write حروف غیر لاتین را خراب می‌کند)
function utf8Trunc(str, maxBytes) {
  const enc = new TextEncoder(); let out = '';
  for (const ch of String(str)) { if (enc.encode(out + ch).length > maxBytes) break; out += ch; }
  return enc.encode(out);
}
function buildDbf(rowsProps) {
  const keys = [];
  rowsProps.forEach((p) => Object.keys(p).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
  if (!keys.length) keys.push('name');
  const enc = new TextEncoder(), used = new Set(), fields = [];
  keys.forEach((k) => {
    let nm = new TextDecoder().decode(utf8Trunc(k, 10)) || 'f', base = nm, i = 1;
    while (used.has(nm)) { const suf = '_' + (i++); nm = new TextDecoder().decode(utf8Trunc(base, 10 - suf.length)) + suf; }
    used.add(nm);
    const vals = rowsProps.map((p) => p[k]).filter((v) => v !== undefined && v !== null && v !== '');
    const isNum = vals.length > 0 && vals.every((v) => typeof v === 'number' && isFinite(v));
    let len;
    if (isNum) len = 20;
    else len = Math.min(254, Math.max(1, ...vals.map((v) => enc.encode(String(v)).length), 1));
    fields.push({ key: k, name: nm, type: isNum ? 'N' : 'C', len, dec: isNum ? 8 : 0 });
  });
  const headerLen = 32 + fields.length * 32 + 1, recLen = 1 + fields.reduce((a, f) => a + f.len, 0);
  const buf = new Uint8Array(headerLen + recLen * rowsProps.length + 1), dv = new DataView(buf.buffer);
  const d = new Date(); buf[0] = 3; buf[1] = d.getFullYear() - 1900; buf[2] = d.getMonth() + 1; buf[3] = d.getDate();
  dv.setUint32(4, rowsProps.length, true); dv.setUint16(8, headerLen, true); dv.setUint16(10, recLen, true);
  fields.forEach((f, i) => {
    const o = 32 + i * 32; buf.set(enc.encode(f.name), o); buf[o + 11] = f.type.charCodeAt(0); buf[o + 16] = f.len; buf[o + 17] = f.dec;
  });
  buf[headerLen - 1] = 0x0D;
  rowsProps.forEach((p, r) => {
    let o = headerLen + r * recLen; buf[o++] = 0x20;
    fields.forEach((f) => {
      const v = p[f.key]; let bytes;
      if (f.type === 'N') { const t = (v === undefined || v === null || v === '' ? '' : Number(v).toFixed(f.dec)).padStart(f.len, ' '); bytes = enc.encode(t.slice(-f.len)); }
      else { bytes = utf8Trunc(v === undefined || v === null ? '' : v, f.len); }
      buf.fill(0x20, o, o + f.len); buf.set(bytes, o); o += f.len;
    });
  });
  buf[buf.length - 1] = 0x1A;
  return buf;
}
async function toShapefileZip(layers, crsId) {
  const fn = CRS.fromWgs(crsId), JSZip = lib().JSZip, out = new JSZip();
  const classes = [['points', /^(Point|MultiPoint)$/], ['lines', /^(LineString|MultiLineString)$/], ['polygons', /^(Polygon|MultiPolygon)$/]];
  const usedBase = new Set();
  for (const l of layers) {
    const stem = String(l.name).replace(/[\\/:*?"<>|\s]+/g, '_').substring(0, 40) || 'layer';
    for (const [cls, rx] of classes) {
      const fs = l.features.filter((f) => f.geometry && rx.test(f.geometry.type));
      if (!fs.length) continue;
      const props = fs.map((f) => Object.assign({ name: (f.properties && f.properties.name) || '' }, flatProps(f.properties)));
      const gj = { type: 'FeatureCollection', features: fs.map((f, i) => ({ type: 'Feature', properties: { i }, geometry: mapGeom(f.geometry, (c) => { const p = fn(c); return [p[0], p[1]]; }) })) };
      let base = `${stem}_${cls}`, k = 2; while (usedBase.has(base)) base = `${stem}_${cls}_${k++}`; usedBase.add(base);
      const bytes = await lib().shpwrite.zip(gj, { outputType: 'uint8array', compression: 'STORE', types: { point: base, polygon: base, line: base }, prj: CRS.wkt(crsId) });
      const z = await JSZip.loadAsync(bytes);
      for (const n of Object.keys(z.files)) {
        if (z.files[n].dir) continue;
        const name = n.split('/').pop();
        if (/\.dbf$/i.test(name)) { out.file(name, buildDbf(props)); out.file(name.replace(/\.dbf$/i, '.cpg'), 'UTF-8'); }
        else out.file(name, await z.files[n].async('uint8array'));
      }
    }
  }
  if (!Object.keys(out.files).length) throw new Error('هیچ عارضه‌ای برای خروجی شیپ‌فایل وجود ندارد.');
  return out.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
async function toKMZ(layers, docName) {
  const z = new (lib().JSZip)(); z.file('doc.kml', toKML(layers, docName));
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
function toGeoJSON(layers) {
  return JSON.stringify({ type: 'FeatureCollection', features: [].concat(...layers.map((l) => l.features.map((f) => ({ type: 'Feature', geometry: f.geometry, properties: Object.assign({ layer: l.name }, f.properties || {}) })))) }, null, 1);
}
const safeFile = (s) => String(s || 'export').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').substring(0, 60);
// خروجی نهایی: { filename, mime, data(string|Uint8Array) }
async function buildExport(format, layers, opts) {
  opts = opts || {}; const name = safeFile(opts.name), crs = opts.crs || 'wgs84';
  switch (format) {
    case 'geojson': return { filename: name + '.geojson', mime: 'application/geo+json', data: toGeoJSON(layers) };
    case 'kml': return { filename: name + '.kml', mime: 'application/vnd.google-earth.kml+xml', data: toKML(layers, opts.name) };
    case 'kmz': return { filename: name + '.kmz', mime: 'application/vnd.google-earth.kmz', data: await toKMZ(layers, opts.name) };
    case 'gpx': return { filename: name + '.gpx', mime: 'application/gpx+xml', data: toGPX(layers, opts.name) };
    case 'dxf': return { filename: name + '.dxf', mime: 'application/dxf', data: toDXF(layers, crs, opts) };
    case 'csv': return { filename: name + '.csv', mime: 'text/csv', data: toCSV(layers, crs) };
    case 'xlsx': return { filename: name + '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', data: toXLSX(layers, crs) };
    case 'shp': return { filename: name + '_shp.zip', mime: 'application/zip', data: await toShapefileZip(layers, crs) };
    default: throw new Error('فرمت خروجی ناشناخته: ' + format);
  }
}

root.DataIO = { CRS, parseFiles, applyCrs, tableToFeatures, buildExport, looksProjected, reprojectFeatures, mapGeom, eachCoord, aciToHex, nearestAci, extOf, baseName,
  _t: { parseDXF, parseKML, parseGPX, parseGeoJSON, textToRows, analyzeTable, toDXF, toKML, toGPX, toCSV, parseShapeZip, toShapefileZip } };
})(typeof window !== 'undefined' ? window : globalThis);
