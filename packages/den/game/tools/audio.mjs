// Renders each pup sound offline and reports its length and loudness, so a silent or
// clipped sound shows up without speakers. Writes out/sounds.wav (all of them in a row).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM });
const page = await browser.newPage();
const src = readFileSync('src/voice.js', 'utf8').replace('export class Voice', 'class Voice');
await page.setContent('<html></html>');
const res = await page.evaluate(async (code) => {
  eval(code + '\nwindow.Voice = Voice;');
  const names = ['eep', 'yip', 'giggle', 'squeal', 'yelp', 'whimper', 'hum', 'yawn', 'brr', 'thump', 'patter'];
  const sr = 22050, gap = 1.3;
  const ctx = new OfflineAudioContext(1, Math.ceil(sr * gap * names.length), sr);
  const v = new window.Voice(1000);
  // Point the voice at the offline context, scheduling each sound in its own slot.
  v.ctx = ctx;
  const comp = ctx.createDynamicsCompressor();
  v.master = ctx.createGain();
  v.master.gain.value = 0.8;
  v.master.connect(comp).connect(ctx.destination);
  const len = sr;
  v.noise = ctx.createBuffer(1, len, sr);
  const d = v.noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  let slot = 0, now = 0;
  Object.defineProperty(ctx, 'currentTime', { get: () => now, configurable: true });
  Object.defineProperty(v, 'ready', { get: () => true });
  const realSetTimeout = window.setTimeout;
  window.setTimeout = (fn, ms) => { const keep = now; now = slot * gap + ms / 1000; fn(); now = keep; };
  for (const n of names) {
    now = slot * gap;
    if (n === 'squeal') { v.squealStart(); v.live.osc.frequency.setTargetAtTime(1000 * 1.6, slot * gap + 0.1, 0.25); const live = v.live; v.live = null; live.env.gain.setTargetAtTime(0, slot * gap + 0.75, 0.08); }
    else if (n === 'thump') v.thump(0.8);
    else v[n]();
    slot++;
  }
  window.setTimeout = realSetTimeout;
  const buf = await ctx.startRendering();
  const data = buf.getChannelData(0);
  const out = {};
  names.forEach((n, i) => {
    let peak = 0, sum = 0, cnt = 0, last = 0;
    for (let k = Math.floor(i * gap * sr); k < Math.floor((i + 1) * gap * sr); k++) {
      const a = Math.abs(data[k]); peak = Math.max(peak, a); sum += a * a; cnt++; if (a > 0.01) last = k;
    }
    out[n] = { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / cnt).toFixed(4), lasts: +((last / sr) - i * gap).toFixed(2) };
  });
  return { out, pcm: Array.from(data, (x) => Math.max(-1, Math.min(1, x))) , sr };
}, src);
console.table(res.out);
// 16-bit WAV.
const n = res.pcm.length, buf = Buffer.alloc(44 + n * 2);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(res.sr, 24); buf.writeUInt32LE(res.sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
res.pcm.forEach((x, i) => buf.writeInt16LE(Math.round(x * 32767), 44 + i * 2));
writeFileSync('out/sounds.wav', buf);
await browser.close();
