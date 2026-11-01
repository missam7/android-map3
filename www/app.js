'use strict';
/* هسته‌ی برنامه: نقشه، مختصات (جغرافیایی یا UTM به انتخاب کاربر)، GPS، قطب‌نما، ترسیم، ثبت با نگه‌داشتن انگشت */
(function () {
const FM = window.FM, { $, nf, store, toast, el, dialog, askText, confirmBox, fmtLen, fmtArea, haversine, geodesicArea, pathLen } = FM;
const DIO = window.DataIO;

/* ───────────── نقشه ───────────── */
const saved = store.get('view', null);
const map = L.map('map', { zoomControl: false, attributionControl: false, maxZoom: 22, zoomSnap: 0.5, preferCanvas: true,
  center: saved ? saved.c : [36.2972, 59.6057], zoom: saved ? saved.z : 14 });
FM.map = map;
const draw = { mode: null, pts: [], group: L.layerGroup().addTo(map) };
FM.isDrawingShape = () => draw.mode === 'line' || draw.mode === 'area';

/* ───────────── برگه‌ها ───────────── */
const SHEETS = ['layers', 'project', 'draw', 'route'];
const sheetEl = (n) => $('#sheet-' + n), tabEl = (n) => $('#b-' + n);
function closeSheets() { SHEETS.forEach((n) => { sheetEl(n).hidden = true; tabEl(n).classList.remove('on'); }); }
function openSheet(name) { closeSheets(); sheetEl(name).hidden = false; tabEl(name).classList.add('on'); }
function toggleSheet(name) { const was = !sheetEl(name).hidden; closeSheets(); if (!was) openSheet(name); }
Object.assign(FM, { openSheet, closeSheets });
SHEETS.forEach((n) => tabEl(n).addEventListener('click', () => toggleSheet(n)));

/* ───────────── کلیک روی نقشه ───────────── */
let lastLongPress = 0;
map.on('click', (e) => {
  if (Date.now() - lastLongPress < 800) return;
  if (FM.isDrawingShape()) { addVertex(e.latlng); return; }
  if (FM.vec.parcelMode()) { FM.vec.parcelClick(e.latlng); return; }   // حالت «نقطه» از لمس نقشه استفاده نمی‌کند، پس مانع انتخاب پارسل نیست
  if (!draw.mode) closeSheets();
});

/* ───────────── نقشه‌ی زمینه، لایه‌های رویه و برداری ───────────── */
function renderBaseList() {
  const cur = store.get('base', 'gsat'), box = $('#layer-list'); box.textContent = '';
  FM.tiles.LAYERS.forEach((l) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'layer-item' + (l.id === cur ? ' active' : '');
    b.innerHTML = '<span class="dot"></span><span></span><small></small>'; b.children[1].textContent = l.name; b.children[2].textContent = l.note;
    b.addEventListener('click', () => { if (FM.tiles.setBase(map, l.id)) { renderBaseList(); } });
    box.appendChild(b);
  });
}
FM.refreshBaseList = renderBaseList;
function renderOverlayList() {
  const box = $('#overlay-list'); box.textContent = ''; const st = FM.tiles.overlayState();
  FM.tiles.OVERLAYS.forEach((o) => {
    const cur = st[o.id] || { on: false, opacity: o.opacity };
    const cb = el('input', { type: 'checkbox' }); cb.checked = !!cur.on;
    const rg = el('input', { type: 'range', min: '0.2', max: '1', step: '0.05', 'aria-label': 'شفافیت' }); rg.value = String(cur.opacity);
    cb.addEventListener('change', () => FM.tiles.setOverlay(map, o.id, cb.checked, +rg.value));
    rg.addEventListener('input', () => { if (cb.checked) FM.tiles.setOverlayOpacity(o.id, +rg.value); else { const s2 = FM.tiles.overlayState(); s2[o.id] = Object.assign(s2[o.id] || { on: false }, { opacity: +rg.value }); store.set('overlays', s2); } });
    box.appendChild(el('label', { class: 'ovrow' }, [cb, el('span', { class: 'on-name', text: o.name }), rg]));
  });
}
$('#add-wfs').addEventListener('click', () => FM.vec.addWfsDialog());
$('#clear-cache').addEventListener('click', async () => {
  const n = await FM.tiles.TileCache.count();
  if (!(await confirmBox('پاک کردن کش', `${nf(n)} تایل/لایه‌ی ذخیره‌شده پاک شود؟ بدون اینترنت دیگر این بخش‌ها نمایش داده نمی‌شوند.`))) return;
  await FM.tiles.TileCache.clear(); toast('کش پاک شد.');
});

/* گزینه‌ها */
const optParcel = $('#opt-parcel'), optCross = $('#opt-cross');
optParcel.checked = store.get('parcelManual', false); optCross.checked = store.get('crosshair', true);
function updateModeChip() {
  const on = FM.vec.parcelMode(), c = $('#mode-chip');
  c.hidden = !on; if (on) c.textContent = 'انتخاب پارسل مشهد فعال — روی نقشه بزنید';
}
optParcel.addEventListener('change', () => { store.set('parcelManual', optParcel.checked); updateModeChip(); });
function updateCrosshair() { $('#crosshair').style.display = optCross.checked ? '' : 'none'; }
optCross.addEventListener('change', () => { store.set('crosshair', optCross.checked); updateCrosshair(); });
FM.onBaseChange = () => { updateModeChip(); renderBaseList(); };

/* تنظیمات و کلیدها */
async function settingsDialog() {
  const fld = (label, key, type, ph, hint) => {
    const i = type === 'ta' ? el('textarea', { class: 'field', rows: 3, dir: 'ltr', placeholder: ph }) : el('input', { type: 'text', class: 'field', dir: 'ltr', placeholder: ph });
    i.value = store.get(key, ''); return { i, key, node: el('div', { class: 'frow col' }, [el('label', { text: label }), i].concat(hint ? [el('small', { class: 'hint', text: hint })] : [])) };
  };
  const fs = [
    fld('کلید Google Maps Platform (برای مسیریابی با ترافیک)', 'googleKey', 'in', 'AIza…', 'فعال بودن «Routes API» روی پروژه‌ی گوگل لازم است. بدون کلید، مسیریابی با OSRM یا «باز کردن در Google Maps» انجام می‌شود.'),
    fld('توکن پارسل مشهد (websdi.mashhad.ir)', 'mashhadToken', 'ta', 'eyJ0eXAi…', 'همان مقدار MASHHAD_API_KEY در فایل server.js قدیمی.'),
    fld('کوکی ورود سحاک (برای استان و نواحی ثبتی)', 'sahakCookie', 'ta', 'cookiesession1=…; auth=…', 'مقدار هدر Cookie از مرورگری که در سحاک وارد شده‌اید.'),
    fld('کلید API نقشه‌ی نشان (فقط برای دو لایه‌ی نشان)', 'neshanKey', 'in', 'service.…', '')
  ];
  const body = el('div', {}, fs.map((f) => f.node));
  body.appendChild(el('p', { class: 'hint', text: 'این مقادیر فقط روی همین گوشی ذخیره می‌شوند و داخل برنامه یا پروژه‌ی GitHub نیستند.' }));
  const r = await dialog({ title: 'تنظیمات و کلیدها', body, focus: false, buttons: [{ label: 'انصراف', value: false }, { label: 'ذخیره', primary: true, value: true }] });
  if (!r) return;
  fs.forEach((f) => store.set(f.key, f.i.value.trim()));
  toast('تنظیمات ذخیره شد.'); FM.vec.renderRefList();
}
$('#open-settings').addEventListener('click', settingsDialog);

/* ───────────── مختصات: یکی از دو فرمت به انتخاب کاربر ───────────── */
let lastCopy = '';
function updateReadout() {
  const c = map.getCenter(), f = FM.fmtCoord(c.lat, c.lng);
  $('#ro-text').textContent = f.text; lastCopy = f.copy;
}
function applyFmt() {
  const u = FM.coordFmt() === 'utm';
  $('#fmt-geo').classList.toggle('on', !u); $('#fmt-utm').classList.toggle('on', u);
  updateReadout(); if (gps.last) showGpsChip(); if (FM.project && FM.project.renderManager) FM.project.renderManager();
}
$('#fmt-geo').addEventListener('click', () => { store.set('coordFmt', 'geo'); applyFmt(); });
$('#fmt-utm').addEventListener('click', () => { store.set('coordFmt', 'utm'); applyFmt(); });
map.on('move', updateReadout);
map.on('moveend', () => store.set('view', { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() }));
$('#ro').addEventListener('click', async () => { try { await navigator.clipboard.writeText(lastCopy); toast('مختصات کپی شد.'); } catch (e) { toast('کپی انجام نشد: ' + lastCopy, 4000); } });

/* ───────────── قطب‌نما ───────────── */
const DIRS = ['شمال', 'شمال‌شرق', 'شرق', 'جنوب‌شرق', 'جنوب', 'جنوب‌غرب', 'غرب', 'شمال‌غرب'];
(function ticks() {
  let html = '';
  for (let a = 0; a < 360; a += 30) { const big = a % 90 === 0, r1 = big ? 32 : 38, r2 = 44, rad = (a - 90) * Math.PI / 180;
    html += `<line class="${big ? 'big' : ''}" x1="${(Math.cos(rad) * r1).toFixed(1)}" y1="${(Math.sin(rad) * r1).toFixed(1)}" x2="${(Math.cos(rad) * r2).toFixed(1)}" y2="${(Math.sin(rad) * r2).toFixed(1)}"/>`; }
  $('#c-ticks').innerHTML = html;
})();
let compassHeading = null, smoothed = null, lastOrientAt = 0, gpsHeading = null;
function headingFromEuler(alpha, beta, gamma) {
  const r = Math.PI / 180, a = alpha * r, b = beta * r, g = gamma * r;
  const cA = Math.cos(a), sA = Math.sin(a), sB = Math.sin(b), cB = Math.cos(b), cG = Math.cos(g), sG = Math.sin(g);
  const backX = -cA * sG - sA * sB * cG, backY = -sA * sG + cA * sB * cG, topX = -sA * cB, topY = cA * cB;
  const useTop = Math.hypot(topX, topY) >= Math.hypot(backX, backY);
  return (Math.atan2(useTop ? topX : backX, useTop ? topY : backY) / r + 360) % 360;
}
function onOrient(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
  else if (e.alpha !== null && e.alpha !== undefined && (e.absolute || e.type === 'deviceorientationabsolute')) h = (e.beta === null || e.gamma === null) ? (360 - e.alpha) % 360 : headingFromEuler(e.alpha, e.beta, e.gamma);
  if (h === null || Number.isNaN(h)) return;
  if (smoothed === null) smoothed = h; else { const d = ((h - smoothed + 540) % 360) - 180; smoothed = (smoothed + d * 0.25 + 360) % 360; }
  compassHeading = smoothed; lastOrientAt = Date.now(); renderHeading();
}
window.addEventListener('deviceorientationabsolute', onOrient, true);
window.addEventListener('deviceorientation', onOrient, true);
const currentHeading = () => (gpsHeading !== null ? gpsHeading : compassHeading);
FM.heading = currentHeading;
function renderHeading() {
  const h = currentHeading();
  if (h === null) { $('#c-deg').textContent = '—'; $('#c-dir').textContent = ''; return; }
  $('#c-needle').setAttribute('transform', `rotate(${(-h).toFixed(1)})`);
  $('#c-deg').textContent = nf(Math.round(h)) + '°'; $('#c-dir').textContent = DIRS[Math.round(h / 45) % 8];
  const arrow = document.querySelector('.me .arrow'); if (arrow) arrow.style.transform = `rotate(${h.toFixed(1)}deg)`;
}
setTimeout(() => { if (!lastOrientAt) toast('حسگر قطب‌نمای این گوشی داده نمی‌دهد.'); }, 4500);

/* ───────────── GPS ───────────── */
const gps = { watchId: null, last: null, follow: false, marker: null, circle: null, cbs: [] };
const meIcon = L.divIcon({ className: 'me', iconSize: [44, 44], iconAnchor: [22, 22],
  html: '<div class="arrow"><svg viewBox="-22 -22 44 44"><path class="cone" d="M0,0 L-12,-22 A26,26 0 0 1 12,-22 Z"/><circle class="body" r="8"/></svg></div>' });
function startGps() {
  if (!navigator.geolocation) { toast('GPS روی این دستگاه در دسترس نیست.'); return; }
  if (gps.watchId !== null) return;
  gps.watchId = navigator.geolocation.watchPosition(onFix, onGpsError, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
}
function onGpsError(err) {
  if (err.code === 1) { toast('دسترسی به موقعیت داده نشد. از تنظیمات گوشی مجوز Location را روشن کنید.', 5000); if (gps.watchId !== null) navigator.geolocation.clearWatch(gps.watchId); gps.watchId = null; setFollow(false); }
  else if (err.code === 3) toast('سیگنال GPS ضعیف است؛ به فضای بازتری بروید.');
}
function showGpsChip() {
  const l = gps.last; if (!l) return; const chip = $('#gps-chip'); chip.hidden = false;
  $('#gps-acc').textContent = 'دقت ±' + nf(Math.round(l.accuracy)) + ' متر'; chip.classList.toggle('weak', l.accuracy > 20);
  $('#gps-pos').textContent = FM.fmtCoord(l.ll.lat, l.ll.lng).short;
}
function onFix(pos) {
  const { latitude, longitude, accuracy, heading, speed, altitude } = pos.coords, ll = L.latLng(latitude, longitude), first = !gps.last;
  gps.last = { ll, accuracy, alt: altitude, t: pos.timestamp };
  gpsHeading = (speed !== null && speed > 1.2 && heading !== null && !Number.isNaN(heading)) ? heading : null;
  if (!gps.marker) {
    gps.circle = L.circle(ll, { radius: accuracy, weight: 1, color: '#e8641b', fillColor: '#e8641b', fillOpacity: 0.12, interactive: false }).addTo(map);
    gps.marker = L.marker(ll, { icon: meIcon, interactive: false, zIndexOffset: 1000 }).addTo(map);
  } else { gps.marker.setLatLng(ll); gps.circle.setLatLng(ll).setRadius(accuracy); }
  showGpsChip(); renderHeading();
  if (first) { map.setView(ll, Math.max(map.getZoom(), 17)); setFollow(true); } else if (gps.follow) map.panTo(ll, { animate: true, duration: 0.4 });
  gps.cbs.forEach((cb) => { try { cb(gps.last); } catch (e) { /* ignore */ } });
}
function setFollow(on) { gps.follow = on; $('#b-locate').classList.toggle('following', on); }
map.on('dragstart', () => setFollow(false));
FM.gps = { start: startGps, last: () => gps.last, follow: setFollow, onFix: (cb) => gps.cbs.push(cb) };
$('#b-locate').addEventListener('click', () => {
  closeSheets();
  if (gps.watchId === null) { startGps(); toast('در حال یافتن موقعیت…'); return; }
  if (gps.last) { map.setView(gps.last.ll, Math.max(map.getZoom(), 17)); setFollow(true); } else toast('هنوز موقعیتی دریافت نشده است.');
});

/* ───────────── نماد پیش‌فرض و ثبت نقطه ───────────── */
const defSymbol = () => Object.assign({ symbol: 'circle', color: '#e8641b', size: 22 }, store.get('defSymbol', {}));
function refreshSymbolPreview() { const d = defSymbol(); $('#d-symbol-prev').innerHTML = FM.symbolSvg(d.symbol, d.color, 26); }
$('#d-symbol').addEventListener('click', async () => { const v = await FM.pickSymbol(defSymbol(), 'نماد پیش‌فرض نقطه‌های جدید'); if (!v) return; store.set('defSymbol', v); refreshSymbolPreview(); });
function pointFeature(ll, name, extra) {
  const d = defSymbol(), c = [+ll.lng.toFixed(8), +ll.lat.toFixed(8)]; if (extra && isFinite(extra.z)) c.push(extra.z);
  return { type: 'Feature', properties: Object.assign({ name, saved: new Date().toISOString(), symbol: d.symbol, 'marker-color': d.color, size: d.size }, extra || {}), geometry: { type: 'Point', coordinates: c } };
}
function announcePoint(name, ll) { toast(`نقطه‌ی ${name} ثبت شد — ${FM.fmtCoord(ll.lat, ll.lng).short}`, 3500); }
async function savePointAt(ll, extra) {
  let name = FM.project.nextName('P'), description;
  if (!$('#d-quick').checked) { const r = await askText('ثبت نقطه', name, { description: '' }); if (!r) return; name = r.text || name; description = r.description; }
  const f = pointFeature(ll, name, extra); if (description) f.properties.description = description;
  FM.project.addFeature(f); announcePoint(name, ll); return f;
}

/* ───────────── ثبت نقطه با نگه‌داشتن انگشت (۱ ثانیه) ───────────── */
(function longPress() {
  const LP_MS = 1000, LP_MOVE = 14, ring = $('#lp-ring'), mapEl = map.getContainer();
  let lp = null; const pointers = new Set();
  const cancel = () => { if (lp) { clearTimeout(lp.t); lp = null; } ring.hidden = true; };
  function fire() {
    const { x, y } = lp; cancel();
    if (FM.isDrawingShape()) return;
    lastLongPress = Date.now();
    try { navigator.vibrate && navigator.vibrate(35); } catch (e) { /* ignore */ }
    const ll = map.mouseEventToLatLng({ clientX: x, clientY: y });
    const f = pointFeature(ll, FM.project.nextName('P'));
    FM.project.addFeature(f); announcePoint(f.properties.name, ll);
    setTimeout(() => FM.project.openFeaturePopup(f), 60);
  }
  mapEl.addEventListener('pointerdown', (e) => {
    pointers.add(e.pointerId);
    if (pointers.size > 1) { cancel(); return; }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest && e.target.closest('.leaflet-control, .leaflet-popup, button, a')) return;
    if (FM.isDrawingShape()) return;
    lp = { x: e.clientX, y: e.clientY, t: setTimeout(fire, LP_MS) };
    ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; ring.hidden = false;
    ring.style.animation = 'none'; void ring.offsetWidth; ring.style.animation = '';
  });
  mapEl.addEventListener('pointermove', (e) => { if (lp && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LP_MOVE) cancel(); });
  const up = (e) => { pointers.delete(e.pointerId); cancel(); };
  mapEl.addEventListener('pointerup', up); mapEl.addEventListener('pointercancel', up);
  map.on('movestart zoomstart', cancel);
  mapEl.addEventListener('contextmenu', (e) => e.preventDefault());
})();

/* ───────────── ترسیم خط و چندضلعی ───────────── */
function setDrawMode(m) {
  draw.mode = m; draw.pts = [];
  ['point', 'line', 'area'].forEach((k) => $('#m-' + k).classList.toggle('on', m === k));
  $('#d-shape-btns').style.display = (m === 'line' || m === 'area') ? 'flex' : 'none';
  $('#d-add').textContent = m === 'point' ? 'ثبت نقطه در مرکز نقشه' : 'افزودن رأس در مرکز نقشه';
  $('#d-add-gps').textContent = m === 'point' ? 'ثبت نقطه از موقعیت GPS من' : 'افزودن رأس از موقعیت GPS';
  $('#d-add').disabled = $('#d-add-gps').disabled = !m;
  redraw();
}
function redraw() {
  draw.group.clearLayers();
  const pts = draw.pts, res = $('#m-result'), m = draw.mode;
  if (!m) { res.textContent = 'نوع ترسیم را انتخاب کنید. برای ثبت نقطه‌ی سریع، انگشت را یک ثانیه روی نقشه نگه دارید.'; return; }
  if (m === 'point') { res.textContent = 'نقشه را روی محل مورد نظر ببرید و «ثبت نقطه» را بزنید، یا روی هر جای نقشه انگشت را یک ثانیه نگه دارید.'; return; }
  const st = { color: '#e8641b', weight: 3, interactive: false };
  if (m === 'area' && pts.length >= 3) L.polygon(pts, { ...st, fillOpacity: 0.18 }).addTo(draw.group); else if (pts.length >= 2) L.polyline(pts, st).addTo(draw.group);
  pts.forEach((p) => L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: '#14303a', fillOpacity: 1, interactive: false }).addTo(draw.group));
  const segs = pts.length - 1 + (m === 'area' && pts.length >= 3 ? 1 : 0);
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    L.marker([(a.lat + b.lat) / 2, (a.lng + b.lng) / 2], { interactive: false, icon: L.divIcon({ className: 'seg-label', html: '<span>' + fmtLen(haversine(a, b)) + '</span>', iconSize: [0, 0] }) }).addTo(draw.group);
  }
  if (m === 'line') res.innerHTML = pts.length < 2 ? 'رأس اول را بگذارید (' + nf(pts.length) + ' رأس). با لمس نقشه هم رأس اضافه می‌شود.' : 'طول کل: <b>' + fmtLen(pathLen(pts)) + '</b> (' + nf(pts.length) + ' رأس)';
  else res.innerHTML = pts.length < 3 ? 'برای چندضلعی دست‌کم سه رأس لازم است (' + nf(pts.length) + ' رأس).' : 'مساحت: <b>' + fmtArea(geodesicArea(pts)) + '</b><br>محیط: ' + fmtLen(pathLen(pts, true));
}
function addVertex(ll) { if (FM.isDrawingShape()) { draw.pts.push(L.latLng(ll.lat, ll.lng)); redraw(); } }
$('#d-add').addEventListener('click', () => { if (draw.mode === 'point') savePointAt(map.getCenter()); else addVertex(map.getCenter()); });
$('#d-add-gps').addEventListener('click', () => {
  const fix = gps.last; if (!fix) { startGps(); toast('موقعیت GPS هنوز مشخص نیست؛ چند ثانیه صبر کنید.'); return; }
  if (draw.mode === 'point') savePointAt(fix.ll, { accuracy: Math.round(fix.accuracy), ...(fix.alt != null ? { z: +fix.alt.toFixed(1) } : {}) }); else addVertex(fix.ll);
});
$('#d-undo').addEventListener('click', () => { draw.pts.pop(); redraw(); });
$('#d-clear').addEventListener('click', () => { draw.pts = []; redraw(); });
$('#d-end').addEventListener('click', () => { setDrawMode(null); closeSheets(); });
$('#d-save').addEventListener('click', async () => {
  const pts = draw.pts, line = draw.mode === 'line';
  if (pts.length < (line ? 2 : 3)) { toast(line ? 'دست‌کم دو رأس لازم است.' : 'دست‌کم سه رأس لازم است.'); return; }
  const def = FM.project.nextName(line ? 'L' : 'A'); const r = await askText(line ? 'ذخیره‌ی خط' : 'ذخیره‌ی چندضلعی', def, { description: '' }); if (!r) return;
  const c = pts.map((p) => [+p.lng.toFixed(8), +p.lat.toFixed(8)]);
  const props = { name: r.text || def }; if (r.description) props.description = r.description;
  FM.project.addFeature({ type: 'Feature', properties: props, geometry: line ? { type: 'LineString', coordinates: c } : { type: 'Polygon', coordinates: [c.concat([c[0]])] } });
  toast('ذخیره شد.'); draw.pts = []; redraw();
});
$('#m-point').addEventListener('click', () => setDrawMode('point'));
$('#m-line').addEventListener('click', () => setDrawMode('line'));
$('#m-area').addEventListener('click', () => setDrawMode('area'));

