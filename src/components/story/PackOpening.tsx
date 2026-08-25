'use client';

/**
 * The Thrill of the Pull.
 *
 * You beat somebody, you get a pack, and the pack is made of *their* deck. This
 * screen is the moment between those two things, and its whole job is to make
 * three cards take longer than three cards need to take.
 *
 * ## Why it is a tap and not an animation
 *
 * The pull is already decided when this screen opens — the server drew it, and
 * `openPack` is where it happened. So nothing here is suspense in the honest
 * sense; it is pacing. Cards turn one at a time, on the player's own tap, and
 * the reason they are tapped rather than timed is that a timed reveal is the
 * same length whether you care or not. Somebody opening their fortieth pack can
 * go through it as fast as they can tap, and somebody opening their first can
 * sit on each card.
 *
 * ## What each card can be
 *
 * `kept` went into the Trunk. `duplicate` did not, and the line says only that
 * you already have it — deliberately not *why* a second copy is impossible.
 * That is a limit the game has not explained yet and is not going to explain
 * here.
 *
 * A pack can also come back with fewer than three cards, or none at all, once a
 * duelist's deck is running out. That is the truth of the pool rather than a
 * failure, so the screen says which duelist is finished instead of padding the
 * pack out with cards that do not exist.
 */

import { useMemo, useState } from 'react';
import { CARDS } from '@/game/cards';
import GameCard from '@/components/GameCard';
import { previewInstances } from '@/components/deckPreview';
import { sfx } from '@/lib/sfx';
import type { PackResult } from '@/story/packs';

interface Props {
  pack: PackResult;
  /** What to call the duelist it came from — their name, not their id. */
  from: string;
  onDone: () => void;
}

export default function PackOpening({ pack, from, onDone }: Props) {
  /* How many have been turned over. The pack is fully revealed at `pulls.length`. */
  const [shown, setShown] = useState(0);

  const cards = useMemo(
    () => previewInstances(pack.pulls.map((p) => [p.slug, 1] as [string, number])),
    [pack]
  );

  const all = shown >= pack.pulls.length;
  const empty = pack.pulls.length === 0;

  const turn = () => {
    if (all) return;
    const next = pack.pulls[shown];
    /* The sound is the reward. A card you already own gets the flat one, which
       is the only place this screen admits the difference before you read it. */
    if (next?.outcome === 'kept') sfx.place();
    else sfx.flip();
    setShown((n) => n + 1);
  };

  return (
    <main className="safe-page fixed inset-0 z-50 grid place-items-center bg-black/90 p-4" data-pack>
      <div className="panel grain w-full max-w-lg rounded p-5 text-center">
        <p className="font-display text-[11px] uppercase tracking-[0.2em] text-ptextdim">The Thrill of the Pull</p>
        <h1 className="mt-1 font-display text-xl text-brassbright sm:text-2xl">
          {from}&rsquo;s pack
        </h1>
        <div className="brass-rule mx-auto my-3 w-40" />

        {empty ? (
          <p className="px-2 py-6 text-sm leading-relaxed text-ptext/90" data-pack-empty>
            You have obtained all cards from this Duelist!
          </p>
        ) : (
          <>
            <div className="flex justify-center gap-2 sm:gap-3">
              {pack.pulls.map((pull, i) => {
                const revealed = i < shown;
                return (
                  <div key={pull.key} className="flex w-[30%] max-w-[8.5rem] flex-col items-center">
                    <div className={`w-full transition-transform duration-300 ${revealed ? '' : 'opacity-60'}`}>
                      {revealed ? (
                        <GameCard card={cards[i]} compact />
                      ) : (
                        <div className="grid aspect-[2/3] w-full place-items-center rounded border border-stoneline bg-[#151a22]">
                          <span className="font-display text-2xl text-brass/50">?</span>
                        </div>
                      )}
                    </div>
                    {revealed && (
                      <p
                        data-pull={pull.slug}
                        data-outcome={pull.outcome}
                        className={`mt-1 text-[9px] leading-tight ${
                          pull.outcome === 'kept' ? 'text-brassbright' : 'text-ptextdim'
                        }`}
                      >
                        {pull.outcome === 'kept'
                          ? CARDS[pull.slug]?.name ?? pull.slug
                          : 'You already have this card!'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {all && pack.exhausted && (
              <p className="mt-4 text-xs leading-relaxed text-brassbright" data-pack-exhausted>
                You have obtained all cards from this Duelist!
              </p>
            )}
            {all && !pack.exhausted && (
              <p className="mt-4 text-[11px] text-ptextdim">
                {pack.left} card{pack.left === 1 ? '' : 's'} left in {from}&rsquo;s deck.
              </p>
            )}
          </>
        )}

        <button
          data-pack-next
          className="btn btn-primary mt-5 w-full rounded px-4 py-3 text-xs"
          onClick={() => {
            if (all || empty) {
              sfx.click();
              onDone();
            } else {
              turn();
            }
          }}
        >
          {empty ? 'Back' : all ? 'Done' : shown === 0 ? 'Open it' : 'Next card'}
        </button>
      </div>
    </main>
  );
}
