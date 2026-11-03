// تبدیل پوشه‌ی تایل‌های ذخیره‌شده‌ی سحاک (برنامه‌ی دسکتاپ قدیمی) به یک فایل GeoJSON برای تشخیص مرز اداری
//   node tools/mvt2pack.mjs <پوشه‌ی لایه، مثلاً SahakMVT/mvtRegUnit> [--z 10] [--out regunit.geojson]
// ساختار پوشه: <لایه>/<z>/<x>/<y>.pbf — اگر --z داده نشود، زومی که بیشترین تایل را دارد (تا ۱۲) انتخاب می‌شود.
import fs from 'node:fs';
import path from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
if (!dir || !fs.existsSync(dir)) { console.error('پوشه‌ی لایه پیدا نشد.\nاستفاده: node tools/mvt2pack.mjs SahakMVT/mvtRegUnit --z 10 --out regunit.geojson'); process.exit(1); }
const layerName = path.basename(path.resolve(dir));
const zooms = fs.readdirSync(dir).filter((z) => /^\d+$/.test(z)).map(Number).sort((a, b) => a - b);
const count = (z) => { let n = 0; for (const x of fs.readdirSync(path.join(dir, String(z)))) n += fs.readdirSync(path.join(dir, String(z), x)).filter((f) => f.endsWith('.pbf')).length; return n; };
let z = opt('z') ? +opt('z') : null;
if (z === null) { let best = -1; for (const zz of zooms) { if (zz > 12) continue; const c = count(zz); if (c >= best) { best = c; z = zz; } } }
if (!zooms.includes(z)) { console.error('زوم ' + z + ' وجود ندارد. زوم‌های موجود: ' + zooms.join(', ')); process.exit(1); }
const out = opt('out', layerName + '.geojson'), feats = []; let tiles = 0;
for (const xs of fs.readdirSync(path.join(dir, String(z)))) {
  for (const f of fs.readdirSync(path.join(dir, String(z), xs))) {
    if (!f.endsWith('.pbf')) continue; const y = +f.replace('.pbf', ''), x = +xs;
    const buf = fs.readFileSync(path.join(dir, String(z), xs, f)); if (buf.length < 16) continue;
    let vt; try { vt = new VectorTile(new PbfReader(buf)); } catch (e) { continue; }
    const layer = vt.layers[layerName] || vt.layers[Object.keys(vt.layers)[0]]; if (!layer) continue; tiles++;
    for (let i = 0; i < layer.length; i++) {
      const ft = layer.feature(i); if (ft.type !== 3) continue;               // فقط چندضلعی
      const g = ft.toGeoJSON(x, y, z).geometry;
      const r5 = (c) => (Array.isArray(c[0]) ? c.map(r5) : [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5]);
      feats.push({ type: 'Feature', properties: ft.properties, geometry: { type: g.type, coordinates: r5(g.coordinates) } });
    }
  }
}
fs.writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features: feats }));
const names = new Set(); for (const f of feats) for (const k of Object.keys(f.properties)) names.add(k);
console.log(`لایه: ${layerName} | زوم ${z} | ${tiles} تایل | ${feats.length} تکه‌چندضلعی → ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
console.log('ستون‌های موجود: ' + [...names].join(', '));
