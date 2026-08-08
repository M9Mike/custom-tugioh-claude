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
    // A moth knows which rung of its own ladder it is on. Done here rather than
    // at each summon site so every route is covered by construction — drawn,
    // Normal Summoned, revived by Monster Reborn or made by an effect.
    counters: MOTH_STAGE[slug] ?? 0,
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
       beat of its own. */
    const orphan = [...state.anims].reverse().find((a) => a.id.startsWith(prefix) && !a.note);
    if (orphan) {
      orphan.note = entry.text;
      orphan.tone = entry.tone;
      continue;
    }
    if (entry.tone === 'system') continue; // "Turn 4 — Yugi's turn" is chrome
    const n = state.anims.reduce((k, a) => (a.id.startsWith(prefix) ? k + 1 : k), 0);
    state.anims.push({ id: `${prefix}${n}`, kind: 'note', note: entry.text, tone: entry.tone, player: entry.player });
  }
  state.logShown = state.log.length;
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
  per: NonNullable<NonNullable<CardEffect['aura']>['per']>,
  selfUid?: string
): number {
  const pools: CardInstance[][] = [];
  const onField = (pid: PlayerId) => state.players[pid].monsters.filter((m): m is CardInstance => !!m);
  if (per.zone === 'ownHand') pools.push(state.players[controller].hand);
  else if (per.zone === 'ownGrave') pools.push(state.players[controller].grave);
  else if (per.zone === 'eitherGrave') pools.push(state.players.p1.grave, state.players.p2.grave);
  else if (per.zone === 'ownField') pools.push(onField(controller));
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
      if (s.excludeSelf && source.uid === target.uid) continue;
      if (s.pick !== 'self' && !matchesFilter(target, s.filter)) continue;
      bonus.atk += eff.aura.atk ?? 0;
      bonus.def += eff.aura.def ?? 0;
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
  if (grants.has('halvedBattleDamage')) merged.halvedBattleDamage = true;
  if (grants.has('halvedDirectDamage')) merged.halvedDirectDamage = true;
  if (grants.has('summonSick')) merged.summonSick = true;
  if (grants.has('reflectBattleDamage')) merged.reflectBattleDamage = true;
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
    duelId: `${opts.seed >>> 0}-${opts.firstPlayer ?? 'p1'}`,
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
  /* A moth knows which rung it is on — on revival too. `newInstance` seeds
     the Evolution Counters by construction, and a hard 0 here silently
     un-evolved a revived Great Moth: it came back needing to climb to the
     rung it was already standing on. Everything that is not a moth still
     resets to 0. */
  c.counters = MOTH_STAGE[c.slug] ?? 0;
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
function toGrave(state: DuelState, uid: string, fromField: boolean, destroyed = false) {
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
    if (destroyed) fireTriggers(state, c, controller, 'onDestroyed', {});
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
function targetPool(ctx: EffectCtx, s: Selector): CardInstance[] {
  const zone = s.zone ?? 'monster';
  const pool: CardInstance[] = [];
  for (const pid of sideToPlayers(ctx, s.side)) {
    for (const c of zoneCards(ctx.state, pid, zone)) {
      if (s.excludeSelf && c.uid === ctx.source.uid) continue;
      if (matchesFilter(c, s.filter)) pool.push(c);
    }
  }
  return pool;
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
  if (s.pick === 'attacker' || s.pick === 'attackTarget') {
    const uid = s.pick === 'attacker' ? ctx.trig.attackerUid : ctx.trig.targetUid;
    const c = uid ? findOnField(state, uid)?.c : null;
    if (!c) return [];
    if (isProtectedTarget(state, c, ctx.controller, ctx)) {
      const ctrl = controllerOf(state, c.uid);
      if (ctrl) log(state, `${displayName(c)} stands beyond that effect's reach.`, 'effect', ctrl);
      return [];
    }
    return [c];
  }
  if (s.pick === 'summoned') {
    return (ctx.summoned ?? [])
      .map((uid) => findOnField(state, uid)?.c)
      .filter((c): c is CardInstance => !!c && !isProtectedTarget(state, c, ctx.controller, ctx));
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
    // If the player supplied nothing usable, fall back to the strongest legal
    // option so the effect still does something rather than silently fizzling.
    if (picked.length === 0 && pool.length > 0 && zone === 'monster') {
      picked.push(pool.reduce((a, b) => (effAtk(state, a) >= effAtk(state, b) ? a : b)));
    } else if (picked.length === 0 && pool.length > 0) {
      picked.push(pool[0]);
    }
    return picked.filter((c) => !isProtectedTarget(state, c, ctx.controller, ctx));
  }

  if (s.pick === 'all') return pool.filter((c) => zone !== 'monster' || !isProtectedTarget(state, c, ctx.controller, ctx));
  if (s.pick === 'random') {
    const legal = pool.filter((c) => !isProtectedTarget(state, c, ctx.controller, ctx));
    if (!legal.length) return [];
    return [legal[randInt(state, legal.length)]];
  }
  const legal = pool.filter((c) => !isProtectedTarget(state, c, ctx.controller, ctx));
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
function isProtectedTarget(state: DuelState, c: CardInstance, actor: PlayerId, ctx?: EffectCtx): boolean {
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
    log(state, `${displayName(c)} is a God — no card effect may destroy it.`, 'effect', found.controller);
    return;
  }
  if (byBattle && flags.indestructibleByBattle && !divine) {
    log(state, `${displayName(c)} cannot be destroyed by battle.`, 'effect', found.controller);
    return;
  }
  if (!byBattle && flags.indestructibleByEffect && !divine) {
    log(state, `${displayName(c)} is immune to that effect.`, 'effect', found.controller);
    return;
  }
  if (divine && (flags.indestructibleByBattle || flags.indestructibleByEffect || flags.untargetable)) {
    /* Its own beat, rather than riding on the destroy below. A beat carries one
       line, so two lines about the same card need two beats — and this one is
       the reason the next one happens. */
    log(state, `No protection stands before a God — ${displayName(c)} is swept aside.`, 'effect', found.controller);
    anim(state, { kind: 'note', uid: c.uid, slug: c.slug, player: found.controller });
  }
  /* Logged before it is animated, which is the whole of the pairing rule: a
     beat claims the line the duel has just written. Reversed — as this site
     was — Dark Hole gave every destroyed monster the *previous* one's name
     beside its own picture, and the first beat got the last monster's name
     off `speakRemainingLog`. One monster on the board hid it completely,
     which is why it read as "sometimes". */
  log(state, `${displayName(c)} is destroyed.`, 'effect', found.controller);
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
        if (op.scale === 'targetAtk' || op.scale === 'halfTargetAtk') {
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
            log(state, `${p.name} takes ${displayName(g)} from the Graveyard.`, 'effect', ctx.controller);
            continue;
          }
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
                  // Unless it says so: Revival Jam opts in by name.
                  (op.includeSelf || c.uid !== ctx.source.uid)
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
          // It arrived without paying for itself — see `returnBorrowedGods`.
          picked.specialSummonedOnTurn = state.turn;
          state.players[ctx.controller].monsters[zone] = picked;
          ctx.summoned = [...(ctx.summoned ?? []), picked.uid];
          log(state, `${state.players[ctx.controller].name} Special Summons ${displayName(picked)}!`, 'summon', ctx.controller);
          anim(state, { kind: 'summon', uid: picked.uid, slug: picked.slug, player: ctx.controller });
          if (picked.face === 'up') fireTriggers(state, picked, ctx.controller, 'onSummon', {});
          /* A Special Summon is a Summon, and Slifer's second mouth was only
             ever told about Normal and Fusion Summons — so a Monster Reborn'd
             Blue-Eyes, a revived anything, a searched-out Magnet Warrior, all
             walked past the God untouched. That is most of the summons in this
             game, and the card's signature quietly did nothing about them.

             Only the *monster* trigger fires here, never a trap window: making
             Special Summons open `opponentSummon` would hand Torrential Tribute
             to the whole roster, which is a different change than this one. */
          if (!state.winner && picked.face === 'up') fireOpponentSummon(state, ctx.controller, picked.uid);
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
          if (!state.winner) fireOpponentSummon(state, ctx.controller, t.uid);
        }
        /* What actually landed, not what was asked for. The loop breaks when
           the board is full, and this line sat outside it reading `op.count` —
           so a three-zone board already holding two monsters announced
           "Special Summons 2 Swamp Serpents" having summoned one, or none.
           The board must never say a thing happened that did not. */
        if (made > 0) {
          log(
            state,
            made === 1
              ? `${state.players[ctx.controller].name} Special Summons a ${op.name}.`
              : `${state.players[ctx.controller].name} Special Summons ${made} ${op.name}s.`,
            'summon',
            ctx.controller
          );
        }
        break;
      }
      case 'transformInto': {
        const found = findOnField(state, ctx.source.uid);
        if (!found) break;
        const old = displayName(ctx.source);
        ctx.source.slug = op.slug;
        /* The new form starts on its own rung, not at zero — a Petit Moth
           that evolved into Larvae Moth used to restart the climb from
           nothing while a hand-summoned Larvae began at 2. */
        ctx.source.counters = MOTH_STAGE[op.slug] ?? 0;
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
        /* A selector wins over the prompt: Spellbinding Circle attaches itself
           to the monster that declared the attack, which nobody picks. */
        const t = op.target
          ? resolveTargets(ctx, op.target)[0]
          : (targets[0] ?? state.players[ctx.controller].monsters.find((m): m is CardInstance => !!m));
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
        // Signed, because an equip can be a penalty: Spellbinding Circle takes
        // 700 off, and "(+-700 ATK)" is not a sentence.
        log(
          state,
          `${displayName(t)} is equipped with ${card(ctx.source.slug).name} (${op.atk < 0 ? '' : '+'}${op.atk} ATK).`,
          'effect',
          ctx.controller
        );
        break;
      }
      case 'drawTo':
        for (const who of sideToPlayers(ctx, op.who)) {
          for (let i = state.players[who].hand.length; i < op.count; i++) drawCard(state, who);
        }
        break;
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
              log(state, `${displayName(t)} is flipped face-up!`, 'effect', ctrl);
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

/**
 * Where each rung of Petit Moth's ladder stands, in Evolution Counters.
 *
 * Weevil's deck holds Larvae Moth and both Great Moths as ordinary monsters, so
 * one can be Normal Summoned straight out of the hand — and it arrived with no
 * counters at all, needing three more End Phases to reach the rung *above* the
 * one it was already standing on. A moth summoned by hand now starts where a
 * moth that grew into it would be, so the ladder reads the same either way:
 * Larvae Moth is one End Phase from Great Moth however it got there.
 */
const MOTH_STAGE: Record<string, number> = {
  'petit-moth': 0,
  'larvae-moth': 2,
  'great-moth': 3,
  'perfectly-ultimate-great-moth': 4,
};

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
  def: CardDef
) {
  for (const eff of def.effects) {
    if (eff.trigger !== trigger) continue;
    if (!conditionMet(state, eff, c, controller)) continue;
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
      if (p.lp <= eff.cost.lp) continue;
      p.lp -= eff.cost.lp;
      log(state, `${p.name} pays ${eff.cost.lp} Life Points.`, 'effect', pid);
      anim(state, { kind: 'damage', player: pid, amount: eff.cost.lp });
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
    /* The Toon toll used to be charged here — 500 Life Points per declared
       direct attack, carried by a `directAttackTax` grant. Reported as too
       expensive ("monsters needing lp to attack is a lot") and removed with
       the rest of that pricing pass; the flag went with it rather than
       staying behind as a branch no card can reach. */
    const dmg = battleDamageFrom(state, attacker, controller, effAtk(state, attacker, controller), true);
    anim(state, { kind: 'directAttack', uid: attacker.uid, slug: attacker.slug, player: controller, amount: dmg });
    dealDamage(state, defender, dmg, true);
    if (!state.winner) fireTriggers(state, attacker, controller, 'onDealBattleDamage', { attackerUid: attacker.uid });
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
    log(state, `${displayName(target)} is flipped face-up!`, 'effect', defender);
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
    text: displayName(target),
    player: controller,
  });

  const atk = effAtk(state, attacker, controller);
  const flags = effFlags(state, attacker, controller);

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
    log(state, `${displayName(theirMonster)} throws the blow back.`, 'effect', who);
    dealDamage(state, other(who), amount, true);
  };

  if (target.position === 'atk') {
    const tAtk = effAtk(state, target, defender);
    if (atk > tAtk) {
      battleHit(defender, battleDamageFrom(state, attacker, controller, atk - tAtk), target);
      destroyCard(state, target, true, { state, controller, source: attacker, targets: [], cursor: 0, trig: { attackerUid: attacker.uid } });
      if (!state.winner) {
        fireTriggers(state, attacker, controller, 'onBattleDestroy', { targetUid: target.uid });
        fireTriggers(state, attacker, controller, 'onDealBattleDamage', { attackerUid: attacker.uid });
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
      log(state, `${displayName(m)} cannot be borrowed — it returns to the Graveyard.`, 'effect', pid);
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
  if (need > 0 && state && pid && isToon(slug) && faceUpOnSide(state, pid, 'toon-world')) need = 0;
  return need;
}

export function monstersFrozen(state: DuelState, pid: PlayerId): boolean {
  return state.ongoing.some((o) => o.kind === 'freezeMonsters' && o.target === pid);
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
  if (eff.cost?.lp != null && p.lp <= eff.cost.lp) return false;
  if (eff.cost?.tributeSelf) {
    // The card pays with itself, so there is nothing beside it to check.
  } else if (eff.cost?.tribute != null) {
    if (tributeFodder(state, pid, eff, exclude).length < eff.cost.tribute) return false;
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
      for (const tu of tributes) {
        log(state, `${p.name} tributes ${displayName(p.monsters.find((m) => m?.uid === tu)!)}.`, 'summon', pid);
        toGrave(state, tu, true);
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
      p.monsters[dest] = c;
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
      /* Setting a monster face-down is not a Summon, and opened this window
         anyway — so Trap Hole went off on a Set, and the prompt announced the
         card by name while it was still face-down, which is the opposite of
         what setting one is for. */
      if (!state.winner && c.face === 'up') {
        fireOpponentSummon(state, pid, c.uid);
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
      /* Refused with a reason rather than spent for nothing. The interface
         already hides the card, so this only catches a tap that raced the
         board — but a Spell that leaves the hand having done nothing is the
         worst way to find out. */
      if (eff?.condition && !conditionMet(state, eff, c, pid)) {
        return { state: prev, error: 'Its condition is not met.' };
      }
      if (eff && activationIsDead(state, pid, c, def, eff)) {
        return { state: prev, error: 'There is nothing for that card to affect.' };
      }
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
      /* What the cost ate, kept so an op can be worth what it cost — Catapult
         Turtle throws a monster and it lands for that monster's ATK. Read
         *before* the tribute, because a card in the Graveyard has no
         effective stats to read. */
      const tributedAtk: number[] = [];
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
      const ctx: EffectCtx = { state, controller: pid, source: c, targets: action.targets ?? [], cursor: 0, trig: {}, tributedAtk };
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
      log(state, `${p.name} Fusion Summons ${CARDS[ex.slug].name}!`, 'summon', pid);
      anim(state, {
        kind: 'fusion',
        uid: ex.uid,
        slug: ex.slug,
        from: chosen.map((m) => m.slug),
        player: pid,
        text: CARDS[ex.slug].cry ?? 'Fusion Summon!',
      });
      fireTriggers(state, ex, pid, 'onSummon', {}, action.targets ?? []);
      if (!state.winner) fireOpponentSummon(state, pid, ex.uid);
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
