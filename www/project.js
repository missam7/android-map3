/* پروژه: ذخیره‌ی لایه‌ها/نقاط/ترسیمات در IndexedDB، نمایش روی نقشه، مدیریت لایه، ورود و خروج فایل */
(function (root) {
'use strict';
const FM = root.FM, { $, nf, esc, el, toast, dialog, askText, confirmBox, store } = FM;
const DIO = () => root.DataIO;
const PALETTE = ['#e8641b', '#1f77b4', '#2ca02c', '#9467bd', '#d62728', '#17becf', '#8c564b', '#e377c2'];

/* ───────────── IndexedDB ───────────── */
const DB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    if (!root.indexedDB) return rej(new Error('no idb'));
    const r = indexedDB.open('fieldmap', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('projects', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const rq = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    async list() { const db = await open(); return rq(db.transaction('projects').objectStore('projects').getAll()); },
    async get(id) { const db = await open(); return rq(db.transaction('projects').objectStore('projects').get(id)); },
    async put(p) { const db = await open(); return rq(db.transaction('projects', 'readwrite').objectStore('projects').put(p)); },
    async del(id) { const db = await open(); return rq(db.transaction('projects', 'readwrite').objectStore('projects').delete(id)); }
  };
})();

const P = { map: null, project: null, groups: new Map() };
let saveTimer = null, saveFailedShown = false;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!P.project) return; P.project.updated = Date.now();
    try { await DB.put(P.project); } catch (e) { if (!saveFailedShown) { saveFailedShown = true; toast('ذخیره‌ی پروژه روی گوشی ممکن نشد؛ از «خروجی» پشتیبان بگیرید.', 6000); } }
  }, 500);
}
const withId = (f) => { if (!f.id) f.id = FM.uid(); if (!f.properties) f.properties = {}; return f; };
function newLayer(name, features, extra) {
  const idx = P.project ? P.project.layers.length : 0;
  return Object.assign({ id: FM.uid(), name, visible: true, labels: true, style: { color: PALETTE[idx % PALETTE.length] }, features: (features || []).map(withId) }, extra || {});
}
function newProjectObj(name) {
  const p = { id: FM.uid(), name, created: Date.now(), updated: Date.now(), layers: [], counters: {} };
  p.layers.push({ id: FM.uid(), name: 'نقاط و ترسیمات', visible: true, labels: true, draw: true, style: { color: PALETTE[0] }, features: [] });
  return p;
}
const drawLayer = () => { let l = P.project.layers.find((x) => x.draw); if (!l) { l = newLayer('نقاط و ترسیمات', [], { draw: true }); P.project.layers.unshift(l); } return l; };
function nextName(prefix) { const c = P.project.counters = P.project.counters || {}; c[prefix] = (c[prefix] || 0) + 1; return prefix + c[prefix]; }

