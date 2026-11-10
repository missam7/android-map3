/* نوار جستجو: مکان (نشان)، مختصات، کد نوسازی، نقاط پروژه + فرمان صوتی */
(function (root) {
'use strict';
const FM = root.FM, { $, el, esc, toast, store, nf } = FM;
let map = null, items = [], tmr = null;
const key = () => store.get('neshanKey', '') || (root.FM_DEFAULTS && root.FM_DEFAULTS.neshanKey) || '';

const COORD = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,،\s]\s*(-?\d{2,3}(?:\.\d+)?)\s*$/;
const NOSAZI = /^\s*\d{6,}\s*$/;

async function neshanSearch(term) {
  const k = key(); if (!k || !navigator.onLine) return [];
  const c = map.getCenter();
  const q = encodeURIComponent(JSON.stringify({ term, center: { latitude: c.lat, longitude: c.lng } }));
  const url = 'https://api.neshan.org/v3/search?q=' + q;
  try {
    const Http = root.Lib && root.Lib.Http; let j;
    if (Http) { const r = await Http.get({ url, headers: { 'Api-Key': k }, responseType: 'json', connectTimeout: 10000, readTimeout: 15000 }); if (r.status !== 200) return []; j = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; }
    else { const r = await fetch(url, { headers: { 'Api-Key': k } }); if (!r.ok) return []; j = await r.json(); }
    return (j.items || []).map((it) => ({ title: it.title, sub: [it.address, it.neighbourhood, it.region].filter(Boolean).join(' — '),
      lat: it.location.y, lng: it.location.x, kind: 'neshan' }));
  } catch (e) { return []; }
}
function localSearch(term) {
  const t = term.toLowerCase(), out = [];
  try {
    (FM.project.layers() || []).forEach((ly) => (ly.features || []).forEach((f) => {
      const n = String((f.properties && f.properties.name) || '');
      if (!n.toLowerCase().includes(t)) return;
      const g = f.geometry; if (!g) return;
      let lat, lng;
      if (g.type === 'Point') { lng = g.coordinates[0]; lat = g.coordinates[1]; }
      else { const fl = []; (function w(a) { typeof a[0] === 'number' ? fl.push(a) : a.forEach(w); })(g.coordinates); if (!fl.length) return; lng = fl[0][0]; lat = fl[0][1]; }
      out.push({ title: n, sub: 'نقطه‌ی پروژه · ' + ly.name, lat, lng, kind: 'local' });
    }));
  } catch (e) { /* ignore */ }
  return out.slice(0, 8);
}
/* کد نوسازی → پارسل مشهد */
async function nosaziSearch(code) {
  const token = store.get('mashhadToken', '') || (root.FM_DEFAULTS && root.FM_DEFAULTS.mashhadToken) || '';
  if (!token) { toast('توکن پارسل در دسترس نیست.', 4000); return []; }
  const cql = `Code='${String(code).replace(/'/g, '')}'`;
  const url = 'https://websdi.mashhad.ir/api/proxy/geotajak/wfs?service=wfs&request=GetFeature&outputFormat=application/json&typeName=geotajak:features&srsname=EPSG:4326&count=5&startIndex=0&CQL_FILTER=' + encodeURIComponent(cql);
  try {
    const r = await root.Lib.Http.get({ url, headers: { Accept: 'application/json', Authorization: 'Bearer ' + token }, responseType: 'json', connectTimeout: 15000, readTimeout: 25000 });
    if (r.status !== 200) throw new Error('HTTP ' + r.status);
    const j = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    return (j.features || []).map((f) => {
      const fl = []; (function w(a) { typeof a[0] === 'number' ? fl.push(a) : a.forEach(w); })(f.geometry.coordinates);
      const s = fl.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]);
      return { title: 'کد نوسازی ' + code, sub: 'پارسل شهرداری مشهد', lat: s[1] / fl.length, lng: s[0] / fl.length, kind: 'parcel', feat: f };
    });
  } catch (e) { toast('جستجوی کد نوسازی ممکن نشد: ' + e.message, 5000); return []; }
}

