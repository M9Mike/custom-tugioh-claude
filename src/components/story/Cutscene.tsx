'use client';

/**
 * Kaiba's broadcast, over the whole screen.
 *
 * It fades in from the world, plays, and fades back out to it. The film is the
 * broadcast (`story/broadcast.ts`); its lines are captioned underneath as they
 * are spoken, because a phone on a bus has the sound off and the rules of the
 * tournament are not something to miss.
 *
 * Three ways it can go, and all three end in the tournament:
 *
 * - **It plays.** Sound on, because the tap that closed the last conversation
 *   is the gesture a browser wants before it will play sound.
 * - **The browser wants a tap of its own.** iOS will not start sound outside a
 *   gesture however recent the last one was, so the broadcast waits behind a
 *   single button rather than playing silently or not at all.
 * - **The film will not come** — offline, or a browser that cannot decode it.
 *   Then the same lines are the broadcast, read a card at a time over his
 *   picture. The words are identical, which is the point of keeping them in
 *   one file.
 *
 * It plays to the end. The broadcast is shown once and it is the whole of the
 * rules, so there is no Skip — unless the film stops moving (a network that
 * has given up mid-stream), and then one appears, because nobody should be
 * held behind a frozen frame. Read aloud, the cards turn at reading pace by
 * themselves; a tap turns one sooner.
 */

import { useEffect, useRef, useState } from 'react';
import { BROADCAST, BROADCAST_FILM, BROADCAST_STILL } from '@/story/broadcast';
import { sfx } from '@/lib/sfx';

interface Props {
  onDone: () => void;
}

export default function Cutscene({ onDone }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  /** Fading in from the world, on screen, or fading back out to it. */
  const [stage, setStage] = useState<'in' | 'on' | 'out'>('in');
  /** The film is playable; false means the lines are read instead. */
  const [film, setFilm] = useState(true);
  /** The browser wants a gesture before it will play sound. */
  const [waiting, setWaiting] = useState(false);
  const [line, setLine] = useState(-1);
  /** Read-aloud mode: which card is up. */
  const [card, setCard] = useState(0);
  /** The film has stopped moving for long enough that the player may leave it. */
  const [stuck, setStuck] = useState(false);
  const ending = useRef(false);

  const finish = () => {
    if (ending.current) return;
    ending.current = true;
    video.current?.pause();
    setStage('out');
    window.setTimeout(onDone, 850);
  };

  useEffect(() => {
    const on = window.setTimeout(() => setStage('on'), 750);
    return () => window.clearTimeout(on);
  }, []);

  /* Frozen: the clock has not moved for five seconds while it should be playing. */
  useEffect(() => {
    if (stage !== 'on' || !film || waiting) return;
    let seen = -1;
    let since = performance.now();
    const watch = window.setInterval(() => {
      const v = video.current;
      if (!v || v.ended) return;
      if (v.currentTime !== seen) {
        seen = v.currentTime;
        since = performance.now();
        setStuck(false);
      } else if (performance.now() - since > 5000) setStuck(true);
    }, 500);
    return () => window.clearInterval(watch);
  }, [stage, film, waiting]);

  /* Read aloud: each card up for as long as it takes to read. */
  useEffect(() => {
    if (film || stage !== 'on') return;
    const text = BROADCAST[card]?.text ?? '';
    const turn = window.setTimeout(
      () => (card >= BROADCAST.length - 1 ? finish() : setCard(card + 1)),
      Math.min(7500, Math.max(3000, 1600 + text.length * 55))
    );
    return () => window.clearTimeout(turn);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- finish is stable in effect: it only reads refs
  }, [film, stage, card]);

  /* Roll the film once the screen is black — or discover it is not coming. */
  useEffect(() => {
    if (stage !== 'on' || !film) return;
    const v = video.current;
    if (!v) return;
    v.play().catch((err: unknown) => {
      const name = (err as { name?: string } | null)?.name;
      if (name === 'NotAllowedError') setWaiting(true);
      else setFilm(false);
    });
  }, [stage, film]);

  /* The caption follows the film's own clock, not a timer of ours. */
  useEffect(() => {
    if (!film) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = video.current;
      if (!v) return;
      let k = -1;
      for (let i = 0; i < BROADCAST.length; i++) if (v.currentTime >= BROADCAST[i].at) k = i;
      setLine((was) => (was === k ? was : k));
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [film]);

  const caption = film ? (line >= 0 ? BROADCAST[line].text : '') : BROADCAST[card]?.text ?? '';

  return (
    <div
      className="fixed inset-0 z-[70] overflow-hidden bg-black transition-opacity duration-700 ease-out"
      style={{ opacity: stage === 'on' ? 1 : 0 }}
      data-broadcast={film ? 'film' : 'read'}
      role="dialog"
      aria-modal
      aria-label="Kaiba Corporation broadcast"
    >
      {/* His picture, blurred behind whatever does not fill the screen — a
          portrait film on a landscape screen is pillarboxed in himself rather
          than in black. */}
      <div
        aria-hidden
        className="absolute inset-0 scale-110 bg-cover bg-center opacity-40 blur-2xl"
        style={{ backgroundImage: `url(${BROADCAST_STILL})` }}
      />
      {film ? (
        <video
          ref={video}
          className="absolute inset-0 h-full w-full object-contain"
          src={BROADCAST_FILM}
          poster={BROADCAST_STILL}
          playsInline
          preload="auto"
          onEnded={finish}
          onError={() => setFilm(false)}
        />
      ) : (
        <div
          className="absolute inset-0 animate-[broadcastdrift_30s_ease-out_forwards] bg-contain bg-center bg-no-repeat"
          style={{ backgroundImage: `url(${BROADCAST_STILL})` }}
          onClick={() => {
            sfx.click();
            if (card >= BROADCAST.length - 1) finish();
            else setCard((c) => c + 1);
          }}
        />
      )}

      {/* The banner: whose broadcast this is. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent px-4 pb-8"
        style={{ paddingTop: 'calc(var(--safe-top) + 14px)' }}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#b3322c] shadow-[0_0_0_3px_rgba(179,50,44,0.25)]" />
          <span className="text-[10px] font-semibold uppercase tracking-[0.34em] text-parchment/85">Kaiba Corporation · Live</span>
        </div>
      </div>

      {stuck && stage === 'on' && !waiting && (
        <button
          className="btn absolute right-0 top-0 rounded px-3 py-2 text-[11px]"
          style={{ marginTop: 'calc(var(--safe-top) + 10px)', marginRight: 'calc(var(--safe-right) + 12px)' }}
          onClick={() => {
            sfx.click();
            finish();
          }}
        >
          Skip ›
        </button>
      )}

      {/* The words, as they are spoken. */}
      {caption && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/90 via-black/60 to-transparent px-5 pt-16"
          style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}
        >
          <div className="max-w-xl text-center">
            <p className="mb-1.5 text-[9px] uppercase tracking-[0.36em] text-brass">Seto Kaiba</p>
            <p data-caption className="font-display text-[17px] leading-snug text-parchment sm:text-xl">{caption}</p>
          </div>
        </div>
      )}

      {waiting && (
        <div className="absolute inset-0 grid place-items-center bg-black/55">
          <button
            className="btn btn-primary rounded-full px-6 py-3 text-sm"
            onClick={() => {
              sfx.click();
              setWaiting(false);
              void video.current?.play().catch(() => setFilm(false));
            }}
          >
            ▶ Watch the broadcast
          </button>
        </div>
      )}
    </div>
  );
}