/* ───────────── نمایش روی نقشه ───────────── */
function colorOf(f, layer) { const p = f.properties || {}; return p.stroke || p['marker-color'] || p.color || (layer.style && layer.style.color) || '#e8641b'; }
function geomBounds(f) {
  const b = L.latLngBounds([]); DIO().eachCoord(f.geometry, (c) => { if (isFinite(c[0]) && isFinite(c[1])) b.extend([c[1], c[0]]); }); return b;
}
function featureInfo(f) {
  const g = f.geometry; if (!g) return '';
  if (g.type === 'Point') { const [lng, lat] = g.coordinates; return FM.fmtCoord(lat, lng).short; }
  if (/LineString/.test(g.type)) { const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates; return FM.fmtLen(parts.reduce((a, c) => a + FM.pathLen(c.map(FM.ll2)), 0)); }
  if (/Polygon/.test(g.type)) { const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; return FM.fmtArea(polys.reduce((a, pl) => a + FM.geodesicArea(pl[0].slice(0, -1).map(FM.ll2)), 0)); }
  return g.type;
}
function popupFor(f, layer) {
  const p = f.properties || {}, g = f.geometry, wrap = el('div', { class: 'pop' });
  wrap.appendChild(el('div', { class: 'pop-title', text: p.name || '(بدون نام)' }));
  wrap.appendChild(el('div', { class: 'pop-sub', text: layer.name }));
  if (p.description) wrap.appendChild(el('div', { class: 'pop-desc', text: p.description }));
  const rows = [];
  let center = null;
  if (g.type === 'Point') {
    const [lng, lat, z] = g.coordinates; center = { lat, lng };
    rows.push([FM.coordFmt() === 'utm' ? 'مختصات UTM' : 'عرض / طول', FM.fmtCoord(lat, lng).text.replace(/^UTM\s+/, '')]);
    if (z !== undefined || isFinite(p.z)) rows.push(['ارتفاع', String(z !== undefined ? z : p.z)]);
  } else if (/LineString/.test(g.type)) rows.push(['طول', featureInfo(f)]);
  else if (/Polygon/.test(g.type)) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    rows.push(['مساحت', featureInfo(f)]); rows.push(['محیط', FM.fmtLen(polys.reduce((a, pl) => a + FM.pathLen(pl[0].map(FM.ll2)), 0))]);
  }
  const skip = new Set(['name', 'description', 'stroke', 'stroke-width', 'stroke-opacity', 'fill', 'fill-opacity', 'marker-color', 'marker-size', 'color', 'isText', 'textHeight', 'rotation', 'isCircle', 'radius', 'z', 'styleUrl', 'icon', 'visibility', 'symbol', 'size']);
  Object.keys(p).filter((k) => !skip.has(k) && p[k] != null && typeof p[k] !== 'object').slice(0, 14).forEach((k) => rows.push([k, String(p[k])]));
  if (rows.length) {
    const t = el('table', { class: 'pop-tbl' });
    rows.forEach(([k, v]) => t.appendChild(el('tr', {}, [el('th', { text: k }), el('td', { text: v })])));
    wrap.appendChild(t);
  }
  const btns = el('div', { class: 'pop-btns' });
  const add = (label, fn) => btns.appendChild(el('button', { type: 'button', text: label, onclick: fn }));
  if (center && FM.route) { add('مبدا', () => { FM.route.setOrigin(center); P.map.closePopup(); }); add('مقصد', () => { FM.route.setDest(center); P.map.closePopup(); }); }
  if (center) add('کپی', async () => { try { await navigator.clipboard.writeText(FM.fmtCoord(center.lat, center.lng).copy); toast('مختصات کپی شد.'); } catch (e) { toast('کپی انجام نشد.'); } });
  add('ویرایش', () => editFeatureDialog(layer, f));
  add('حذف', () => deleteFeature(layer, f));
  wrap.appendChild(btns);
  return wrap;
}
async function deleteFeature(layer, f) {
  if (!(await confirmBox('حذف', 'این مورد حذف شود؟'))) return;
  layer.features = layer.features.filter((x) => x !== f); P.map.closePopup(); renderLayer(layer); saveSoon(); renderManager();
}
async function editFeatureDialog(layer, f) {
  const p = f.properties = f.properties || {}, g = f.geometry, isPt = g.type === 'Point';
  const body = el('div', {});
  const nm = el('input', { type: 'text', class: 'field', value: p.name || '', 'aria-label': 'نام' }); body.appendChild(nm);
  const ds = el('textarea', { class: 'field', rows: 3, placeholder: 'توضیحات (اختیاری)' }); ds.value = p.description || ''; body.appendChild(ds);
  let sym = null, col = null, wid = null;
  if (isPt) sym = FM.symbolControls({ symbol: p.symbol || layer.symbol || 'circle', color: p['marker-color'] || p.color || (layer.style && layer.style.color) || '#e8641b', size: p.size || layer.size || 22 });
  else {
    col = el('input', { type: 'color', class: 'lcolor wide' }); col.value = /^#[0-9a-f]{6}$/i.test(p.stroke || '') ? p.stroke : ((layer.style && layer.style.color) || '#e8641b');
    wid = el('select', { class: 'field' }, [[2, 'نازک'], [3, 'متوسط'], [5, 'ضخیم'], [8, 'خیلی ضخیم']].map(([v, t]) => el('option', { value: String(v), text: t }))); wid.value = String(p['stroke-width'] || 3);
    body.appendChild(el('div', { class: 'frow' }, [el('label', { text: 'رنگ' }), col])); body.appendChild(el('div', { class: 'frow' }, [el('label', { text: 'ضخامت خط' }), wid]));
  }
  if (sym) body.appendChild(sym);
  const r = await dialog({ title: 'ویرایش', body, focus: false, buttons: [{ label: 'انصراف', value: null }, { label: 'ذخیره', primary: true, value: true }] });
  if (!r) return;
  p.name = nm.value.trim() || p.name; if (ds.value.trim()) p.description = ds.value.trim(); else delete p.description;
  if (sym) { const v = sym.get(); p.symbol = v.symbol; p['marker-color'] = v.color; p.size = v.size; }
  else { p.stroke = col.value; p['stroke-width'] = +wid.value; if (/Polygon/.test(g.type)) p.fill = col.value; }
  renderLayer(layer); saveSoon(); renderManager(); P.map.closePopup();
}
function openFeaturePopup(f) {
  for (const [, grp] of P.groups) {
    let hit = null; grp.eachLayer((l) => { if (l.feature === f) hit = l; });
    if (hit) { try { hit.openPopup(); } catch (e) { /* ignore */ } return true; }
  }
  return false;
}
function focusFeature(layer, f) {
  if (!layer.visible) { layer.visible = true; renderLayer(layer); saveSoon(); renderManager(); }
  const g = f.geometry;
  if (g.type === 'Point') P.map.setView([g.coordinates[1], g.coordinates[0]], Math.max(P.map.getZoom(), 18)); else { const b = geomBounds(f); if (b.isValid()) P.map.fitBounds(b, { padding: [50, 50], maxZoom: 19 }); }
  if (FM.closeSheets) FM.closeSheets();
  setTimeout(() => openFeaturePopup(f), 450);
}
function symbolFor(f, layer) { const p = f.properties || {}; return { symbol: p.symbol || layer.symbol || 'circle', size: p.size || layer.size || 22 }; }
function renderLayer(layer) {
  const old = P.groups.get(layer.id); if (old) { P.map.removeLayer(old); P.groups.delete(layer.id); }
  if (!layer.visible) return;
  const showLabels = layer.labels && layer.features.length <= 600, allowSym = layer.features.length <= 1500;
  const gj = L.geoJSON({ type: 'FeatureCollection', features: layer.features }, {
    pointToLayer(f, ll) {
      const p = f.properties || {}, col = colorOf(f, layer);
      if (p.isCircle && isFinite(p.radius) && p.radius > 0) return L.circle(ll, { radius: p.radius, color: col, weight: 2, fillColor: p.fill || col, fillOpacity: p['fill-opacity'] == null ? 0.1 : p['fill-opacity'] });
      if (p.isText) return L.marker(ll, { icon: L.divIcon({ className: 'dxf-text-icon', html: `<span style="color:${esc(col)}">${esc(p.name)}</span>`, iconSize: [0, 0] }) });
      const sy = symbolFor(f, layer); let m;
      if (sy.symbol !== 'circle' && allowSym) m = L.marker(ll, { icon: FM.symbolIcon(sy.symbol, col, sy.size), keyboard: false });
      else m = L.circleMarker(ll, { radius: Math.max(4, Math.round(sy.size / 3.2)), color: '#fff', weight: 2, fillColor: col, fillOpacity: 1 });
      if (showLabels && p.name) m.bindTooltip(String(p.name), { permanent: true, direction: 'right', offset: [Math.round(sy.size / 2) + 2, 0], className: 'pt-label' });
      return m;
    },
    style(f) {
      const p = f.properties || {}, col = colorOf(f, layer), poly = /Polygon/.test(f.geometry.type);
      return { color: col, weight: p['stroke-width'] || 3, opacity: p['stroke-opacity'] == null ? 1 : p['stroke-opacity'], fillColor: p.fill || col, fillOpacity: poly ? (p['fill-opacity'] == null ? 0.15 : p['fill-opacity']) : 0 };
    },
    onEachFeature(f, lyr) {
      if (f.properties && f.properties.isText) return;
      lyr.bindPopup(() => popupFor(f, layer), { maxWidth: 280 });
      lyr.on('click', (ev) => { if (FM.isDrawingShape && FM.isDrawingShape()) { setTimeout(() => P.map.closePopup(), 0); } else L.DomEvent.stopPropagation(ev); });
    }
  }).addTo(P.map);
  P.groups.set(layer.id, gj);
}
function renderAll() { P.groups.forEach((g) => P.map.removeLayer(g)); P.groups.clear(); P.project.layers.forEach(renderLayer); }
function boundsOf(layers) {
  const b = L.latLngBounds([]);
  layers.forEach((l) => l.features.forEach((f) => DIO().eachCoord(f.geometry, (c) => { if (isFinite(c[0]) && isFinite(c[1])) b.extend([c[1], c[0]]); })));
  return b;
}
function zoomTo(layers) { const b = boundsOf(layers); if (b.isValid()) P.map.fitBounds(b, { padding: [40, 40], maxZoom: 19 }); else toast('عارضه‌ای برای نمایش نیست.'); }

