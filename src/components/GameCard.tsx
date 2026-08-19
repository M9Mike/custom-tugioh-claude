'use client';

import { CARDS, artUrl } from '@/game/cards';
import { INFINITE_ATK, type CardInstance } from '@/game/types';

export function frameClass(slug: string, isToken?: boolean): string {
  if (isToken) return 'frame-token';
  if (slug === 'facedown') return 'frame-hidden';
  const def = CARDS[slug];
  if (!def) return 'frame-hidden';
  if (def.kind === 'spell') return 'frame-spell';
  if (def.kind === 'trap') return 'frame-trap';
  if (def.isFusion) return 'frame-fusion';
  if (def.isRitual) return 'frame-ritual';
  if (def.isEffect || def.effects.length > 0) return 'frame-effect';
  return 'frame-normal';
}

const ATTRIBUTE_GLYPH: Record<string, string> = {
  DARK: '🌑',
  LIGHT: '☀',
  EARTH: '⛰',
  WATER: '💧',
  FIRE: '🔥',
  WIND: '🌪',
  DIVINE: '✦',
};

interface Props {
  card: CardInstance;
  /** Computed on the server-authoritative state, so buffs/auras show correctly. */
  atk?: number;
  def?: number;
  faceDown?: boolean;
  defending?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  onPointerEnter?: () => void;
  title?: string;
  /** Hides the name/stat chrome, for very small thumbnails. */
  compact?: boolean;
  /**
   * What the board is calling this card right now.
   *
   * A drawing under Toon World is a Toon and reads as one; the printed name
   * cannot know that, and the caller holds the state. Without it the banners
   * said "Toon Dark Rabbit" while the card in front of you said "Dark Rabbit".
   */
  displayName?: string;
}

/**
 * Red when a stat has been lowered from its base value, green when raised.
 *
 * The base is the one the engine uses, override included — comparing against
 * the printed number would leave every card we restatted permanently tinted for
 * no reason a player could see.
 */
export function statTint(shown: number | undefined, base: number | null | undefined): React.CSSProperties | undefined {
  if (shown == null || base == null || shown === base) return undefined;
  return shown < base
    ? { color: '#ff8f8f', textShadow: '0 0 6px rgba(200,50,60,0.55)' }
    : { color: '#8ef0a8', textShadow: '0 0 6px rgba(60,200,110,0.55)' };
}

export default function GameCard({
  card,
  atk,
  def,
  faceDown,
  defending,
  className = '',
  style,
  onClick,
  onPointerEnter,
  title,
  compact,
  displayName,
}: Props) {
  const hidden = faceDown || card.slug === 'facedown';
  const cardDef = CARDS[card.slug];
  const isToken = !!card.isToken;
  const name = isToken ? (card.tokenName ?? 'Token') : (displayName ?? cardDef?.name ?? 'Card');
  const isMonster = isToken || cardDef?.kind === 'monster';

  return (
    <div
      className={`card-shell ${hidden ? 'frame-hidden' : frameClass(card.slug, isToken)} ${
        defending ? 'rotate-90' : ''
      } ${className}`}
      style={style}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      title={title ?? (hidden ? 'Face-down card' : name)}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      {hidden ? (
        <div className="card-back" aria-label="Face-down card" />
      ) : (
        <div className="card-face">
          {!compact && (
            <div className="card-name flex items-center justify-between gap-[3%]">
              <span className="truncate">{name}</span>
              {isMonster && !isToken && cardDef?.attribute && (
                <span className="card-badge shrink-0 opacity-80">{ATTRIBUTE_GLYPH[cardDef.attribute] ?? '✦'}</span>
              )}
            </div>
          )}

          <div className="card-art">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artUrl(card.slug)}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              /* If a piece of artwork failed to download at build time, fall back
                 to the frame colour rather than showing a broken image. */
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
            {/* Kept clear of the name and stats bands, which now overlay the
                top and bottom sixth of the artwork. */}
            {card.counters > 0 && (
              <div className="card-badge absolute right-[5%] top-[17%] z-10 rounded-full bg-black/75 px-[6%] py-[2%] font-bold text-brassbright ring-1 ring-brass">
                {card.counters}
              </div>
            )}
            {card.equips.length > 0 && (
              <div className="card-badge absolute left-[5%] top-[17%] z-10 rounded bg-black/70 px-[5%] text-brassbright">
                ⚔{card.equips.length}
              </div>
            )}
            {card.absorbed.length > 0 && (
              <div className="card-badge absolute bottom-[17%] left-[5%] z-10 rounded bg-black/70 px-[5%] text-[#d5b7f0]">
                👁{card.absorbed.length}
              </div>
            )}
            {card.flags.negated && (
              <div className="absolute inset-0 z-10 grid place-items-center bg-black/55">
                <span className="card-badge font-display font-bold text-[#e0b4b4]">NEGATED</span>
              </div>
            )}
          </div>

          {!compact && isMonster && (
            <div className="card-stats">
              {/* Tinted when it is not the printed number. A die roll or a Trap
                  can hollow a monster out, and with the figure rendered exactly
                  like an untouched one the only way to notice was to remember
                  what it started at — which is how a 0 ATK monster gets sent
                  into an attack. */}
              {/* A God whose power has stopped being a number says so. Seven
                  digits in a stat band is unreadable and, worse, reads as a
                  bug — the Fist of Fate is meant to look like the end of the
                  argument, not like an overflow. */}
              <span style={statTint(atk, isToken ? card.tokenAtk : (cardDef?.atkOverride ?? cardDef?.atk))}>
                {atk === INFINITE_ATK ? '∞' : (atk ?? (isToken ? card.tokenAtk : cardDef?.atk) ?? 0)}
              </span>
              <span className="card-level opacity-70">
                {isToken ? '★' : '★'.repeat(Math.min(cardDef?.level ?? 0, 4))}
                {!isToken && (cardDef?.level ?? 0) > 4 ? `+${(cardDef?.level ?? 0) - 4}` : ''}
              </span>
              <span style={statTint(def, isToken ? card.tokenDef : (cardDef?.defOverride ?? cardDef?.def))}>
                {def ?? (isToken ? card.tokenDef : cardDef?.def) ?? 0}
              </span>
            </div>
          )}
          {!compact && !isMonster && (
            <div className="card-stats justify-center">
              <span className="uppercase tracking-wide opacity-90">
                {cardDef?.subKind ?? (cardDef?.kind === 'trap' ? 'Trap' : 'Spell')}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
