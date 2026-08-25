'use client';

/**
 * The Trunk and the Deck, and moving cards between them.
 *
 * Used twice, for two different things, deliberately with no branch between
 * them: the first time the Trunk is the starter pool and the choice is
 * permanent, and every time after it is everything the player owns and it is
 * just Edit Deck. The component knows about the difference only in the wording
 * of the header and whether the confirmation warns you.
 *
 * ## Two lists, not one grid with ticks
 *
 * It used to be a single pool with a tick on the chosen cards, which is fine for
 * cutting a first deck out of thirty-four and wrong the moment a collection
 * grows. "Which twenty-five am I actually running" is the question this screen
 * exists to answer, and a tick scattered through a hundred cards does not answer
 * it. The Deck is its own list, at the top, always showing exactly what is in it.
 *
 * One tap moves a card across *and* opens it in the strip above. Twenty-five
 * picks is a lot of tapping to make somebody do twice per card, and a deck built
 * without reading the cards is the same as a random one.
 *
 * ## You cannot leave with a deck that would not be legal
 *
 * Save is only live at exactly `DECK_SIZE`. Discard is only offered when the
 * *stored* deck is legal to go back to — which it always is today, and is the
 * whole reason the check is written down rather than assumed: the day something
 * puts an illegal deck in a save, this screen is where the player fixes it, and
 * a Discard button would be a way to walk out still broken.
 */

import { useMemo, useRef, useState } from 'react';
import { CARDS } from '@/game/cards';
import GameCard from '@/components/GameCard';
import CardDetail from '@/components/CardDetail';
import { previewInstances } from '@/components/deckPreview';
import type { CardInstance } from '@/game/types';
import { DECK_SIZE, validateDeck } from '@/story/roster';
import { sfx } from '@/lib/sfx';

interface Props {
  /** Everything the player may choose from — the starter pool, or all they own. */
  pool: string[];
  /** Where the builder starts: the current deck when editing, empty when new. */
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

  /** What is left in the Trunk: owned, and not currently sleeved. */
  const trunk = useMemo(() => pool.filter((s) => !inDeck.has(s)), [pool, inDeck]);

  /**
   * Whether the deck already stored is one this screen may be left on.
   *
   * Discarding goes back to `initial`, so it is only an exit if `initial` is
   * legal. Today it always is — the only writer is this screen and the server
   * checks it again — and that is exactly why the guard is cheap to keep.
   */
  const canDiscard = useMemo(
    () => !first && !!onCancel && validateDeck(initial ?? [], pool).ok,
    [first, onCancel, initial, pool]
  );

  /* Card instances are made once for the whole pool and then only looked up.
     Rebuilding them per render threw away the identity the card component keys
     on, which on a large collection is a re-mount for every tap. */
  const instances = useMemo(() => {
    const list = previewInstances(pool.map((s) => [s, 1] as [string, number]));
    return new Map(pool.map((slug, i) => [slug, list[i]]));
  }, [pool]);

  /**
   * A card moves across, and the strip above opens it.
   *
   * The two halves are deliberately split. What the player *hears* is decided
   * out here from this render's `chosen`, because React may call a state updater
   * more than once — Strict Mode does so on every render in development — and
   * one tap was playing its sound twice and setting the message twice. What the
   * deck *becomes* still goes through an updater, because two taps landing
   * before a re-render would otherwise both build their new list from the same
   * stale array and the second would undo the first.
   */
  const toggle = (slug: string) => {
    setError(null);
    setInspect(instances.get(slug) ?? null);
    if (inDeck.has(slug)) {
      sfx.flip();
      setChosen((cur) => cur.filter((s) => s !== slug));
      return;
    }
    if (chosen.length >= DECK_SIZE) {
      sfx.error();
      setError(`That is ${DECK_SIZE} already. Move one back to the Trunk before adding another.`);
      return;
    }
    sfx.place();
    setChosen((cur) => (cur.includes(slug) || cur.length >= DECK_SIZE ? cur : [...cur, slug]));
  };

