// Films a scripted scene at 30 fps with the game clock stepped exactly: frames go to
// out/film-<name>/, then ffmpeg makes out/film-<name>.mp4. Scenes:
//   play  - picked up, carried right and left, held still, tossed, lands, runs back, begs
//   perch - walks to the log and jumps up onto it, sits, then comes back down
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
const { chromium } = createRequire(import.meta.url)('playwright');
const [, , scene = 'play', secs = '9', w = '720', h = '480'] = process.argv;
const dir = `out/film-${scene}`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_FAILED')) logs.push(m.text()); });
await page.route('**/*', (route) => {
  const url = route.request().url();
  if (url.includes('three.module.js')) return route.fulfill({ body: readFileSync('three.module.js'), contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' } });
  if (url.startsWith('http://den.local/')) return route.fulfill({ body: readFileSync('out/test.html'), contentType: 'text/html' });
  return route.abort();
});
await page.goto('http://den.local/index.html');
await page.waitForFunction(() => window.__den && window.__den.ready, null, { timeout: 90000 });
await page.evaluate((scene) => {
  const D = window.__den, P = D.pup, V = D.THREE.Vector3;
  D.pause(true);
  for (const el of document.querySelectorAll('.bottom')) el.hidden = true;
  D.step(1.0);
  const raw = Object.getPrototypeOf(P).release;
  const hand = new V(), last = new V();
  let held = false;
  const at = (t, a, b) => (t - a) / (b - a);
  const lerp = (a, b, k) => a + (b - a) * Math.max(0, Math.min(1, k));
  const sm = (k) => { k = Math.max(0, Math.min(1, k)); return k * k * (3 - 2 * k); };
  window.__script = (t, dt) => {
    if (scene === 'play') {
      if (t >= 0.5 && !held && t < 3.3) {
        held = true;
        hand.copy(P.p).add(new V(0.19, 0.31, 0));
        hand.y = Math.max(hand.y, 1.0);
        last.copy(hand);
        P.grab(hand.clone());
      }
      if (held) {
        const x0 = 0.7;
        let x = x0, y = 1.0;
        if (t < 0.9) y = lerp(1.0, 1.45, sm(at(t, 0.5, 0.9)));
        else y = 1.45;
        if (t >= 0.9) x = lerp(x0, x0 + 1.0, sm(at(t, 0.9, 1.4)));
        if (t >= 1.4) x = lerp(x0 + 1.0, x0 - 0.7, sm(at(t, 1.4, 2.1)));
        if (t >= 3.1) y = lerp(1.45, 2.0, at(t, 3.1, 3.3));
        hand.set(x, y, P.p.z * 0 + 0.98);
        const vel = hand.clone().sub(last).divideScalar(dt);
        last.copy(hand);
        P.moveHand(hand.clone(), vel);
        if (t >= 3.3) { held = false; raw.call(P, new V(0.5, 6.2, 0)); }
      }
    }
    if (scene === 'perch' && t < 0.05 && P.state !== 'wander') {
      const pr = P.solid.perches.find((q) => Math.abs(q.y - 0.41) < 0.01);
      P.target.set(pr.x, 0, pr.z);
      P.after = 'perch';
      P.go('wander');
    }
    if (scene === 'perch' && t > 7.5 && P.state === 'sit') P.go('return');
  };
}, scene);
const fps = 30, n = Math.round(+secs * fps);
for (let i = 0; i < n; i++) {
  const st = await page.evaluate(({ i, fps }) => {
    const D = window.__den;
    window.__script(i / fps, 1 / fps);
    D.step(1 / fps, 60);
    D.draw();
    return D.pup.state;
  }, { i, fps });
  await page.screenshot({ path: `${dir}/f${String(i).padStart(4, '0')}.png` });
  if (i % 15 === 0) console.log(i, (i / fps).toFixed(2), st);
}
console.log(logs.join('\n'));
await browser.close();
execSync(`ffmpeg -y -loglevel error -framerate 30 -i ${dir}/f%04d.png -c:v libx264 -pix_fmt yuv420p -crf 22 out/film-${scene}.mp4`);
console.log('wrote', `out/film-${scene}.mp4`);
