// The pup's voice and the world's thumps, made live with Web Audio. Nothing is recorded.
//
// A pup's whine or yip is close to a whistle: a strong fundamental around 1-2 kHz with only
// a few weak overtones, a pitch that wavers a little all the time, and breath only at the
// edges (the catch of a yelp, the sigh after a whine). So each call here is a tone built
// from a handful of harmonics, its pitch jittered every few milliseconds, with a puff of
// shaped noise where a real throat would make one. Each sound also says how wide the mouth
// opens and for how long, so the face moves with it.

// Overtone strengths, fundamental first. A whine is nearly pure; a yelp has an edge.
const TIMBRE = {
  whine: [1, 0.2, 0.07, 0.025],
  soft: [1, 0.1, 0.025],
  yelp: [1, 0.42, 0.22, 0.11, 0.05, 0.025],
};

export class Voice {
  constructor(pitch = 1000) {
    this.pitch = pitch; // the pup's own note, Hz
    this.ctx = null;
    this.muted = false;
    this.live = null; // the held squeal while flying
    this.waves = {};
  }

  // Must be called from a pointer or key handler: browsers only start audio after a gesture.
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.ratio.value = 5;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, len);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  // The mouth and throat every call passes through: a gentle presence lift where a small
  // muzzle resonates, and a ceiling so nothing hisses.
  get bus() {
    if (!this._bus || this._busCtx !== this.ctx) {
      const c = this.ctx;
      const peak = c.createBiquadFilter();
      peak.type = 'peaking';
      peak.frequency.value = 2300;
      peak.Q.value = 1.1;
      peak.gain.value = 4;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6000;
      lp.Q.value = 0.5;
      peak.connect(lp).connect(this.master);
      this._bus = peak;
      this._busCtx = c;
    }
    return this._bus;
  }

  wave(kind) {
    if (!this.waves[kind] || this.waves[kind].ctx !== this.ctx) {
      const h = TIMBRE[kind];
      const real = new Float32Array(h.length + 1), imag = new Float32Array(h.length + 1);
      h.forEach((a, i) => (imag[i + 1] = a));
      this.waves[kind] = { ctx: this.ctx, w: this.ctx.createPeriodicWave(real, imag) };
    }
    return this.waves[kind].w;
  }

  // One voiced call. pitch: [[t, multiple of the pup's note], ...]; amp: [[t, level], ...]
  // (level 0..1, times in seconds from the start); jitter in cents.
  call({ kind = 'whine', pitch, amp, gain = 0.3, jitter = 22, vibrato = 0, at = 0 }) {
    if (!this.ready) return 0;
    const c = this.ctx;
    const t0 = c.currentTime + 0.004 + at;
    const osc = c.createOscillator();
    osc.setPeriodicWave(this.wave(kind));
    const f = osc.frequency;
    f.setValueAtTime(this.pitch * pitch[0][1], t0);
    for (const [t, m] of pitch.slice(1)) f.exponentialRampToValueAtTime(this.pitch * m, t0 + t);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t0);
    for (const [t, a] of amp) env.gain.linearRampToValueAtTime(a * gain, t0 + t);
    const end = amp[amp.length - 1][0];
    // The waver of a real throat: small random steps of pitch, smoothed.
    for (let t = 0; t < end; t += 0.014) osc.detune.setTargetAtTime((Math.random() * 2 - 1) * jitter, t0 + t, 0.006);
    let lfo = null;
    if (vibrato) {
      lfo = c.createOscillator();
      lfo.frequency.value = 5.5 + Math.random();
      const lg = c.createGain();
      lg.gain.value = vibrato;
      lfo.connect(lg).connect(osc.detune);
      lfo.start(t0);
      lfo.stop(t0 + end + 0.05);
    }
    osc.connect(env).connect(this.bus);
    osc.start(t0);
    osc.stop(t0 + end + 0.05);
    return end + at;
  }

  // A puff of breath: band-limited noise with its own envelope.
  breath({ at = 0, dur = 0.05, level = 0.1, centre = 3500, q = 1.2, attack = 0.004 }) {
    if (!this.ready) return;
    const c = this.ctx;
    const t0 = c.currentTime + 0.004 + at;
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = centre;
    bp.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(level, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
    n.connect(bp).connect(g).connect(this.bus);
    n.start(t0, Math.random() * 0.5);
    n.stop(t0 + dur + 0.02);
  }

  // A happy yip: a catch of breath, a quick lift in pitch, then down.
  yip(m = 1) {
    const j = m * (0.95 + Math.random() * 0.1);
    this.breath({ dur: 0.03, level: 0.07, centre: 4200, q: 0.9, attack: 0.002 });
    const d = this.call({ kind: 'yelp', pitch: [[0, 1.0 * j], [0.025, 1.28 * j], [0.13, 0.82 * j]], amp: [[0.004, 1], [0.05, 0.75], [0.14, 0]], gain: 0.32, jitter: 30 });
    return { mouth: 0.8, dur: Math.max(0.13, d) };
  }

  // Picked up: a small surprised squeak that rises.
  eep() {
    const d = this.call({ kind: 'whine', pitch: [[0, 1.0], [0.1, 1.38]], amp: [[0.012, 0.9], [0.07, 0.7], [0.12, 0]], gain: 0.24, jitter: 18 });
    return { mouth: 0.5, dur: Math.max(0.1, d) };
  }

  // Delight: quick breathy pants with little squeaks riding on two of them.
  giggle() {
    for (let i = 0; i < 5; i++) {
      const at = i * 0.12;
      this.breath({ at, dur: 0.075, level: 0.12, centre: 1900 + Math.random() * 500, q: 1.4, attack: 0.012 });
      this.breath({ at, dur: 0.06, level: 0.05, centre: 4000, q: 1, attack: 0.01 });
      if (i === 1 || i === 3) this.call({ at: at + 0.01, kind: 'soft', pitch: [[0, 1.35], [0.05, 1.5], [0.09, 1.3]], amp: [[0.01, 0.8], [0.09, 0]], gain: 0.16, jitter: 25 });
    }
    return { mouth: 0.7, dur: 0.62, flutter: true };
  }

  // Thrown too high: a sharp yelp, then a smaller one.
  yelp() {
    this.breath({ dur: 0.04, level: 0.12, centre: 4500, q: 0.8, attack: 0.002 });
    this.call({ kind: 'yelp', pitch: [[0, 1.75], [0.03, 1.95], [0.3, 1.05]], amp: [[0.004, 1], [0.12, 0.7], [0.32, 0]], gain: 0.38, jitter: 40 });
    this.breath({ at: 0.36, dur: 0.03, level: 0.08, centre: 4500, q: 0.8, attack: 0.002 });
    const d = this.call({ at: 0.36, kind: 'yelp', pitch: [[0, 1.6], [0.02, 1.7], [0.18, 1.1]], amp: [[0.004, 0.8], [0.19, 0]], gain: 0.32, jitter: 40 });
    return { mouth: 1, dur: Math.max(0.55, d) };
  }

  // Sorry for itself: three small falling whines, each a little lower.
  whimper() {
    let d = 0;
    for (let i = 0; i < 3; i++) {
      const at = i * 0.26, k = 1 - i * 0.05;
      d = this.call({ at, kind: 'whine', pitch: [[0, 1.22 * k], [0.06, 1.28 * k], [0.2, 1.02 * k]], amp: [[0.03, 0.7], [0.12, 0.55], [0.21, 0]], gain: 0.2, jitter: 26, vibrato: 18 });
    }
    this.breath({ at: 0.8, dur: 0.25, level: 0.03, centre: 900, q: 0.7, attack: 0.08 });
    return { mouth: 0.25, dur: Math.max(0.6, d) };
  }

  // Petted: a low, contented moan that rises a little and settles, then a sigh.
  hum() {
    const j = 0.96 + Math.random() * 0.08;
    this.call({ kind: 'soft', pitch: [[0, 0.7 * j], [0.25, 0.8 * j], [0.55, 0.72 * j]], amp: [[0.1, 0.55], [0.4, 0.45], [0.58, 0]], gain: 0.18, jitter: 14, vibrato: 10 });
    this.breath({ at: 0.45, dur: 0.3, level: 0.025, centre: 800, q: 0.6, attack: 0.1 });
    return { mouth: 0.15, dur: 0.6 };
  }

  // A squeaky yawn: an in-breath, a rising "eee", falling away.
  yawn() {
    this.breath({ dur: 0.25, level: 0.03, centre: 1200, q: 0.6, attack: 0.1 });
    const d = this.call({ at: 0.18, kind: 'whine', pitch: [[0, 1.15], [0.35, 1.6], [0.85, 0.85]], amp: [[0.12, 0.45], [0.55, 0.35], [0.9, 0]], gain: 0.2, jitter: 20, vibrato: 12 });
    return { mouth: 1, dur: Math.max(0.95, d) };
  }

  // The squeal while flying: starts on the throw, its pitch climbs with the height.
  squealStart() {
    if (!this.ready) return;
    this.squealStop(0.01);
    const c = this.ctx;
    const t0 = c.currentTime + 0.004;
    const osc = c.createOscillator();
    osc.setPeriodicWave(this.wave('whine'));
    osc.frequency.setValueAtTime(this.pitch * 1.05, t0);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.26, t0 + 0.05);
    env.gain.setTargetAtTime(0, t0 + 1.0, 0.3);
    for (let t = 0; t < 3; t += 0.014) osc.detune.setTargetAtTime((Math.random() * 2 - 1) * 24, t0 + t, 0.006);
    const lfo = c.createOscillator();
    lfo.frequency.value = 6;
    const lg = c.createGain();
    lg.gain.value = 22;
    lfo.connect(lg).connect(osc.detune);
    osc.connect(env).connect(this.bus);
    osc.start(t0);
    lfo.start(t0);
    const until = t0 + 3;
    osc.stop(until);
    lfo.stop(until);
    this.breath({ dur: 0.05, level: 0.06, centre: 3800, q: 1, attack: 0.003 });
    this.live = { osc, env, lfo };
  }

  squealPitch(height) {
    if (!this.live || !this.ctx) return;
    this.live.osc.frequency.setTargetAtTime(this.pitch * Math.min(2.1, 1.05 + 0.13 * Math.max(0, height)), this.ctx.currentTime, 0.05);
  }

  squealStop(tau = 0.06) {
    if (!this.live || !this.ctx) return;
    const v = this.live;
    this.live = null;
    const now = this.ctx.currentTime;
    v.env.gain.cancelScheduledValues(now);
    v.env.gain.setTargetAtTime(0, now, tau);
    const end = now + tau * 6;
    try { v.osc.stop(end); v.lfo.stop(end); } catch {}
  }

  // A soft landing thump; strength 0..1.
  thump(strength) {
    if (!this.ready || strength <= 0.02) return;
    const c = this.ctx;
    const t0 = c.currentTime + 0.003;
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(150, t0);
    osc.frequency.exponentialRampToValueAtTime(48, t0 + 0.14);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.55 * strength, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + 0.22);
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.35 * strength, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    n.connect(lp).connect(ng).connect(this.master);
    n.start(t0, Math.random());
    n.stop(t0 + 0.13);
  }

  // Fur flapping in a shake.
  brr() {
    if (!this.ready) return;
    const c = this.ctx;
    const t0 = c.currentTime + 0.003;
    const n = c.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 0.8;
    const am = c.createGain();
    am.gain.value = 0.05;
    const lfo = c.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 21;
    const lg = c.createGain();
    lg.gain.value = 0.05;
    lfo.connect(lg).connect(am.gain);
    const env = c.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(1, t0 + 0.05);
    env.gain.linearRampToValueAtTime(0, t0 + 0.5);
    n.connect(bp).connect(am).connect(env).connect(this.master);
    n.start(t0, Math.random());
    lfo.start(t0);
    n.stop(t0 + 0.55);
    lfo.stop(t0 + 0.55);
  }

  // Paws in grass while running.
  patter() {
    if (!this.ready) return;
    const c = this.ctx;
    const t0 = c.currentTime + 0.002;
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400 + Math.random() * 1200;
    bp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(0.06, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t0, Math.random());
    n.stop(t0 + 0.07);
  }
}
