'use client';

/**
 * What this phone actually reports.
 *
 * Safe areas cannot be reproduced off-device: a desktop WebKit build is not an
 * iOS home-screen app, and `env(safe-area-inset-*)` is 0 everywhere else. This
 * page exists so a wrong inset can be read off the real device instead of
 * guessed at twice. Open it from the installed app and screenshot it.
 */
import Link from 'next/link';
import { useSyncExternalStore } from 'react';
import { audioState, primeAudio, sfx } from '@/lib/sfx';

interface Reading {
  audio: string;
  audioRate: string;
  audioEnabled: string;
  standalone: string;
  displayMode: string;
  envTop: string;
  envBottom: string;
  envLeft: string;
  envRight: string;
  safeTop: string;
  safeBottom: string;
  innerHeight: string;
  screenHeight: string;
  visualViewport: string;
  dpr: string;
}

/** Reads an `env()` value by letting the engine resolve it into a padding. */
function readEnv(prop: string): string {
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;top:0;left:0;visibility:hidden;padding-top:env(${prop},0px)`;
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).paddingTop;
  probe.remove();
  return value || '—';
}

/**
 * The reading, as a tiny store: taken once per page load, the same object
 * every render, and replaced (with the listeners told) when the sound test
 * has something new to say. `useSyncExternalStore` renders it without a
 * hydration mismatch — the server shows nothing, the client shows the phone.
 */
let reading: Reading | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function refreshAudio() {
  if (!reading) return;
  const a = audioState();
  reading = { ...reading, audio: a.state, audioRate: a.sampleRate };
  for (const fn of listeners) fn();
}
function readOnce(): Reading {
  if (reading) return reading;
    const nav = navigator as Navigator & { standalone?: boolean };
    const root = getComputedStyle(document.documentElement);
    const vv = window.visualViewport;
    const a = audioState();
  reading = {
      audio: a.state,
      audioRate: a.sampleRate,
      audioEnabled: a.enabled ? 'on' : 'off (turned off in the duel menu)',
      standalone: nav.standalone === undefined ? 'undefined (not iOS)' : String(nav.standalone),
      displayMode: ['standalone', 'fullscreen', 'minimal-ui', 'browser']
        .filter((m) => window.matchMedia(`(display-mode: ${m})`).matches)
        .join(', ') || 'none matched',
      envTop: readEnv('safe-area-inset-top'),
      envBottom: readEnv('safe-area-inset-bottom'),
      envLeft: readEnv('safe-area-inset-left'),
      envRight: readEnv('safe-area-inset-right'),
      safeTop: root.getPropertyValue('--safe-top').trim() || '—',
      safeBottom: root.getPropertyValue('--safe-bottom').trim() || '—',
      innerHeight: `${window.innerHeight}px`,
      screenHeight: `${window.screen.height}px`,
      visualViewport: vv ? `${Math.round(vv.width)}×${Math.round(vv.height)}` : 'unsupported',
      dpr: String(window.devicePixelRatio),
  };
  return reading;
}

export default function Diag() {
  const r = useSyncExternalStore(subscribe, readOnce, () => null);

  const rows: [string, string][] = r
    ? [
        ['AudioContext state', r.audio],
        ['audio sample rate', r.audioRate],
        ['sound setting', r.audioEnabled],
        ['navigator.standalone', r.standalone],
        ['display-mode matches', r.displayMode],
        ['env(safe-area-inset-top)', r.envTop],
        ['env(safe-area-inset-bottom)', r.envBottom],
        ['env(safe-area-inset-left)', r.envLeft],
        ['env(safe-area-inset-right)', r.envRight],
        ['--safe-top resolves to', r.safeTop],
        ['--safe-bottom resolves to', r.safeBottom],
        ['window.innerHeight', r.innerHeight],
        ['screen.height', r.screenHeight],
        ['visualViewport', r.visualViewport],
        ['devicePixelRatio', r.dpr],
      ]
    : [];

  return (
    <>
      {/* Painted bands at exactly the inset the app is using. If the top band is
          not covered by the status bar, the top inset is right. */}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-50 bg-oxblood/70"
        style={{ height: 'var(--safe-top)' }}
        aria-hidden
      />
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 bg-sea/70"
        style={{ height: 'var(--safe-bottom)' }}
        aria-hidden
      />

      <main className="safe-page mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col gap-3 p-4">
        <div className="text-center">
          <p className="font-display text-[10px] uppercase tracking-[0.4em] text-brass">Diagnostics</p>
          <h1 className="mt-1 font-display text-2xl text-brassbright">Safe areas</h1>
          <div className="brass-rule mx-auto my-2 w-40" />
          <p className="text-[11px] leading-relaxed text-ptextdim">
            Red band = the top inset the app is using. Green band = the bottom one. If the red band sits under the
            clock rather than beside it, the top inset is too small.
          </p>
        </div>

        <div className="panel grain rounded p-3">
          {!r && <p className="text-xs text-ptextdim">Reading…</p>}
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 border-b border-stoneline/40 py-1.5 last:border-0">
              <span className="text-[11px] text-ptextdim">{k}</span>
              <span className="font-display text-[12px] text-parchment">{v}</span>
            </div>
          ))}
        </div>

        {/* Tapping this is a real user gesture, which is the only thing iOS
            will unlock audio inside. If the state above says "suspended" and
            this makes a noise, the context needed a gesture; if it says
            "running" and you hear nothing, it is the ringer switch. */}
        <button
          className="btn mx-auto rounded px-5 py-2 text-xs"
          onClick={() => {
            primeAudio();
            sfx.attack();
            refreshAudio();
          }}
        >
          🔊 Test the sound
        </button>

        <Link href="/" className="btn mx-auto rounded px-5 py-2 text-xs">
          Back to the arena
        </Link>
      </main>
    </>
  );
}
