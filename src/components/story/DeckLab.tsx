'use client';

/**
 * A bench for building somebody else's deck.
 *
 * This is not the player's deck builder and deliberately shares none of its
 * rules. `DeckBuilder` is bound to a collection: you may take what you own, one
 * of each, and what you confirm is written to a save and locked to the account.
 * Nothing here is owned, nothing is saved, and the only thing that leaves this
 * screen is text on the clipboard.
 *
 * What it is *for*: Mike designs a deck by eye, taps Copy, and pastes the list
 * into the chat, where it becomes a duelist in `data/decklists.json` bound to
 * an NPC. That round trip is the whole feature, which is why the output is the
 * exact shape that file wants — `[["Dark Necrofear", 1], ["Newdoria", 2]]`,
 * card *names* rather than slugs, because `data/` is the hand-written side and
 * `generated/` is the mirror.
 *
 * ## Three, not one
 *
 * `MAX_COPIES` in `roster.ts` is one, and the note there says why: a player
 * owns a single copy of each card, so the limit is really the collection's
 * arithmetic. An NPC has no collection — the premades run doubles and triples
 * already — so this screen has its own limit and does not touch that one.
 *
 * ## What it will not do
 *
 * It does not check the deck is legal, and that is on purpose. A deck bound to
 * an NPC has to be twenty-five and the count is shown large enough to read
 * across the room, but a half-built deck is a thing worth copying and sending,
 * and a screen that refuses to hand it over is a screen you have to fight. The
 * binding end can count.
 */

import { memo, useMemo, useState } from 'react';
import { CARDS } from '@/game/cards';
import GameCard from '@/components/GameCard';
import CardDetail from '@/components/CardDetail';
import { previewInstances } from '@/components/deckPreview';
import type { CardInstance } from '@/game/types';
import { DECK_SIZE } from '@/story/roster';
import {
  TRUNK_FILTERS,
  TRUNK_SORTS,
  deckOrder,
  searchCards,
  trunkOrder,
  type TrunkFilter,
  type TrunkSort,
} from '@/story/deckSort';
import { sfx } from '@/lib/sfx';

/**
 * How many of one card a deck built here may hold.
 *
 * Three, which is the card game's own limit and what the premade duelists
 * already run. Deliberately not `roster.ts`'s `MAX_COPIES`: that one is a fact
 * about the player's collection, and importing it here would tie an NPC's deck
 * to what the player happens to own.
 */
const MAX = 3;

/** Every card in the game, which is the pool — there is nothing to own here. */
const POOL: string[] = Object.keys(CARDS);

export interface DeckLabProps {
  onClose: () => void;
}

const Tile = memo(function Tile({
  slug,
  count,
  card,
  onAdd,
  onDrop,
  onRead,
}: {
  slug: string;
  count: number;
  card: CardInstance;
  onAdd: (slug: string) => void;
  onDrop: (slug: string) => void;
  onRead: (slug: string) => void;
}) {
  const full = count >= MAX;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onAdd(slug)}
        disabled={full}
        aria-label={`Add ${CARDS[slug]?.name ?? slug}${full ? ' — already at three' : ''}`}
        className={`w-full rounded text-left ${count ? 'selectable' : 'opacity-80'} ${full ? 'cursor-not-allowed' : ''}`}
      >
        <GameCard card={card} compact />
        <p className="mt-0.5 truncate text-center text-[8px] leading-tight text-ptextdim">
          {CARDS[slug]?.name ?? slug}
        </p>
      </button>

      {/* Reading a card is its own button, as in the player's builder: tapping
          the card puts one in the deck, and there has to be a way to find out
          what a card does that is not also a way to pick it. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRead(slug);
        }}
        aria-label={`Read ${CARDS[slug]?.name ?? slug}`}
        className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full border border-brassdim bg-ink/85 text-[10px] font-bold leading-none text-brassbright hover:bg-ink"
      >
        i
      </button>

      {/* The count, and the way back down. One control: it shows how many are
          in and taking one out is tapping it, which is the only thing anybody
          wants to do to a number like this. */}
      {count > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDrop(slug);
          }}
          aria-label={`Remove one ${CARDS[slug]?.name ?? slug} — ${count} in the deck`}
          className="absolute bottom-4 left-0.5 grid h-5 min-w-[20px] place-items-center rounded-full border border-brassbright bg-brass px-1 text-[10px] font-bold leading-none text-ink"
        >
          {count}×
        </button>
      )}
    </div>
  );
});

