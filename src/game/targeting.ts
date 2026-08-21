/**
 * What a card may be pointed at.
 *
 * These three rules used to live in `engine.ts` while everything that *asked*
 * them lived in `ui.ts`, which imported the engine. That was fine for as long
 * as only the interface needed to know what a card could reach — and it stopped
 * being fine the day the engine had to raise the question itself, for an effect
 * resolving on a turn its controller is not taking. Pointing the engine at
 * `ui.ts` would have closed a cycle; moving the shared rules down here opens it
 * flat: targeting knows about cards, the engine and the interface both know
 * about targeting, and neither has to re-derive the other's answer.
 *
 * `engine.ts` re-exports `matchesFilter` and `revivable` so the dozens of
 * callers that have always imported them from there still can.
 */
import { CARDS, isToon } from './cards';
import type { CardFilter, CardInstance, DuelState, PlayerId } from './types';

/**
 * Ops that would leave a monster exactly as they found it.
 *
 * Having a target is not the same as having something to do with it: Stop
 * Defense names a monster that is standing in Attack Position already, kneels
 * nobody, and is gone. Both the gate that decides whether the card may be
 * played and the modal that lays out the choices ask this — the second time
 * because the gate alone was not enough. With a kneeling monster beside a
 * standing one the card was legal, and the picker still offered the one that
 * was already attacking, so the AI aimed there and spent it for nothing.
 *
 * A face-down monster counts as neither posture: dragging it up is a flip, and
 * a flip is very much something happening.
 */
const POSTURE: Record<string, (c: CardInstance) => boolean> = {
  forceAttackPosition: (c) => c.position !== 'atk' || c.face === 'down',
  forceDefense: (c) => c.position !== 'def' || c.face === 'down',
  flipFaceUp: (c) => c.face === 'down',
};

/** Would this op actually change that card, or is it already that way? */
export function changesAnything(opName: string | undefined, c: CardInstance): boolean {
  const rule = opName ? POSTURE[opName] : undefined;
  return rule ? rule(c) : true;
}

export function matchesFilter(c: CardInstance, f?: CardFilter): boolean {
  if (!f) return true;
  if (c.isToken) {
    // Tokens only satisfy the loosest filters.
    if (f.type || f.attribute || f.slugs || f.nameIncludes || f.minLevel || f.hasFlipEffect) return false;
    // A Token has no printed type, so it is never the excluded one.
    if (f.kind && f.kind !== 'monster') return false;
    if (f.position && c.position !== f.position) return false;
    if (f.face && c.face !== f.face) return false;
    return true;
  }
  const def = CARDS[c.slug];
  if (!def) return false;
  if (f.kind && def.kind !== f.kind) return false;
  if (f.type && def.type !== f.type) return false;
  if (f.excludeType && def.type === f.excludeType) return false;
  if (f.attribute && def.attribute !== f.attribute) return false;
  if (f.minLevel != null && (def.level ?? 0) < f.minLevel) return false;
  if (f.maxLevel != null && (def.level ?? 0) > f.maxLevel) return false;
  if (f.minAtk != null && (def.atk ?? 0) < f.minAtk) return false;
  if (f.maxAtk != null && (def.atk ?? 0) > f.maxAtk) return false;
  if (f.nameIncludes && !def.name.toLowerCase().includes(f.nameIncludes.toLowerCase())) return false;
  if (f.toon && !isToon(c.slug)) return false;
  /* "A monster worth setting face-down" asked of the card itself, rather than
     kept as a list that goes stale the first time a FLIP card is written. */
  if (f.hasFlipEffect && !def.effects.some((e) => e.trigger === 'onFlip')) return false;
  if (f.slugs && !f.slugs.includes(c.slug)) return false;
  if (f.position && c.position !== f.position) return false;
  if (f.face && c.face !== f.face) return false;
  return true;
}

export function faceUpOnSide(state: DuelState, pid: PlayerId, slug: string): boolean {
  const p = state.players[pid];
  if (p.spellTrap?.slug === slug && p.spellTrap.face === 'up') return true;
  if (p.field?.slug === slug && p.field.face === 'up') return true;
  return p.monsters.some((m) => m?.slug === slug && m.face === 'up');
}

/**
 * Whether a Special Summon may bring this monster back to this player's side.
 *
 * The Graveyard holds everything and Monster Reborn takes anything out of it —
 * Ritual monsters and Fusions included, which is the printed card's whole
 * drama. The one bar is the book: a Toon Summoned Skull is not a Summoned
 * Skull, it is a card that cannot be on the field without Toon World, and
 * reviving one into an empty Field Zone put a monster on the board that could
 * never have been Summoned there.
 *
 * The four that are only drawings while the book is open are revivable without
 * it, because without it they are ordinary monsters — Dark Rabbit comes back as
 * a Dark Rabbit, and stays one until somebody opens the book over it.
 */
export function revivable(state: DuelState, pid: PlayerId, slug: string, by?: string): boolean {
  const need = CARDS[slug]?.summonRequires;
  if (need && !faceUpOnSide(state, pid, need)) return false;
  /* And the other bar: a card that only its own ladder may put on the field.
     `by` is the slug of whatever effect is doing the summoning, so the two
     rungs that are allowed to reach the Perfectly Ultimate Great Moth still
     can, and nothing else does. A caller that does not say who is asking is
     refused — an anonymous Special Summon is exactly the shortcut this bars. */
  const only = CARDS[slug]?.summonOnlyBy;
  if (only?.length && (!by || !only.includes(by))) return false;
  return true;
}
