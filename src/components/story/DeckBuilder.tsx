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

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CARDS } from '@/game/cards';
import GameCard from '@/components/GameCard';
import CardDetail from '@/components/CardDetail';
import { previewInstances } from '@/components/deckPreview';
import type { CardInstance } from '@/game/types';
import { DECK_SIZE, validateDeck } from '@/story/roster';
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

/**
 * One card in the grid.
 *
 * **Declared here, at module scope, and that is the whole point.** It used to be
 * a function defined inside `DeckBuilder`, which makes it a *different component
 * type* on every render — so React threw away every card and built them all
 * again whenever anything changed, and each new `<img>` re-fetched and re-decoded
 * its artwork. That was the flash: not the card moving, but a hundred cards
 * being destroyed and recreated because one of them was tapped.
 *
 * At module scope the type is stable, so a move is a reorder of existing nodes
 * and the artwork never reloads. `React.memo` then keeps a card from re-rendering
 * at all unless its own props changed, which is what lets the FLIP transforms
 * survive the frame they are set in.
 */
const Card = memo(function Card({
  slug,
  held,
  card,
  onPick,
  onRead,
}: {
  slug: string;
  held: boolean;
  card: CardInstance;
  onPick: (slug: string) => void;
  onRead: (slug: string) => void;
}) {
  return (
    <div
      data-card={slug}
      data-where={held ? 'deck' : 'trunk'}
      className="relative will-change-transform"
    >
      <button
        type="button"
        onClick={() => onPick(slug)}
        aria-pressed={held}
        aria-label={`${held ? 'Move to Trunk' : 'Add to Deck'}: ${CARDS[slug]?.name ?? slug}`}
        data-move={slug}
        className={`w-full rounded text-left ${held ? 'selectable' : 'opacity-80'}`}
      >
        <GameCard card={card} compact />
        <p className="mt-0.5 truncate text-center text-[8px] leading-tight text-ptextdim">
          {CARDS[slug]?.name ?? slug}
        </p>
      </button>
      {/*
        * Reading a card is its own button.
        *
        * Tapping the card used to do both — move it *and* open it in the strip —
        * which meant there was no way to find out what a card did without also
        * putting it somewhere. You would tap to read, and the card left the list
        * you were reading it in.
        *
        * So the card moves and this reads. It sits over the corner rather than
        * beside the card because the grid is eight across on a laptop and there
        * is no room for a second control in the flow; `pointer-events` are only
        * on the button itself, so the rest of the card is still one big target.
        */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRead(slug);
        }}
        data-read={slug}
        aria-label={`Read ${CARDS[slug]?.name ?? slug}`}
        className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full border border-brassdim bg-ink/85 text-[10px] font-bold leading-none text-brassbright hover:bg-ink"
      >
        i
      </button>
    </div>
  );
});

