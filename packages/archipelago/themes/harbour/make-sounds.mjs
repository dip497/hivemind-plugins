// Renders Harbour's three sounds into sounds/: a ship's bell for done, two gull-like rising notes
// for needs, a low horn for error. Every sample is computed here (no randomness, no clock), each
// sound is scaled to peak at -6 dBFS, and ffmpeg encodes it as Ogg Vorbis with its bit-exact flags
// and a fixed stream serial, so a re-run writes the same bytes on the same ffmpeg.
//
//   node packages/archipelago/themes/harbour/make-sounds.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 44100;
// -6 dBFS once decoded: Vorbis rings a little over the peak it is given.
const PEAK = 10 ** (-6.6 / 20);
// HARBOUR_SOUNDS_OUT writes them elsewhere (the test renders them again to compare).
const OUT = process.env.HARBOUR_SOUNDS_OUT ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "sounds");
const TAU = Math.PI * 2;

/** A buffer of `seconds`, filled by adding voices into it. */
const buffer = (seconds) => new Float64Array(Math.round(seconds * RATE));

/** Add a sine whose frequency follows `freq(t)` and loudness `amp(t)`, starting at `start` s. */
function voice(buf, start, length, freq, amp) {
  let phase = 0;
  const from = Math.round(start * RATE), n = Math.min(Math.round(length * RATE), buf.length - from);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    phase += (TAU * freq(t)) / RATE;
    buf[from + i] += Math.sin(phase) * amp(t);
  }
}

/** A ship's bell: a struck bronze partial series, each partial dying away at its own rate. */
function bell() {
  const buf = buffer(2.6);
  const f0 = 587; // D5
  // Partials of a bell (hum, prime, tierce, quint, nominal and above) relative to the prime.
  const partials = [[0.5, 0.35, 1.6], [1, 1, 1.1], [1.19, 0.45, 0.9], [1.5, 0.3, 0.7], [2, 0.5, 0.6], [2.51, 0.2, 0.4], [3.01, 0.12, 0.3], [4.1, 0.06, 0.2]];
  const strike = (at, gain) => {
    for (const [ratio, level, decay] of partials) {
      // A slight beat between two near partials gives the bell its shimmer.
      for (const detune of [0, 0.7]) voice(buf, at, 2.6 - at, () => f0 * ratio + detune, (t) => gain * level * 0.5 * Math.min(1, t / 0.002) * Math.exp(-t / decay));
    }
  };
  strike(0, 1);
  strike(0.34, 0.8); // ships' bells ring in pairs
  return buf;
}

/** Two gull calls: each a quick glide up with a rasp of upper harmonics, the second a step higher. */
function gulls() {
  const buf = buffer(1.0);
  const call = (at, lo, hi, gain) => {
    const len = 0.3;
    const glide = (t) => lo + (hi - lo) * Math.sin(Math.min(1, t / len) * Math.PI / 2) + 18 * Math.sin(TAU * 31 * t);
    const env = (t) => gain * Math.min(1, t / 0.025) * Math.max(0, 1 - Math.max(0, t - len * 0.55) / (len * 0.45));
    for (const [h, level] of [[1, 1], [2, 0.32], [3, 0.14], [4, 0.06]]) voice(buf, at, len, (t) => glide(t) * h, (t) => env(t) * level);
  };
  call(0.0, 820, 1240, 1);
  call(0.42, 980, 1480, 1);
  return buf;
}

/** A low harbour horn: a reedy tone of two pipes a fifth apart, swelling in and dying out. */
function horn() {
  const buf = buffer(1.8);
  const len = 1.75;
  const env = (t) => Math.min(1, t / 0.12) * (t < len - 0.45 ? 1 : Math.max(0, (len - t) / 0.45));
  for (const [f, gain] of [[98, 1], [147, 0.45]]) {
    // Harmonics falling off as a horn's do, so it sounds round rather than buzzing.
    for (let h = 1; h <= 9; h++) voice(buf, 0, len, (t) => f * h * (1 + 0.003 * Math.sin(TAU * 4.5 * t)), (t) => env(t) * gain / h ** 1.35);
  }
  return buf;
}

/** Scale to the peak, fade the last 10 ms so nothing clicks, and write 16-bit mono WAV. */
function wav(buf) {
  let most = 0;
  for (const v of buf) most = Math.max(most, Math.abs(v));
  const fade = Math.round(0.01 * RATE);
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) {
    const tail = Math.min(1, (buf.length - 1 - i) / fade);
    data.writeInt16LE(Math.round((buf[i] / most) * PEAK * tail * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24); head.writeUInt32LE(RATE * 2, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34);
  head.write("data", 36); head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const tmp = mkdtempSync(path.join(tmpdir(), "harbour-sounds-"));
try {
  mkdirSync(OUT, { recursive: true });
  for (const [name, make] of [["done", bell], ["needs", gulls], ["error", horn]]) {
    const src = path.join(tmp, `${name}.wav`), dst = path.join(OUT, `${name}.ogg`);
    writeFileSync(src, wav(make()));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact",
      "-c:a", "libvorbis", "-q:a", "4", "-serial_offset", "1", dst]);
    console.log(dst);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
