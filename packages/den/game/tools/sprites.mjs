// Renders the pup's sprite sheet for the Den widget: five rows of eight frames (walk, sit,
// sleep, beg, jump), each drawn at twice its size on a transparent page and shrunk, then laid
// out by tools/sheet-sprites.py into ../widgets/den-pup/pup.webp.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const FW = 160, FH = 128, K = 2; // frame size in the sheet, and how much larger it is drawn
const dir = 'out/sprites';
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: FW * K, height: FH * K }, deviceScaleFactor: 1 });
await page.route('**/*', (route) => {
  const url = route.request().url();
  if (url.includes('three.module.js')) return route.fulfill({ body: readFileSync('three.module.js'), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
  if (url.startsWith('http://den.local/')) return route.fulfill({ body: readFileSync('out/test.html'), contentType: 'text/html' });
  return route.abort();
});
await page.goto('http://den.local/index.html#sprite');
await page.waitForFunction(() => window.__den && window.__den.ready, null, { timeout: 90000 });
const view = { paused: true, auto: false, yaw: 0.5, pitch: 0.14, dist: 2.7, ty: 0.12, lid: 0, mouth: 0, wag: 0, ears: 0.3, look: [0.45, 0.08], lift: 0, hang: 0, flip: 0 };
const D = (f, a) => page.evaluate(f, a);
async function row(name, base, frames, dt, perFrame = () => ({})) {
  // Settle into the pose first, so the loop starts where it ends.
  await D(([o]) => window.__den.advance(o, 90, 1 / 60), [{ ...view, ...base }]);
  for (let i = 0; i < frames; i++) {
    const o = { ...view, ...base, ...perFrame(i) };
    await D(([o, dt, crouch]) => { if (crouch !== undefined) window.__den.anim.crouch.x = crouch; window.__den.advance(o, 1, dt); }, [o, dt, o.crouch]);
    await page.screenshot({ path: `${dir}/${name}-${i}.png`, omitBackground: true });
  }
  console.log('row', name);
}
await row('walk', { pose: 'walk' }, 8, 0.05);
await row('sit', { pose: 'sit', wag: 0.5, ears: 0.4 }, 8, 0.1);
await row('sleep', { pose: 'sleep', lid: 1, ears: -0.6, look: [0, 0] }, 8, 0.25);
await row('beg', { pose: 'bow', wag: 0.847, ears: 1, look: [0.5, 0.25] }, 8, 0.1, (i) => ({ mouth: [0.8, 0.5, 0.15, 0.05, 0.8, 0.5, 0.15, 0.05][i] }));
await row('jump', { pose: 'air', wag: 0.6, ears: 0.8 }, 8, 0.0833, (i) => {
  const air = [0, 0.4, 0.75, 0.95, 0.95, 0.75, 0.4, 0][i];
  return { pose: i === 0 || i === 7 ? 'stand' : 'air', lift: 0.22 * Math.sin((air * Math.PI) / 2), vy: i < 4 ? 4 : -4, mouth: air > 0.3 ? 0.7 : 0.2, crouch: i === 0 || i === 7 ? 0.5 : undefined };
});
await browser.close();
