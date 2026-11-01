/* توابع مشترک: متن فارسی، ذخیره‌ی تنظیمات، پیام، پنجره‌ی گفتگو، هندسه */
(function (root) {
'use strict';
const FM = root.FM = root.FM || {};
const $ = (s, el) => (el || document).querySelector(s);
const nf = (n, d = 0) => new Intl.NumberFormat('fa-IR', { maximumFractionDigits: d }).format(n);
const esc = (s) => String(s == null ? '' : s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
};
let toastTimer = null;
function toast(msg, ms) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms || 2800);
}

/* پنجره‌ی گفتگو: dialog({title, body:Node|string, buttons:[{label, primary, value}] }) → Promise(value | null) */
function dialog(opts) {
  return new Promise((resolve) => {
    const ov = document.createElement('div'); ov.className = 'overlay';
    const box = document.createElement('div'); box.className = 'modal'; box.setAttribute('role', 'dialog');
    const h = document.createElement('h2'); h.textContent = opts.title || ''; box.appendChild(h);
    const body = document.createElement('div'); body.className = 'modal-body';
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    box.appendChild(body);
    const row = document.createElement('div'); row.className = 'row modal-btns';
    const close = (v) => { ov.remove(); resolve(v); };
    (opts.buttons || [{ label: 'باشه', primary: true, value: true }]).forEach((b) => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = b.label; if (b.primary) btn.className = 'primary';
      btn.addEventListener('click', async () => {
        if (b.validate) { const ok = await b.validate(); if (ok === false) return; }
        close(typeof b.value === 'function' ? b.value() : b.value);
      });
      row.appendChild(btn);
    });
    box.appendChild(row); ov.appendChild(box); document.body.appendChild(ov);
    const first = box.querySelector('input,select'); if (first && opts.focus !== false) setTimeout(() => first.focus(), 50);
  });
}
async function askText(title, value, extra) {
  const wrap = document.createElement('div');
  const inp = document.createElement('input'); inp.type = 'text'; inp.value = value || ''; inp.className = 'field'; wrap.appendChild(inp);
  let ta = null;
  if (extra && extra.description !== undefined) { ta = document.createElement('textarea'); ta.className = 'field'; ta.rows = 3; ta.placeholder = 'توضیحات (اختیاری)'; ta.value = extra.description || ''; wrap.appendChild(ta); }
  const r = await dialog({ title, body: wrap, buttons: [{ label: 'انصراف', value: null }, { label: 'تأیید', primary: true, value: () => ({ text: inp.value.trim(), description: ta ? ta.value.trim() : undefined }) }] });
  return r;
}
async function confirmBox(title, text) {
  return dialog({ title, body: '<p>' + esc(text) + '</p>', buttons: [{ label: 'انصراف', value: false }, { label: 'تأیید', primary: true, value: true }] });
}
function el(tag, attrs, children) {
  const e = document.createElement(tag);
  Object.keys(attrs || {}).forEach((k) => { if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); });
  (children || []).forEach((c) => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
}

/* هندسه */
const R_EARTH = 6371008.8, RAD = Math.PI / 180;
function haversine(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const y = Math.sin((b.lng - a.lng) * RAD) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lng - a.lng) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
function geodesicArea(pts) {
  const n = pts.length; let area = 0; if (n < 3) return 0;
  for (let i = 0; i < n; i++) { const p1 = pts[i], p2 = pts[(i + 1) % n]; area += ((p2.lng - p1.lng) * RAD) * (2 + Math.sin(p1.lat * RAD) + Math.sin(p2.lat * RAD)); }
  return Math.abs(area * 6378137 * 6378137 / 2);
}
const pathLen = (pts, closed) => { let t = 0; for (let i = 1; i < pts.length; i++) t += haversine(pts[i - 1], pts[i]); if (closed && pts.length > 2) t += haversine(pts[pts.length - 1], pts[0]); return t; };
const fmtLen = (m) => (m < 1000 ? nf(m, m < 100 ? 2 : 1) + ' متر' : nf(m / 1000, 3) + ' کیلومتر');
const fmtArea = (a) => nf(a, a < 100 ? 2 : 1) + ' متر مربع' + (a >= 10000 ? ' (' + nf(a / 10000, 3) + ' هکتار)' : '');
const fmtDur = (s) => { s = Math.round(s / 60); if (s < 60) return nf(Math.max(1, s)) + ' دقیقه'; return nf(Math.floor(s / 60)) + ' ساعت و ' + nf(s % 60) + ' دقیقه'; };
const ll2 = (c) => ({ lat: c[1], lng: c[0] });
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }


