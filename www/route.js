/* مسیریابی (نشان ← OSRM ← خط مستقیم) و هدایت لحظه‌ای */
(function (root) {
'use strict';
const FM = root.FM, { $, nf, toast, fmtLen, fmtDur, haversine, bearing, store, esc, el } = FM;
const RAD = Math.PI / 180;
let map = null, origin = null, dest = null, routes = [], mode = 'fast', sel = 0, nav = null;
const group = L.layerGroup(), marks = {};

/* ───────────── شبکه ───────────── */
async function httpJson(url, headers) {
  const Http = root.Lib && root.Lib.Http;
  if (Http) {
    const r = await Http.get({ url, headers: headers || {}, responseType: 'json', connectTimeout: 12000, readTimeout: 25000 });
    if (r.status >= 400) throw new Error('HTTP ' + r.status + (r.data && r.data.message ? ' — ' + r.data.message : ''));
    return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  const r = await fetch(url, { headers: headers || {} }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
}
function decodePolyline(str, prec) {
  const f = Math.pow(10, prec || 5); let i = 0, lat = 0, lng = 0; const out = [];
  while (i < str.length) {
    let b, shift = 0, res = 0;
    do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32 && i < str.length + 1);
    lat += (res & 1) ? ~(res >> 1) : (res >> 1); shift = 0; res = 0;
    do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while (b >= 32 && i < str.length + 1);
    lng += (res & 1) ? ~(res >> 1) : (res >> 1); out.push([lat / f, lng / f]);
  }
  return out;
}
const num = (x) => (x && typeof x === 'object' ? Number(x.value) : Number(x)) || 0;
function normLoc(x) {
  if (!x) return null;
  if (Array.isArray(x)) { const a = +x[0], b = +x[1]; if (!isFinite(a) || !isFinite(b)) return null; return (a >= 24 && a <= 40 && b >= 43 && b <= 64) ? [a, b] : [b, a]; } // [lng,lat] → [lat,lng]
  if (typeof x === 'object') { const lat = +(x.lat !== undefined ? x.lat : x.latitude), lng = +(x.lng !== undefined ? x.lng : (x.lon !== undefined ? x.lon : x.longitude)); return isFinite(lat) && isFinite(lng) ? [lat, lng] : null; }
  return null;
}
const MOD = { left: 'به چپ بپیچید', right: 'به راست بپیچید', 'slight left': 'کمی به چپ بپیچید', 'slight right': 'کمی به راست بپیچید', 'sharp left': 'تند به چپ بپیچید', 'sharp right': 'تند به راست بپیچید', straight: 'مستقیم بروید', uturn: 'دور بزنید' };
function faInstr(type, modifier, name, exit) {
  let t;
  switch (type) {
    case 'depart': t = 'حرکت کنید'; break;
    case 'arrive': t = 'به مقصد رسیدید'; break;
    case 'roundabout': case 'rotary': t = 'وارد میدان شوید' + (exit ? ' و از خروجی ' + nf(exit) + ' خارج شوید' : ''); break;
    case 'exit roundabout': case 'exit rotary': t = 'از میدان خارج شوید'; break;
    case 'merge': t = 'به مسیر اصلی وارد شوید'; break;
    case 'on ramp': t = 'وارد رمپ شوید'; break;
    case 'off ramp': t = 'از رمپ خارج شوید'; break;
    case 'fork': t = modifier && /left/.test(modifier) ? 'در دوراهی سمت چپ بمانید' : 'در دوراهی سمت راست بمانید'; break;
    case 'end of road': t = (MOD[modifier] || 'بپیچید') + ' (انتهای جاده)'; break;
    case 'continue': case 'new name': t = 'ادامه دهید'; break;
    default: t = MOD[modifier] || 'ادامه دهید';
  }
  return name && type !== 'arrive' ? t + ' به ' + name : t;
}
const ARROW = (type, mod) => { if (type === 'arrive') return '⚑'; if (/roundabout|rotary/.test(type || '')) return '⟳'; if (/uturn/.test(mod || '')) return '↶'; if (/left/.test(mod || '')) return /slight/.test(mod) ? '↖' : '↰'; if (/right/.test(mod || '')) return /slight/.test(mod) ? '↗' : '↱'; return '↑'; };

const parseSec = (v) => (typeof v === 'string' ? parseFloat(v) : Number(v)) || 0;
function gMan(m) {
  m = String(m || '');
  const side = /LEFT/.test(m) ? 'left' : /RIGHT/.test(m) ? 'right' : '';
  if (/UTURN/.test(m)) return { type: 'turn', mod: 'uturn' };
  if (/ROUNDABOUT/.test(m)) return { type: 'roundabout', mod: side };
  if (/MERGE/.test(m)) return { type: 'merge', mod: side };
  if (/RAMP/.test(m)) return { type: 'on ramp', mod: side };
  if (/FORK/.test(m)) return { type: 'fork', mod: side };
  if (/TURN_SLIGHT/.test(m)) return { type: 'turn', mod: 'slight ' + side };
  if (/TURN_SHARP/.test(m)) return { type: 'turn', mod: 'sharp ' + side };
  if (/TURN/.test(m)) return { type: 'turn', mod: side };
  if (/DEPART/.test(m)) return { type: 'depart', mod: '' };
  if (/NAME_CHANGE/.test(m)) return { type: 'new name', mod: '' };
  return { type: 'continue', mod: 'straight' };
}
function parseGoogle(j) {
  return (j.routes || []).map((r) => {
    const steps = [];
    (r.legs || []).forEach((leg) => (leg.steps || []).forEach((s) => {
      const ni = s.navigationInstruction || {}, m = gMan(ni.maneuver), ll = s.startLocation && s.startLocation.latLng;
      steps.push({ text: ni.instructions || faInstr(m.type, m.mod, ''), dist: s.distanceMeters || 0, loc: ll ? [ll.latitude, ll.longitude] : null, type: m.type, mod: m.mod });
    }));
    const enc = r.polyline && r.polyline.encodedPolyline;
    return { coords: enc ? decodePolyline(enc) : [], distance: r.distanceMeters || 0, duration: parseSec(r.duration), staticDuration: parseSec(r.staticDuration), steps, provider: 'google' };
  }).filter((r) => r.coords.length > 1);
}
function parseOsrm(j) {
  return (j.routes || []).map((r) => {
    const steps = [];
    (r.legs || []).forEach((leg) => (leg.steps || []).forEach((s) => {
      const m = s.maneuver || {};
      steps.push({ text: faInstr(m.type, m.modifier, s.name, m.exit), dist: s.distance, loc: m.location ? [m.location[1], m.location[0]] : null, type: m.type, mod: m.modifier });
    }));
    return { coords: r.geometry.coordinates.map((c) => [c[1], c[0]]), distance: r.distance, duration: r.duration, steps, provider: 'osrm' };
  });
}
async function fetchGoogle(o, d) {
  const key = store.get('googleKey', ''); if (!key) throw new Error('کلید Google Maps Platform وارد نشده است.');
  const Http = root.Lib && root.Lib.Http; if (!Http) throw new Error('لایه‌ی شبکه‌ی بومی در دسترس نیست.');
  const ll = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
  const mask = 'routes.duration,routes.staticDuration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.startLocation,routes.legs.steps.navigationInstruction';
  const r = await Http.post({ url: 'https://routes.googleapis.com/directions/v2:computeRoutes', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mask }, data: { origin: ll(o), destination: ll(d), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE', computeAlternativeRoutes: true, languageCode: 'fa', units: 'METRIC' }, responseType: 'json', connectTimeout: 15000, readTimeout: 25000 });
  const j = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  if (r.status >= 400) throw new Error('HTTP ' + r.status + (j && j.error && j.error.message ? ' — ' + j.error.message : ''));
  const rs = parseGoogle(j || {}); if (!rs.length) throw new Error('گوگل مسیری برنگرداند.'); return rs;
}
async function fetchOsrm(o, d) {
  const j = await httpJson(`https://router.project-osrm.org/route/v1/driving/${o.lng},${o.lat};${d.lng},${d.lat}?overview=full&geometries=geojson&steps=true&alternatives=true`);
  if (j.code !== 'Ok') throw new Error('OSRM: ' + (j.message || j.code)); return parseOsrm(j);
}
function directRoute(o, d) {
  const dist = haversine(o, d);
  return [{ coords: [[o.lat, o.lng], [d.lat, d.lng]], distance: dist, duration: dist / 1.3, steps: [{ text: 'مستقیم به سمت مقصد بروید', dist, loc: [o.lat, o.lng], type: 'depart' }, { text: 'به مقصد رسیدید', dist: 0, loc: [d.lat, d.lng], type: 'arrive' }], provider: 'direct' }];
}
async function compute(o, d, engine) {
  const tried = [], hasKey = !!store.get('googleKey', '');
  const order = engine === 'auto' ? [hasKey ? 'google' : null, 'osrm', 'direct'].filter(Boolean) : [engine, 'direct'].filter((v, i, a) => a.indexOf(v) === i);
  for (const e of order) {
    try {
      if (e === 'google') return await fetchGoogle(o, d);
      if (e === 'osrm') return await fetchOsrm(o, d);
      if (e === 'direct') { if (tried.length) toast('مسیریابی آنلاین ممکن نشد (' + tried.join(' | ') + ') — خط مستقیم نمایش داده شد.', 6500); return directRoute(o, d); }
    } catch (err) { tried.push((e === 'google' ? 'گوگل' : 'OSRM') + ': ' + (err.message || err)); }
  }
  return directRoute(o, d);
}

/* ───────────── هندسه‌ی مسیر ───────────── */
function prep(r) {
  const c = r.coords, cum = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + haversine({ lat: c[i - 1][0], lng: c[i - 1][1] }, { lat: c[i][0], lng: c[i][1] }));
  r.cum = cum; r.total = cum[cum.length - 1] || 1;
  if (!r.steps.length) r.steps.push({ text: 'مسیر را تا مقصد ادامه دهید', dist: r.distance, loc: r.coords[r.coords.length - 1], type: 'arrive' });
  r.steps.forEach((s) => { s.along = s.loc ? snap(r, { lat: s.loc[0], lng: s.loc[1] }).along : null; });
  return r;
}
function snap(r, p) {
  const c = r.coords, kx = Math.cos(p.lat * RAD) * 111320, ky = 110540; let best = { dist: Infinity, along: 0 };
  for (let i = 0; i < c.length - 1; i++) {
    const ax = (c[i][1] - p.lng) * kx, ay = (c[i][0] - p.lat) * ky, bx = (c[i + 1][1] - p.lng) * kx, by = (c[i + 1][0] - p.lat) * ky;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy; const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.dist) best = { dist: d, along: r.cum[i] + t * (r.cum[i + 1] - r.cum[i]), idx: i };
  }
  return best;
}

/* ───────────── نمایش ───────────── */
const pin = (txt, cls) => L.divIcon({ className: 'route-pin ' + cls, html: `<span>${txt}</span>`, iconSize: [30, 30], iconAnchor: [15, 30] });
function drawMarks() {
  ['o', 'd'].forEach((k) => { if (marks[k]) { map.removeLayer(marks[k]); marks[k] = null; } });
  if (origin) marks.o = L.marker([origin.lat, origin.lng], { icon: pin('A', 'a'), interactive: false }).addTo(map);
  if (dest) marks.d = L.marker([dest.lat, dest.lng], { icon: pin('B', 'b'), interactive: false }).addTo(map);
  $('#r-origin').textContent = origin ? origin.lat.toFixed(5) + ' , ' + origin.lng.toFixed(5) + (origin.me ? ' (موقعیت من)' : '') : 'موقعیت من (GPS)';
  $('#r-dest').textContent = dest ? dest.lat.toFixed(5) + ' , ' + dest.lng.toFixed(5) : 'انتخاب نشده';
}
function pickIndex() {
  if (!routes.length) return 0; let best = 0;
  routes.forEach((r, i) => { const v = mode === 'fast' ? r.duration : r.distance, b = mode === 'fast' ? routes[best].duration : routes[best].distance; if (v < b) best = i; });
  return best;
}
const ENGINE_FA = { google: 'گوگل · با ترافیک', osrm: 'OSRM · بدون ترافیک', direct: 'خط مستقیم' };
function showRoutes(fit) {
  group.clearLayers(); const box = $('#r-summary'), stepsBox = $('#r-steps'); stepsBox.textContent = '';
  if (!routes.length) { box.textContent = ''; $('#r-start').disabled = true; return; }
  sel = pickIndex();
  routes.forEach((r, i) => { if (i !== sel) L.polyline(r.coords, { color: '#7f8c8d', weight: 5, opacity: 0.7, dashArray: '2 8' }).addTo(group); });
  const r = routes[sel];
  L.polyline(r.coords, { color: '#fff', weight: 10, opacity: 0.9 }).addTo(group);
  const line = L.polyline(r.coords, { color: r.provider === 'direct' ? '#e8641b' : '#1f6feb', weight: 6, dashArray: r.provider === 'direct' ? '10 8' : null }).addTo(group);
  const fast = routes.reduce((a, b) => (b.duration < a.duration ? b : a)), short = routes.reduce((a, b) => (b.distance < a.distance ? b : a));
  let html = `<b>${fmtLen(r.distance)}</b> · ${r.provider === 'direct' ? 'حدود ' : ''}${fmtDur(r.duration)} <small>(${ENGINE_FA[r.provider]})</small>`;
  if (r.staticDuration && r.duration - r.staticDuration > 60) html += `<br><small>تأخیر ترافیک: حدود ${fmtDur(r.duration - r.staticDuration)}</small>`;
  if (routes.length > 1) html += `<br><small>سریع‌ترین: ${fmtLen(fast.distance)} / ${fmtDur(fast.duration)} — کوتاه‌ترین: ${fmtLen(short.distance)} / ${fmtDur(short.duration)}</small>`;
  if (r.provider === 'direct') html += '<br><small>مسیر جاده‌ای در دسترس نبود؛ هدایت به‌صورت فاصله و جهت مستقیم تا مقصد است.</small>';
  box.innerHTML = html;
  r.steps.forEach((s) => {
    const row = el('button', { type: 'button', class: 'step', html: `<span class="sa">${ARROW(s.type, s.mod)}</span><span class="st">${esc(s.text)}</span><small>${s.dist ? fmtLen(s.dist) : ''}</small>` });
    row.addEventListener('click', () => { if (s.loc) map.setView(s.loc, Math.max(map.getZoom(), 17)); });
    stepsBox.appendChild(row);
  });
  $('#r-start').disabled = false;
  if (fit) map.fitBounds(line.getBounds(), { padding: [50, 50] });
}
function clear() {
  stopNav(true); routes = []; origin = null; dest = null; group.clearLayers(); drawMarks(); showRoutes(false); $('#r-summary').textContent = '';
}
function setOrigin(ll) { origin = { lat: ll.lat, lng: ll.lng, me: !!ll.me }; drawMarks(); if (FM.openSheet) FM.openSheet('route'); }
function setDest(ll) { dest = { lat: ll.lat, lng: ll.lng }; drawMarks(); if (FM.openSheet) FM.openSheet('route'); }

async function go() {
  if (!dest) { toast('اول مقصد را مشخص کنید.'); return; }
  let o = origin;
  if (!o) { const fix = FM.gps && FM.gps.last(); if (!fix) { FM.gps && FM.gps.start(); toast('موقعیت شما هنوز مشخص نیست؛ مبدا را انتخاب کنید یا چند ثانیه صبر کنید.', 4000); return; } o = { lat: fix.ll.lat, lng: fix.ll.lng, me: true }; }
  $('#r-go').disabled = true; $('#r-summary').textContent = 'در حال مسیریابی…';
  try { routes = (await compute(o, dest, $('#r-engine').value)).map(prep); } catch (e) { toast('خطا: ' + e.message, 5000); routes = []; }
  $('#r-go').disabled = false; showRoutes(true);
}

/* ───────────── هدایت لحظه‌ای ───────────── */
function speak(text) {
  if (!store.get('voice', false) || !root.speechSynthesis) return;
  try { const u = new SpeechSynthesisUtterance(text); u.lang = 'fa-IR'; root.speechSynthesis.cancel(); root.speechSynthesis.speak(u); } catch (e) { /* ignore */ }
}
function startNav() {
  if (!routes.length) return;
  const r = routes[sel]; if (!FM.gps) return; FM.gps.start();
  nav = { route: r, off: 0, lastReroute: 0, spoken: {}, arrived: false };
  $('#nav-hud').hidden = false; document.body.classList.add('navigating'); if (FM.closeSheets) FM.closeSheets(); FM.gps.follow(true);
  toast('هدایت شروع شد. برای دیدن مسیر کامل، صفحه را نگه‌دارید و حرکت دهید.', 3500);
  const fix = FM.gps.last(); if (fix) onFix(fix);
}
function stopNav(silent) {
  nav = null; $('#nav-hud').hidden = true; document.body.classList.remove('navigating'); if (root.speechSynthesis) try { root.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  if (!silent) toast('هدایت پایان یافت.');
}
function hud(icon, instr, dist, rem, rotate) {
  const a = $('#nav-arrow'); a.textContent = icon; a.style.transform = rotate == null ? '' : `rotate(${rotate}deg)`;
  $('#nav-instr').textContent = instr; $('#nav-dist').textContent = dist; $('#nav-rem').textContent = rem;
}
async function reroute(p) {
  nav.lastReroute = Date.now(); toast('از مسیر خارج شدید؛ مسیر جدید محاسبه می‌شود…', 2500);
  try {
    const rs = (await compute({ lat: p.lat, lng: p.lng }, dest, $('#r-engine').value)).map(prep);
    routes = rs; showRoutes(false); nav.route = routes[sel]; nav.off = 0; nav.spoken = {};
  } catch (e) { toast('محاسبه‌ی مسیر جدید ممکن نشد.'); }
}
function onFix(fix) {
  if (!nav || nav.arrived) return;
  const p = fix.ll, r = nav.route;
  if (r.provider === 'direct') {
    const d = haversine(p, dest), brg = bearing(p, dest), h = FM.heading();
    if (d < 8) { nav.arrived = true; hud('⚑', 'به مقصد رسیدید', '', '', null); speak('به مقصد رسیدید'); return; }
    hud('↑', 'به سمت مقصد بروید', fmtLen(d), `جهت ${nf(Math.round(brg))}°`, h == null ? brg : brg - h);
    return;
  }
  const sn = snap(r, p), remain = Math.max(0, r.total - sn.along), eta = (r.duration / (r.distance || 1)) * remain;
  const remTxt = `${fmtLen(remain)} · ${fmtDur(eta)}`;
  if (remain < 20) { nav.arrived = true; hud('⚑', 'به مقصد رسیدید', '', '', null); speak('به مقصد رسیدید'); return; }
  if (sn.dist > 45) { nav.off++; if (nav.off >= 3 && Date.now() - nav.lastReroute > 15000) { reroute(p); return; } } else nav.off = 0;
  let idx = r.steps.findIndex((s, i) => i > 0 && s.along != null && s.along > sn.along + 6);
  if (idx < 0) idx = r.steps.length - 1;
  const s = r.steps[idx] || { text: 'ادامه دهید', type: '', mod: '', along: r.total }, dm = Math.max(0, (s.along != null ? s.along : r.total) - sn.along);
  hud(ARROW(s.type, s.mod), s.text, fmtLen(dm), remTxt, null);
  const bucket = dm < 40 ? 0 : dm < 150 ? 1 : dm < 400 ? 2 : 3;
  if (bucket < 3 && !nav.spoken[idx + ':' + bucket]) { nav.spoken[idx + ':' + bucket] = 1; speak(bucket === 0 ? s.text : `${fmtLen(Math.round(dm / 10) * 10)} دیگر، ${s.text}`); }
}


async function openInGoogleMaps() {
  if (!dest) { toast('اول مقصد را مشخص کنید.'); return; }
  const q = (p) => p.lat.toFixed(6) + ',' + p.lng.toFixed(6);
  let url = 'https://www.google.com/maps/dir/?api=1&destination=' + q(dest) + '&travelmode=driving&dir_action=navigate';
  if (origin && !origin.me) url += '&origin=' + q(origin);
  try { await root.Lib.App.openUrl({ url }); } catch (e) { window.open(url, '_blank'); }
}

/* ───────────── اتصال به رابط ───────────── */
function init(m) {
  map = m; group.addTo(map); drawMarks();
  $('#r-o-me').addEventListener('click', () => { const fix = FM.gps && FM.gps.last(); if (!fix) { FM.gps && FM.gps.start(); toast('در حال یافتن موقعیت…'); return; } setOrigin({ lat: fix.ll.lat, lng: fix.ll.lng, me: true }); });
  $('#r-o-center').addEventListener('click', () => setOrigin(map.getCenter()));
  $('#r-d-center').addEventListener('click', () => setDest(map.getCenter()));
  $('#r-swap').addEventListener('click', () => { const t = origin; origin = dest; dest = t; drawMarks(); });
  $('#r-go').addEventListener('click', go);
  $('#r-clear').addEventListener('click', clear);
  $('#r-gmaps').addEventListener('click', openInGoogleMaps);
  $('#r-traffic').addEventListener('click', () => { const on = FM.tiles.toggleTraffic(map); $('#r-traffic').classList.toggle('on', on); toast(on ? 'نقشه‌ی ترافیک گوگل روشن شد.' : 'به نقشه‌ی قبلی برگشت.'); if (FM.refreshBaseList) FM.refreshBaseList(); });
  $('#r-start').addEventListener('click', startNav);
  $('#nav-stop').addEventListener('click', () => stopNav(false));
  $('#r-engine').value = store.get('engine', 'auto'); $('#r-engine').addEventListener('change', () => store.set('engine', $('#r-engine').value));
  const setMode = (mm) => { mode = mm; $('#r-mode-fast').classList.toggle('on', mm === 'fast'); $('#r-mode-short').classList.toggle('on', mm === 'short'); showRoutes(false); };
  $('#r-mode-fast').addEventListener('click', () => setMode('fast')); $('#r-mode-short').addEventListener('click', () => setMode('short')); setMode('fast');
  const v = $('#nav-voice'); v.checked = store.get('voice', false); v.addEventListener('change', () => { store.set('voice', v.checked); if (v.checked) speak('صدای راهنما روشن شد'); });
  if (FM.gps) FM.gps.onFix(onFix);
}
FM.route = { init, setOrigin, setDest, clear, _t: { decodePolyline, parseGoogle, parseOsrm, snap, prep, faInstr } };
})(window);
