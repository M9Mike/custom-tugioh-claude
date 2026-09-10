/**
 * Every place a battle can end, and every trigger that has to be paid there.
 *
 * Skyscraper's thousand was written into the branch where a HERO walks into a
 * monster, and nowhere else. The card's own sentence — "when an Elemental HERO
 * monster you control attacks" — named no target, so the text was true on one
 * of the engine's two attack paths and false on the other. Nothing caught it:
 * `npm run text` compares a card's words to its *data*, `npm run audit` runs
 * whatever line the deck happens to deal, and neither asks the question that
 * matters, which is whether a rule reaches every road the rule applies to.
 *
 * Mike found it in a duel. Then five more of exactly the same shape came out of
 * one afternoon's reading — a defending Battle Ox owed 300, a Vorse Raider that
 * traded itself, a Killer Needle that hurt what ran into it, piercing damage
 * that was not counted as battle damage, and a swing whose wall left mid-window.
 *
 * So this sweep does not read cards at all. It reads the *engine*: it drives a
 * real duel down each way a battle can end and asserts, for every trigger, that
 * the branch either fires it or is declared here as having no business firing
 * it. A new branch that quietly skips a payout fails. A trigger that starts
 * firing where the table says it must not fails too — the table is the claim,
 * and it is checked in both directions.
 *
 * `npm run paths`
 */
import { createDuel, applyAction } from '../src/game/engine';
import type { CardInstance, DuelAction, DuelState, PlayerId } from '../src/game/types';

const ME: PlayerId = 'p1';
const FOE: PlayerId = 'p2';
let uid = 1;
let checks = 0;
let failures = 0;

function ok(pass: boolean, label: string, detail = '') {
  console.log(`  ${pass ? '✅' : '❌'} ${label}${!pass && detail ? ` — ${detail}` : ''}`);
  checks += 1;
  if (!pass) failures += 1;
}

function fresh(): DuelState {
  const s = structuredClone(
    createDuel({ seed: 7, p1: { duelistId: 'kaiba', name: 'Me' }, p2: { duelistId: 'yugi', name: 'Foe' } })
  );
  s.turn = 6;
  s.active = ME;
  s.phase = 'battle';
  for (const pid of [ME, FOE] as PlayerId[]) {
    const p = s.players[pid];
    p.monsters = [null, null, null];
    p.spellTrap = null;
    p.field = null;
    p.hand = [];
    p.grave = [];
    p.lp = 8000; // room for a whole battle without anybody falling over
    p.normalSummonUsed = false;
  }
  return s;
}

function body(pid: PlayerId, slug: string, atk?: number, position: 'atk' | 'def' = 'atk'): CardInstance {
  return {
    uid: `p${uid++}`,
    slug,
    owner: pid,
    face: 'up',
    position,
    atkMod: 0,
    defMod: 0,
    turnAtkMod: 0,
    turnDefMod: 0,
    counters: 0,
    equips: [],
    flags: {},
    turnFlags: {},
    summonedOnTurn: 0,
    attacksUsed: 0,
    effectUsedOnTurn: -1,
    absorbed: [],
    ...(atk != null ? { atkMod: 0 } : {}),
  };
}

function act(s: DuelState, pid: PlayerId, a: DuelAction): DuelState {
  const r = applyAction(s, pid, a);
  if (r.error) throw new Error(`${a.type} refused: ${r.error}`);
  return r.state;
}