/* ───────────── عملیات روی پروژه ───────────── */
function addLayer(l) { const layer = newLayer(l.name, l.features, { style: l.style, labels: l.labels }); if (l.style) layer.style = l.style; P.project.layers.push(layer); renderLayer(layer); saveSoon(); renderManager(); return layer; }
function addFeature(feature) { const dl = drawLayer(); dl.features.push(withId(feature)); if (!dl.visible) dl.visible = true; renderLayer(dl); saveSoon(); renderManager(); return dl; }
async function loadProject(id) {
  let p = null; try { p = await DB.get(id); } catch (e) { /* ignore */ }
  if (!p) return false; P.project = p; store.set('curProject', id); renderAll(); renderManager(); return true;
}
async function init(map) {
  P.map = map;
  let p = null, list = [];
  try { list = await DB.list(); const cur = store.get('curProject', null); p = list.find((x) => x.id === cur) || list.sort((a, b) => b.updated - a.updated)[0] || null; } catch (e) { /* no idb */ }
  if (!p) { p = newProjectObj('پروژه‌ی من'); try { await DB.put(p); } catch (e) { /* ignore */ } }
  P.project = p; store.set('curProject', p.id);
  renderAll(); renderManager();
  map.on('zoomend', () => { document.body.classList.toggle('hide-labels', map.getZoom() < 15); });
  document.body.classList.toggle('hide-labels', map.getZoom() < 15);
}
async function projectsDialog() {
  for (;;) {
    let list = []; try { list = (await DB.list()).sort((a, b) => b.updated - a.updated); } catch (e) { /* ignore */ }
    const body = el('div', { class: 'plist' });
    let action = null;
    const resolver = { v: null };
    list.forEach((p) => {
      const row = el('div', { class: 'prow' + (p.id === P.project.id ? ' cur' : '') }, [
        el('div', { class: 'pname', html: `<b>${esc(p.name)}</b><small>${nf(p.layers.length)} لایه · ${nf(p.layers.reduce((a, l) => a + l.features.length, 0))} عارضه</small>` })
      ]);
      const mk = (label, act) => row.appendChild(el('button', { type: 'button', text: label, onclick: () => { action = { act, id: p.id }; body.closest('.overlay').querySelector('.modal-btns button:last-child').click(); } }));
      if (p.id !== P.project.id) mk('باز کردن', 'open'); mk('نام', 'rename'); if (list.length > 1) mk('حذف', 'del');
      body.appendChild(row);
    });
    const r = await dialog({ title: 'پروژه‌ها', body, buttons: [{ label: '＋ پروژه‌ی جدید', value: 'new' }, { label: 'بستن', primary: true, value: 'close' }] });
    // دکمه‌های داخل لیست از طریق کلیک دکمه‌ی «بستن» پنجره را می‌بندند و action را پر می‌کنند
    if (action) {
      if (action.act === 'open') { await loadProject(action.id); return; }
      if (action.act === 'rename') { const pr = list.find((x) => x.id === action.id); const t = await askText('نام پروژه', pr.name); if (t && t.text) { pr.name = t.text; await DB.put(pr); if (P.project.id === pr.id) P.project.name = pr.name; renderManager(); } continue; }
      if (action.act === 'del') { const pr = list.find((x) => x.id === action.id); if (await confirmBox('حذف پروژه', `«${pr.name}» با همه‌ی لایه‌هایش حذف شود؟`)) { await DB.del(pr.id); if (P.project.id === pr.id) { const rest = (await DB.list())[0]; await loadProject(rest.id); } } continue; }
    }
    if (r === 'new') { const t = await askText('نام پروژه‌ی جدید', ''); if (t && t.text) { const np = newProjectObj(t.text); await DB.put(np); await loadProject(np.id); return; } continue; }
    return;
  }
}

