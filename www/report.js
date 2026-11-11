/* گزارش‌های شهرداری مشهد (عرصه / پروانه / پایان‌کار) — داخل خود برنامه، بدون سرور.
   منطق عیناً از مسیر HTTP فایل server.js (mashhadHttpReport) برداشته شده. */
(function (root) {
'use strict';
const FM = root.FM, { el, esc, toast, dialog } = FM;
const Lb = () => root.Lib;

const PAGE = 'https://eservice.mashhad.ir/fa/page/100670-%D8%A7%D8%B7%D9%84%D8%A7%D8%B9%D8%A7%D8%AA-%D9%85%D9%84%DA%A9.html';
const ORIGIN = 'https://eservice.mashhad.ir';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PACE_MS = 2500, TTL = 30 * 60 * 1000, SESSION_TTL = 5 * 60 * 1000;
const FALLBACK_VALIDATIONS = 'e6a9312f1e9677e662119bfb09ce6330_validations';

const CLAUSES = {
  fshParvaneh: { where: 'M1U2Ywlw4QvyqkvEnUYboRL3kjrDwbnvmv2QrhMQqhg=077', sub: 'XQbw1fC+BJlvISASIJiMyApYKWigXA6AyzrIq5F9OHs=030', order: 'C974lLbvhO4VkvDS16wU4SiKlUHGIPEB5aHD9RwuIEU=008' },
  fshPayankar: { where: 'M1U2Ywlw4QvyqkvEnUYboRL3kjrDwbnvmv2QrhMQqhg=007', sub: 'XQbw1fC+BJlvISASIJiMyApYKWigXA6AyzrIq5F9OHs=093', order: 'C974lLbvhO4VkvDS16wU4SiKlUHGIPEB5aHD9RwuIEU=072' },
  fshArseh:    { where: 'M1U2Ywlw4QvyqkvEnUYboRL3kjrDwbnvmv2QrhMQqhg=062', sub: 'XQbw1fC+BJlvISASIJiMyApYKWigXA6AyzrIq5F9OHs=034', order: 'C974lLbvhO4VkvDS16wU4SiKlUHGIPEB5aHD9RwuIEU=094' }
};
const REPORTS = { land: 'fshArseh', permit: 'fshParvaneh', completion: 'fshPayankar' };
const SECTIONS = [
  { key: 'land', title: 'عرصه', open: true },
  { key: 'permit', title: 'پروانه', open: false },
  { key: 'completion', title: 'پایان‌کار', open: false }
];

/* ───────────── کد نوسازی ───────────── */
const toEn = (s) => String(s).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
                             .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
function parseCode(str) {
  const parts = toEn(str || '').trim().split(/[-–—/]/).map((s) => s.trim());
  if (parts.length !== 7) return null;
  return { c1: parts[6], c2: parts[5], c3: parts[4], c4: parts[3], c5: parts[2], c6: parts[1], c7: parts[0], _complete: parts.join('-') };
}

/* ───────────── شبکه + کوکی ───────────── */
const splitSetCookie = (v) => String(v || '').split(/,(?=\s*[A-Za-z0-9_.\-]+\s*=)/);
function mergeCookies(jar, raw) {
  splitSetCookie(raw).forEach((c) => {
    const kv = String(c).split(';')[0].trim(), i = kv.indexOf('=');
    if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
}
const cookieStr = (jar) => Object.keys(jar).map((k) => k + '=' + jar[k]).join('; ');

async function req(method, url, jar, body) {
  const Http = Lb() && Lb().Http; if (!Http) throw new Error('لایه‌ی شبکه‌ی بومی در دسترس نیست');
  const h = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'fa-IR,fa;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache', Pragma: 'no-cache', 'Upgrade-Insecure-Requests': '1'
  };                       // Accept-Encoding عمداً ست نمی‌شود؛ اندروید خودش gzip را باز می‌کند
  const ck = cookieStr(jar); if (ck) h.Cookie = ck;
  if (method === 'post') { h['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8'; h.Origin = ORIGIN; h.Referer = PAGE; }
  const r = await Http.request({ url, method: method.toUpperCase(), headers: h, data: body, responseType: 'text', connectTimeout: 20000, readTimeout: 60000 });
  const hd = r.headers || {};
  mergeCookies(jar, hd['Set-Cookie'] || hd['set-cookie']);
  return { status: r.status, html: typeof r.data === 'string' ? r.data : String(r.data == null ? '' : r.data) };
}

/* ───────────── پارس HTML ───────────── */
function attr(tag, name) {
  const m = new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i').exec(tag);
  if (!m) return null;
  const v = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : (m[3] || ''));
  return v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function grab(html, name) {
  const re = /<input\b[^>]*>/gi; let t;
  while ((t = re.exec(String(html || '')))) if ((attr(t[0], 'name') || '').trim() === name) return attr(t[0], 'value') || '';
  return '';
}
function strip(s) {
  return String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}
function fragment(html) {
  const h = String(html || ''), cut = '(?=<input[^>]*id="fshInput"|<\\/form>|$)';
  for (const src of ['<div id="fshMainDiv"[\\s\\S]*?' + cut, '<div[^>]*id=["\'][^"\']*(?:MainDiv|ReportDiv|sisReport)[^"\']*["\'][\\s\\S]*?' + cut]) {
    const m = new RegExp(src, 'i').exec(h); if (m && /<td\b/i.test(m[0])) return m[0];
  }
  return h;
}
function parseRows(html) {
  const rows = [], frag = fragment(html), trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m, heads = null, idx = 0;
  while ((m = trRe.exec(frag))) {
    const inner = m[1];
    const cells = [...inner.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((x) => strip(x[1]));
    if (!cells.length) continue;
    if (/class\s*=\s*["'][^"']*list-header/i.test(inner) || /<th\b/i.test(inner)) { heads = cells; idx = 0; continue; }
    if (heads && heads.length === cells.length) {
      idx++; heads.forEach((hd, i) => { if (hd && cells[i]) rows.push({ label: idx > 1 ? hd + ' (' + idx + ')' : hd, value: cells[i] }); });
    } else if (cells.length === 2 && cells[0] && cells[1]) rows.push({ label: cells[0], value: cells[1] });
  }
  return rows;
}
function sanitizeTables(html) {
  let s = String(fragment(html)).replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|select|textarea|button)\b[\s\S]*?<\/\1>/gi, '').replace(/<input\b[^>]*>/gi, '');
  const OK = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'b', 'strong', 'br']);
  s = s.replace(/<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, (m, sl, tag, at) => {
    tag = tag.toLowerCase(); if (!OK.has(tag)) return ''; if (sl) return '</' + tag + '>';
    let o = '';
    if (tag === 'td' || tag === 'th') {
      const cs = /\bcolspan\s*=\s*["']?(\d+)/i.exec(at); if (cs) o += ' colspan="' + cs[1] + '"';
      const rs = /\browspan\s*=\s*["']?(\d+)/i.exec(at); if (rs) o += ' rowspan="' + rs[1] + '"';
    }
    if ((tag === 'tr' || tag === 'td' || tag === 'th') && /list-header/i.test(at)) o += ' class="hd"';
    return '<' + tag + o + '>';
  });
  return s.replace(/\s+/g, ' ').trim();
}
const isBlank = (html) => /کد نوسازی\s*:\s*(?:-\s*){3,}/.test(strip(html));
const polyOk = (p) => { p = String(p || '').trim(); return p.length > 20 && !/[\u0600-\u06FF]/.test(p); };

/* ───────────── ساخت و ارسال فرم ───────────── */
function buildParams(tk, codes, radio) {
  const cl = CLAUSES[radio] || { where: '', sub: '', order: '' }, p = new URLSearchParams();
  for (let i = 1; i <= 7; i++) p.append('nosaziCode' + i, String(codes['c' + i] == null ? '' : codes['c' + i]));
  p.append('reportsRadio', radio);
  p.append('SearchBtn', 'جستجو');
  p.append('x_lat', '/'); p.append('y_lon', '/'); p.append('nosaziCodeComplete', '/');
  p.append('polygon', tk.polygon || '');
  p.append('__sisReportRowCount', '10');
  p.append('__sisReportParamType', 'simple');
  p.append('report_builder_forma', '0');
  const same = tk.forRadio === radio;
  p.append('sisSearchWhereClause', (same && tk.sisSearchWhereClause) || cl.where || '');
  p.append('sisSearchSubWhereClause', (same && tk.sisSearchSubWhereClause) || cl.sub || '');
  p.append('sisSearchOrderByClause', (same && tk.sisSearchOrderByClause) || cl.order || '');
  p.append('formCSRFToken[report_builder_form]', tk.csrf || '');
  p.append('formGenerateTime', tk.formGenerateTime || '');
  p.append('activeFormName', 'report_builder_form');
  p.append('secToken', tk.secToken || '');
  p.append(tk.validationsName, tk.validations || '');
  return p.toString();
}
async function fetchTokens() {
  const jar = {}; let html = '';
  for (let i = 0; i < 2; i++) { html = (await req('get', PAGE, jar)).html; if (grab(html, 'secToken')) break; }
  const vName = (/name\s*=\s*["']([0-9a-f]{32}_validations)["']/i.exec(html) || [])[1] || FALLBACK_VALIDATIONS;
  return { jar, validationsName: vName, forCode: null, forRadio: null,
    csrf: grab(html, 'formCSRFToken[report_builder_form]'),
    formGenerateTime: grab(html, 'formGenerateTime'),
    secToken: grab(html, 'secToken'),
    validations: grab(html, vName),
    sisSearchWhereClause: grab(html, 'sisSearchWhereClause'),
    sisSearchSubWhereClause: grab(html, 'sisSearchSubWhereClause'),
    sisSearchOrderByClause: grab(html, 'sisSearchOrderByClause'),
    polygon: grab(html, 'polygon') };
}
const S = { tk: null, tkAt: 0, lastAt: 0, cache: new Map(), poly: new Map(), queue: Promise.resolve() };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function submit(tk, codes, radio) {
  const wait = PACE_MS - (Date.now() - S.lastAt); if (wait > 0) await sleep(wait);
  const r = await req('post', PAGE, tk.jar, buildParams(tk, codes, radio));
  S.lastAt = Date.now(); tk.forRadio = radio;
  const html = r.html;
  const upd = (k, n) => { const v = grab(html, n); if (v) tk[k] = v; };
  upd('csrf', 'formCSRFToken[report_builder_form]'); upd('formGenerateTime', 'formGenerateTime');
  upd('secToken', 'secToken'); upd('validations', tk.validationsName);
  upd('sisSearchWhereClause', 'sisSearchWhereClause'); upd('sisSearchSubWhereClause', 'sisSearchSubWhereClause');
  upd('sisSearchOrderByClause', 'sisSearchOrderByClause');
  const pv = grab(html, 'polygon'); if (polyOk(pv)) tk.polygon = pv;
  if (r.status !== 200) throw new Error('HTTP ' + r.status + ' — ' + strip(html).slice(0, 120));
  const rows = parseRows(html), tables = sanitizeTables(html), has = /<td\b/i.test(tables);
  if (!has && !rows.length) throw new Error(isBlank(html) ? 'نتیجه خالی بود (این کد در این گزارش رکوردی ندارد)' : 'پاسخ جدول نداشت — ' + strip(html).slice(0, 120));
  return { rows, tablesHtml: has ? tables : '' };
}
async function runReport(codes, which) {
  const radio = REPORTS[which], key = codes._complete;
  if (!S.tk || Date.now() - S.tkAt > SESSION_TTL) { S.tk = await fetchTokens(); S.tkAt = Date.now(); S.tk.forCode = key; }
  const tk = S.tk;
  if (tk.forCode !== key) { tk.sisSearchWhereClause = tk.sisSearchSubWhereClause = tk.sisSearchOrderByClause = ''; tk.polygon = ''; tk.forCode = key; tk.forRadio = null; }
  if (tk.forRadio !== radio) { tk.sisSearchWhereClause = tk.sisSearchSubWhereClause = tk.sisSearchOrderByClause = ''; }
  if (radio === 'fshArseh') {                       // عرصه بدون polygon کار نمی‌کند
    if (!polyOk(tk.polygon) && S.poly.has(key)) tk.polygon = S.poly.get(key);
    if (!polyOk(tk.polygon)) {
      try { const pr = await submit(tk, codes, 'fshParvaneh'); S.cache.set(key + '|permit', { t: Date.now(), p: Promise.resolve(pr) }); } catch (e) { /* فقط برای polygon بود */ }
      tk.sisSearchWhereClause = tk.sisSearchSubWhereClause = tk.sisSearchOrderByClause = ''; tk.forRadio = null;
      if (polyOk(tk.polygon)) S.poly.set(key, tk.polygon);
      else throw new Error('polygon از سرور دریافت نشد؛ اول «پروانه» را باز کنید');
    }
  }
  return submit(tk, codes, radio);
}
function cached(codes, which) {
  const ck = codes._complete + '|' + which, hit = S.cache.get(ck);
  if (hit && Date.now() - hit.t < TTL) return hit.p;
  const p = (S.queue = S.queue.then(() => runReport(codes, which), () => runReport(codes, which)));
  S.cache.set(ck, { t: Date.now(), p });
  p.catch(() => S.cache.delete(ck));
  return p;
}

/* ───────────── رابط کاربری ───────────── */
function renderResult(box, res) {
  box.textContent = '';
  if (res.tablesHtml) { const d = el('div', { class: 'tbl-wrap' }); d.innerHTML = res.tablesHtml; box.appendChild(d); return; }
  const t = el('table', { class: 'pop-tbl' });
  res.rows.forEach((r) => t.appendChild(el('tr', {}, [el('th', { text: r.label }), el('td', { text: r.value })])));
  box.appendChild(t);
}
async function open(codeStr) {
  const codes = parseCode(codeStr);
  if (!codes) { toast('کد نوسازی باید ۷ بخش جداشده با خط تیره باشد (مثل 11-1-16-20-0-0-0).', 5000); return; }
  const body = el('div', { class: 'rep' });
  body.appendChild(el('div', { class: 'pop-sub', text: 'کد نوسازی' }));
  body.appendChild(el('div', { class: 'nosazi', dir: 'ltr', text: codes._complete }));
  const st = {};
  SECTIONS.forEach((s) => {
    const content = el('div', { class: 'rep-body' }); content.hidden = !s.open;
    const cb = el('input', { type: 'checkbox' }); cb.checked = s.open;
    st[s.key] = { content, done: false, busy: false };
    cb.addEventListener('change', () => { content.hidden = !cb.checked; if (cb.checked) load(s); });
    body.appendChild(el('div', { class: 'rep-sec' }, [el('label', { class: 'chk' }, [cb, el('span', { text: s.title })]), content]));
  });
  async function load(s) {
    const o = st[s.key]; if (o.done || o.busy) return; o.busy = true;
    o.content.textContent = ''; o.content.appendChild(el('div', { class: 'hint', text: 'در حال استعلام از سایت شهرداری… (چند ثانیه طول می‌کشد)' }));
    try { renderResult(o.content, await cached(codes, s.key)); o.done = true; }
    catch (e) {
      o.content.textContent = '';
      o.content.appendChild(el('div', { class: 'hint', text: 'خطا: ' + (e.message || e) }));
      o.content.appendChild(el('button', { type: 'button', class: 'mini', text: 'تلاش دوباره', onclick: () => { o.done = false; S.tk = null; load(s); } }));
    }
    o.busy = false;
  }
  load(SECTIONS[0]);
  await dialog({ title: 'اطلاعات ملک — شهرداری مشهد', body, focus: false, buttons: [{ label: 'بستن', value: null }] });
}
FM.report = { open, _t: { parseCode, fetchTokens, parseRows, sanitizeTables } };
})(window);
