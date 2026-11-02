// A phone-sized screenshot (touch, portrait) and a sound check: unlock audio, play every
// sound once, and report errors.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'], deviceScaleFactor: 1 });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
await page.route('**/*', (route) => {
  const url = route.request().url();
  if (url.includes('three.module.js')) return route.fulfill({ body: readFileSync('three.module.js'), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
  if (url.startsWith('http://den.local/')) return route.fulfill({ body: readFileSync('out/test.html'), contentType: 'text/html' });
  return route.abort();
});
await page.goto('http://den.local/index.html');
await page.waitForFunction(() => window.__den && window.__den.ready, null, { timeout: 120000 });
await page.evaluate(() => { window.__den.pause(true); window.__den.step(1.5); window.__den.draw(); });
console.log('coarse', await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'tris', await page.evaluate(() => window.__den.pup.model.root.userData.triangles), 'buildMs', await page.evaluate(() => Math.round(window.__den.pup.model.root.userData.buildMs)));
await page.screenshot({ path: 'out/phone-0.png' });
await page.tap('#tune-open');
await page.evaluate(() => window.__den.draw());
await page.screenshot({ path: 'out/phone-tune.png' });
const sound = await page.evaluate(async () => {
  const v = window.__den.voice;
  v.unlock();
  await new Promise((r) => setTimeout(r, 200));
  const out = { state: v.ctx && v.ctx.state };
  for (const k of ['yip', 'eep', 'giggle', 'yelp', 'whimper', 'yawn', 'brr', 'patter']) {
    try { const r = v[k](); out[k] = r ? 'ok ' + JSON.stringify(r) : 'ok'; } catch (e) { out[k] = 'ERR ' + e.message; }
  }
  try { v.squealStart(); v.squealPitch(2); v.squealStop(); out.squeal = 'ok'; } catch (e) { out.squeal = 'ERR ' + e.message; }
  try { v.thump(0.8); out.thump = 'ok'; } catch (e) { out.thump = 'ERR ' + e.message; }
  await new Promise((r) => setTimeout(r, 1200));
  return out;
});
console.log(JSON.stringify(sound, null, 1));
console.log(logs.filter((l) => !l.includes('ERR_FAILED')).join('\n'));
await browser.close();