  /* See the note on the same guard in the creation booth: `busy` is state and
     does not take effect until the next render, so a fast double-tap can post
     twice. Sleeving is permanent; once means once. */
  const sleeving = useRef(false);

  const confirm = async () => {
    if (sleeving.current) return;
    sleeving.current = true;
    setBusy(true);
    setError(null);
    try {
      const problem = await onConfirm(chosen);
      if (problem) {
        setError(problem);
        setBusy(false);
        setAsking(false);
        sleeving.current = false;
      }
      /* No success branch, deliberately: both callers move to another screen and
         this one unmounts, so clearing `busy` here would only flash the button
         back to life for a frame first. */
    } catch (err) {
      console.error('deck builder: onConfirm rejected', err);
      setError('Your deck could not be saved. Try again in a moment.');
      setBusy(false);
      setAsking(false);
      sleeving.current = false;
    }
  };

  const Card = ({ slug, held }: { slug: string; held: boolean }) => {
    const card = instances.get(slug);
    if (!card) return null;
    return (
      <button
        key={slug}
        type="button"
        onClick={() => toggle(slug)}
        aria-pressed={held}
        aria-label={CARDS[slug]?.name ?? slug}
        data-card={slug}
        data-where={held ? 'deck' : 'trunk'}
        className={`relative rounded text-left transition-transform ${held ? 'selectable -translate-y-0.5' : 'opacity-80'}`}
      >
        <GameCard card={card} compact />
        <p className="mt-0.5 truncate text-center text-[8px] leading-tight text-ptextdim">
          {CARDS[slug]?.name ?? slug}
        </p>
      </button>
    );
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
            : `Exactly ${DECK_SIZE} cards, one copy of each. Tap to move a card between the Trunk and your Deck.`}
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
        <p
          data-deck-count
          className={`font-display text-sm tabular-nums ${complete ? 'text-brassbright' : 'text-ptextdim'}`}
        >
          {chosen.length}/{DECK_SIZE}
        </p>
      </div>

      {inspect && (
        <div className="mb-2 shrink-0">
          <CardDetail card={inspect} onClose={() => setInspect(null)} layout="row" />
        </div>
      )}

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-2">
        <section aria-label="Deck" data-section="deck">
          <h2 className="sticky top-0 z-10 -mx-1 bg-ink/95 px-1 py-1 font-display text-[11px] uppercase tracking-wider text-brassbright">
            Deck · {chosen.length}/{DECK_SIZE}
          </h2>
          {chosen.length === 0 ? (
            <p className="px-1 py-3 text-[11px] text-ptextdim">
              Nothing sleeved yet. Tap cards in the Trunk below.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
              {chosen.map((slug) => (
                <Card key={slug} slug={slug} held />
              ))}
            </div>
          )}
        </section>

        <section aria-label="Trunk" data-section="trunk" className="mt-3">
          <h2 className="sticky top-0 z-10 -mx-1 bg-ink/95 px-1 py-1 font-display text-[11px] uppercase tracking-wider text-ptextdim">
            Trunk · {trunk.length}
          </h2>
          {trunk.length === 0 ? (
            <p className="px-1 py-3 text-[11px] text-ptextdim">
              Every card you own is in your deck.
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
              {trunk.map((slug) => (
                <Card key={slug} slug={slug} held={false} />
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="shrink-0 border-t border-stoneline pt-2">
        {error && (
          <p className="mb-2 rounded border border-oxblood bg-[#2a1216]/70 px-3 py-2 text-[11px] text-[#f0c9cc]">{error}</p>
        )}
        <div className="flex gap-2">
          {canDiscard && (
            <button
              className="btn rounded px-4 py-3 text-xs"
              onClick={onCancel}
              disabled={busy}
              aria-label="Discard changes"
            >
              Discard
            </button>
          )}
          <button
            className="btn rounded px-3 py-3 text-xs"
            onClick={() => setChosen([])}
            disabled={busy || !chosen.length}
          >
            Empty
          </button>
          <button
            data-save-deck
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
