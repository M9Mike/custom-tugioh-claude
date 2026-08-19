/**
 * The duel engine.
 *
 * Pure and deterministic: every state transition is a function of the previous
 * state, the action, and a seeded RNG carried inside the state. The server runs
 * this as the single source of truth; the client runs the same code to predict
 * what its buttons should do.
 */
import { baseAtk, baseDef, card, CARDS, DUELIST_BY_ID, DUELISTS, isToonWhenBookOpen, toonActive, toonDisplayName } from './cards';
import { faceUpOnSide, matchesFilter, revivable } from './targeting';
/* The engine asks the same picker the board does. No cycle: `ui.ts` reads its
   targeting rules from `targeting.ts` now, not from here. */
import { targetCandidates, targetSpecFor } from './ui';
/* Re-exported because they lived here for the whole of this game's history and
   dozens of callers — the board, the checks, the harnesses — import them from
   the engine. Moving the file they live in should not move everyone's import. */
export { matchesFilter, revivable } from './targeting';
import {
  MONSTER_ZONES,
  OPENING_HAND,
  STARTING_LP,
  type AnimEvent,
  type CardDef,
  type CardEffect,
  type CardFilter,
  type CardFlags,
  type CardInstance,
  type DuelAction,
  type DuelState,
  type Duration,
  type EquipGrant,
  type Face,
  type PendingChoice,
  type PendingTrap,
  type Position,
  type Op,
  type OngoingEffect,
  type PlayerId,
  type PlayerState,
  type Selector,
  type Side,
  type TrapWindow,
  type Trigger,
  type TriggerContext,
} from './types';

const EXODIA_PIECES = [
  'exodia-the-forbidden-one',
  'left-arm-of-the-forbidden-one',
  'right-arm-of-the-forbidden-one',
  'left-leg-of-the-forbidden-one',
  'right-leg-of-the-forbidden-one',
];

/* ------------------------------------------------------------------ */
/* Deterministic RNG                                                   */
/* ------------------------------------------------------------------ */

function nextRandom(state: DuelState): number {
  // mulberry32 — small, fast, and reproducible across client and server.
  state.seed = (state.seed + 0x6d2b79f5) >>> 0;
  let t = state.seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function randInt(state: DuelState, maxExclusive: number): number {
  return Math.floor(nextRandom(state) * maxExclusive);
}

function shuffle<T>(state: DuelState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(state, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const other = (p: PlayerId): PlayerId => (p === 'p1' ? 'p2' : 'p1');

function makeUid(state: DuelState): string {
  state.uidSeq += 1;
  return `c${state.version}_${state.uidSeq}_${randInt(state, 1e6).toString(36)}`;
}

function newInstance(state: DuelState, slug: string, owner: PlayerId): CardInstance {
  return {
    uid: makeUid(state),
    slug,
    owner,
    face: 'up',
    position: 'atk',
    atkMod: 0,
    defMod: 0,
    turnAtkMod: 0,
    turnDefMod: 0,
    /* Every card starts empty. The moths used to be seeded here, back when the
       ladder was climbed in place; now each rung places its own counters as it
       is summoned, and a seed on top of that would count the same rung twice. */
    counters: 0,
    equips: [],
    flags: {},
    turnFlags: {},
    summonedOnTurn: -1,
    attacksUsed: 0,
    effectUsedOnTurn: -1,
    absorbed: [],
  };
}

/**
 * `slug` is the card the line is about, and it is worth passing whenever there
 * is one: a line that ends up with a beat of its own has nothing to draw
 * without it, which is how "Battle Ox gains 300 ATK" came to be printed over
 * empty space. A Token passes nothing — it wears another card's face and is not
 * that card.
 */
function log(
  state: DuelState,
  text: string,
  tone: 'normal' | 'attack' | 'effect' | 'damage' | 'summon' | 'system' = 'normal',
  player?: PlayerId,
  slug?: string
) {
  state.log.push({ id: `l${state.log.length}`, turn: state.turn, player, text, tone, slug });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

/**
 * The card to draw beside a log line.
 *
 * A Token passes its borrowed art too, which is safe precisely because this
 * only ever reaches a `note` beat: that beat prints the line verbatim, and the
 * line already says "Kuriboh Token". The `as`/actor machinery that exists to
 * stop a Token being announced as the card it copies applies to summon beats,
 * which build their own caption and are never fed from here.
 */
const logSlug = (c: CardInstance): string | undefined => c.slug;

function anim(state: DuelState, ev: Omit<AnimEvent, 'id'>) {
  /* Unique across versions, because the list is no longer emptied between
     actions — `state.anims.length` alone repeats as the tail is trimmed.
     Counted off the state rather than a module counter, so the engine stays
     deterministic and two serverless instances cannot mint the same id. */
  const prefix = `a${state.version}_`;
  const n = state.anims.reduce((k, a) => (a.id.startsWith(prefix) ? k + 1 : k), 0);
  /* Every beat carries the line the duel just recorded. The log is a memory
     aid; a player should never have to open it to find out what happened, so
     whatever was written is said on the field as the beat plays. Callers log
     first and animate second, which is what makes the pairing land. */
  const shown = state.logShown ?? 0;
  const pending = state.log.slice(shown);
  const line = pending[pending.length - 1];
  if (line) state.logShown = state.log.length;
  state.anims.push({ id: `${prefix}${n}`, note: line?.text, tone: line?.tone, ...ev });
}

/**
 * Says so when a card resolves and comes up with nothing.
 *
 * Reported of Magical Hats: "I activated it with Dark Magician in my hand and
 * it did not Special Summon". It could not — the hats hide a named handful of
 * magicians and the only one in that deck was the one in the hand, so the pool
 * was empty. The engine was right and the board was silent, which is the same
 * thing as being wrong: a card that half-resolves and says nothing about the
 * half that did not reads as broken every time.
 *
 * The source card's own face goes with the line, so the player is looking at
 * the card that came up empty while being told it did.
 */
function emptyHanded(state: DuelState, ctx: EffectCtx, text: string) {
  log(state, text, 'effect', ctx.controller, logSlug(ctx.source));
}

/**
 * Gives a beat to every log line that no animation claimed.
 *
 * Run at the end of an action, so a line like "Battle Ox's effects are negated"
 * — logged by an op that has no animation of its own — still gets its moment on
 * the field rather than only existing in the log.
 */
function speakRemainingLog(state: DuelState) {
  const shown = state.logShown ?? 0;
  const prefix = `a${state.version}_`;
  for (const entry of state.log.slice(shown)) {
    /* Not every caller logs before it animates. Where the log came second, the
       line belongs to the beat that is already there — giving it one of its own
       made Kuriboh's token announce itself twice, once as the summon and again
       as the line describing it. Only a line with no beat to attach to gets a
       beat of its own.

       The victory flourish is the one beat that may never adopt. It carries no
       slug — `declare` says as much: only Exodia's win beat names a card — so a
       line it swallows is printed over empty space. That is how "Battle Ox holds
       firm." lost its picture: the recoil that killed its attacker ended the
       duel, the win beat went up note-less, and the line written a moment later
       had nowhere else to go. Adopting is also wrong on its own terms, since a
       win beat that gained a slug would announce the defender as *assembled*. */
    const orphan = [...state.anims]
      .reverse()
      .find((a) => a.id.startsWith(prefix) && !a.note && a.kind !== 'win');
    if (orphan) {
      orphan.note = entry.text;
      orphan.tone = entry.tone;
      continue;
    }
    if (entry.tone === 'system') continue; // "Turn 4 — Yugi's turn" is chrome
    const n = state.anims.reduce((k, a) => (a.id.startsWith(prefix) ? k + 1 : k), 0);
    /* The card the line was written about, so the beat has a face to show.
       Without it a line that earns its own beat is printed over empty space. */
    const beat: AnimEvent = {
      id: `${prefix}${n}`,
      kind: 'note',
      note: entry.text,
      tone: entry.tone,
      player: entry.player,
      ...(entry.slug ? { slug: entry.slug } : {}),
    };
    /* In front of the victory flourish, which is the last thing the board does.
       The queue plays in array order, so appending would have the duel end and
       *then* report the blow that ended it. */
    const flourish = state.anims.findIndex((a) => a.id.startsWith(prefix) && a.kind === 'win');
    if (flourish >= 0) state.anims.splice(flourish, 0, beat);
    else state.anims.push(beat);
  }
  state.logShown = state.log.length;
}

/**
 * What to call a card out loud.
 *
 * A Toon that is only a Toon while the book is open is announced as one, and
 * announced as its plain self when it is not: Bickuribox on an empty field,
 * Toon Bickuribox once Toon World is down. It is the only signal a player gets
 * that Dark Hole is about to walk past it, and without it the protection reads
 * as the board cheating.
 *
 * The state is needed for that and only that — a Token still borrows its own
 * name, and everything else is the printed one.
 */
export function displayName(state: DuelState, c: CardInstance): string {
  if (c.isToken) return c.tokenName ?? 'Token';
  if (!isToonWhenBookOpen(c.slug)) return card(c.slug).name;
  const holder = findOnField(state, c.uid)?.controller ?? c.owner;
  return toonDisplayName(c.slug, faceUpOnSide(state, holder, 'toon-world'));
}

/** Every face-up card on the field, both players, for aura scanning. */
function fieldCards(state: DuelState): { c: CardInstance; controller: PlayerId }[] {
  const out: { c: CardInstance; controller: PlayerId }[] = [];
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const p = state.players[pid];
    for (const m of p.monsters) if (m && m.face === 'up') out.push({ c: m, controller: pid });
    if (p.spellTrap && p.spellTrap.face === 'up') out.push({ c: p.spellTrap, controller: pid });
    if (p.field) out.push({ c: p.field, controller: pid });
  }
  return out;
}

export function controllerOf(state: DuelState, uid: string): PlayerId | null {
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const p = state.players[pid];
    if (p.monsters.some((m) => m?.uid === uid)) return pid;
    if (p.spellTrap?.uid === uid) return pid;
    if (p.field?.uid === uid) return pid;
    if (p.hand.some((h) => h.uid === uid)) return pid;
  }
  return null;
}

function findOnField(state: DuelState, uid: string): { c: CardInstance; controller: PlayerId; zone: 'monster' | 'spellTrap' | 'field'; index: number } | null {
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const p = state.players[pid];
    const i = p.monsters.findIndex((m) => m?.uid === uid);
    if (i >= 0) return { c: p.monsters[i]!, controller: pid, zone: 'monster', index: i };
    if (p.spellTrap?.uid === uid) return { c: p.spellTrap, controller: pid, zone: 'spellTrap', index: 0 };
    if (p.field?.uid === uid) return { c: p.field, controller: pid, zone: 'field', index: 0 };
  }
  return null;
}

/**
 * Matches a card against a filter using base stats (never aura-adjusted, to
 * avoid recursion).
 *
 * Exported because the picker needs the same answer. It used to keep its own
 * copy and the two had already drifted: the client's knew nothing about `toon`,
 * so Toon World's "add 1 Toon monster" offered every monster in the Deck —
 * reported as the modal showing the whole deck. One rule, one place, and the
 * drift cannot happen again.
 */

/* ------------------------------------------------------------------ */
/* Effective stats (base + modifiers + equips + auras)                 */
/* ------------------------------------------------------------------ */

interface AuraBonus {
  atk: number;
  def: number;
  grants: Set<EquipGrant>;
  /** Extra ATK that only counts against a Defence Position monster — Pendulum
   *  Machine's 1250, which is a swing modifier rather than a stat and so has
   *  to travel as a number instead of as one of the boolean grants. */
  bonusVsDefense: number;
}

/** The `equipTo` op on a card, if it is an Equip Spell. */
export function equipOpOf(slug: string): Extract<Op, { op: 'equipTo' }> | null {
  for (const eff of CARDS[slug]?.effects ?? []) {
    for (const op of eff.ops) if (op.op === 'equipTo') return op;
  }
  return null;
}

export const isEquipSpell = (slug: string) => equipOpOf(slug) !== null;

/**
 * How many cards a scaling aura is counting — "for each card in your
 * Graveyard", "for each Dinosaur in your Graveyard", "for each Dark Magician in
 * either Graveyard".
 *
 * Only printed card data is read (slug, type, level), never an effective stat,
 * so calling this from inside the stat calculation cannot recurse.
 */
function auraCount(
  state: DuelState,
  controller: PlayerId,
  per: NonNullable<NonNullable<CardEffect['aura']>['per']>,
  selfUid?: string
): number {
  const pools: CardInstance[][] = [];
  const onField = (pid: PlayerId) => state.players[pid].monsters.filter((m): m is CardInstance => !!m);
  if (per.zone === 'ownHand') pools.push(state.players[controller].hand);
  else if (per.zone === 'ownGrave') pools.push(state.players[controller].grave);
  else if (per.zone === 'eitherGrave') pools.push(state.players.p1.grave, state.players.p2.grave);
  else if (per.zone === 'ownField') pools.push(onField(controller));
  else if (per.zone === 'oppField') pools.push(onField(other(controller)));
  else pools.push(onField('p1'), onField('p2'));
  let n = 0;
  for (const pool of pools) {
    for (const c of pool) {
      if (per.excludeSelf && c.uid === selfUid) continue;
      if (matchesFilter(c, per.filter)) n += 1;
    }
  }
  return n;
}

function aurasFor(state: DuelState, target: CardInstance, targetController: PlayerId): AuraBonus {
  const bonus: AuraBonus = { atk: 0, def: 0, grants: new Set(), bonusVsDefense: 0 };
  /* An aura is weather over the field, and a card in your hand is indoors.
     Nothing here asked where the target was, only whether it matched the
     filter — so with Dark Sanctuary open every monster in Bakura's hand was
     drawn at +600, tinted green, promising a number it would only actually
     have once it arrived. Reported as "shown in the hand with green buffed
     attack while still in hand". The Graveyard and the Deck read printed too,
     for the same reason. */
  if (!findOnField(state, target.uid)) return bonus;
  for (const { c: source, controller } of fieldCards(state)) {
    if (source.isToken || source.flags.negated) continue;
    const def = CARDS[source.slug];
    if (!def) continue;

    // An Equip Spell buffs exactly the monster it is attached to. Reading it
    // live from the card on the field is what makes destroying the equip remove
    // the bonus, rather than baking it into the monster for good.
    if (source.equippedTo === target.uid) {
      const eq = equipOpOf(source.slug);
      if (eq) {
        bonus.atk += eq.atk;
        bonus.def += eq.def;
        bonus.bonusVsDefense += eq.bonusVsDefense ?? 0;
        for (const g of eq.grants ?? []) bonus.grants.add(g);
      }
    }

    for (const eff of def.effects) {
      if (eff.trigger !== 'continuous' || !eff.aura) continue;
      /* An aura can be conditional — "while you control another Warrior" — and
         the condition was simply not read here, so every such card granted its
         bonus unconditionally. Masaki was indestructible alone on the field.
         `conditionMet` only reads counts and slugs, never effective stats, so
         calling it from inside the stat calculation cannot recurse. */
      if (eff.condition && !conditionMet(state, eff, source, controller)) continue;
      const s = eff.aura.target;
      // Which side is the aura looking at, relative to the aura's controller?
      const wantSide: Side = s.side;
      const sameSide = controller === targetController;
      if (wantSide === 'own' && !sameSide) continue;
      if (wantSide === 'opp' && sameSide) continue;
      if (s.pick === 'self' && source.uid !== target.uid) continue;
      if (s.excludeSelf && source.uid === target.uid) continue;
      if (s.pick !== 'self' && !matchesFilter(target, s.filter)) continue;
      bonus.atk += eff.aura.atk ?? 0;
      bonus.def += eff.aura.def ?? 0;
      if (eff.aura.perCounter) {
        bonus.atk += (eff.aura.perCounter.atk ?? 0) * target.counters;
        bonus.def += (eff.aura.perCounter.def ?? 0) * target.counters;
      }
      if (eff.aura.per) {
        const n = auraCount(state, controller, eff.aura.per, source.uid);
        bonus.atk += n * (eff.aura.per.atk ?? 0);
        bonus.def += n * (eff.aura.per.def ?? 0);
      }
      for (const g of eff.aura.grants ?? []) bonus.grants.add(g);
    }
  }
  return bonus;
}

export function effAtk(state: DuelState, c: CardInstance, controller?: PlayerId): number {
  const ctrl = controller ?? controllerOf(state, c.uid) ?? c.owner;
  const base = c.isToken ? (c.tokenAtk ?? 0) : baseAtk(c.slug);
  const absorbed = c.absorbed.reduce((sum, a) => sum + baseAtk(a.slug), 0);
  return Math.max(0, base + absorbed + c.atkMod + c.turnAtkMod + aurasFor(state, c, ctrl).atk);
}

export function effDef(state: DuelState, c: CardInstance, controller?: PlayerId): number {
  const ctrl = controller ?? controllerOf(state, c.uid) ?? c.owner;
  const base = c.isToken ? (c.tokenDef ?? 0) : baseDef(c.slug);
  const absorbed = c.absorbed.reduce((sum, a) => sum + baseDef(a.slug), 0);
  return Math.max(0, base + absorbed + c.defMod + c.turnDefMod + aurasFor(state, c, ctrl).def);
}

export function effFlags(state: DuelState, c: CardInstance, controller?: PlayerId): CardFlags {
  const ctrl = controller ?? controllerOf(state, c.uid) ?? c.owner;
  const auras = aurasFor(state, c, ctrl);
  const grants = auras.grants;
  const merged: CardFlags = { ...c.flags, ...c.turnFlags };
  merged.extraAttacks = (c.flags.extraAttacks ?? 0) + (c.turnFlags.extraAttacks ?? 0);
  /* Printed on the monster and bolted on by an equip both count, and they add:
     a Pendulum Machine wearing an equip that also punishes turtles swings with
     the sum of the two, not with whichever the merge happened to read last. */
  merged.bonusVsDefense = (merged.bonusVsDefense ?? 0) + auras.bonusVsDefense || undefined;
  if (grants.has('pierce')) merged.pierce = true;
  if (grants.has('directAttack')) merged.directAttack = true;
  if (grants.has('untargetable')) merged.untargetable = true;
  if (grants.has('indestructibleByBattle')) merged.indestructibleByBattle = true;
  if (grants.has('indestructibleByEffect')) merged.indestructibleByEffect = true;
  if (grants.has('doubleAttack')) merged.extraAttacks = (merged.extraAttacks ?? 0) + 1;
  if (grants.has('cannotAttack')) merged.cannotAttack = true;
  if (grants.has('mustBeAttacked')) merged.mustBeAttacked = true;
  if (grants.has('shedsAbsorbedInstead')) merged.shedsAbsorbedInstead = true;
  if (grants.has('sapsAttacker')) merged.sapsAttacker = true;
  if (grants.has('paysWithGraveInstead')) merged.paysWithGraveInstead = true;
  if (grants.has('attackCostDiscard')) merged.attackCostDiscard = true;
  if (grants.has('doublesWhenAttacking')) merged.doublesWhenAttacking = true;
  if (grants.has('halvesAttacker')) merged.halvesAttacker = true;
  if (grants.has('attackAll')) merged.attackAll = true;
  if (grants.has('halvedBattleDamage')) merged.halvedBattleDamage = true;
  if (grants.has('halvedDirectDamage')) merged.halvedDirectDamage = true;
  if (grants.has('summonSick')) merged.summonSick = true;
  if (grants.has('reflectBattleDamage')) merged.reflectBattleDamage = true;
  /* A side-wide shield reads as a flag on every monster standing behind it, so
     the battle code, the board and the AI all see it without any of them
     needing to know an ongoing effect exists. Tornado Wall raises it. */
  if (state.ongoing.some((o) => o.kind === 'preventBattleDestruction' && o.target === ctrl)) {
    merged.indestructibleByBattle = true;
  }
  return merged;
}

/**
 * Battle damage `attacker` inflicts, after whatever its own text charges for it.
 *
 * Sky Scout "can attack your opponent directly, but its battle damage is
 * halved", and only the first half of that sentence existed — so it was an
 * unblockable 1800 every turn, which is the best thing you can do with a Level
 * 4 in this game by some distance. Applied wherever the monster deals battle
 * damage rather than only on a direct attack, because that is what the sentence
 * says: rounded down, the way every other halving here rounds.
 *
 * `halvedDirectDamage` is the narrower bargain, and narrower again than it
 * first shipped: it is the price of going *over* a guard, not the price of
 * attacking directly. Gaia the Dragon Champion charges past blockers for half
 * or through one of them for everything — but with nothing in front of him
 * there is nobody to fly over, so an open field is an ordinary direct attack at
 * full ATK, exactly like any other monster's.
 *
 * That is why the defender's board is read here rather than the flag being
 * trusted on its own. Charging it on an empty field made the Champion strictly
 * worse than a vanilla body against no defence, which is the opposite of what a
 * card that says "can attack directly" is for.
 *
 * Read at damage time, so the swing whose target vanished mid-attack is judged
 * by what is actually left standing: other blockers still cost him half, an
 * emptied board does not.
 */
function battleDamageFrom(
  state: DuelState,
  attacker: CardInstance,
  controller: PlayerId,
  raw: number,
  direct = false
): number {
  const f = effFlags(state, attacker, controller);
  if (f.halvedBattleDamage) return Math.floor(raw / 2);
  if (direct && f.halvedDirectDamage) {
    const guarded = state.players[other(controller)].monsters.some((m) => !!m);
    if (guarded) return Math.floor(raw / 2);
  }
  return raw;
}

export function maxAttacks(state: DuelState, c: CardInstance, controller: PlayerId): number {
  const f = effFlags(state, c, controller);
  const extra = f.extraAttacks ?? 0;
  /* An allowance it cannot pay for is not an allowance. `canAttackWith`
     already refuses a swing with nothing left in hand, so a Two-Headed King
     Rex answering "two" here was the engine disagreeing with itself — and the
     AI believed this one: it read a monster it could not swing at all as a
     two-attack threat, and priced a summon that stranded its own hand as if it
     had bought a clock. What has already been spent plus what is still
     affordable. */
  const affordable = f.attackCostDiscard ? c.attacksUsed + state.players[controller].hand.length : Infinity;
  if (!f.attackAll) return Math.min(1 + extra, affordable);
  /* "Attacks every monster your opponent controls once each." Counting the
     *current* board shrank the allowance with every kill: three defenders
     became two attacks, because the second kill lowered the ceiling below the
     attacks already spent and the third defender was suddenly unreachable. So
     the allowance is the whole board it has ever faced — the monsters it has
     already visited plus the ones it has not — and destroying a target never
     revokes the next one.

     *Visited*, not *attacks spent*. Those two were the same number for as long
     as every swing landed on a fresh monster, and `attacksUsed` was standing in
     for the count. A direct attack marks nothing visited, so once extra attacks
     were added on top the number appeared on both sides of `attacksUsed <
     maxAttacks`: every direct swing raised its own ceiling and Serpent Night
     Dragon attacked until the other player was dead. Reported from a real duel
     as "seems to have infinite attacks".

     Extra attacks ride on top of the sweep rather than being an alternative
     floor beneath it. Serpent Night Dragon is "each of their monsters, and then
     one more": two defenders is three swings, and an empty board across the
     table is the one more on its own — which falls out of the sum without
     needing a case of its own, because there is nothing to sweep. */
  const visited = new Set(c.attacked ?? []);
  const fresh = state.players[other(controller)].monsters.filter(
    (m): m is CardInstance => !!m && !visited.has(m.uid)
  ).length;
  return Math.min(Math.max(1, visited.size + fresh + extra), affordable);
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

/**
 * Seats one duelist with a deck.
 *
 * `deck` overrides the duelist's own list, and exists for Story Mode: the
 * player's twenty-five are the cards they chose and own, not a premade. The
 * `duelistId` still matters when one is given — it carries the accent colours
 * and the epithet the board is dressed with — so a story duelist is a premade's
 * costume over their own cards.
 *
 * A story deck is a flat list of slugs with no counts, because Story Mode deals
 * in single copies: choosing the deck *is* choosing the collection, and the
 * collection holds one of each.
 */
function buildPlayer(
  state: DuelState,
  id: PlayerId,
  duelistId: string,
  name: string,
  deck?: string[]
): PlayerState {
  const duelist = DUELIST_BY_ID[duelistId];
  const p: PlayerState = {
    id,
    duelistId,
    name,
    lp: STARTING_LP,
    deck: [],
    hand: [],
    monsters: Array(MONSTER_ZONES).fill(null),
    spellTrap: null,
    field: null,
    grave: [],
    banished: [],
    extra: [],
    normalSummonUsed: false,
    ready: true,
  };
  if (deck?.length) {
    for (const slug of deck) p.deck.push(newInstance(state, slug, id));
  } else {
    for (const [slug, count] of duelist.deck) {
      for (let i = 0; i < count; i++) p.deck.push(newInstance(state, slug, id));
    }
  }
  for (const slug of duelist.extra) p.extra.push(newInstance(state, slug, id));
  shuffle(state, p.deck);
  return p;
}

export function createDuel(opts: {
  seed: number;
  p1: { duelistId: string; name: string; deck?: string[] };
  p2: { duelistId: string; name: string; deck?: string[] };
  firstPlayer?: PlayerId;
}): DuelState {
  const state: DuelState = {
    players: {} as Record<PlayerId, PlayerState>,
    turn: 1,
    active: opts.firstPlayer ?? 'p1',
    phase: 'main',
    ongoing: [],
    log: [],
    anims: [],
    pending: null,
    winner: null,
    seed: opts.seed >>> 0,
    duelId: `${opts.seed >>> 0}-${opts.firstPlayer ?? 'p1'}`,
    version: 0,
    uidSeq: 0,
    suspendedAttack: null,
  };
  state.players.p1 = buildPlayer(state, 'p1', opts.p1.duelistId, opts.p1.name, opts.p1.deck);
  state.players.p2 = buildPlayer(state, 'p2', opts.p2.duelistId, opts.p2.name, opts.p2.deck);

  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    for (let i = 0; i < OPENING_HAND; i++) drawCard(state, pid, true);
  }
  log(state, `${state.players[state.active].name} goes first.`, 'system');
  log(state, `Turn 1 — ${state.players[state.active].name}'s Main Phase.`, 'system');
  checkExodia(state);
  return state;
}

/* ------------------------------------------------------------------ */
/* Card movement                                                       */
/* ------------------------------------------------------------------ */

function drawCard(state: DuelState, pid: PlayerId, silent = false): boolean {
  const p = state.players[pid];
  const c = p.deck.shift();
  if (!c) {
    if (!state.winner) {
      state.winner = other(pid);
      state.winReason = `${p.name} ran out of cards.`;
      log(state, `${p.name} cannot draw — deck out!`, 'system');
    }
    return false;
  }
  p.hand.push(c);
  if (!silent) {
    log(state, `${p.name} draws a card.`, 'normal', pid);
    anim(state, { kind: 'draw', player: pid });
  }
  return true;
}

/** Removes a card from wherever it currently is. Returns true if found. */
function removeFromAnywhere(state: DuelState, uid: string): CardInstance | null {
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const p = state.players[pid];
    const mi = p.monsters.findIndex((m) => m?.uid === uid);
    if (mi >= 0) {
      const c = p.monsters[mi]!;
      p.monsters[mi] = null;
      return c;
    }
    if (p.spellTrap?.uid === uid) {
      const c = p.spellTrap;
      p.spellTrap = null;
      return c;
    }
    if (p.field?.uid === uid) {
      const c = p.field;
      p.field = null;
      return c;
    }
    const hi = p.hand.findIndex((h) => h.uid === uid);
    if (hi >= 0) return p.hand.splice(hi, 1)[0];
    const di = p.deck.findIndex((h) => h.uid === uid);
    if (di >= 0) return p.deck.splice(di, 1)[0];
    const gi = p.grave.findIndex((h) => h.uid === uid);
    if (gi >= 0) return p.grave.splice(gi, 1)[0];
    const ei = p.extra.findIndex((h) => h.uid === uid);
    if (ei >= 0) return p.extra.splice(ei, 1)[0];
  }
  return null;
}