/** Drain any question the board asks, taking the first option each time. */
function settle(s: DuelState): DuelState {
  let out = s;
  let guard = 0;
  while (out.pending && guard++ < 12) {
    const p = out.pending;
    out = act(out, p.player, p.kind === 'choose'
      ? { type: 'chooseCard', uids: p.options.length ? [p.options[0]] : [] }
      : { type: 'respondTrap', uid: null });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The instrument: a card that shouts whenever a trigger reaches it.    */
/* ------------------------------------------------------------------ */

/**
 * Rather than invent a probe card — which would only prove the probe works —
 * each trigger is watched through a card already in the game whose payout is
 * visible in the state. That way a green line here is a green line for a card
 * Mike can actually draw.
 */
const WATCH = {
  onBattleDestroy: {
    slug: 'battle-ox', // "destroys a monster in battle: it gains 300 ATK permanently"
    fired: (s: DuelState, u: string) => findAnywhere(s, u)?.atkMod === 300,
  },
  onDealBattleDamage: {
    slug: 'killer-needle', // "inflicts battle damage: … this monster gains 500 ATK"
    fired: (s: DuelState, u: string) => findAnywhere(s, u)?.atkMod === 500,
  },
  /* Darkbright's beat pays the same 1000 whatever the battle did, which makes
     it invisible in the Life Points — the battle moved those too. So this one
     is read off the log line the effect writes, which is the only record that
     says *why* a number changed. */
  onBattle: {
    slug: 'elemental-hero-darkbright',
    fired: (s: DuelState, u: string) => {
      const c = findAnywhere(s, u);
      return !!c && s.log.some((l) => l.slug === c.slug && l.tone === 'damage');
    },
  },
} as const;

function findAnywhere(s: DuelState, u: string): CardInstance | undefined {
  for (const pid of [ME, FOE] as PlayerId[]) {
    const p = s.players[pid];
    const m = p.monsters.find((x) => x?.uid === u);
    if (m) return m;
    const g = p.grave.find((x) => x.uid === u);
    if (g) return g;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* The branches, and what each one owes.                                */
/* ------------------------------------------------------------------ */

type Role = 'attacker' | 'defender';

interface Branch {
  name: string;
  /** How the battle is set up and run, with the watched card in `role`. */
  run: (watched: CardInstance, role: Role) => DuelState;
  /** Which triggers this branch owes the watched card, per role. */
  owes: Record<Role, (keyof typeof WATCH)[]>;
}

/** A battle between `mine` and `theirs`, resolved. */
function fight(mine: CardInstance, theirs: CardInstance): DuelState {
  const s = fresh();
  s.players[ME].monsters = [mine, null, null];
  s.players[FOE].monsters = [theirs, null, null];
  return settle(act(s, ME, { type: 'attack', uid: mine.uid, targetUid: theirs.uid }));
}

/** A weak body for the watched card to beat, or a strong one to lose to. */
const weak = (pid: PlayerId, position: 'atk' | 'def' = 'atk') => body(pid, 'kuriboh', undefined, position); // 300
const strong = (pid: PlayerId) => body(pid, 'blue-eyes-white-dragon'); // 3000

/**
 * Darkbright is 2000/1000 and Battle Ox 1700, so "weak" and "strong" have to be
 * weak and strong relative to whichever card is being watched. These two sit
 * clear of every watched body on both numbers.
 */
const BRANCHES: Branch[] = [
  {
    name: 'the attacker breaks a standing monster',
    run: (w, role) => (role === 'attacker' ? fight(w, weak(FOE)) : fight(strong(ME), w)),
    /* Attacking, it kills and hurts. Defending, it is the one that fell — and a
       body in the Graveyard is owed nothing for the blow that put it there. */
    owes: { attacker: ['onBattleDestroy', 'onDealBattleDamage', 'onBattle'], defender: ['onBattle'] },
  },
  {
    name: 'the standing monster breaks its attacker',
    run: (w, role) => (role === 'attacker' ? fight(w, strong(FOE)) : fight(weak(ME), w)),
    /* The wall wins on both counts. This is the branch that paid nothing. */
    owes: { attacker: ['onBattle'], defender: ['onBattleDestroy', 'onDealBattleDamage', 'onBattle'] },
  },
  {
    name: 'both fall together',
    run: (w, role) => {
      const twin = body(role === 'attacker' ? FOE : ME, w.slug);
      return role === 'attacker' ? fight(w, twin) : fight(twin, w);
    },
    /* Two kills, no damage — the numbers were equal. Each is owed its kill. */
    owes: { attacker: ['onBattleDestroy', 'onBattle'], defender: ['onBattleDestroy', 'onBattle'] },
  },
  {
    name: 'the attacker goes through a guard',
    run: (w, role) => {
      /* The watched card itself, laid down — `body(FOE, w.slug)` would mint a
         second copy with a uid nothing then looks for, and the row would pass
         by being unobservable rather than by being right. */
      if (role === 'defender') return fight(strong(ME), { ...w, position: 'def' as const });
      const s = fresh();
      s.players[ME].monsters = [w, null, null];
      s.players[ME].field = body(ME, 'temple-of-the-kings'); // lends piercing
      s.players[FOE].monsters = [weak(FOE, 'def'), null, null];
      return settle(act(s, ME, { type: 'attack', uid: w.uid, targetUid: s.players[FOE].monsters[0]!.uid }));
    },
    /* Piercing damage is battle damage, which is what it was not being counted
       as. The kneeling body is broken too. */
    owes: { attacker: ['onBattleDestroy', 'onDealBattleDamage', 'onBattle'], defender: ['onBattle'] },
  },
  {
    name: 'the attacker bounces off a guard',
    /* A guard it cannot break, *lying down* — written against a standing
       Blue-Eyes the attacker simply died, which is the branch above wearing
       this branch's name and passes without ever bouncing off anything. */
    run: (w, role) => (role === 'attacker'
      ? fight(w, { ...strong(FOE), position: 'def' as const })
      : fight(weak(ME), { ...w, position: 'def' as const })),
    /* Nothing dies. The guard hurt what ran into it, and is owed for that
       alone — the attacker walks away with nothing. */
    owes: { attacker: ['onBattle'], defender: ['onDealBattleDamage', 'onBattle'] },
  },
  {
    name: 'the swing reaches the player',
    run: (w, role) => {
      if (role === 'defender') return fresh(); // nobody is defending a direct swing
      const s = fresh();
      s.players[ME].monsters = [w, null, null];
      return settle(act(s, ME, { type: 'attack', uid: w.uid, targetUid: null }));
    },
    owes: { attacker: ['onDealBattleDamage', 'onBattle'], defender: [] },
  },
  {
    name: 'the wall leaves between declaring and resolving',
    run: (w, role) => {
      if (role === 'defender') return fresh();
      const s = fresh();
      s.players[ME].monsters = [w, null, null];
      s.players[FOE].monsters = [weak(FOE), null, null];
      s.players[FOE].spellTrap = { ...body(FOE, 'mirror-force'), face: 'down' as const };
      let mid = act(s, ME, { type: 'attack', uid: w.uid, targetUid: s.players[FOE].monsters[0]!.uid });
      mid = { ...mid, players: { ...mid.players, [FOE]: { ...mid.players[FOE], monsters: [null, null, null] } } };
      return settle(act(mid, FOE, { type: 'respondTrap', uid: null }));
    },
    /* It became a direct swing, so it owes what a direct swing owes. */
    owes: { attacker: ['onDealBattleDamage', 'onBattle'], defender: [] },
  },
];

console.log('\nBattle paths — every branch, every payout\n');

for (const branch of BRANCHES) {
  console.log(`  ${branch.name}`);
  for (const role of ['attacker', 'defender'] as Role[]) {
    for (const [trigger, watch] of Object.entries(WATCH) as [keyof typeof WATCH, (typeof WATCH)[keyof typeof WATCH]][]) {
      const owed = branch.owes[role].includes(trigger);
      const w = body(role === 'attacker' ? ME : FOE, watch.slug);
      let after: DuelState;
      try {
        after = branch.run(w, role);
      } catch (e) {
        ok(false, `    ${role} ${trigger}: the branch could not be reached`, String(e).slice(0, 110));
        continue;
      }
      const found = findAnywhere(after, w.uid);
      if (!found) {
        /* The watched card was never in this battle — a defender in a direct
           swing, say. Nothing is owed and nothing can be observed. */
        if (owed) ok(false, `    ${role} ${trigger}: owed, but the card never took part`);
        continue;
      }
      const fired = watch.fired(after, w.uid);
      ok(fired === owed,
        `    ${role} ${trigger}: ${owed ? 'paid' : 'not owed, and not paid'}`,
        owed ? 'the branch owes it and did not fire it' : 'the branch fired it and should not have');
    }
  }
}

console.log(`\nBattle paths: ${checks - failures}/${checks}` + (failures ? ' ❌' : ' — every branch pays what it owes. ✅'));
if (failures) process.exitCode = 1;
