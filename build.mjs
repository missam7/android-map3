// ساخت www/vendor.js — در `npm install` خودکار اجرا می‌شود.
import { build } from 'esbuild';
await build({
  entryPoints: ['src/vendor.js'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome90'],
  minify: true,
  outfile: 'www/vendor.js',
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  logLevel: 'info'
});