function resetInstance(c: CardInstance) {
  c.atkMod = 0;
  c.defMod = 0;
  c.turnAtkMod = 0;
  c.turnDefMod = 0;
  /* Counters reset with everything else, and a moth revived from the pile
     places its own again on the way in — the summon does the seeding now. */
  c.counters = 0;
  c.equips = [];
  c.flags = {};
  c.turnFlags = {};
  c.attacksUsed = 0;
  c.attacked = [];
  c.absorbed = [];
  c.face = 'up';
  c.position = 'atk';
  c.controlRevertsOnTurn = undefined;
  c.effectUsedOnTurn = -1;
  c.positionChangedOnTurn = undefined;
  c.equippedTo = undefined;
  /* Cleared here and set again by the Special Summon itself, so a card that
     was bounced back to the hand and then properly Tribute Summoned cannot
     inherit a stale "did not pay for itself" from a previous life. */
  c.specialSummonedOnTurn = undefined;
}

/**
 * Sends a card from the field to its owner's Graveyard, firing onSentToGrave.
 *
 * `destroyed` additionally fires `onDestroyed`, and only the one genuine
 * destruction site passes it. Everything else that routes through here — a
 * tribute, a Fusion material, a cost, an equip following its monster down, a
 * Field Spell being replaced, a borrowed God going home — is a card leaving
 * the field, not a card being destroyed. Defaulting to `false` is deliberate:
 * a missed site means a destruction effect does not fire, which is far less
 * damaging than one firing while you are paying a Tribute Summon.
 */
/**
 * Cut a card free of whatever it was equipped to, in both directions.
 *
 * An Equip Spell has nothing left to hold once its monster leaves, so it
 * follows the monster down; and an equip leaving the field stops being listed
 * on the monster it was buffing.
 *
 * This used to live inside `toGrave` alone, which meant it ran when the host
 * was *destroyed* and not when it left the field any other way. `bounce`,
 * `banish` and `shuffleIntoDeck` all lift a card out with
 * `removeFromAnywhere` and never went past it — so returning an equipped
 * monster to the hand left the Equip Spell sitting in the Spell/Trap Zone,
 * holding the only zone there is, attached to a card that was no longer on the
 * field. Reported of Malevolent Nuzzler; it was true of every equip in the
 * game and of all three removals.
 *
 * Called from the four places a card can leave the field.
 */
function releaseEquips(state: DuelState, c: CardInstance, hostDestroyed = false) {
  // Anything equipped TO this card goes to the Graveyard with it. These are
  // real cards in a Spell/Trap Zone, so `toGrave` is what takes them off.
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const st = state.players[pid].spellTrap;
    if (st?.equippedTo !== c.uid) continue;
    toGrave(state, st.uid, true);
    /* Fired after it has landed, and only when the host was *destroyed*.
       Metalmorph answers a wrecked host by calling Zoa back, and the three
       things that are not a destruction — a bounce, a banish, a Tribute — must
       not pay out. `onSentToGrave` on the equip could not tell them apart, and
       would also have gone off when the equip itself was the thing shattered
       by a backrow wipe, which is the opposite of the sentence. */
    if (hostDestroyed) fireTriggers(state, st, pid, 'onHostDestroyed', {});
  }
  // And if this card IS an equip, the host stops listing it.
  if (c.equippedTo) {
    const host = findOnField(state, c.equippedTo)?.c;
    if (host) {
      const at = host.equips.indexOf(c.slug);
      if (at >= 0) host.equips.splice(at, 1);
    }
    c.equippedTo = undefined;
  }
}

/**
 * A departure whose triggers have not gone off yet.
 *
 * A Tribute is paid *for* a Summon, and what the tributed card does on its way
 * out belongs after the monster it bought has landed — not in the middle of
 * paying. The Portrait's Secret is the card that makes this matter: it lets
 * three of itself out when it is sent to the Graveyard, and firing that during
 * payment filled all three Monster Zones, so the Summon it had just paid for
 * had nowhere to go and was refused outright.
 */
interface PendingDeparture {
  c: CardInstance;
  controller: PlayerId;
  destroyed: boolean;
  /** What it was carrying on the way out — see `toGrave`. */
  counters: number;
}

/**
 * Can these dice be made to total seven?
 *
 * Any two added, all of them added, or all of them with exactly one subtracted
 * — which is Slot Machine's sentence, and on three dice it comes to 132 of the
 * 216 ways they can fall. Written as a search over the actual arrangements
 * rather than as a table, so the odds are a consequence of the rule instead of
 * a number somebody has to keep in step with it.
 */
export function makesSeven(dice: number[]): boolean {
  const total = dice.reduce((n, d) => n + d, 0);
  if (total === 7) return true;
  for (let i = 0; i < dice.length; i++) {
    // All of them, with this one subtracted rather than added.
    if (total - 2 * dice[i] === 7) return true;
    for (let j = i + 1; j < dice.length; j++) if (dice[i] + dice[j] === 7) return true;
  }
  return false;
}

/**
 * A card arriving in a Graveyard, from wherever it was.
 *
 * Fifteen places pushed straight onto the pile — a discard, a mill, a cost paid
 * out of hand, a Fusion's Polymerization, the card fed to Two-Headed King Rex.
 * `onSentToGrave` never saw any of them, because it fires out of `toGrave`,
 * which only runs for a card leaving the *field*. Uraby says "sent to the
 * Graveyard in any way" and means it, so there is one door now and every route
 * goes through it. `toGrave` calls this too, for the field route, alongside the
 * field-only trigger it has always fired.
 */
function landInGrave(state: DuelState, c: CardInstance, owner: PlayerId) {
  state.players[owner].grave.push(c);
  fireTriggers(state, c, owner, 'onAnyToGrave', {});
}

function fireDepartures(state: DuelState, pending: PendingDeparture[]) {
  for (const d of pending) {
    /* Hand the card back what it was worth for the length of its own farewell.
       A Cocoon of Evolution hatches whatever rung it had grown to, and it was
       being asked that question after the pile had already blanked it. */
    d.c.counters = d.counters;
    if (d.destroyed) fireTriggers(state, d.c, d.controller, 'onDestroyed', {});
    fireTriggers(state, d.c, d.controller, 'onSentToGrave', {});
    d.c.counters = 0;
  }
}

function toGrave(state: DuelState, uid: string, fromField: boolean, destroyed = false, defer?: PendingDeparture[]) {
  const found = fromField ? findOnField(state, uid) : null;
  const controller = found?.controller;
  const c = removeFromAnywhere(state, uid);
  if (!c) return;

  releaseEquips(state, c, destroyed);
  /* Absorbed monsters go home. Each one carries the seat it came from, because
     the holder's owner is not it: Monster Reborn hands Relinquished across the
     table often enough, and "the other side from whoever is holding me" sent a
     stolen monster to the thief's Graveyard. */
  for (const ab of c.absorbed) {
    landInGrave(state, newInstance(state, ab.slug, ab.owner), ab.owner);
  }

  if (c.isToken) {
    /* A token leaves no body, but it may leave a debt. The Portrait's Secret
       splits into three of itself and each one that dies is another 300 off
       the opponent — written on the token because the painting that made it
       is in the Graveyard by then and fires nothing. */
    if (c.tokenDeathDamage && controller) {
      const foe = other(controller);
      log(state, `${displayName(state, c)} fades, and the shadows take their due.`, 'effect', controller, c.slug);
      dealDamage(state, foe, c.tokenDeathDamage);
    }
    return; // otherwise tokens simply vanish
  }

  const wasOnField = fromField && controller != null;
  const counters = c.counters;
  resetInstance(c);
  state.players[c.owner].grave.push(c);

  if (wasOnField) {
    if (defer) defer.push({ c, controller, destroyed, counters });
    else fireDepartures(state, [{ c, controller, destroyed, counters }]);
  }
  /* And the arrival, which is a different sentence from the departure: this one
     is true of a card that was never on the board. */
  fireTriggers(state, c, c.owner, 'onAnyToGrave', {});
}

/**
 * The arrival ceremony every Special Summon performs, wherever the monster came
 * from: out of its old zone, stats wiped clean, into the named zone face-up (or
 * not), announced and animated.
 *
 * Lifted out of the `specialSummon` op the day three more roads to the field
 * opened at once — a dig that stops on a Dinosaur, a card that calls itself out
 * of a hand or a Graveyard, and a monster owed back at the start of a turn.
 * Each of them re-copying eight lines is how the "log, then animate" rule and
 * the `specialSummonedOnTurn` marker come to disagree across the file.
 *
 * Triggers are *not* fired here: what a summon wakes up depends on the road it
 * took, and every caller is explicit about it.
 */
function landSpecialSummon(
  state: DuelState,
  c: CardInstance,
  controller: PlayerId,
  zone: number,
  position: Position,
  face: Face
) {
  removeFromAnywhere(state, c.uid);
  resetInstance(c);
  c.position = position;
  c.face = face;
  c.summonedOnTurn = state.turn;
  // It arrived without paying for itself — see `returnBorrowedGods`.
  c.specialSummonedOnTurn = state.turn;
  state.players[controller].monsters[zone] = c;
  log(state, `${state.players[controller].name} Special Summons ${displayName(state, c)}!`, 'summon', controller);
  anim(state, { kind: 'summon', uid: c.uid, slug: c.slug, player: controller });
}

/* ------------------------------------------------------------------ */
/* Life points                                                         */
/* ------------------------------------------------------------------ */

function dealDamage(state: DuelState, to: PlayerId, amount: number, battle = false) {
  if (amount <= 0) return;
  if (battle && state.ongoing.some((o) => o.kind === 'preventBattleDamage' && o.target === to)) {
    log(state, `${state.players[to].name} takes no battle damage.`, 'effect', to);
    return;
  }
  // What the attack was worth, and what the total could actually pay. The board
  // reconstructs the unspoken total by adding queued damage back, so it needs
  // the second number: a 1900 swing into 1200 Life Points was being added back
  // in full and the bar started the countdown at 1900 — the attacker's ATK,
  // from a player who never had that many Life Points.
  const applied = Math.min(amount, state.players[to].lp);
  state.players[to].lp -= applied;
  log(state, `${state.players[to].name} takes ${amount} damage. (${state.players[to].lp} LP)`, 'damage', to);
  anim(state, { kind: 'damage', player: to, amount, applied });
  checkLifePoints(state);
}

function healPlayer(state: DuelState, to: PlayerId, amount: number) {
  if (amount <= 0) return;
  state.players[to].lp += amount;
  log(state, `${state.players[to].name} gains ${amount} Life Points. (${state.players[to].lp} LP)`, 'effect', to);
  anim(state, { kind: 'heal', player: to, amount });
}

function checkLifePoints(state: DuelState) {
  if (state.winner) return;
  const p1Dead = state.players.p1.lp <= 0;
  const p2Dead = state.players.p2.lp <= 0;
  if (p1Dead && p2Dead) {
    state.winner = 'draw';
    state.winReason = 'Both duelists fell at the same moment.';
  } else if (p1Dead) {
    state.winner = 'p2';
    state.winReason = `${state.players.p1.name} has no Life Points left.`;
  } else if (p2Dead) {
    state.winner = 'p1';
    state.winReason = `${state.players.p2.name} has no Life Points left.`;
  }
  if (state.winner) anim(state, { kind: 'win' });
}

/**
 * The Forbidden One assembles in the hand *or* on the field.
 *
 * Hand-only was the printed rule and it made the five pieces unplayable in a
 * literal sense: each one is a real monster with a Normal Summon and a draw
 * effect, and using any of them threw the duel's win condition away. Now a
 * piece standing in a Monster Zone still counts as gathered, so summoning one
 * for its draw is a tempo choice rather than a forfeit.
 *
 * Face-down counts. A set piece is still a piece you have; hiding it should not
 * cost the assembly, and the alternative would make the win depend on which way
 * up a card happens to be sitting.
 *
 * Tokens never count. A Sheep Token carries an art slug rather than a card, and
 * a copy of something is not the thing.
 *
 * The Graveyard is not included, deliberately: a destroyed piece is lost, which
 * is what keeps holding them safer than parading them.
 */
