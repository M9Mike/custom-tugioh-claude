'use client';

/**
 * Cutting a 25-card deck out of what the player is offered.
 *
 * Used twice, for two different things, deliberately with no branch between
 * them: the first time it is the starter pool and the choice is permanent, and
 * every time after it is the collection and it is just Edit Deck. The only
 * difference the component itself knows about is the wording of the header and
 * whether the confirmation warns you.
 *
 * One tap does two jobs — it moves the card in or out *and* opens it in the
 * strip above. Twenty-five picks is a lot of tapping to make somebody do twice
 * per card, and a deck built without reading the cards is the same as a random
 * one.
 */

import { useMemo, useState } from 'react';
import { CARDS } from '@/game/cards';
import GameCard from '@/components/GameCard';
import CardDetail from '@/components/CardDetail';
import { previewInstances } from '@/components/deckPreview';
import type { CardInstance } from '@/game/types';
import { DECK_SIZE } from '@/story/roster';
import { sfx } from '@/lib/sfx';

interface Props {
  /** Everything the player may choose from, in the order it is offered. */
  pool: string[];
  /** Where the builder starts — the current deck when editing, empty when new. */
  initial?: string[];
  /** True the first time: the choice also decides what they will own. */
  first: boolean;
  onConfirm: (deck: string[]) => Promise<string | null>;
  onCancel?: () => void;
}

export default function DeckBuilder({ pool, initial, first, onConfirm, onCancel }: Props) {
  const [chosen, setChosen] = useState<string[]>(() => (initial ?? []).filter((s) => pool.includes(s)));
  const [inspect, setInspect] = useState<CardInstance | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inDeck = useMemo(() => new Set(chosen), [chosen]);
  const complete = chosen.length === DECK_SIZE;

  /* Card instances are made once for the whole pool and then only looked up.
     Rebuilding them per render threw away the identity the card component keys
     on, which on a 34-card grid is 34 re-mounts for every tap. */
  const instances = useMemo(() => {
    const list = previewInstances(pool.map((s) => [s, 1] as [string, number]));
    return new Map(pool.map((slug, i) => [slug, list[i]]));
  }, [pool]);

  const toggle = (slug: string) => {
    setError(null);
    setInspect(instances.get(slug) ?? null);
    setChosen((cur) => {
      if (cur.includes(slug)) {
        sfx.flip();
        return cur.filter((s) => s !== slug);
      }
      if (cur.length >= DECK_SIZE) {
        sfx.error();
        setError(`That is ${DECK_SIZE} already. Take one out before adding another.`);
        return cur;
      }
      sfx.place();
      return [...cur, slug];
    });
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const problem = await onConfirm(chosen);
      if (problem) {
        setError(problem);
        setBusy(false);
        setAsking(false);
      }
      /* No success branch, deliberately: both callers move to another screen and
         this one unmounts, so clearing `busy` here would only flash the button
         back to life for a frame first. */
    } catch (err) {
      /* A rejection is a broken caller rather than a refused deck — but nothing
         else clears `busy` and nothing is going to unmount this screen either,
         so without this the builder sits on "Sleeving…" for ever. */
      console.error('deck builder: onConfirm rejected', err);
      setError('Your deck could not be saved. Try again in a moment.');
      setBusy(false);
      setAsking(false);
    }
  };

  return (
    <main className="safe-page mx-auto flex h-[100svh] w-full max-w-4xl flex-col overflow-hidden p-3">
      <div className="shrink-0 text-center">
        <h1 className="font-display text-xl leading-none text-brassbright sm:text-2xl">
          {first ? 'Cut your first deck' : 'Edit your deck'}
        </h1>
        <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-ptext/80">
          {first
            ? `Choose exactly ${DECK_SIZE} of the ${pool.length}. One copy of each — this is everything you have.`
            : `Choose exactly ${DECK_SIZE} from the ${pool.length} cards you own. One copy of each, for now.`}
        </p>
        <div className="brass-rule mx-auto my-2 w-40" />
      </div>

      <div className="mb-2 flex shrink-0 items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full border border-stoneline bg-black/40">
          <div
            className="h-full transition-[width] duration-200"
            style={{
              width: `${(chosen.length / DECK_SIZE) * 100}%`,
              background: complete
                ? 'linear-gradient(90deg,#8a723d,#e6c980)'
                : 'linear-gradient(90deg,#3a4351,#c2a15a)',
            }}
          />
        </div>
        <p className={`font-display text-sm tabular-nums ${complete ? 'text-brassbright' : 'text-ptextdim'}`}>
          {chosen.length}/{DECK_SIZE}
        </p>
      </div>

      {inspect && (
        <div className="mb-2 shrink-0">
          <CardDetail card={inspect} onClose={() => setInspect(null)} layout="row" />
        </div>
      )}

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-2">
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
          {pool.map((slug) => {
            const card = instances.get(slug);
            if (!card) return null;
            const picked = inDeck.has(slug);
            return (
              <button
                key={slug}
                type="button"
                onClick={() => toggle(slug)}
                aria-pressed={picked}
                aria-label={CARDS[slug]?.name ?? slug}
                className={`relative rounded text-left transition-transform ${picked ? 'selectable -translate-y-0.5' : 'opacity-75'}`}
              >
                <GameCard card={card} compact />
                {picked && (
                  <span className="absolute right-0.5 top-0.5 grid h-4 w-4 place-items-center rounded-full bg-brass text-[9px] font-bold text-ink">
                    ✓
                  </span>
                )}
                <p className="mt-0.5 truncate text-center text-[8px] leading-tight text-ptextdim">
                  {CARDS[slug]?.name ?? slug}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 border-t border-stoneline pt-2">
        {error && (
          <p className="mb-2 rounded border border-oxblood bg-[#2a1216]/70 px-3 py-2 text-[11px] text-[#f0c9cc]">{error}</p>
        )}
        <div className="flex gap-2">
          {onCancel && (
            <button className="btn rounded px-4 py-3 text-xs" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          )}
          <button className="btn rounded px-3 py-3 text-xs" onClick={() => setChosen([])} disabled={busy || !chosen.length}>
            Clear
          </button>
          <button
            className="btn btn-primary flex-1 rounded px-4 py-3 text-xs"
            disabled={busy || !complete}
            onClick={() => {
              sfx.click();
              if (first) return setAsking(true);
              void confirm();
            }}
          >
            {busy
              ? 'Sleeving…'
              : complete
                ? first
                  ? 'This is my deck'
                  : 'Save deck'
                : `${DECK_SIZE - chosen.length} more`}
          </button>
        </div>
      </div>

      {asking && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-5">
          <div className="panel grain w-full max-w-sm rounded p-5">
            <h2 className="font-display text-lg text-brassbright">Sleeve these {DECK_SIZE}?</h2>
            <div className="brass-rule my-3" />
            <p className="text-xs leading-relaxed text-ptext/85">
              This deck is bound to your name and travels with it. Take a moment — once it is sleeved, this is the
              deck you begin Story Mode with.
            </p>
            <div className="mt-4 flex gap-2">
              <button className="btn flex-1 rounded px-4 py-2 text-xs" onClick={() => setAsking(false)} disabled={busy}>
                Keep choosing
              </button>
              <button className="btn btn-primary flex-1 rounded px-4 py-2 text-xs" onClick={confirm} disabled={busy}>
                {busy ? 'Sleeving…' : 'Sleeve it'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
