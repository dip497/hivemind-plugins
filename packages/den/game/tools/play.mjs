// Plays the feel test in headless Chromium with the clock paused, so frames are exact:
// grab the pup, carry it, flick it up, then step the game and screenshot the flight, the
// landing and what the pup does after. Prints states and any errors.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const [, , w = '1100', h = '720', prefix = 'g', flick = '900', mode = 'toss'] = process.argv;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
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
await page.waitForFunction(() => window.__den && window.__den.ready, null, { timeout: 90000 });
const D = (f, a) => page.evaluate(f, a);
await D(() => window.__den.pause(true));
await D(() => { window.__den.step(1.5); window.__den.draw(); });
const shot = async (n) => { await D(() => window.__den.draw()); await page.screenshot({ path: `out/${prefix}-${n}.png` }); };
const info = () => D(() => { const p = window.__den.pup; return { st: p.state, p: p.p.toArray().map((x) => +x.toFixed(2)), v: p.v.toArray().map((x) => +x.toFixed(2)) }; });
await shot('0-start');
const at = await D(() => window.__den.hand.pupOnScreen());
console.log('pup on screen', at, await info());
await page.mouse.move(at.x, at.y);
await page.mouse.down();
await D(() => window.__den.step(0.5));
for (let i = 1; i <= 5; i++) { await page.mouse.move(at.x + i * 8, at.y - i * 24); await D(() => window.__den.step(1 / 30)); await page.waitForTimeout(30); }
await D(() => window.__den.step(0.3));
await shot('1-held');
console.log('held', await info());
console.log('render', await D(() => window.__den.stats()));
if (mode === 'catch') {
  const x0 = at.x + 40, y0 = at.y - 120;
  for (let i = 1; i <= 4; i++) { await page.mouse.move(x0 + i * 3, y0 - (i * +flick) / 60); await page.waitForTimeout(16); }
  await page.mouse.up();
  // Wait until it is falling, then open the hand where it is.
  for (let i = 0; i < 120; i++) {
    await D(() => window.__den.step(1 / 60));
    const s = await info();
    if (s.v[1] < -2) break;
  }
  const fall = await D(() => window.__den.hand.pupOnScreen());
  await page.mouse.move(fall.x, fall.y + 10);
  await page.mouse.down();
  await D(() => window.__den.step(0.1));
  console.log('after catch', await info(), await D(() => document.getElementById('stat-row').textContent));
  await shot('4-caught');
  await D(() => window.__den.step(0.5));
  await shot('4-caught2');
  await page.mouse.up();
}
if (mode === 'toss') {
  // A flick upward: four moves 16 ms apart covering `flick` px/s.
  const x0 = at.x + 40, y0 = at.y - 120;
  for (let i = 1; i <= 4; i++) { await page.mouse.move(x0 + i * 3, y0 - (i * +flick) / 60); await page.waitForTimeout(16); }
  await page.mouse.up();
  console.log('released', await info());
  const frames = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2];
  let last = 0;
  for (const [i, f] of frames.entries()) {
    await D((d) => window.__den.step(d), f - last);
    last = f;
    console.log('t', f, await info(), await D(() => window.__den.pup.scared));
    if (i % 2 === 1) await shot('2-air' + i);
  }
  for (const s of [0.6, 1.2, 2.5, 5]) {
    await D((d) => window.__den.step(d), s);
    console.log('+', s, await info(), 'scared', await D(() => +window.__den.pup.scared.toFixed(2)));
    await shot('3-after-' + s);
  }
}
console.log(logs.filter((l) => !l.includes('ERR_FAILED')).slice(0, 20).join('\n'));
await browser.close();