function checkExodia(state: DuelState) {
  if (state.winner) return;
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const p = state.players[pid];
    const held = new Set(p.hand.map((c) => c.slug));
    for (const m of p.monsters) if (m && !m.isToken) held.add(m.slug);
    if (EXODIA_PIECES.every((s) => held.has(s))) {
      state.winner = pid;
      state.winReason = `${state.players[pid].name} assembled Exodia the Forbidden One!`;
      log(state, `EXODIA! ${state.players[pid].name} assembled all five pieces!`, 'system', pid);
      /* The slug is what earns it a moment on screen: the client only gives the
         2.5D flourish to a card it can name, and without one the five pieces
         came together and the victory modal simply appeared. */
      anim(state, { kind: 'win', player: pid, slug: 'exodia-the-forbidden-one', text: 'EXODIA, OBLITERATE!' });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Effect resolution                                                   */
/* ------------------------------------------------------------------ */

interface EffectCtx {
  state: DuelState;
  controller: PlayerId;
  source: CardInstance;
  targets: string[];
  cursor: number;
  trig: TriggerContext;
  /** Monsters this effect has Special Summoned, for `pick: 'summoned'`. */
  summoned?: string[];
  /** ATK of whatever this effect's own cost tributed, read before it left. */
  tributedAtk?: number[];
  /** Counters the source was carrying when the effect was activated, read
      before a `tributeSelf` cost sent it to the pile and blanked it. */
  counters?: number;
  /** Set by negateAttack so battle resolution can be cancelled. */
  attackNegated?: boolean;
  battlePhaseEnded?: boolean;
  /**
   * Pips shown by the most recent `diceRoll` in this effect, for a `gainAtk`
   * that scales with the roll.
   *
   * Read by an op *after* the roll rather than nested inside `perPip`, because
   * `perPip` runs its ops once per pip: a gain of 100 written there would be
   * six separate applications and — since `gainAtk` logs every time it moves a
   * number — six beats reading "Garoozis gains 100 ATK" for one die.
   */
  lastRoll?: number;
  /**
   * How many cards this effect has actually destroyed, for a `damage` that is
   * priced per kill — "destroy up to 2, then 500 damage for each".
   *
   * Counted from what died rather than from what was aimed at: a protected
   * card, or a second target the player never picked, must not be billed for.
   */
  destroyedCount?: number;
  /** What this effect's own destructions were worth, read while they stood. */
  destroyedAtk?: number;
}

function sideToPlayers(ctx: EffectCtx, side: Side): PlayerId[] {
  if (side === 'own') return [ctx.controller];
  if (side === 'opp') return [other(ctx.controller)];
  return [ctx.controller, other(ctx.controller)];
}

function zoneCards(state: DuelState, pid: PlayerId, zone: Selector['zone']): CardInstance[] {
  const p = state.players[pid];
  switch (zone ?? 'monster') {
    case 'monster':
      return p.monsters.filter((m): m is CardInstance => !!m);
    case 'spellTrap':
      return p.spellTrap ? [p.spellTrap] : [];
    case 'field':
      return p.field ? [p.field] : [];
    case 'backrow':
      return [p.spellTrap, p.field].filter((c): c is CardInstance => !!c);
    case 'hand':
      return p.hand;
    case 'grave':
      return p.grave;
    case 'deck':
      return p.deck;
    case 'extra':
      return p.extra;
    case 'banished':
      return p.banished;
    default:
      return [];
  }
}

/**
 * Every card a selector could reach, before the pick narrows it down. Shared
 * with the activation gate, which needs to know whether an effect has anything
 * to work on without actually resolving it.
 */
/**
 * An ATK threshold aimed at the field reads the monster's *live* ATK.
 *
 * Reported from a real duel: Crush Card Virus destroys "1500 or more ATK" and
 * left a Lord of D. standing who was sitting on 2800, because `matchesFilter`
 * only ever reads printed data — his card says 1200. Every threshold aimed at a
 * board is about the monster in front of you, not the number on the card.
 *
 * Deliberately here and not in `matchesFilter`. That function is also called
 * from inside aura evaluation, and The Dark Door's aura selects on `minAtk:
 * 2000` — so reading effective stats there would send `effAtk` back through
 * `aurasFor` and into itself. Doing it at the pool means the cards that point
 * at a board get live numbers while the aura pass keeps the printed ones it
 * needs to terminate.
 *
 * Only the Monster Zones. A card in a Graveyard, hand or Deck has no effective
 * stats to read, and every op that bounds ATK there — Sangan's search, Revival
 * Jam, Giant Red Seasnake — means the printed number.
 */
function passesLiveAtk(state: DuelState, c: CardInstance, zone: Selector['zone'], f?: CardFilter): boolean {
  if (!f || (f.minAtk == null && f.maxAtk == null)) return true;
  if ((zone ?? 'monster') !== 'monster') return true;
  const owner = controllerOf(state, c.uid);
  const live = effAtk(state, c, owner ?? undefined);
  if (f.minAtk != null && live < f.minAtk) return false;
  if (f.maxAtk != null && live > f.maxAtk) return false;
  return true;
}

function targetPool(ctx: EffectCtx, s: Selector): CardInstance[] {
  const zone = s.zone ?? 'monster';
  const pool: CardInstance[] = [];
  for (const pid of sideToPlayers(ctx, s.side)) {
    for (const c of zoneCards(ctx.state, pid, zone)) {
      if (s.excludeSelf && c.uid === ctx.source.uid) continue;
      /* The printed pass first, minus the ATK bounds, then the live one — so a
         filter's type/attribute/level clauses still apply exactly as before and
         only the ATK question is asked of the board. */
      if (!matchesFilter(c, stripAtkBounds(s.filter))) continue;
      if (!passesLiveAtk(ctx.state, c, zone, s.filter)) continue;
      pool.push(c);
    }
  }
  return pool;
}

/** The same filter with its ATK bounds removed — they are asked live instead. */
function stripAtkBounds(f?: CardFilter): CardFilter | undefined {
  if (!f || (f.minAtk == null && f.maxAtk == null)) return f;
  const rest: CardFilter = { ...f };
  delete rest.minAtk;
  delete rest.maxAtk;
  return rest;
}

function resolveTargets(ctx: EffectCtx, s: Selector): CardInstance[] {
  const { state } = ctx;
  const zone = s.zone ?? 'monster';

  if (s.pick === 'self') return [ctx.source];

  /* The ctx picks resolve from the trigger, not from a pool — but they are
     still an effect reaching a monster, so protection applies the same as
     everywhere else. This is how an untargetable God shrugs off the Trap Hole
     and Mirror Wall its summon or attack just opened: `isProtectedTarget`
     never shields a card from its own controller, and a Divine-Beast source
     pierces it, so Call of the Haunted's own buff and Slifer's second mouth
     both still land. */
  /* The three picks that name a card out of the context rather than search a
     zone all skipped `s.filter` entirely — a filter written on one of them was
     a sentence the engine could not read, which is how Time Machine's "if it is
     a Machine" would have paid out on a revived Spellcaster. They honour it
     now; no card was relying on the silence. */
  if (s.pick === 'attacker' || s.pick === 'attackTarget') {
    const uid = s.pick === 'attacker' ? ctx.trig.attackerUid : ctx.trig.targetUid;
    const c = uid ? findOnField(state, uid)?.c : null;
    if (!c || !matchesFilter(c, s.filter)) return [];
    if (isProtectedTarget(state, c, ctx.controller, ctx, s.piercesProtection)) {
      const ctrl = controllerOf(state, c.uid);
      if (ctrl) log(state, `${displayName(state, c)} stands beyond that effect's reach.`, 'effect', ctrl, logSlug(c));
      return [];
    }
    return [c];
  }
  if (s.pick === 'summoned') {
    return (ctx.summoned ?? [])
      .map((uid) => findOnField(state, uid)?.c)
      .filter(
        (c): c is CardInstance =>
          !!c && matchesFilter(c, s.filter) && !isProtectedTarget(state, c, ctx.controller, ctx, s.piercesProtection)
      );
  }

  const pool = targetPool(ctx, s);

  if (s.pick === 'chosen') {
    const want = s.count ?? 1;
    const picked: CardInstance[] = [];
    for (let i = 0; i < want; i++) {
      const uid = ctx.targets[ctx.cursor];
      if (!uid) break;
      const found = pool.find((c) => c.uid === uid);
      if (found) {
        picked.push(found);
        ctx.cursor += 1;
      } else {
        // The chosen card is gone or illegal — skip this slot without consuming
        // a different card's target.
        ctx.cursor += 1;
      }
    }
    /* Nobody supplied a target — a monster arriving by Special Summon fires its
       effect mid-resolution, where there is no moment to ask. The house answer
       everywhere else is "take the strongest", the same as `search` and
       `stealFromGrave`, so it is the answer here.

       Strongest *legal*, and that word is the whole bug. Protection was only
       applied on the way out, so the auto-pick reached for the biggest body on
       the board, and if that one happened to be untargetable the filter below
       threw it away and the effect did nothing at all — with a perfectly good
       target standing right beside it.

       Reported from a real duel: two Blue-Eyes brought out by the Flute against
       a Lord of D. and their own Blue-Eyes. Lord of D. makes their Dragons
       untargetable, so both of mine reached for the 3000 they could not touch
       and neither destroyed anything. Lord of D. himself is a Spellcaster and
       was legal the whole time. */
    /* Unless the card said "up to". Declining is a real answer there, and the
       fallback below would make it for you — Uraby would shatter your own
       backrow because it was the best thing on the board. */
    if (picked.length === 0 && !s.optional) {
      const legal = pool.filter((c) => !isProtectedTarget(state, c, ctx.controller, ctx, s.piercesProtection));
      if (legal.length) {
        picked.push(
          zone === 'monster'
            ? legal.reduce((a, b) => (effAtk(state, a) >= effAtk(state, b) ? a : b))
            : legal[0]
        );
      }
    }
    return picked.filter((c) => !isProtectedTarget(state, c, ctx.controller, ctx, s.piercesProtection));
  }

  if (s.pick === 'all') return pool.filter((c) => zone !== 'monster' || !isProtectedTarget(state, c, ctx.controller, ctx, s.piercesProtection));
  if (s.pick === 'random') {
    /* `count` random cards, not one — "return up to 10 random cards from your
       Graveyard" is a real sentence and this only ever took the first. Drawn
       without replacement, and short pools simply give what they have. */
    const legal = pool.filter((c) => !isProtectedTarget(state, c, ctx.controller, ctx, s.piercesProtection));
    const want = Math.min(s.count ?? 1, legal.length);
    const out: CardInstance[] = [];
    for (let i = 0; i < want; i++) out.push(...legal.splice(randInt(state, legal.length), 1));
    return out;
  }
  const legal = pool.filter((c) => !isProtectedTarget(state, c, ctx.controller, ctx, s.piercesProtection));
  if (!legal.length) return [];
  if (s.pick === 'strongest') return [legal.reduce((a, b) => (effAtk(state, a) >= effAtk(state, b) ? a : b))];
  return [legal.reduce((a, b) => (effAtk(state, a) <= effAtk(state, b) ? a : b))];
}

/** A Divine-Beast outranks every protection in the game — see `divineSource`. */
function isDivine(slug: string): boolean {
  return CARDS[slug]?.type === 'Divine-Beast';
}

/**
 * GOD CARDS ARE ABOVE EVERYTHING — the owner's decree, verbatim.
 *
 * A protection is a claim between mortals: "cannot be destroyed by battle",
 * "cannot be targeted", "immune to card effects" all hold against every card
 * in the game except a God. When the card acting — the attacker in a battle,
 * the source of an effect — is a Divine-Beast, every such claim is void:
 * Slifer's second mouth drains and destroys monsters no Spell could touch,
 * and no wall survives the blow of a God it cannot outfight. The reverse is
 * untouched: a God keeps its own immunities against everything beneath it.
 */
function divineSource(ctx?: EffectCtx): boolean {
  return !!ctx?.source && isDivine(ctx.source.slug);
}

/** "Untargetable" only protects against the opponent's effects — and never against a God's. */
function isProtectedTarget(state: DuelState, c: CardInstance, actor: PlayerId, ctx?: EffectCtx, pierces = false): boolean {
  if (ctx && divineSource(ctx)) return false;
  /* NO EFFECTS ON THE GODS. The decree in full: a Divine-Beast is reached by
     no card effect whatsoever — not targeted, not destroyed, not bounced, not
     banished, not negated, not stolen, not shrunk, not turned around. The only
     thing that removes one is a bigger body in battle.
     Checked *before* the `ctrl === actor` line, so it holds against your own
     Dark Hole as well as theirs. That line exists so a protection cannot stop
     its owner using their own card, and it was the hole this fell through:
     Dark Hole sweeps both fields, so the God on the sweeper's own side was
     never protected from it.
     The one exception is written where it belongs and not here:
     `returnBorrowedGods` takes a Special Summoned God back at the End Phase
     through `toGrave` directly, which is the rental clause and is deliberately
     not a destruction. */
  if (isDivine(c.slug)) return true;
  const ctrl = controllerOf(state, c.uid);
  if (ctrl === actor) return false;
  /* The God check above is deliberately not reachable from here: piercing is a
     mortal affair, and `isDivine` has already returned. */
  if (pierces) return false;
  return !!effFlags(state, c).untargetable;
}

function applyFlag(c: CardInstance, key: keyof CardFlags, value: boolean | number, duration: Duration) {
  const bag = duration === 'permanent' ? c.flags : c.turnFlags;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bag as any)[key] = value;
}

function addOngoing(state: DuelState, kind: OngoingEffect['kind'], target: PlayerId, turns: number, source: string) {
  const existing = state.ongoing.find((o) => o.kind === kind && o.target === target);
  if (existing) {
    existing.turns = Math.max(existing.turns, turns);
    return;
  }
  state.ongoing.push({ id: `o${state.ongoing.length}_${state.version}`, source, kind, target, turns });
}

function destroyCard(state: DuelState, c: CardInstance, byBattle: boolean, ctx?: EffectCtx) {
  const found = findOnField(state, c.uid);
  if (!found) return;
  const flags = effFlags(state, c, found.controller);
  /* Every battle call and every effect call hands this function a ctx whose
     `source` is the card responsible, so the decree is one check: a God's
     blow and a God's effect ignore the protection outright. */
  const divine = divineSource(ctx);
  /* A God dies to a bigger body and to nothing else. `isProtectedTarget` keeps
     every *targeting* effect off it, but a sweep that names no target — Dark
     Hole, Torrential Tribute, Raigeki — arrives straight here, and that is how
     Slifer was destroyed by a Dark Hole. Both doors, or the rule has a hole in
     it. Another God is still above this one. */
  if (!byBattle && isDivine(c.slug) && !divine) {
    log(state, `${displayName(state, c)} is a God — no card effect may destroy it.`, 'effect', found.controller, logSlug(c));
    return;
  }
  /* Paid for out of the stomach. Thousand-Eyes Restrict does not die while it
     is still holding something: the destruction takes what it swallowed
     instead, everything it had goes home to its owner's Graveyard, and the
     eye is left standing on its own printed 0/0 for the next one. Empty, it
     is an ordinary monster and dies like one — which is what makes it
     answerable rather than a wall.
     Before the protection checks below on purpose: this is not immunity, it
     is a price, and a God's blow collects it the same as anyone's. */
  if (flags.shedsAbsorbedInstead && c.absorbed.length) {
    const shed = c.absorbed;
    c.absorbed = [];
    for (const ab of shed) {
      landInGrave(state, newInstance(state, ab.slug, ab.owner), ab.owner);
    }
    log(
      state,
      `${displayName(state, c)} spits out ${shed.length} monster${shed.length > 1 ? 's' : ''} and holds its ground!`,
      'effect',
      found.controller,
      logSlug(c)
    );
    anim(state, { kind: 'note', uid: c.uid, slug: c.slug, player: found.controller });
    return;
  }
  /* Paid for rather than suffered, and paid from the Graveyard: while your
     pile still holds one of this card's own kind, being destroyed banishes one
     of them and the card stays where it is. Placed beside the shed above and
     for the same reason — this is a price, not an immunity, so a God's blow
     collects it too, and an empty pile means an ordinary death. */
  if (flags.paysWithGraveInstead) {
    const kin = card(c.slug).type;
    const pile = state.players[found.controller].grave;
    const at = pile.findIndex((g) => CARDS[g.slug]?.kind === 'monster' && CARDS[g.slug]?.type === kin);
    if (at >= 0) {
      const paid = pile.splice(at, 1)[0];
      log(state, `${displayName(state, c)} feeds on ${displayName(state, paid)} and will not fall.`,
        'effect', found.controller, logSlug(c));
      anim(state, { kind: 'note', uid: c.uid, slug: c.slug, player: found.controller });
      return;
    }
  }
  /* The reels again, and this time they are the card's life. Placed with the
     other prices rather than with the immunities: it can fail, and when it
     fails the monster dies like anything else. */
  if (flags.rollsToSurvive) {
    const dice = [1 + randInt(state, 6), 1 + randInt(state, 6), 1 + randInt(state, 6)];
    const made = makesSeven(dice);
    log(
      state,
      `${displayName(state, c)} spins to save itself: ${dice.join(' · ')} — ${made ? 'seven, and it holds!' : 'no seven.'}`,
      'effect',
      found.controller,
      logSlug(c)
    );
    anim(state, { kind: 'activate', uid: c.uid, slug: c.slug, player: found.controller, reports: true, text: `${dice.join(' ')} ${made ? '= 7' : '✗'}` });
    if (made) return;
  }
  if (byBattle && flags.indestructibleByBattle && !divine) {
    log(state, `${displayName(state, c)} cannot be destroyed by battle.`, 'effect', found.controller, logSlug(c));
    return;
  }
  if (!byBattle && flags.indestructibleByEffect && !divine) {
    log(state, `${displayName(state, c)} is immune to that effect.`, 'effect', found.controller, logSlug(c));
    return;
  }
  if (divine && (flags.indestructibleByBattle || flags.indestructibleByEffect || flags.untargetable)) {
    /* Its own beat, rather than riding on the destroy below. A beat carries one
       line, so two lines about the same card need two beats — and this one is
       the reason the next one happens. */
    log(state, `No protection stands before a God — ${displayName(state, c)} is swept aside.`, 'effect', found.controller, logSlug(c));
    anim(state, { kind: 'note', uid: c.uid, slug: c.slug, player: found.controller });
  }
  /* Logged before it is animated, which is the whole of the pairing rule: a
     beat claims the line the duel has just written. Reversed — as this site
     was — Dark Hole gave every destroyed monster the *previous* one's name
     beside its own picture, and the first beat got the last monster's name
     off `speakRemainingLog`. One monster on the board hid it completely,
     which is why it read as "sometimes". */
  log(state, `${displayName(state, c)} is destroyed.`, 'effect', found.controller, logSlug(c));
  anim(state, { kind: 'destroy', uid: c.uid, slug: c.slug, player: found.controller });
  // The card leaves the field *before* its own destruction effect resolves.
  // Otherwise it is still sitting in its Monster Zone, and an effect like
  // Anthrosaurus's — "when destroyed by battle, Special Summon a Dinosaur" —
  // finds the board full and quietly does nothing, even though the space it
  // just gave up is exactly where the replacement should go.
  // The one site in the game that is genuinely a destruction.
  toGrave(state, c.uid, true, true);
  if (byBattle && found.zone === 'monster') {
    fireTriggers(state, c, found.controller, 'onDestroyedByBattle', ctx?.trig ?? {});
  }
  queueDestroyWindow(state, found.controller);
}

/** Records that this player just lost a monster, so Michizure-style traps can respond. */
function queueDestroyWindow(state: DuelState, victim: PlayerId) {
  if (state.winner || state.pending) return;
  const opts = activatableTraps(state, victim, 'monsterDestroyed');
  if (opts.length) {
    state.pending = {
      kind: 'trap',
      player: victim,
      options: opts.map((c) => c.uid),
      reason: 'A monster you control was destroyed.',
      context: {},
    };
  }
}

function runOps(ctx: EffectCtx, ops: Op[]) {
  const { state } = ctx;
  for (const op of ops) {
    if (state.winner) return;
    switch (op.op) {
      case 'damage': {
        let amount = op.amount ?? 0;
        if (op.scale === 'perDestroyed') amount = (op.amount ?? 0) * (ctx.destroyedCount ?? 0);
        else if (op.scale === 'targetAtk' || op.scale === 'halfTargetAtk') {
          const peek = ctx.targets[ctx.cursor];
          const t =
            (peek && findOnField(state, peek)?.c) ||
            (ctx.trig.attackerUid ? findOnField(state, ctx.trig.attackerUid)?.c : null);
          /* A monster that cannot be targeted cannot be the source of this
             number either. Ring of Destruction is "destroy it *and* inflict
             damage equal to its ATK": pointed at Celtic Guardian, which cannot
             be targeted at all, the destroy was correctly refused and the
             damage went through anyway — 1400 Life Points off an untargetable
             monster, for free, every turn. One card, one effect. */
          const v = t && !isProtectedTarget(state, t, ctx.controller, ctx) ? effAtk(state, t) : 0;
          amount = op.scale === 'halfTargetAtk' ? Math.floor(v / 2) : v;
        } else if (op.scale === 'selfAtk') {
          amount = effAtk(state, ctx.source, ctx.controller);
        } else if (op.scale === 'tributedAtk') {
          amount = (ctx.tributedAtk ?? []).reduce((a, b) => a + b, 0);
        } else if (op.scale === 'destroyedAtk') {
          /* What this same effect actually killed, read off the board while it
             was still standing. Cannon Soldier fires the monster it destroyed
             for exactly its ATK — and a monster that survived the attempt was
             never fired, so it bills nothing. */
          amount = ctx.destroyedAtk ?? 0;
        } else if (op.scale === 'perOppMonster') {
          const n = state.players[other(ctx.controller)].monsters.filter(Boolean).length;
          amount = (op.amount ?? 0) * n;
        }
        for (const pid of sideToPlayers(ctx, op.to)) dealDamage(state, pid, amount);
        break;
      }
      case 'heal':
        for (const pid of sideToPlayers(ctx, op.to)) healPlayer(state, pid, op.amount);
        break;
      case 'gainAtk': {
        let amount = op.amount ?? 0;
        /* A filter narrows what the pile counts. Sword Arm of Dragon is worth
           150 for each of two named cards down there, not for the pile. */
        const pile = (cards: CardInstance[]) => (op.filter ? cards.filter((c) => matchesFilter(c, op.filter)) : cards).length;
        if (op.scale === 'perCardInGrave') amount = (op.amount ?? 0) * pile(state.players[ctx.controller].grave);
        else if (op.scale === 'perCardInEitherGrave') {
          amount = (op.amount ?? 0) * (pile(state.players.p1.grave) + pile(state.players.p2.grave));
        }
        else if (op.scale === 'perMonsterOnField') amount = 300 * state.players[ctx.controller].monsters.filter(Boolean).length;
        else if (op.scale === 'perCardInEitherHand') {
          amount = (op.amount ?? 0) * (state.players.p1.hand.length + state.players.p2.hand.length);
        }
        /* Multiplies whatever the op already carries, so the card writes its
           own rate: Garoozis says 100 per pip and a 4 is 400, in one beat. No
           roll in this effect means no gain rather than a silent full amount. */
        else if (op.scale === 'dicePips') amount = (op.amount ?? 0) * (ctx.lastRoll ?? 0);
        else if (op.scale === 'targetAtk') {
          const t = ctx.trig.targetUid ? findOnField(state, ctx.trig.targetUid)?.c : null;
          amount = t ? effAtk(state, t) : 0;
        }
        for (const t of resolveTargets(ctx, op.target)) {
          if (op.duration === 'permanent') t.atkMod += amount;
          else t.turnAtkMod += amount;
          if (amount !== 0) {
            log(state, `${displayName(state, t)} ${amount > 0 ? 'gains' : 'loses'} ${Math.abs(amount)} ATK.`, 'effect', undefined, logSlug(t));
          }
        }
        break;
      }
      case 'gainDef': {
        let amount = op.amount;
        if (op.scale === 'perCardInGrave') amount = op.amount * state.players[ctx.controller].grave.length;
        else if (op.scale === 'perCardInEitherGrave') {
          amount = op.amount * (state.players.p1.grave.length + state.players.p2.grave.length);
        }
        for (const t of resolveTargets(ctx, op.target)) {
          if (op.duration === 'permanent') t.defMod += amount;
          else t.turnDefMod += amount;
        }
        break;
      }
      case 'setAtk':
        for (const t of resolveTargets(ctx, op.target)) t.atkMod = op.value - baseAtk(t.slug);
        break;
      case 'halveAtk':
        for (const t of resolveTargets(ctx, op.target)) {
          const cur = effAtk(state, t);
          t.atkMod -= Math.floor(cur / 2);
          log(state, `${displayName(state, t)}'s ATK is halved.`, 'effect', undefined, logSlug(t));
        }
        break;
      case 'swapAtkDef':
        for (const t of resolveTargets(ctx, op.target)) {
          const a = effAtk(state, t);
          const d = effDef(state, t);
          t.turnAtkMod += d - a;
          t.turnDefMod += a - d;
        }
        break;
      case 'destroy':
        for (const t of resolveTargets(ctx, op.target)) {
          /* Counted from the board, not from the list: `destroyCard` refuses a
             God and anything else standing beyond reach, and a card that
             survived must not be charged for by a `perDestroyed` damage. */
          const before = findOnField(state, t.uid);
          /* And what it was worth, read while it is still standing — Cannon
             Soldier fires its own monster at them for exactly its ATK, and a
             card in the Graveyard has no effective stats left to read. */
          const worth = before ? effAtk(state, t, before.controller) : 0;
          destroyCard(state, t, false, ctx);
          if (before && !findOnField(state, t.uid)) {
            ctx.destroyedCount = (ctx.destroyedCount ?? 0) + 1;
            ctx.destroyedAtk = (ctx.destroyedAtk ?? 0) + worth;
          }
        }
        break;
      case 'sendToGrave':
        /* Not a destruction. `onSentToGrave` fires and `onDestroyed` does not,
           which is the difference between a moth moulting and a moth dying. */
        for (const t of resolveTargets(ctx, op.target)) {
          const where = findOnField(state, t.uid);
          if (where) toGrave(state, t.uid, true, false);
        }
        break;
      case 'byCounters': {
        /* Highest tier the source has actually reached — read off the ctx when
           the card paid for this with its own body, because by then the pile
           has blanked it. */
        const have = ctx.counters ?? ctx.source.counters;
        const tier = [...op.tiers].sort((a, b) => b.at - a.at).find((t) => have >= t.at);
        if (tier) runOps(ctx, tier.ops);
        break;
      }
      case 'paysWithGraveInstead':
        applyFlag(ctx.source, 'paysWithGraveInstead', true, op.duration);
        break;
      case 'banish':
        for (const t of resolveTargets(ctx, op.target)) {
          const owner = t.owner;
          releaseEquips(state, t);
          const removed = removeFromAnywhere(state, t.uid);
          if (removed && !removed.isToken) {
            resetInstance(removed);
            state.players[owner].banished.push(removed);
            log(state, `${displayName(state, removed)} is banished.`, 'effect', undefined, logSlug(removed));
          }
        }
        break;
      case 'bounce':
        for (const t of resolveTargets(ctx, op.target)) {
          const owner = t.owner;
          releaseEquips(state, t);
          const removed = removeFromAnywhere(state, t.uid);
          if (removed && !removed.isToken) {
            resetInstance(removed);
            state.players[owner].hand.push(removed);
            log(state, `${displayName(state, removed)} returns to the hand.`, 'effect', undefined, logSlug(removed));
          }
        }
        checkExodia(state);
        break;
      case 'takeControl': {
        for (const t of resolveTargets(ctx, op.target)) {
          const from = controllerOf(state, t.uid);
          if (!from || from === ctx.controller) continue;
          const dest = state.players[ctx.controller].monsters.findIndex((m) => !m);
          if (dest < 0) continue;
          removeFromAnywhere(state, t.uid);
          t.position = 'atk';
          t.face = 'up';
          t.attacksUsed = 0;
          t.attacked = [];
          /* One turn is the default and the old behaviour; Dragon Piper asks
             for two, so the borrowing outlives the turn it was taken on. */
          if (op.duration !== 'permanent') t.controlRevertsOnTurn = state.turn + ((op.turns ?? 1) - 1);
          state.players[ctx.controller].monsters[dest] = t;
          log(state, `${state.players[ctx.controller].name} takes control of ${displayName(state, t)}!`, 'effect', ctx.controller, logSlug(t));
        }
        break;
      }
      case 'draw':
        /* One line and one beat for the whole draw, the same way `drawTo` does
           it. A single card keeps the sentence it has always had; more than one
           is announced by its total. Manga Ryu-Ran deals four and the owner
           read "draws a card" four times over while the duel stood still —
           which is the report that fixed Card of Sanctity, arriving again on
           the op next door.

           Counted from what actually arrived, not from `op.count`: a Deck with
           fewer cards left than the effect asks for gives out what it has, and
           the announcement has to match the cards. */
        for (const pid of sideToPlayers(ctx, op.who)) {
          const before = state.players[pid].hand.length;
          for (let i = 0; i < op.count; i++) if (!drawCard(state, pid, op.count > 1)) break;
          const drawn = state.players[pid].hand.length - before;
          if (op.count > 1 && drawn > 0) {
            log(state, `${state.players[pid].name} draws ${drawn} card${drawn === 1 ? '' : 's'}.`, 'normal', pid);
            anim(state, { kind: 'draw', player: pid, amount: drawn });
          }
        }
        checkExodia(state);
        break;
      case 'discard':
        for (const pid of sideToPlayers(ctx, op.who)) {
          const p = state.players[pid];
          /* A wide board pays for its own width — Tribute to the Doomed takes a
             card for each monster the discarding player is standing behind. */
          const want =
            op.scale === 'perTheirMonster' ? op.count * p.monsters.filter((m) => !!m).length : op.count;
          /* A filter narrows what may be taken. Blast Sphere reaches into the
             hand for Spells and Traps alone — removal that happens to land
             somewhere private, rather than a random discard. */
          const eligible = () => p.hand.map((h, i) => [h, i] as const).filter(([h]) => matchesFilter(h, op.filter));
          const pool = eligible();
          const n = op.all ? pool.length : Math.min(want, pool.length);
          for (let i = 0; i < n; i++) {
            const live = eligible();
            if (!live.length) break;
            const pickAt = live[randInt(state, live.length)][1];
            const c = p.hand.splice(pickAt, 1)[0];
            landInGrave(state, c, pid);
            /* Log, then animate — so the beat that shows the card carries the
               line about *that* card. Without a beat of its own the line was
               adopted by whatever was already on screen, which is why a
               discarded card looked like it had simply vanished. */
            log(state, `${p.name} discards ${displayName(state, c)}.`, 'effect', pid, logSlug(c));
            anim(state, { kind: 'discard', uid: c.uid, slug: c.slug, player: pid });
          }
        }
        break;
      case 'mill':
        for (const pid of sideToPlayers(ctx, op.who)) {
          const p = state.players[pid];
          for (let i = 0; i < op.count; i++) {
            const c = p.deck.shift();
            if (!c) break;
            landInGrave(state, c, pid);
          }
          log(state, `${p.name} sends ${op.count} cards from the top of their Deck to the Graveyard.`, 'effect', pid);
        }
        break;
      case 'millUntilSummon': {
        /* Dig, burying as you go, and stop on the first monster the filter
           accepts — that one lands instead of being buried. A dig that finds
           nothing has emptied the Deck into the Graveyard, which is a real
           cost and is said out loud rather than passed over in silence. */
        const p = state.players[ctx.controller];
        const buried: CardInstance[] = [];
        let found: CardInstance | null = null;
        while (p.deck.length) {
          const c = p.deck.shift()!;
          if (CARDS[c.slug]?.kind === 'monster' && matchesFilter(c, op.filter)) {
            found = c;
            break;
          }
          landInGrave(state, c, ctx.controller);
          buried.push(c);
        }
        if (buried.length) {
          /* With the digger's own face beside it. A line with no card to attach
             to gets a beat of its own and is printed over empty space — see
             `speakRemainingLog`, and `npm run banner`, which caught this one. */
          log(
            state,
            `${p.name} digs ${buried.length} card${buried.length === 1 ? '' : 's'} deep into their Deck.`,
            'effect',
            ctx.controller,
            logSlug(ctx.source)
          );
        }
        const zone = p.monsters.findIndex((m) => !m);
        if (!found) {
          emptyHanded(state, ctx, `${displayName(state, ctx.source)} digs to the bottom and finds nothing to Summon.`);
          break;
        }
        if (zone < 0) {
          /* Nothing to put it in. It is already out of the Deck, so it goes
             where everything else it dug past went rather than vanishing. */
          landInGrave(state, found, ctx.controller);
          emptyHanded(state, ctx, `${displayName(state, found)} is dug up with no room to stand, and is buried with the rest.`);
          break;
        }
        /* `found` came off the top with `shift`, so it is already out of the
           Deck — splicing for it again found nothing and took the bottom card
           instead, quietly eating one more than the dig was worth. */
        landSpecialSummon(state, found, ctx.controller, zone, op.position ?? 'atk', 'up');
        ctx.summoned = [...(ctx.summoned ?? []), found.uid];
        fireTriggers(state, found, ctx.controller, 'onSummon', {});
        if (!state.winner) {
          fireOpponentSummon(state, ctx.controller, found.uid);
          fireAllySummon(state, ctx.controller, found.uid);
        }
        break;
      }
      case 'drawUntil': {
        /* "Draw until you draw a monster." One card off a healthy deck, a
           fistful off one clogged with Spells — and the whole Deck if it holds
           no monster at all, which the deck-out rules then settle. */
        for (const pid of sideToPlayers(ctx, op.who)) {
          const p = state.players[pid];
          let drawn = 0;
          while (p.deck.length) {
            const c = p.deck.shift()!;
            p.hand.push(c);
            drawn += 1;
            if (matchesFilter(c, op.filter)) break;
          }
          if (drawn) {
            log(state, `${p.name} draws ${drawn} card${drawn === 1 ? '' : 's'}.`, 'effect', pid);
            anim(state, { kind: 'draw', player: pid, amount: drawn });
          }
        }
        break;
      }
      case 'reviveSelfNextTurn': {
        /* Owed back at the start of its controller's next turn. Two turns on
           the clock, not one: it is decremented at the end of every affected
           player's turn, and this is written during the *opponent's* battle,
           so one turn would expire before its owner ever came round. */
        state.ongoing.push({
          id: `revive-${ctx.source.uid}`,
          source: ctx.source.slug,
          kind: 'pendingRevival',
          target: ctx.controller,
          turns: 2,
          atkBonus: op.atk ?? 0,
          defBonus: op.def ?? 0,
        });
        log(state, `${displayName(state, ctx.source)} will claw its way back.`, 'effect', ctx.controller, logSlug(ctx.source));
        break;
      }
      case 'summonSelf': {
        /* The card calls itself out of wherever it is waiting. `handSummon` and
           `onAllySummon` both fire on a card nowhere near the board, so neither
           can use the ordinary summon that reaches into a zone and picks. */
        const p = state.players[ctx.controller];
        const zone = p.monsters.findIndex((m) => !m);
        if (zone < 0) {
          emptyHanded(state, ctx, `${displayName(state, ctx.source)} has no room to arrive.`);
          break;
        }
        landSpecialSummon(state, ctx.source, ctx.controller, zone, op.position ?? 'atk', op.face ?? 'up');
        ctx.summoned = [...(ctx.summoned ?? []), ctx.source.uid];
        if (ctx.source.face === 'up') {
          fireTriggers(state, ctx.source, ctx.controller, 'onSummon', {}, ctx.targets.slice(ctx.cursor));
          if (!state.winner) {
            fireOpponentSummon(state, ctx.controller, ctx.source.uid);
            fireAllySummon(state, ctx.controller, ctx.source.uid);
          }
        }
        break;
      }
      case 'attackCostDiscard':
        applyFlag(ctx.source, 'attackCostDiscard', true, op.duration);
        break;
      case 'search': {
        const p = state.players[ctx.controller];
        const count = op.count ?? 1;
        let found = 0;
        for (let i = 0; i < count; i++) {
          /* An explicit choice wins — a card the player activates asks them
             which one they want. The cards that search from the Graveyard fire
             mid-resolution, where there is nobody to ask, so they take the
             strongest legal card instead of whatever happened to be shuffled
             nearest the top. Deck order was invisible and meaningless. */
          const wanted = ctx.targets[ctx.cursor];
          let idx = -1;
          if (wanted) {
            idx = p.deck.findIndex((c) => c.uid === wanted && matchesFilter(c, op.filter));
            if (idx >= 0) ctx.cursor += 1;
          }
          if (idx < 0) {
            /* A filter that names its cards is a preference order, and the
               card's own text is where it is written: Viser Des says "add Ra,
               Bowganian, Nightmare Wheel or Coffin Seller", and it means them
               in that order. Ranking by ATK instead was not merely arbitrary
               here, it was backwards — a God's printed stats are "?", which
               the card database gives as -1, so the headline card of the
               whole deck sorted *below* two Traps on 0 and could effectively
               never be fetched. Reported as "a random chance for which
               monster it gives you". */
            const named = op.filter?.slugs;
            if (named?.length) {
              for (const slug of named) {
                const at = p.deck.findIndex((c) => c.slug === slug && matchesFilter(c, op.filter));
                if (at >= 0) {
                  idx = at;
                  break;
                }
              }
            }
            if (idx < 0) {
              /* No named order to follow: take the strongest, which is what a
                 player would have said if there had been anyone to ask. */
              let best = -1;
              for (let k = 0; k < p.deck.length; k++) {
                if (!matchesFilter(p.deck[k], op.filter)) continue;
                if (best < 0 || (CARDS[p.deck[k].slug]?.atk ?? 0) > (CARDS[p.deck[best].slug]?.atk ?? 0)) best = k;
              }
              idx = best;
            }
          }
          if (idx < 0) {
            /* The Deck came up empty. `orGrave` sends the same lookup to the
               controller's own Graveyard rather than giving up — the Deck is
               always asked first, so a card that is in both places is taken
               from the Deck and the Graveyard copy stays buried.
               Named order applies here too, then the strongest, which is how
               `stealFromGrave` picks with nobody to ask. */
            if (!op.orGrave) break;
            let gi = -1;
            const named2 = op.filter?.slugs;
            if (named2?.length) {
              for (const slug of named2) {
                const at = p.grave.findIndex((c) => c.slug === slug && matchesFilter(c, op.filter));
                if (at >= 0) {
                  gi = at;
                  break;
                }
              }
            }
            if (gi < 0) {
              for (let k = 0; k < p.grave.length; k++) {
                if (!matchesFilter(p.grave[k], op.filter)) continue;
                if (gi < 0 || (CARDS[p.grave[k].slug]?.atk ?? 0) > (CARDS[p.grave[gi].slug]?.atk ?? 0)) gi = k;
              }
            }
            if (gi < 0) break;
            const g = p.grave.splice(gi, 1)[0];
            p.hand.push(g);
            found += 1;
            log(state, `${p.name} takes ${displayName(state, g)} from the Graveyard.`, 'effect', ctx.controller, logSlug(g));
            continue;
          }
          const c = p.deck.splice(idx, 1)[0];
          p.hand.push(c);
          found += 1;
          log(state, `${p.name} adds ${displayName(state, c)} from their Deck to their hand.`, 'effect', ctx.controller, logSlug(c));
        }
        if (!found) emptyHanded(state, ctx, `${displayName(state, ctx.source)} finds nothing to add.`);
        shuffle(state, p.deck);
        checkExodia(state);
        break;
      }
      case 'specialSummon': {
        const count = op.count ?? 1;
        let arrived = 0;
        /* Why nothing arrived, when nothing arrives. A full board and an empty
           pool are different disappointments and the player can act on the
           difference. */
        let blocked: 'zones' | 'pool' | null = null;
        for (let i = 0; i < count; i++) {
          const zone = state.players[ctx.controller].monsters.findIndex((m) => !m);
          if (zone < 0) {
            blocked ??= 'zones';
            break;
          }
          const sources: PlayerId[] = op.side === 'both' ? [ctx.controller, other(ctx.controller)] : [ctx.controller];
          const zones = Array.isArray(op.from) ? op.from : [op.from];
          const from = (pid: PlayerId) => zones.flatMap((z) => zoneCards(state, pid, z));
          let picked: CardInstance | null = null;
          // Prefer an explicit choice from the activating player.
          const chosenUid = ctx.targets[ctx.cursor];
          for (const pid of sources) {
            const pool = from(pid);
            const byChoice = chosenUid ? pool.find((c) => c.uid === chosenUid) : null;
            if (
              byChoice &&
              matchesFilter(byChoice, op.filter) &&
              CARDS[byChoice.slug]?.kind === 'monster' &&
              revivable(state, ctx.controller, byChoice.slug, ctx.source.slug)
            ) {
              picked = byChoice;
              ctx.cursor += 1;
              break;
            }
          }
          if (!picked) {
            for (const pid of sources) {
              const pool = from(pid).filter(
                (c) =>
                  CARDS[c.slug]?.kind === 'monster' &&
                  revivable(state, ctx.controller, c.slug, ctx.source.slug) &&
                  matchesFilter(c, op.filter) &&
                  // A card never Special Summons itself with its own "when this
                  // card is destroyed" effect — it is in the Graveyard by the
                  // time that resolves, and reviving itself is not the intent.
                  // Unless it says so: Revival Jam opts in by name.
                  (op.includeSelf || c.uid !== ctx.source.uid)
              );
              if (pool.length) {
                picked =
                  op.pick === 'weakest'
                    ? pool.reduce((a, b) => (baseAtk(a.slug) <= baseAtk(b.slug) ? a : b))
                    : pool.reduce((a, b) => (baseAtk(a.slug) >= baseAtk(b.slug) ? a : b));
                break;
              }
            }
          }
          if (!picked) {
            blocked ??= 'pool';
            break;
          }
          landSpecialSummon(state, picked, ctx.controller, zone, op.position ?? 'atk', op.face ?? 'up');
          arrived += 1;
          ctx.summoned = [...(ctx.summoned ?? []), picked.uid];
          /* The targets the activating player named and nothing has claimed
             yet. Black Illusion Ritual asks for a Tribute and then summons
             Relinquished, whose own arrival asks what to swallow — and that
             second choice had nowhere to travel, so the engine fell back to
             "the strongest" and the player's pick was ignored. `fireTriggers`
             has always taken a target list; the summon simply never passed
             one. */
          if (picked.face === 'up') {
            fireTriggers(state, picked, ctx.controller, 'onSummon', {}, ctx.targets.slice(ctx.cursor));
          }
          /* A Special Summon is a Summon, and Slifer's second mouth was only
             ever told about Normal and Fusion Summons — so a Monster Reborn'd
             Blue-Eyes, a revived anything, a searched-out Magnet Warrior, all
             walked past the God untouched. That is most of the summons in this
             game, and the card's signature quietly did nothing about them.

             Only the *monster* trigger fires here, never a trap window: making
             Special Summons open `opponentSummon` would hand Torrential Tribute
             to the whole roster, which is a different change than this one. */
          if (!state.winner && picked.face === 'up') {
            fireOpponentSummon(state, ctx.controller, picked.uid);
            fireAllySummon(state, ctx.controller, picked.uid);
          }
        }
        if (!arrived && blocked) {
          emptyHanded(
            state,
            ctx,
            blocked === 'zones'
              ? `${state.players[ctx.controller].name} has no room to Special Summon.`
              : `${displayName(state, ctx.source)} finds nothing to Special Summon.`
          );
        }
        break;
      }
      case 'summonToken': {
        let made = 0;
        for (let i = 0; i < op.count; i++) {
          const zone = state.players[ctx.controller].monsters.findIndex((m) => !m);
          if (zone < 0) break;
          const t = newInstance(state, op.artSlug ?? ctx.source.slug, ctx.controller);
          t.isToken = true;
          t.tokenName = op.name;
          t.tokenAtk = op.atk;
          t.tokenDef = op.def;
          t.tokenDeathDamage = op.deathDamage;
          t.position = op.position ?? 'def';
          t.summonedOnTurn = state.turn;
          state.players[ctx.controller].monsters[zone] = t;
          made += 1;
          /* `as` because the Token's art comes from the card that made it and
             its name does not. Without it the board announced "Mihail summons
             Kuriboh" for the Token as well as for Kuriboh itself, so a second
             body appeared with the first one's line and nothing said what it
             was. */
          anim(state, { kind: 'summon', uid: t.uid, slug: t.slug, as: op.name, player: ctx.controller });
          // A Token is a monster being Summoned, so the second mouth sees it
          // too. Anything else would be a carve-out the card's text does not
          // have, and three 300 ATK bodies are exactly what a God is for.
          if (!state.winner) {
            fireOpponentSummon(state, ctx.controller, t.uid);
            fireAllySummon(state, ctx.controller, t.uid);
          }
        }
        /* What actually landed, not what was asked for. The loop breaks when
           the board is full, and this line sat outside it reading `op.count` —
           so a three-zone board already holding two monsters announced
           "Special Summons 2 Swamp Serpents" having summoned one, or none.
           The board must never say a thing happened that did not. */
        if (made > 0) {
          /* "a Apophis Serpent" was the only Token on the roster that needed the
             other article, and it read as a typo every time it landed. */
          const article = /^[aeiou]/i.test(op.name) ? 'an' : 'a';
          log(
            state,
            made === 1
              ? `${state.players[ctx.controller].name} Special Summons ${article} ${op.name}.`
              : `${state.players[ctx.controller].name} Special Summons ${made} ${op.name}s.`,
            'summon',
            ctx.controller,
            /* The Token's borrowed art. Safe here for the reason `logSlug` gives:
               the line names the Token itself, so the picture beside it is a
               likeness and never a claim about which card this is. */
            op.artSlug ?? ctx.source.slug
          );
        }
        break;
      }
      case 'transformInto': {
        const found = findOnField(state, ctx.source.uid);
        if (!found) break;
        const old = displayName(state, ctx.source);
        ctx.source.slug = op.slug;
        ctx.source.counters = 0;
        log(state, `${old} evolves into ${card(op.slug).name}!`, 'summon', ctx.controller);
        anim(state, { kind: 'fusion', uid: ctx.source.uid, slug: op.slug, player: ctx.controller });
        fireTriggers(state, ctx.source, ctx.controller, 'onSummon', {});
        break;
      }
      case 'addCounter': {
        /* A ceiling, where the card has one: the Cocoon thickens to four and
           stops, because past the top rung there is nothing further to hatch
           into. Nothing is announced once it is full — a line every turn
           saying a counter was gained, on a card that gained none, is worse
           than silence. */
        const was = ctx.source.counters;
        ctx.source.counters = op.max != null ? Math.min(op.max, was + op.amount) : was + op.amount;
        if (ctx.source.counters !== was) {
          log(state, `${displayName(state, ctx.source)} gains an Evolution Counter (${ctx.source.counters}).`, 'effect', ctx.controller, logSlug(ctx.source));
        }
        break;
      }
      case 'negateAttack': {
        /* A God's blow cannot be refused. "They can attack over swords over
           cage over everything — NO EFFECTS ON THE GODS": stopping the swing
           is a card effect reaching a God like any other, and it was the last
           door left open. Mirror Force, Negate Attack and Mirror Wall could
           all wave Ra away, which made the God's whole turn worthless and —
           worse — the computer could *see* that coming, so it declined to
           press God Phoenix or to attack at all and simply passed with lethal
           on the board. Reported from a real duel as "he won't use Ra's
           effect, nor attack, when clearly he has game if he does both".
           They may still be played, and every other rider on them still
           lands; they just cannot turn a God back. */
        const attacker = findOnField(state, ctx.trig?.attackerUid ?? '');
        if (attacker && isDivine(attacker.c.slug)) {
          log(state, `Nothing turns a God aside — ${displayName(state, attacker.c)} attacks on.`, 'effect');
          break;
        }
        ctx.attackNegated = true;
        log(state, 'The attack is negated!', 'effect');
        break;
      }
      case 'endBattlePhase':
        ctx.battlePhaseEnded = true;
        break;
      case 'extraAttacks': {
        /* Parrot Dragon's "it may attack once more this turn" was applied
           permanently — every kill added an attack per turn for the rest of
           the duel, stacking without limit. The op carries its duration now,
           and a turn-scoped grant accumulates in turnFlags, which the end of
           turn already wipes. */
        const dur = op.duration ?? 'permanent';
        const store = dur === 'turn' ? ctx.source.turnFlags : ctx.source.flags;
        applyFlag(ctx.source, 'extraAttacks', (store.extraAttacks ?? 0) + op.count, dur);
        break;
      }
      case 'attackAllMonsters':
        applyFlag(ctx.source, 'attackAll', true, 'permanent');
        break;
      case 'directAttack':
        applyFlag(ctx.source, 'directAttack', true, op.duration);
        break;
      case 'reflectBattleDamage':
        applyFlag(ctx.source, 'reflectBattleDamage', true, op.duration);
        break;
      case 'halvedBattleDamage':
        applyFlag(ctx.source, 'halvedBattleDamage', true, op.duration);
        break;
      case 'halvedDirectDamage':
        applyFlag(ctx.source, 'halvedDirectDamage', true, op.duration);
        break;
      case 'pierce':
        applyFlag(ctx.source, 'pierce', true, op.duration);
        break;
      case 'doublesWhenAttacking':
        applyFlag(ctx.source, 'doublesWhenAttacking', true, op.duration);
        break;
      case 'bonusVsDefense':
        applyFlag(ctx.source, 'bonusVsDefense', op.amount, op.duration);
        break;
      case 'halvesAttacker':
        applyFlag(ctx.source, 'halvesAttacker', true, op.duration);
        break;
      case 'preventBattleDestruction':
        for (const pid of sideToPlayers(ctx, op.who)) {
          addOngoing(state, 'preventBattleDestruction', pid, op.duration === 'permanent' ? 99 : 1, ctx.source.slug);
        }
        break;
      case 'indestructibleByBattle':
        applyFlag(ctx.source, 'indestructibleByBattle', true, op.duration);
        break;
      case 'indestructibleByEffect':
        applyFlag(ctx.source, 'indestructibleByEffect', true, op.duration);
        break;
      case 'untargetable':
        applyFlag(ctx.source, 'untargetable', true, op.duration);
        break;
      case 'preventBattleDamage':
        for (const pid of sideToPlayers(ctx, op.who)) {
          addOngoing(state, 'preventBattleDamage', pid, op.duration === 'permanent' ? 99 : 1, ctx.source.slug);
          log(state, `${state.players[pid].name} is shielded from battle damage.`, 'effect', pid);
        }
        break;
      case 'skipDraw':
        for (const pid of sideToPlayers(ctx, op.who)) addOngoing(state, 'skipDraw', pid, op.turns, ctx.source.slug);
        break;
      case 'skipBattlePhase':
        for (const pid of sideToPlayers(ctx, op.who)) addOngoing(state, 'skipBattlePhase', pid, op.turns, ctx.source.slug);
        break;
      case 'freezeMonsters':
        for (const pid of sideToPlayers(ctx, op.who)) {
          addOngoing(state, 'freezeMonsters', pid, op.turns, ctx.source.slug);
          log(state, `${state.players[pid].name}'s monsters are locked down.`, 'effect', pid);
        }
        break;
      case 'negateEffects':
        for (const t of resolveTargets(ctx, op.target)) {
          t.flags.negated = true;
          log(state, `${displayName(state, t)}'s effects are negated.`, 'effect', undefined, logSlug(t));
        }
        break;
      case 'absorb':
        for (const t of resolveTargets(ctx, op.target)) {
          const removed = removeFromAnywhere(state, t.uid);
          if (!removed || removed.isToken) continue;
          ctx.source.absorbed.push({ slug: removed.slug, owner: removed.owner });
          log(state, `${displayName(state, ctx.source)} absorbs ${displayName(state, removed)}!`, 'effect', ctx.controller, logSlug(ctx.source));
        }
        break;
      case 'equipTo': {
        const targets = resolveTargets(ctx, { side: 'own', pick: 'chosen' });
        /* A selector wins over the prompt: Spellbinding Circle attaches itself
           to the monster that declared the attack, which nobody picks. */
        const t = op.target
          ? resolveTargets(ctx, op.target)[0]
          : (targets[0] ?? state.players[ctx.controller].monsters.find((m): m is CardInstance => !!m));
        if (!t) {
          log(state, 'There is no monster to equip.', 'effect', ctx.controller);
          break;
        }
        /* What it fits. 7 Completed bolts onto a Machine and nothing else, so
           an equip pointed at a Spellcaster says so rather than attaching
           anyway. Asked of the host once it is resolved — asking beforehand
           would have called `resolveTargets` twice and walked the answer
           cursor past the card the player actually named. */
        if (op.filter && !matchesFilter(t, op.filter)) {
          emptyHanded(state, ctx, `${displayName(state, ctx.source)} does not fit ${displayName(state, t)}.`);
          break;
        }
        // Only the attachment is recorded; the stat bonus and the granted flags
        // are read back out as an aura for as long as the equip is on the
        // field. Nothing is written into the monster, so when this card is
        // destroyed the monster goes straight back to its printed values.
        ctx.source.equippedTo = t.uid;
        t.equips.push(ctx.source.slug);
        // Signed, because an equip can be a penalty: Spellbinding Circle takes
        // 700 off, and "(+-700 ATK)" is not a sentence.
        log(
          state,
          `${displayName(state, t)} is equipped with ${card(ctx.source.slug).name} (${op.atk < 0 ? '' : '+'}${op.atk} ATK).`,
          'effect',
          ctx.controller,
          /* The Equip Spell, not the monster: the line is about the card that
             just arrived on it, and that is the face worth showing. */
          logSlug(ctx.source)
        );
        break;
      }
      case 'drawTo':
        /* One line and one beat for the whole refill, not one per card. Card of
           Sanctity fills both hands to six, which is five or six separate
           "draws a card" banners each — the owner reported reading the same
           sentence over and over while the duel stood still. `drawCard` is told
           to stay quiet and the total is announced once.

           Counted from what actually arrived rather than from the arithmetic:
           a Deck with fewer cards left than the gap gives out what it has, and
           the announcement has to match the cards. */
        for (const who of sideToPlayers(ctx, op.who)) {
          const before = state.players[who].hand.length;
          for (let i = before; i < op.count; i++) if (!drawCard(state, who, true)) break;
          const drawn = state.players[who].hand.length - before;
          if (drawn > 0) {
            log(state, `${state.players[who].name} draws ${drawn} card${drawn === 1 ? '' : 's'}.`, 'normal', who);
            anim(state, { kind: 'draw', player: who, amount: drawn });
          }
        }
        break;
      case 'revealHand':
        break;
      case 'shuffleIntoDeck':
        for (const t of resolveTargets(ctx, op.target)) {
          const owner = t.owner;
          releaseEquips(state, t);
          const removed = removeFromAnywhere(state, t.uid);
          if (removed && !removed.isToken) {
            resetInstance(removed);
            state.players[owner].deck.push(removed);
            shuffle(state, state.players[owner].deck);
          }
        }
        break;
      case 'stealFromGrave': {
        /* The best card in the Graveyard rather than whichever happens to lie
           nearest the top: a flip effect resolves in the middle of someone
           else's attack, so there is no moment to ask the player which, and
           taking the strongest is the answer they would have given.

           Which Graveyard is the card's own business. "From either Graveyard"
           starts with your own — the report was exactly this, "Magician of
           Faith gave me back the enemy spell card", and getting your own
           Monster Reborn back is what the card is for. Graverobber says "from
           your opponent's Graveyard" and means only that. */
        const own = state.players[ctx.controller].grave;
        const theirs = state.players[other(ctx.controller)].grave;
        const pools = op.from === 'opp' ? [theirs] : op.from === 'own' ? [own] : [own, theirs];
        let pool: CardInstance[] | null = null;
        let i2 = -1;
        for (const g of pools) {
          const chosen = ctx.targets[ctx.cursor];
          const byChoice = chosen ? g.findIndex((c) => c.uid === chosen && matchesFilter(c, op.filter)) : -1;
          if (byChoice >= 0) {
            pool = g;
            i2 = byChoice;
            ctx.cursor += 1;
            break;
          }
          const matches = g.map((c, i) => ({ c, i })).filter(({ c }) => matchesFilter(c, op.filter));
          if (matches.length) {
            pool = g;
            if (op.pick === 'random') {
              i2 = matches[randInt(state, matches.length)].i;
              break;
            }
            /* Highest ATK wins, and the most recent card breaks a tie — which
               is what decides it for Spells, where ATK means nothing and the
               last one sent to the Graveyard is the one still worth having.
               `CARDS[...]` rather than `baseAtk`, which throws on a slug it
               does not know and would take the whole duel down with it. */
            i2 = matches.reduce((a, b) => ((CARDS[b.c.slug]?.atk ?? 0) >= (CARDS[a.c.slug]?.atk ?? 0) ? b : a)).i;
            break;
          }
        }
        if (!pool || i2 < 0) break;
        const c = pool.splice(i2, 1)[0];
        state.players[ctx.controller].hand.push(c);
        log(state, `${state.players[ctx.controller].name} takes ${displayName(state, c)} from the Graveyard.`, 'effect', ctx.controller, logSlug(c));
        checkExodia(state);
        break;
      }
      case 'coinFlip': {
        const coins = op.count ?? 1;
        if (coins === 1) {
          const heads = nextRandom(state) < 0.5;
          log(state, `Coin flip: ${heads ? 'HEADS' : 'TAILS'}!`, 'effect', ctx.controller);
          anim(state, { kind: 'activate', text: heads ? 'HEADS' : 'TAILS', player: ctx.controller });
          runOps(ctx, heads ? op.heads : op.tails);
          break;
        }
        /* Three barrels, one announcement. Narrating each flip in turn buries
           the number that matters — how many landed — under three lines that
           each look like the whole result. */
        let landed = 0;
        for (let i = 0; i < coins; i++) if (nextRandom(state) < 0.5) landed += 1;
        log(state, `${coins} coins: ${landed} HEADS, ${coins - landed} TAILS!`, 'effect', ctx.controller, logSlug(ctx.source));
        anim(state, { kind: 'activate', uid: ctx.source.uid, slug: ctx.source.slug, reports: true, text: `${landed}/${coins} HEADS`, player: ctx.controller });
        for (let i = 0; i < landed; i++) runOps(ctx, op.heads);
        for (let i = 0; i < coins - landed; i++) runOps(ctx, op.tails);
        break;
      }
      case 'diceMakeSeven': {
        const dice = Array.from({ length: op.count }, () => 1 + randInt(state, 6));
        const made = makesSeven(dice);
        log(
          state,
          `${dice.join(' · ')} — ${made ? 'seven!' : 'no seven.'}`,
          'effect',
          ctx.controller,
          logSlug(ctx.source)
        );
        /* The beat carries the card, because the beat carries the line. Without
           the uid and the slug the dice roll printed over empty space — caught
           by `npm run banner`, which is exactly the shape it watches for. */
        anim(state, {
          kind: 'activate',
          uid: ctx.source.uid,
          slug: ctx.source.slug,
          reports: true,
          text: `${dice.join(' ')} ${made ? '= 7' : '✗'}`,
          player: ctx.controller,
        });
        runOps(ctx, made ? op.onSuccess : (op.onFail ?? []));
        break;
      }
      case 'cascade': {
        for (const branch of op.branches) {
          if (branch.condition && !conditionMet(state, { trigger: 'continuous', ops: [], condition: branch.condition }, ctx.source, ctx.controller)) {
            continue;
          }
          runOps(ctx, branch.ops);
          break;
        }
        break;
      }
      case 'rollsToSurvive':
        applyFlag(ctx.source, 'rollsToSurvive', true, op.duration);
        break;
      case 'diceRoll': {
        const roll = 1 + randInt(state, 6);
        log(state, `Dice roll: ${roll}!`, 'effect', ctx.controller);
        anim(state, { kind: 'activate', text: `⚄ ${roll}`, player: ctx.controller });
        ctx.lastRoll = roll;
        for (let i = 0; i < roll; i++) runOps(ctx, op.perPip);
        break;
      }
      case 'forceDefense':
        for (const t of resolveTargets(ctx, op.target)) {
          t.position = 'def';
          t.face = 'up';
        }
        break;
      case 'forceAttackPosition':
        for (const t of resolveTargets(ctx, op.target)) {
          // Dragging a set monster into Attack Position turns it face-up, and
          // that is a flip like any other: Man-Eater Bug pulled up by Stop
          // Defense still eats something. Capture it before the position
          // changes, since `wasDown` is what decides whether this is a flip.
          const wasDown = t.face === 'down';
          t.position = 'atk';
          t.face = 'up';
          if (wasDown) {
            const ctrl = controllerOf(state, t.uid);
            if (ctrl) {
              log(state, `${displayName(state, t)} is flipped face-up!`, 'effect', ctrl, logSlug(t));
              anim(state, { kind: 'flip', uid: t.uid, slug: t.slug, player: ctrl });
              fireTriggers(state, t, ctrl, 'onFlip', {});
            }
          }
        }
        break;
      case 'destroyIfNoAtk':
        /* The drain above has already landed, so this reads the *effective*
           stat. A filter would not do: `matchesFilter` is deliberately blind to
           auras to avoid recursing through the stat calculation, so `maxAtk: 0`
           would consult the printed number and finish the wrong monsters. */
        for (const t of resolveTargets(ctx, op.target)) {
          if (effAtk(state, t) <= 0) destroyCard(state, t, false, ctx);
        }
        break;
      case 'flipFaceUp':
        for (const t of resolveTargets(ctx, op.target)) {
          if (t.face === 'down') {
            t.face = 'up';
            const ctrl = controllerOf(state, t.uid);
            if (ctrl) fireTriggers(state, t, ctrl, 'onFlip', {});
          }
        }
        break;
      case 'win':
        state.winner = ctx.controller;
        state.winReason = `${state.players[ctx.controller].name} won by card effect.`;
        break;
    }
  }
}

function conditionMet(state: DuelState, eff: CardEffect, c: CardInstance, controller: PlayerId, trig?: TriggerContext): boolean {
  const cond = eff.condition;
  if (!cond) return true;
  const p = state.players[controller];
  /* What just arrived, for `onAllySummon`. Unfiltered, the trigger answers
     every summon in the duel — including the card's own. */
  if (cond.summonedIs) {
    const arrived = trig?.summonedUid ? findOnField(state, trig.summonedUid)?.c : null;
    if (!arrived || !matchesFilter(arrived, cond.summonedIs)) return false;
  }
  if (cond.ownLpBelow != null && p.lp > cond.ownLpBelow) return false;
  if (cond.graveAtLeast != null && p.grave.length < cond.graveAtLeast) return false;
  if (cond.countersAtLeast != null && c.counters < cond.countersAtLeast) return false;
  if (cond.turnAtLeast != null && state.turn < cond.turnAtLeast) return false;
  if (cond.opponentHasMonster && state.players[other(controller)].monsters.every((m) => !m)) return false;
  if (cond.controlsOtherToon) {
    /* Another one, never itself — a lone Dark Rabbit is not company. Asked of
       the live roster rather than the printed one, so a drawing only counts
       while the book that animates it is open. */
    const bookOpen = faceUpOnSide(state, controller, 'toon-world');
    const hasCompany = p.monsters.some((m) => m && m.uid !== c.uid && m.face === 'up' && toonActive(m.slug, bookOpen));
    if (!hasCompany) return false;
  }
  if (cond.requiresOnField) {
    /* `excludeSelf` is the word "another". A card is always on the field while
       it is asking, so a condition naming its own slug is otherwise a sentence
       that can never be false — see the field's own note. */
    const other_ = (m: CardInstance | null | undefined) => !!m && (!cond.excludeSelf || m.uid !== c.uid);
    const has =
      p.monsters.some((m) => m?.slug === cond.requiresOnField && other_(m)) ||
      (p.spellTrap?.slug === cond.requiresOnField && other_(p.spellTrap)) ||
      (p.field?.slug === cond.requiresOnField && other_(p.field));
    if (!has) return false;
  }
  if (cond.requiresOnFieldAll) {
    const onField = (slug: string) =>
      p.monsters.some((m) => m?.slug === slug && m.face === 'up') ||
      p.spellTrap?.slug === slug ||
      p.field?.slug === slug;
    if (!cond.requiresOnFieldAll.every(onField)) return false;
  }
  if (cond.graveHasSlug) {
    if (!p.grave.some((g) => g.slug === cond.graveHasSlug)) return false;
  }
  if (cond.controlsMonster && p.monsters.every((m) => !m)) return false;
  if (cond.opponentHasBackrow) {
    const them = state.players[other(controller)];
    if (!them.spellTrap && !them.field) return false;
  }
  if (cond.typeOnField) {
    const anywhere = (['p1', 'p2'] as PlayerId[]).some((pid) =>
      state.players[pid].monsters.some((m) => m && m.face === 'up' && CARDS[m.slug]?.type === cond.typeOnField)
    );
    if (!anywhere) return false;
  }
  if (cond.controlsOtherOfType) {
    const has = p.monsters.some(
      (m) => m && m.uid !== c.uid && m.face === 'up' && CARDS[m.slug]?.type === cond.controlsOtherOfType
    );
    if (!has) return false;
  }
  if (cond.controlsNoOtherMonster) {
    if (p.monsters.some((m) => m && m.uid !== c.uid)) return false;
  }
  if (cond.requiresField) {
    const has = state.players.p1.field?.slug === cond.requiresField || state.players.p2.field?.slug === cond.requiresField;
    if (!has) return false;
  }
  return true;
}

/**
 * How deep one trigger may set off another before the engine stops listening.
 *
 * Two cards can answer each other forever: Revival Jam revives itself the
 * moment it is destroyed, a revival is a Summon, and Slifer's second mouth
 * destroys what the opponent Summons — so the pair ping-ponged until the
 * *stack* overflowed, which on a serverless function is a 500 and a duel both
 * players lose. Found by `npm run deck-bench` the first time Yami Marik was
 * measured against the field.
 *
 * The cap is deliberately far above any real chain (a long combo here is a
 * handful deep) and exists so that no future pair of cards can take the
 * server down. It is a backstop, not a rule: cards that could loop are
 * expected to carry their own limit, which is what `oncePerTurn` below is for.
 */
const MAX_TRIGGER_DEPTH = 16;
let triggerDepth = 0;

function fireTriggers(state: DuelState, c: CardInstance, controller: PlayerId, trigger: CardEffect['trigger'], trig: TriggerContext, targets: string[] = []) {
  if (c.isToken || c.flags.negated || state.winner) return;
  const def = CARDS[c.slug];
  if (!def) return;
  if (triggerDepth >= MAX_TRIGGER_DEPTH) return;
  triggerDepth += 1;
  try {
    fireTriggersInner(state, c, controller, trigger, trig, targets, def);
  } finally {
    triggerDepth -= 1;
  }
}

function fireTriggersInner(
  state: DuelState,
  c: CardInstance,
  controller: PlayerId,
  trigger: CardEffect['trigger'],
  trig: TriggerContext,
  targets: string[],
  def: CardDef,
  /**
   * True when this is a parked effect coming back with its answer.
   *
   * It looks redundant — `raiseChoice` refuses the moment an answer exists, so
   * a resumed effect could not park again — and it was deleted once on exactly
   * that reasoning. The reasoning holds for every pick except an optional one,
   * whose answer is legitimately *empty*: "up to 2, or none" resumed with no
   * targets, was indistinguishable from nobody having been asked, and asked
   * again, and again. Declining Uraby's shatter hung the duel.
   */
  resumed = false
) {
  for (const eff of def.effects) {
    if (eff.trigger !== trigger) continue;
    if (!conditionMet(state, eff, c, controller, trig)) continue;
    /* "Once per turn" used to mean it only for an ignition, where the count
       lives on the card instance — which is no use to a card that dies and
       comes back, because `resetInstance` clears the marker on the way in.
       Kept on the state and keyed by controller and name, so Revival Jam
       revives once a turn however many times it is broken. Cleared at every
       turn start, so it really is per turn and not per duel. */
    if (eff.oncePerTurn && trigger !== 'ignition') {
      const key = `${controller}:${c.slug}:${trigger}`;
      const used = state.oncePerTurnUsed ?? (state.oncePerTurnUsed = []);
      if (used.includes(key)) continue;
      used.push(key);
    }
    /* Ask, if there is a question and nobody has answered it. On your own turn
       the board asks before it ever sends the action, so `targets` arrives full
       and this does nothing. It is the effects that fire on somebody else's
       turn — Sangan on the way to the pile, Newdoria taking one with it — that
       reach here with nothing, and those are the ones that used to have the
       engine choose on their controller's behalf. */
    if (!resumed && raiseChoice(state, c, controller, trigger, eff, targets)) continue;
    const ctx: EffectCtx = { state, controller, source: c, targets, cursor: 0, trig };
    if (def.cry && (trigger === 'onSummon' || trigger === 'onNormalSummon' || trigger === 'activate')) {
      /* `arrival` when the effect fired because the card turned up. The beat is
         worth keeping — it is what gives a signature monster its flourish — but
         a card with several effects announced all of them the same bare way, so
         Slifer's draw-on-summon rider was indistinguishable from his second
         mouth and got reported as the mouth firing on his own Summon. */
      const arrival = trigger === 'onSummon' || trigger === 'onNormalSummon';
      anim(state, { kind: 'activate', uid: c.uid, slug: c.slug, player: controller, text: def.cry, arrival });
    }
    runOps(ctx, eff.ops);
  }
}

/**
 * Where a card is standing right now, so a parked effect can find it again.
 *
 * The effect resumes on a later action, and by then the source may have moved:
 * Sangan asks its question *from the Graveyard*, having arrived there a moment
 * before the window opened. Named rather than held, because the state is
 * serialised between the question and the answer.
 */
function whereIs(state: DuelState, uid: string): 'field' | 'grave' | 'hand' | null {
  if (findOnField(state, uid)) return 'field';
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    if (state.players[pid].grave.some((c) => c.uid === uid)) return 'grave';
    if (state.players[pid].hand.some((c) => c.uid === uid)) return 'hand';
  }
  return null;
}

