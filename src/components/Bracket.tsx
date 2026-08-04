'use client';

import Link from 'next/link';
import { DUELIST_BY_ID, artUrl } from '@/game/cards';
import { roundNameAt, roundsFor, type Tournament, type TourMatch } from '@/server/tournament';

interface Props {
  t: Tournament;
  /** True while side matches are still being played out. */
  busy: boolean;
  onContinue?: () => void;
}

function Slot({ id, winner, you }: { id: string | null; winner: string | null; you: string }) {
  const d = id ? DUELIST_BY_ID[id] : null;
  const decided = winner !== null;
  const won = decided && winner === id;
  const isYou = id === you;
  return (
    <div className={`flex items-center gap-1.5 px-1 py-0.5 ${decided && !won ? 'opacity-40' : ''}`}>
      <div
        className="h-6 w-6 shrink-0 overflow-hidden rounded-full border bg-black/50"
        style={{ borderColor: won ? '#c9a227' : (d?.accent ?? '#3a4351') }}
      >
        {d && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artUrl(d.emblem)} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <span
        className={`min-w-0 flex-1 truncate font-display text-[11px] ${
          won ? 'text-brassbright' : 'text-ptext/85'
        }`}
      >
        {d?.name ?? 'To be decided'}
        {isYou && <span className="ml-1 text-[8px] uppercase tracking-wider text-brass">you</span>}
      </span>
      {won && <span className="shrink-0 text-[10px] text-brass">✓</span>}
    </div>
  );
}

/** One pairing. The box is what makes the two names read as a *match* and not
    as two more entries in a list — on a phone they are otherwise indistinguishable. */
function Match({ m, you }: { m: TourMatch; you: string }) {
  const yours = m.human && !m.winner;
  /* A bracket wider than the roster leaves empty places. They are byes: the
     duelist opposite walks through without duelling. */
  const bye = !m.a || !m.b;
  return (
    <div
      className={`rounded border px-1 py-1 ${
        yours ? 'border-brass/70 bg-brass/[0.07]' : 'border-stoneline/70 bg-black/30'
      }`}
    >
      {bye ? (
        /* A bye is one name walking through, so it gets one line — otherwise a
           bracket of ten in sixteen slots is mostly empty boxes to scroll past. */
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <Slot id={m.a ?? m.b} winner={m.winner} you={you} />
          </div>
          <span className="shrink-0 rounded bg-black/40 px-1.5 py-0.5 font-display text-[8px] uppercase tracking-[0.2em] text-ptextdim">
            bye
          </span>
        </div>
      ) : (
        <>
          <Slot id={m.a} winner={m.winner} you={you} />
          <div className="flex items-center gap-2 px-1 py-0.5">
            <div className="h-px flex-1 bg-stoneline/70" />
            <span className="font-display text-[8px] uppercase tracking-[0.2em] text-ptextdim">vs</span>
            <div className="h-px flex-1 bg-stoneline/70" />
          </div>
          <Slot id={m.b} winner={m.winner} you={you} />
        </>
      )}
      {yours && (
        <p className="mt-0.5 text-center font-display text-[8px] uppercase tracking-[0.2em] text-brass">
          your match
        </p>
      )}
    </div>
  );
}

export default function Bracket({ t, busy, onContinue }: Props) {
  // Derived from the bracket rather than fixed at three, so a bigger roster
  // simply grows another column.
  const total = roundsFor(t.entrants.length);
  const rounds = Array.from({ length: total }, (_, r) => t.matches.filter((m) => m.round === r));
  // Eliminated is not "done" until the bracket has actually crowned someone.
  const done = t.status === 'won' || (t.status === 'eliminated' && !!t.champion);
  const nameAt = (r: number) => roundNameAt(t.entrants.length, r);

  return (
    <main className="safe-page mx-auto flex min-h-[100dvh] w-full max-w-4xl flex-col justify-center gap-3 p-4">
      <div className="text-center">
        <p className="font-display text-[11px] uppercase tracking-[0.45em] text-brass">Duelist Kingdom</p>
        <h1 className="mt-1 font-display text-2xl tracking-wide text-brassbright sm:text-3xl">
          {t.status === 'won'
            ? '👑 Champion of the Kingdom'
            : t.status === 'eliminated'
              ? 'Eliminated'
              : nameAt(t.round)}
        </h1>
        <div className="brass-rule mx-auto my-2 w-48" />
      </div>

      {/* One column per round, side by side once there is room; stacked on a
          phone, where a wide tree would mean scrolling sideways to find out who
          is in the final. */}
      <div className="panel grain thin-scroll max-h-[62dvh] overflow-y-auto rounded p-3 sm:max-h-none sm:overflow-visible">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
          {rounds.map((matches, r) => (
            <div key={r} className="flex flex-1 flex-col gap-1.5 sm:justify-around">
              <p className="text-center font-display text-[9px] uppercase tracking-[0.25em] text-ptextdim">
                {nameAt(r)}
              </p>
              {matches.length === 0 ? (
                <div className="grid flex-1 place-items-center rounded border border-dashed border-stoneline/50 px-2 py-4 text-center text-[10px] leading-relaxed text-ptextdim/70">
                  Waiting on the {r > 0 ? nameAt(r - 1).toLowerCase() : 'draw'}
                </div>
              ) : (
                matches.map((m) => <Match key={`${m.round}-${m.slot}`} m={m} you={t.humanDuelist} />)
              )}
            </div>
          ))}
        </div>
      </div>

      {busy && (
        <div className="flex items-center justify-center gap-2 text-xs text-ptextdim">
          <span className="h-3 w-3 animate-spin rounded-full border border-brass/40 border-t-brass" />
          The other duels are being played out…
        </div>
      )}

      {t.status === 'eliminated' && (
        <p className="text-center text-sm leading-relaxed text-ptext/85">
          Knocked out in the {nameAt(t.round).toLowerCase()}. The bracket does not offer a rematch — but it plays
          itself out, so you can see how it ended.
        </p>
      )}
      {t.champion && t.champion !== t.humanDuelist && (
        <p className="text-center font-display text-sm text-brassbright">
          👑 {DUELIST_BY_ID[t.champion]?.name ?? t.champion} takes the Kingdom.
        </p>
      )}

      <div className="flex justify-center gap-2">
        {!done && !busy && onContinue && (
          <button className="btn btn-primary rounded px-5 py-2 text-xs" onClick={onContinue}>
            To the duel
          </button>
        )}
        <Link className="btn rounded px-5 py-2 text-xs" href="/">
          {done ? 'Back to the arena' : 'Leave the tournament'}
        </Link>
      </div>
    </main>
  );
}
