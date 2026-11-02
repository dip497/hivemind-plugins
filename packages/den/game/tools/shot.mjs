// Opens out/index.html in headless Chromium, serving it and three.js locally, then runs a
// script of steps from a JSON file: [{set:{...}}, {shot:'name.png'}, {eval:'js'}, {wait:ms}].
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { readFileSync } from 'node:fs';
const [, , hash = '', stepsFile, w = '900', h = '700', query = ''] = process.argv;
const steps = JSON.parse(readFileSync(stepsFile, 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.route('**/*', (route) => {
  const url = route.request().url();
  if (url.includes('three.module.js')) return route.fulfill({ body: readFileSync('three.module.js'), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
  if (url.startsWith('http://den.local/')) return route.fulfill({ body: readFileSync('out/test.html'), contentType: 'text/html' });
  return route.abort();
});
await page.goto('http://den.local/index.html' + query + hash);
await page.waitForFunction(() => window.__den && window.__den.ready, null, { timeout: 60000 }).catch(() => {});
for (const s of steps) {
  if (s.set) await page.evaluate((o) => window.__den.set(o), s.set);
  if (s.eval) console.log('eval:', JSON.stringify(await page.evaluate(s.eval)));
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.shot) { await page.screenshot({ path: 'out/' + s.shot }); console.log('shot', s.shot); }
}
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