function findAnywhere(state: DuelState, uid: string): CardInstance | null {
  const onField = findOnField(state, uid);
  if (onField) return onField.c;
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const p = state.players[pid];
    const hit = p.grave.find((c) => c.uid === uid) ?? p.hand.find((c) => c.uid === uid) ?? p.deck.find((c) => c.uid === uid);
    if (hit) return hit;
  }
  return null;
}

/**
 * Parks an effect and asks its controller to choose, returning true if it did.
 *
 * Only when there is a real question: the effect declares a pick, nobody has
 * answered it, and more cards qualify than the effect will take. One legal
 * card is not a choice, and none at all is not a prompt — both go straight
 * through and resolve as they always have.
 */
function raiseChoice(
  state: DuelState,
  c: CardInstance,
  controller: PlayerId,
  trigger: Trigger,
  eff: CardEffect,
  targets: string[]
): boolean {
  if (targets.length || state.winner) return false;
  if (!eff.targets) return false;
  const spec = targetSpecFor(c.slug, trigger);
  if (!spec) return false;
  const offered = targetCandidates(state, controller, spec, (t, owner) => effFlags(state, t, owner).untargetable === true);
  /* Never the card doing the asking. A monster does not Special Summon itself
     with its own "when this card is destroyed" effect — the summon op has
     refused that for as long as it has existed — and Anthrosaurus, which is a
     Dinosaur lying in the Graveyard by the time it asks, was being offered as
     one of its own answers. Picking it would have been the picker and the
     engine disagreeing about the rule, which is the shape of half the bugs in
     this file.

     Flatly, with no exception for the op's `includeSelf`. Revival Jam is the
     only card that opts in and it never asks a question, so the exception was
     a branch nothing could take and no test could prove — and an unfalsifiable
     line is worth less than the rule it was guarding. The day a card both opts
     in and asks, it will need a test, and this is where it goes. */
  const options = offered.filter((o) => o.uid !== c.uid);
  const want = spec.count ?? 1;
  /* "Up to" always asks, so long as there is anything to point at: taking two
     of the two on the board is a decision, and so is taking neither. A
     compulsory pick with no room to choose is not, and goes straight through. */
  const optional = optionalPick(c.slug, trigger);
  if (optional ? options.length === 0 : options.length <= want) return false;

  const from = whereIs(state, c.uid);
  if (!from) return false;
  const choice: PendingChoice = {
    kind: 'choose',
    player: controller,
    options: options.map((o) => o.uid),
    reason: `${displayName(state, c)}: ${spec.prompt}`,
    context: {},
    sourceUid: c.uid,
    sourceSlug: c.slug,
    trigger,
    want,
    optional,
    picked: [],
    from,
  };
  /* One slot, and a duel can raise two questions in a breath — a Dark Hole over
     two Sangans. The second waits its turn rather than being answered by the
     engine on its owner's behalf. */
  if (state.pending) (state.pendingChoices ??= []).push(choice);
  else state.pending = choice;
  return true;
}

