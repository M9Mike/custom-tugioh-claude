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

/* -------------------------------------------------------------------------- */
/* The audio session: what the iPhone's silent switch does to this page.       */
/* -------------------------------------------------------------------------- */

/**
 * iOS sorts every page's audio into a category, and the category decides what
 * the ringer switch does to it. A page that only ever uses an AudioContext is
 * "ambient": mixed with whatever else is playing and *muted by the switch*, so
 * on a phone kept on silent — which is most phones — every sound here was
 * rendered perfectly into nothing. `/diag` said "running" and the speaker said
 * nothing, and the note on that page has blamed the ringer switch since the
 * day it was written. Nothing in the old code could do anything about it.
 *
 * Safari 17 puts the choice in the page's hands as `navigator.audioSession.type`.
 * `playback` is the category a video gets — it plays through the switch — and it
 * is claimed only while sound is on: a muted duel goes back to `auto`, and the
 * context is parked with it, so the speaker (and whatever music was playing) is
 * handed back the moment the player asks for quiet. Browsers without the API
 * ignore the whole thing, and are not the ones muting us.
 */
type AudioSessionType = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';
type AudioSessionLike = { type: AudioSessionType };

function audioSession(): AudioSessionLike | null {
  if (typeof navigator === 'undefined') return null;
  return (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession ?? null;
}

function claimSession(on: boolean) {
  const s = audioSession();
  if (!s) return;
  try {
    s.type = on ? 'playback' : 'auto';
  } catch {
    /* a WebKit that has the object but not this value — nothing to claim */
  }
}

/**
 * The audio context, created only when `create` is set.
 *
 * iOS will not reliably resume a context that was *constructed* outside a user
 * gesture — and the old code built one from a mount effect, which is why sound
 * was missing until the app had been backgrounded and brought back (that path
 * goes through `visibilitychange`, which does resume it). Nothing creates it
 * now except `unlock` and the sound toggle, which only ever run inside a real
 * tap.
 *
 * On the way out, a compressor. The kit was mixed at a peak of about -16 dBFS —
 * a master of 0.32 under sounds that top out near 0.3 — which is a whisper from
 * a phone speaker. A compressor's makeup gain lifts the quiet sounds and holds
 * the loud ones, so the master can come up without a Fusion clipping.
 */
function ac(create = false): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    if (!create) return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    /* Claimed here and not on arrival: the phone's audio session is touched
       only by a page that is about to make a sound, never by one that is
       merely open. The context is built inside the first tap, so the claim
       precedes the first note by a few microseconds, which is all it needs. */
    claimSession(enabled);
    let made: AudioContext;
    try {
      made = new Ctor();
    } catch {
      return null;
    }
    const squeeze = made.createDynamicsCompressor();
    squeeze.threshold.value = -24;
    squeeze.knee.value = 20;
    squeeze.ratio.value = 4;
    squeeze.attack.value = 0.003;
    squeeze.release.value = 0.2;
    master = made.createGain();
    master.gain.value = 0.5;
    master.connect(squeeze).connect(made.destination);
    ctx = made;
  }
  void wake(ctx);
  return ctx;
}

/**
 * Asks a stalled context to run again, if sound is on.
 *
 * `suspended` is the state iOS starts every context in and the one it leaves it
 * in after the app has been away; `interrupted` is WebKit's own word for a phone
 * call or Siri taking the speaker, and it is not in the standard's list, so the
 * old test for `suspended` alone never asked for the speaker back after a call
 * — the duel stayed silent until the app was backgrounded and brought back,
 * which happens to go through `visibilitychange`. Anything that is not running
 * is asked. A context parked on purpose (sound turned off) is not, because a
 * muted page must not keep taking the speaker.
 */
function wake(c: AudioContext): Promise<void> {
  if (!enabled || c.state === 'running' || c.state === 'closed') return Promise.resolve();
  return c.resume().catch(() => undefined);
}

/**
 * How late a sound may still play after asking for the clock back.
 *
 * `resume()` is asynchronous, so a sound scheduled in the same tick as the
 * resume is scheduled against a clock that is not running yet — and on iPhone
 * it is simply lost. The old answer was to drop it, which made audio
 * intermittent rather than absent: whichever sounds landed first after every
 * suspend never played, and the first tap back into the app was always a silent
 * one. Now the sound waits for the clock — a few milliseconds, in practice —
 * and only gives up if the wait was long enough that the moment it belonged to
 * has gone. A turn that played out during a phone call is not owed its sounds
 * afterwards, all at once.
 */
