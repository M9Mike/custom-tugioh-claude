/**
 * The duel engine.
 *
 * Pure and deterministic: every state transition is a function of the previous
 * state, the action, and a seeded RNG carried inside the state. The server runs
 * this as the single source of truth; the client runs the same code to predict
 * what its buttons should do.
 */
import { baseAtk, baseDef, card, CARDS, DUELIST_BY_ID, isToon } from './cards';
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
  type Op,
  type PlayerId,
  type PlayerState,
  type Selector,
  type Side,
  type TrapWindow,
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

function log(state: DuelState, text: string, tone: 'normal' | 'attack' | 'effect' | 'damage' | 'summon' | 'system' = 'normal', player?: PlayerId) {
  state.log.push({ id: `l${state.log.length}`, turn: state.turn, player, text, tone });
  if (state.log.length > 300) state.log.splice(0, state.log.length - 300);
}

function anim(state: DuelState, ev: Omit<AnimEvent, 'id'>) {
  state.anims.push({ id: `a${state.anims.length}_${state.version}`, ...ev });
}

export function displayName(c: CardInstance): string {
  return c.isToken ? (c.tokenName ?? 'Token') : card(c.slug).name;
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

/** Matches a card against a filter using base stats (never aura-adjusted, to avoid recursion). */
function matchesFilter(c: CardInstance, f?: CardFilter): boolean {
  if (!f) return true;
  if (c.isToken) {
    // Tokens only satisfy the loosest filters.
    if (f.type || f.attribute || f.slugs || f.nameIncludes || f.minLevel) return false;
    if (f.kind && f.kind !== 'monster') return false;
    if (f.position && c.position !== f.position) return false;
    if (f.face && c.face !== f.face) return false;
    return true;
  }
  const def = CARDS[c.slug];
  if (!def) return false;
  if (f.kind && def.kind !== f.kind) return false;
  if (f.type && def.type !== f.type) return false;
  if (f.attribute && def.attribute !== f.attribute) return false;
  if (f.minLevel != null && (def.level ?? 0) < f.minLevel) return false;
  if (f.maxLevel != null && (def.level ?? 0) > f.maxLevel) return false;
  if (f.minAtk != null && (def.atk ?? 0) < f.minAtk) return false;
  if (f.maxAtk != null && (def.atk ?? 0) > f.maxAtk) return false;
  if (f.nameIncludes && !def.name.toLowerCase().includes(f.nameIncludes.toLowerCase())) return false;
  if (f.toon && !isToon(c.slug)) return false;
  if (f.slugs && !f.slugs.includes(c.slug)) return false;
  if (f.position && c.position !== f.position) return false;
  if (f.face && c.face !== f.face) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Effective stats (base + modifiers + equips + auras)                 */
/* ------------------------------------------------------------------ */

interface AuraBonus {
  atk: number;
  def: number;
  grants: Set<EquipGrant>;
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
  per: NonNullable<NonNullable<CardEffect['aura']>['per']>
): number {
  const pools: CardInstance[][] = [];
  const onField = (pid: PlayerId) => state.players[pid].monsters.filter((m): m is CardInstance => !!m);
  if (per.zone === 'ownGrave') pools.push(state.players[controller].grave);
  else if (per.zone === 'eitherGrave') pools.push(state.players.p1.grave, state.players.p2.grave);
  else if (per.zone === 'ownField') pools.push(onField(controller));
  else pools.push(onField('p1'), onField('p2'));
  let n = 0;
  for (const pool of pools) for (const c of pool) if (matchesFilter(c, per.filter)) n += 1;
  return n;
}

function aurasFor(state: DuelState, target: CardInstance, targetController: PlayerId): AuraBonus {
  const bonus: AuraBonus = { atk: 0, def: 0, grants: new Set() };
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
      if (s.pick !== 'self' && !matchesFilter(target, s.filter)) continue;
      bonus.atk += eff.aura.atk ?? 0;
      bonus.def += eff.aura.def ?? 0;
      if (eff.aura.per) {
        const n = auraCount(state, controller, eff.aura.per);
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
  const absorbed = c.absorbed.reduce((sum, s) => sum + baseAtk(s), 0);
  return Math.max(0, base + absorbed + c.atkMod + c.turnAtkMod + aurasFor(state, c, ctrl).atk);
}

export function effDef(state: DuelState, c: CardInstance, controller?: PlayerId): number {
  const ctrl = controller ?? controllerOf(state, c.uid) ?? c.owner;
  const base = c.isToken ? (c.tokenDef ?? 0) : baseDef(c.slug);
  const absorbed = c.absorbed.reduce((sum, s) => sum + baseDef(s), 0);
  return Math.max(0, base + absorbed + c.defMod + c.turnDefMod + aurasFor(state, c, ctrl).def);
}

export function effFlags(state: DuelState, c: CardInstance, controller?: PlayerId): CardFlags {
  const ctrl = controller ?? controllerOf(state, c.uid) ?? c.owner;
  const grants = aurasFor(state, c, ctrl).grants;
  const merged: CardFlags = { ...c.flags, ...c.turnFlags };
  merged.extraAttacks = (c.flags.extraAttacks ?? 0) + (c.turnFlags.extraAttacks ?? 0);
  if (grants.has('pierce')) merged.pierce = true;
  if (grants.has('directAttack')) merged.directAttack = true;
  if (grants.has('untargetable')) merged.untargetable = true;
  if (grants.has('indestructibleByBattle')) merged.indestructibleByBattle = true;
  if (grants.has('indestructibleByEffect')) merged.indestructibleByEffect = true;
  if (grants.has('doubleAttack')) merged.extraAttacks = (merged.extraAttacks ?? 0) + 1;
  if (grants.has('cannotAttack')) merged.cannotAttack = true;
  if (grants.has('attackAll')) merged.attackAll = true;
  return merged;
}

export function maxAttacks(state: DuelState, c: CardInstance, controller: PlayerId): number {
  const f = effFlags(state, c, controller);
  const base = 1 + (f.extraAttacks ?? 0);
  if (!f.attackAll) return base;
  /* "Attacks every monster your opponent controls once each." Counting the
     *current* board shrank the allowance with every kill: three defenders
     became two attacks, because the second kill lowered the ceiling below the
     attacks already spent and the third defender was suddenly unreachable.
     The allowance is what has been spent plus the monsters not yet visited,
     so destroying a target never revokes the next one. */
  const visited = c.attacked ?? [];
  const fresh = state.players[other(controller)].monsters.filter(
    (m): m is CardInstance => !!m && !visited.includes(m.uid)
  ).length;
  return Math.max(base, c.attacksUsed + fresh);
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

function buildPlayer(state: DuelState, id: PlayerId, duelistId: string, name: string): PlayerState {
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
  for (const [slug, count] of duelist.deck) {
    for (let i = 0; i < count; i++) p.deck.push(newInstance(state, slug, id));
  }
  for (const slug of duelist.extra) p.extra.push(newInstance(state, slug, id));
  shuffle(state, p.deck);
  return p;
}

export function createDuel(opts: {
  seed: number;
  p1: { duelistId: string; name: string };
  p2: { duelistId: string; name: string };
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
    version: 0,
    uidSeq: 0,
    suspendedAttack: null,
  };
  state.players.p1 = buildPlayer(state, 'p1', opts.p1.duelistId, opts.p1.name);
  state.players.p2 = buildPlayer(state, 'p2', opts.p2.duelistId, opts.p2.name);

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
    anim(state, { kind: 'draw', player: pid });
    log(state, `${p.name} draws a card.`, 'normal', pid);
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
}

/** Sends a card from the field to its owner's Graveyard, firing onSentToGrave. */
function toGrave(state: DuelState, uid: string, fromField: boolean) {
  const found = fromField ? findOnField(state, uid) : null;
  const controller = found?.controller;
  const c = removeFromAnywhere(state, uid);
  if (!c) return;

  // An Equip Spell has nothing left to hold, so it follows its monster down.
  // These are the real cards sitting in a Spell/Trap Zone — recursing through
  // toGrave is what takes them off the field.
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const st = state.players[pid].spellTrap;
    if (st?.equippedTo === c.uid) toGrave(state, st.uid, true);
  }
  // Going the other way: an equip leaving the field stops being listed on the
  // monster it was buffing.
  if (c.equippedTo) {
    const host = findOnField(state, c.equippedTo)?.c;
    if (host) {
      const at = host.equips.indexOf(c.slug);
      if (at >= 0) host.equips.splice(at, 1);
    }
    c.equippedTo = undefined;
  }
  // Absorbed monsters are released to their owner's graveyard.
  for (const abSlug of c.absorbed) {
    const ab = newInstance(state, abSlug, other(c.owner));
    state.players[other(c.owner)].grave.push(ab);
  }

  if (c.isToken) return; // tokens simply vanish

  const wasOnField = fromField && controller != null;
  resetInstance(c);
  state.players[c.owner].grave.push(c);

  if (wasOnField) {
    fireTriggers(state, c, controller, 'onSentToGrave', {});
  }
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
  state.players[to].lp = Math.max(0, state.players[to].lp - amount);
  anim(state, { kind: 'damage', player: to, amount });
  log(state, `${state.players[to].name} takes ${amount} damage. (${state.players[to].lp} LP)`, 'damage', to);
  checkLifePoints(state);
}

function healPlayer(state: DuelState, to: PlayerId, amount: number) {
  if (amount <= 0) return;
  state.players[to].lp += amount;
  anim(state, { kind: 'heal', player: to, amount });
  log(state, `${state.players[to].name} gains ${amount} Life Points. (${state.players[to].lp} LP)`, 'effect', to);
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

function checkExodia(state: DuelState) {
  if (state.winner) return;
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const held = new Set(state.players[pid].hand.map((c) => c.slug));
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
  /** Set by negateAttack so battle resolution can be cancelled. */
  attackNegated?: boolean;
  battlePhaseEnded?: boolean;
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

function resolveTargets(ctx: EffectCtx, s: Selector): CardInstance[] {
  const { state } = ctx;
  const zone = s.zone ?? 'monster';

  if (s.pick === 'self') return [ctx.source];

  if (s.pick === 'attacker') {
    const c = ctx.trig.attackerUid ? findOnField(state, ctx.trig.attackerUid)?.c : null;
    return c ? [c] : [];
  }
  if (s.pick === 'attackTarget') {
    const c = ctx.trig.targetUid ? findOnField(state, ctx.trig.targetUid)?.c : null;
    return c ? [c] : [];
  }

  const pool: CardInstance[] = [];
  for (const pid of sideToPlayers(ctx, s.side)) {
    for (const c of zoneCards(state, pid, zone)) {
      if (matchesFilter(c, s.filter)) pool.push(c);
    }
  }

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
    // If the player supplied nothing usable, fall back to the strongest legal
    // option so the effect still does something rather than silently fizzling.
    if (picked.length === 0 && pool.length > 0 && zone === 'monster') {
      picked.push(pool.reduce((a, b) => (effAtk(state, a) >= effAtk(state, b) ? a : b)));
    } else if (picked.length === 0 && pool.length > 0) {
      picked.push(pool[0]);
    }
    return picked.filter((c) => !isProtectedTarget(state, c, ctx.controller));
  }

  if (s.pick === 'all') return pool.filter((c) => zone !== 'monster' || !isProtectedTarget(state, c, ctx.controller));
  if (s.pick === 'random') {
    const legal = pool.filter((c) => !isProtectedTarget(state, c, ctx.controller));
    if (!legal.length) return [];
    return [legal[randInt(state, legal.length)]];
  }
  const legal = pool.filter((c) => !isProtectedTarget(state, c, ctx.controller));
  if (!legal.length) return [];
  if (s.pick === 'strongest') return [legal.reduce((a, b) => (effAtk(state, a) >= effAtk(state, b) ? a : b))];
  return [legal.reduce((a, b) => (effAtk(state, a) <= effAtk(state, b) ? a : b))];
}

/** "Untargetable" only protects against the opponent's effects. */
function isProtectedTarget(state: DuelState, c: CardInstance, actor: PlayerId): boolean {
  const ctrl = controllerOf(state, c.uid);
  if (ctrl === actor) return false;
  return !!effFlags(state, c).untargetable;
}

function applyFlag(c: CardInstance, key: keyof CardFlags, value: boolean | number, duration: Duration) {
  const bag = duration === 'permanent' ? c.flags : c.turnFlags;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (bag as any)[key] = value;
}

function addOngoing(state: DuelState, kind: 'skipDraw' | 'skipBattlePhase' | 'freezeMonsters' | 'preventBattleDamage', target: PlayerId, turns: number, source: string) {
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
  if (byBattle && flags.indestructibleByBattle) {
    log(state, `${displayName(c)} cannot be destroyed by battle.`, 'effect', found.controller);
    return;
  }
  if (!byBattle && flags.indestructibleByEffect) {
    log(state, `${displayName(c)} is immune to that effect.`, 'effect', found.controller);
    return;
  }
  anim(state, { kind: 'destroy', uid: c.uid, slug: c.slug, player: found.controller });
  log(state, `${displayName(c)} is destroyed.`, 'effect', found.controller);
  // The card leaves the field *before* its own destruction effect resolves.
  // Otherwise it is still sitting in its Monster Zone, and an effect like
  // Anthrosaurus's — "when destroyed by battle, Special Summon a Dinosaur" —
  // finds the board full and quietly does nothing, even though the space it
  // just gave up is exactly where the replacement should go.
  toGrave(state, c.uid, true);
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
        if (op.scale === 'targetAtk' || op.scale === 'halfTargetAtk') {
          const peek = ctx.targets[ctx.cursor];
          const t =
            (peek && findOnField(state, peek)?.c) ||
            (ctx.trig.attackerUid ? findOnField(state, ctx.trig.attackerUid)?.c : null);
          const v = t ? effAtk(state, t) : 0;
          amount = op.scale === 'halfTargetAtk' ? Math.floor(v / 2) : v;
        } else if (op.scale === 'selfAtk') {
          amount = effAtk(state, ctx.source, ctx.controller);
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
        if (op.scale === 'perCardInGrave') amount = 200 * state.players[ctx.controller].grave.length;
        else if (op.scale === 'perMonsterOnField') amount = 300 * state.players[ctx.controller].monsters.filter(Boolean).length;
        else if (op.scale === 'targetAtk') {
          const t = ctx.trig.targetUid ? findOnField(state, ctx.trig.targetUid)?.c : null;
          amount = t ? effAtk(state, t) : 0;
        }
        for (const t of resolveTargets(ctx, op.target)) {
          if (op.duration === 'permanent') t.atkMod += amount;
          else t.turnAtkMod += amount;
          if (amount !== 0) {
            log(state, `${displayName(t)} ${amount > 0 ? 'gains' : 'loses'} ${Math.abs(amount)} ATK.`, 'effect');
          }
        }
        break;
      }
      case 'gainDef':
        for (const t of resolveTargets(ctx, op.target)) {
          if (op.duration === 'permanent') t.defMod += op.amount;
          else t.turnDefMod += op.amount;
        }
        break;
      case 'setAtk':
        for (const t of resolveTargets(ctx, op.target)) t.atkMod = op.value - baseAtk(t.slug);
        break;
      case 'halveAtk':
        for (const t of resolveTargets(ctx, op.target)) {
          const cur = effAtk(state, t);
          t.atkMod -= Math.floor(cur / 2);
          log(state, `${displayName(t)}'s ATK is halved.`, 'effect');
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
        for (const t of resolveTargets(ctx, op.target)) destroyCard(state, t, false, ctx);
        break;
      case 'banish':
        for (const t of resolveTargets(ctx, op.target)) {
          const owner = t.owner;
          const removed = removeFromAnywhere(state, t.uid);
          if (removed && !removed.isToken) {
            resetInstance(removed);
            state.players[owner].banished.push(removed);
            log(state, `${displayName(removed)} is banished.`, 'effect');
          }
        }
        break;
      case 'bounce':
        for (const t of resolveTargets(ctx, op.target)) {
          const owner = t.owner;
          const removed = removeFromAnywhere(state, t.uid);
          if (removed && !removed.isToken) {
            resetInstance(removed);
            state.players[owner].hand.push(removed);
            log(state, `${displayName(removed)} returns to the hand.`, 'effect');
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
          if (op.duration !== 'permanent') t.controlRevertsOnTurn = state.turn;
          state.players[ctx.controller].monsters[dest] = t;
          log(state, `${state.players[ctx.controller].name} takes control of ${displayName(t)}!`, 'effect', ctx.controller);
        }
        break;
      }
      case 'draw':
        for (const pid of sideToPlayers(ctx, op.who)) {
          for (let i = 0; i < op.count; i++) if (!drawCard(state, pid)) break;
        }
        checkExodia(state);
        break;
      case 'discard':
        for (const pid of sideToPlayers(ctx, op.who)) {
          const p = state.players[pid];
          const n = Math.min(op.count, p.hand.length);
          for (let i = 0; i < n; i++) {
            const idx = randInt(state, p.hand.length);
            const c = p.hand.splice(idx, 1)[0];
            p.grave.push(c);
            log(state, `${p.name} discards ${displayName(c)}.`, 'effect', pid);
          }
        }
        break;
      case 'mill':
        for (const pid of sideToPlayers(ctx, op.who)) {
          const p = state.players[pid];
          for (let i = 0; i < op.count; i++) {
            const c = p.deck.shift();
            if (!c) break;
            p.grave.push(c);
          }
          log(state, `${p.name} sends ${op.count} cards from the top of their Deck to the Graveyard.`, 'effect', pid);
        }
        break;
      case 'search': {
        const p = state.players[ctx.controller];
        const count = op.count ?? 1;
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
            let best = -1;
            for (let k = 0; k < p.deck.length; k++) {
              if (!matchesFilter(p.deck[k], op.filter)) continue;
              if (best < 0 || (CARDS[p.deck[k].slug]?.atk ?? 0) > (CARDS[p.deck[best].slug]?.atk ?? 0)) best = k;
            }
            idx = best;
          }
          if (idx < 0) break;
          const c = p.deck.splice(idx, 1)[0];
          p.hand.push(c);
          log(state, `${p.name} adds ${displayName(c)} from their Deck to their hand.`, 'effect', ctx.controller);
        }
        shuffle(state, p.deck);
        checkExodia(state);
        break;
      }
      case 'specialSummon': {
        const count = op.count ?? 1;
        for (let i = 0; i < count; i++) {
          const zone = state.players[ctx.controller].monsters.findIndex((m) => !m);
          if (zone < 0) break;
          const sources: PlayerId[] = op.side === 'both' ? [ctx.controller, other(ctx.controller)] : [ctx.controller];
          const zones = Array.isArray(op.from) ? op.from : [op.from];
          const from = (pid: PlayerId) => zones.flatMap((z) => zoneCards(state, pid, z));
          let picked: CardInstance | null = null;
          // Prefer an explicit choice from the activating player.
          const chosenUid = ctx.targets[ctx.cursor];
          for (const pid of sources) {
            const pool = from(pid);
            const byChoice = chosenUid ? pool.find((c) => c.uid === chosenUid) : null;
            if (byChoice && matchesFilter(byChoice, op.filter) && CARDS[byChoice.slug]?.kind === 'monster') {
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
                  matchesFilter(c, op.filter) &&
                  // A card never Special Summons itself with its own "when this
                  // card is destroyed" effect — it is in the Graveyard by the
                  // time that resolves, and reviving itself is not the intent.
                  c.uid !== ctx.source.uid
              );
              if (pool.length) {
                picked = pool.reduce((a, b) => (baseAtk(a.slug) >= baseAtk(b.slug) ? a : b));
                break;
              }
            }
          }
          if (!picked) break;
          removeFromAnywhere(state, picked.uid);
          resetInstance(picked);
          picked.position = op.position ?? 'atk';
          picked.face = op.face ?? 'up';
          picked.summonedOnTurn = state.turn;
          state.players[ctx.controller].monsters[zone] = picked;
          log(state, `${state.players[ctx.controller].name} Special Summons ${displayName(picked)}!`, 'summon', ctx.controller);
          anim(state, { kind: 'summon', uid: picked.uid, slug: picked.slug, player: ctx.controller });
          if (picked.face === 'up') fireTriggers(state, picked, ctx.controller, 'onSummon', {});
        }
        break;
      }
      case 'summonToken': {
        for (let i = 0; i < op.count; i++) {
          const zone = state.players[ctx.controller].monsters.findIndex((m) => !m);
          if (zone < 0) break;
          const t = newInstance(state, op.artSlug ?? ctx.source.slug, ctx.controller);
          t.isToken = true;
          t.tokenName = op.name;
          t.tokenAtk = op.atk;
          t.tokenDef = op.def;
          t.position = 'def';
          t.summonedOnTurn = state.turn;
          state.players[ctx.controller].monsters[zone] = t;
          anim(state, { kind: 'summon', uid: t.uid, slug: t.slug, player: ctx.controller });
        }
        log(state, `${state.players[ctx.controller].name} Special Summons ${op.count} ${op.name}s.`, 'summon', ctx.controller);
        break;
      }
      case 'transformInto': {
        const found = findOnField(state, ctx.source.uid);
        if (!found) break;
        const old = displayName(ctx.source);
        ctx.source.slug = op.slug;
        ctx.source.counters = 0;
        log(state, `${old} evolves into ${card(op.slug).name}!`, 'summon', ctx.controller);
        anim(state, { kind: 'fusion', uid: ctx.source.uid, slug: op.slug, player: ctx.controller });
        fireTriggers(state, ctx.source, ctx.controller, 'onSummon', {});
        break;
      }
      case 'addCounter':
        ctx.source.counters += op.amount;
        log(state, `${displayName(ctx.source)} gains an Evolution Counter (${ctx.source.counters}).`, 'effect', ctx.controller);
        applyEvolution(state, ctx.source, ctx.controller);
        break;
      case 'negateAttack':
        ctx.attackNegated = true;
        log(state, 'The attack is negated!', 'effect');
        break;
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
      case 'pierce':
        applyFlag(ctx.source, 'pierce', true, op.duration);
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
          log(state, `${displayName(t)}'s effects are negated.`, 'effect');
        }
        break;
      case 'absorb':
        for (const t of resolveTargets(ctx, op.target)) {
          const removed = removeFromAnywhere(state, t.uid);
          if (!removed || removed.isToken) continue;
          ctx.source.absorbed.push(removed.slug);
          log(state, `${displayName(ctx.source)} absorbs ${displayName(removed)}!`, 'effect', ctx.controller);
        }
        break;
      case 'equipTo': {
        const targets = resolveTargets(ctx, { side: 'own', pick: 'chosen' });
        const t = targets[0] ?? state.players[ctx.controller].monsters.find((m): m is CardInstance => !!m);
        if (!t) {
          log(state, 'There is no monster to equip.', 'effect', ctx.controller);
          break;
        }
        // Only the attachment is recorded; the stat bonus and the granted flags
        // are read back out as an aura for as long as the equip is on the
        // field. Nothing is written into the monster, so when this card is
        // destroyed the monster goes straight back to its printed values.
        ctx.source.equippedTo = t.uid;
        t.equips.push(ctx.source.slug);
        log(state, `${displayName(t)} is equipped with ${card(ctx.source.slug).name} (+${op.atk} ATK).`, 'effect', ctx.controller);
        break;
      }
      case 'revealHand':
        break;
      case 'shuffleIntoDeck':
        for (const t of resolveTargets(ctx, op.target)) {
          const owner = t.owner;
          const removed = removeFromAnywhere(state, t.uid);
          if (removed && !removed.isToken) {
            resetInstance(removed);
            state.players[owner].deck.push(removed);
            shuffle(state, state.players[owner].deck);
          }
        }
        break;
      case 'stealFromGrave': {
        /* Either Graveyard, the opponent's first — and the best card in it
           rather than whichever happens to lie nearest the top. A flip effect
           resolves in the middle of someone else's attack, so there is no
           moment to ask the player which; taking the strongest is the answer
           they would have given. */
        const pools = [state.players[other(ctx.controller)].grave, state.players[ctx.controller].grave];
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
        log(state, `${state.players[ctx.controller].name} takes ${displayName(c)} from the Graveyard.`, 'effect', ctx.controller);
        checkExodia(state);
        break;
      }
      case 'coinFlip': {
        const heads = nextRandom(state) < 0.5;
        log(state, `Coin flip: ${heads ? 'HEADS' : 'TAILS'}!`, 'effect', ctx.controller);
        anim(state, { kind: 'activate', text: heads ? 'HEADS' : 'TAILS', player: ctx.controller });
        runOps(ctx, heads ? op.heads : op.tails);
        break;
      }
      case 'diceRoll': {
        const roll = 1 + randInt(state, 6);
        log(state, `Dice roll: ${roll}!`, 'effect', ctx.controller);
        anim(state, { kind: 'activate', text: `⚄ ${roll}`, player: ctx.controller });
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
              anim(state, { kind: 'flip', uid: t.uid, slug: t.slug, player: ctrl });
              log(state, `${displayName(t)} is flipped face-up!`, 'effect', ctrl);
              fireTriggers(state, t, ctrl, 'onFlip', {});
            }
          }
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

/** Petit Moth's evolution chain, driven by Evolution Counters. */
function applyEvolution(state: DuelState, c: CardInstance, controller: PlayerId) {
  const chain: Record<string, [number, string]> = {
    'petit-moth': [2, 'larvae-moth'],
    'larvae-moth': [3, 'great-moth'],
    'great-moth': [4, 'perfectly-ultimate-great-moth'],
  };
  const step = chain[c.slug];
  if (!step) return;
  const [needed, next] = step;
  if (c.counters < needed) return;
  const old = displayName(c);
  c.slug = next;
  log(state, `${old} evolves into ${card(next).name}!`, 'summon', controller);
  anim(state, { kind: 'fusion', uid: c.uid, slug: next, player: controller });
  fireTriggers(state, c, controller, 'onSummon', {});
}

function conditionMet(state: DuelState, eff: CardEffect, c: CardInstance, controller: PlayerId): boolean {
  const cond = eff.condition;
  if (!cond) return true;
  const p = state.players[controller];
  if (cond.ownLpBelow != null && p.lp > cond.ownLpBelow) return false;
  if (cond.graveAtLeast != null && p.grave.length < cond.graveAtLeast) return false;
  if (cond.countersAtLeast != null && c.counters < cond.countersAtLeast) return false;
  if (cond.turnAtLeast != null && state.turn < cond.turnAtLeast) return false;
  if (cond.opponentHasMonster && state.players[other(controller)].monsters.every((m) => !m)) return false;
  if (cond.requiresOnField) {
    const has =
      p.monsters.some((m) => m?.slug === cond.requiresOnField) ||
      p.spellTrap?.slug === cond.requiresOnField ||
      p.field?.slug === cond.requiresOnField;
    if (!has) return false;
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

function fireTriggers(state: DuelState, c: CardInstance, controller: PlayerId, trigger: CardEffect['trigger'], trig: TriggerContext, targets: string[] = []) {
  if (c.isToken || c.flags.negated || state.winner) return;
  const def = CARDS[c.slug];
  if (!def) return;
  for (const eff of def.effects) {
    if (eff.trigger !== trigger) continue;
    if (!conditionMet(state, eff, c, controller)) continue;
    const ctx: EffectCtx = { state, controller, source: c, targets, cursor: 0, trig };
    if (def.cry && (trigger === 'onSummon' || trigger === 'onNormalSummon' || trigger === 'activate')) {
      anim(state, { kind: 'activate', uid: c.uid, slug: c.slug, player: controller, text: def.cry });
    }
    runOps(ctx, eff.ops);
  }
}

/* ------------------------------------------------------------------ */
/* Trap windows                                                        */
/* ------------------------------------------------------------------ */

function activatableTraps(state: DuelState, pid: PlayerId, window: TrapWindow): CardInstance[] {
  const p = state.players[pid];
  const out: CardInstance[] = [];
  const st = p.spellTrap;
  if (st && CARDS[st.slug]?.kind === 'trap') {
    const effs = CARDS[st.slug].effects.filter((e) => e.trigger === 'trap' && e.window === window);
    // A face-down trap cannot be activated on the turn it was set. A face-up
    // Continuous Trap has already served that wait, and one flagged `reusable`
    // goes off every time its window opens — that ongoing threat is the whole
    // reason it is allowed to sit in the zone.
    const ready = st.face === 'down' ? st.summonedOnTurn < state.turn : effs.some((e) => e.reusable);
    if (ready && effs.length) out.push(st);
  }
  for (const h of p.hand) {
    const effs = CARDS[h.slug]?.effects.filter((e) => e.trigger === 'trap' && e.fromHand && e.window === window) ?? [];
    if (effs.length) out.push(h);
  }
  return out;
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

  const targetName = targetUid ? displayName(findOnField(state, targetUid)?.c ?? attacker) : state.players[defender].name;
  log(state, `${displayName(attacker)} attacks ${targetName}!`, 'attack', controller);

  state.suspendedAttack = { attackerUid, targetUid };
  const opened = openTrapWindow(state, defender, 'opponentDeclareAttack', `${displayName(attacker)} is attacking!`, {
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
    const dmg = effAtk(state, attacker, controller);
    anim(state, { kind: 'directAttack', uid: attacker.uid, slug: attacker.slug, player: controller, amount: dmg });
    dealDamage(state, defender, dmg, true);
    if (!state.winner) fireTriggers(state, attacker, controller, 'onDealBattleDamage', { attackerUid: attacker.uid });
    return;
  }

  const targetFound = findOnField(state, susp.targetUid);
  if (!targetFound) {
    // Target vanished — treat as a direct attack for the remaining swing.
    const dmg = effAtk(state, attacker, controller);
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
    anim(state, { kind: 'flip', uid: target.uid, slug: target.slug, player: defender });
    log(state, `${displayName(target)} is flipped face-up!`, 'effect', defender);
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
    text: displayName(target),
    player: controller,
  });

  const atk = effAtk(state, attacker, controller);
  const flags = effFlags(state, attacker, controller);

  if (target.position === 'atk') {
    const tAtk = effAtk(state, target, defender);
    if (atk > tAtk) {
      dealDamage(state, defender, atk - tAtk, true);
      destroyCard(state, target, true, { state, controller, source: attacker, targets: [], cursor: 0, trig: { attackerUid: attacker.uid } });
      if (!state.winner) {
        fireTriggers(state, attacker, controller, 'onBattleDestroy', { targetUid: target.uid });
        fireTriggers(state, attacker, controller, 'onDealBattleDamage', { attackerUid: attacker.uid });
      }
    } else if (atk < tAtk) {
      dealDamage(state, controller, tAtk - atk, true);
      destroyCard(state, attacker, true, { state, controller: defender, source: target, targets: [], cursor: 0, trig: { attackerUid: target.uid } });
    } else {
      log(state, 'Both monsters are destroyed!', 'attack');
      destroyCard(state, target, true, { state, controller, source: attacker, targets: [], cursor: 0, trig: { attackerUid: attacker.uid } });
      destroyCard(state, attacker, true, { state, controller: defender, source: target, targets: [], cursor: 0, trig: { attackerUid: target.uid } });
    }
  } else {
    const tDef = effDef(state, target, defender);
    if (atk > tDef) {
      if (flags.pierce) dealDamage(state, defender, atk - tDef, true);
      destroyCard(state, target, true, { state, controller, source: attacker, targets: [], cursor: 0, trig: { attackerUid: attacker.uid } });
      if (!state.winner) fireTriggers(state, attacker, controller, 'onBattleDestroy', { targetUid: target.uid });
    } else if (atk < tDef) {
      dealDamage(state, controller, tDef - atk, true);
      log(state, `${displayName(target)} holds firm.`, 'attack', defender);
    } else {
      log(state, `${displayName(target)} holds firm.`, 'attack', defender);
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
          log(state, `${displayName(m)} returns to ${home.name}.`, 'effect');
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

function startTurn(state: DuelState) {
  const pid = state.active;
  const p = state.players[pid];
  p.normalSummonUsed = false;
  state.phase = 'draw';
  log(state, `Turn ${state.turn} — ${p.name}'s turn.`, 'system', pid);
  anim(state, { kind: 'phase', player: pid, text: `${p.name}'s Turn` });

  for (const m of p.monsters) if (m) fireTriggers(state, m, pid, 'onOwnTurnStart', {});
  if (state.winner) return;

  const skipDraw = state.ongoing.some((o) => o.kind === 'skipDraw' && o.target === pid);
  if (skipDraw) log(state, `${p.name} must skip their draw.`, 'effect', pid);
  else drawCard(state, pid);
  checkExodia(state);
  if (state.winner) return;

  state.phase = 'main';
}

function endTurn(state: DuelState) {
  const pid = state.active;
  state.phase = 'end';
  const p = state.players[pid];
  for (const m of p.monsters) if (m) fireTriggers(state, m, pid, 'onOwnTurnEnd', {});
  if (p.field) fireTriggers(state, p.field, pid, 'onOwnTurnEnd', {});
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
function faceUpOnSide(state: DuelState, pid: PlayerId, slug: string): boolean {
  const p = state.players[pid];
  if (p.spellTrap?.slug === slug && p.spellTrap.face === 'up') return true;
  if (p.field?.slug === slug && p.field.face === 'up') return true;
  return p.monsters.some((m) => m?.slug === slug && m.face === 'up');
}

/**
 * Why this monster may not simply be Normal Summoned, or null if it may.
 *
 * Only Fusion monsters were ever checked here, so a Ritual monster could be
 * laid straight down from the hand — Relinquished walked onto the field for
 * free while Black Illusion Ritual, the card whose entire job is to put it
 * there, sat unused. The same hole let a Toon be Summoned with no Toon World,
 * which is the one thing the whole Toon deck is built around.
 */
export function summonBlocked(state: DuelState, pid: PlayerId, slug: string): string | null {
  const def = CARDS[slug];
  if (!def) return null;
  if (def.isFusion && state.players[pid].extra.some((e) => e.slug === slug)) {
    return 'Fusion monsters must be Fusion Summoned.';
  }
  if (def.isRitual) return `${def.name} can only be Ritual Summoned.`;
  if (def.summonRequires && !faceUpOnSide(state, pid, def.summonRequires)) {
    return `${def.name} needs ${CARDS[def.summonRequires]?.name ?? def.summonRequires} on your field.`;
  }
  return null;
}

export function tributesRequired(slug: string, state?: DuelState, pid?: PlayerId): number {
  const def = CARDS[slug];
  const level = def?.level ?? 0;
  let need = level >= 7 ? 2 : level >= 5 ? 1 : 0;
  // Toon monsters need no tribute while their controller has Toon World up —
  // this is the engine that makes Pegasus's deck work.
  // Asked of the whole side rather than the Spell/Trap Zone alone: Toon World
  // is a Field Spell in this game, so looking only where it used to sit would
  // have quietly reinstated the tribute cost it exists to remove.
  if (need > 0 && state && pid && isToon(slug) && faceUpOnSide(state, pid, 'toon-world')) need = 0;
  return need;
}

export function monstersFrozen(state: DuelState, pid: PlayerId): boolean {
  return state.ongoing.some((o) => o.kind === 'freezeMonsters' && o.target === pid);
}

export function canAttackWith(state: DuelState, pid: PlayerId, c: CardInstance): boolean {
  if (state.phase !== 'battle' || state.active !== pid || state.winner || state.pending) return false;
  if (state.turn === 1) return false;
  if (monstersFrozen(state, pid)) return false;
  // Held down by something on the field rather than by a timed lock, so it
  // lifts the instant that card is gone.
  if (effFlags(state, c, pid).cannotAttack) return false;
  if (c.face === 'down' || c.position !== 'atk') return false;
  if (c.summonedOnTurn === state.turn && c.isToken) return false;
  return c.attacksUsed < maxAttacks(state, c, pid);
}

export function legalAttackTargets(state: DuelState, pid: PlayerId, c: CardInstance): { uids: string[]; direct: boolean } {
  const opp = state.players[other(pid)];
  const monsters = opp.monsters.filter((m): m is CardInstance => !!m);
  const flags = effFlags(state, c, pid);
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

/** True when the controller can pay an effect's activation cost right now. */
function canPayCost(state: DuelState, pid: PlayerId, eff: CardEffect, exclude?: string): boolean {
  const p = state.players[pid];
  if (eff.cost?.lp != null && p.lp <= eff.cost.lp) return false;
  if (eff.cost?.tribute != null) {
    const fodder = p.monsters.filter((m): m is CardInstance => !!m && m.uid !== exclude);
    if (fodder.length < eff.cost.tribute) return false;
  }
  if (eff.cost?.discard != null && p.hand.length - 1 < eff.cost.discard) return false;
  return true;
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
  return canPayCost(state, pid, eff);
}

export function canChangePosition(state: DuelState, pid: PlayerId, c: CardInstance): boolean {
  if (state.phase !== 'main' || state.active !== pid || state.winner || state.pending) return false;
  if (monstersFrozen(state, pid)) return false;
  if (c.positionChangedOnTurn === state.turn) return false;
  return c.summonedOnTurn !== state.turn;
}

export function canIgnite(state: DuelState, pid: PlayerId, c: CardInstance): boolean {
  if (state.phase !== 'main' || state.active !== pid || state.winner || state.pending) return false;
  if (c.face === 'down' || c.flags.negated) return false;
  const def = CARDS[c.slug];
  const eff = def?.effects.find((e) => e.trigger === 'ignition');
  if (!eff) return false;
  if (!canPayCost(state, pid, eff, c.uid)) return false;
  return c.effectUsedOnTurn !== state.turn;
}

export function fusionOptions(state: DuelState, pid: PlayerId): { extraUid: string; materials: string[] }[] {
  const p = state.players[pid];
  if (!p.hand.some((h) => h.slug === 'polymerization')) return [];
  const available = [...p.monsters.filter((m): m is CardInstance => !!m && m.face === 'up'), ...p.hand];
  const out: { extraUid: string; materials: string[] }[] = [];
  for (const ex of p.extra) {
    const recipe = CARDS[ex.slug]?.fusionMaterials;
    if (!recipe) continue;
    const pool = [...available];
    const used: string[] = [];
    let ok = true;
    for (const need of recipe) {
      const i = pool.findIndex((c) => c.slug === need);
      if (i < 0) {
        ok = false;
        break;
      }
      used.push(pool[i].uid);
      pool.splice(i, 1);
    }
    if (ok) out.push({ extraUid: ex.uid, materials: used });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Action application                                                  */
/* ------------------------------------------------------------------ */

export function applyAction(prev: DuelState, pid: PlayerId, action: DuelAction): { state: DuelState; error?: string } {
  const state: DuelState = structuredClone(prev);
  state.anims = [];
  state.version += 1;

  if (state.winner) return { state: prev, error: 'The duel is already over.' };

  // While a response window is open, only that player may act, and only to respond.
  if (state.pending) {
    if (action.type !== 'respondTrap') return { state: prev, error: 'Waiting for a response.' };
    if (state.pending.player !== pid) return { state: prev, error: 'Not your response.' };
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
      if (action.zone < 0 || action.zone >= MONSTER_ZONES) {
        return { state: prev, error: 'Invalid Monster Zone.' };
      }
      const need = tributesRequired(c.slug, state, pid);
      const tributes = (action.tributes ?? []).slice(0, need);
      if (tributes.length < need) return { state: prev, error: `This monster requires ${need} tribute(s).` };
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
      for (const tu of tributes) {
        log(state, `${p.name} tributes ${displayName(p.monsters.find((m) => m?.uid === tu)!)}.`, 'summon', pid);
        toGrave(state, tu, true);
      }
      if (p.monsters[action.zone]) return { state: prev, error: 'That Monster Zone is occupied.' };

      p.hand.splice(hi, 1);
      c.position = action.face === 'down' ? 'def' : action.position;
      c.face = action.face;
      c.summonedOnTurn = state.turn;
      c.attacksUsed = 0;
      c.attacked = [];
      p.monsters[action.zone] = c;
      p.normalSummonUsed = true;

      if (c.face === 'up') {
        log(state, `${p.name} Normal Summons ${def.name}!`, 'summon', pid);
        anim(state, { kind: 'summon', uid: c.uid, slug: c.slug, player: pid });
        fireTriggers(state, c, pid, 'onSummon', {}, action.targets ?? []);
        fireTriggers(state, c, pid, 'onNormalSummon', {}, action.targets ?? []);
      } else {
        log(state, `${p.name} sets a monster.`, 'summon', pid);
        anim(state, { kind: 'summon', uid: c.uid, player: pid });
      }
      if (!state.winner) {
        openTrapWindow(state, other(pid), 'opponentSummon', `${p.name} summoned ${def.name}.`, { attackerUid: c.uid });
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
        log(state, `${p.name} Flip Summons ${displayName(c)}!`, 'summon', pid);
        anim(state, { kind: 'flip', uid: c.uid, slug: c.slug, player: pid });
        fireTriggers(state, c, pid, 'onFlip', {});
        fireTriggers(state, c, pid, 'onSummon', {});
        // A Flip Summon is a Normal Summon, so it pays those bonuses too.
        fireTriggers(state, c, pid, 'onNormalSummon', {});
      } else {
        c.position = c.position === 'atk' ? 'def' : 'atk';
        log(state, `${displayName(c)} switches to ${c.position === 'atk' ? 'Attack' : 'Defense'} Position.`, 'normal', pid);
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
      const isField = def.subKind === 'Field';
      // An Equip Spell stays face-up in the Spell/Trap Zone holding its monster,
      // exactly like a Continuous Spell — it is not spent on activation.
      const isContinuous = def.subKind === 'Continuous' || isField || isEquipSpell(c.slug);
      if (!isField && p.spellTrap) return { state: prev, error: 'Your Spell/Trap Zone is occupied.' };

      if (eff?.cost?.lp) {
        if (p.lp <= eff.cost.lp) return { state: prev, error: 'Not enough Life Points.' };
        p.lp -= eff.cost.lp;
        log(state, `${p.name} pays ${eff.cost.lp} Life Points.`, 'effect', pid);
        /* A cost is still Life Points leaving, so it is announced like any
           other. The total must never move with nothing on screen saying why —
           that is exactly what made damage look like it landed early. */
        anim(state, { kind: 'damage', player: pid, amount: eff.cost.lp });
      }
      if (eff?.cost?.discard) {
        const n = Math.min(eff.cost.discard, p.hand.length - 1);
        for (let i = 0; i < n; i++) {
          const idx = p.hand.findIndex((h) => h.uid !== c.uid);
          if (idx < 0) break;
          p.grave.push(p.hand.splice(idx, 1)[0]);
        }
      }
      if (eff?.cost?.tribute) {
        const alive = p.monsters.filter((m): m is CardInstance => !!m);
        if (alive.length < eff.cost.tribute) return { state: prev, error: 'Not enough monsters to tribute.' };
        for (let i = 0; i < eff.cost.tribute; i++) toGrave(state, alive[i].uid, true);
      }

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
        const ctx: EffectCtx = { state, controller: pid, source: c, targets: action.targets ?? [], cursor: 0, trig: {} };
        runOps(ctx, eff.ops);
      }

      if (!isContinuous && !isField) {
        // One-shot spells go straight to the Graveyard.
        p.grave.push(c);
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
      // Set Spell — activate it now.
      const eff = def.effects.find((e) => e.trigger === 'activate');
      if (!eff) return { state: prev, error: 'That card cannot be activated.' };
      log(state, `${p.name} activates ${def.name}!`, 'effect', pid);
      anim(state, { kind: 'activate', uid: c.uid, slug: c.slug, player: pid, text: def.cry });
      const ctx: EffectCtx = { state, controller: pid, source: c, targets: action.targets ?? [], cursor: 0, trig: {} };
      runOps(ctx, eff.ops);
      if (def.subKind !== 'Continuous') {
        p.spellTrap = null;
        p.grave.push(c);
      } else {
        c.face = 'up';
      }
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
        if (p.lp <= eff.cost.lp) return { state: prev, error: 'Not enough Life Points.' };
        p.lp -= eff.cost.lp;
        log(state, `${p.name} pays ${eff.cost.lp} Life Points.`, 'effect', pid);
        /* A cost is still Life Points leaving, so it is announced like any
           other. The total must never move with nothing on screen saying why —
           that is exactly what made damage look like it landed early. */
        anim(state, { kind: 'damage', player: pid, amount: eff.cost.lp });
      }
      if (eff.cost?.tribute) {
        const fodder = p.monsters.filter((m): m is CardInstance => !!m && m.uid !== c.uid);
        if (fodder.length < eff.cost.tribute) return { state: prev, error: 'Not enough monsters to tribute.' };
        for (let i = 0; i < eff.cost.tribute; i++) toGrave(state, fodder[i].uid, true);
      }
      c.effectUsedOnTurn = state.turn;
      log(state, `${p.name} activates ${def.name}'s effect!`, 'effect', pid);
      anim(state, { kind: 'activate', uid: c.uid, slug: c.slug, player: pid, text: def.cry ?? eff.label });
      const ctx: EffectCtx = { state, controller: pid, source: c, targets: action.targets ?? [], cursor: 0, trig: {} };
      runOps(ctx, eff.ops);
      return { state };
    }

    case 'fusionSummon': {
      if (state.phase !== 'main') return { state: prev, error: 'Only during your Main Phase.' };
      const poly = p.hand.findIndex((h) => h.slug === 'polymerization');
      if (poly < 0) return { state: prev, error: 'You need Polymerization.' };
      const ex = p.extra.find((e) => e.uid === action.extraUid);
      if (!ex) return { state: prev, error: 'Fusion monster not found.' };
      const recipe = CARDS[ex.slug]?.fusionMaterials ?? [];
      const pool = [...p.monsters.filter((m): m is CardInstance => !!m && m.face === 'up'), ...p.hand];
      const chosen: CardInstance[] = [];
      const remaining = [...pool];
      for (const need of recipe) {
        const i = remaining.findIndex((c) => c.slug === need && (action.materials.includes(c.uid) || action.materials.length === 0));
        const j = i >= 0 ? i : remaining.findIndex((c) => c.slug === need);
        if (j < 0) return { state: prev, error: 'You do not have the Fusion Materials.' };
        chosen.push(remaining[j]);
        remaining.splice(j, 1);
      }
      if (action.zone < 0 || action.zone >= MONSTER_ZONES) return { state: prev, error: 'Invalid zone.' };

      p.grave.push(p.hand.splice(poly, 1)[0]);
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
      log(state, `${p.name} Fusion Summons ${CARDS[ex.slug].name}!`, 'summon', pid);
      anim(state, { kind: 'fusion', uid: ex.uid, slug: ex.slug, player: pid, text: CARDS[ex.slug].cry ?? 'Fusion Summon!' });
      fireTriggers(state, ex, pid, 'onSummon', {}, action.targets ?? []);
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
      beginAttack(state, action.uid, action.targetUid);
      return { state };
    }

    case 'toPhase': {
      if (action.phase === 'battle') {
        if (state.phase !== 'main') return { state: prev, error: 'You can only enter the Battle Phase from the Main Phase.' };
        if (state.turn === 1) return { state: prev, error: 'No attacks are allowed on the first turn.' };
        if (state.ongoing.some((o) => o.kind === 'skipBattlePhase' && o.target === pid)) {
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

function handleTrapResponse(state: DuelState, pid: PlayerId, uid: string | null, targets: string[]): DuelState {
  const pending = state.pending!;
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
  s.players[viewer].deck = s.players[viewer].deck.map((c) => ({ ...c, slug: 'facedown' }));
  // Face-down cards on the opponent's field stay hidden.
  opp.monsters = opp.monsters.map((m) => (m && m.face === 'down' ? { ...m, slug: 'facedown' } : m));
  if (opp.spellTrap && opp.spellTrap.face === 'down') opp.spellTrap = { ...opp.spellTrap, slug: 'facedown' };
  return s;
}
