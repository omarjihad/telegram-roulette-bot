// MF Battle sound effects, synthesized with Web Audio (no files to download).
// Browsers only allow sound after the first tap, so the audio context starts on demand.

let ctx = null;
let master = null;
let enabled = true;
const last = {};

function ensure() {
  if (!enabled) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function setSoundEnabled(on) {
  enabled = !!on;
  if (master) master.gain.value = enabled ? 0.55 : 0;
}

/** Call from the first tap so later sounds (even from timers) are allowed. */
export function unlockSound() {
  ensure();
}

function tone({ type = 'sine', from, to = from, dur = 0.12, vol = 0.3, delay = 0 }) {
  const a = ensure();
  if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.2, vol = 0.25, from = 2000, to = 400, delay = 0 }) {
  const a = ensure();
  if (!a) return;
  const t = a.currentTime + delay;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.2;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start(t);
}

const SOUNDS = {
  // Menus
  tap: () => tone({ type: 'triangle', from: 880, to: 660, dur: 0.06, vol: 0.18 }),
  open: () => { tone({ type: 'sine', from: 420, to: 840, dur: 0.14, vol: 0.18 }); noise({ dur: 0.12, vol: 0.06, from: 1200, to: 3000 }); },
  close: () => tone({ type: 'sine', from: 760, to: 380, dur: 0.12, vol: 0.16 }),
  toggle: () => tone({ type: 'square', from: 1200, to: 1200, dur: 0.035, vol: 0.06 }),
  buy: () => [0, 0.07, 0.14].forEach((d, i) => tone({ type: 'triangle', from: [988, 1319, 1760][i], dur: 0.16, vol: 0.2, delay: d })),
  error: () => { tone({ type: 'sawtooth', from: 200, to: 140, dur: 0.18, vol: 0.12 }); },
  equip: () => { tone({ type: 'sine', from: 660, to: 990, dur: 0.12, vol: 0.2 }); tone({ type: 'sine', from: 990, dur: 0.12, vol: 0.14, delay: 0.08 }); },
  // Game
  start: () => [0, 0.09, 0.18, 0.3].forEach((d, i) => tone({ type: 'triangle', from: [523, 659, 784, 1047][i], dur: 0.18, vol: 0.2, delay: d })),
  eat: () => tone({ type: 'sine', from: 900 + Math.random() * 300, to: 1500, dur: 0.05, vol: 0.07 }),
  eatBig: () => { tone({ type: 'triangle', from: 300, to: 900, dur: 0.18, vol: 0.25 }); noise({ dur: 0.15, vol: 0.08, from: 600, to: 2400 }); },
  split: () => noise({ dur: 0.16, vol: 0.22, from: 600, to: 2600 }),
  throw: () => tone({ type: 'sine', from: 520, to: 260, dur: 0.06, vol: 0.12 }),
  virus: () => { noise({ dur: 0.35, vol: 0.3, from: 300, to: 80 }); tone({ type: 'sawtooth', from: 160, to: 60, dur: 0.3, vol: 0.12 }); },
  die: () => { tone({ type: 'sawtooth', from: 330, to: 55, dur: 0.6, vol: 0.2 }); noise({ dur: 0.5, vol: 0.18, from: 900, to: 100 }); },
  rankUp: () => [0, 0.08].forEach((d, i) => tone({ type: 'triangle', from: [1175, 1568][i], dur: 0.12, vol: 0.14, delay: d })),
};

/** Plays a named effect; very frequent ones (eating) are throttled so they don't pile up. */
export function sfx(name, minGapMs = 0) {
  if (!enabled || !SOUNDS[name]) return;
  if (minGapMs) {
    const now = performance.now();
    if (now - (last[name] || 0) < minGapMs) return;
    last[name] = now;
  }
  try {
    SOUNDS[name]();
  } catch (e) {
    /* audio unavailable */
  }
}