/* ───────────── پنل لایه‌ها ───────────── */
const expanded = new Set(), listLimit = {}, listFilter = {};
function featureRow(layer, f) {
  const p = f.properties || {}, g = f.geometry || {};
  let icon;
  if (g.type === 'Point') { const sy = symbolFor(f, layer); icon = el('span', { class: 'ficon', html: FM.symbolSvg(sy.symbol, colorOf(f, layer), 20) }); }
  else icon = el('span', { class: 'ficon', text: /Polygon/.test(g.type || '') ? '▭' : '╱', style: `color:${colorOf(f, layer)}` });
  const b = el('button', { type: 'button', class: 'frow-item' }, [icon, el('span', { class: 'ft', html: `<b>${esc(p.name || '(بدون نام)')}</b><small dir="auto">${esc(featureInfo(f))}</small>` })]);
  b.addEventListener('click', () => featureActions(layer, f));
  return b;
}
async function featureActions(layer, f) {
  const p = f.properties || {}, isPt = f.geometry.type === 'Point';
  const body = el('div', {}, [el('div', { class: 'pop-sub', text: layer.name }), el('div', { dir: 'auto', text: featureInfo(f) })]);
  let act = null;
  const go = (a) => { act = a; document.querySelector('.overlay .modal-btns button:last-child').click(); };
  const row = el('div', { class: 'pop-btns' });
  if (isPt && FM.route) { const c = { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }; row.appendChild(el('button', { type: 'button', text: 'مبدا', onclick: () => { FM.route.setOrigin(c); go('x'); } })); row.appendChild(el('button', { type: 'button', text: 'مقصد', onclick: () => { FM.route.setDest(c); go('x'); } })); }
  row.appendChild(el('button', { type: 'button', text: 'ویرایش', onclick: () => go('edit') }));
  row.appendChild(el('button', { type: 'button', text: 'حذف', onclick: () => go('del') }));
  body.appendChild(row);
  await dialog({ title: p.name || '(بدون نام)', body, focus: false, buttons: [{ label: 'بستن', value: 'close' }, { label: '⌖ زوم روی نقشه', primary: true, value: 'zoom' }] }).then((v) => { if (!act && v === 'zoom') act = 'zoom'; });
  if (act === 'zoom') focusFeature(layer, f); else if (act === 'edit') editFeatureDialog(layer, f); else if (act === 'del') deleteFeature(layer, f);
}
function renderManager() {
  const box = $('#project-body'); if (!box || !P.project) return;
  box.textContent = '';
  box.appendChild(el('button', { type: 'button', class: 'proj-name', onclick: projectsDialog, html: `<span>پروژه: <b>${esc(P.project.name)}</b></span><small>تغییر / جدید ▾</small>` }));
  const actions = el('div', { class: 'row' });
  actions.appendChild(el('button', { type: 'button', class: 'primary', text: '＋ افزودن فایل', onclick: () => $('#file-in').click() }));
  actions.appendChild(el('button', { type: 'button', text: 'خروجی', onclick: () => exportDialog() }));
  box.appendChild(actions);
  const list = el('div', { class: 'llist' });
  P.project.layers.forEach((l) => {
    const cb = el('input', { type: 'checkbox', 'aria-label': 'نمایش لایه' }); cb.checked = l.visible;
    cb.addEventListener('change', () => { l.visible = cb.checked; renderLayer(l); saveSoon(); });
    const open = expanded.has(l.id);
    const caret = el('button', { type: 'button', class: 'mini caret', text: open ? '▾' : '◂', 'aria-label': open ? 'بستن فهرست' : 'فهرست عارضه‌ها', onclick: () => { if (open) expanded.delete(l.id); else expanded.add(l.id); renderManager(); } });
    const name = el('button', { type: 'button', class: 'lname', html: `<b>${esc(l.name)}</b><small>${nf(l.features.length)} عارضه${l.draw ? ' · ترسیم‌ها' : ''}</small>`, onclick: () => { if (open) expanded.delete(l.id); else expanded.add(l.id); renderManager(); } });
    const row = el('div', { class: 'lrow' }, [cb, name]);
    const mk = (label, title, fn) => row.appendChild(el('button', { type: 'button', class: 'mini', text: label, title, 'aria-label': title, onclick: fn }));
    mk('نماد', 'نماد و رنگ لایه', async () => { const v = await FM.pickSymbol({ symbol: l.symbol || 'circle', color: (l.style && l.style.color) || '#e8641b', size: l.size || 22 }, 'نماد و رنگ پیش‌فرض لایه'); if (!v) return; l.symbol = v.symbol; l.size = v.size; l.style = Object.assign({}, l.style, { color: v.color }); renderLayer(l); saveSoon(); });
    mk('Aa', 'برچسب‌ها', () => { l.labels = !l.labels; renderLayer(l); saveSoon(); toast(l.labels ? 'برچسب‌ها روشن شد.' : 'برچسب‌ها خاموش شد.'); });
    mk('⌖', 'زوم', () => { zoomTo([l]); });
    mk('✕', 'حذف', async () => {
      if (!(await confirmBox('حذف لایه', `لایه‌ی «${l.name}» با ${nf(l.features.length)} عارضه حذف شود؟`))) return;
      if (l.draw) { l.features = []; renderLayer(l); } else { P.project.layers = P.project.layers.filter((x) => x !== l); const g = P.groups.get(l.id); if (g) P.map.removeLayer(g); P.groups.delete(l.id); }
      saveSoon(); renderManager();
    });
    row.appendChild(caret);
    list.appendChild(row);
    if (open) {
      const fl = el('div', { class: 'flist' });
      const search = el('input', { type: 'search', class: 'field small', placeholder: 'جستجو در نام عارضه‌ها…', value: listFilter[l.id] || '' });
      search.addEventListener('input', () => { listFilter[l.id] = search.value; listLimit[l.id] = 60; fillItems(); });
      fl.appendChild(search);
      const items = el('div', { class: 'fitems' }); fl.appendChild(items);
      const fillItems = () => {
        items.textContent = '';
        const q = (listFilter[l.id] || '').trim().toLowerCase();
        const all = l.features.filter((f) => !q || String((f.properties || {}).name || '').toLowerCase().includes(q));
        const lim = listLimit[l.id] || 60;
        if (!all.length) items.appendChild(el('div', { class: 'hint', text: l.features.length ? 'موردی پیدا نشد.' : 'این لایه عارضه‌ای ندارد.' }));
        all.slice(0, lim).forEach((f) => items.appendChild(featureRow(l, f)));
        if (all.length > lim) items.appendChild(el('button', { type: 'button', class: 'more', text: `نمایش بیشتر (${nf(all.length - lim)} مورد دیگر)`, onclick: () => { listLimit[l.id] = lim + 100; fillItems(); } }));
      };
      fillItems(); list.appendChild(fl);
    }
  });
  box.appendChild(list);
}