export default function DeckBuilder({ pool, initial, first, onConfirm, onCancel }: Props) {
  const [chosen, setChosen] = useState<string[]>(() => (initial ?? []).filter((s) => pool.includes(s)));
  const [inspect, setInspect] = useState<CardInstance | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** How the Trunk is ordered. The Deck's order is fixed — see `deckSort.ts`. */
  const [sort, setSort] = useState<TrunkSort>('curve');
  const [filter, setFilter] = useState<TrunkFilter>('all');
  const [query, setQuery] = useState('');

  const inDeck = useMemo(() => new Set(chosen), [chosen]);
  const complete = chosen.length === DECK_SIZE;

  /**
   * The Deck, in its one canonical order.
   *
   * Sorted for display only — `chosen` keeps the order things were added in, and
   * that is what gets saved. Nothing downstream cares about a deck's order, and
   * re-sorting the stored list would make every tap look like it rearranged the
   * whole deck in the save as well as on screen.
   */
  const deckShown = useMemo(() => deckOrder(chosen), [chosen]);

  /** What is left in the Trunk: owned, not sleeved, matching the search, sorted. */
  const trunk = useMemo(
    () => trunkOrder(searchCards(pool.filter((s) => !inDeck.has(s)), query), sort, filter),
    [pool, inDeck, query, sort, filter]
  );
  /** How many are hidden by the search, so the count can be honest about it. */
  const trunkTotal = useMemo(() => pool.filter((s) => !inDeck.has(s)).length, [pool, inDeck]);

  /** Everything the grid draws, in one list — see the note at the grid. */
  type Row =
    | { kind: 'card'; key: string; slug: string; held: boolean }
    | { kind: 'heading'; key: string; label: string; tone: 'deck' | 'trunk' }
    | { kind: 'note'; key: string; label: string };
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [
      { kind: 'heading', key: 'h-deck', label: `Deck · ${chosen.length}/${DECK_SIZE}`, tone: 'deck' },
    ];
    if (chosen.length === 0) {
      out.push({ kind: 'note', key: 'n-deck', label: 'Nothing sleeved yet. Tap cards in the Trunk below.' });
    }
    for (const slug of deckShown) out.push({ kind: 'card', key: slug, slug, held: true });
    out.push({
      kind: 'heading',
      key: 'h-trunk',
      label:
        query.trim() || filter !== 'all'
          ? `Trunk · ${trunk.length} of ${trunkTotal}`
          : `Trunk · ${trunk.length}`,
      tone: 'trunk',
    });
    if (trunk.length === 0) {
      out.push({
        kind: 'note',
        key: 'n-trunk',
        label: query.trim()
          ? `Nothing in the Trunk matches “${query.trim()}”.`
          : filter !== 'all'
            ? `No ${filter}s in the Trunk.`
            : 'Every card you own is in your deck.',
      });
    }
    for (const slug of trunk) out.push({ kind: 'card', key: slug, slug, held: false });
    return out;
  }, [chosen, deckShown, trunk, trunkTotal, query, filter]);

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

  /* ------------------------------------------------------------------ */
  /* Moving a card looks like moving a card                              */
  /* ------------------------------------------------------------------ */

  const gridRef = useRef<HTMLDivElement>(null);
  /** Where every card was before this change, so the move can be played backwards. */
  const wasAt = useRef(new Map<string, DOMRect>());
  /** The card the player just tapped, which gets the lift the others do not. */
  const justMoved = useRef<string | null>(null);
  /**
   * Whether the inspector was open when the photograph was taken.
   *
   * The detail strip appears above the grid on the first tap and pushes every
   * card down by its height. That is a real move and FLIP would dutifully animate
   * it — a hundred cards sliding at once because you looked at one. It is not a
   * card moving between lists, so the first tap is left alone.
   */
  const panelWasOpen = useRef(false);

  /** Photograph the grid, called before the state that rearranges it. */
  const rememberPositions = () => {
    const grid = gridRef.current;
    if (!grid) return;
    const map = new Map<string, DOMRect>();
    for (const el of grid.querySelectorAll<HTMLElement>('[data-card]')) {
      const slug = el.dataset.card;
      if (slug) map.set(slug, el.getBoundingClientRect());
    }
    wasAt.current = map;
  };

  /**
   * FLIP: First, Last, Invert, Play.
   *
   * Every card that has moved since the last render is put *back* where it was
   * with a transform, and then released — so the browser animates it from its old
   * position to its new one in one go, on the compositor, without React knowing
   * anything about it. This is the standard trick and it is the only one that
   * survives a reflowing grid: the cards after the gap all shuffle up by a slot
   * too, and they should be seen to.
   *
   * `useLayoutEffect`, not `useEffect` — the inverting transform has to be
   * applied in the same frame as the reorder, or the card is briefly drawn at its
   * destination and the animation starts from the wrong place, which looks like
   * the jump it is meant to hide.
   */
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const before = wasAt.current;
    if (!grid || before.size === 0) return;

    const moved = justMoved.current;
    justMoved.current = null;

    /* The strip opening is a layout change, not a move. Skip that one frame. */
    const panelOpenNow = inspect !== null;
    const panelJustOpened = panelOpenNow && !panelWasOpen.current;
    panelWasOpen.current = panelOpenNow;
    if (panelJustOpened) {
      wasAt.current = new Map();
      return;
    }

    for (const el of grid.querySelectorAll<HTMLElement>('[data-card]')) {
      const slug = el.dataset.card;
      if (!slug) continue;
      const from = before.get(slug);
      if (!from) continue;
      const to = el.getBoundingClientRect();
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

      const lifted = slug === moved;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)${lifted ? ' scale(1.08)' : ''}`;
      el.style.zIndex = lifted ? '20' : '';
      /* Read once to commit the inverted position before releasing it. */
      void el.offsetWidth;
      el.style.transition = lifted
        ? 'transform 320ms cubic-bezier(0.22, 1, 0.36, 1)'
        : 'transform 260ms cubic-bezier(0.4, 0, 0.2, 1)';
      el.style.transform = '';
      const clear = () => {
        el.style.transition = '';
        el.style.zIndex = '';
        el.removeEventListener('transitionend', clear);
      };
      el.addEventListener('transitionend', clear);
    }
    wasAt.current = new Map();
  }, [chosen, inspect]);

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
  const toggle = useCallback((slug: string) => {
    setError(null);
    /* Photographed before the state changes, so the effect below has a "before"
       to animate from. */
    rememberPositions();
    justMoved.current = slug;
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
    /* `chosen` and `inDeck` are read here, so the identity changes when the deck
       does — which is fine and is not the render-per-keystroke case `memo` is
       guarding against. */
  }, [chosen, inDeck]);

  /** Open a card in the strip above, and move nothing. */
  const read = useCallback(
    (slug: string) => {
      sfx.click();
      setInspect((cur) => (cur?.slug === slug ? null : instances.get(slug) ?? null));
    },
    [instances]
  );

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

      {/*
        * Sorting and searching, for the Trunk only.
        *
        * The Deck deliberately has no controls: it is one canonical order so that
        * a deck looks the same every time it is opened. The Trunk is the pile you
        * rummage in, and it grows every time you win, so it gets both.
        */}
      <div className="mb-1.5 flex shrink-0 gap-1" role="group" aria-label="Show in the Trunk">
        {TRUNK_FILTERS.map((f2) => (
          <button
            key={f2.key}
            type="button"
            data-filter={f2.key}
            aria-pressed={filter === f2.key}
            onClick={() => {
              sfx.click();
              rememberPositions();
              setFilter(f2.key);
            }}
            className={`btn flex-1 rounded px-2 py-1.5 text-[10px] ${filter === f2.key ? 'btn-primary' : ''}`}
          >
            {f2.label}
          </button>
        ))}
      </div>

      <div className="mb-2 flex shrink-0 items-center gap-1.5">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the Trunk"
          aria-label="Search the Trunk"
          data-trunk-search
          className="min-w-0 flex-1 rounded border border-stoneline bg-black/40 px-2 py-1.5 text-[11px] text-parchment placeholder:text-ptextdim/70"
        />
        <div className="flex shrink-0 gap-1" role="group" aria-label="Sort the Trunk">
          {TRUNK_SORTS.map((s2) => (
            <button
              key={s2.key}
              type="button"
              data-sort={s2.key}
              aria-pressed={sort === s2.key}
              onClick={() => {
                sfx.click();
                rememberPositions();
                setSort(s2.key);
              }}
              className={`btn rounded px-2 py-1.5 text-[10px] ${sort === s2.key ? 'btn-primary' : ''}`}
            >
              {s2.label}
            </button>
          ))}
        </div>
      </div>

      {inspect && (
        <div className="mb-2 shrink-0">
          <CardDetail card={inspect} onClose={() => setInspect(null)} layout="row" />
        </div>
      )}

      {/*
        * One grid, not two.
        *
        * The Deck and the Trunk used to be separate `<section>`s with a grid
        * each, which is the obvious way to lay out two lists and the reason a
        * card *flashed* every time it moved: React cannot move a DOM node
        * between two parents, so it destroyed the card in one grid and built a
        * new one in the other, and the new one re-fetched and re-decoded its
        * artwork. The card you tapped visibly blinked out and back.
        *
        * Here every card lives in the same container for its whole life, keyed by
        * its own slug, with the two headings as full-width grid items between
        * them. Moving a card is now a reorder — React keeps the same element,
        * the same `<img>`, and nothing reloads. That alone kills the flash; the
        * animation below is what turns it into a move you can follow.
        */}
      <div ref={gridRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto pb-2">
        {/*
          * One flat children array, headings included.
          *
          * Splitting it as `{heading}{chosen.map()}{heading}{trunk.map()}` looks
          * identical and is not: React matches keys *within a single array*, so
          * `chosen.map()` and `trunk.map()` are two separate reconciliation
          * scopes and a card moving between them is still an unmount and a
          * remount — the exact thing this was all meant to stop. Flattened, every
          * child sits in one array, a move is a reorder, and the element (and its
          * decoded artwork) survives.
          */}
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8">
          {rows.map((row) =>
            row.kind === 'card' ? (
              <Card
                key={row.key}
                slug={row.slug}
                held={row.held}
                card={instances.get(row.slug)!}
                onPick={toggle}
                onRead={read}
              />
            ) : row.kind === 'heading' ? (
              <h2
                key={row.key}
                className={`col-span-full sticky top-0 z-10 -mx-1 bg-ink/95 px-1 py-1 font-display text-[11px] uppercase tracking-wider ${
                  row.tone === 'deck' ? 'text-brassbright' : 'mt-3 text-ptextdim'
                }`}
              >
                {row.label}
              </h2>
            ) : (
              <p key={row.key} className="col-span-full px-1 py-3 text-[11px] text-ptextdim">
                {row.label}
              </p>
            )
          )}
        </div>
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