/**
 * Every legal answer to an open choice window, for whoever has to give one.
 *
 * Three drivers ask "what may I do while a window is open" — the computer, the
 * autoplayer, and the simulator — and each carried its own copy of the answer.
 * They all knew about traps and none of them knew about this, so a card that
 * stopped to ask a question was met with `respondTrap` and the duel wedged: 21
 * of 400 simulated games died on "Waiting for you to choose." The trap half
 * stays where it is, because each driver wants different things from it; the
 * new half is written once.
 *
 * Ranked strongest first, so a caller that simply takes the head gets the same
 * card the engine used to choose on the player's behalf.
 */
export function choiceResponses(state: DuelState, pid: PlayerId): DuelAction[] {
  const pending = state.pending;
  if (pending?.kind !== 'choose' || pending.player !== pid) return [];
  const ranked = [...pending.options].sort(
    (a, b) => baseAtk(findAnywhere(state, b)?.slug ?? '') - baseAtk(findAnywhere(state, a)?.slug ?? '')
  );
  const out: DuelAction[] = [];
  const take = Math.min(3, Math.max(1, ranked.length - pending.want + 1));
  for (let i = 0; i < take; i++) out.push({ type: 'chooseCard', uids: ranked.slice(i, i + pending.want) });
  return out;
}


/** Does this effect's pick say "up to"? Read off the card, once. */
function optionalPick(slug: string, trigger: Trigger): boolean {
  const eff = CARDS[slug]?.effects.find((e) => e.trigger === trigger);
  return !!eff?.ops.some((op) => 'target' in op && op.target?.pick === 'chosen' && op.target.optional);
}

/** Opens the next parked question, if the slot is free and one is waiting. */
function drainChoices(state: DuelState) {
  if (state.pending || state.winner) return;
  const next = state.pendingChoices?.shift();
  if (!next) return;
  /* The board has moved since it was parked. Re-ask rather than trusting the
     list it was queued with: the card it was going to offer may be gone. */
  const src = findAnywhere(state, next.sourceUid);
  const spec = src ? targetSpecFor(next.sourceSlug, next.trigger) : null;
  if (!src || !spec) {
    drainChoices(state);
    return;
  }
  const options = targetCandidates(state, next.player, spec, (t, owner) => effFlags(state, t, owner).untargetable === true);
  if (next.optional ? options.length === 0 : options.length <= next.want) {
    // No longer a choice. Resolve it the way it would have resolved anyway.
    resumeChoice(state, { ...next, options: options.map((o) => o.uid) }, options.slice(0, next.want).map((o) => o.uid));
    drainChoices(state);
    return;
  }
  state.pending = { ...next, options: options.map((o) => o.uid) };
}

/** Runs a parked effect, now that its controller has answered. */
function resumeChoice(state: DuelState, choice: PendingChoice, picked: string[]) {
  const src = findAnywhere(state, choice.sourceUid);
  if (!src) return;
  fireTriggersInner(state, src, choice.player, choice.trigger, {}, picked, CARDS[choice.sourceSlug], true);
}

/* ------------------------------------------------------------------ */
/* Trap windows                                                        */
/* ------------------------------------------------------------------ */

function activatableTraps(state: DuelState, pid: PlayerId, window: TrapWindow): CardInstance[] {
  const p = state.players[pid];
  const out: CardInstance[] = [];
  /* A condition is exactly the same shape as a cost, and was missed where the
     cost was caught: Tornado Wall says "activate only while Umi is on the
     field", was offered with no Umi anywhere, and `activateTrapCard` then
     announced it, skipped the condition-gated effect and spent the card for
     nothing. Reported from a real duel. Asked here so the card is never
     offered, rather than refused after the window has already been fired. */
  const live = (c: CardInstance) => (e: CardEffect) => !e.condition || conditionMet(state, e, c, pid);
  const st = p.spellTrap;
  if (st && CARDS[st.slug]?.kind === 'trap') {
    const effs = CARDS[st.slug].effects.filter((e) => e.trigger === 'trap' && windowMatches(e.window, window)).filter(live(st));
    // A face-down trap cannot be activated on the turn it was set. A face-up
    // Continuous Trap has already served that wait, and one flagged `reusable`
    // goes off every time its window opens — that ongoing threat is the whole
    // reason it is allowed to sit in the zone.
    const ready = st.face === 'down' ? st.summonedOnTurn < state.turn : effs.some((e) => e.reusable);
    // And a trap the controller cannot pay for is not an option — offering it
    // would fire the window, skip the cost-gated effect, and waste the card.
    const payable = effs.some((e) => canPayCost(state, pid, e));
    if (ready && payable && effs.length) out.push(st);
  }
  for (const h of p.hand) {
    const effs = CARDS[h.slug]?.effects.filter((e) => e.trigger === 'trap' && e.fromHand && windowMatches(e.window, window)).filter(live(h)) ?? [];
    if (effs.length) out.push(h);
  }
  return out;
}

/**
 * Does a card watching `wants` fire in the window that just opened?
 *
 * Only one relationship is not equality: a Normal Summon is a Summon, so
 * Torrential Tribute's "when your opponent summons a monster" catches it,
 * while Trap Hole — which says "Normal Summons" — sits out the Fusion Summons
 * that open the wider window. Setting a monster face-down opens neither, since
 * a Set is not a Summon at all.
 */
function windowMatches(wants: TrapWindow | undefined, opened: TrapWindow): boolean {
  if (wants === opened) return true;
  return wants === 'opponentSummon' && opened === 'opponentNormalSummon';
}


/**
 * "The opponent summoned something" — told to every face-up monster the other
 * player controls, with the new arrival in the trigger context so a selector
 * can reach it with `pick: 'attacker'`, exactly as a summon trap window does.
 *
 * A Set summons nothing and fires nothing, which is the same rule the trap
 * windows follow: iterated over a copy, because an effect here can destroy the
 * very monster that just arrived — or the one reacting to it.
 */
function fireOpponentSummon(state: DuelState, summoner: PlayerId, summonedUid: string) {
  const watcher = other(summoner);
  const watching = state.players[watcher].monsters.filter((m): m is CardInstance => !!m && m.face === 'up');
  for (const m of watching) {
    if (state.winner) return;
    // It may have left the field while an earlier watcher was resolving.
    if (!findOnField(state, m.uid)) continue;
    fireTriggers(state, m, watcher, 'onOpponentSummon', { attackerUid: summonedUid });
  }
}

/**
 * Cards of *yours* that answer a summon from off the board.
 *
 * Every other watcher in this engine is on the field. Mad Sword Beast is not:
 * it waits in a hand or a Graveyard and any Dinosaur arriving calls it out. The
 * hand is read before the pile because a card you are holding is the one you
 * expect to move first, and a copy is skipped the moment it is no longer where
 * it was — one of them summoning itself is enough, and the arrival it answered
 * may already have gone.
 */
function fireAllySummon(state: DuelState, summoner: PlayerId, summonedUid: string) {
  const p = state.players[summoner];
  const waiting = [...p.hand, ...p.grave].filter((c) => CARDS[c.slug]?.effects.some((e) => e.trigger === 'onAllySummon'));
  for (const c of waiting) {
    if (state.winner) return;
    if (!p.hand.includes(c) && !p.grave.includes(c)) continue;
    if (p.monsters.every((m) => !!m)) return;
    fireTriggers(state, c, summoner, 'onAllySummon', { summonedUid });
  }
}

function openTrapWindow(state: DuelState, responder: PlayerId, window: TrapWindow, reason: string, context: TriggerContext): boolean {
  if (state.winner || state.pending) return false;
  const opts = activatableTraps(state, responder, window);
  if (!opts.length) return false;
  state.pending = { kind: 'trap', player: responder, options: opts.map((c) => c.uid), reason, context };
  return true;
}