/* ───────────── ورود فایل ───────────── */
function selectCrs(defaultId, withMerc) {
  const wrap = el('div', { class: 'crs-sel' });
  const type = el('select', { class: 'field' }, [el('option', { value: 'utm', text: 'UTM (متر)' }), el('option', { value: 'wgs84', text: 'WGS84 جغرافیایی (درجه)' })].concat(withMerc ? [el('option', { value: 'merc', text: 'Web Mercator' })] : []));
  const zone = el('input', { type: 'number', class: 'field', min: 1, max: 60, value: 40, 'aria-label': 'شماره‌ی زون' });
  const hemi = el('select', { class: 'field' }, [el('option', { value: 'N', text: 'شمالی (N)' }), el('option', { value: 'S', text: 'جنوبی (S)' })]);
  const zrow = el('div', { class: 'row' }, [el('label', { text: 'زون' }), zone, hemi]);
  const m = /^utm:(\d+)([NS])$/.exec(defaultId || '');
  if (defaultId === 'wgs84') type.value = 'wgs84'; else if (defaultId === 'merc') type.value = 'merc'; else { type.value = 'utm'; if (m) { zone.value = m[1]; hemi.value = m[2]; } }
  const sync = () => { zrow.style.display = type.value === 'utm' ? 'flex' : 'none'; }; type.addEventListener('change', sync); sync();
  wrap.appendChild(type); wrap.appendChild(zrow);
  wrap.value = () => type.value === 'utm' ? `utm:${Math.min(60, Math.max(1, parseInt(zone.value, 10) || 40))}${hemi.value}` : type.value;
  wrap.setZone = (z) => { zone.value = z; };
  return wrap;
}
const mapZone = () => DIO().CRS.utmZone(P.map.getCenter().lng);
async function askCrs(fileName) {
  const sel = selectCrs('utm:' + mapZone() + 'N', true);
  const body = el('div', {}, [el('p', { text: `مختصات «${fileName}» درجه (جغرافیایی) نیست. سیستم مختصات فایل را مشخص کنید. (مشهد: UTM زون ۴۰ شمالی)` }), sel]);
  const r = await dialog({ title: 'سیستم مختصات فایل', body, buttons: [{ label: 'انصراف', value: null }, { label: 'تأیید', primary: true, value: () => sel.value() }] });
  return r;
}
async function askMapping(imp) {
  const t = imp.table;
  const body = el('div', { class: 'map-dlg' });
  const prev = el('div', { class: 'tbl-wrap' }); const tb = el('table', { class: 'pop-tbl small' });
  tb.appendChild(el('tr', {}, t.names.map((n) => el('th', { text: n }))));
  t.data.slice(0, 4).forEach((r) => tb.appendChild(el('tr', {}, t.names.map((_, i) => el('td', { text: r[i] === undefined ? '' : String(r[i]) })))));
  prev.appendChild(tb); body.appendChild(el('p', { text: `${nf(t.data.length)} ردیف داده در «${imp.fileName}»` })); body.appendChild(prev);
  const sels = {};
  [['name', 'نام نقطه'], ['x', 'X / شرقی / طول'], ['y', 'Y / شمالی / عرض'], ['z', 'ارتفاع (Z)'], ['code', 'کد / توضیح']].forEach(([k, label]) => {
    const s = el('select', { class: 'field' }, [el('option', { value: '-1', text: '— ندارد —' })].concat(t.names.map((n, i) => el('option', { value: String(i), text: n }))));
    s.value = String(t.map[k]); sels[k] = s; body.appendChild(el('div', { class: 'frow' }, [el('label', { text: label }), s]));
  });
  const crsSel = selectCrs(t.crs === 'utm' ? 'utm:' + mapZone() + 'N' : 'wgs84', false); body.appendChild(el('div', { class: 'frow col' }, [el('label', { text: 'سیستم مختصات نقاط' }), crsSel]));
  const swap = el('input', { type: 'checkbox' }); swap.checked = t.swap;
  body.appendChild(el('label', { class: 'chk' }, [swap, ' ستون‌های «X» و «Y» جابه‌جا هستند (اول عرض/شمالی، بعد طول/شرقی)']));
  return dialog({ title: 'ورود نقاط از فایل', body, focus: false, buttons: [{ label: 'انصراف', value: null }, {
    label: 'افزودن نقاط', primary: true,
    validate: () => { if (sels.x.value === '-1' || sels.y.value === '-1') { toast('ستون‌های X و Y را انتخاب کنید.'); return false; } return true; },
    value: () => ({ map: { name: +sels.name.value, x: +sels.x.value, y: +sels.y.value, z: +sels.z.value, code: +sels.code.value }, crs: crsSel.value(), swap: swap.checked })
  }] });
}
async function importFiles(files) {
  files = Array.from(files || []); if (!files.length) return;
  toast('در حال خواندن فایل…', 1500);
  let results; try { results = await DIO().parseFiles(files); } catch (e) { toast('خطا در خواندن فایل: ' + e.message, 6000); return; }
  const added = []; const errs = []; let nFeat = 0, skippedPts = 0;
  for (const r of results) {
    if (r.kind === 'error') { errs.push(`${r.fileName}: ${r.error}`); continue; }
    if (r.kind === 'project') { if (await confirmBox('پروژه‌ی پشتیبان', `پروژه‌ی «${r.project.name}» به‌عنوان پروژه‌ی جدید افزوده شود؟`)) { const np = Object.assign({}, r.project, { id: FM.uid(), updated: Date.now() }); await DB.put(np); await loadProject(np.id); zoomTo(P.project.layers); } continue; }
    if (r.kind === 'vector') {
      if (r.needsCrs) { const id = await askCrs(r.fileName); if (!id) continue; try { DIO().applyCrs(r, id); } catch (e) { errs.push(`${r.fileName}: ${e.message}`); continue; } }
      r.layers.forEach((l) => { if (l.features.length) { added.push(addLayer(l)); nFeat += l.features.length; } else errs.push(`${l.name}: عارضه‌ای نداشت`); });
    } else if (r.kind === 'table') {
      const m = await askMapping(r); if (!m) continue;
      let out; try { out = DIO().tableToFeatures(r.table, m.map, m); } catch (e) { errs.push(`${r.fileName}: ${e.message}`); continue; }
      skippedPts += out.skipped;
      if (!out.features.length) { errs.push(`${r.fileName}: هیچ نقطه‌ی معتبری ساخته نشد؛ ستون‌ها یا سیستم مختصات را بررسی کنید.`); continue; }
      added.push(addLayer({ name: DIO().baseName(r.fileName), features: out.features })); nFeat += out.features.length;
    }
  }
  if (added.length) { zoomTo(added); toast(`${nf(added.length)} لایه با ${nf(nFeat)} عارضه افزوده شد.` + (skippedPts ? ` (${nf(skippedPts)} ردیف نامعتبر رد شد)` : ''), 4500); }
  if (errs.length) await dialog({ title: 'هشدار در ورود فایل', body: '<ul class="errs">' + errs.map((e) => `<li>${esc(e)}</li>`).join('') + '</ul>' });
}