const LATE_MS = 350;

function whenRunning(c: AudioContext, play: () => void) {
  if (c.state === 'running') {
    play();
    return;
  }
  const asked = performance.now();
  void wake(c).then(() => {
    if (enabled && c.state === 'running' && performance.now() - asked <= LATE_MS) play();
  });
}

export function setSfxEnabled(on: boolean) {
  enabled = on;
  try {
    window.localStorage.setItem('duel-sfx', on ? '1' : '0');
  } catch {
    /* ignore */
  }
  claimSession(on);
  /* The toggle is a tap, which is the one place iOS lets audio start — so a
     context that does not exist yet is built here, and one that was parked is
     started. Turning sound off parks it, and with it the audio session that
     would otherwise keep the speaker away from everything else on the phone. */
  if (on) void ac(true);
  else if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => undefined);
}

/**
 * What the audio engine is actually doing, for `/diag`.
 *
 * None of this reproduces off an iPhone — a desktop WebKit build recovers from
 * a suspended context happily — so when sound is intermittent the only way to
 * find out why is to read it off the phone. "suspended" means the context never
 * unlocked; "running" with no sound means the ringer switch, and the session
 * says whether the page was allowed to do anything about that.
 */
export function audioState(): { state: string; sampleRate: string; enabled: boolean; session: string } {
  const s = audioSession();
  return {
    state: ctx ? ctx.state : 'not created yet — tap something first',
    sampleRate: ctx ? `${ctx.sampleRate}Hz` : '—',
    enabled: getSfxEnabled(),
    session: s ? s.type : 'unsupported — the ringer switch wins',
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
 * we also arm gesture listeners that resume the context and push a silent
 * buffer through it, which is what actually unlocks audio on iPhone.
 */
export function primeAudio() {
  enabled = getSfxEnabled();
  if (typeof window === 'undefined' || unlockBound) return;
  unlockBound = true;

  const unlock = () => {
    // A muted page builds nothing and takes nothing.
    if (!enabled) return;
    // `true`: this is a real gesture, so it is the one moment the context may
    // legitimately be built.
    const cur = ac(true);
    if (!cur || cur.state === 'running') return;
    try {
      const buf = cur.createBuffer(1, 1, 22050);
      const src = cur.createBufferSource();
      src.buffer = buf;
      src.connect(cur.destination);
      src.start(0);
    } catch {
      /* the resume inside `ac` is the part that matters */
    }
  };

  /* The listeners stay bound for the life of the page rather than being removed
     once the context first reaches "running". iOS suspends it again whenever it
     feels like it — switching apps, a phone call, the screen locking — and once
     the one-shot unlock had fired there was nothing left to bring it back, so
     the duel simply went quiet and stayed quiet. `unlock` returns immediately
     when the context is already running, so leaving them bound costs nothing.

     Capture phase, so the context exists and has been asked to run before any
     handler further down the tree asks it for a sound: the tap that turns a
     page's sound on is also the first tap it is asked to make a noise for. */
  for (const ev of ['touchend', 'pointerdown', 'click', 'keydown'] as const) {
    window.addEventListener(ev, unlock, { passive: true, capture: true });
  }

  // Coming back to the tab, coming back from the bfcache, and — on some iOS
  // versions — coming back from an interruption, which only `focus` reports.
  const back = () => {
    if (ctx) void wake(ctx);
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) back();
  });
  window.addEventListener('pageshow', back);
  window.addEventListener('focus', back);
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
  const out = master;
  if (!c || !out) return;
  whenRunning(c, () => {
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
    osc.connect(g).connect(out);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.05);
  });
}

function noise(opts: { dur: number; gain?: number; delay?: number; filter?: number; sweep?: number }) {
  if (!enabled) return;
  const c = ac();
  const out = master;
  if (!c || !out) return;
  whenRunning(c, () => {
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
    src.connect(bp).connect(g).connect(out);
    src.start(t0);
  });
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