function activateTrapCard(state: DuelState, pid: PlayerId, uid: string, targets: string[], trig: TriggerContext): EffectCtx | null {
  const p = state.players[pid];
  const fromHand = p.hand.some((h) => h.uid === uid);
  const c = fromHand ? p.hand.find((h) => h.uid === uid)! : p.spellTrap?.uid === uid ? p.spellTrap : null;
  if (!c) return null;
  const def = CARDS[c.slug];
  const effs = def.effects.filter((e) => e.trigger === 'trap');
  if (!effs.length) return null;

  log(state, `${p.name} activates ${def.name}!`, 'effect', pid);
  anim(state, { kind: 'trap', uid: c.uid, slug: c.slug, player: pid, text: def.cry });

  const ctx: EffectCtx = { state, controller: pid, source: c, targets, cursor: 0, trig };
  for (const eff of effs) {
    if (!conditionMet(state, eff, c, pid)) continue;
    /* Traps pay their costs too. `activateSpell` has always paid `cost.lp`;
       this path silently ignored it, so a trap priced in Life Points was a
       trap priced in nothing. Announced like any other payment — the total
       must never move with nothing on screen saying why. */
    if (eff.cost?.lp) {
      const due = lpCost(state, pid, eff);
      if (p.lp <= due) continue;
      p.lp -= due;
      log(state, `${p.name} pays ${due} Life Points.`, 'effect', pid);
      anim(state, { kind: 'damage', player: pid, amount: due });
    }
    runOps(ctx, eff.ops);
  }

  // Continuous traps stay on the field, and so does a Trap that equips itself
  // to a monster — Metalmorph is an Equip card that happens to be a Trap, and
  // sending it to the Graveyard would strip the bonus it just granted.
  const isContinuous = def.subKind === 'Continuous' || isEquipSpell(c.slug);
  if (fromHand) {
    const i = p.hand.findIndex((h) => h.uid === uid);
    if (i >= 0) p.grave.push(p.hand.splice(i, 1)[0]);
  } else if (isContinuous) {
    c.face = 'up';
  } else {
    toGrave(state, uid, true);
  }
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Battle                                                              */
/* ------------------------------------------------------------------ */

function beginAttack(state: DuelState, attackerUid: string, targetUid: string | null) {
  const found = findOnField(state, attackerUid);
  if (!found) return;
  const attacker = found.c;
  const controller = found.controller;
  const defender = other(controller);

  // The visit is the declaration, not the outcome — a negated attack still
  // spent this monster's "once" against that target.
  if (targetUid) attacker.attacked = [...(attacker.attacked ?? []), targetUid];

  fireTriggers(state, attacker, controller, 'onDeclareAttack', { attackerUid, targetUid: targetUid ?? undefined });
  if (state.winner) return;

  const targetName = targetUid ? displayName(state, findOnField(state, targetUid)?.c ?? attacker) : state.players[defender].name;
  log(state, `${displayName(state, attacker)} attacks ${targetName}!`, 'attack', controller, logSlug(attacker));

  state.suspendedAttack = { attackerUid, targetUid };
  const opened = openTrapWindow(state, defender, 'opponentDeclareAttack', `${displayName(state, attacker)} is attacking!`, {
    attackerUid,
    targetUid: targetUid ?? undefined,
  });
  if (!opened) resolveBattle(state);
}

function resolveBattle(state: DuelState) {
  const susp = state.suspendedAttack;
  state.suspendedAttack = null;
  if (!susp || state.winner) return;

  const found = findOnField(state, susp.attackerUid);
  if (!found) return; // attacker was removed by a trap
  const attacker = found.c;
  const controller = found.controller;
  const defender = other(controller);

  attacker.attacksUsed += 1;

  if (!susp.targetUid) {
    /* The Toon toll used to be charged here — 500 Life Points per declared
       direct attack, carried by a `directAttackTax` grant. Reported as too
       expensive ("monsters needing lp to attack is a lot") and removed with
       the rest of that pricing pass; the flag went with it rather than
       staying behind as a branch no card can reach. */
    const dmg = battleDamageFrom(state, attacker, controller, effAtk(state, attacker, controller), true);
    anim(state, { kind: 'directAttack', uid: attacker.uid, slug: attacker.slug, player: controller, amount: dmg });
    /* "When it inflicts battle damage" means damage that actually landed.
       Measured rather than assumed: a Kuriboh thrown in front of the swing
       stops the damage dead, and Leghul was still collecting its 500 for a hit
       the other player never took. Reported from a real duel. */
    const before = state.players[defender].lp;
    dealDamage(state, defender, dmg, true);
    if (!state.winner && state.players[defender].lp < before) {
      fireTriggers(state, attacker, controller, 'onDealBattleDamage', { attackerUid: attacker.uid });
    }
    return;
  }

  const targetFound = findOnField(state, susp.targetUid);
  if (!targetFound) {
    // Target vanished — treat as a direct attack for the remaining swing.
    const dmg = battleDamageFrom(state, attacker, controller, effAtk(state, attacker, controller), true);
    anim(state, { kind: 'directAttack', uid: attacker.uid, slug: attacker.slug, player: controller, amount: dmg });
    dealDamage(state, defender, dmg, true);
    return;
  }
  const target = targetFound.c;

  /* The attack turns a face-down monster up, but its flip effect waits until
     after damage has been calculated.
     
     Firing it first let a destructive flip effect — Man-Eater Bug — remove the
     attacker and end the battle before any damage was worked out, so the bug
     itself walked away untouched. Resolving it after the damage step means a
     set monster attacked and destroyed still gets its effect, and still dies:
     a one-for-one trade, which is both the real rule and what anyone expects. */
  const flipped = target.face === 'down';
  if (flipped) {
    target.face = 'up';
    log(state, `${displayName(state, target)} is flipped face-up!`, 'effect', defender, logSlug(target));
    anim(state, { kind: 'flip', uid: target.uid, slug: target.slug, player: defender });
  }

  /** Runs after the damage step, whether or not the monster survived it. */
  const resolveFlip = () => {
    if (!flipped || state.winner) return;
    fireTriggers(state, target, defender, 'onFlip', { attackerUid: attacker.uid, targetUid: target.uid });
  };

  fireTriggers(state, target, defender, 'onAttacked', { attackerUid: attacker.uid, targetUid: target.uid });
  if (state.winner || !findOnField(state, attacker.uid) || !findOnField(state, target.uid)) {
    // The battle was called off, but the monster was still turned face-up.
    resolveFlip();
    return;
  }

  // The slug rides along so the client can announce *which* monster is
  // attacking before any damage is worked out.
  anim(state, {
    kind: 'attack',
    uid: attacker.uid,
    slug: attacker.slug,
    targetUid: target.uid,
    text: displayName(state, target),
    player: controller,
  });

  /* Insect Barrier stretches over the hive: anything swinging at a monster it
     shields arrives 1000 lighter, and only for this battle — the toll is taken
     off the number the battle is measured with, never off the card. */
  const toll = effFlags(state, target, defender).sapsAttacker ? 1000 : 0;
  if (toll) {
    log(state, `${displayName(state, target)}'s barrier saps ${displayName(state, attacker)} of ${toll} ATK.`,
      'effect', defender, logSlug(target));
  }
  const flags = effFlags(state, attacker, controller);
  const guard = effFlags(state, target, defender);
  /* What this monster swings with, which is not always what it stands at.
     Three things bend it and all three belong to the battle rather than to the
     card: Metalzoa hits at twice its ATK and is hit at half, and Pendulum
     Machine is heavier against something lying down. None of them touch a stat
     anybody can read off the board between turns. */
  let swing = Math.max(0, effAtk(state, attacker, controller) - toll);
  if (flags.doublesWhenAttacking) {
    swing *= 2;
    log(state, `${displayName(state, attacker)} strikes at double strength.`, 'effect', controller, logSlug(attacker));
  }
  if (flags.bonusVsDefense && target.position === 'def') {
    swing += flags.bonusVsDefense;
    log(state, `${displayName(state, attacker)} bears down on a defending monster.`, 'effect', controller, logSlug(attacker));
  }
  if (guard.halvesAttacker) {
    swing = Math.floor(swing / 2);
    log(state, `${displayName(state, target)} turns half of that blow aside.`, 'effect', defender, logSlug(target));
  }
  const atk = swing;

  /**
   * Battle damage, mirrored back if the hurt player's own monster in this
   * battle says so.
   *
   * Relinquished swallowed a monster and uses it as a shield: what still gets
   * through to its controller is dealt to the other player as well. It only
   * ever *adds* — the controller is never spared — so it is a reason not to
   * engage rather than another kind of immunity, which is the whole point
   * after a God's privilege was taken back off it.
   */
  const battleHit = (who: PlayerId, amount: number, theirMonster: CardInstance) => {
    dealDamage(state, who, amount, true);
    if (state.winner || amount <= 0) return;
    if (!effFlags(state, theirMonster, who).reflectBattleDamage) return;
    log(state, `${displayName(state, theirMonster)} throws the blow back.`, 'effect', who, logSlug(theirMonster));
    dealDamage(state, other(who), amount, true);
  };

  if (target.position === 'atk') {
    const tAtk = effAtk(state, target, defender);
    if (atk > tAtk) {
      // Same rule as the direct swing: the trigger is about damage that landed.
      const before = state.players[defender].lp;
      battleHit(defender, battleDamageFrom(state, attacker, controller, atk - tAtk), target);
      destroyCard(state, target, true, { state, controller, source: attacker, targets: [], cursor: 0, trig: { attackerUid: attacker.uid } });
      if (!state.winner) {
        fireTriggers(state, attacker, controller, 'onBattleDestroy', { targetUid: target.uid });
        if (state.players[defender].lp < before) {
          fireTriggers(state, attacker, controller, 'onDealBattleDamage', { attackerUid: attacker.uid });
        }
      }
    } else if (atk < tAtk) {
      battleHit(controller, tAtk - atk, attacker);
      destroyCard(state, attacker, true, { state, controller: defender, source: target, targets: [], cursor: 0, trig: { attackerUid: target.uid } });
    } else {
      log(state, 'Both monsters are destroyed!', 'attack');
      destroyCard(state, target, true, { state, controller, source: attacker, targets: [], cursor: 0, trig: { attackerUid: attacker.uid } });
      destroyCard(state, attacker, true, { state, controller: defender, source: target, targets: [], cursor: 0, trig: { attackerUid: target.uid } });
    }
  } else {
    const tDef = effDef(state, target, defender);
    if (atk > tDef) {
      if (flags.pierce) battleHit(defender, battleDamageFrom(state, attacker, controller, atk - tDef), target);
      destroyCard(state, target, true, { state, controller, source: attacker, targets: [], cursor: 0, trig: { attackerUid: attacker.uid } });
      if (!state.winner) fireTriggers(state, attacker, controller, 'onBattleDestroy', { targetUid: target.uid });
    } else if (atk < tDef) {
      battleHit(controller, tDef - atk, attacker);
      log(state, `${displayName(state, target)} holds firm.`, 'attack', defender, logSlug(target));
    } else {
      log(state, `${displayName(state, target)} holds firm.`, 'attack', defender, logSlug(target));
    }
  }

  resolveFlip();
}

/* ------------------------------------------------------------------ */
/* Turn structure                                                      */
/* ------------------------------------------------------------------ */

function endOfTurnCleanup(state: DuelState, pid: PlayerId) {
  for (const who of ['p1', 'p2'] as PlayerId[]) {
    const p = state.players[who];
    for (const m of p.monsters) {
      if (!m) continue;
      m.turnAtkMod = 0;
      m.turnDefMod = 0;
      m.turnFlags = {};
      m.attacksUsed = 0;
      m.attacked = [];
    }
  }
  // Return borrowed monsters.
  for (const who of ['p1', 'p2'] as PlayerId[]) {
    const p = state.players[who];
    p.monsters.forEach((m, i) => {
      if (m && m.controlRevertsOnTurn != null && m.controlRevertsOnTurn <= state.turn) {
        const home = state.players[m.owner];
        const free = home.monsters.findIndex((x) => !x);
        m.controlRevertsOnTurn = undefined;
        if (free >= 0) {
          p.monsters[i] = null;
          home.monsters[free] = m;
          log(state, `${displayName(state, m)} returns to ${home.name}.`, 'effect', undefined, logSlug(m));
        }
      }
    });
  }
  // Tick down ongoing effects that target the player whose turn just ended.
  state.ongoing = state.ongoing.filter((o) => {
    if (o.target !== pid) return true;
    o.turns -= 1;
    return o.turns > 0;
  });
}

/**
 * A card lying face-down is doing nothing.
 *
 * Reported as "effects of face down monsters like burn can not happen if they
 * are face down — for example Marik's monster, if I end the turn and the
 * monster is facedown it can't burn the enemy", and it was true of every
 * standing-on-the-field trigger a Set monster carries: Bowganian burning for
 * 1100 and Granadora draining 800 at the start of a turn it spent asleep, and
 * Legendary Fiend quietly growing 700 a turn under its own card back.
 *
 * Everything else in the engine already had this right — `fieldCards` only
 * lists face-up cards, so auras never applied; `canIgnite` refuses a face-down
 * card; `fireOpponentSummon` filters to face-up watchers; a Set fires no summon
 * trigger at all. These two loops were the last place that asked "is there a
 * monster in the zone" instead of "is there a monster looking at the board".
 *
 * Deliberately not extended to `onDestroyed`/`onSentToGrave`: a card leaving
 * the field leaves it whichever way up it was lying, and the engine already
 * turns a Set monster face-up (`resolveFlip`) before the attack that kills it
 * finishes — so a flip monster still pays out on the way down, which is the
 * whole point of setting one.
 */
function startTurn(state: DuelState) {
  const pid = state.active;
  const p = state.players[pid];
  p.normalSummonUsed = false;
  // Per turn, not per duel — and cleared for both players, because a triggered
  // effect can fire on the turn that is not its controller's.
  state.oncePerTurnUsed = [];
  state.phase = 'draw';
  log(state, `Turn ${state.turn} — ${p.name}'s turn.`, 'system', pid);
  anim(state, { kind: 'phase', player: pid, text: `${p.name}'s Turn` });

  /* Anything owed back. Before the standing monsters take their turn-start
     triggers, because what claws its way out of the pile is part of the board
     they are looking at — and before the draw, so it is on the field for the
     whole turn it fought for. */
  for (const owed of state.ongoing.filter((o) => o.kind === 'pendingRevival' && o.target === pid)) {
    state.ongoing = state.ongoing.filter((o) => o !== owed);
    const at = p.grave.findIndex((g) => g.slug === owed.source);
    const zone = p.monsters.findIndex((m) => !m);
    if (at < 0 || zone < 0) continue;
    const back = p.grave[at];
    landSpecialSummon(state, back, pid, zone, 'atk', 'up');
    /* Bigger than it left. `resetInstance` has just wiped the modifiers, so
       these are written after the landing rather than before it. */
    back.atkMod += owed.atkBonus ?? 0;
    back.defMod += owed.defBonus ?? 0;
    fireTriggers(state, back, pid, 'onSummon', {});
    if (!state.winner) {
      fireOpponentSummon(state, pid, back.uid);
      fireAllySummon(state, pid, back.uid);
    }
  }
  for (const m of p.monsters) if (m && m.face === 'up') fireTriggers(state, m, pid, 'onOwnTurnStart', {});
  /* A face-up card in the Spell/Trap Zone ticks too. Only the Field Zone did,
     so a Continuous Trap could never carry a per-turn clause at all — which is
     most of what makes one worth the single zone it occupies. Face-up only,
     for the same reason a Set monster does nothing. */
  if (p.spellTrap?.face === 'up') fireTriggers(state, p.spellTrap, pid, 'onOwnTurnStart', {});
  if (p.field) fireTriggers(state, p.field, pid, 'onOwnTurnStart', {});
  if (state.winner) return;

  const skipDraw = state.ongoing.some((o) => o.kind === 'skipDraw' && o.target === pid);
  if (skipDraw) log(state, `${p.name} must skip their draw.`, 'effect', pid);
  else drawCard(state, pid);
  checkExodia(state);
  if (state.winner) return;

  state.phase = 'main';
}

/**
 * A God that did not pay for itself goes back at the End Phase.
 *
 * Three tributes is the whole board, and it is the price of a Divine-Beast.
 * Nothing charged that price on a *Special* Summon — and Monster Reborn reads
 * **either** Graveyard and is in all eleven decks, so the first time Slifer
 * died it became a one-card play for anybody at the table. Worst of all it
 * was a way to take someone's God: revive it from *their* Graveyard onto your
 * field, where its second mouth then drains every monster its owner summons,
 * permanently. That is the exact hole the printed rule closes.
 *
 * So reviving one is a rental for the turn, which is still a real play and a
 * good anime beat — the God comes down, swings once, and is gone.
 *
 * Both fields, because a Special Summon can happen on either player's turn: a
 * trap window fires during the opponent's turn, so "the End Phase of the turn
 * it was Summoned" is not always its controller's own. Keyed off the type, as
 * `tributesRequired` is, so Obelisk and Ra inherit it the day they arrive.
 */
function returnBorrowedGods(state: DuelState) {
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    for (const m of [...state.players[pid].monsters]) {
      if (!m || m.specialSummonedOnTurn !== state.turn) continue;
      if (CARDS[m.slug]?.type !== 'Divine-Beast') continue;
      log(state, `${displayName(state, m)} cannot be borrowed — it returns to the Graveyard.`, 'effect', pid, logSlug(m));
      anim(state, { kind: 'destroy', uid: m.uid, slug: m.slug, player: pid });
      toGrave(state, m.uid, true);
    }
  }
}

function endTurn(state: DuelState) {
  const pid = state.active;
  state.phase = 'end';
  const p = state.players[pid];
  for (const m of p.monsters) if (m && m.face === 'up') fireTriggers(state, m, pid, 'onOwnTurnEnd', {});
  if (p.spellTrap?.face === 'up') fireTriggers(state, p.spellTrap, pid, 'onOwnTurnEnd', {});
  if (p.field) fireTriggers(state, p.field, pid, 'onOwnTurnEnd', {});
  /* And the clock cards, on both sides — a turn ending is a turn ending
     whoever took it. Fired after the active player's own, so the ordering
     within a single End Phase stays "yours, then everybody's". */
  for (const side of ['p1', 'p2'] as PlayerId[]) {
    const sp = state.players[side];
    for (const m of sp.monsters) if (m && m.face === 'up') fireTriggers(state, m, side, 'onAnyTurnEnd', {});
    if (sp.spellTrap?.face === 'up') fireTriggers(state, sp.spellTrap, side, 'onAnyTurnEnd', {});
    if (sp.field) fireTriggers(state, sp.field, side, 'onAnyTurnEnd', {});
  }
  if (state.winner) return;

  returnBorrowedGods(state);
  if (state.winner) return;

  endOfTurnCleanup(state, pid);
  state.active = other(pid);
  state.turn += 1;
  startTurn(state);
}

/* ------------------------------------------------------------------ */
/* Legality helpers (shared by the server and the UI)                  */
/* ------------------------------------------------------------------ */

/** Is this card face-up on that player's side, in any zone? */

/**
 * Why this monster may not simply be Normal Summoned, or null if it may.
 *
 * Only Fusion monsters were ever checked here, so a Ritual monster could be
 * laid straight down from the hand — Relinquished walked onto the field for
 * free while Black Illusion Ritual, the card whose entire job is to put it
 * there, sat unused. The same hole let a Toon be Summoned with no Toon World,
 * which is the one thing the whole Toon deck is built around.
 */
/**
 * Every card that belongs to somebody's Extra Deck.
 *
 * The decklists are the authority here, not the card database's `isFusion`
 * flag: Flame Swordsman and Bickuribox are printed Fusions that this game puts
 * in main decks and expects to be Normal Summoned.
 */
const EXTRA_DECK_SLUGS = new Set<string>(DUELISTS.flatMap((d) => d.extra ?? []));

/**
 * Does this card belong to an Extra Deck?
 *
 * Exported because three harnesses were each using `def.isFusion` as their own
 * private answer to this question, and it is the wrong answer twice over:
 * Flame Swordsman and Bickuribox are printed Fusions sitting in main decks,
 * and Valkyrion the Magna Warrior is an Extra Deck card the database does not
 * flag as a Fusion at all. One rule, asked by the engine and the checks alike —
 * the lesson `summonBlocked` itself carries three comments about.
 */
export const isExtraDeckCard = (slug: string): boolean => EXTRA_DECK_SLUGS.has(slug);

export function summonBlocked(state: DuelState, pid: PlayerId, slug: string): string | null {
  const def = CARDS[slug];
  if (!def) return null;
  /* An Extra Deck card can never be Normal Summoned, wherever it happens to be
     sitting right now.
   *
   * This used to ask whether the card was still *in* the Extra Deck, which held
   * only for one that had never left. A Fusion that reached a hand could then
   * be Normal Summoned for two Tributes, skipping its materials entirely — and
   * six cards put a monster into its owner's hand (Amazon of the Seas,
   * Jellyfish, Crab Turtle, Kelbek, Wall of Illusion, Guardian Sphinx), every
   * one of them aimed at the opponent. Answering a Blue-Eyes Ultimate Dragon
   * was all it took. Found by the pin for Thousand Dragon's "Cannot be Normal
   * Summoned or Set", and it was never only about Thousand Dragon.
   *
   * Keyed off the decklists rather than `isFusion`, because that flag is the
   * card database's and not this game's: Flame Swordsman and Bickuribox are
   * printed Fusions that sit in main decks here and are meant to be Normal
   * Summoned. Blocking on the flag alone broke both — caught by the regression
   * that drives Flame Swordsman's own search.
   *
   * Safe to widen: every caller gates the Normal-Summon-from-hand path — the
   * board, the AI, autoplay, the simulator, the playability check and the
   * `normalSummon` case itself. Fusion Summoning goes through `fusionSummon`,
   * which never asks. */
  if (EXTRA_DECK_SLUGS.has(slug)) {
    return def.fusionMaterials?.length
      ? 'Fusion monsters must be Fusion Summoned.'
      : `${def.name} can only be Special Summoned from the Extra Deck.`;
  }
  if (def.isRitual) return `${def.name} can only be Ritual Summoned.`;
  if (def.summonOnlyBy?.length) {
    const names = def.summonOnlyBy.map((sl) => CARDS[sl]?.name ?? sl);
    const by = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
    return `${def.name} can only be Special Summoned by the effect of ${by}.`;
  }
  if (def.summonRequires && !faceUpOnSide(state, pid, def.summonRequires)) {
    return `${def.name} needs ${CARDS[def.summonRequires]?.name ?? def.summonRequires} on your field.`;
  }
  return null;
}


export function tributesRequired(slug: string, state?: DuelState, pid?: PlayerId): number {
  const def = CARDS[slug];
  const level = def?.level ?? 0;
  let need = level >= 7 ? 2 : level >= 5 ? 1 : 0;
  /* A God is three bodies, whatever its Level says. Written against the type
     rather than a per-card override so Obelisk and Ra cost the same the day
     they arrive, without anybody having to remember. Tokens count as bodies —
     Kuriboh's Multiply is how this deck gets there. */
  if (def?.type === 'Divine-Beast') need = 3;
  /* Double Coston is two souls in one body, and the printed card says so:
     "when Tributed for a DARK monster, it counts as 2 Tributes". A God is
     DIVINE rather than DARK, so here it pays for the God instead — which is
     the one line that makes Obelisk reachable off a board that is merely good
     rather than perfect.
     Written as a discount rather than as a double-value tribute on purpose.
     Five separate places pick the tributes to pay — the interface, the AI,
     autoplay, the simulator and the audit — and every one of them asks this
     function, so a rule that lives here is a rule they all get. A tribute that
     counted twice would have to be understood by all five, and this file's
     longest-running lesson is what happens when one rule is copied into
     several places: `summonBlocked` had already drifted in two of them. */
  if (need > 1 && state && pid && faceUpOnSide(state, pid, 'double-coston')) need -= 1;
  /* Kaiser Sea Horse is the same bargain one attribute over — "counts as two
     tributes for the Tribute Summon of a LIGHT monster" — and it had never
     been implemented at all. Reported from a real duel: tributing him towards
     a two-tribute monster still asked for a second body, so the only sentence
     on the card that does anything did nothing.

     A discount for the same reason Double Coston is one, and the reason is
     written above: five separate places pick the tributes to pay, and a
     tribute that counted double would have to be understood by every one of
     them. LIGHT is read off the monster being Summoned, not off him. */
  if (need > 1 && state && pid && def?.attribute === 'LIGHT' && faceUpOnSide(state, pid, 'kaiser-sea-horse')) {
    need -= 1;
  }
  // Toon monsters need no tribute while their controller has Toon World up —
  // this is the engine that makes Pegasus's deck work.
  // Asked of the whole side rather than the Spell/Trap Zone alone: Toon World
  // is a Field Spell in this game, so looking only where it used to sit would
  // have quietly reinstated the tribute cost it exists to remove.
  /* Bickuribox pays anyway. It is an ordinary monster in the hand and only
     becomes a Toon once it is standing on a field the book is open on, so the
     price of getting it there is the price a Level 7 costs — the cartoon does
     not reach back into your hand. The owner's ruling, and the reason it is
     the one monster on the roster the book does not make free. */
  if (need > 0 && state && pid && slug !== 'bickuribox' && toonActive(slug, faceUpOnSide(state, pid, 'toon-world'))) {
    need = 0;
  }
  return need;
}

export function monstersFrozen(state: DuelState, pid: PlayerId): boolean {
  return state.ongoing.some((o) => o.kind === 'freezeMonsters' && o.target === pid);
}

/**
 * What this effect's Life Point cost actually comes to, right now.
 *
 * Four places read `eff.cost.lp` directly — trap resolution, `canActivate`,
 * `activateSpell` and `activateSetCard` — which is exactly the shape of
 * duplicated rule this file keeps having to reunify. Tribute to the Doomed
 * prices itself off the opponent's hand, and a scale honoured in three of
 * those four places would have been a card that costs different amounts
 * depending on which zone you played it from.
 */
export function lpCost(state: DuelState, pid: PlayerId, eff: CardEffect): number {
  const base = eff.cost?.lp ?? 0;
  if (!base) return 0;
  if (eff.cost?.lpScale === 'perOppHandCard') return base * state.players[other(pid)].hand.length;
  return base;
}

export function canAttackWith(state: DuelState, pid: PlayerId, c: CardInstance): boolean {
  if (state.phase !== 'battle' || state.active !== pid || state.winner || state.pending) return false;
  if (state.turn === 1) return false;
  /* A God attacks through everything. Swords of Revealing Light, Nightmare's
     Steelcage, Spellbinding Circle, Shadow Spell — every one of them is a card
     effect, and no card effect touches a Divine-Beast. The lock still holds
     down every mortal monster beside it, which is what keeps those cards worth
     playing: they answer the board, they do not answer the God. */
  const divine = isDivine(c.slug);
  if (monstersFrozen(state, pid) && !divine) return false;
  // Held down by something on the field rather than by a timed lock, so it
  // lifts the instant that card is gone.
  const flags = effFlags(state, c, pid);
  if (flags.cannotAttack && !divine) return false;
  if (c.face === 'down' || c.position !== 'atk') return false;
  // Tokens have always waited a turn; `summonSick` is the same rule worn as
  // an aura — a Toon summoned for free under Toon World waits out the turn
  // it arrived, which is the window the opponent is given to answer it.
  if (c.summonedOnTurn === state.turn && (c.isToken || flags.summonSick)) return false;
  /* Two-Headed King Rex eating to swing is not checked here. It lives in
     `maxAttacks`, which caps the allowance at what the hand can pay for — so
     a starved King answers nought attacks and this last line refuses it on its
     own. A second copy of the rule here passed every test and proved nothing,
     which is how the two come to disagree later. */
  return c.attacksUsed < maxAttacks(state, c, pid);
}

export function legalAttackTargets(state: DuelState, pid: PlayerId, c: CardInstance): { uids: string[]; direct: boolean } {
  const opp = state.players[other(pid)];
  const monsters = opp.monsters.filter((m): m is CardInstance => !!m);
  const flags = effFlags(state, c, pid);
  /* The stare, asked before everything else. A monster demanding to be attacked
     is the only legal target on that side — including for an attacker that
     could otherwise walk straight past the board, which is the whole point:
     Thousand-Eyes Restrict answers a Toon as well as a Battle Ox. */
  const stare = monsters.filter((m) => m.face === 'up' && effFlags(state, m, other(pid)).mustBeAttacked);
  if (stare.length) return { uids: stare.map((m) => m.uid), direct: false };
  if (flags.directAttack) return { uids: monsters.map((m) => m.uid), direct: true };
  if (monsters.length === 0) return { uids: [], direct: true };
  if (flags.attackAll) {
    // Once each: a monster already visited this turn is off the menu while an
    // unvisited one remains. If every one has been visited, only the base
    // allowance can justify another swing, and then the field reopens.
    const visited = c.attacked ?? [];
    const freshOnes = monsters.filter((m) => !visited.includes(m.uid));
    return { uids: (freshOnes.length ? freshOnes : monsters).map((m) => m.uid), direct: false };
  }
  return { uids: monsters.map((m) => m.uid), direct: false };
}

/**
 * The monsters an effect's tribute cost may legally be paid with.
 *
 * One list, asked by the affordability check, the activation itself and the
 * picker the player sees — the same reason `summonBlocked` is one function.
 * Two of the three used to be a copy of the rule and they had already drifted.
 */
export function tributeFodder(state: DuelState, pid: PlayerId, eff: CardEffect, self?: string): CardInstance[] {
  const p = state.players[pid];
  if (eff.cost?.tributeSelf) {
    const c = p.monsters.find((m) => m?.uid === self);
    return c ? [c] : [];
  }
  return p.monsters.filter(
    (m): m is CardInstance => !!m && m.uid !== self && matchesFilter(m, eff.cost?.tributeFilter)
  );
}

/** True when the controller can pay an effect's activation cost right now. */
function canPayCost(state: DuelState, pid: PlayerId, eff: CardEffect, exclude?: string): boolean {
  const p = state.players[pid];
  if (eff.cost?.lp != null && p.lp <= lpCost(state, pid, eff)) return false;
  if (eff.cost?.tributeSelf) {
    // The card pays with itself, so there is nothing beside it to check.
  } else if (eff.cost?.tribute != null) {
    if (tributeFodder(state, pid, eff, exclude).length < eff.cost.tribute) return false;
  }
  if (eff.cost?.discard != null && p.hand.length - 1 < eff.cost.discard) return false;
  /* "at least 1 card" is the whole of Cannon Soldier's new price: an empty hand
     cannot load the cannon, so the button must be dark rather than firing for
     free. The hand this asks about excludes the card asking, for the same
     reason `cost.discard` does — a Spell in hand cannot pay with itself. */
  if (eff.cost?.discardHand && p.hand.filter((h) => h.uid !== exclude).length < 1) return false;
  if (eff.cost?.banishFromGrave && !p.grave.some((g) => g.slug === eff.cost!.banishFromGrave)) return false;
  return true;
}

/**
 * The costs that are neither Life Points nor bodies: your whole hand, and a
 * named card out of your own Graveyard.
 *
 * One function because both routes into an activated effect want them —
 * `payActivation` for Spells and Traps, the `ignition` action for monsters —
 * and those two paths have already drifted apart once over `cost.lp`. Returns
 * the reason it could not be paid, or null once it has been.
 */
function spendExtraCosts(
  state: DuelState,
  pid: PlayerId,
  c: CardInstance,
  eff: CardEffect | undefined
): string | null {
  const p = state.players[pid];
  /* The whole grip, and there has to be one — Cannon Soldier's cannon is loaded
     with everything you were holding, so an empty hand cannot fire it. Refused
     before anything is spent: a cost that half-pays and then gives up is how a
     player loses a hand for nothing. */
  if (eff?.cost?.discardHand) {
    const grip = p.hand.filter((h) => h.uid !== c.uid);
    if (!grip.length) return 'Your hand is empty.';
    for (const h of grip) {
      p.hand.splice(
        p.hand.findIndex((x) => x.uid === h.uid),
        1
      );
      landInGrave(state, h, pid);
      log(state, `${p.name} discards ${displayName(state, h)}.`, 'effect', pid, logSlug(h));
      anim(state, { kind: 'discard', uid: h.uid, slug: h.slug, player: pid });
    }
  }
  /* A named corpse, removed from the game. Pendulum Machine is assembled out of
     a Steel Ogre Grotto #1 that has already died once, and banishing rather
     than leaving it down there is what stops one body building every machine
     in the deck. */
  if (eff?.cost?.banishFromGrave) {
    const want = eff.cost.banishFromGrave;
    const idx = p.grave.findIndex((g) => g.slug === want);
    if (idx < 0) return `There is no ${card(want).name} in your Graveyard.`;
    const spent = p.grave.splice(idx, 1)[0];
    p.banished.push(spent);
    log(state, `${card(want).name} is banished from the Graveyard.`, 'effect', pid, logSlug(spent));
    anim(state, { kind: 'activate', uid: spent.uid, slug: spent.slug, player: pid, reports: true, text: 'BANISHED' });
  }
  return null;
}

