'use client';

import { useEffect, useMemo, useState } from 'react';
import GameCard from './GameCard';
import { CARDS, DUELISTS, artUrl } from '@/game/cards';
import { primeAudio, sfx } from '@/lib/sfx';
import { other } from '@/game/engine';
import type { CardInstance } from '@/game/types';
import type { RoomView } from '@/server/rooms';

interface Props {
  view: RoomView;
  chooseDuelist: (id: string) => void;
  setPlayerName: (name: string) => void;
  shareUrl: string;
  configureAi?: (opts: { duelistId?: string }) => void;
}


/** Builds throwaway instances so the deck preview can reuse the card renderer. */
function previewInstances(slugs: [string, number][]): CardInstance[] {
  const out: CardInstance[] = [];
  slugs.forEach(([slug, count], i) => {
    for (let n = 0; n < count; n++) {
      out.push({
        uid: `${slug}_${i}_${n}`,
        slug,
        owner: 'p1',
        face: 'up',
        position: 'atk',
        atkMod: 0,
        defMod: 0,
        turnAtkMod: 0,
        turnDefMod: 0,
        counters: 0,
        equips: [],
        flags: {},
        turnFlags: {},
        summonedOnTurn: -1,
        attacksUsed: 0,
        effectUsedOnTurn: -1,
        absorbed: [],
      });
    }
  });
  return out;
}

