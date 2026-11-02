// Bundles src/ into one module (three stays external, loaded from the CDN by the import map)
// and inlines it into index.template.html, writing out/index.html.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const res = await Bun.build({ entrypoints: ['src/main.js'], external: ['three'], format: 'esm', minify: process.argv.includes('--min') });
if (!res.success) { console.error(res.logs); process.exit(1); }
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
const js = (await res.outputs[0].text()).replace(/from\s*["']three["']/g, `from "${THREE_URL}"`);
if (/from\s*["']three["']/.test(js)) throw new Error('bare three import left in bundle');
const html = readFileSync('index.template.html', 'utf8').replace('/*BUNDLE*/', () => js.replace(/<\/script/g, '<\\/script'));
mkdirSync('out', { recursive: true });
writeFileSync('out/index.html', html);
// A local copy wrapped the way the artifact host wraps the page, for the test tools.
writeFileSync('out/test.html', '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>[hidden]{display:none!important}</style></head><body>' + html + '</body></html>');
console.log('out/index.html', (html.length / 1024).toFixed(1) + ' KB');