/* ───────────── خروجی ───────────── */
const FORMATS = [
  ['kml', 'KML (گوگل‌ارث)'], ['kmz', 'KMZ'], ['geojson', 'GeoJSON'], ['gpx', 'GPX'], ['dxf', 'DXF (اتوکد)'],
  ['shp', 'Shapefile (zip)'], ['csv', 'CSV (رأس‌ها با UTM)'], ['xlsx', 'Excel (xlsx)'], ['fmproject', 'پشتیبان کامل پروژه (JSON)']
];
function u8ToB64(u8) { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }
async function saveAndShare(out) {
  const Lb = root.Lib; const isBin = out.data instanceof Uint8Array;
  try {
    if (!Lb || !Lb.Filesystem || !(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform())) throw new Error('web');
    const res = await Lb.Filesystem.writeFile({ path: 'exports/' + out.filename, data: isBin ? u8ToB64(out.data) : out.data, directory: Lb.Directory.Cache, encoding: isBin ? undefined : Lb.Encoding.UTF8, recursive: true });
    await Lb.Share.share({ title: out.filename, text: out.filename, url: res.uri, dialogTitle: 'ذخیره یا ارسال خروجی' });
  } catch (e) {
    if (e && /cancel/i.test(String(e.message))) return;
    // مرورگر معمولی (آزمایش روی کامپیوتر)
    const blob = new Blob([out.data], { type: out.mime }); const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = out.filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
}
async function exportDialog(preselect) {
  const body = el('div', { class: 'exp-dlg' });
  body.appendChild(el('div', { class: 'frow col' }, [el('label', { text: 'لایه‌ها' })]));
  const cbs = [];
  const only = preselect && preselect.id ? preselect : null;
  P.project.layers.forEach((l) => {
    const cb = el('input', { type: 'checkbox' }); cb.checked = only ? l === only : (l.visible && l.features.length > 0); cb.disabled = !l.features.length;
    cbs.push([cb, l]); body.appendChild(el('label', { class: 'chk' }, [cb, ` ${l.name} (${nf(l.features.length)})`]));
  });
  const fmt = el('select', { class: 'field' }, FORMATS.map(([v, t]) => el('option', { value: v, text: t }))); fmt.value = store.get('expFmt', 'kml');
  body.appendChild(el('div', { class: 'frow col' }, [el('label', { text: 'فرمت' }), fmt]));
  const crs = selectCrs('utm:' + mapZone() + 'N', false);
  const crsRow = el('div', { class: 'frow col' }, [el('label', { text: 'سیستم مختصات خروجی (DXF / Shapefile / CSV / Excel)' }), crs]); body.appendChild(crsRow);
  const name = el('input', { type: 'text', class: 'field', value: P.project.name }); body.appendChild(el('div', { class: 'frow col' }, [el('label', { text: 'نام فایل' }), name]));
  const sync = () => { crsRow.style.display = /^(dxf|shp|csv|xlsx)$/.test(fmt.value) ? 'flex' : 'none'; }; fmt.addEventListener('change', sync); sync();
  const go = await dialog({ title: 'خروجی گرفتن', body, focus: false, buttons: [{ label: 'انصراف', value: false }, { label: 'ساخت و ارسال', primary: true, value: true }] });
  if (!go) return;
  const layers = cbs.filter(([cb]) => cb.checked).map(([, l]) => l);
  if (!layers.length && fmt.value !== 'fmproject') { toast('هیچ لایه‌ای انتخاب نشده است.'); return; }
  store.set('expFmt', fmt.value);
  try {
    let out;
    if (fmt.value === 'fmproject') out = { filename: (name.value || 'project').replace(/[\\/:*?"<>|]+/g, '_') + '.fmproj.json', mime: 'application/json', data: JSON.stringify({ format: 'fieldmap-project', version: 1, project: P.project }) };
    else out = await DIO().buildExport(fmt.value, layers, { name: name.value || P.project.name, crs: crs.value() });
    await saveAndShare(out);
  } catch (e) { toast('خطا در ساخت خروجی: ' + e.message, 6000); }
}

FM.project = { init, addLayer, addFeature, drawLayer, nextName, zoomTo, importFiles, exportDialog, renderManager, saveSoon, current: () => P.project, boundsOf, selectCrs, focusFeature, openFeaturePopup, editFeatureDialog, renderLayer, groups: P.groups };
$('#file-in').addEventListener('change', async (e) => { const fl = Array.from(e.target.files); e.target.value = ''; await importFiles(fl); });
})(window);