/** Cards in hand this player may activate right now. */
/**
 * A Spell that stays on the field and does its work by simply being there —
 * an aura, or something that fires on a later trigger. It has no `activate`
 * effect to resolve, so activation is nothing more than putting it down.
 */
function isPassiveSpell(def: CardDef): boolean {
  if (def.kind !== 'spell') return false;
  if (def.subKind !== 'Continuous' && def.subKind !== 'Field') return false;
  return def.effects.length > 0;
}

/**
 * Ops whose whole job is to act on a card that is already there. Playing one
 * with nothing to act on spends the card for nothing.
 */
const NEEDS_A_TARGET = new Set([
  'destroy',
  'bounce',
  'banish',
  'takeControl',
  'negateEffects',
  'absorb',
  'shuffleIntoDeck',
  'halveAtk',
  'swapAtkDef',
  'setAtk',
  'gainAtk',
  'gainDef',
  'forceDefense',
  'forceAttackPosition',
  'flipFaceUp',
  'equipTo',
]);

/** Picks that read a pool of cards, as opposed to one the context supplies. */
const POOL_PICKS = new Set(['chosen', 'all', 'strongest', 'weakest', 'random']);

/**
 * Ops that take a card without changing the board — the compensation clause
 * bolted onto the end of a card, never the reason to play it.
 */
const RIDER_OPS = new Set(['draw', 'mill', 'search', 'revealHand']);

/** Is there anything this selector could legally reach right now? */
function hasLegalTarget(ctx: EffectCtx, s: Selector): boolean {
  if (!POOL_PICKS.has(s.pick)) return true; // the context supplies it, not a pool
  const zone = s.zone ?? 'monster';
  return targetPool(ctx, s).some((c) => zone !== 'monster' || !isProtectedTarget(ctx.state, c, ctx.controller, ctx));
}

/**
 * Would activating this card do nothing at all?
 *
 * Mai kept playing De-Spell — "Destroy 1 Spell or Trap your opponent controls,
 * then draw 1 card" — at an empty Spell/Trap Zone, because the draw works
 * whatever happens and nothing asked whether the destroy had anything to
 * destroy.
 *
 * Judging the *leading* op alone looked like the obvious rule and refused
 * three cards that were doing their job: Harpie's Feather Duster clears the
 * Field Zone with its second op when the Spell/Trap Zone is empty, Swords of
 * Revealing Light's point is the three-turn freeze behind a flip that may hit
 * nothing, and Harpie's Hunting Ground is a Field Spell whose aura is the
 * whole card and whose destroy is the rider. So the question is asked of the
 * effect as a whole: dead only if every targeting op has an empty pool, every
 * remaining op is a rider, and the card leaves nothing standing on the field.
 *
 * The pool is checked directly rather than through `resolveTargets`, whose
 * `chosen` branch falls back to the strongest card in the *unfiltered* pool
 * before dropping protected ones — so a single untargetable top-ATK monster
 * (Blue-Eyes Toon Dragon under Toon World) hid every legal target behind it
 * and made seven Spells unplayable for the rest of the duel.
 */
function activationIsDead(state: DuelState, pid: PlayerId, c: CardInstance, def: CardDef, eff: CardEffect): boolean {
  const ctx: EffectCtx = { state, controller: pid, source: c, targets: [], cursor: 0, trig: {} };
  let sawTargeting = false;
  for (const op of eff.ops) {
    if (!NEEDS_A_TARGET.has(op.op)) {
      if (!RIDER_OPS.has(op.op)) return false; // something substantive happens regardless
      continue;
    }
    /* An equip with no selector of its own attaches to one of the controller's
       own monsters, so that is its pool. */
    const sel: Selector =
      'target' in op && op.target ? op.target : { side: 'own', pick: 'all' };
    sawTargeting = true;
    if (hasLegalTarget(ctx, sel)) return false;
  }
  if (!sawTargeting) return false;
  // A card that stays on the field is never spent for nothing.
  if (def.effects.some((e) => e.trigger === 'continuous' && e.aura)) return false;
  return true;
}

/**
 * Would spending this card achieve nothing at all?
 *
 * Exported because the board needs the same answer and had been working one out
 * for itself: "the picker offered nothing, so refuse". That is right for Ring of
 * Destruction against a lone untargetable monster, and wrong for a card whose
 * worth is the aura it leaves behind — Toon World with no Toon left in the Deck
 * still opens, and the search simply finds nothing. Reported as "it says there
 * is nothing this card can target and won't activate".
 *
 * `activationIsDead` already knew that (a card with a continuous aura is never
 * spent for nothing); the board's copy of the rule did not. One rule, one place,
 * for the same reason `matchesFilter` is now one function.
 */
export function wastedWithoutTarget(state: DuelState, pid: PlayerId, c: CardInstance, trigger: Trigger): boolean {
  const def = CARDS[c.slug];
  const eff = def?.effects.find((e) => e.trigger === trigger);
  if (!def || !eff) return false;
  return activationIsDead(state, pid, c, def, eff);
}

export function canActivateFromHand(state: DuelState, pid: PlayerId, c: CardInstance): boolean {
  if (state.phase !== 'main' || state.active !== pid || state.winner || state.pending) return false;
  const def = CARDS[c.slug];
  if (!def || def.kind === 'monster') return false;
  if (def.kind === 'trap') return false; // traps must be set first
  if (def.slug === 'polymerization') return false; // used via the Fusion button
  const eff = def.effects.find((e) => e.trigger === 'activate');
  /* A Continuous or Field Spell whose whole effect is an aura has nothing to
     resolve on activation — putting it on the field *is* the activation. They
     used to be judged by the same "has an `activate` trigger" rule as one-shot
     Spells and so could never be played at all: The Dark Door, Dark Sanctuary
     and Umi sat dead in their owners' hands. */
  if (!eff && !isPassiveSpell(def)) return false;
  if (eff && !canPayCost(state, pid, eff)) return false;
  /* Spells can carry a condition too. Traps and triggers already went through
     `conditionMet`; a Spell's condition was silently ignored here, so a card
     saying "if you control a Winged Beast" would have activated bare. */
  if (eff?.condition && !conditionMet(state, eff, c, pid)) return false;
  if (eff && activationIsDead(state, pid, c, def, eff)) return false;
  const p = state.players[pid];
  if (def.subKind === 'Field') return true; // field zone is separate
  return p.spellTrap === null;
}

/** True when this face-down Spell/Trap can be flipped up by its controller now. */
export function canActivateSetCard(state: DuelState, pid: PlayerId, c: CardInstance): boolean {
  if (state.phase !== 'main' || state.active !== pid || state.winner || state.pending) return false;
  if (c.face !== 'down') return false;
  const def = CARDS[c.slug];
  if (!def) return false;
  if (def.kind === 'trap') {
    if (c.summonedOnTurn >= state.turn) return false;
    return def.effects.some((e) => e.trigger === 'trap' && e.window === 'anyOpponentTurn');
  }
  const eff = def.effects.find((e) => e.trigger === 'activate');
  if (!eff) return false;
  if (eff.condition && !conditionMet(state, eff, c, pid)) return false;
  return canPayCost(state, pid, eff) && !activationIsDead(state, pid, c, def, eff);
}

export function canChangePosition(state: DuelState, pid: PlayerId, c: CardInstance): boolean {
  if (state.phase !== 'main' || state.active !== pid || state.winner || state.pending) return false;
  if (monstersFrozen(state, pid)) return false;
  if (c.positionChangedOnTurn === state.turn) return false;
  return c.summonedOnTurn !== state.turn;
}

/**
 * Whether a card sitting in a hand may call itself onto the field right now,
 * and what it would cost.
 *
 * One function because three callers ask: the button in the hand, the AI, and
 * the `handSummon` action that actually does it. The button used to work the
 * price out for itself and priced every such card at "discard 1" — true of the
 * batch that introduced the trigger and of nothing since.
 */
export function handSummonOffer(
  state: DuelState,
  pid: PlayerId,
  c: CardInstance
): { discard: number; banish?: string; ok: boolean; why?: string } | null {
  const eff = CARDS[c.slug]?.effects.find((e) => e.trigger === 'handSummon');
  if (!eff) return null;
  const p = state.players[pid];
  const discard = eff.cost?.discard ?? 0;
  const banish = eff.cost?.banishFromGrave;
  const deny = (why: string) => ({ discard, banish, ok: false, why });
  if (state.phase !== 'main' || state.active !== pid) return deny('Only during your Main Phase.');
  if (p.monsters.every((m) => !!m)) return deny('No free Monster Zone.');
  if (eff.condition && !conditionMet(state, eff, c, pid)) return deny('Its condition is not met.');
  if (p.hand.filter((h) => h.uid !== c.uid).length < discard) return deny('Nothing left in hand to discard.');
  if (banish && !p.grave.some((g) => g.slug === banish)) return deny(`No ${card(banish).name} in your Graveyard.`);
  return { discard, banish, ok: true };
}

export function canIgnite(state: DuelState, pid: PlayerId, c: CardInstance): boolean {
  if (state.phase !== 'main' || state.active !== pid || state.winner || state.pending) return false;
  if (c.face === 'down' || c.flags.negated) return false;
  const def = CARDS[c.slug];
  const eff = def?.effects.find((e) => e.trigger === 'ignition');
  if (!eff) return false;
  if (!canPayCost(state, pid, eff, c.uid)) return false;
  /* A condition is as much a gate as a cost, and this never asked. No ignition
     carried one until the Ultimate Dragon — which spends a Blue-Eyes out of
     the Graveyard — so an empty pile would have let the button be pressed for
     free removal with nothing paid. Offering an effect that cannot honour its
     own first half is the "card looks inert" trap from the other direction. */
  if (!conditionMet(state, eff, c, pid)) return false;
  return c.effectUsedOnTurn !== state.turn;
}

/**
 * Which cards a Fusion may be built from, and what it costs to reach them.
 *
 * Polymerization is what reaches into the hand. A free Fusion — the Magnet
 * Warriors, who combine with no card spent because there is no Fusion card in
 * the anime when Yugi calls them — assembles from the *field alone*: three
 * bodies already standing, which is a real board commitment rather than three
 * cards falling out of a hand. Spending the Polymerization is what buys the
 * shortcut, so the card still has a job in the deck that owns it.
 */
function fusionSources(state: DuelState, pid: PlayerId) {
  const p = state.players[pid];
  return {
    field: p.monsters.filter((m): m is CardInstance => !!m && m.face === 'up'),
    withHand: [...p.monsters.filter((m): m is CardInstance => !!m && m.face === 'up'), ...p.hand],
    polyIndex: p.hand.findIndex((h) => h.slug === 'polymerization'),
    /* Spending the Polymerization *is* activating a Normal Spell, so it needs
       somewhere to be activated. Every other Spell in the game asks
       `p.spellTrap === null` and this route asked nothing at all — so with a
       Continuous Spell, an Equip or even a face-down Set already sitting in
       the one zone, a Fusion still went through. Reported from a real duel.
       A free assembly is unaffected: no card is spent, so no zone is wanted. */
    stFree: p.spellTrap === null,
  };
}

/**
 * Matches a recipe against a pool, preferring the cards the player named.
 *
 * One function because both the enumeration the button and the AI read and the
 * action that really performs the summon need the same answer — and they were
 * two copies of it, which is exactly how `summonBlocked` came to drift.
 */
function matchRecipe(recipe: string[], pool: CardInstance[], prefer: string[] = []): CardInstance[] | null {
  const remaining = [...pool];
  const chosen: CardInstance[] = [];
  for (const need of recipe) {
    const wanted = remaining.findIndex((c) => c.slug === need && prefer.includes(c.uid));
    const any = wanted >= 0 ? wanted : remaining.findIndex((c) => c.slug === need);
    if (any < 0) return null;
    chosen.push(remaining[any]);
    remaining.splice(any, 1);
  }
  return chosen;
}

/**
 * How a Fusion can be summoned right now: from the field for free, or from the
 * field and hand by spending a Polymerization. The free route is preferred
 * whenever it is available, because it costs nothing.
 */
export function fusionRoute(
  state: DuelState,
  pid: PlayerId,
  slug: string,
  prefer: string[] = []
): { materials: CardInstance[]; spendPoly: number } | null {
  const def = CARDS[slug];
  const recipe = def?.fusionMaterials;
  if (!recipe?.length) return null;
  const { field, withHand, polyIndex, stFree } = fusionSources(state, pid);
  if (def.fusionFree) {
    const onField = matchRecipe(recipe, field, prefer);
    if (onField) return { materials: onField, spendPoly: -1 };
  }
  if (polyIndex < 0 || !stFree) return null;
  const anywhere = matchRecipe(recipe, withHand, prefer);
  return anywhere ? { materials: anywhere, spendPoly: polyIndex } : null;
}

