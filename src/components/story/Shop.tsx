'use client';

/**
 * The counter at the Kame Game Shop.
 *
 * Solomon has a short list and a long memory. You look, you buy, you leave; the
 * cards go into your Trunk and nothing ever comes back out to him.
 *
 * ## What it does not say
 *
 * There is no "unlocks at", no hint about what makes stock appear, and no
 * explanation of why he will not sell you a second copy of something. The game
 * shows the effect and keeps the rule to itself — the same discipline the pull
 * uses when it says "You already have this card!" and stops there. If a future
 * card arrives on his shelf, it arrives without a note explaining itself.
 *
 * ## Refusals are his, not the API's
 *
 * The route answers `owned` and `poor` as codes on purpose, and the wording
 * lives here, because the shopkeeper is a character and a status code is not.
 * He turns you down the way he would.
 */

import { useEffect, useMemo, useState } from 'react';
import { CARDS } from '@/game/cards';
import GameCard from '@/components/GameCard';
import CardDetail from '@/components/CardDetail';
import { previewInstances } from '@/components/deckPreview';
import type { CardInstance } from '@/game/types';
import type { StoryProfile } from '@/story/profile';
import type { ShopItem } from '@/story/shop';
import { sfx } from '@/lib/sfx';

interface Props {
  profile: StoryProfile;
  stock: ShopItem[];
  /** Buys one card. Resolves to what the counter should say, or null on success. */
  onBuy: (slug: string) => Promise<string | null>;
  onClose: () => void;
}

export default function Shop({ profile, stock, onBuy, onClose }: Props) {
  const [inspect, setInspect] = useState<CardInstance | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const instances = useMemo(() => {
    const list = previewInstances(stock.map((s) => [s.slug, 1] as [string, number]));
    return new Map(stock.map((s, i) => [s.slug, list[i]]));
  }, [stock]);

  /* Whatever he last said clears itself, so the counter is not still refusing a
     purchase you made two minutes ago. */
  useEffect(() => {
    if (!said) return;
    const t = setTimeout(() => setSaid(null), 6000);
    return () => clearTimeout(t);
  }, [said]);

  const money = profile.money ?? 0;

  return (
    <main className="safe-page fixed inset-0 z-50 grid place-items-center bg-black/85 p-4" data-shop>
      <div className="panel grain flex max-h-[92svh] w-full max-w-md flex-col rounded p-5">
        <div className="shrink-0 text-center">
          <h1 className="font-display text-xl text-brassbright">Kame Game Shop</h1>
          <p className="mt-1 text-[11px] text-ptextdim">
            <span data-money className="font-display text-sm text-parchment">${money.toLocaleString()}</span>
            {' '}in your pocket
          </p>
          <div className="brass-rule mx-auto my-3 w-32" />
        </div>

        {said && (
          <p
            data-shop-says
            className="mb-3 shrink-0 rounded border border-brassdim bg-black/40 px-3 py-2 text-[11px] italic leading-relaxed text-parchment"
          >
            &ldquo;{said}&rdquo;
          </p>
        )}

        {inspect && (
          <div className="mb-3 shrink-0">
            <CardDetail card={inspect} onClose={() => setInspect(null)} layout="row" />
          </div>
        )}

        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
          {stock.length === 0 ? (
            <p className="px-1 py-6 text-center text-[11px] text-ptextdim">
              The shelf is bare today.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {stock.map((item) => {
                const card = instances.get(item.slug);
                const owned = profile.collection.includes(item.slug);
                const affordable = money >= item.price;
                if (!card) return null;
                return (
                  <li
                    key={item.slug}
                    data-stock={item.slug}
                    className="flex items-center gap-3 rounded border border-stoneline bg-black/25 p-2"
                  >
                    <button
                      type="button"
                      data-read={item.slug}
                      aria-label={`Read ${CARDS[item.slug]?.name ?? item.slug}`}
                      onClick={() => {
                        sfx.click();
                        setInspect((cur) => (cur?.slug === item.slug ? null : card));
                      }}
                      className="w-[58px] shrink-0 rounded selectable"
                    >
                      <GameCard card={card} compact />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-[13px] text-parchment">
                        {CARDS[item.slug]?.name ?? item.slug}
                      </p>
                      <p data-price className="mt-0.5 font-display text-sm text-brassbright">
                        ${item.price.toLocaleString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-buy={item.slug}
                      disabled={busy !== null || owned || !affordable}
                      onClick={async () => {
                        setBusy(item.slug);
                        setSaid(null);
                        const line = await onBuy(item.slug);
                        setBusy(null);
                        if (line) {
                          sfx.error();
                          setSaid(line);
                        } else {
                          sfx.heal();
                          setSaid('There you are. Look after it.');
                        }
                      }}
                      className={`btn shrink-0 rounded px-3 py-2 text-[11px] ${
                        !owned && affordable ? 'btn-primary' : ''
                      }`}
                    >
                      {busy === item.slug ? '…' : owned ? 'Owned' : 'Buy'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <button
          data-shop-close
          className="btn mt-4 w-full shrink-0 rounded px-4 py-3 text-xs"
          onClick={() => {
            sfx.click();
            onClose();
          }}
        >
          Back
        </button>
      </div>
    </main>
  );
}
