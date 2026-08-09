'use client';

import GameCard from './GameCard';
import { CARDS } from '@/game/cards';
import type { CardInstance } from '@/game/types';

interface Props {
  card: CardInstance | null;
  atk?: number;
  def?: number;
  onClose?: () => void;
  /** 'row' is the compact horizontal form used on small screens. */
  layout?: 'column' | 'row';
  /* What the board is calling this card right now. Bickuribox reads as Toon
     Bickuribox while its controller's Toon World is open, and the printed name
     cannot know that — the caller holds the state, so the caller decides. */
  displayName?: string;
}

export default function CardDetail({ card, atk, def, onClose, layout = 'column', displayName }: Props) {
  if (layout === 'row') {
    if (!card) return null;
    const hidden = card.slug === 'facedown';
    const d = CARDS[card.slug];
    const isToken = !!card.isToken;
    const name = isToken ? (card.tokenName ?? 'Token') : hidden ? 'Face-down Card' : (displayName ?? d?.name);
    return (
      <div className="panel grain flex gap-2 rounded p-2">
        <div className="w-[54px] shrink-0">
          <GameCard card={card} atk={atk} def={def} faceDown={hidden} displayName={displayName} compact />
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-display text-[13px] leading-tight text-parchment">{name}</h3>
            {onClose && (
              <button onClick={onClose} className="btn shrink-0 rounded px-1.5 py-0.5 text-[9px]" aria-label="Close">
                ✕
              </button>
            )}
          </div>
          {!hidden && !isToken && d && (
            <>
              <p className="text-[9px] uppercase tracking-wide text-brass">
                {d.kind === 'monster' ? `Lv${d.level} · ${d.attribute} · ATK ${atk ?? d.atk} / DEF ${def ?? d.def}` : `${d.subKind ?? ''} ${d.kind}`}
              </p>
              <p className="mt-0.5 max-h-[54px] overflow-y-auto thin-scroll pr-1 text-[10px] leading-snug text-ptext/90">
                {d.text}
              </p>
            </>
          )}
          {hidden && <p className="mt-1 text-[10px] text-ptextdim">A face-down card. You cannot see it yet.</p>}
        </div>
      </div>
    );
  }

  if (!card) {
    return (
      <div className="panel grain relative flex h-full flex-col items-center justify-center rounded p-4 text-center">
        <p className="font-display text-sm tracking-widest text-ptextdim">INSPECT A CARD</p>
        <p className="mt-2 text-xs leading-relaxed text-ptextdim/70">
          Hover or tap any card on the field or in your hand to read its effect.
        </p>
      </div>
    );
  }

  const hidden = card.slug === 'facedown';
  const def0 = CARDS[card.slug];
  const isToken = !!card.isToken;
  const name = isToken ? (card.tokenName ?? 'Token') : hidden ? 'Face-down Card' : (displayName ?? def0?.name);

  return (
    <div className="panel grain relative flex h-full flex-col gap-3 overflow-hidden rounded p-3">
      {onClose && (
        <button
          onClick={onClose}
          className="btn absolute right-2 top-2 z-10 rounded px-2 py-1 text-[10px]"
          aria-label="Close card details"
        >
          ✕
        </button>
      )}
      <div className="mx-auto w-[46%] max-w-[150px] min-w-[92px]">
        <GameCard card={card} atk={atk} def={def} faceDown={hidden} displayName={displayName} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto thin-scroll pr-1">
        <h3 className="font-display text-base leading-tight text-parchment">{name}</h3>

        {!hidden && !isToken && def0 && (
          <>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-brass">
              {def0.kind === 'monster'
                ? `Level ${def0.level} · ${def0.attribute} · ${def0.type}`
                : `${def0.subKind ?? ''} ${def0.kind === 'trap' ? 'Trap' : 'Spell'}`.trim()}
            </p>
            {def0.kind === 'monster' && (
              <p className="mt-1 font-display text-sm text-parchment">
                ATK {atk ?? def0.atk} <span className="text-ptextdim">/</span> DEF {def ?? def0.def}
              </p>
            )}
            <div className="brass-rule my-2" />
            <p className="text-[12px] leading-relaxed text-ptext/90">{def0.text}</p>
            {def0.cry && <p className="mt-2 font-display text-[12px] italic text-brassbright">“{def0.cry}”</p>}
            {def0.fusionMaterials && (
              <p className="mt-2 text-[11px] text-ptextdim">
                Materials: {def0.fusionMaterials.map((m) => CARDS[m]?.name ?? m).join(' + ')}
              </p>
            )}
          </>
        )}

        {isToken && (
          <p className="mt-2 text-[12px] leading-relaxed text-ptext/90">
            A token summoned by a card effect. It cannot be tributed for a Normal Summon and vanishes when it leaves
            the field.
          </p>
        )}
        {hidden && (
          <p className="mt-2 text-[12px] leading-relaxed text-ptextdim">
            Your opponent&apos;s face-down card. You will not know what it is until it is flipped or activated.
          </p>
        )}

        {!hidden && (card.atkMod !== 0 || card.turnAtkMod !== 0 || card.equips.length > 0) && (
          <p className="mt-2 text-[11px] text-brass">
            {card.equips.length > 0 && `Equipped: ${card.equips.map((e) => CARDS[e]?.name ?? e).join(', ')}. `}
            {card.atkMod + card.turnAtkMod !== 0 &&
              `Modified ATK ${card.atkMod + card.turnAtkMod > 0 ? '+' : ''}${card.atkMod + card.turnAtkMod}.`}
          </p>
        )}
      </div>
    </div>
  );
}
