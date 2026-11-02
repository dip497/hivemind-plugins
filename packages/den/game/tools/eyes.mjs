// Is the pup's eye shut because of a blink? Steps the game and prints the lid at times
// around the first blink, with screenshots of the face at 1.5 s and 2.2 s.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 1 });
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
let t = 0;
for (const [to, shot] of [[1.4], [1.5, 'eyes-1.5'], [1.6], [2.2, 'eyes-2.2']]) {
  await D((d) => window.__den.step(d), to - t); t = to;
  const r = await D(() => ({ lid: +window.__den.pup.face.lid.toFixed(2), blink: +window.__den.pup.face.blink.toFixed(2), state: window.__den.pup.state }));
  console.log(t, r);
  if (shot) { await D(() => window.__den.draw()); await page.screenshot({ path: `out/${shot}.png`, clip: { x: 420, y: 230, width: 360, height: 300 } }); }
}
await browser.close();
