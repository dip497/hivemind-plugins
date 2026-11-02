// Renders the Den pup widget's sprites: for each pose (walk, sit, sleep, beg, jump, run, shake,
// roll, spin, carry, ball) one seamless loop of 24 frames, each drawn at twice its size on a
// transparent page with the full fur, then shrunk to 320 x 256 and laid in a row by
// tools/sheet-sprites.py: one sheet a pose, ../widgets/den-pup/pup-<pose>.webp. The widget shows a
// frame at about 0.4 of that, so it stays sharp on a high-density screen.
// `node tools/sprites.mjs roll spin` renders only those poses.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const FW = 320, FH = 256, K = 2; // frame size in the sheet, and how much larger it is drawn
const N = 24; // frames a loop
const dir = 'out/sprites';
const only = process.argv.slice(2);
// Poses asked for by name are drawn again over the rest; with none named, every pose afresh.
if (!only.length) rmSync(dir, { recursive: true, force: true });
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
// A light rim round the coat, so the pup stands clear of a dark theme as well as a light one.
await page.evaluate(() => { window.__den.pup.fur.rim.value = 0.6; });
const view = { paused: true, auto: false, yaw: 0.5, pitch: 0.14, dist: 2.7, ty: 0.12, lid: 0, mouth: 0, wag: 0, ears: 0.3, look: [0.45, 0.08], lift: 0, hang: 0, flip: 0, roll: 0, turn: 0, ball: false, shake: 0, paddle: 0 };
const D = (f, a) => page.evaluate(f, a);
const TAU = Math.PI * 2;
/** One pose's loop: `loop` seconds over N frames, so its last frame runs on into its first. */
async function row(name, base, loop, perFrame = () => ({})) {
  if (only.length && !only.includes(name)) return;
  const dt = loop / N;
  // Settle into the pose first, so the loop starts where it ends.
  await D(([o]) => window.__den.advance(o, 120, 1 / 60), [{ ...view, ...base, ...perFrame(0) }]);
  for (let i = 0; i < N; i++) {
    const o = { ...view, ...base, ...perFrame(i) };
    await D(([o, dt, crouch]) => { if (crouch !== undefined) window.__den.anim.crouch.x = crouch; window.__den.advance(o, 1, dt); }, [o, dt, o.crouch]);
    await page.screenshot({ path: `${dir}/${name}-${i}.png`, omitBackground: true });
  }
  console.log('row', name);
}
await row('walk', { pose: 'walk' }, 0.4);
await row('sit', { pose: 'sit', wag: 0.5, ears: 0.4 }, 0.8);
await row('sleep', { pose: 'sleep', lid: 1, ears: -0.6, look: [0, 0] }, 2);
// A play bow, yipping twice a loop.
await row('beg', { pose: 'bow', wag: 0.847, ears: 1, look: [0.5, 0.25] }, 0.8, (i) => ({ mouth: 0.42 + 0.38 * Math.cos((TAU * 2 * i) / N) }));
await row('jump', { pose: 'air', wag: 0.6, ears: 0.8 }, 0.667, (i) => {
  const air = Math.sin((Math.PI * i) / (N - 1));
  const ground = i === 0 || i === N - 1;
  return { pose: ground ? 'stand' : 'air', lift: 0.22 * Math.sin((air * Math.PI) / 2), vy: i < N / 2 ? 4 : -4, mouth: air > 0.3 ? 0.7 : 0.2, crouch: ground ? 0.5 : undefined };
});
// A gallop, for fetch: one stride a loop.
await row('run', { pose: 'run', wag: 0.3, ears: 0.9, mouth: 0.55, look: [0.2, 0.05] }, 0.32);
// A wet-dog shake, head to tail, eyes half shut: a boop on the nose.
await row('shake', { pose: 'stand', shake: 1, ears: 0.6, lid: 0.55, look: [0.3, 0] }, 0.308);
// Over on its back for a belly rub, legs paddling, tail going.
await row('roll', { pose: 'sleep', roll: -2.15, paddle: 1, wag: 0.9, mouth: 0.6, ears: -0.2, lift: -0.15, look: [0.5, 0.4] }, 0.263);
// Chasing its tail: round once on the spot.
await row('spin', { pose: 'walk', wag: 0.8, ears: 0.8, mouth: 0.5 }, 0.4, (i) => ({ turn: (i / N) * TAU }));
// Trotting back with the ball in its mouth.
await row('carry', { pose: 'trot', ball: true, mouth: 0.42, wag: 0.7, ears: 0.6, look: [0.25, 0.05] }, 0.227);
// Sitting with the ball, wagging: throw it.
await row('ball', { pose: 'sit', ball: true, mouth: 0.42, wag: 0.85, ears: 0.6, look: [0.5, 0.15] }, 0.8);
await browser.close();
