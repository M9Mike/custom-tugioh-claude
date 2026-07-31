'use client';

import { CARDS, artUrl } from '@/game/cards';
import type { CardInstance } from '@/game/types';

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
}: Props) {
  const hidden = faceDown || card.slug === 'facedown';
  const cardDef = CARDS[card.slug];
  const isToken = !!card.isToken;
  const name = isToken ? (card.tokenName ?? 'Token') : (cardDef?.name ?? 'Card');
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
            {card.counters > 0 && (
              <div className="card-badge absolute right-[4%] top-[4%] rounded-full bg-black/75 px-[6%] py-[2%] font-bold text-brassbright ring-1 ring-brass">
                {card.counters}
              </div>
            )}
            {card.equips.length > 0 && (
              <div className="card-badge absolute left-[4%] top-[4%] rounded bg-black/70 px-[5%] text-brassbright">
                ⚔{card.equips.length}
              </div>
            )}
            {card.absorbed.length > 0 && (
              <div className="card-badge absolute left-[4%] bottom-[4%] rounded bg-black/70 px-[5%] text-[#d5b7f0]">
                👁{card.absorbed.length}
              </div>
            )}
            {card.flags.negated && (
              <div className="absolute inset-0 grid place-items-center bg-black/55">
                <span className="card-badge font-display font-bold text-[#e0b4b4]">NEGATED</span>
              </div>
            )}
          </div>

          {!compact && isMonster && (
            <div className="card-stats">
              <span>{atk ?? (isToken ? card.tokenAtk : cardDef?.atk) ?? 0}</span>
              <span className="card-level opacity-70">
                {isToken ? '★' : '★'.repeat(Math.min(cardDef?.level ?? 0, 4))}
                {!isToken && (cardDef?.level ?? 0) > 4 ? `+${(cardDef?.level ?? 0) - 4}` : ''}
              </span>
              <span>{def ?? (isToken ? card.tokenDef : cardDef?.def) ?? 0}</span>
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
