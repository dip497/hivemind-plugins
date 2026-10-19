// Sounds made on the spot with Web Audio: nothing is loaded. Off until the person turns them on.
let ctx: AudioContext | null = null;
let on = false;

export function setSound(enabled: boolean): void {
  on = enabled;
  if (on && !ctx) {
    try { ctx = new AudioContext(); } catch { ctx = null; }
  }
  void ctx?.resume().catch(() => undefined);
}
export const soundOn = (): boolean => on;

function tone(freq: number, at: number, length: number, gain: number, type: OscillatorType = "sine"): void {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + length);
  o.connect(g).connect(ctx.destination);
  o.start(at);
  o.stop(at + length + 0.05);
}

/** An agent started calling: two soft bell notes, rising. */
export function playCall(): void {
  if (!on || !ctx) return;
  const t = ctx.currentTime + 0.02;
  tone(659.25, t, 0.9, 0.11);
  tone(1318.5, t, 0.5, 0.025);
  tone(987.77, t + 0.16, 1.1, 0.1);
  tone(1975.5, t + 0.16, 0.6, 0.02);
}

/** A turn finished: one quiet wooden tick. */
export function playDone(): void {
  if (!on || !ctx) return;
  const t = ctx.currentTime + 0.02;
  tone(523.25, t, 0.25, 0.05, "triangle");
  tone(784, t + 0.07, 0.3, 0.04, "triangle");
}
