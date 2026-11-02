// Draws the 2D Den pup's sprite sheet (../pup2d/draw.js): a row of eight frames for each pose,
// each frame drawn at twice its size in Chromium, then shrunk by tools/sheet2d.py so its edges stay
// soft. `node tools/sprites2d.mjs [out.png]` (PW_CHROMIUM names a Chromium when Playwright's own is
// not installed).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const FW = 160, FH = 144, K = 2;
const out = process.argv[2] ?? 'out/sprites2d.png';
mkdirSync('out', { recursive: true });
const code = readFileSync(new URL('../../pup2d/draw.js', import.meta.url), 'utf8').replace(/^export /gm, '');
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM });
const page = await browser.newPage();
await page.setContent('<!doctype html><body></body>');
await page.addScriptTag({ content: `${code}\nwindow.sheet = () => {
  const c = document.createElement('canvas');
  c.width = ${FW * 8 * K}; c.height = ${FH * K} * POSES.length;
  const g = c.getContext('2d');
  POSES.forEach((pose, row) => {
    for (let i = 0; i < 8; i++) {
      g.save();
      g.translate(i * ${FW * K}, row * ${FH * K});
      g.beginPath(); g.rect(0, 0, ${FW * K}, ${FH * K}); g.clip();
      g.scale(${K}, ${K});
      drawPup(g, pose, i);
      g.restore();
    }
  });
  return c.toDataURL('image/png');
};` });
const url = await page.evaluate(() => window.sheet());
writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
console.log('drew', out);
await browser.close();
