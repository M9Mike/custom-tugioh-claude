'use client';

/**
 * The tournament on paper: who holds how many star chips, whose chip is in
 * your pocket, and what happened at the tables you were not at.
 *
 * The round nobody watches is only real if somebody can read about it, so the
 * last one is here in full — "Kaela beat Joey" — and the table moves every time
 * you finish a duel. No rules written out: it is a game, and Kaiba said them
 * once, which is once more than a player needs.
 *
 * And the finals announcement: the four names, and where.
 */

import { CHIPS_TO_FINALS, YOU, standings, type TournamentState } from '@/story/tournament';
import { sfx } from '@/lib/sfx';

interface BoardProps {
  tournament: TournamentState;
  playerName: string;
  /** Display names by duelist id. */
  names: Record<string, string>;
  onClose: () => void;
}

function Stars({ n }: { n: number }) {
  return (
    <span className="whitespace-nowrap tracking-tight" aria-label={`${n} star chips`}>
      {Array.from({ length: Math.min(n, CHIPS_TO_FINALS) }, (_, i) => (
        <span key={i} className="text-brassbright">★</span>
      ))}
      {Array.from({ length: Math.max(0, CHIPS_TO_FINALS - n) }, (_, i) => (
        <span key={i} className="text-stoneline">★</span>
      ))}
      {n > CHIPS_TO_FINALS && <span className="ml-1 text-[10px] text-brassbright">+{n - CHIPS_TO_FINALS}</span>}
    </span>
  );
}

export default function TournamentBoard({ tournament: t, playerName, names, onClose }: BoardProps) {
  const table = standings(t);
  const name = (id: string) => (id === YOU ? playerName : names[id] ?? id);
  const finalists = t.finals?.finalists ?? [];
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-ink/80 p-3 backdrop-blur-[2px]"
      style={{ paddingTop: 'calc(var(--safe-top) + 12px)', paddingBottom: 'calc(var(--safe-bottom) + 12px)' }}
      onClick={onClose}
    >
      <div
        className="panel grain flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="The tournament"
        data-board
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-stoneline bg-black/25 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.32em] text-brass">Kaiba Corporation</p>
            <h2 className="font-display text-xl leading-none text-brassbright">The Tournament</h2>
          </div>
          <button
            className="btn shrink-0 rounded px-3 py-2 text-[11px]"
            onClick={() => {
              sfx.click();
              onClose();
            }}
          >
            ✕ Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {t.finals ? (
            <div className="rounded border border-brassdim bg-black/30 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.3em] text-brass">The finals · Central Towers</p>
              <p className="mt-1 text-[13px] leading-relaxed text-parchment">{finalists.map(name).join(' · ')}</p>
            </div>
          ) : (
            <div className="rounded border border-stoneline bg-black/25 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.3em] text-brass">Your star chips</p>
              <div className="mt-1 flex items-center justify-between gap-3">
                <Stars n={t.chips.length} />
                <span className="font-display text-sm text-parchment">
                  {t.chips.length} of {CHIPS_TO_FINALS}
                </span>
              </div>
              {t.chips.length > 0 && <p className="mt-1.5 text-[11px] leading-relaxed text-ptextdim">{t.chips.map(name).join(' · ')}</p>}
            </div>
          )}

          <p className="mt-4 text-[10px] uppercase tracking-[0.3em] text-brass">Standings</p>
          <ol className="mt-1.5 divide-y divide-stoneline/60">
            {table.map((row, i) => {
              const you = row.id === YOU;
              const held = !you && t.chips.includes(row.id);
              const through = finalists.includes(row.id);
              return (
                <li key={row.id} className={`flex items-center gap-2 py-1.5 text-[12px] ${you ? 'text-parchment' : 'text-ptext'}`} data-standing={row.id}>
                  <span className="w-5 text-right text-[10px] text-ptextdim">{i + 1}</span>
                  <span className={`min-w-0 flex-1 truncate ${you ? 'font-display text-brassbright' : ''}`}>{name(row.id)}</span>
                  {through && <span className="rounded border border-brassdim px-1.5 text-[9px] uppercase tracking-wider text-brassbright">finalist</span>}
                  {held && <span className="text-[9px] uppercase tracking-wider text-ptextdim" title="You hold their star chip">your chip</span>}
                  <span className="w-6 text-right font-display text-sm">{row.chips}</span>
                </li>
              );
            })}
          </ol>

          {t.latest && t.latest.length > 0 && (
            <>
              <p className="mt-4 text-[10px] uppercase tracking-[0.3em] text-brass">Elsewhere, last round</p>
              <ul className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed text-ptextdim">
                {t.latest.map((d) => (
                  <li key={`${d.a}-${d.b}`}>
                    <span className="text-ptext">{name(d.winner)}</span> beat {name(d.winner === d.a ? d.b : d.a)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface FinalsProps {
  tournament: TournamentState;
  playerName: string;
  names: Record<string, string>;
  onClose: () => void;
}

/** The finals, announced: the four names, and where to go. */
export function FinalsCard({ tournament: t, playerName, names, onClose }: FinalsProps) {
  const finalists = t.finals?.finalists ?? [];
  const name = (id: string) => (id === YOU ? playerName : names[id] ?? id);
  const chips = (id: string) => (id === YOU ? t.chips.length : (t.board[id] ?? []).length);
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/85 p-5" data-finals>
      <div className="panel grain w-full max-w-sm rounded p-5 text-center">
        <p className="text-[10px] uppercase tracking-[0.36em] text-brass">Kaiba Corporation</p>
        <h2 className="mt-1 font-display text-2xl text-brassbright">The Finals</h2>
        <div className="brass-rule my-3" />
        <ol className="space-y-1.5">
          {finalists.map((id, i) => (
            <li key={id} className="flex items-center justify-between rounded border border-stoneline bg-black/25 px-3 py-1.5">
              <span className={`text-[13px] ${i === 0 ? 'font-display text-brassbright' : 'text-parchment'}`}>{name(id)}</span>
              <span className="font-display text-sm text-brass">{chips(id)} ★</span>
            </li>
          ))}
        </ol>
        <button
          className="btn btn-primary mt-4 w-full rounded px-4 py-2.5 text-xs"
          onClick={() => {
            sfx.click();
            onClose();
          }}
        >
          To Central Towers
        </button>
      </div>
    </div>
  );
}
