// Checks petting and booping through real pointer events: rub the pup, see it go to 'pet'
// with its eyes shut; stop, see it come back to begging; tap it, see it bounce.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });
const logs = [];
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
await D(() => { window.__den.pause(true); window.__den.step(1); });
const st = () => D(() => ({ st: window.__den.pup.state, lid: +window.__den.pup.lid.toFixed(2), hopVy: +window.__den.pup.hopVy.toFixed(2), hint: document.getElementById('hint').textContent }));
const at = await D(() => window.__den.hand.pupOnScreen());
await page.mouse.move(at.x, at.y + 10);
await page.mouse.down();
for (let i = 0; i < 10; i++) { await page.mouse.move(at.x + (i % 2 ? 10 : -10), at.y + 10 + (i % 3) * 2); await D(() => window.__den.step(1 / 30)); }
await D(() => window.__den.step(0.5));
console.log('rubbing', await st());
await D(() => window.__den.draw());
await page.screenshot({ path: 'out/pet.png' });
await page.mouse.up();
await D(() => window.__den.step(2));
console.log('after rub', await st());
const at2 = await D(() => window.__den.hand.pupOnScreen());
await page.mouse.move(at2.x, at2.y);
await page.mouse.down();
await page.mouse.up();
console.log('boop', await st());
await D(() => window.__den.step(0.1));
console.log('boop+0.1', await st());
console.log(logs.join('\n'));
await browser.close();
