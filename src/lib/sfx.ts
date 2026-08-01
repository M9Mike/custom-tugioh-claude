'use client';

/**
 * Procedural sound effects via the Web Audio API.
 *
 * Everything is synthesised at runtime — no audio files to license, download or
 * ship, and the whole kit costs a few hundred bytes.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setSfxEnabled(on: boolean) {
  enabled = on;
  try {
    window.localStorage.setItem('duel-sfx', on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * What the audio engine is actually doing, for `/diag`.
 *
 * None of this reproduces off an iPhone — a desktop WebKit build recovers from
 * a suspended context happily — so when sound is intermittent the only way to
 * find out why is to read it off the phone. "suspended" means the context never
 * unlocked; "running" with no sound means the ringer switch.
 */
export function audioState(): { state: string; sampleRate: string; enabled: boolean } {
  return {
    state: ctx ? ctx.state : 'not created yet',
    sampleRate: ctx ? `${ctx.sampleRate}Hz` : '—',
    enabled: getSfxEnabled(),
  };
}

export function getSfxEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem('duel-sfx') !== '0';
  } catch {
    return true;
  }
}

let unlockBound = false;

/**
 * iOS Safari starts every AudioContext suspended and will only resume it inside
 * a real user gesture, so calling this from an effect is not enough on its own —
 * we also arm one-shot gesture listeners that resume the context and push a
 * silent buffer through it, which is what actually unlocks audio on iPhone.
 */
export function primeAudio() {
  enabled = getSfxEnabled();
  const c = ac();
  if (!c || unlockBound) return;
  unlockBound = true;

  const unlock = () => {
    const cur = ac();
    if (!cur || cur.state === 'running') return;
    void cur.resume();
    try {
      const buf = cur.createBuffer(1, 1, 22050);
      const src = cur.createBufferSource();
      src.buffer = buf;
      src.connect(cur.destination);
      src.start(0);
    } catch {
      /* the resume above is the part that matters */
    }
  };

  /* The listeners stay bound for the life of the page rather than being removed
     once the context first reaches "running". iOS suspends it again whenever it
     feels like it — switching apps, a phone call, the screen locking — and once
     the one-shot unlock had fired there was nothing left to bring it back, so
     the duel simply went quiet and stayed quiet. `unlock` returns immediately
     when the context is already running, so leaving them bound costs nothing. */
  for (const ev of ['touchend', 'pointerdown', 'click', 'keydown'] as const) {
    window.addEventListener(ev, unlock, { passive: true });
  }

  // Coming back to the tab, and coming back from the bfcache.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void ac()?.resume();
  });
  window.addEventListener('pageshow', () => void ac()?.resume());
}

function tone(opts: {
  freq: number;
  to?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  sweepType?: 'exp' | 'lin';
}) {
  if (!enabled) return;
  const c = ac();
  if (!c || !master) return;
  /* `resume()` is asynchronous, so a sound scheduled in the same tick as the
     resume is scheduled against a clock that is not running yet and is simply
     lost. That is what made the audio intermittent rather than absent: whichever
     sounds happened to land first after a suspend never played. */
  if (c.state !== 'running') return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, t0);
  if (opts.to && opts.to !== opts.freq) {
    if (opts.sweepType === 'lin') osc.frequency.linearRampToValueAtTime(opts.to, t0 + opts.dur);
    else osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + opts.dur);
  }
  const peak = opts.gain ?? 0.3;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + opts.dur + 0.05);
}

function noise(opts: { dur: number; gain?: number; delay?: number; filter?: number; sweep?: number }) {
  if (!enabled) return;
  const c = ac();
  if (!c || !master) return;
  if (c.state !== 'running') return; // see `tone` — a suspended clock swallows it
  const t0 = c.currentTime + (opts.delay ?? 0);
  const frames = Math.max(1, Math.floor(c.sampleRate * opts.dur));
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(opts.filter ?? 900, t0);
  if (opts.sweep) bp.frequency.exponentialRampToValueAtTime(Math.max(40, opts.sweep), t0 + opts.dur);
  const g = c.createGain();
  g.gain.setValueAtTime(opts.gain ?? 0.25, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
  src.connect(bp).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  draw: () => noise({ dur: 0.13, gain: 0.16, filter: 2600, sweep: 1100 }),
  place: () => {
    tone({ freq: 180, to: 90, dur: 0.11, type: 'triangle', gain: 0.22 });
    noise({ dur: 0.07, gain: 0.1, filter: 700 });
  },
  summon: () => {
    tone({ freq: 160, to: 520, dur: 0.42, type: 'sawtooth', gain: 0.14 });
    tone({ freq: 320, to: 900, dur: 0.5, type: 'sine', gain: 0.12, delay: 0.04 });
    noise({ dur: 0.4, gain: 0.14, filter: 380, sweep: 2200 });
  },
  bigSummon: () => {
    tone({ freq: 90, to: 55, dur: 0.9, type: 'sawtooth', gain: 0.2 });
    tone({ freq: 220, to: 720, dur: 0.7, type: 'square', gain: 0.09, delay: 0.05 });
    noise({ dur: 0.8, gain: 0.2, filter: 300, sweep: 3000 });
  },
  attack: () => {
    noise({ dur: 0.2, gain: 0.24, filter: 1800, sweep: 300 });
    tone({ freq: 420, to: 120, dur: 0.22, type: 'sawtooth', gain: 0.18 });
  },
  impact: () => {
    tone({ freq: 130, to: 44, dur: 0.34, type: 'square', gain: 0.28 });
    noise({ dur: 0.3, gain: 0.3, filter: 260 });
  },
  damage: () => {
    tone({ freq: 300, to: 90, dur: 0.3, type: 'sawtooth', gain: 0.2 });
    noise({ dur: 0.22, gain: 0.16, filter: 500 });
  },
  heal: () => {
    tone({ freq: 520, to: 880, dur: 0.35, type: 'sine', gain: 0.16 });
    tone({ freq: 780, to: 1180, dur: 0.4, type: 'sine', gain: 0.1, delay: 0.07 });
  },
  destroy: () => {
    noise({ dur: 0.5, gain: 0.3, filter: 1500, sweep: 120 });
    tone({ freq: 200, to: 40, dur: 0.5, type: 'square', gain: 0.16 });
  },
  spell: () => {
    tone({ freq: 640, to: 1320, dur: 0.3, type: 'triangle', gain: 0.15 });
    noise({ dur: 0.28, gain: 0.1, filter: 2000, sweep: 5200 });
  },
  trap: () => {
    tone({ freq: 900, to: 180, dur: 0.45, type: 'square', gain: 0.2 });
    noise({ dur: 0.4, gain: 0.2, filter: 1200, sweep: 200 });
  },
  flip: () => noise({ dur: 0.14, gain: 0.16, filter: 1500, sweep: 600 }),
  phase: () => {
    tone({ freq: 300, to: 460, dur: 0.2, type: 'sine', gain: 0.12 });
  },
  win: () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      tone({ freq: f, dur: 0.7, type: 'triangle', gain: 0.18, delay: i * 0.12 })
    );
  },
  lose: () => {
    [392, 349.23, 293.66, 220].forEach((f, i) =>
      tone({ freq: f, dur: 0.75, type: 'sine', gain: 0.16, delay: i * 0.16 })
    );
  },
  click: () => tone({ freq: 640, to: 480, dur: 0.06, type: 'sine', gain: 0.12 }),
  error: () => tone({ freq: 190, to: 130, dur: 0.18, type: 'square', gain: 0.16 }),
};

export type SfxName = keyof typeof sfx;