export default function Lobby({ view, chooseDuelist, setPlayerName, shareUrl, configureAi }: Props) {
  const me = view.you;
  const foe = other(me);
  const mySeat = view.seats[me];
  const foeSeat = view.seats[foe];
  const isAi = !!foeSeat?.ai;
  const [hovered, setHovered] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(mySeat?.name ?? '');
  const [copied, setCopied] = useState(false);
  const [deckOpen, setDeckOpen] = useState<string | null>(null);

  useEffect(() => {
    primeAudio();
  }, []);
  useEffect(() => {
    if (mySeat?.name && !nameDraft) setNameDraft(mySeat.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mySeat?.name]);

  const detail = useMemo(() => DUELISTS.find((d) => d.id === (hovered ?? mySeat?.duelistId)) ?? DUELISTS[0], [hovered, mySeat?.duelistId]);
  const deck = useMemo(() => (deckOpen ? DUELISTS.find((d) => d.id === deckOpen) : null), [deckOpen]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      sfx.click();
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <main className="safe-page mx-auto flex min-h-[100dvh] w-full max-w-6xl flex-col gap-4 p-4">
      {/* header */}
      <header className="panel grain rounded p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl tracking-wide text-brassbright sm:text-3xl">Shadow Duel</h1>
            <p className="text-xs text-ptextdim">Duelist Kingdom · choose your duelist</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-display text-[11px] uppercase tracking-widest text-ptextdim">Room</span>
            <span className="rounded border border-brass bg-black/40 px-3 py-1 font-display text-xl tracking-[0.3em] text-brassbright">
              {view.code}
            </span>
          </div>
        </div>

        <div className="brass-rule my-3" />

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-display text-[10px] uppercase tracking-widest text-ptextdim">Your name</span>
            <input
              value={nameDraft}
              maxLength={18}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => nameDraft.trim() && setPlayerName(nameDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
              className="w-44 rounded border border-stoneline bg-black/45 px-3 py-1.5 text-sm text-parchment outline-none focus:border-brass"
              placeholder="Your name"
            />
          </label>

          <div className="flex-1" />

          {!isAi && (
            <button className="btn rounded px-3 py-2 text-[11px]" onClick={copy}>
              {copied ? '✓ Link copied' : 'Copy invite link'}
            </button>
          )}
        </div>

        {!foeSeat && (
          <p className="mt-3 rounded border border-brassdim/60 bg-black/30 px-3 py-2 text-xs text-brass">
            Send the invite link (or the room code <strong className="tracking-widest">{view.code}</strong>) to your
            opponent. The duel begins the moment you have both chosen.
          </p>
        )}

        {isAi && (
          <div className="mt-3 rounded border border-brassdim/60 bg-black/30 p-3">
            <p className="font-display text-[10px] uppercase tracking-widest text-brass">Your opponent</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ptext/85">
              The computer plays at full strength — widest search, three turns of lookahead, and it counts the race to
              zero every turn. There is no easy setting.
            </p>
            <p className="mt-2 text-[10px] leading-relaxed text-ptextdim">
              It is holding{' '}
              <span className="text-parchment">{DUELISTS.find((d) => d.id === foeSeat?.duelistId)?.name ?? 'a deck'}</span>
              &rsquo;s deck — pick a different one for it from the panel on the right, then choose your own duelist to
              begin.
            </p>
          </div>
        )}
      </header>

      {/* seats */}
      <div className="grid grid-cols-2 gap-3">
        {([me, foe] as const).map((pid) => {
          const seat = view.seats[pid];
          const d = seat?.duelistId ? DUELISTS.find((x) => x.id === seat.duelistId) : null;
          return (
            <div
              key={pid}
              className={`panel grain flex items-center gap-3 rounded p-3 ${d ? 'ring-1 ring-brass' : ''}`}
            >
              <div
                className="h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 bg-black/50"
                style={{ borderColor: d?.accent ?? '#3a4351' }}
              >
                {d && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={artUrl(d.emblem)} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate font-display text-sm text-parchment">
                  {seat?.name ?? 'Waiting for a duelist…'}
                  {pid === me && <span className="ml-1 text-[10px] text-brass">(you)</span>}
                  {seat?.ai && (
                    <span className="ml-1 rounded bg-brass/20 px-1 py-0.5 text-[9px] uppercase tracking-wider text-brass">
                      CPU
                    </span>
                  )}
                </p>
                <p className="truncate text-[11px] text-ptextdim">
                  {d ? `${d.name} — ${d.epithet}` : seat ? 'Choosing…' : 'Empty seat'}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* duelist grid + detail */}
      <div className="grid flex-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {DUELISTS.map((d) => {
            const takenByFoe = foeSeat?.duelistId === d.id;
            const isMine = mySeat?.duelistId === d.id;
            return (
              <button
                key={d.id}
                onMouseEnter={() => setHovered(d.id)}
                onFocus={() => setHovered(d.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  sfx.click();
                  chooseDuelist(d.id);
                }}
                /* flex-col matters: a <button> centres its content by default,
                   which would leave dead bands above and below the artwork. */
                className={`panel grain group relative flex flex-col overflow-hidden rounded p-0 text-left transition-transform hover:-translate-y-0.5 ${
                  isMine ? 'ring-2 ring-brass' : takenByFoe ? 'opacity-70 ring-1 ring-oxblood' : ''
                }`}
              >
                <div className="relative min-h-[92px] w-full flex-1 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={artUrl(d.emblem)}
                    alt={d.name}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/25 to-transparent" />
                  <div
                    className="absolute inset-x-0 bottom-0 h-0.5"
                    style={{ background: `linear-gradient(90deg, transparent, ${d.accent}, transparent)` }}
                  />
                </div>
                <div className="p-2">
                  <p className="truncate font-display text-[13px] leading-tight text-parchment">{d.name}</p>
                  <p className="truncate text-[10px] text-ptextdim">{d.epithet}</p>
                </div>
                {isMine && (
                  <span className="absolute right-1 top-1 rounded bg-brass px-1.5 py-0.5 text-[9px] font-bold text-ink">
                    YOURS
                  </span>
                )}
                {takenByFoe && (
                  <span className="absolute right-1 top-1 rounded bg-oxblood px-1.5 py-0.5 text-[9px] font-bold text-parchment">
                    THEIRS
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <aside className="panel grain flex flex-col rounded p-4">
          <div
            className="mb-3 h-24 w-full overflow-hidden rounded border"
            style={{ borderColor: detail.accent }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={artUrl(detail.emblem)} alt="" className="h-full w-full object-cover" />
          </div>
          <h2 className="font-display text-lg leading-tight text-parchment">{detail.name}</h2>
          <p className="text-[11px] uppercase tracking-wider" style={{ color: detail.accent2 }}>
            {detail.epithet}
          </p>
          <p className="mt-2 font-display text-xs italic text-brassbright">“{detail.quote}”</p>
          <div className="brass-rule my-3" />
          <p className="text-xs leading-relaxed text-ptext/85">{detail.strategy}</p>
          <p className="mt-3 text-[11px] text-ptextdim">
            Signature card: <span className="text-parchment">{CARDS[detail.emblem]?.name}</span>
          </p>
          <div className="flex-1" />
          <button className="btn mt-3 rounded px-3 py-2 text-[11px]" onClick={() => setDeckOpen(detail.id)}>
            View 25-card deck
          </button>
          {isAi && (
            <button
              className="btn mt-2 rounded px-3 py-2 text-[11px]"
              onClick={() => {
                sfx.click();
                configureAi?.({ duelistId: detail.id });
              }}
            >
              Face {detail.name.split(' ')[0]} instead
            </button>
          )}
          <button
            className="btn btn-primary mt-2 rounded px-3 py-2 text-xs"
            onClick={() => {
              sfx.click();
              chooseDuelist(detail.id);
            }}
          >
            Duel as {detail.name.split(' ')[0]}
          </button>
        </aside>
      </div>

      {/* deck preview */}
      {deck && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setDeckOpen(null)}>
          <div
            className="panel grain max-h-[85vh] w-full max-w-4xl overflow-y-auto thin-scroll rounded p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg text-parchment">
                {deck.name} — 25 cards
                {deck.extra.length > 0 && <span className="ml-2 text-xs text-ptextdim">+ {deck.extra.length} Extra Deck</span>}
              </h3>
              <button className="btn rounded px-2 py-1 text-[10px]" onClick={() => setDeckOpen(null)}>
                ✕
              </button>
            </div>
            <div className="brass-rule my-3" />
            <div className="flex flex-wrap gap-2">
              {previewInstances(deck.deck).map((c) => (
                <div key={c.uid} className="w-[84px]" title={CARDS[c.slug]?.text}>
                  <GameCard card={c} />
                  <p className="mt-0.5 truncate text-center text-[9px] text-ptextdim">{CARDS[c.slug]?.name}</p>
                </div>
              ))}
            </div>
            {deck.extra.length > 0 && (
              <>
                <div className="brass-rule my-3" />
                <p className="mb-2 font-display text-xs uppercase tracking-widest text-brass">Extra Deck</p>
                <div className="flex flex-wrap gap-2">
                  {previewInstances(deck.extra.map((s) => [s, 1] as [string, number])).map((c) => (
                    <div key={c.uid} className="w-[84px]" title={CARDS[c.slug]?.text}>
                      <GameCard card={c} />
                      <p className="mt-0.5 truncate text-center text-[9px] text-ptextdim">{CARDS[c.slug]?.name}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