/* ───────────── مختصات: نمایش بر اساس انتخاب کاربر (جغرافیایی یا UTM) ───────────── */
const coordFmt = () => store.get('coordFmt', 'geo');
function fmtCoord(lat, lng) {
  if (coordFmt() === 'utm' && root.DataIO) {
    const u = root.DataIO.CRS.utmOf(lat, lng);
    return { text: `UTM ${u.zone}${u.hemi}   E ${u.easting.toFixed(1)}   N ${u.northing.toFixed(1)}`, copy: `${u.easting.toFixed(2)}, ${u.northing.toFixed(2)} (UTM ${u.zone}${u.hemi})`, short: `E ${u.easting.toFixed(1)}  N ${u.northing.toFixed(1)}` };
  }
  const t = lat.toFixed(6) + ', ' + lng.toFixed(6);
  return { text: t, copy: t, short: t };
}

/* ───────────── نمادهای نقطه ───────────── */
const SYMBOLS = [
  { id: 'circle', name: 'دایره' }, { id: 'square', name: 'مربع' }, { id: 'triangle', name: 'مثلث' }, { id: 'diamond', name: 'لوزی' },
  { id: 'star', name: 'ستاره' }, { id: 'cross', name: 'بعلاوه' }, { id: 'x', name: 'ضربدر' }, { id: 'pin', name: 'سنجاق' },
  { id: 'flag', name: 'پرچم' }, { id: 'target', name: 'هدف' }
];
const SYMBOL_COLORS = ['#e8641b', '#d62728', '#1f77b4', '#2ca02c', '#9467bd', '#f1c40f', '#17becf', '#111111', '#ffffff'];
const SYMBOL_SIZES = [[16, 'کوچک'], [22, 'متوسط'], [30, 'بزرگ']];
const ANCHORS = { pin: [0.5, 1], flag: [0.18, 0.96] };
function starPoints() { const pts = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 4.5 : 10, a = (i * 36 - 90) * Math.PI / 180; pts.push((Math.cos(a) * r).toFixed(2) + ',' + (Math.sin(a) * r).toFixed(2)); } return pts.join(' '); }
function symbolSvg(id, color, size) {
  const c = esc(color || '#e8641b'), st = `stroke="#fff" stroke-width="2" stroke-linejoin="round"`;
  let g;
  switch (id) {
    case 'square': g = `<rect x="-8" y="-8" width="16" height="16" rx="1.5" fill="${c}" ${st}/>`; break;
    case 'triangle': g = `<path d="M0,-10 L10,8 L-10,8 Z" fill="${c}" ${st}/>`; break;
    case 'diamond': g = `<path d="M0,-11 L9,0 L0,11 L-9,0 Z" fill="${c}" ${st}/>`; break;
    case 'star': g = `<polygon points="${starPoints()}" fill="${c}" ${st}/>`; break;
    case 'cross': g = `<path d="M-3,-10 H3 V-3 H10 V3 H3 V10 H-3 V3 H-10 V-3 H-3 Z" fill="${c}" ${st}/>`; break;
    case 'x': g = `<g transform="rotate(45)"><path d="M-3,-10 H3 V-3 H10 V3 H3 V10 H-3 V3 H-10 V-3 H-3 Z" fill="${c}" ${st}/></g>`; break;
    case 'pin': g = `<path d="M0,11 C-6,3 -9,-1 -9,-4 A9,9 0 1 1 9,-4 C9,-1 6,3 0,11 Z" fill="${c}" ${st}/><circle cx="0" cy="-4" r="3.2" fill="#fff"/>`; break;
    case 'flag': g = `<path d="M-6,11 V-11" stroke="#333" stroke-width="2.4" stroke-linecap="round"/><path d="M-5,-10 L9,-5 L-5,0 Z" fill="${c}" ${st}/>`; break;
    case 'target': g = `<circle r="9" fill="none" stroke="#fff" stroke-width="5"/><circle r="9" fill="none" stroke="${c}" stroke-width="2.6"/><circle r="2.8" fill="${c}" ${st}/>`; break;
    default: g = `<circle r="8" fill="${c}" ${st}/>`;
  }
  const n = size || 22;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="-12 -12 24 24" style="overflow:visible">${g}</svg>`;
}
function symbolIcon(id, color, size) {
  const n = size || 22, a = ANCHORS[id] || [0.5, 0.5];
  return L.divIcon({ className: 'sym', html: symbolSvg(id, color, n), iconSize: [n, n], iconAnchor: [Math.round(n * a[0]), Math.round(n * a[1])], popupAnchor: [0, -Math.round(n * a[1] * 0.8)] });
}
// کنترل انتخاب نماد (شکل + رنگ + اندازه). خروجی: عنصر با متد get()
function symbolControls(init) {
  const st = Object.assign({ symbol: 'circle', color: '#e8641b', size: 22 }, init || {});
  const wrap = el('div', { class: 'symctl' });
  const grid = el('div', { class: 'sym-grid' }), prev = el('div', { class: 'sym-prev' });
  const refresh = () => {
    prev.innerHTML = symbolSvg(st.symbol, st.color, Math.max(st.size, 28));
    grid.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === st.symbol));
    grid.querySelectorAll('button').forEach((b) => { b.innerHTML = symbolSvg(b.dataset.id, st.color === '#ffffff' ? '#888' : st.color, 26); });
    sw.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.c === st.color));
    sizeSel.value = String(st.size);
  };
  SYMBOLS.forEach((s) => { const b = el('button', { type: 'button', 'data-id': s.id, title: s.name, 'aria-label': s.name }); b.addEventListener('click', () => { st.symbol = s.id; refresh(); }); grid.appendChild(b); });
  const sw = el('div', { class: 'sym-sw' });
  SYMBOL_COLORS.forEach((c) => { const b = el('button', { type: 'button', 'data-c': c, 'aria-label': 'رنگ ' + c, style: `background:${c}` }); b.addEventListener('click', () => { st.color = c; custom.value = c; refresh(); }); sw.appendChild(b); });
  const custom = el('input', { type: 'color', 'aria-label': 'رنگ دلخواه' }); custom.value = /^#[0-9a-f]{6}$/i.test(st.color) ? st.color : '#e8641b';
  custom.addEventListener('input', () => { st.color = custom.value; refresh(); }); sw.appendChild(custom);
  const sizeSel = el('select', { class: 'field', 'aria-label': 'اندازه' }, SYMBOL_SIZES.map(([v, t]) => el('option', { value: String(v), text: t })));
  sizeSel.addEventListener('change', () => { st.size = +sizeSel.value; refresh(); });
  wrap.appendChild(el('div', { class: 'sym-top' }, [prev, el('div', { class: 'sym-size' }, [el('label', { text: 'اندازه' }), sizeSel])]));
  wrap.appendChild(grid); wrap.appendChild(sw); refresh();
  wrap.get = () => Object.assign({}, st);
  return wrap;
}
async function pickSymbol(init, title) {
  const ctl = symbolControls(init);
  return dialog({ title: title || 'نماد نقطه', body: ctl, focus: false, buttons: [{ label: 'انصراف', value: null }, { label: 'تأیید', primary: true, value: () => ctl.get() }] });
}

Object.assign(FM, { $, nf, esc, store, toast, dialog, askText, confirmBox, el, haversine, bearing, geodesicArea, pathLen, fmtLen, fmtArea, fmtDur, ll2, uid, coordFmt, fmtCoord, SYMBOLS, symbolSvg, symbolIcon, symbolControls, pickSymbol });
})(window);