/* ضبط مسیر حرکت (فقط وقتی برنامه باز و صفحه روشن است) */
const rec = { on: false, pts: [], line: null };
function recTick(fix) {
  if (!rec.on || fix.accuracy > 40) return;
  const last = rec.pts[rec.pts.length - 1];
  if (last && haversine(last, fix.ll) < 3) return;
  rec.pts.push(fix.ll); if (!rec.line) rec.line = L.polyline([], { color: '#d62728', weight: 4, interactive: false }).addTo(map); rec.line.setLatLngs(rec.pts);
  $('#d-rec-info').textContent = `${nf(rec.pts.length)} نقطه · ${fmtLen(pathLen(rec.pts))}`;
}
FM.gps.onFix(recTick);
$('#d-rec').addEventListener('click', async () => {
  if (!rec.on) { startGps(); rec.on = true; rec.pts = []; $('#d-rec').textContent = '■ پایان و ذخیره‌ی مسیر'; $('#d-rec').classList.add('rec'); $('#d-rec-info').textContent = 'در حال ضبط… (صفحه را روشن نگه دارید)'; return; }
  rec.on = false; $('#d-rec').textContent = '● شروع ضبط مسیر حرکت'; $('#d-rec').classList.remove('rec');
  if (rec.line) { map.removeLayer(rec.line); rec.line = null; }
  if (rec.pts.length < 2) { $('#d-rec-info').textContent = ''; toast('مسیر خیلی کوتاه بود و ذخیره نشد.'); return; }
  const stamp = new Date(), def = 'مسیر ' + stamp.toLocaleDateString('fa-IR') + ' ' + stamp.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  const r = await askText('ذخیره‌ی مسیر ضبط‌شده', def, { description: '' });
  if (r) { const props = { name: r.text || def, length_m: Math.round(pathLen(rec.pts)) }; if (r.description) props.description = r.description;
    FM.project.addFeature({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: rec.pts.map((p) => [+p.lng.toFixed(8), +p.lat.toFixed(8)]) } }); toast('مسیر ذخیره شد.'); }
  $('#d-rec-info').textContent = ''; rec.pts = [];
});

/* ───────────── شروع ───────────── */
if (!FM.tiles.setBase(map, store.get('base', 'gsat'))) FM.tiles.setBase(map, 'gsat');
FM.tiles.restoreOverlays(map);
renderBaseList(); renderOverlayList(); updateCrosshair(); updateModeChip(); applyFmt(); refreshSymbolPreview();
renderHeading(); setDrawMode(null);
FM.route.init(map);
FM.vec.init(map);
FM.project.init(map);
})();
