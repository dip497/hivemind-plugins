// The few words and controls over the clearing: a hint that teaches the toss and the catch,
// the toss readout, sound, and the tuning drawer whose settings are kept in this browser.

export const DEFAULTS = { gravity: 13, throw: 1, bounce: 0.32, squash: 1, comfort: 2, shake: 1 };
const KEY = 'den.tune.v1';

export const SLIDERS = [
  { key: 'gravity', label: 'Hang time', min: 6, max: 26, step: 0.5, show: (v) => (v <= 10 ? 'floaty' : v >= 18 ? 'snappy' : 'medium') + ` · ${v}` },
  { key: 'throw', label: 'Throw strength', min: 0.5, max: 1.8, step: 0.05, show: (v) => `${v.toFixed(2)}×` },
  { key: 'bounce', label: 'Bounce', min: 0, max: 0.6, step: 0.02, show: (v) => v.toFixed(2) },
  { key: 'squash', label: 'Squash on landing', min: 0, max: 2, step: 0.05, show: (v) => `${v.toFixed(2)}×` },
  { key: 'comfort', label: 'Scared above', min: 0.5, max: 5, step: 0.1, show: (v) => `${v.toFixed(1)} m` },
  { key: 'shake', label: 'Camera bump', min: 0, max: 2, step: 0.1, show: (v) => (v === 0 ? 'off' : `${v.toFixed(1)}×`) },
];

export function loadTune() {
  const t = { ...DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const k of Object.keys(DEFAULTS)) if (typeof saved[k] === 'number' && isFinite(saved[k])) t[k] = saved[k];
  } catch {}
  if (matchMedia('(prefers-reduced-motion: reduce)').matches && !hasSaved()) t.shake = 0;
  return t;
}

function hasSaved() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}

function saveTune(t) {
  try { localStorage.setItem(KEY, JSON.stringify(t)); } catch {}
}

export function makeHud(tune, voice) {
  const $ = (id) => document.getElementById(id);
  const hint = $('hint');
  const stats = { last: $('stat-last'), row: $('stat-row'), best: $('stat-best') };
  const bubble = $('bubble');
  let step = 0;
  let row = 0, best = 0;
  let bubbleUntil = 0;

  const hints = [
    'Press the pup and flick up to toss it',
    'Press and hold where it falls to catch it',
    'Rub the pup to pet it, or tap its nose',
    'Too high and it gets scared. Find its favourite height.',
  ];
  const setHint = (i) => {
    step = i;
    if (i >= hints.length) { hint.hidden = true; return; }
    hint.hidden = false;
    hint.textContent = hints[i];
  };
  setHint(0);

  // Sound.
  const soundBtn = $('sound');
  let muted = false;
  try { muted = localStorage.getItem('den.muted') === '1'; } catch {}
  const paintSound = () => {
    soundBtn.setAttribute('aria-pressed', String(!muted));
    soundBtn.querySelector('span').textContent = muted ? 'Sound off' : 'Sound on';
  };
  voice.setMuted(muted);
  paintSound();
  soundBtn.addEventListener('click', () => {
    voice.unlock();
    muted = !muted;
    voice.setMuted(muted);
    try { localStorage.setItem('den.muted', muted ? '1' : '0'); } catch {}
    paintSound();
  });

  // Tuning drawer.
  const drawer = $('tune');
  const tuneBtn = $('tune-open');
  const list = $('tune-list');
  for (const s of SLIDERS) {
    const row = document.createElement('label');
    row.className = 'slider';
    row.innerHTML = `<span class="slider-name">${s.label}</span><output id="out-${s.key}"></output><input id="tune-${s.key}" type="range" min="${s.min}" max="${s.max}" step="${s.step}">`;
    list.appendChild(row);
    const input = row.querySelector('input');
    const out = row.querySelector('output');
    input.value = String(tune[s.key]);
    out.textContent = s.show(tune[s.key]);
    input.addEventListener('input', () => {
      tune[s.key] = parseFloat(input.value);
      out.textContent = s.show(tune[s.key]);
      saveTune(tune);
    });
  }
  const syncInputs = () => {
    for (const s of SLIDERS) {
      $('tune-' + s.key).value = String(tune[s.key]);
      $('out-' + s.key).textContent = s.show(tune[s.key]);
    }
  };
  const setOpen = (open) => {
    drawer.hidden = !open;
    document.body.classList.toggle('tuning', open);
    tuneBtn.setAttribute('aria-expanded', String(open));
  };
  tuneBtn.addEventListener('click', () => setOpen(drawer.hidden));
  $('tune-close').addEventListener('click', () => setOpen(false));
  $('tune-reset').addEventListener('click', () => {
    Object.assign(tune, DEFAULTS);
    saveTune(tune);
    syncInputs();
  });
  const copyBtn = $('tune-copy');
  const copyText = $('tune-text');
  copyBtn.addEventListener('click', () => {
    const text = 'Den feel: ' + SLIDERS.map((s) => `${s.label} ${s.show(tune[s.key])}`).join(', ');
    copyText.value = text;
    copyText.hidden = false;
    const done = () => { copyBtn.textContent = 'Copied'; setTimeout(() => (copyBtn.textContent = 'Copy settings'), 1600); };
    try {
      navigator.clipboard.writeText(text).then(done, () => { copyText.select(); });
    } catch {
      copyText.select();
    }
  });

  const paintStats = (last) => {
    if (last !== undefined) stats.last.textContent = `${last.toFixed(1)} m`;
    stats.row.textContent = String(row);
    stats.best.textContent = String(best);
  };
  paintStats();

  return {
    get step() { return step; },
    onApex(m) { paintStats(m); },
    onCatch() {
      row++;
      best = Math.max(best, row);
      paintStats();
      bubble.textContent = row > 1 ? `Caught! ${row} in a row` : 'Caught!';
      bubbleUntil = performance.now() + 1100;
      if (step <= 1) setHint(2);
    },
    onPet() {
      if (step === 2) { setHint(3); setTimeout(() => step === 3 && setHint(4), 6000); }
    },
    onLand(m, tossed) {
      if (tossed) {
        row = 0;
        paintStats();
        if (step === 0) setHint(1);
      }
    },
    // Keep the bubble over the pup's head.
    place(x, y) {
      const show = performance.now() < bubbleUntil;
      bubble.hidden = !show;
      if (show) bubble.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
    },
    loaded() {
      $('loading').hidden = true;
    },
  };
}