export function fusionOptions(state: DuelState, pid: PlayerId): { extraUid: string; materials: string[] }[] {
  const out: { extraUid: string; materials: string[] }[] = [];
  for (const ex of state.players[pid].extra) {
    const route = fusionRoute(state, pid, ex.slug);
    if (route) out.push({ extraUid: ex.uid, materials: route.materials.map((c) => c.uid) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Action application                                                  */
/* ------------------------------------------------------------------ */

/**
 * How many animation events stay readable after the action that produced them.
 *
 * Every action used to clear the list outright, which is correct only if the
 * client sees every single version. It does not: the computer plays one action
 * per nudge while the poll loop runs on its own timer, so a poll landing after
 * two AI actions jumped a version — and the skipped action's events had already
 * been destroyed. A whole turn of summons and attacks arrived as nothing but
 * its final beat, which is exactly "I just saw their fusion on the board".
 *
 * Keeping a short tail costs a few hundred bytes in the saved room and lets a
 * client that missed a version still receive what happened. Ids are unique per
 * version, and the client already ignores any it has played.
 */
const ANIM_HISTORY = 48;

/**
 * Applies an action, then makes sure everything it wrote to the log gets said
 * out loud on the field.
 *
 * The wrapper exists because the inner function returns from nine places; a
 * sweep at each one would be nine chances to forget.
 */
export function applyAction(prev: DuelState, pid: PlayerId, action: DuelAction): { state: DuelState; error?: string } {
  const res = applyActionInner(prev, pid, action);
  if (!res.error) {
    /* The last word on the Forbidden One, and the only place that can be.
       Now that a piece counts from a Monster Zone, the fifth one can arrive by
       Normal Summon, Special Summon, Fusion material returning, a flip, a
       change of control — and the scattered `checkExodia` calls inside the
       resolver cover the draws and searches they were written for, not those.
       Rather than chase every arrival, every completed action ends here.
       It is idempotent: the first line returns if the duel is already won. */
    checkExodia(res.state);
    speakRemainingLog(res.state);
  }
  return res;
}

function applyActionInner(prev: DuelState, pid: PlayerId, action: DuelAction): { state: DuelState; error?: string } {
  const state: DuelState = structuredClone(prev);
  state.anims = state.anims.slice(-ANIM_HISTORY);
  state.version += 1;

  if (state.winner) return { state: prev, error: 'The duel is already over.' };

  // While a window is open, only that player may act, and only to answer it.
  if (state.pending) {
    if (state.pending.player !== pid) return { state: prev, error: 'Not your response.' };
    if (state.pending.kind === 'choose') {
      if (action.type !== 'chooseCard') return { state: prev, error: 'Waiting for you to choose.' };
      return { state: handleChoice(state, pid, action.uids) };
    }
    if (action.type !== 'respondTrap') return { state: prev, error: 'Waiting for a response.' };
    return { state: handleTrapResponse(state, pid, action.uid, action.targets ?? []) };
  }

  if (action.type === 'surrender') {
    state.winner = other(pid);
    state.winReason = `${state.players[pid].name} surrendered.`;
    log(state, `${state.players[pid].name} surrenders.`, 'system', pid);
    anim(state, { kind: 'win' });
    return { state };
  }

  if (state.active !== pid) return { state: prev, error: 'It is not your turn.' };

  const p = state.players[pid];

  switch (action.type) {
    case 'normalSummon': {
      if (state.phase !== 'main') return { state: prev, error: 'You can only summon during your Main Phase.' };
      if (p.normalSummonUsed) return { state: prev, error: 'You have already Normal Summoned this turn.' };
      const hi = p.hand.findIndex((h) => h.uid === action.uid);
      if (hi < 0) return { state: prev, error: 'Card is not in your hand.' };
      const c = p.hand[hi];
      const def = CARDS[c.slug];
      if (!def || def.kind !== 'monster') return { state: prev, error: 'That is not a monster.' };
      const blocked = summonBlocked(state, pid, c.slug);
      if (blocked) return { state: prev, error: blocked };
      // `Number.isInteger` first, and it is not belt-and-braces: an action
      // arriving with no zone at all sailed through `undefined < 0 ||
      // undefined >= 3` — both false — and the summon then wrote to
      // `p.monsters[undefined]` after the card had already been spliced out of
      // the hand. The card simply vanished, with no error and nothing on the
      // field. Actions come off the network, so this is the boundary.
      if (!Number.isInteger(action.zone) || action.zone < 0 || action.zone >= MONSTER_ZONES) {
        return { state: prev, error: 'Invalid Monster Zone.' };
      }
      const need = tributesRequired(c.slug, state, pid);
      const tributes = (action.tributes ?? []).slice(0, need);
      /* Parrot Dragon's bargain: come out now for none of the price and half of
         the body. Only the whole cost may be skipped — paying one of two and
         keeping full stats is not on offer — and only by a card that says so. */
      const forgoing = need > 0 && tributes.length === 0 && !!def.mayForgoTributes;
      if (tributes.length < need && !forgoing) {
        return { state: prev, error: `This monster requires ${need} tribute(s).` };
      }
      for (const tu of tributes) {
        const t = p.monsters.find((m) => m?.uid === tu);
        if (!t) return { state: prev, error: 'Invalid tribute.' };
      }
      // The destination may currently hold a monster that is about to be
      // tributed — that is legal, and is the normal case on a full field.
      const occupant = p.monsters[action.zone];
      if (occupant && !tributes.includes(occupant.uid)) {
        return { state: prev, error: 'That Monster Zone is occupied.' };
      }
      /* Read *before* the tributes are paid, because a moment later they are
         in the Graveyard and the number is gone. Effective stats, not printed
         ones, so a monster standing in a buff is worth what it was worth on
         the board — and there is no recursion to fear: these are other cards,
         totalled before the God they are paying for exists. */
      let paidAtk = 0;
      let paidDef = 0;
      if (def.statsFromTributes) {
        for (const tu of tributes) {
          const t = p.monsters.find((m) => m?.uid === tu)!;
          paidAtk += effAtk(state, t, pid);
          paidDef += effDef(state, t, pid);
        }
      }
      /* Held back until the monster they bought is standing. See
         `PendingDeparture`: a painting that lets three of itself out on the way
         to the Graveyard used to fill the very zone the Summon was headed for,
         and the Summon was then refused for want of a zone. */
      const departures: PendingDeparture[] = [];
      for (const tu of tributes) {
        const paid = p.monsters.find((m) => m?.uid === tu)!;
        log(state, `${p.name} tributes ${displayName(state, paid)}.`, 'summon', pid, logSlug(paid));
        toGrave(state, tu, true, false, departures);
      }
      /* Paying the tributes can put something back on the board — a Chimera
         coming apart, a trap answering the departure — and the zone chosen
         before the payment may no longer be the free one. Refusing there is
         the worst outcome: the tributes are already gone and the summon they
         bought is denied. Any free zone will do, exactly as the Fusion path
         has always done it, and only a genuinely full board is refused. */
      const dest = p.monsters[action.zone] ? p.monsters.findIndex((m) => !m) : action.zone;
      if (dest < 0) return { state: prev, error: 'That Monster Zone is occupied.' };

      p.hand.splice(hi, 1);
      c.position = action.face === 'down' ? 'def' : action.position;
      c.face = action.face;
      c.summonedOnTurn = state.turn;
      // This one paid its Tributes. A God summoned properly stays.
      c.specialSummonedOnTurn = undefined;
      c.attacksUsed = 0;
      c.attacked = [];
      /* The God is worth what was spent on it. Written as a modifier on a 0
         base rather than as a live aura, because what it counts is gone: the
         three monsters are in the Graveyard before the number is ever read. */
      if (def.statsFromTributes) {
        c.atkMod = paidAtk;
        c.defMod = paidDef;
      }
      /* Half the body, permanently, and only on the summon that skipped the
         price. A modifier rather than an aura, because the halving is a fact
         about how this one arrived and must not follow the card back out. */
      if (forgoing) {
        c.atkMod -= Math.floor(baseAtk(c.slug) / 2);
        c.defMod -= Math.floor(baseDef(c.slug) / 2);
      }
      p.monsters[dest] = c;
      p.normalSummonUsed = true;

      if (c.face === 'up') {
        /* `displayName`, not the printed name: a drawing Normal Summoned under
           an open Toon World is announced as the Toon it arrives as. The Flip
           Summon line beside this one already did. */
        log(state, `${p.name} Normal Summons ${displayName(state, c)}!`, 'summon', pid);
        anim(state, { kind: 'summon', uid: c.uid, slug: c.slug, player: pid });
        fireDepartures(state, departures);
        fireTriggers(state, c, pid, 'onSummon', {}, action.targets ?? []);
        fireTriggers(state, c, pid, 'onNormalSummon', {}, action.targets ?? []);
      } else {
        log(state, `${p.name} sets a monster.`, 'summon', pid);
        anim(state, { kind: 'summon', uid: c.uid, player: pid });
        fireDepartures(state, departures);
      }
      /* Setting a monster face-down is not a Summon, and opened this window
         anyway — so Trap Hole went off on a Set, and the prompt announced the
         card by name while it was still face-down, which is the opposite of
         what setting one is for. */
      if (!state.winner && c.face === 'up') {
        fireOpponentSummon(state, pid, c.uid);
        fireAllySummon(state, pid, c.uid);
        openTrapWindow(state, other(pid), 'opponentNormalSummon', `${p.name} summoned ${def.name}.`, { attackerUid: c.uid });
      }
      return { state };
    }

    case 'changePosition': {
      if (state.phase !== 'main') return { state: prev, error: 'Only during your Main Phase.' };
      if (monstersFrozen(state, pid)) return { state: prev, error: 'Your monsters cannot change position.' };
      const c = p.monsters.find((m) => m?.uid === action.uid);
      if (!c) return { state: prev, error: 'Monster not found.' };
      if (c.summonedOnTurn === state.turn) return { state: prev, error: 'It was summoned this turn.' };
      if (c.positionChangedOnTurn === state.turn) {
        return { state: prev, error: 'It has already changed position this turn.' };
      }
      c.positionChangedOnTurn = state.turn;
      if (c.face === 'down') {
        c.face = 'up';
        c.position = 'atk';
        log(state, `${p.name} Flip Summons ${displayName(state, c)}!`, 'summon', pid, logSlug(c));
        anim(state, { kind: 'flip', uid: c.uid, slug: c.slug, player: pid });
        /* The player turned it over deliberately, in their own Main Phase, so
           the FLIP effect has somebody to ask and the answer travels with the
           action. Reported of Man-Eater Bug: "the effect should allow me to
           select which monster" — it always could, and nothing ever handed the
           choice down, so the engine fell back to picking for you every time.
           Flipped by an attack there is still nobody to ask, and that path is
           deliberately unchanged. */
        fireTriggers(state, c, pid, 'onFlip', {}, action.targets ?? []);
        fireTriggers(state, c, pid, 'onSummon', {}, action.targets ?? []);
        // A Flip Summon is a Normal Summon, so it pays those bonuses too.
        fireTriggers(state, c, pid, 'onNormalSummon', {}, action.targets ?? []);
      } else {
        c.position = c.position === 'atk' ? 'def' : 'atk';
        log(state, `${displayName(state, c)} switches to ${c.position === 'atk' ? 'Attack' : 'Defense'} Position.`, 'normal', pid, logSlug(c));
      }
      return { state };
    }

    case 'activateSpell': {
      if (state.phase !== 'main') return { state: prev, error: 'Only during your Main Phase.' };
      const hi = p.hand.findIndex((h) => h.uid === action.uid);
      if (hi < 0) return { state: prev, error: 'Card is not in your hand.' };
      const c = p.hand[hi];
      const def = CARDS[c.slug];
      if (!def || def.kind !== 'spell') return { state: prev, error: 'That is not a Spell.' };
      const eff = def.effects.find((e) => e.trigger === 'activate');
      // No `activate` effect is fine for a Continuous or Field Spell: it works
      // by sitting on the field, so playing it is the whole of the activation.
      if (!eff && !isPassiveSpell(def)) return { state: prev, error: 'That card cannot be activated.' };
      /* Refused with a reason rather than spent for nothing. The interface
         already hides the card, so this only catches a tap that raced the
         board — but a Spell that leaves the hand having done nothing is the
         worst way to find out. */
      const isField = def.subKind === 'Field';
      // An Equip Spell stays face-up in the Spell/Trap Zone holding its monster,
      // exactly like a Continuous Spell — it is not spent on activation.
      const isContinuous = def.subKind === 'Continuous' || isField || isEquipSpell(c.slug);
      if (!isField && p.spellTrap) return { state: prev, error: 'Your Spell/Trap Zone is occupied.' };

      const paid = payActivation(state, pid, c, def, eff, action.targets ?? []);
      if ('error' in paid) return { state: prev, error: paid.error };
      const paidForCost = paid.paidForCost;

      const hi2 = p.hand.findIndex((h) => h.uid === action.uid);
      if (hi2 >= 0) p.hand.splice(hi2, 1);

      log(state, `${p.name} activates ${def.name}!`, 'effect', pid);
      anim(state, { kind: 'activate', uid: c.uid, slug: c.slug, player: pid, text: def.cry });

      if (isField) {
        if (p.field) toGrave(state, p.field.uid, true);
        c.face = 'up';
        p.field = c;
      } else if (isContinuous) {
        c.face = 'up';
        p.spellTrap = c;
      }

      if (eff) {
        /* Minus whatever the cost already ate — see `paidForCost`. */
        const forOps = (action.targets ?? []).filter((u) => !paidForCost.includes(u));
        const ctx: EffectCtx = { state, controller: pid, source: c, targets: forOps, cursor: 0, trig: {} };
        runOps(ctx, eff.ops);
      }

      if (!isContinuous && !isField) {
        // One-shot spells go straight to the Graveyard.
        landInGrave(state, c, pid);
      }
      checkExodia(state);
      return { state };
    }

    case 'setSpellTrap': {
      if (state.phase !== 'main') return { state: prev, error: 'Only during your Main Phase.' };
      if (p.spellTrap) return { state: prev, error: 'Your Spell/Trap Zone is occupied.' };
      const hi = p.hand.findIndex((h) => h.uid === action.uid);
      if (hi < 0) return { state: prev, error: 'Card is not in your hand.' };
      const c = p.hand[hi];
      const def = CARDS[c.slug];
      if (!def || def.kind === 'monster') return { state: prev, error: 'Only Spells and Traps can be set there.' };
      p.hand.splice(hi, 1);
      c.face = 'down';
      c.summonedOnTurn = state.turn;
      p.spellTrap = c;
      log(state, `${p.name} sets a card.`, 'normal', pid);
      anim(state, { kind: 'summon', uid: c.uid, player: pid });
      return { state };
    }

    case 'activateSetCard': {
      if (state.phase !== 'main') return { state: prev, error: 'Only during your Main Phase.' };
      const c = p.spellTrap;
      if (!c || c.uid !== action.uid || c.face !== 'down') return { state: prev, error: 'No set card there.' };
      const def = CARDS[c.slug];
      if (def.kind === 'trap') {
        if (c.summonedOnTurn >= state.turn) return { state: prev, error: 'You cannot activate a Trap the turn you set it.' };
        const usable = def.effects.some((e) => e.trigger === 'trap' && e.window === 'anyOpponentTurn');
        if (!usable) return { state: prev, error: 'This Trap can only be activated in response to your opponent.' };
        activateTrapCard(state, pid, c.uid, action.targets ?? [], {});
        checkExodia(state);
        return { state };
      }
      // Set Spell — activate it now, on the same terms as one played from hand.
      const eff = def.effects.find((e) => e.trigger === 'activate');
      if (!eff) return { state: prev, error: 'That card cannot be activated.' };
      /* This path used to skip the gate entirely: no condition, no Life Points,
         no discard, no Tributes. The same card was priced from the hand and
         free off the field — a Ritual Spell Set face-down summoned without its
         Tribute, and Tribute to the Doomed took nothing at all. */
      const setPaid = payActivation(state, pid, c, def, eff, action.targets ?? []);
      if ('error' in setPaid) return { state: prev, error: setPaid.error };
      log(state, `${p.name} activates ${def.name}!`, 'effect', pid);
      anim(state, { kind: 'activate', uid: c.uid, slug: c.slug, player: pid, text: def.cry });
      /* Minus whatever the cost already ate, exactly as the hand path does. */
      const setTargets = (action.targets ?? []).filter((u) => !setPaid.paidForCost.includes(u));
      const ctx: EffectCtx = { state, controller: pid, source: c, targets: setTargets, cursor: 0, trig: {} };
      runOps(ctx, eff.ops);
      if (def.subKind !== 'Continuous') {
        p.spellTrap = null;
        landInGrave(state, c, pid);
      } else {
        c.face = 'up';
      }
      return { state };
    }

    case 'discardForEffect': {
      /* Spent from the hand, not summoned. The card never touches the field:
         it goes to the Graveyard and its effect resolves from there, which is
         why the ops run against a source that is already gone. */
      if (state.phase !== 'main') return { state: prev, error: 'Only during your Main Phase.' };
      const hi = p.hand.findIndex((h) => h.uid === action.uid);
      if (hi < 0) return { state: prev, error: 'Card is not in your hand.' };
      const c = p.hand[hi];
      const eff = CARDS[c.slug]?.effects.find((e) => e.trigger === 'handDiscard');
      if (!eff) return { state: prev, error: 'That card cannot be discarded for an effect.' };
      if (eff.condition && !conditionMet(state, eff, c, pid)) return { state: prev, error: 'Its condition is not met.' };

      p.hand.splice(hi, 1);
      log(state, `${p.name} discards ${displayName(state, c)}.`, 'effect', pid, logSlug(c));
      anim(state, { kind: 'discard', uid: c.uid, slug: c.slug, player: pid });
      landInGrave(state, c, pid);
      runOps({ state, controller: pid, source: c, targets: action.targets ?? [], cursor: 0, trig: {} }, eff.ops);
      checkExodia(state);
      return { state };
    }
    case 'handSummon': {
      /* The opposite of `discardForEffect`: something else in the hand is spent
         so that *this* card arrives. The summon is an op rather than a step
         written here, so the card decides which way up it lands and what else
         happens on the way in. */
      if (state.phase !== 'main') return { state: prev, error: 'Only during your Main Phase.' };
      const hi = p.hand.findIndex((h) => h.uid === action.uid);
      if (hi < 0) return { state: prev, error: 'Card is not in your hand.' };
      const c = p.hand[hi];
      const eff = CARDS[c.slug]?.effects.find((e) => e.trigger === 'handSummon');
      if (!eff) return { state: prev, error: 'That card cannot be Special Summoned from your hand.' };
      if (eff.condition && !conditionMet(state, eff, c, pid)) return { state: prev, error: 'Its condition is not met.' };
      if (p.monsters.every((m) => !!m)) return { state: prev, error: 'Your Monster Zones are full.' };
      /* Banishing a named body is a price like any other, so it is refused
         before the discard is taken rather than after — otherwise a Pendulum
         Machine with no Steel Ogre Grotto down there eats a card and stays in
         the hand. */
      const banishCost = spendExtraCosts(state, pid, c, eff);
      if (banishCost) return { state: prev, error: banishCost };
      const need = eff.cost?.discard ?? 0;
      if (need > 0) {
        /* Paid out of the rest of the hand — never with the card that is
           arriving, which would leave nothing to summon. */
        const payable = p.hand.filter((h) => h.uid !== c.uid);
        if (payable.length < need) return { state: prev, error: 'Not enough cards in hand to pay for it.' };
        const named = (action.discardUid ? [payable.find((h) => h.uid === action.discardUid)] : [])
          .filter((h): h is CardInstance => !!h);
        const paying = [...named, ...payable.filter((h) => !named.includes(h))].slice(0, need);
        for (const fed of paying) {
          p.hand.splice(p.hand.indexOf(fed), 1);
          landInGrave(state, fed, pid);
          log(state, `${p.name} discards ${displayName(state, fed)}.`, 'effect', pid, logSlug(fed));
          anim(state, { kind: 'discard', uid: fed.uid, slug: fed.slug, player: pid });
        }
      }
      runOps({ state, controller: pid, source: c, targets: action.targets ?? [], cursor: 0, trig: {} }, eff.ops);
      checkExodia(state);
      return { state };
    }
    case 'ignition': {
      if (state.phase !== 'main') return { state: prev, error: 'Only during your Main Phase.' };
      const c = p.monsters.find((m) => m?.uid === action.uid) ?? (p.field?.uid === action.uid ? p.field : null);
      if (!c) return { state: prev, error: 'Card not found on your field.' };
      if (!canIgnite(state, pid, c)) return { state: prev, error: 'That effect is not available right now.' };
      const def = CARDS[c.slug];
      const eff = def.effects.find((e) => e.trigger === 'ignition');
      if (!eff) return { state: prev, error: 'No activated effect.' };
      if (eff.cost?.lp) {
        const due = lpCost(state, pid, eff);
        if (p.lp <= due) return { state: prev, error: 'Not enough Life Points.' };
        p.lp -= due;
        log(state, `${p.name} pays ${due} Life Points.`, 'effect', pid);
        /* A cost is still Life Points leaving, so it is announced like any
           other. The total must never move with nothing on screen saying why —
           that is exactly what made damage look like it landed early. */
        anim(state, { kind: 'damage', player: pid, amount: eff.cost.lp });
      }
      const extraCost = spendExtraCosts(state, pid, c, eff);
      if (extraCost) return { state: prev, error: extraCost };
      /* What the cost ate, kept so an op can be worth what it cost — Catapult
         Turtle throws a monster and it lands for that monster's ATK. Read
         *before* the tribute, because a card in the Graveyard has no
         effective stats to read. */
      const tributedAtk: number[] = [];
      const sourceCounters = c.counters;
      if (eff.cost?.tribute || eff.cost?.tributeSelf) {
        const fodder = tributeFodder(state, pid, eff, c.uid);
        const need = eff.cost.tributeSelf ? 1 : (eff.cost.tribute ?? 0);
        if (fodder.length < need) return { state: prev, error: 'Not enough monsters to tribute.' };
        /* Whichever ones the player pointed at, and only then whatever is
           left. It always took the first monster in the row before, so
           Catapult Turtle launched whoever happened to be standing in zone 0
           rather than the one you chose — invisible while the damage was a
           flat 1000, and the whole card once it is worth what it throws. */
        const chosen = (action.targets ?? [])
          .map((uid) => fodder.find((m) => m.uid === uid))
          .filter((m): m is CardInstance => !!m);
        const paying = [...chosen, ...fodder.filter((m) => !chosen.includes(m))].slice(0, need);
        for (const m of paying) {
          tributedAtk.push(effAtk(state, m, pid));
          toGrave(state, m.uid, true);
        }
      }
      c.effectUsedOnTurn = state.turn;
      log(state, `${p.name} activates ${def.name}'s effect!`, 'effect', pid);
      anim(state, { kind: 'activate', uid: c.uid, slug: c.slug, player: pid, text: def.cry ?? eff.label });
      const ctx: EffectCtx = { state, controller: pid, source: c, targets: action.targets ?? [], cursor: 0, trig: {}, tributedAtk, counters: sourceCounters };
      runOps(ctx, eff.ops);
      return { state };
    }

    case 'fusionSummon': {
      if (state.phase !== 'main') return { state: prev, error: 'Only during your Main Phase.' };
      const ex = p.extra.find((e) => e.uid === action.extraUid);
      if (!ex) return { state: prev, error: 'Fusion monster not found.' };
      /* One question, asked once: what can this Fusion actually be built from
         right now? The free route reads the field alone, the Polymerization
         route reaches the hand as well, and `fusionRoute` prefers the free one
         because it costs nothing. The button, the AI and this all ask it. */
      const route = fusionRoute(state, pid, ex.slug, action.materials ?? []);
      if (!route) {
        const free = !!CARDS[ex.slug]?.fusionFree;
        const noPoly = p.hand.every((h) => h.slug !== 'polymerization');
        /* Name the reason it really failed. A full Spell/Trap Zone used to
           come back as "You do not have the Fusion Materials", which is a lie
           about the cards in your hand and sends you looking in the wrong
           place. Order matters: the zone is only the answer once a
           Polymerization is actually being spent. */
        return {
          state: prev,
          error:
            free && noPoly
              ? 'All three must be on the field, or use Polymerization to bring one from your hand.'
              : noPoly
                ? 'You need Polymerization.'
                : p.spellTrap
                  ? 'Your Spell/Trap Zone is occupied — Polymerization has nowhere to be activated.'
                  : 'You do not have the Fusion Materials.',
        };
      }
      const chosen = route.materials;
      // Same reason as the Normal Summon above: a missing zone must be refused
      // before anything is spent, not indexed with.
      if (!Number.isInteger(action.zone) || action.zone < 0 || action.zone >= MONSTER_ZONES) {
        return { state: prev, error: 'Invalid zone.' };
      }

      /* `spendPoly` is -1 on the free route, and `splice(-1, 1)` removes the
         *last* card in hand — so an unguarded spend would quietly eat a random
         card every time Valkyrion assembled. A free assembly also never spends
         a Polymerization the player happens to be holding. */
      if (route.spendPoly >= 0) p.grave.push(p.hand.splice(route.spendPoly, 1)[0]);
      for (const m of chosen) {
        const onField = !!findOnField(state, m.uid);
        if (onField) toGrave(state, m.uid, true);
        else {
          const hi = p.hand.findIndex((h) => h.uid === m.uid);
          if (hi >= 0) p.grave.push(p.hand.splice(hi, 1)[0]);
        }
      }
      const zone = p.monsters[action.zone] ? p.monsters.findIndex((m) => !m) : action.zone;
      if (zone < 0) return { state: prev, error: 'No free Monster Zone.' };

      const idx = p.extra.findIndex((e) => e.uid === ex.uid);
      p.extra.splice(idx, 1);
      resetInstance(ex);
      ex.position = action.position ?? 'atk';
      ex.face = 'up';
      ex.summonedOnTurn = state.turn;
      p.monsters[zone] = ex;
      log(state, `${p.name} Fusion Summons ${displayName(state, ex)}!`, 'summon', pid);
      anim(state, {
        kind: 'fusion',
        uid: ex.uid,
        slug: ex.slug,
        from: chosen.map((m) => m.slug),
        player: pid,
        text: CARDS[ex.slug].cry ?? 'Fusion Summon!',
      });
      fireTriggers(state, ex, pid, 'onSummon', {}, action.targets ?? []);
      if (!state.winner) {
        fireOpponentSummon(state, pid, ex.uid);
        fireAllySummon(state, pid, ex.uid);
      }
      if (!state.winner) openTrapWindow(state, other(pid), 'opponentSummon', `${p.name} Fusion Summoned.`, { attackerUid: ex.uid });
      return { state };
    }

    case 'attack': {
      if (state.phase !== 'battle') return { state: prev, error: 'You must be in the Battle Phase.' };
      const c = p.monsters.find((m) => m?.uid === action.uid);
      if (!c) return { state: prev, error: 'Monster not found.' };
      if (!canAttackWith(state, pid, c)) return { state: prev, error: 'That monster cannot attack right now.' };
      const { uids, direct } = legalAttackTargets(state, pid, c);
      if (action.targetUid === null) {
        if (!direct) return { state: prev, error: 'You must attack a monster.' };
      } else if (!uids.includes(action.targetUid)) {
        return { state: prev, error: 'Invalid attack target.' };
      }
      /* Fed before it moves. The discard is a cost, so it is spent whatever
         the swing turns into — and it lands in the Graveyard *before* the
         attack resolves, which is the point of the card: throw a Dinosaur and
         the King is 300 heavier for that very attack. */
      if (effFlags(state, c, pid).attackCostDiscard) {
        const hand = p.hand;
        const at = action.discardUid ? hand.findIndex((h) => h.uid === action.discardUid) : 0;
        if (at < 0) return { state: prev, error: 'That card is not in your hand.' };
        if (!hand.length) return { state: prev, error: `${card(c.slug).name} must discard a card to attack.` };
        const fed = hand.splice(at, 1)[0];
        landInGrave(state, fed, pid);
        log(state, `${p.name} feeds ${displayName(state, fed)} to ${displayName(state, c)}.`, 'effect', pid, logSlug(fed));
        anim(state, { kind: 'discard', uid: fed.uid, slug: fed.slug, player: pid });
      }
      beginAttack(state, action.uid, action.targetUid);
      return { state };
    }

    case 'toPhase': {
      if (action.phase === 'battle') {
        if (state.phase !== 'main') return { state: prev, error: 'You can only enter the Battle Phase from the Main Phase.' };
        if (state.turn === 1) return { state: prev, error: 'No attacks are allowed on the first turn.' };
        /* Unless a God is standing. Steelcage stops the Battle Phase itself
           rather than the monsters in it, so exempting the God one level down
           in `canAttackWith` would not have been enough — it could never reach
           the phase to use the exemption. */
        const godStanding = p.monsters.some((m) => m && m.face === 'up' && isDivine(m.slug));
        if (!godStanding && state.ongoing.some((o) => o.kind === 'skipBattlePhase' && o.target === pid)) {
          return { state: prev, error: 'You must skip your Battle Phase.' };
        }
        state.phase = 'battle';
        log(state, `${p.name} enters the Battle Phase.`, 'system', pid);
        anim(state, { kind: 'phase', player: pid, text: 'Battle Phase' });
        openTrapWindow(state, other(pid), 'anyOpponentTurn', `${p.name} entered the Battle Phase.`, {});
        return { state };
      }
      if (action.phase === 'end') {
        endTurn(state);
        return { state };
      }
      return { state: prev, error: 'Unsupported phase change.' };
    }

    case 'endTurn':
      endTurn(state);
      return { state };

    default:
      return { state: prev, error: 'Unknown action.' };
  }
}

/**
 * The answer to a parked effect. Runs it, then opens whatever else was queued
 * behind it.
 *
 * A pick the board no longer offers is dropped rather than refused: the window
 * may have been open across a reconnection, and an effect that cannot find what
 * it was pointed at should resolve on what is left, not stall the duel.
 */
function handleChoice(state: DuelState, pid: PlayerId, uids: string[]): DuelState {
  const pending = state.pending as PendingChoice;
  state.pending = null;
  const legal = uids.filter((u) => pending.options.includes(u)).slice(0, pending.want);
  /* An empty answer to an "up to" is the answer, not a missing one. Everywhere
     else it means the question went unanswered — a window open across a
     reconnection — and the effect resolves on what is there rather than
     stalling the duel. */
  const picked = legal.length || pending.optional ? legal : pending.options.slice(0, pending.want);
  resumeChoice(state, pending, picked);
  drainChoices(state);
  checkExodia(state);
  return state;
}

/**
 * Checks an activation's gate and pays its price: condition, dead-activation,
 * Life Points, discard, Tributes. Returns the uids the cost ate — so a Spell
 * that pays a Tribute and then asks a second question does not hand the first
 * answer to the second — or a refusal message.
 *
 * One function because there were two paths and only one of them did any of
 * this. A Spell played from the hand paid; the *same Spell* Set face-down and
 * flipped up paid nothing and was asked nothing. Eight cards were free that
 * way: Black Illusion Ritual and Fortress Whale's Oath Ritual Summoned without
 * their Tribute, Millennium Ankh and Tribute to the Doomed cost no Life Points
 * at all, and the conditions on Snatch Steal, Soul Exchange, Harpie Lady
 * Phoenix Formation and Eradicating Aerosol were not consulted. Reported as
 * "Tribute to the Doomed needs to cost before the opponent discards", which is
 * what it looks like from the seat: the payment never happened.
 */
function payActivation(
  state: DuelState,
  pid: PlayerId,
  c: CardInstance,
  def: CardDef,
  eff: CardEffect | undefined,
  targets: string[]
): { paidForCost: string[] } | { error: string } {
  const p = state.players[pid];
  if (eff?.condition && !conditionMet(state, eff, c, pid)) return { error: 'Its condition is not met.' };
  if (eff && activationIsDead(state, pid, c, def, eff)) return { error: 'There is nothing for that card to affect.' };

  if (eff?.cost?.lp) {
    const due = lpCost(state, pid, eff);
    if (p.lp <= due) return { error: 'Not enough Life Points.' };
    p.lp -= due;
    log(state, `${p.name} pays ${due} Life Points.`, 'effect', pid);
    /* A cost is still Life Points leaving, so it is announced like any other.
       The total must never move with nothing on screen saying why — that is
       exactly what made damage look like it landed early. */
    anim(state, { kind: 'damage', player: pid, amount: due });
  }
  if (eff?.cost?.discard) {
    const n = Math.min(eff.cost.discard, p.hand.length - (p.hand.some((h) => h.uid === c.uid) ? 1 : 0));
    for (let i = 0; i < n; i++) {
      const idx = p.hand.findIndex((h) => h.uid !== c.uid);
      if (idx < 0) break;
      landInGrave(state, p.hand.splice(idx, 1)[0], pid);
    }
  }
  const extra = spendExtraCosts(state, pid, c, eff);
  if (extra) return { error: extra };
  /* Whichever ones the player pointed at, and only then whatever is left. This
     took the first monsters in the row regardless — the board asks "Choose a
     monster to Tribute", collected an answer, and the engine threw it away. */
  const paidForCost: string[] = [];
  if (eff?.cost?.tribute) {
    const fodder = tributeFodder(state, pid, eff, c.uid);
    if (fodder.length < eff.cost.tribute) return { error: 'Not enough monsters to tribute.' };
    const chosen = targets.map((uid) => fodder.find((m) => m.uid === uid)).filter((m): m is CardInstance => !!m);
    const paying = [...chosen, ...fodder.filter((m) => !chosen.includes(m))].slice(0, eff.cost.tribute);
    for (const m of paying) {
      paidForCost.push(m.uid);
      toGrave(state, m.uid, true);
    }
  }
  return { paidForCost };
}

function handleTrapResponse(state: DuelState, pid: PlayerId, uid: string | null, targets: string[]): DuelState {
  const pending = state.pending as PendingTrap;
  state.pending = null;

  let ctx: EffectCtx | null = null;
  if (uid && pending.options.includes(uid)) {
    ctx = activateTrapCard(state, pid, uid, targets, pending.context);
  } else {
    log(state, `${state.players[pid].name} declines to respond.`, 'normal', pid);
  }

  if (state.suspendedAttack) {
    const negated = ctx?.attackNegated;
    const endBp = ctx?.battlePhaseEnded;
    if (negated) {
      state.suspendedAttack = null;
      // A negated attack still counts as that monster's swing for the turn.
      const atk = findOnField(state, pending.context.attackerUid ?? '');
      if (atk) atk.c.attacksUsed += 1;
    } else {
      resolveBattle(state);
    }
    if (endBp && state.phase === 'battle') {
      log(state, 'The Battle Phase ends.', 'system');
      state.phase = 'end';
      endTurn(state);
    }
  }
  /* Anything that queued up behind the trap window gets its turn now. */
  drainChoices(state);
  checkExodia(state);
  return state;
}

/* ------------------------------------------------------------------ */
/* Client-side view (hides hidden information)                         */
/* ------------------------------------------------------------------ */

export function viewFor(state: DuelState, viewer: PlayerId): DuelState {
  const s: DuelState = structuredClone(state);
  const opp = s.players[other(viewer)];
  opp.hand = opp.hand.map((c) => ({ ...c, slug: 'facedown', face: 'down' as Face }));
  opp.deck = opp.deck.map((c) => ({ ...c, slug: 'facedown' }));
  /* Your own Deck, by name but not in order.
   *
   * It used to be masked exactly like theirs, which is the right instinct
   * applied one step too far: what must stay secret is the *order* — the next
   * card you will draw — not the contents, which you built yourself and can
   * read on the deck screen any time. Masked outright, every card that asks
   * you to choose from your Deck had nothing to offer: the board filters the
   * pool by slug, every slug came back `facedown`, no card matched, and the
   * choice was silently taken by the engine instead. Reported as "Basic Insect
   * did not give the option to pick which equip spell to add while both were
   * in the deck", and it was never about Basic Insect — Toon World, the
   * Cocoon's hatch, Fortress Whale's Oath and every other Deck search were
   * picking for you too.
   *
   * Sorted rather than shuffled so it is stable between polls: a list that
   * reshuffled itself under the player's finger every second would be its own
   * bug. The uid is what travels back, and the real Deck on the server never
   * moved. */
  s.players[viewer].deck = [...s.players[viewer].deck]
    .map((c) => ({ ...c }))
    .sort((a, b) => a.slug.localeCompare(b.slug) || a.uid.localeCompare(b.uid));
  // Face-down cards on the opponent's field stay hidden.
  opp.monsters = opp.monsters.map((m) => (m && m.face === 'down' ? { ...m, slug: 'facedown' } : m));
  if (opp.spellTrap && opp.spellTrap.face === 'down') opp.spellTrap = { ...opp.spellTrap, slug: 'facedown' };
  return s;
}

/**
 * The front-row seat: what a spectator of an exhibition duel is shown.
 *
 * Both hands are open — watching two computers play is only interesting if you
 * can see what each is holding, which is how a televised duel is shot. Set
 * cards stay face-down on both sides, deliberately: whether the attacker is
 * about to walk into a Mirror Force is the whole drama of a turn, and neither
 * computer can see them either, so the spectator watches the same game the
 * players are playing. Decks stay hidden for the same reason.
 */
export function viewForSpectator(state: DuelState): DuelState {
  const s: DuelState = structuredClone(state);
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const p = s.players[pid];
    p.deck = p.deck.map((c) => ({ ...c, slug: 'facedown' }));
    p.monsters = p.monsters.map((m) => (m && m.face === 'down' ? { ...m, slug: 'facedown' } : m));
    if (p.spellTrap && p.spellTrap.face === 'down') p.spellTrap = { ...p.spellTrap, slug: 'facedown' };
  }
  return s;
}
