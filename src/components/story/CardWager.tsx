'use client';

/**
 * Choosing which card to put on the table.
 *
 * Tina's stake is four replies because four numbers are a conversation. A card
 * is not: a collection is dozens of cards and the choice is the whole decision,
 * so it gets a picker — the collection laid out in the one order every deck is
 * shown in, each card tappable, and a second tap to confirm. Cards that are in
 * the deck are marked, because losing one of those is losing a deck as well as
 * a card, and a player should know that before they bet it.
 *
 * It knows nothing about who is asking or what happens next: hand it a
 * collection and it hands back a slug. `Conversation` opens it when a reply
 * that duels is pressed for somebody who plays for a card, and closes it when
 * the choice is made or given up.
 */

import { useMemo, useState } from 'react';
import GameCard from '@/components/GameCard';
import { CARDS } from '@/game/cards';
import { compareCards } from '@/story/deckSort';
import { previewInstances } from '@/components/deckPreview';
import { sfx } from '@/lib/sfx';

interface Props {
  /** Every card the player owns. */
  collection: string[];
  /** The ones currently sleeved, so they can be marked. */
  deck: string[];
  /** Who is asking, for the heading. */
  askedBy: string;
  onPick: (slug: string) => void;
  onCancel: () => void;
}

export default function CardWager({ collection, deck, askedBy, onPick, onCancel }: Props) {
  const [chosen, setChosen] = useState<string | null>(null);
  const sleeved = useMemo(() => new Set(deck), [deck]);
  /* One entry per card, in deck order. A collection holds one of each for
     now; the day it holds two, this shows two. */
  const rows = useMemo(() => {
    const sorted = [...collection].sort(compareCards);
    return previewInstances(sorted.map((s) => [s, 1] as [string, number]));
  }, [collection]);

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col bg-black/80" data-card-wager>
      <div className="safe-page flex min-h-0 flex-1 flex-col p-3">
        <div className="panel grain flex min-h-0 flex-1 flex-col rounded p-3">
          <div className="flex items-baseline justify-between">
            <p className="font-display text-base leading-none text-brassbright">Put a card on the table</p>
            <button
              className="btn rounded px-2 py-1 text-[9px]"
              aria-label="Keep your cards"
              onClick={() => {
                sfx.click();
                onCancel();
              }}
            >
              ✕
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-ptext/85">
            {askedBy} wants one of your cards on the line. Win and it comes straight back. Lose and it is gone —
            and a card marked <span className="text-brassbright">deck</span> leaves your deck a card short.
          </p>
          <div className="brass-rule my-2.5" />
          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {rows.map((c) => {
                const picked = chosen === c.slug;
                return (
                  <button
                    key={c.uid}
                    type="button"
                    data-wager-card={c.slug}
                    className={`relative rounded text-left ${picked ? 'ring-2 ring-brassbright' : ''}`}
                    onClick={() => {
                      sfx.click();
                      setChosen(c.slug);
                    }}
                  >
                    <GameCard card={c} compact className="w-full" />
                    {sleeved.has(c.slug) && (
                      <span className="absolute left-1 top-1 rounded bg-black/75 px-1 py-0.5 font-display text-[8px] uppercase tracking-widest text-brassbright">
                        deck
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="mt-2.5 shrink-0 border-t border-stoneline pt-2.5">
            <p className="mb-2 min-h-[1rem] text-[11px] text-ptext/90">
              {chosen ? `${CARDS[chosen]?.name ?? chosen}${sleeved.has(chosen) ? ' — from your deck.' : '.'}` : 'Tap a card.'}
            </p>
            <button
              data-wager-confirm
              className="btn btn-primary w-full rounded px-3 py-2.5 text-[11px]"
              disabled={!chosen}
              onClick={() => {
                if (!chosen) return;
                sfx.click();
                onPick(chosen);
              }}
            >
              {chosen ? `Put ${CARDS[chosen]?.name ?? chosen} on the table` : 'Choose a card'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