function render(list) {
  const box = $('#sr-list'); box.textContent = ''; items = list;
  if (!list.length) { box.appendChild(el('div', { class: 'hint', text: 'نتیجه‌ای نیست.' })); box.hidden = false; return; }
  list.forEach((it, i) => {
    const b = el('button', { type: 'button', class: 'sr-item', html: `<b>${esc(it.title)}</b><small>${esc(it.sub || '')}</small>` });
    b.addEventListener('click', () => pick(i));
    box.appendChild(b);
  });
  box.hidden = false;
}
function pick(i) {
  const it = items[i]; if (!it) return;
  $('#sr-list').hidden = true; $('#sr-input').blur();
  map.setView([it.lat, it.lng], Math.max(map.getZoom(), it.kind === 'parcel' ? 18 : 17));
  if (it.kind === 'parcel') { FM.vec.parcelClick({ lat: it.lat, lng: it.lng }); return; }
  L.popup({ maxWidth: 280 }).setLatLng([it.lat, it.lng]).setContent(`<b>${esc(it.title)}</b><br><small>${esc(it.sub || '')}</small>`).openOn(map);
}
async function run(term) {
  term = (term || '').trim(); if (term.length < 2) { $('#sr-list').hidden = true; return; }
  const m = term.match(COORD);
  if (m) { const lat = +m[1], lng = +m[2]; render([{ title: lat.toFixed(5) + ' , ' + lng.toFixed(5), sub: 'مختصات جغرافیایی', lat, lng, kind: 'coord' }]); return; }
  if (NOSAZI.test(term)) { render(await nosaziSearch(term.trim())); return; }
  const local = localSearch(term);
  render(local); // نتایج محلی فوری
  const far = await neshanSearch(term);
  render(local.concat(far));
}

/* ───────────── فرمان صوتی ───────────── */
async function voice() {
  const btn = $('#sr-mic');
  const SRp = root.Lib && root.Lib.SpeechRecognition;
  if (SRp) {                                   // مسیر بومی اندروید
    try {
      const av = await SRp.available();
      if (!av || !av.available) { toast('تشخیص گفتار روی این گوشی در دسترس نیست (برنامه‌ی Google را به‌روز کنید).', 5000); return; }
      let p = await SRp.checkPermissions();
      if (p.speechRecognition !== 'granted') p = await SRp.requestPermissions();
      if (p.speechRecognition !== 'granted') { toast('اجازه‌ی میکروفون داده نشد.', 4000); return; }
      btn.classList.add('listening'); toast('بفرمایید…', 1500);
      const r = await SRp.start({ language: store.get('voiceLang', 'fa-IR'), maxResults: 1, partialResults: false, popup: false, prompt: 'جستجو' });
      btn.classList.remove('listening');
      const t = r && r.matches && r.matches[0];
      if (t) { $('#sr-input').value = t; run(t); } else toast('چیزی شنیده نشد.', 3000);
    } catch (e) { btn.classList.remove('listening'); toast('شنیدن ممکن نشد: ' + (e.message || e), 4000); }
    return;
  }
  const SR = root.SpeechRecognition || root.webkitSpeechRecognition;   // مرورگر دسکتاپ
  if (!SR) { toast('تشخیص گفتار روی این دستگاه پشتیبانی نمی‌شود.', 4000); return; }
  const r = new SR();
  r.lang = store.get('voiceLang', 'fa-IR'); r.interimResults = false; r.maxAlternatives = 1;
  btn.classList.add('listening');
  r.onresult = (e) => { const t = e.results[0][0].transcript; $('#sr-input').value = t; run(t); };
  r.onerror = (e) => toast('شنیدن ممکن نشد: ' + e.error, 4000);
  r.onend = () => btn.classList.remove('listening');
  try { r.start(); toast('بفرمایید…', 1500); } catch (e) { btn.classList.remove('listening'); }
}


function init(m) {
  map = m;
  const inp = $('#sr-input');
  inp.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => run(inp.value), 350); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(tmr); run(inp.value); } });
  $('#sr-mic').addEventListener('click', voice);
  $('#sr-clear').addEventListener('click', () => { inp.value = ''; $('#sr-list').hidden = true; inp.focus(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#searchbar')) $('#sr-list').hidden = true; });
}
FM.search = { init, run, _t: { neshanSearch, nosaziSearch } };
})(window);