export default function DeckLab({ onClose }: DeckLabProps) {
  /** slug → how many, 1..MAX. A card at zero is not in the map at all. */
  const [deck, setDeck] = useState<Record<string, number>>({});
  const [inspect, setInspect] = useState<CardInstance | null>(null);
  const [sort, setSort] = useState<TrunkSort>('curve');
  const [filter, setFilter] = useState<TrunkFilter>('all');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const total = useMemo(() => Object.values(deck).reduce((n, c) => n + c, 0), [deck]);

  /* One instance per card for the whole pool, made once: the card component
     keys on identity, and rebuilding these per render re-mounts every tile on
     every tap. Straight out of the player's builder, for the same reason. */
  const instances = useMemo(() => {
    const list = previewInstances(POOL.map((s) => [s, 1] as [string, number]));
    return new Map(POOL.map((slug, i) => [slug, list[i]]));
  }, []);

  /* The deck in the one canonical order, and the pool in whichever the buttons
     say — the same two functions the player's builder uses, so a deck built
     here is laid out the way a deck is laid out everywhere else. */
  const chosen = useMemo(() => deckOrder(Object.keys(deck)), [deck]);
  const shelf = useMemo(() => trunkOrder(searchCards(POOL, query), sort, filter), [query, sort, filter]);

  const add = (slug: string) => {
    setDeck((d) => (d[slug] >= MAX ? d : { ...d, [slug]: (d[slug] ?? 0) + 1 }));
    sfx.click();
  };
  const drop = (slug: string) => {
    setDeck((d) => {
      const n = (d[slug] ?? 0) - 1;
      const next = { ...d };
      if (n <= 0) delete next[slug];
      else next[slug] = n;
      return next;
    });
    sfx.click();
  };

  /**
   * The list, in the shape `data/decklists.json` wants.
   *
   * Names rather than slugs, because that file is the hand-written side — the
   * slugged mirror in `src/game/generated/` is derived from it, never typed.
   * In the deck's own order so the paste reads as a deck rather than as the
   * order things happened to be tapped in.
   */
  const asJson = useMemo(
    () =>
      '[\n' +
      chosen.map((s) => `  [${JSON.stringify(CARDS[s]?.name ?? s)}, ${deck[s]}]`).join(',\n') +
      '\n]',
    [chosen, deck]
  );

  /**
   * Copy, with a fallback, because `navigator.clipboard` is not there on an
   * insecure origin and this screen is opened on a phone over the local network
   * as often as it is on localhost.
   */
  const copy = async () => {
    sfx.click();
    let ok = false;
    try {
      await navigator.clipboard.writeText(asJson);
      ok = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = asJson;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    setCopied(ok ? 'Copied — paste it into the chat.' : 'Could not reach the clipboard. Select the text below.');
    window.setTimeout(() => setCopied(null), 4000);
  };

  /*
   * Padding that *adds* to the safe-area inset rather than being replaced by
   * it.
   *
   * `.safe-page` sets `padding-left` and `padding-right` outright, so a
   * Tailwind `p-3` beside it is overwritten and measures zero — the title sat
   * against the glass on a phone and nothing said why. The same `calc` the
   * world's corner menu uses.
   */
  return (
    <main
      className="safe-page mx-auto flex h-[100dvh] w-full max-w-5xl flex-col gap-2"
      style={{
        paddingTop: 'calc(var(--safe-top) + 12px)',
        paddingBottom: 'calc(var(--safe-bottom) + 12px)',
        paddingLeft: 'calc(var(--safe-left) + 12px)',
        paddingRight: 'calc(var(--safe-right) + 12px)',
      }}
    >
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl leading-none text-brassbright">Deck Lab</h1>
          <p className="mt-1 text-[10px] uppercase tracking-widest text-brass">
            For an NPC · up to {MAX} of a card
          </p>
        </div>
        <button className="btn shrink-0 rounded px-3 py-2 text-[11px]" onClick={onClose}>
          ✕ Close
        </button>
      </div>

      {/* The count, big. A deck bound to an NPC has to be twenty-five, and this
          screen does not enforce it — so it has to be impossible to miss. */}
      <div className="flex shrink-0 items-center gap-2">
        <p
          className={`font-display text-lg leading-none ${
            total === DECK_SIZE ? 'text-brassbright' : 'text-ptext'
          }`}
        >
          {total}
          <span className="text-ptextdim"> / {DECK_SIZE}</span>
        </p>
        <p className="min-w-0 flex-1 truncate text-[10px] text-ptextdim">
          {total === DECK_SIZE
            ? 'A full deck.'
            : total > DECK_SIZE
              ? `${total - DECK_SIZE} over — an NPC deck is exactly ${DECK_SIZE}.`
              : `${DECK_SIZE - total} to go.`}
        </p>
        <button
          className="btn btn-primary shrink-0 rounded px-3 py-2 text-[11px]"
          onClick={() => void copy()}
          disabled={total === 0}
        >
          Copy
        </button>
        <button
          className="btn shrink-0 rounded px-3 py-2 text-[11px]"
          onClick={() => {
            sfx.click();
            setDeck({});
          }}
          disabled={total === 0}
        >
          Clear
        </button>
      </div>

      {copied && (
        <p className="shrink-0 rounded border border-brassdim bg-black/40 px-3 py-2 text-[11px] text-parchment">
          {copied}
        </p>
      )}

      {inspect && (
        <div className="shrink-0">
          <CardDetail card={inspect} onClose={() => setInspect(null)} layout="row" />
        </div>
      )}

      {/* Search and the same sort and filter buttons the player's builder has. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the pool"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-[8rem] flex-1 rounded border border-stoneline bg-black/45 px-2 py-1.5 text-xs text-parchment outline-none focus:border-brass"
        />
        <div className="flex gap-1" role="group" aria-label="Show">
          {TRUNK_FILTERS.map((f) => (
            <button
              key={f.key}
              aria-pressed={filter === f.key}
              onClick={() => {
                sfx.click();
                setFilter(f.key);
              }}
              className={`btn rounded px-2 py-1.5 text-[10px] ${filter === f.key ? 'btn-primary' : ''}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label="Sort">
          {TRUNK_SORTS.map((s) => (
            <button
              key={s.key}
              aria-pressed={sort === s.key}
              onClick={() => {
                sfx.click();
                setSort(s.key);
              }}
              className={`btn rounded px-2 py-1.5 text-[10px] ${sort === s.key ? 'btn-primary' : ''}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {chosen.length > 0 && (
          <>
            <p className="sticky top-0 z-10 bg-ink/95 py-1 font-display text-[10px] uppercase tracking-widest text-brass">
              The deck · {total}
            </p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5 pb-3">
              {chosen.map((slug) => (
                <Tile
                  key={`d-${slug}`}
                  slug={slug}
                  count={deck[slug]}
                  card={instances.get(slug)!}
                  onAdd={add}
                  onDrop={drop}
                  onRead={(s) => setInspect(instances.get(s) ?? null)}
                />
              ))}
            </div>
          </>
        )}

        <p className="sticky top-0 z-10 bg-ink/95 py-1 font-display text-[10px] uppercase tracking-widest text-brass">
          Every card · {shelf.length}
          {query.trim() || filter !== 'all' ? ` of ${POOL.length}` : ''}
        </p>
        {shelf.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-ptextdim">Nothing matches that.</p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5 pb-3">
            {shelf.map((slug) => (
              <Tile
                key={`p-${slug}`}
                slug={slug}
                count={deck[slug] ?? 0}
                card={instances.get(slug)!}
                onAdd={add}
                onDrop={drop}
                onRead={(s) => setInspect(instances.get(s) ?? null)}
              />
            ))}
          </div>
        )}
      </div>

      {/* The text itself, always, and selectable — the clipboard is the happy
          path and this is the one that cannot fail. */}
      {total > 0 && (
        <details className="shrink-0">
          <summary className="cursor-pointer text-[10px] uppercase tracking-widest text-ptextdim">
            Show the list
          </summary>
          <pre className="mt-1 max-h-32 overflow-auto rounded border border-stoneline bg-black/45 p-2 text-[10px] leading-snug text-parchment">
            {asJson}
          </pre>
        </details>
      )}
    </main>
  );
}
