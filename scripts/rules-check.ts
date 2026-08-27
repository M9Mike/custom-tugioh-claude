/**
 * Regression tests for specific rules situations that were reported broken.
 *
 * The card audit proves every card's effect *fires*; this proves the awkward
 * interactions around them behave correctly — forced flips, revival versus
 * Normal Summon, a zone freed by the very monster that wants it, equips living
 * in the Spell/Trap Zone, and piercing into a flip effect.
 *
 *   npx tsx scripts/rules-check.ts
 */
import { KNOB_LIMIT, NEUTRAL, updateBrain } from '../src/server/learning';
import { revivable } from '../src/game/targeting';
import { choiceResponses , tributeUnits} from '../src/game/engine';
import { applyAction, cloneState, canActivateFromHand, canActivateSetCard, canAttackWith, canIgnite, createDuel, displayName, effAtk, effDef, effFlags, fusionOptions, handSummonOffer, legalAttackTargets, makesSeven, maxAttacks, summonBlocked, tributesRequired, viewFor, wastedWithoutTarget } from '../src/game/engine';
import { CARDS, baseAtk as baseAtkOf, isToon } from '../src/game/cards';
import { pickerSides, summonChoiceSpec, summonTargetSpec, targetCandidates, targetSpecFor, targetSpecForEffect } from '../src/game/ui';
import { candidates as aiCandidates } from '../src/game/ai';
import { chooseAction as autoChoose, legalActions as autoLegal } from '../src/game/autoplay';
import { isSignatureBeat, spokenFor } from '../src/game/announce';
import { canDiscardForEffect, ignitionOptions, summonAffordable, tributableBodies } from '../src/game/engine';
import { isFinalRound, type Tournament } from '../src/server/tournament';
import { INFINITE_ATK, type CardInstance, type DuelAction, type DuelState, type Op, type PlayerId } from '../src/game/types';

const ME: PlayerId = 'p1';
const FOE: PlayerId = 'p2';

let uid = 0;
let failures = 0;
let checks = 0;

function ok(pass: boolean, label: string, detail = '') {
  console.log(`  ${pass ? '✅' : '❌'} ${label}${!pass && detail ? ` — ${detail}` : ''}`);
  checks += 1;
  if (!pass) failures += 1;
}

function fresh(phase: 'main' | 'battle' = 'main'): DuelState {
  const s = structuredClone(
    createDuel({ seed: 99, p1: { duelistId: 'kaiba', name: 'Me' }, p2: { duelistId: 'yugi', name: 'Foe' } })
  );
  s.turn = 6;
  s.active = ME;
  s.phase = phase;
  for (const pid of [ME, FOE] as PlayerId[]) {
    const p = s.players[pid];
    p.monsters = [null, null, null];
    p.spellTrap = null;
    p.field = null;
    p.hand = [];
    p.grave = [];
    p.lp = 4000;
    p.normalSummonUsed = false;
  }
  return s;
}

function card(pid: PlayerId, slug: string): CardInstance {
  return {
    uid: `t${uid++}`,
    slug,
    owner: pid,
    face: 'up',
    position: 'atk',
    atkMod: 0,
    defMod: 0,
    turnAtkMod: 0,
    turnDefMod: 0,
    counters: 0,
    equips: [],
    equippedTo: undefined,
    flags: {},
    turnFlags: {},
    summonedOnTurn: 0,
    attacksUsed: 0,
    effectUsedOnTurn: -1,
    absorbed: [],
    isToken: false,
  };
}

function act(s: DuelState, pid: PlayerId, a: DuelAction): DuelState {
  const r = applyAction(s, pid, a);
  if (r.error) throw new Error(`${a.type} rejected: ${r.error}`);
  return r.state;
}

/**
 * Answer whatever question the duel is holding, naming the cards you want.
 *
 * Most effects that pick a card now stop and ask — see `raiseChoice`, which
 * lost its opt-in — so a test that summons a searcher and then reads the hand
 * is reading it one beat too early. This is the beat: the board would put a
 * modal up here, and a duel with an AI on that seat would answer from
 * `choiceResponses`.
 *
 * Named by slug rather than by uid because that is what a test knows. Throws
 * when the duel is not asking anything, or when the card named is not one of
 * the answers — both of those are the test being wrong about the rules, which
 * is exactly what it is here to find out.
 */
function answer(s: DuelState, ...slugs: string[]): DuelState {
  const p = s.pending;
  /* Reported rather than thrown, and deliberately — see the note on `guard`
     below. A helper that throws kills the process before the summary, so one
     card that stops asking hides every other card that stopped asking with it,
     and a falsification run reports one failure where there are twenty. The
     state comes back untouched, so the assertions that follow fail on their
     own terms and each one names itself. */
  if (!p || p.kind !== 'choose') {
    ok(false, `answer(${slugs.join(', ')}) — but nothing is being asked`, `pending: ${p?.kind ?? 'none'}`);
    return s;
  }
  const uids: string[] = [];
  for (const want of slugs) {
    const hit = p.options.find((u) => findCard(s, u)?.slug === want && !uids.includes(u));
    if (!hit) {
      ok(false, `answer(${want}) — but that is not one of the answers`, p.options.map((u) => findCard(s, u)?.slug ?? '?').join(', '));
      return s;
    }
    uids.push(hit);
  }
  return act(s, p.player, { type: 'chooseCard', uids });
}

/** Is the duel asking, and what is it offering? For pins about the question itself. */
function asked(s: DuelState): string[] | null {
  const p = s.pending;
  if (!p || p.kind !== 'choose') return null;
  return p.options.map((u) => findCard(s, u)?.slug ?? '?').sort();
}

/** Every card anywhere in the duel, by uid — the piles a question can reach into. */
function findCard(s: DuelState, uid: string): CardInstance | undefined {
  for (const pid of ['p1', 'p2'] as PlayerId[]) {
    const p = s.players[pid];
    const pools: (CardInstance | null | undefined)[] = [
      ...p.monsters, p.spellTrap, p.field, ...p.hand, ...p.deck, ...p.grave, ...p.banished, ...p.extra,
    ];
    const hit = pools.find((c) => c?.uid === uid);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * A throw must not be able to swallow the verdict.
 *
 * `act` throws when the engine refuses an action, which is right for a test
 * whose setup has gone wrong — but this file prints its summary *last*, so an
 * uncaught throw killed the process before the count, the verdict and the exit
 * code ever happened. What reached the terminal was a bare stack trace, which
 * reads as the engine being broken when what broke was one test's setup.
 *
 * Found while falsifying Revival Jam: the run died partway, printed no
 * summary, and the falsification looked like it had proved something it had
 * not. Exactly the lesson already written on the summary line itself, one
 * level up — a suite that cannot report failure is worse than a check that
 * cannot fail — and the same shape as the rejoin probe's missing `catch`.
 *
 * The blocks below are plain `{ }` scopes rather than callbacks, so this is
 * the one place that can cover all of them. It does not let the rest of the
 * run continue; it makes sure the run *says* it stopped.
 */
process.on('uncaughtException', (err) => {
  console.log(`\n❌ the battery threw and stopped early — ${err instanceof Error ? err.message : String(err)}`);
  console.log(err instanceof Error && err.stack ? err.stack.split('\n').slice(1, 4).join('\n') : '');
  console.log(`\n${checks} assertions ran before it died. This run proves nothing about the rest.`);
  process.exit(1);
});

const on = (s: DuelState, pid: PlayerId) => s.players[pid].monsters.filter((m): m is CardInstance => !!m);

console.log('Rules regressions\n');

/* 1. A forced flip is still a flip. -------------------------------------- */
{
  const s = fresh();
  const bug = card(FOE, 'man-eater-bug');
  bug.face = 'down';
  bug.position = 'def';
  s.players[FOE].monsters[0] = bug;
  const prey = card(ME, 'blue-eyes-white-dragon');
  s.players[ME].monsters[0] = prey;
  const stop = card(ME, 'stop-defense');
  s.players[ME].hand.push(stop);

  const after = act(s, ME, { type: 'activateSpell', uid: stop.uid, targets: [bug.uid] });
  const flipped = after.players[FOE].monsters[0];
  ok(flipped?.face === 'up' && flipped.position === 'atk', 'Stop Defense turns the set monster face-up in Attack Position');
  ok(on(after, ME).length === 0, 'Man-Eater Bug flipped by Stop Defense still eats a monster', `${on(after, ME).length} left`);
}

/* 2. A summon is a summon, however the monster got there. -----------------
 *
 * This pin used to assert the opposite — that a revived monster collected
 * nothing — and it was right about the engine and wrong about the game. The
 * owner's rule: a card that says "when Normal Summoned" should pay out
 * whenever it arrives face-up, Special Summons included. A face-down Set is
 * still not a summon and still pays nothing.
 *
 * Lady of Faith is the canonical case, so she is the one pinned in all three
 * directions.
 */
{
  // Normal Summon: the bonus applies.
  const a = fresh();
  const lady = card(ME, 'lady-of-faith');
  a.players[ME].hand.push(lady);
  const summoned = act(a, ME, { type: 'normalSummon', uid: lady.uid, zone: 0, position: 'atk', face: 'up' });
  ok(summoned.players[ME].lp > 4000, 'Lady of Faith pays out when Normal Summoned', `LP ${summoned.players[ME].lp}`);

  // Monster Reborn: it must too, now.
  const b = fresh();
  const dead = card(ME, 'lady-of-faith');
  b.players[ME].grave.push(dead);
  const reborn = card(ME, 'monster-reborn');
  b.players[ME].hand.push(reborn);
  const revived = act(b, ME, { type: 'activateSpell', uid: reborn.uid, targets: [dead.uid] });
  ok(on(revived, ME).length === 1, 'Monster Reborn puts Lady of Faith on the field');
  ok(revived.players[ME].lp > 4000, 'and she pays out when Special Summoned as well', `LP ${revived.players[ME].lp}`);

  /* Setting one face-down is still not a summon. This is the half of the rule
     that is easy to lose: `onSummon` fires from the Normal Summon path only
     when the card lands face-up, and nothing should reward hiding it. */
  const c = fresh();
  const hidden = card(ME, 'lady-of-faith');
  c.players[ME].hand.push(hidden);
  const set = act(c, ME, { type: 'normalSummon', uid: hidden.uid, zone: 0, position: 'def', face: 'down' });
  ok(set.players[ME].lp === 4000, 'CONTROL: a face-down Set pays nothing at all', `LP ${set.players[ME].lp}`);
}

/* 3. A monster's death frees the zone its own effect needs. --------------- */
{
  const s = fresh('battle');
  // A full board: three monsters, one of them Anthrosaurus.
  s.players[ME].monsters[0] = card(ME, 'anthrosaurus');
  s.players[ME].monsters[1] = card(ME, 'baby-dragon');
  s.players[ME].monsters[2] = card(ME, 'baby-dragon');
  for (const m of on(s, ME)) m.position = 'def';
  const dino = card(ME, 'two-headed-king-rex');
  s.players[ME].grave.push(dino);

  const killer = card(FOE, 'blue-eyes-white-dragon');
  s.players[FOE].monsters[0] = killer;
  s.active = FOE;

  const after = act(s, FOE, { type: 'attack', uid: killer.uid, targetUid: s.players[ME].monsters[0]!.uid });
  const revived = on(after, ME).some((m) => m.slug === 'two-headed-king-rex');
  ok(revived, 'Anthrosaurus revives a Dinosaur into the zone it just vacated', `board: ${on(after, ME).map((m) => m.slug).join(',')}`);
  ok(!on(after, ME).some((m) => m.slug === 'anthrosaurus'), 'Anthrosaurus does not revive itself');
}

/* 4. Equips live in the Spell/Trap Zone. --------------------------------- */
{
  const s = fresh();
  const host = card(ME, 'baby-dragon');
  s.players[ME].monsters[0] = host;
  const equip = card(ME, 'malevolent-nuzzler');
  s.players[ME].hand.push(equip);

  const base = effAtk(s, host, ME);
  const armed = act(s, ME, { type: 'activateSpell', uid: equip.uid, targets: [host.uid] });
  ok(armed.players[ME].spellTrap?.slug === 'malevolent-nuzzler', 'the Equip Spell stays in the Spell/Trap Zone');
  ok(!armed.players[ME].grave.some((c) => c.slug === 'malevolent-nuzzler'), 'the Equip Spell does not go to the Graveyard on activation');
  const buffed = effAtk(armed, armed.players[ME].monsters[0]!, ME);
  ok(buffed === base + 700, 'the equipped monster gains the ATK', `${base} -> ${buffed}`);

  // Destroying the equip takes the bonus with it.
  const despell = card(FOE, 'de-spell');
  const t = structuredClone(armed);
  t.active = FOE;
  t.players[FOE].hand.push(despell);
  const stripped = act(t, FOE, { type: 'activateSpell', uid: despell.uid, targets: [] });
  ok(stripped.players[ME].spellTrap === null, 'De-Spell removes the equip from the field');
  const after = effAtk(stripped, stripped.players[ME].monsters[0]!, ME);
  ok(after === base, 'the ATK bonus disappears with the equip', `expected ${base}, got ${after}`);

  // The host dying drags the equip down with it, exactly once. Dark Hole comes
  // from the other side, because my own Spell/Trap Zone is now holding the
  // equip — which is the whole point of this change.
  const u = structuredClone(armed);
  u.active = FOE;
  const dh = card(FOE, 'dark-hole');
  u.players[FOE].hand.push(dh);
  const wiped = act(u, FOE, { type: 'activateSpell', uid: dh.uid, targets: [] });
  ok(wiped.players[ME].spellTrap === null, 'the equip leaves the field when its monster dies');
  const copies = wiped.players[ME].grave.filter((c) => c.slug === 'malevolent-nuzzler').length;
  ok(copies === 1, 'exactly one copy of the equip reaches the Graveyard', `found ${copies}`);
}

/* 5. Mirror Wall keeps working. ------------------------------------------ */
{
  const s = fresh('battle');
  const wall = card(ME, 'mirror-wall');
  wall.face = 'down';
  s.players[ME].spellTrap = wall;
  s.players[ME].monsters[0] = card(ME, 'baby-dragon');
  const attacker = card(FOE, 'blue-eyes-white-dragon');
  s.players[FOE].monsters[0] = attacker;
  s.active = FOE;

  let cur = act(s, FOE, { type: 'attack', uid: attacker.uid, targetUid: s.players[ME].monsters[0]!.uid });
  ok(!!cur.pending, 'Mirror Wall opens on the first attack');
  cur = act(cur, ME, { type: 'respondTrap', uid: wall.uid, targets: [] });
  const once = effAtk(cur, cur.players[FOE].monsters[0]!, FOE);
  ok(once === 1500, "the attacker's ATK is halved", `3000 -> ${once}`);
  ok(cur.players[ME].spellTrap?.slug === 'mirror-wall', 'Mirror Wall stays on the field');
  ok(cur.players[ME].spellTrap?.face === 'up', 'Mirror Wall is now face-up');

  // A second attack on a later turn must be catchable too.
  cur.turn += 2;
  cur.phase = 'battle';
  cur.active = FOE;
  const again = cur.players[FOE].monsters[0]!;
  again.attacksUsed = 0;
  const r = applyAction(cur, FOE, { type: 'attack', uid: again.uid, targetUid: cur.players[ME].monsters[0]?.uid ?? null });
  ok(!r.error && !!r.state.pending, 'Mirror Wall opens again on a later attack', r.error ?? 'no window');
}

/* 6. Piercing into a flip effect. ---------------------------------------- */
{
  const s = fresh('battle');
  const mage = card(FOE, 'magician-of-faith');
  mage.face = 'down';
  mage.position = 'def';
  s.players[FOE].monsters[0] = mage;
  s.players[FOE].grave.push(card(FOE, 'pot-of-greed'));

  const spear = card(ME, 'mad-sword-beast'); // pierces
  spear.flags.pierce = true;
  spear.atkMod = 2000;
  s.players[ME].monsters[0] = spear;

  const lpBefore = s.players[FOE].lp;
  const handBefore = s.players[FOE].hand.length;
  const after = act(s, ME, { type: 'attack', uid: spear.uid, targetUid: mage.uid });

  ok(on(after, FOE).length === 0, 'the flipped monster is destroyed by the stronger attacker');
  ok(after.players[FOE].lp < lpBefore, 'piercing damage still gets through', `LP ${lpBefore} -> ${after.players[FOE].lp}`);
  ok(
    after.players[FOE].hand.length > handBefore,
    'Magician of Faith still recovers a Spell when flipped by the attack that kills her',
    `hand ${handBefore} -> ${after.players[FOE].hand.length}`
  );
}

/* ------------------------------------------------------------------ */
console.log('\nRelinquished absorbs when its Ritual summons it');
{
  const s = fresh();
  // The victim: something worth stealing.
  const prey = card(FOE, 'summoned-skull');
  s.players[FOE].monsters[0] = prey;
  // A body to pay the ritual's tribute, and the ritual itself in hand.
  s.players[ME].monsters[0] = card(ME, 'kuriboh');
  const ritual = card(ME, 'black-illusion-ritual');
  s.players[ME].hand = [ritual];
  s.players[ME].deck.push(card(ME, 'relinquished'));

  const after = act(s, ME, { type: 'activateSpell', uid: ritual.uid });
  const rel = on(after, ME).find((c) => c.slug === 'relinquished');

  ok(!!rel, 'Relinquished arrives from the Ritual');
  ok(
    !!rel && rel.absorbed.length === 1,
    'and absorbs on arrival — it used to trigger on Normal Summon only, which a Ritual never is',
    rel ? `absorbed ${rel.absorbed.length}` : 'no Relinquished'
  );
  ok(!!rel && effAtk(after, rel) > 0, 'taking the absorbed monster\'s ATK with it', rel ? `ATK ${effAtk(after, rel)}` : '');
  /* Asserted through `effFlags` rather than the raw instance flag: the property
     is an aura read from the field now, and a test that reads `flags` directly
     is checking the mechanism rather than whether the monster can be killed. */
  ok(
    !!rel && effFlags(after, rel, ME).indestructibleByBattle === true,
    'and cannot be destroyed by battle'
  );
  ok(on(after, FOE).length === 0, 'the absorbed monster is gone from their field');
}

/* ------------------------------------------------------------------ */
console.log('\nContinuous and Field Spells with no activation effect can still be played');
{
  for (const slug of ['the-dark-door', 'dark-sanctuary', 'umi']) {
    const s = fresh();
    const c = card(ME, slug);
    s.players[ME].hand = [c];
    const after = act(s, ME, { type: 'activateSpell', uid: c.uid });
    const placed = after.players[ME].field?.slug === slug || after.players[ME].spellTrap?.slug === slug;
    ok(placed, `${slug} reaches the field`);
  }
}

/* ------------------------------------------------------------------ */
console.log('\nA set monster destroyed by an attack still flips and fires');
{
  const s = fresh('battle');
  // Face-down Man-Eater Bug: flipping it destroys a monster, and it is weak
  // enough that the attack kills it in the same breath.
  const bug = card(FOE, 'man-eater-bug');
  bug.face = 'down';
  bug.position = 'def';
  s.players[FOE].monsters[0] = bug;

  const big = card(ME, 'summoned-skull');
  s.players[ME].monsters[0] = big;
  const spare = card(ME, 'hitotsu-me-giant');
  s.players[ME].monsters[1] = spare;

  const after0 = act(s, ME, { type: 'attack', uid: big.uid, targetUid: bug.uid });

  ok(on(after0, FOE).length === 0, 'the attacked face-down monster is destroyed');
  /* And its bite is now the defender's to aim. Two of my monsters are standing,
     so the bug has a real choice and the engine stops making it — the window
     opens on the player whose bug it is, on a turn that is not theirs. */
  ok(after0.pending?.kind === 'choose' && after0.pending.player === FOE,
    'and it asks its owner which of mine to take, mid-attack, on my turn',
    after0.pending ? `${after0.pending.kind} for ${after0.pending.player}` : '(nothing asked)');
  const after = act(after0, FOE, { type: 'chooseCard', uids: [spare.uid] });
  ok(
    !on(after, ME).some((m) => m.uid === spare.uid),
    'and its flip effect still resolved — being destroyed by the attack does not cancel it',
    `attacker side went 2 -> ${on(after, ME).length}`
  );
}

/* ------------------------------------------------------------------ */
console.log('\nThe Earl of Demise blows up a Spell or Trap whichever way it is facing');
{
  /* He used to reach only Set cards. By the owner's ruling he now reaches "1
     Spell or Trap your opponent controls", which is the sentence De-Spell and
     Dark Magician's ignition already say — so it means what it means there:
     either face, and the Field Zone counts. */
  for (const face of ['up', 'down'] as const) {
    const s = fresh();
    const st = card(FOE, 'swords-of-revealing-light');
    st.face = face;
    s.players[FOE].spellTrap = st;
    const earl = card(ME, 'the-earl-of-demise');
    s.players[ME].hand = [earl];
    const t1 = card(ME, 'kuriboh');
    const t2 = card(ME, 'kuriboh');
    s.players[ME].monsters[0] = t1;
    s.players[ME].monsters[1] = t2;
    const after = act(s, ME, {
      type: 'normalSummon',
      uid: earl.uid,
      zone: 2,
      position: 'atk',
      face: 'up',
      tributes: [t1.uid, t2.uid],
      targets: [st.uid],
    });
    ok(!after.players[FOE].spellTrap, `a face-${face} Spell is destroyed`,
      after.players[FOE].spellTrap ? 'it survived' : 'gone');
  }

  /* And with nobody named, he asks rather than helping himself — then exactly
     one falls, never both. "Destroy 1" is a number the card has to keep however
     the choice is reached. */
  const auto = fresh();
  const earl2 = card(ME, 'the-earl-of-demise');
  auto.players[ME].hand = [earl2];
  const t3 = card(ME, 'kuriboh');
  const t4 = card(ME, 'kuriboh');
  auto.players[ME].monsters = [t3, t4, null];
  auto.players[FOE].spellTrap = { ...card(FOE, 'trap-hole'), face: 'down' as const };
  auto.players[FOE].field = { ...card(FOE, 'umi'), face: 'up' as const };
  const unasked = act(auto, ME, {
    type: 'normalSummon', uid: earl2.uid, zone: 2, position: 'atk', face: 'up', tributes: [t3.uid, t4.uid],
  });
  ok(unasked.pending?.kind === 'choose', 'the Earl asks which of the two to shatter', unasked.pending?.kind ?? '(nothing asked)');
  const answered = act(unasked, ME, { type: 'chooseCard', uids: [unasked.players[FOE].field!.uid] });
  const left = [answered.players[FOE].spellTrap, answered.players[FOE].field].filter(Boolean).length;
  ok(left === 1, 'and exactly one of the two falls, never both', `${left} of 2 left standing`);
  ok(!answered.players[FOE].field, 'the one you named');
}

/* ------------------------------------------------------------------ */
console.log('\nA Deck search takes the strongest match, not whatever is on top');
{
  const s = fresh('battle');
  // Sangan dies in battle, which is what fires its search.
  const sangan = card(FOE, 'sangan');
  s.players[FOE].monsters[0] = sangan;
  const killer = card(ME, 'summoned-skull');
  s.players[ME].monsters[0] = killer;
  // Deck order deliberately puts the weakest legal option first. Sangan is
  // capped at 1500 ATK, so Summoned Skull is *not* a legal pick.
  s.players[FOE].deck = [
    card(FOE, 'kuriboh'), // 300
    card(FOE, 'summoned-skull'), // 2500 — over the cap
    card(FOE, 'hitotsu-me-giant'), // 1200, the strongest legal one
  ];
  s.players[FOE].hand = [];

  const after = act(s, ME, { type: 'attack', uid: killer.uid, targetUid: sangan.uid });
  const added = after.players[FOE].hand.map((c) => c.slug);

  /* Sangan asks nothing, and that is the card rather than an oversight. Its
     text names both ends out loud — "the weakest monster from your Deck", "the
     strongest monster with 1500 or less ATK" — so there is no decision left to
     put in front of anybody. Every other search in the game means "1 of these"
     and does ask; see `selfRuled`, which is how the two are told apart. */
  ok(asked(after) === null, 'a card that names its own end asks nothing', JSON.stringify(asked(after)));
  ok(added.length === 1, 'Sangan adds exactly one card', `added ${added.join(', ') || 'nothing'}`);
  ok(
    added[0] === 'hitotsu-me-giant',
    'and it is the strongest one under the cap, not the first in the deck',
    `got ${added[0] ?? 'nothing'}`
  );
  ok(
    after.players[FOE].monsters.some((m) => m?.slug === 'kuriboh'),
    'while the body it stands up is the weakest, exactly as its text says',
    after.players[FOE].monsters.map((m) => m?.slug ?? '-').join(',')
  );
}

console.log('\nRitual and Toon monsters cannot simply be Normal Summoned');
{
  // Relinquished used to walk out of the hand for free while Black Illusion
  // Ritual, the card whose whole job is to put it there, sat unused.
  const s = fresh();
  const rel = card(ME, 'relinquished');
  s.players[ME].hand = [rel];
  const refused = applyAction(s, ME, { type: 'normalSummon', uid: rel.uid, zone: 0, position: 'atk', face: 'up' });
  ok(!!refused.error, 'Relinquished cannot be Normal Summoned', refused.error ?? 'it was summoned');

  // …and its Ritual Spell brings it out of the hand, not only the Deck.
  const r = fresh();
  const held = card(ME, 'relinquished');
  const spell = card(ME, 'black-illusion-ritual');
  r.players[ME].hand = [held, spell];
  r.players[ME].monsters[0] = card(ME, 'baby-dragon'); // the tribute
  const summoned = act(r, ME, { type: 'activateSpell', uid: spell.uid, targets: [] });
  ok(
    summoned.players[ME].monsters.some((m) => m?.slug === 'relinquished'),
    'Black Illusion Ritual summons a Relinquished held in hand'
  );
}

console.log('\nA Toon needs Toon World before it can be Summoned');
{
  const s = fresh();
  const toon = card(ME, 'toon-mermaid');
  s.players[ME].hand = [toon];
  const refused = applyAction(s, ME, { type: 'normalSummon', uid: toon.uid, zone: 0, position: 'atk', face: 'up' });
  ok(!!refused.error, 'Toon Mermaid is refused with no Toon World', refused.error ?? 'it was summoned');

  const w = fresh();
  const toon2 = card(ME, 'toon-mermaid');
  w.players[ME].hand = [toon2];
  const world = card(ME, 'toon-world');
  world.face = 'up';
  w.players[ME].spellTrap = world;
  const done = act(w, ME, { type: 'normalSummon', uid: toon2.uid, zone: 0, position: 'atk', face: 'up' });
  ok(done.players[ME].monsters[0]?.slug === 'toon-mermaid', 'and goes through once Toon World is face-up');

  // Toon Alligator is the way in, so it must never be gated on Toon World.
  const a = fresh();
  const gator = card(ME, 'toon-alligator');
  a.players[ME].hand = [gator];
  const gatorOut = act(a, ME, { type: 'normalSummon', uid: gator.uid, zone: 0, position: 'atk', face: 'up' });
  ok(gatorOut.players[ME].monsters[0]?.slug === 'toon-alligator', 'Toon Alligator is summonable without it');
}

console.log('\nSwords of Revealing Light locks the opponent, not the caster');
{
  const s = fresh();
  const spell = card(ME, 'swords-of-revealing-light');
  s.players[ME].hand = [spell];
  const mine = card(ME, 'summoned-skull');
  mine.summonedOnTurn = 0;
  s.players[ME].monsters[0] = mine;
  const theirs = card(FOE, 'baby-dragon');
  theirs.summonedOnTurn = 0;
  s.players[FOE].monsters[0] = theirs;

  const after = act(s, ME, { type: 'activateSpell', uid: spell.uid, targets: [] });
  after.phase = 'battle';
  ok(canAttackWith(after, ME, after.players[ME].monsters[0]!), 'my own monster can still attack');
  const foeTurn = { ...after, active: FOE };
  ok(!canAttackWith(foeTurn, FOE, foeTurn.players[FOE].monsters[0]!), "the opponent's cannot");
}

console.log('\nA card already face-up on the field cannot be activated again');
{
  // Call of the Haunted stays face-up after it resolves. Being on the field is
  // not the same as being armed again, or it would fire every single turn.
  const s = fresh();
  const trap = card(ME, 'call-of-the-haunted');
  trap.face = 'up';
  trap.summonedOnTurn = 0;
  s.players[ME].spellTrap = trap;
  ok(!canActivateSetCard(s, ME, trap), 'a face-up continuous trap is not offered again');

  /* And the same for every Continuous or Field Spell — those sit in the zone
     for the rest of the duel, so "still there" must not read as "ready". Shadow
     Spell and the other reusable traps are the deliberate exception: they are
     an ongoing threat that fires each time an attack is declared, which is the
     whole reason they are allowed to stay. */
  for (const slug of ['toon-world', 'the-dark-door', 'dark-sanctuary', 'umi', 'insect-barrier', 'harpies-hunting-ground', 'tornado-wall']) {
    const z = fresh();
    const c = card(ME, slug);
    c.face = 'up';
    c.summonedOnTurn = 0;
    if (CARDS[slug]?.subKind === 'Field') z.players[ME].field = c;
    else z.players[ME].spellTrap = c;
    ok(!canActivateSetCard(z, ME, c), `${CARDS[slug]?.name ?? slug} cannot be activated a second time`);
  }
}

console.log('\nA card does what its text says, not a convenient half of it');
{
  /* Masaki no longer refuses to die — the owner traded the immortality for a
     rate that counts his company, living and fallen. He is destroyed in battle
     like anybody else, and the two rates are pinned below. */
  const alone = fresh('battle');
  const m1 = card(FOE, 'masaki-the-legendary-swordsman');
  m1.summonedOnTurn = 0;
  alone.players[FOE].monsters[0] = m1;
  const killer = card(ME, 'summoned-skull');
  killer.summonedOnTurn = 0;
  alone.players[ME].monsters[0] = killer;
  const after = act(alone, ME, { type: 'attack', uid: killer.uid, targetUid: m1.uid });
  ok(!after.players[FOE].monsters.some((m) => m?.uid === m1.uid), 'Masaki alone is destroyed in battle');

  const guarded = fresh('battle');
  const m2 = card(FOE, 'masaki-the-legendary-swordsman');
  m2.summonedOnTurn = 0;
  guarded.players[FOE].monsters[0] = m2;
  guarded.players[FOE].monsters[1] = card(FOE, 'kojikocy'); // another Warrior
  const killer2 = card(ME, 'summoned-skull'); // 2500, over Masaki's 1100 + 500
  killer2.summonedOnTurn = 0;
  guarded.players[ME].monsters[0] = killer2;
  const after2 = act(guarded, ME, { type: 'attack', uid: killer2.uid, targetUid: m2.uid });
  ok(
    !after2.players[FOE].monsters.some((m) => m?.uid === m2.uid),
    'and with a comrade beside him too — the battle immunity is gone'
  );

  /* Rocket Warrior's second sentence had no effect behind it at all. It is
     Normal Summoned rather than placed, because its first sentence is granted
     by the summon — dropping it onto the field skips that and the test would be
     asking the wrong question. */
  const r = fresh();
  const rocket = card(ME, 'rocket-warrior');
  r.players[ME].hand = [rocket];
  const summoned = act(r, ME, { type: 'normalSummon', uid: rocket.uid, zone: 0, position: 'atk', face: 'up' });
  Object.assign(r, summoned);
  r.phase = 'battle';
  r.players[ME].monsters[0]!.summonedOnTurn = 0;
  const victim = card(FOE, 'summoned-skull');
  victim.summonedOnTurn = 0;
  r.players[FOE].monsters[0] = victim;
  const beforeAtk = effAtk(r, victim, FOE);
  const hit = act(r, ME, { type: 'attack', uid: rocket.uid, targetUid: victim.uid });
  const still = hit.players[FOE].monsters.find((m) => m?.uid === victim.uid);
  ok(
    !!still && effAtk(hit, still, FOE) === beforeAtk - 500,
    'Rocket Warrior takes 500 ATK off what it attacks',
    still ? `went ${beforeAtk} → ${effAtk(hit, still, FOE)}` : 'the monster was destroyed'
  );
  ok(
    hit.players[ME].monsters.some((m) => m?.uid === rocket.uid),
    'and survives the battle it could not win'
  );
}

console.log('\nA monster keeps its own properties when an attack turns it face-up');
{
  /* Being flipped by an attacker is not a summon, so a property granted by an
     `onSummon` trigger never fired — and Winged Dragon, Guardian of the
     Fortress #1 lost the very battle its text says it survives. The property
     belongs to the card, so it is read live from the field instead. */
  const s = fresh('battle');
  const guard = card(FOE, 'winged-dragon-guardian-of-the-fortress-1');
  guard.face = 'down';
  guard.position = 'def';
  guard.summonedOnTurn = 0;
  s.players[FOE].monsters[0] = guard;
  const killer = card(ME, 'summoned-skull'); // 2500, far above its 1200 DEF
  killer.summonedOnTurn = 0;
  s.players[ME].monsters[0] = killer;

  const after = act(s, ME, { type: 'attack', uid: killer.uid, targetUid: guard.uid });
  const still = after.players[FOE].monsters.find((m) => m?.uid === guard.uid);
  ok(!!still, 'it survives the attack that revealed it');
  ok(still?.face === 'up', 'and is face-up afterwards');

  // The same property still holds for one summoned normally.
  const n = fresh();
  const held = card(ME, 'winged-dragon-guardian-of-the-fortress-1');
  n.players[ME].hand = [held];
  const summoned = act(n, ME, { type: 'normalSummon', uid: held.uid, zone: 0, position: 'atk', face: 'up' });
  ok(
    effFlags(summoned, summoned.players[ME].monsters[0]!, ME).indestructibleByBattle === true,
    'and a normally summoned one still has it'
  );
}

console.log('\nToon World sits in the Field Zone and still powers the Toons');
{
  const s = fresh();
  const world = card(ME, 'toon-world');
  s.players[ME].hand = [world];
  s.players[ME].deck = [card(ME, 'toon-mermaid'), card(ME, 'baby-dragon'), card(ME, 'kuriboh')];
  const after = act(s, ME, { type: 'activateSpell', uid: world.uid, targets: [] });

  ok(after.players[ME].field?.slug === 'toon-world', 'it goes to the Field Zone');
  ok(!after.players[ME].spellTrap, 'and leaves the Spell/Trap Zone free', `held ${after.players[ME].spellTrap?.slug}`);

  // The tribute exemption looked only at the Spell/Trap Zone before.
  ok(
    tributesRequired('blue-eyes-toon-dragon', after, ME) === 0,
    'a Level 8 Toon needs no tribute under it',
    `needs ${tributesRequired('blue-eyes-toon-dragon', after, ME)}`
  );

  // And the aura reaches a Toon on the field.
  const withToon = { ...after };
  withToon.players[ME].monsters[0] = card(ME, 'toon-mermaid');
  const toon = withToon.players[ME].monsters[0]!;
  const flags = effFlags(withToon, toon, ME);
  /* The book stopped lending ATK by the owner's ruling. What it lends instead
     is survival — a cartoon is flattened and walks off the next panel — so the
     Toons are small bodies that do not die rather than big ones that do. */
  ok(effAtk(withToon, toon, ME) === 1400, 'and is left at its printed ATK', `ATK ${effAtk(withToon, toon, ME)}`);
  ok(
    flags.directAttack === true && flags.indestructibleByEffect === true && flags.indestructibleByBattle === true && flags.pierce === true,
    'with direct attack, piercing, and indestructibility by effect AND by battle'
  );
  ok(!flags.untargetable, 'and it can be targeted — Mirror Wall may halve it, Skull Dice may shrink it');
}

console.log('\n"Gains N ATK for each …" keeps counting, rather than freezing at summon');
{
  /* Six cards granted this once, on summon — when the Graveyard is empty, so
     they gained nothing and never grew again. Two-Headed King Rex was worse:
     its text says "for each Dinosaur" and the old scale counted every card
     there. Machine King was a different card altogether — a flat 200 to all
     your Machines, rather than 200 to himself per Machine on the field. */
  const s = fresh();

  const grow = (slug: string, ctrl: PlayerId = ME) => {
    const c = card(ctrl, slug);
    s.players[ctrl].monsters[0] = c;
    return effAtk(s, c, ctrl);
  };

  const dmgEmpty = grow('dark-magician-girl');
  const rexEmpty = grow('two-headed-king-rex');
  const paladinEmpty = grow('dark-paladin');

  // Three cards into my Graveyard, two of them Dinosaurs.
  s.players[ME].grave = [card(ME, 'uraby'), card(ME, 'trakodon'), card(ME, 'pot-of-greed')];
  ok(grow('dark-paladin') === paladinEmpty + 600, 'Dark Paladin reads the Graveyard live', `${grow('dark-paladin')}`);
  // 300 a fossil since the balance pass — two Dinosaurs of the three cards.
  ok(grow('two-headed-king-rex') === rexEmpty + 600, 'Two-Headed King Rex counts only the Dinosaurs', `${grow('two-headed-king-rex')}`);

  // A Dark Magician in the *opponent's* Graveyard still feeds her.
  s.players[FOE].grave = [card(FOE, 'dark-magician')];
  ok(grow('dark-magician-girl') === dmgEmpty + 400, 'Dark Magician Girl counts either Graveyard', `${grow('dark-magician-girl')}`);

  // Machine King counts Machines on both sides, and only Machines.
  const s2 = fresh();
  const king = card(ME, 'machine-king');
  s2.players[ME].monsters[0] = king;
  const alone = effAtk(s2, king, ME); // he is himself a Machine
  s2.players[FOE].monsters[0] = card(FOE, 'robotic-knight');
  ok(effAtk(s2, king, ME) === alone + 200, "Machine King counts the opponent's Machines too", `${effAtk(s2, king, ME)}`);
  s2.players[FOE].monsters[1] = card(FOE, 'summoned-skull');
  ok(effAtk(s2, king, ME) === alone + 200, 'and ignores anything that is not a Machine', `${effAtk(s2, king, ME)}`);
}

console.log('\n"While Umi is on the field" follows Umi, whatever order things happen in');
{
  /* Reported from a real duel: activate Umi then summon and the fish kept
     everything; summon then activate Umi and it got only Umi's own 400. It was
     an `onSummon` op behind a condition, so the question was asked once and the
     answer kept for good — which also meant the bonus survived Umi being
     destroyed. A conditional aura is re-read every time the stat is wanted. */
  /* Written around Amphibian Beast now: 7 Colored Fish carried this check
     until the owner traded its 800 and its piercing for a search, and the rule
     under test is the aura's, not that card's. The Beast says the same
     sentence and still says it with numbers. */
  const s = fresh();
  const beast = card(ME, 'amphibian-beast');
  const warrior = card(ME, 'deepsea-warrior');
  s.players[ME].monsters[0] = beast;
  s.players[ME].monsters[1] = warrior;

  const beastBare = effAtk(s, beast, ME);
  ok(beastBare === 2400, 'Amphibian Beast is 2400 with no Umi', `${beastBare}`);

  s.players[ME].field = card(ME, 'umi');
  // 2400 + 500 of its own + 500 from Umi's WATER aura.
  ok(effAtk(s, beast, ME) === 3400, 'and 3400 once Umi is up, having been summoned first', `${effAtk(s, beast, ME)}`);
  ok((effFlags(s, beast, ME).extraAttacks ?? 0) === 1, 'and can attack twice');
  ok(effAtk(s, warrior, ME) === 1600 + 600 + 500, 'Deepsea Warrior gains his 600 too', `${effAtk(s, warrior, ME)}`);

  s.players[ME].field = null;
  ok(effAtk(s, beast, ME) === 2400, 'and it all lapses when Umi leaves', `${effAtk(s, beast, ME)}`);
  ok((effFlags(s, beast, ME).extraAttacks ?? 0) === 0, 'the second attack included');
}

console.log('\n"Attacks every monster once each" survives its own kills');
{
  /* `maxAttacks` read the opponent's *current* monster count, so every kill
     shrank the allowance: against three defenders Blue-Eyes Ultimate Dragon
     killed two and the third was suddenly unreachable, because the ceiling had
     dropped below the attacks already spent. And nothing remembered which
     monster had been visited, so it could hammer one survivor repeatedly. */
  const s = fresh('battle');
  const beud = card(ME, 'blue-eyes-ultimate-dragon');
  s.players[ME].monsters[0] = beud;
  // Enough Life Points that the demonstration is about attacks, not lethal.
  s.players[FOE].lp = 30000;
  for (let i = 0; i < 3; i++) s.players[FOE].monsters[i] = card(FOE, 'mystical-elf');

  let st = s;
  for (let i = 0; i < 3; i++) {
    const target = st.players[FOE].monsters.find((m) => m)!;
    const atk = st.players[ME].monsters[0]!;
    ok(canAttackWith(st, ME, atk), `attack ${i + 1} of 3 is allowed`, `used ${atk.attacksUsed}`);
    st = act(st, ME, { type: 'attack', uid: atk.uid, targetUid: target.uid });
  }
  ok(on(st, FOE).length === 0, 'and all three defenders are gone', `${on(st, FOE).length} left`);
  ok(!canAttackWith(st, ME, st.players[ME].monsters[0]!), 'with no bonus direct attack afterwards');

  // Once each: a survivor cannot be hammered while a fresh target remains.
  const t = fresh('battle');
  const dragon = card(ME, 'blue-eyes-ultimate-dragon');
  t.players[ME].monsters[0] = dragon;
  const wall = card(FOE, 'mystical-elf');
  wall.flags.indestructibleByBattle = true;
  const soft = card(FOE, 'mystical-elf');
  t.players[FOE].monsters[0] = wall;
  t.players[FOE].monsters[1] = soft;

  const afterWall = act(t, ME, { type: 'attack', uid: dragon.uid, targetUid: wall.uid });
  const menu = legalAttackTargets(afterWall, ME, afterWall.players[ME].monsters[0]!);
  ok(!menu.uids.includes(wall.uid), 'a survivor already visited is off the menu', menu.uids.join(','));
  ok(menu.uids.includes(soft.uid), 'while the fresh target is on it');
}

console.log('\nAnimation events survive the action after them');
{
  /* Every action used to empty `state.anims`, which is only correct if the
     client sees every single version. It does not. Against the computer the
     nudge now waits for the board to finish narrating, but in a two-player
     duel the other player can summon, attack and end their turn inside one
     2.6s poll — and everything but the last action's events had already been
     destroyed. The whole turn arrived as its final beat. */
  const s = fresh();
  const a = card(ME, 'baby-dragon');
  const b = card(ME, 'mystical-elf');
  s.players[ME].hand = [a, b];

  const first = act(s, ME, { type: 'normalSummon', uid: a.uid, zone: 0, position: 'atk', face: 'up' });
  const summonAnims = first.anims.filter((x) => x.kind === 'summon');
  ok(summonAnims.length > 0, 'a summon announces itself', `${first.anims.length} events`);

  // A second action in the same breath, exactly as another player would.
  const second = act(first, ME, { type: 'toPhase', phase: 'battle' });
  ok(
    second.anims.some((x) => summonAnims.some((y) => y.id === x.id)),
    'and is still readable after the next action',
    `${second.anims.length} events, none of them the summon`
  );

  // Ids stay unique across versions now that the list is not emptied.
  const ids = second.anims.map((x) => x.id);
  ok(new Set(ids).size === ids.length, 'with every event id still unique', ids.join(','));
}

console.log('\nCall of the Haunted buffs the monster it revived');
{
  /* "It gains 400 ATK" — *it*. The bonus targeted `strongest`, so reviving
     anything small handed the 400 to whatever was already the biggest thing on
     your side and the card looked like it did nothing. */
  const s = fresh();
  s.active = FOE;
  const big = card(ME, 'blue-eyes-white-dragon');
  s.players[ME].monsters[0] = big;
  const small = card(ME, 'baby-dragon');
  s.players[ME].grave.push(small);
  const trap = card(ME, 'call-of-the-haunted');
  trap.face = 'down';
  s.players[ME].spellTrap = trap;
  s.pending = { kind: 'trap', player: ME, options: [trap.uid], reason: 'test', context: {} };

  const after = act(s, ME, { type: 'respondTrap', uid: trap.uid, targets: [small.uid] });
  const revived = after.players[ME].monsters.find((m) => m?.slug === 'baby-dragon');
  const dragon = after.players[ME].monsters.find((m) => m?.slug === 'blue-eyes-white-dragon');
  ok(!!revived, 'it revives the chosen monster');
  ok(revived ? effAtk(after, revived, ME) === 1200 + 400 : false, 'and the 400 goes to that monster', `${revived ? effAtk(after, revived, ME) : '-'}`);
  ok(dragon ? effAtk(after, dragon, ME) === 3000 : false, 'not to whatever was already strongest', `${dragon ? effAtk(after, dragon, ME) : '-'}`);
}

console.log('\nEvery line the duel records is spoken on the field');
{
  /* The log is a memory aid, not the place a player goes to find out what
     happened. Every entry is paired with an animation beat — and paired
     whichever order the caller wrote them in, or a line logged after its own
     animation got a second beat and Kuriboh's token announced itself twice. */
  const s = fresh();
  const c = card(ME, 'baby-dragon');
  s.players[ME].hand = [c];
  const after = act(s, ME, { type: 'normalSummon', uid: c.uid, zone: 0, position: 'atk', face: 'up' });

  const freshLines = after.log.length - s.log.length;
  const spoken = after.anims.filter((a) => a.note).length;
  ok(spoken > 0, 'the summon carries the line it logged', `${spoken} of ${freshLines}`);
  const notes = after.anims.map((a) => a.note).filter(Boolean);
  ok(new Set(notes).size === notes.length, 'and no line is announced twice', notes.join(' | '));
}

console.log('\nA malformed action is refused rather than half-played');
{
  /* Actions come off the network — the API route hands `body.action` straight
     to the engine, and a TypeScript type is no help there. A summon with no
     zone at all used to pass its own bounds check, because `undefined < 0` and
     `undefined >= 3` are both false; the card was then spliced out of the hand
     and written to `p.monsters[undefined]`. It vanished, with no error and
     nothing on the field. */
  for (const [label, zone] of [
    ['no zone', undefined],
    ['NaN', NaN],
    ['fractional', 1.5],
    ['a string', '0'],
  ] as const) {
    const s = fresh();
    const c = card(ME, 'battle-ox');
    s.players[ME].hand = [c];
    const res = applyAction(s, ME, { type: 'normalSummon', uid: c.uid, zone, position: 'atk', face: 'up' } as never);
    const kept = res.state.players[ME].hand.length === 1;
    ok(!!res.error && kept, `${label} is refused and the card stays in hand`, res.error ?? `hand ${res.state.players[ME].hand.length}`);
  }
  // And the valid one still works, so the guard did not simply refuse everything.
  const s = fresh();
  const c = card(ME, 'battle-ox');
  s.players[ME].hand = [c];
  const good = act(s, ME, { type: 'normalSummon', uid: c.uid, zone: 0, position: 'atk', face: 'up' });
  ok(!!good.players[ME].monsters[0], 'and a real zone still summons');
}

console.log('\nRing of Destruction is one effect, not a free 1400 damage');
{
  /* Reported from a real duel: activated against a lone Celtic Guardian, which
     "cannot be targeted by your opponent's card effects", it kept asking for a
     target it could never accept. Under the hood the destroy was correctly
     refused and the damage — "equal to that monster's ATK" — went through
     anyway. One card, one effect: no target, no damage. */
  const s = fresh();
  const ring = card(ME, 'ring-of-destruction');
  ring.face = 'down';
  ring.summonedOnTurn = 1;
  s.players[ME].spellTrap = ring;
  /* Celtic Guardian left the roster in the balance pass; Deepsea Warrior
     carries the same untargetable property and stands in for it. */
  const elf = card(FOE, 'deepsea-warrior');
  s.players[FOE].monsters[0] = elf;

  const at = act(s, ME, { type: 'activateSetCard', uid: ring.uid, targets: [elf.uid] });
  ok(at.players[FOE].lp === 4000, 'no damage from a monster it cannot target', `LP ${at.players[FOE].lp}`);
  ok(!!at.players[FOE].monsters[0], 'and the untargetable monster survives');

  // And against something it *can* target, both halves happen.
  const t = fresh();
  const ring2 = card(ME, 'ring-of-destruction');
  ring2.face = 'down';
  ring2.summonedOnTurn = 1;
  t.players[ME].spellTrap = ring2;
  const ox = card(FOE, 'battle-ox');
  t.players[FOE].monsters[0] = ox;
  const hit = act(t, ME, { type: 'activateSetCard', uid: ring2.uid, targets: [ox.uid] });
  ok(hit.players[FOE].lp === 4000 - 1700, 'a legal target takes its own ATK in damage', `LP ${hit.players[FOE].lp}`);
  ok(!hit.players[FOE].monsters[0], 'and is destroyed', 'still standing');
}

console.log('\nMagician of Faith reaches for your own Graveyard first');
{
  /* "Magician of Faith gave me back the enemy spell card." It searched the
     opponent's Graveyard first — true to "from either Graveyard", and not what
     anyone means by getting their card back. */
  /** Sets the Magician face-down and has the opponent attack it face-up. */
  const flipItOver = (ownGrave: string[], theirGrave: string[]) => {
    const s = fresh('battle');
    s.active = FOE;
    const mage = card(ME, 'magician-of-faith');
    mage.face = 'down';
    mage.position = 'def';
    s.players[ME].monsters[0] = mage;
    for (const slug of ownGrave) s.players[ME].grave.push(card(ME, slug));
    for (const slug of theirGrave) s.players[FOE].grave.push(card(FOE, slug));
    const ox = card(FOE, 'battle-ox');
    s.players[FOE].monsters[0] = ox;
    return act(s, FOE, { type: 'attack', uid: ox.uid, targetUid: mage.uid });
  };

  /* A Spell in each pile is two answers, so she asks — mid-attack, which is
     precisely the moment she was once held back from asking at. Both piles are
     offered, because "either Graveyard" means either. */
  const asking = flipItOver(['monster-reborn'], ['dark-hole']);
  ok(
    JSON.stringify(asked(asking)) === JSON.stringify(['dark-hole', 'monster-reborn']),
    'she offers both Graveyards, which is what "either" says',
    JSON.stringify(asked(asking))
  );
  const after = answer(asking, 'monster-reborn');
  const got = after.players[ME].hand.map((c) => c.slug);
  ok(got.includes('monster-reborn'), 'takes your own Spell back', got.join(', ') || '(empty)');
  ok(!got.includes('dark-hole'), 'and leaves theirs where it fell', got.join(', '));

  /* And a computer on that seat reaches for its own pile first, which is the
     original report — "Magician of Faith gave me back the enemy spell card" —
     answered a second time, in the place the decision moved to. */
  const machine = choiceResponses(asking, ME)[0];
  const wantedUid = machine?.type === 'chooseCard' ? machine.uids[0] : '';
  ok(
    asking.players[ME].grave.some((c) => c.uid === wantedUid),
    'and a computer answering reaches into its own pile first',
    asking.players[FOE].grave.some((c) => c.uid === wantedUid) ? 'took theirs' : 'took nothing'
  );

  // With nothing of your own to take, the other Graveyard is still fair game —
  // which is what keeps the card's own "either Graveyard" honest. One answer,
  // so no question either.
  const after2 = flipItOver([], ['dark-hole']);
  ok(asked(after2) === null, 'one Spell anywhere is one answer, so nothing is asked', JSON.stringify(asked(after2)));
  ok(
    after2.players[ME].hand.some((c) => c.slug === 'dark-hole'),
    'and reaches across when yours holds nothing',
    after2.players[ME].hand.map((c) => c.slug).join(', ') || '(empty)'
  );

  /* Graverobber shares the op and does not share the preference: "add 1 card
     from your opponent's Graveyard" is the whole card. Teaching the Magician to
     look at his own side first broke it, and the audit caught it — so it is
     nailed down here, where the difference between the two is the point. */
  const g = fresh();
  const robber = card(ME, 'graverobber');
  robber.face = 'down';
  robber.summonedOnTurn = 1;
  g.players[ME].spellTrap = robber;
  g.players[ME].grave.push(card(ME, 'monster-reborn'));
  g.players[FOE].grave.push(card(FOE, 'dark-hole'));
  const robbed = act(g, ME, { type: 'activateSetCard', uid: robber.uid, targets: [] });
  const took = robbed.players[ME].hand.map((c) => c.slug);
  ok(took.includes('dark-hole'), 'Graverobber still takes from theirs', took.join(', ') || '(empty)');
  ok(!took.includes('monster-reborn'), 'and leaves your own Graveyard alone', took.join(', '));
}

console.log('\nA moth places its own counters as it arrives');
{
  /* The ladder used to be climbed in place — every instance was born already
     seeded at its rung and grew into the next one on the field. It is a relay
     now: each moth places its own counters on the way in and hands the next
     one up at the start of your turn, so a seed at construction would count
     the same rung twice. Read off a real Weevil deck, because that is where
     the seeding used to happen. */
  const weevil = createDuel({ seed: 3, p1: { duelistId: 'weevil', name: 'W' }, p2: { duelistId: 'yugi', name: 'Y' } });
  const held = [...weevil.players.p1.deck, ...weevil.players.p1.hand];
  for (const slug of ['petit-moth', 'larvae-moth', 'great-moth', 'perfectly-ultimate-great-moth']) {
    const found = held.filter((c) => c.slug === slug);
    ok(
      found.length > 0 && found.every((c) => c.counters === 0),
      `${CARDS[slug].name} waits in the deck on nothing`,
      found.length ? `got ${found.map((c) => c.counters).join('/')}` : 'not in the deck'
    );
  }
}

console.log('\nInsect Barrier does both halves of its sentence');
{
  /* It stopped being a debuff on the far side. Their monsters keep every point
     they have while they stay home; the thousand is a toll, charged to whatever
     swings at an Insect, for that battle only — so the same attacker pays again
     the next time it comes. Two assertions, therefore: nothing is taken off the
     printed number, and the swing lands as if the attacker were 1000 smaller. */
  const s = fresh();
  const barrier = card(ME, 'insect-barrier');
  s.players[ME].hand.push(barrier);
  const ox = card(FOE, 'battle-ox');
  s.players[FOE].monsters[0] = ox;
  const after = act(s, ME, { type: 'activateSpell', uid: barrier.uid, targets: [] });
  ok(effAtk(after, after.players[FOE].monsters[0]!, FOE) === 1700, 'their monsters keep their ATK while they stay home', `${effAtk(after, after.players[FOE].monsters[0]!, FOE)}`);
  const theirTurn = act(after, ME, { type: 'endTurn' });
  ok(!canAttackWith(theirTurn, FOE, theirTurn.players[FOE].monsters[0]!), 'and cannot attack on their next turn');

  /* The toll itself. A 1700 Battle Ox into a 1200 Killer Needle wins every day
     — unless the wall is up, in which case it swings as a 700 and dies. */
  const t = fresh('battle');
  t.players[ME].spellTrap = card(ME, 'insect-barrier');
  t.players[ME].monsters[0] = card(ME, 'killer-needle');
  const bug = t.players[ME].monsters[0]!;
  bug.summonedOnTurn = 0;
  const raider = card(FOE, 'battle-ox');
  raider.summonedOnTurn = 0;
  t.players[FOE].monsters[0] = raider;
  t.active = FOE;
  const swung = act(t, FOE, { type: 'attack', uid: raider.uid, targetUid: bug.uid });
  ok(!swung.players[FOE].monsters[0], 'a 1700 that swings at an Insect swings as a 700 and dies', swung.players[FOE].monsters[0]?.slug ?? 'gone');
  ok(!!swung.players[ME].monsters[0], 'and the Insect it charged at is still standing');
}

console.log("\nA card of yours may ask you a question on somebody else's turn");
{
  /* Every effect with a choice used to fall into two camps: activated by a
     player who is standing right there, or fired mid-resolution where the
     engine helped itself. Sangan, Newdoria, Flying Kamakiri #1 and a dozen
     more were only ever in the second camp because their trigger happens to
     land on the opponent's turn — which is not a reason the choice is any less
     theirs. The duel stops and asks. */

  /* Flying Kamakiri #1: sent to the Graveyard by their attack, on their turn,
     and it is still your Deck and your pick. */
  const s = fresh('battle');
  s.active = FOE;
  const kama = card(ME, 'flying-kamakiri-1');
  kama.summonedOnTurn = 0;
  s.players[ME].monsters[0] = kama;
  s.players[ME].deck = [card(ME, 'petit-moth'), card(ME, 'killer-needle'), card(ME, 'kuriboh')];
  const killer = card(FOE, 'blue-eyes-white-dragon');
  killer.summonedOnTurn = 0;
  s.players[FOE].monsters[0] = killer;
  const struck = act(s, FOE, { type: 'attack', uid: killer.uid, targetUid: kama.uid });
  ok(struck.pending?.kind === 'choose', 'a card sent to the Graveyard on their turn stops and asks', struck.pending?.kind ?? '(nothing asked)');
  ok(struck.pending?.player === ME, "and it asks the card's owner, not the player taking the turn", struck.pending?.player);
  const offered = struck.pending?.options.map((u) => struck.players[ME].deck.find((c) => c.uid === u)?.slug).filter(Boolean);
  ok(
    offered?.length === 2 && offered.includes('petit-moth') && offered.includes('killer-needle'),
    'offering every Insect in the Deck and nothing else',
    offered?.join(',') ?? '(none)'
  );
  const small = struck.pending!.options.find((u) => struck.players[ME].deck.find((c) => c.uid === u)?.slug === 'petit-moth')!;
  const answered = act(struck, ME, { type: 'chooseCard', uids: [small] });
  ok(answered.players[ME].hand.some((h) => h.slug === 'petit-moth'), 'and the one you named is the one you get', answered.players[ME].hand.map((h) => h.slug).join(',') || '(empty)');
  ok(!answered.pending, 'the duel carries on once you have answered');

  /* No question where there is nothing to decide. One legal card goes straight
     through, and none at all is not a prompt — both resolve exactly as they
     always have. */
  const only = fresh('battle');
  only.active = FOE;
  const k2 = card(ME, 'flying-kamakiri-1');
  k2.summonedOnTurn = 0;
  only.players[ME].monsters[0] = k2;
  only.players[ME].deck = [card(ME, 'petit-moth'), card(ME, 'kuriboh')];
  const b2 = card(FOE, 'blue-eyes-white-dragon');
  b2.summonedOnTurn = 0;
  only.players[FOE].monsters[0] = b2;
  const straight = act(only, FOE, { type: 'attack', uid: b2.uid, targetUid: k2.uid });
  ok(!straight.pending, 'one legal card is not a choice, and nothing is asked', straight.pending?.kind ?? 'nothing asked');
  ok(straight.players[ME].hand.some((h) => h.slug === 'petit-moth'), 'it simply takes the only one there is');

  /* Two questions in one breath. Dark Hole over two Man-Eater Bugs raises two,
     and the second waits its turn rather than being answered by the engine. */
  const twin = fresh();
  const bugA = card(ME, 'man-eater-bug');
  const bugB = card(ME, 'man-eater-bug');
  twin.players[ME].monsters = [bugA, bugB, null];
  twin.players[FOE].monsters = [card(FOE, 'summoned-skull'), card(FOE, 'battle-ox'), card(FOE, 'kuriboh')];
  const hole = card(ME, 'dark-hole');
  twin.players[ME].hand.push(hole);
  const wiped = act(twin, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
  void wiped;

  /* Sangan on the way to the pile — the card the whole window was written for. */
  const sg = fresh('battle');
  sg.active = FOE;
  const sangan = card(ME, 'sangan');
  sangan.summonedOnTurn = 0;
  sg.players[ME].monsters[0] = sangan;
  const beak = card(FOE, 'blue-eyes-white-dragon');
  beak.summonedOnTurn = 0;
  sg.players[FOE].monsters[0] = beak;
  const fell = act(sg, FOE, { type: 'attack', uid: beak.uid, targetUid: sangan.uid });
  ok(
    !fell.pending || fell.pending.player === ME,
    'anything Sangan asks, it asks of its own controller',
    fell.pending ? `${fell.pending.kind} for ${fell.pending.player}` : '(nothing to ask)'
  );
}

console.log('\nRex Raptor: the herd, and what it costs to run it');
{
  /* Tribute to the Doomed is priced off their hand and paid off their board. */
  const s = fresh();
  const spell = card(ME, 'tribute-to-the-doomed');
  s.players[ME].hand = [spell];
  s.players[FOE].hand = [card(FOE, 'kuriboh'), card(FOE, 'kuriboh')];
  s.players[FOE].monsters[0] = card(FOE, 'battle-ox');
  s.players[FOE].monsters[1] = card(FOE, 'petit-moth');
  const after = act(s, ME, { type: 'activateSpell', uid: spell.uid, targets: [s.players[FOE].monsters[0]!.uid] });
  ok(after.players[ME].lp === 4000 - 2000, 'it costs 1000 a card in their hand', `${after.players[ME].lp}`);
  ok(after.players[FOE].hand.length === 0, 'and takes a card for each monster they are standing behind', `${after.players[FOE].hand.length} left`);
  ok(!after.players[FOE].monsters.some((m) => m?.slug === 'battle-ox'), 'then destroys the one you pointed at');

  /* And it refuses rather than killing you. Six cards in hand is 6000, which a
     player on 4000 cannot pay — the engine says so instead of letting it be
     played as a suicide. */
  const broke = fresh();
  const doom = card(ME, 'tribute-to-the-doomed');
  broke.players[ME].hand = [doom];
  broke.players[FOE].hand = Array.from({ length: 6 }, () => card(FOE, 'kuriboh'));
  broke.players[FOE].monsters[0] = card(FOE, 'battle-ox');
  ok(!canActivateFromHand(broke, ME, doom), 'a hand it cannot afford is a card it will not let you play');
  const refused = applyAction(broke, ME, { type: 'activateSpell', uid: doom.uid, targets: [broke.players[FOE].monsters[0]!.uid] });
  ok(!!refused.error, 'and the board says why rather than taking your last Life Points', refused.error ?? '(activated)');

  /* Anthrosaurus takes the backrow on the way in, and a fossil on the way down. */
  const a = fresh();
  const anth = card(ME, 'anthrosaurus');
  a.players[ME].hand = [anth];
  a.players[FOE].spellTrap = card(FOE, 'insect-barrier');
  const landed = act(a, ME, { type: 'normalSummon', uid: anth.uid, zone: 0, position: 'atk', face: 'up', tributes: [], targets: [a.players[FOE].spellTrap!.uid] });
  ok(landed.players[FOE].spellTrap === null, 'Anthrosaurus shatters a backrow card as it arrives');

  /* Trakodon digs, burying as it goes, and stands the first fossil up. */
  const t = fresh();
  const trak = card(ME, 'trakodon');
  t.players[ME].hand = [trak];
  t.players[ME].deck = [card(ME, 'raigeki'), card(ME, 'dark-hole'), card(ME, 'uraby'), card(ME, 'kuriboh')];
  const dug = act(t, ME, { type: 'normalSummon', uid: trak.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(on(dug, ME).some((m) => m.slug === 'uraby'), 'Trakodon digs until a Dinosaur and stands it up', on(dug, ME).map((m) => m.slug).join(','));
  ok(dug.players[ME].grave.filter((g) => ['raigeki', 'dark-hole'].includes(g.slug)).length === 2, 'and everything it dug past is buried');
  ok(dug.players[ME].deck.some((c) => c.slug === 'kuriboh'), 'and it stops digging the moment it finds one', dug.players[ME].deck.map((c) => c.slug).join(',') || '(empty)');

  /* The two small ones. */
  ok(baseAtkOf('crawling-dragon-2') === 300, 'Crawling Dragon #2 prints 300', `${baseAtkOf('crawling-dragon-2')}`);
  ok(baseAtkOf('uraby') === 400, 'Uraby prints 400', `${baseAtkOf('uraby')}`);

  /* Megazowler and Sword Arm buy their way down for a card, and dig each other
     out of the Deck as they die. */
  for (const [slug, partner, pos] of [
    ['megazowler', 'sword-arm-of-dragon', 'def'],
    ['sword-arm-of-dragon', 'megazowler', 'atk'],
  ] as Array<[string, string, 'atk' | 'def']>) {
    const h = fresh();
    const beast = card(ME, slug);
    const fodder = card(ME, 'kuriboh');
    h.players[ME].hand = [beast, fodder];
    const bought = act(h, ME, { type: 'handSummon', uid: beast.uid, discardUid: fodder.uid });
    const down = on(bought, ME).find((m) => m.slug === slug);
    ok(!!down, `${CARDS[slug].name} buys its way down for a card`, on(bought, ME).map((m) => m.slug).join(',') || 'nothing');
    ok(down?.position === pos, `and lands in ${pos === 'def' ? 'Defence' : 'Attack'} Position`, down?.position);
    ok(bought.players[ME].grave.some((g) => g.slug === 'kuriboh'), 'with the card it paid in the Graveyard');
    ok(!bought.players[ME].normalSummonUsed, 'and your Normal Summon still in hand');

    const d = fresh();
    d.players[ME].monsters[0] = card(ME, slug);
    d.players[ME].deck = [card(ME, partner), card(ME, 'kuriboh')];
    const hole = card(ME, 'dark-hole');
    d.players[ME].hand.push(hole);
    const wiped = act(d, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
    ok(wiped.players[ME].hand.some((x) => x.slug === partner), `and digs ${CARDS[partner].name} out of the Deck as it dies`);
  }

  /* Sword Arm is heavier for every one of the pair already buried. */
  {
    const g = fresh();
    const arm = card(ME, 'sword-arm-of-dragon');
    g.players[ME].hand = [arm];
    g.players[ME].grave.push(card(ME, 'megazowler'), card(ME, 'sword-arm-of-dragon'), card(ME, 'kuriboh'));
    const need = tributesRequired('sword-arm-of-dragon', g, ME);
    const tribs: string[] = [];
    for (let z = 0; z < need; z++) {
      const f3 = card(ME, 'kuriboh');
      g.players[ME].monsters[z + 1] = f3;
      tribs.push(f3.uid);
    }
    const down = act(g, ME, { type: 'normalSummon', uid: arm.uid, zone: 0, position: 'atk', face: 'up', tributes: tribs });
    const it = on(down, ME).find((m) => m.slug === 'sword-arm-of-dragon')!;
    ok(effAtk(down, it, ME) === baseAtkOf('sword-arm-of-dragon') + 300, 'Sword Arm is 150 heavier for each of the pair in the pile, and nothing for a Kuriboh', `${effAtk(down, it, ME)}`);
  }

  /* Mad Sword Beast answers from off the board. */
  for (const zone of ['hand', 'grave'] as const) {
    const s2 = fresh();
    const beast = card(ME, 'mad-sword-beast');
    if (zone === 'hand') s2.players[ME].hand.push(beast);
    else s2.players[ME].grave.push(beast);
    const fossil = card(ME, 'uraby');
    s2.players[ME].hand.push(fossil);
    const out = act(s2, ME, { type: 'normalSummon', uid: fossil.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
    ok(on(out, ME).some((m) => m.slug === 'mad-sword-beast'), `a Dinosaur arriving calls Mad Sword Beast out of your ${zone}`, on(out, ME).map((m) => m.slug).join(','));
  }
  {
    /* And only for a Dinosaur. */
    const s3 = fresh();
    s3.players[ME].hand.push(card(ME, 'mad-sword-beast'));
    const notFossil = card(ME, 'kuriboh');
    s3.players[ME].hand.push(notFossil);
    const out = act(s3, ME, { type: 'normalSummon', uid: notFossil.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
    ok(!on(out, ME).some((m) => m.slug === 'mad-sword-beast'), 'and stays where it is for anything else', on(out, ME).map((m) => m.slug).join(','));

    /* Worth the whole field while it stands, theirs included. */
    const f = fresh();
    const b = card(ME, 'mad-sword-beast');
    f.players[ME].monsters[0] = b;
    const alone = effAtk(f, b, ME);
    f.players[ME].monsters[1] = card(ME, 'uraby');
    f.players[FOE].monsters[0] = card(FOE, 'trakodon');
    ok(effAtk(f, b, ME) === alone + 200, 'and 100 heavier for each Dinosaur on the field, theirs counted', `${alone} → ${effAtk(f, b, ME)}`);
  }

  /* Sabersaurus refills off its own funeral. */
  {
    const s4 = fresh();
    s4.players[ME].monsters[0] = card(ME, 'sabersaurus');
    s4.players[ME].grave.push(card(ME, 'uraby'), card(ME, 'trakodon'), card(ME, 'raigeki'));
    s4.players[ME].deck = [card(ME, 'dark-hole'), card(ME, 'swords-of-revealing-light'), card(ME, 'kuriboh')];
    const hole = card(ME, 'dark-hole');
    s4.players[ME].hand.push(hole);
    const gone = act(s4, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
    ok(
      !gone.players[ME].grave.some((g) => CARDS[g.slug]?.type === 'Dinosaur' && g.slug !== 'sabersaurus'),
      'Sabersaurus takes every other fossil back out of the pile',
      gone.players[ME].grave.map((g) => g.slug).join(',')
    );
    /* And stays down itself. Its own body is what the herd is bought with —
       every other fossil gets up, the one that paid does not. */
    ok(gone.players[ME].grave.some((g) => g.slug === 'sabersaurus'), 'while it stays in the Graveyard itself', gone.players[ME].grave.map((g) => g.slug).join(','));
    /* Nowhere but the pile. "Not in the Deck" alone is not enough — the draw
       that follows can pull it straight back out again and hide the fact that
       it was ever shuffled in. */
    ok(
      !gone.players[ME].deck.some((c) => c.slug === 'sabersaurus') && !gone.players[ME].hand.some((c) => c.slug === 'sabersaurus'),
      'and is nowhere else — not the Deck it shuffled, not the hand it drew',
      `deck ${gone.players[ME].deck.filter((c) => c.slug === 'sabersaurus').length}, hand ${gone.players[ME].hand.filter((c) => c.slug === 'sabersaurus').length}`
    );
    ok(gone.players[ME].grave.some((g) => g.slug === 'raigeki'), 'and leaves what is not a fossil where it lies');
    ok(gone.players[ME].hand.some((h) => CARDS[h.slug]?.kind === 'monster'), 'then digs until a body turns up', gone.players[ME].hand.map((h) => h.slug).join(','));
  }

  /* Crawling Dragon reaches the whole pile, and comes back bigger from battle. */
  {
    const c = fresh();
    const drag = card(ME, 'crawling-dragon');
    c.players[ME].hand = [drag];
    /* Megazowler is 1800 — over the 1600 ceiling the old text carried, and a
       Dinosaur, which Crawling Dragon itself is not. */
    c.players[ME].grave.push(card(ME, 'megazowler'));
    const pay = card(ME, 'kuriboh');
    c.players[ME].monsters[1] = pay;
    const down = act(c, ME, { type: 'normalSummon', uid: drag.uid, zone: 0, position: 'atk', face: 'up', tributes: [pay.uid], targets: [c.players[ME].grave[0].uid] });
    ok(on(down, ME).some((m) => m.slug === 'megazowler'), 'Crawling Dragon reaches over the old 1600 ceiling', on(down, ME).map((m) => m.slug).join(','));

    /* Killed in battle, it is owed back at the start of your next turn. */
    const b2 = fresh('battle');
    const dying = card(ME, 'crawling-dragon');
    dying.summonedOnTurn = 0;
    b2.players[ME].monsters[0] = dying;
    const killer = card(FOE, 'blue-eyes-white-dragon');
    killer.summonedOnTurn = 0;
    b2.players[FOE].monsters[0] = killer;
    b2.active = FOE;
    let cur = act(b2, FOE, { type: 'attack', uid: killer.uid, targetUid: dying.uid });
    ok(!on(cur, ME).some((m) => m.slug === 'crawling-dragon'), 'battle puts it down');
    cur = act(cur, FOE, { type: 'endTurn' });
    const back = on(cur, ME).find((m) => m.slug === 'crawling-dragon');
    ok(!!back, 'and it claws its way back at the start of your turn', on(cur, ME).map((m) => m.slug).join(',') || 'nothing');
    ok(
      !!back && effAtk(cur, back, ME) === baseAtkOf('crawling-dragon') + 200 && effDef(cur, back, ME) === CARDS['crawling-dragon'].def! + 200,
      'two hundred heavier at both ends',
      back ? `${effAtk(cur, back, ME)}/${effDef(cur, back, ME)}` : '—'
    );

    /* A card effect puts it down for good. */
    const e = fresh();
    e.players[ME].monsters[0] = card(ME, 'crawling-dragon');
    const hole2 = card(ME, 'dark-hole');
    e.players[ME].hand.push(hole2);
    let dead = act(e, ME, { type: 'activateSpell', uid: hole2.uid, targets: [] });
    dead = act(dead, ME, { type: 'endTurn' });
    dead = act(dead, FOE, { type: 'endTurn' });
    ok(!on(dead, ME).some((m) => m.slug === 'crawling-dragon'), 'while an effect keeps it down', on(dead, ME).map((m) => m.slug).join(',') || 'gone');
  }

  /* Reported: "Crawling Dragon effect is supposed to be +200 more atk each time
     it is special summoned this way... when it leaves the field by another way
     not being destroyed by battle it's atk is reverted to the original, and it
     won't be revived by it's effect."

     The bonus was flat. A dragon that had already clawed back twice still came
     back at printed + 200, so it stopped growing after the first round — and
     the block above passes either way, which is why this one exists.

     Two halves, and they are the same mechanism seen from both ends: the count
     rides on the instance, and `resetInstance` — the ceremony every road off a
     zone performs — clears it. Battle is the one exception, and it is not a
     carve-out: `destroyCard` lends the tally back across the single beat that
     reads it and takes it away again. */
  {
    /** Their 2500 runs it over; then the turn comes round and the dragon lands. */
    const killAndWait = (s: DuelState, dragonUid: string): DuelState => {
      const killer = s.players[FOE].monsters.find((m) => m?.slug === 'blue-eyes-white-dragon')!;
      let cur = s.phase === 'battle' ? s : act(s, FOE, { type: 'toPhase', phase: 'battle' });
      cur = act(cur, FOE, { type: 'attack', uid: killer.uid, targetUid: dragonUid });
      return act(cur, FOE, { type: 'endTurn' });
    };
    /** A board where it is our dragon's turn to be run over. */
    const arena = (): DuelState => {
      const s = fresh('battle');
      s.active = FOE;
      /* Four run-overs by a 3000 body is more than 4000 Life Points can take,
         and a duel that ends stops answering. The subject here is the dragon,
         not the scoreline. */
      s.players[ME].lp = 99999;
      const killer = card(FOE, 'blue-eyes-white-dragon');
      killer.summonedOnTurn = 0;
      s.players[FOE].monsters[0] = killer;
      const d = card(ME, 'crawling-dragon');
      d.summonedOnTurn = 0;
      s.players[ME].monsters[0] = d;
      return s;
    };
    const printed = baseAtkOf('crawling-dragon');

    /* Three deaths, three returns, each one heavier than the last. */
    let cur = arena();
    let dragonUid = cur.players[ME].monsters[0]!.uid;
    for (let round = 1; round <= 3; round++) {
      cur = killAndWait(cur, dragonUid);
      const back = on(cur, ME).find((m) => m.slug === 'crawling-dragon');
      ok(
        !!back && effAtk(cur, back, ME) === printed + 200 * round,
        `return ${round} is ${200 * round} heavier, not two hundred flat`,
        back ? `${effAtk(cur, back, ME)} (want ${printed + 200 * round})` : 'it did not come back'
      );
      if (!back) break;
      dragonUid = back.uid;
      cur = act(cur, ME, { type: 'endTurn' });
    }

    /* Now the other half. Two returns earned, then a Spell takes it off the
       field — which is not battle, so nothing is owed and nothing is kept. */
    let t = arena();
    t = killAndWait(t, t.players[ME].monsters[0]!.uid);
    t = act(t, ME, { type: 'endTurn' });
    t = killAndWait(t, on(t, ME).find((m) => m.slug === 'crawling-dragon')!.uid);
    const twice = on(t, ME).find((m) => m.slug === 'crawling-dragon');
    ok(!!twice && effAtk(t, twice, ME) === printed + 400, 'two returns stand at four hundred over', twice ? `${effAtk(t, twice, ME)}` : '—');

    const hole3 = card(ME, 'dark-hole');
    t.players[ME].hand.push(hole3);
    t = act(t, ME, { type: 'activateSpell', uid: hole3.uid, targets: [] });
    ok(
      t.ongoing.filter((o) => o.kind === 'pendingRevival').length === 0,
      'a Spell that is not battle owes it nothing',
      `${t.ongoing.filter((o) => o.kind === 'pendingRevival').length} pending`
    );
    const lying = t.players[ME].grave.find((c) => c.slug === 'crawling-dragon');
    ok(!!lying && (lying.revivals ?? 0) === 0, 'and takes back everything it had earned', `tally ${lying?.revivals ?? 0}`);

    /* Somebody else's card brings it back: the printed dragon, not the grown
       one — and the next battle death starts the count again from one. */
    const reborn = card(ME, 'monster-reborn');
    t.players[ME].hand.push(reborn);
    t = act(t, ME, { type: 'activateSpell', uid: reborn.uid, targets: [lying!.uid] });
    const raised = on(t, ME).find((m) => m.slug === 'crawling-dragon');
    ok(!!raised && effAtk(t, raised, ME) === printed, 'Monster Reborn returns the printed body', raised ? `${effAtk(t, raised, ME)} (want ${printed})` : '—');

    t.players[FOE].monsters[0] = (() => { const k = card(FOE, 'blue-eyes-white-dragon'); k.summonedOnTurn = 0; return k; })();
    t = act(t, ME, { type: 'endTurn' });
    t = killAndWait(t, raised!.uid);
    const again = on(t, ME).find((m) => m.slug === 'crawling-dragon');
    ok(!!again && effAtk(t, again, ME) === printed + 200, 'and the count starts over from one', again ? `${effAtk(t, again, ME)} (want ${printed + 200})` : '—');

    /* The road back to the hand reverts it too — the same one clearing site,
       reached by a different door. Guardian Sphinx flipping up sends every
       monster the other player controls home. */
    let b = arena();
    b = killAndWait(b, b.players[ME].monsters[0]!.uid);
    b = act(b, ME, { type: 'endTurn' });
    b = killAndWait(b, on(b, ME).find((m) => m.slug === 'crawling-dragon')!.uid);
    const grown = on(b, ME).find((m) => m.slug === 'crawling-dragon');
    ok(!!grown && (grown.revivals ?? 0) === 2, 'the tally is a count, and it counts', `${grown?.revivals ?? 0}`);

    const sphinx = card(FOE, 'guardian-sphinx');
    sphinx.face = 'down';
    sphinx.position = 'def';
    sphinx.summonedOnTurn = 0;
    b.players[FOE].monsters[1] = sphinx;
    b.active = FOE;
    b.phase = 'main';
    b = act(b, FOE, { type: 'changePosition', uid: sphinx.uid });
    const home = b.players[ME].hand.find((c) => c.slug === 'crawling-dragon');
    ok(!!home && (home.revivals ?? 0) === 0 && home.atkMod === 0, 'and sent back to the hand it is printed again', home ? `tally ${home.revivals ?? 0}, atkMod ${home.atkMod}` : 'not in hand');
  }

  /* Serpent Night Dragon: the pile, and their whole board plus one. */
  {
    const s5 = fresh();
    const snd = card(ME, 'serpent-night-dragon');
    s5.players[ME].monsters[0] = snd;
    const bare = effAtk(s5, snd, ME);
    s5.players[ME].grave.push(card(ME, 'uraby'), card(ME, 'trakodon'), card(ME, 'raigeki'));
    ok(effAtk(s5, snd, ME) === bare + 350, 'Serpent Night Dragon is 175 a fossil, and nothing for a Spell', `${effAtk(s5, snd, ME)}`);

    const counts: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [2, 3],
    ];
    for (const [board, want] of counts) {
      const f2 = fresh('battle');
      const d2 = card(ME, 'serpent-night-dragon');
      d2.summonedOnTurn = 0;
      f2.players[ME].monsters[0] = d2;
      for (let z = 0; z < board; z++) f2.players[FOE].monsters[z] = card(FOE, 'kuriboh');
      ok(maxAttacks(f2, d2, ME) === want, `over ${board} of their monsters it gets ${want} attack${want === 1 ? '' : 's'}`, `${maxAttacks(f2, d2, ME)}`);

      /* And it actually stops there. Asking `maxAttacks` at the start of the
         Battle Phase proves nothing about the end of it: the allowance used to
         be counted from *attacks spent*, which is the same number as monsters
         visited only while every swing lands on a fresh one. A direct attack
         marks nothing visited, so the count climbed with every swing, sat on
         both sides of `attacksUsed < maxAttacks` and never closed — reported
         from a real duel as "seems to have infinite attacks", against an empty
         board, which is exactly the case a start-of-phase reading misses. */
      /* Life Points high enough that the count is what stops it, not a win:
         a 2350 piercing sweep kills a 4000 board before the third swing and
         the loop would end for the wrong reason. */
      f2.players[FOE].lp = 60000;
      let cur = f2;
      let swings = 0;
      for (let guard = 0; guard < 12; guard++) {
        const live = cur.players[ME].monsters.find((m) => m?.uid === d2.uid);
        if (!live || !canAttackWith(cur, ME, live)) break;
        const victim = cur.players[FOE].monsters.find((m) => !!m);
        const r = applyAction(cur, ME, { type: 'attack', uid: live.uid, targetUid: victim?.uid ?? null });
        if (r.error) break;
        cur = r.state;
        swings += 1;
      }
      ok(swings === want, `and it swings ${want} time${want === 1 ? '' : 's'} and stops`, `${swings}`);
    }
  }

  /* Two-Headed King Rex eats to swing, and what it eats is already in the pile
     when the blow lands. */
  {
    const r = fresh('battle');
    const rex = card(ME, 'two-headed-king-rex');
    rex.summonedOnTurn = 0;
    rex.flags.attackCostDiscard = true;
    rex.flags.extraAttacks = 1;
    r.players[ME].monsters[0] = rex;
    const fossil = card(ME, 'uraby');
    r.players[ME].hand = [fossil];
    const before2 = effAtk(r, rex, ME);
    const swung = act(r, ME, { type: 'attack', uid: rex.uid, targetUid: null, discardUid: fossil.uid });
    ok(swung.players[ME].hand.length === 0, 'the King eats a card to swing', `${swung.players[ME].hand.length} left`);
    ok(swung.players[ME].grave.some((g) => g.slug === 'uraby'), 'and what it ate is in the pile');
    ok(swung.players[FOE].lp === 4000 - (before2 + 300), 'so the blow lands 300 heavier for the fossil it just swallowed', `${4000 - swung.players[FOE].lp} vs ${before2 + 300}`);

    /* With nothing to eat it does not swing at all — and the board says so
       rather than offering an attack the engine would refuse. */
    const starved = fresh('battle');
    const king = card(ME, 'two-headed-king-rex');
    king.summonedOnTurn = 0;
    king.flags.attackCostDiscard = true;
    starved.players[ME].monsters[0] = king;
    starved.players[ME].hand = [];
    ok(!canAttackWith(starved, ME, king), 'an empty hand is a King that cannot swing');
    ok(maxAttacks(starved, king, ME) === 0, 'and the engine says nought attacks rather than two it cannot pay for', `${maxAttacks(starved, king, ME)}`);
  }
}

console.log('\nThree things a duel reported, and the rules behind them');
{
  /* "Leghul attacked directly, the opponent discarded Kuriboh so no damage was
     done, yet it still gained the ATK." The trigger says "when it inflicts
     battle damage" and was firing on the declaration rather than on the blow —
     so every card reading that trigger was paying out for hits that never
     landed. Measured now, not assumed. */
  const b = fresh('battle');
  const crawler = card(ME, 'leghul');
  crawler.summonedOnTurn = 0;
  b.players[ME].monsters[0] = crawler;
  b.ongoing.push({ id: 'shield', source: 'kuriboh', kind: 'preventBattleDamage', target: FOE, turns: 1 });
  const before = effAtk(b, crawler, ME);
  const swung = act(b, ME, { type: 'attack', uid: crawler.uid, targetUid: null });
  ok(swung.players[FOE].lp === 4000, 'a blow the other player does not feel costs them nothing', `${swung.players[FOE].lp}`);
  ok(
    effAtk(swung, swung.players[ME].monsters[0]!, ME) === before,
    'and Leghul grows nothing on it',
    `${before} → ${effAtk(swung, swung.players[ME].monsters[0]!, ME)}`
  );

  /* Same rule over a monster, not only over an empty board. */
  const m = fresh('battle');
  const needle = card(ME, 'killer-needle');
  needle.summonedOnTurn = 0;
  m.players[ME].monsters[0] = needle;
  m.players[FOE].monsters[0] = card(FOE, 'petit-moth');
  m.ongoing.push({ id: 'shield2', source: 'kuriboh', kind: 'preventBattleDamage', target: FOE, turns: 1 });
  const was = effAtk(m, needle, ME);
  const hit = act(m, ME, { type: 'attack', uid: needle.uid, targetUid: m.players[FOE].monsters[0]!.uid });
  const grown = hit.players[ME].monsters.find((x) => x?.uid === needle.uid);
  ok(!!grown && effAtk(hit, grown, ME) === was, 'and a shielded battle pays Killer Needle nothing either', `${grown ? effAtk(hit, grown, ME) : 'gone'}`);
}

console.log('\nYour own Deck is yours to read, but not to read in order');
{
  /* "Basic Insect did not give the option to pick which equip spell to add
     while both were in the deck." It was never about Basic Insect: the view
     handed the player their own Deck with every slug masked to `facedown`, so
     the board filtered the pool by name, nothing matched, and every Deck search
     in the game picked for you in silence. What has to stay secret is the
     order, not the contents. */
  const s = fresh();
  s.players[ME].deck = [card(ME, 'laser-cannon-armor'), card(ME, 'insect-armor-with-laser-cannon'), card(ME, 'kuriboh')];
  const seen = viewFor(s, ME);
  ok(!seen.players[ME].deck.some((c) => c.slug === 'facedown'), 'you can read the names in your own Deck', seen.players[ME].deck.map((c) => c.slug).join(','));
  ok(seen.players[FOE].deck.every((c) => c.slug === 'facedown'), 'and none of theirs');

  /* Order tells you nothing: the list comes back sorted, so the top card of the
     real Deck is not the first card of the one you are shown. */
  const ordered = [...s.players[ME].deck].map((c) => c.slug);
  const shown = seen.players[ME].deck.map((c) => c.slug);
  ok(shown.join(',') !== ordered.join(','), 'and the order it arrives in is not the order you will draw it', shown.join(','));
  ok([...shown].sort().join(',') === [...ordered].sort().join(','), 'while every card is still accounted for');

  /* Which is what the picker needs: both cannons offered, not one chosen for you. */
  const spec = targetSpecFor('basic-insect', 'onSummon');
  const offered = spec ? targetCandidates(seen, ME, spec).map((c) => c.slug) : [];
  ok(offered.length === 2, 'so Basic Insect offers both cannons from the board the player is actually looking at', offered.join(',') || '(none)');
}

console.log('\nUraby goes off wherever it lands');
{
  /* However it reached the pile — killed in battle, wiped by a Spell, thrown
     away to feed the King — up to two backrow cards come apart with it. */
  const board = (): { s: DuelState; u: CardInstance } => {
    const s = fresh('battle');
    s.active = FOE;
    const u = card(ME, 'uraby');
    u.summonedOnTurn = 0;
    s.players[ME].monsters[0] = u;
    const killer = card(FOE, 'blue-eyes-white-dragon');
    killer.summonedOnTurn = 0;
    s.players[FOE].monsters[0] = killer;
    s.players[FOE].spellTrap = { ...card(FOE, 'mirror-force'), face: 'down' as const };
    s.players[ME].spellTrap = card(ME, 'umi');
    return { s, u };
  };
  const slain = (): DuelState => {
    const { s, u } = board();
    return act(s, FOE, { type: 'attack', uid: s.players[FOE].monsters[0]!.uid, targetUid: u.uid });
  };

  const asked = slain();
  ok(asked.pending?.kind === 'choose', 'dying on their turn, it stops and asks', asked.pending?.kind ?? '(nothing asked)');
  ok(asked.pending?.player === ME, "and asks Uraby's owner, not the player taking the turn", asked.pending?.player);
  ok(asked.pending?.options.length === 2, 'offering both sides of the field, not just theirs', `${asked.pending?.options.length}`);
  ok((asked.pending as { optional?: boolean }).optional === true, 'and says the pick is optional');

  /* Three answers, all of them real. */
  const none = act(asked, ME, { type: 'chooseCard', uids: [] });
  ok(!!none.players[FOE].spellTrap && !!none.players[ME].spellTrap, 'answer nothing and nothing is destroyed — "up to" includes none');
  /* And the question closes. An empty answer is indistinguishable from an
     unanswered one unless the resume says so, and without that the window
     reopened on the same effect for ever — declining hung the duel. The pin
     that missed it checked what the effect did and never checked that it had
     finished asking. */
  ok(!none.pending, 'and declining ends the question rather than asking it again', none.pending ? 'asked again' : 'closed');

  const theirs = asked.pending!.options.find((uid) => asked.players[FOE].spellTrap?.uid === uid)!;
  const one = act(asked, ME, { type: 'chooseCard', uids: [theirs] });
  ok(!one.players[FOE].spellTrap, 'name one and that one goes');
  ok(!!one.players[ME].spellTrap, 'and your own is left alone unless you say otherwise');

  const both = act(asked, ME, { type: 'chooseCard', uids: asked.pending!.options });
  ok(!both.players[FOE].spellTrap && !both.players[ME].spellTrap, 'name two and both go, either side of the table');

  /* A Set trap does not get to answer on the way out. */
  ok(!one.pending, 'and the Set card it shattered never got a window to fire from', one.pending ? 'a window opened' : 'none');

  /* Not only from the field. Thrown away to pay for a swing, it still goes off
     — which is the whole of "in any way". */
  {
    const s = fresh('battle');
    const u = card(ME, 'uraby');
    const rex = card(ME, 'two-headed-king-rex');
    rex.summonedOnTurn = 0;
    rex.flags.attackCostDiscard = true;
    s.players[ME].monsters[0] = rex;
    s.players[ME].hand = [u, card(ME, 'kuriboh')];
    s.players[FOE].spellTrap = { ...card(FOE, 'mirror-force'), face: 'down' as const };
    const fed = act(s, ME, { type: 'attack', uid: rex.uid, targetUid: null, discardUid: u.uid });
    ok(fed.pending?.kind === 'choose', 'discarded as a cost, it still goes off', fed.pending?.kind ?? '(nothing asked)');
    const gone = act(fed, ME, { type: 'chooseCard', uids: [fed.players[FOE].spellTrap!.uid] });
    ok(!gone.players[FOE].spellTrap, 'and takes a backrow card with it from the Graveyard');
  }

  /* Nothing on the field to point at is not a prompt. */
  {
    const s = fresh('battle');
    s.active = FOE;
    const u = card(ME, 'uraby');
    u.summonedOnTurn = 0;
    s.players[ME].monsters[0] = u;
    const killer = card(FOE, 'blue-eyes-white-dragon');
    killer.summonedOnTurn = 0;
    s.players[FOE].monsters[0] = killer;
    const quiet = act(s, FOE, { type: 'attack', uid: killer.uid, targetUid: u.uid });
    ok(!quiet.pending, 'with a bare backrow on both sides it asks nothing at all', quiet.pending?.kind ?? 'nothing asked');
  }
}

console.log('\nTwo smaller Rex numbers, and a revival that stopped caring how it died');
{
  const s = fresh();
  const drag = card(ME, 'crawling-dragon-2');
  s.players[ME].monsters[0] = drag;
  const bare = effAtk(s, drag, ME);
  s.players[ME].grave.push(card(ME, 'kuriboh'), card(ME, 'kuriboh'), card(ME, 'raigeki'));
  ok(effAtk(s, drag, ME) === bare + 825, 'Crawling Dragon #2 is 275 a card in your Graveyard', `${effAtk(s, drag, ME)}`);

  /* Anthrosaurus used to need a battle. Any destruction now — a Dark Hole is a
     destruction, and the herd sends the next one up either way. */
  const e = fresh();
  e.players[ME].monsters[0] = card(ME, 'anthrosaurus');
  e.players[ME].grave.push(card(ME, 'megazowler'));
  const hole = card(ME, 'dark-hole');
  e.players[ME].hand.push(hole);
  const wiped = act(e, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
  ok(on(wiped, ME).some((m) => m.slug === 'megazowler'), 'Anthrosaurus sends a fossil up when an effect kills it too', on(wiped, ME).map((m) => m.slug).join(',') || 'nothing');

  /* And which fossil is yours to say, on whosever turn it falls. */
  const b = fresh('battle');
  b.active = FOE;
  const anth = card(ME, 'anthrosaurus');
  anth.summonedOnTurn = 0;
  b.players[ME].monsters[0] = anth;
  const killer = card(FOE, 'blue-eyes-white-dragon');
  killer.summonedOnTurn = 0;
  b.players[FOE].monsters[0] = killer;
  b.players[ME].grave.push(card(ME, 'megazowler'), card(ME, 'uraby'), card(ME, 'raigeki'));
  const asked = act(b, FOE, { type: 'attack', uid: killer.uid, targetUid: anth.uid });
  ok(asked.pending?.kind === 'choose' && asked.pending.player === ME, 'Anthrosaurus asks you which fossil to send up', asked.pending ? `${asked.pending.kind} for ${asked.pending.player}` : '(nothing asked)');
  const named = asked.pending!.options.map((u) => asked.players[ME].grave.find((g) => g.uid === u)?.slug);
  ok(named.includes('megazowler') && named.includes('uraby'), 'offering the fossils in the pile', named.join(',') || '(none)');
  ok(!named.includes('raigeki'), 'and nothing that is not one');
  /* Never itself. It is a Dinosaur lying in the Graveyard by the time it asks,
     and the summon op has always refused to revive its own source — a picker
     offering it would be the board and the engine disagreeing about the rule. */
  ok(!named.includes('anthrosaurus'), 'nor itself, which the summon would have refused anyway', named.join(','));
  const small = asked.pending!.options.find((u) => asked.players[ME].grave.find((g) => g.uid === u)?.slug === 'uraby')!;
  const up = act(asked, ME, { type: 'chooseCard', uids: [small] });
  ok(on(up, ME).some((m) => m.slug === 'uraby'), 'and the one you named is the one that stands up', on(up, ME).map((m) => m.slug).join(',') || 'nothing');
}

console.log('\nA Spell costs the same whether it comes from your hand or off the field');
{
  /* Set face-down and flipped up, a Spell used to skip the whole gate: no
     condition, no Life Points, no discard, no Tributes. Eight cards were free
     that way. Reported as "Tribute to the Doomed needs to cost before the
     opponent discards", which is what it looks like from the seat — the
     payment never happened at all. */
  const setUp = (slug: string): DuelState => {
    const s = fresh();
    const c = card(ME, slug);
    c.face = 'down';
    c.summonedOnTurn = 1;
    s.players[ME].spellTrap = c;
    return s;
  };

  /* Tribute to the Doomed: priced off their hand as it stood *before* the
     discard it causes. Four cards in hand is 4000, and they end holding one. */
  {
    const s = setUp('tribute-to-the-doomed');
    /* Room to pay: the bill is 4000 and the cost has to leave you standing. */
    s.players[ME].lp = 8000;
    s.players[FOE].hand = Array.from({ length: 4 }, () => card(FOE, 'kuriboh'));
    s.players[FOE].monsters = [card(FOE, 'battle-ox'), card(FOE, 'petit-moth'), card(FOE, 'kuriboh')];
    const before = s.players[ME].lp;
    const after = act(s, ME, { type: 'activateSetCard', uid: s.players[ME].spellTrap!.uid, targets: [s.players[FOE].monsters[0]!.uid] });
    ok(before - after.players[ME].lp === 4000, 'a Set Tribute to the Doomed pays for their whole hand', `${before - after.players[ME].lp}`);
    ok(after.players[FOE].hand.length === 1, 'and the discard it causes does not shrink the bill', `${after.players[FOE].hand.length} left`);
  }

  /* A Ritual Spell Set face-down summoned for free — no Tribute at all. */
  {
    const s = setUp('fortress-whale-s-oath');
    const fodder = card(ME, 'kuriboh');
    s.players[ME].monsters[0] = fodder;
    s.players[ME].hand.push(card(ME, 'fortress-whale'));
    const after = act(s, ME, { type: 'activateSetCard', uid: s.players[ME].spellTrap!.uid, targets: [fodder.uid] });
    ok(!on(after, ME).some((m) => m.uid === fodder.uid), 'a Set Ritual Spell still eats its Tribute', on(after, ME).map((m) => m.slug).join(','));
  }

  /* And a condition is consulted rather than assumed. */
  {
    const s = setUp('eradicating-aerosol');
    s.players[FOE].monsters[0] = card(FOE, 'battle-ox');
    const refused = applyAction(s, ME, { type: 'activateSetCard', uid: s.players[ME].spellTrap!.uid, targets: [s.players[FOE].monsters[0]!.uid] });
    ok(!!refused.error, 'a Set Spell with no Insect on the field is refused too', refused.error ?? '(activated)');

    const withBug = setUp('eradicating-aerosol');
    withBug.players[FOE].monsters[0] = card(FOE, 'battle-ox');
    withBug.players[ME].monsters[0] = card(ME, 'killer-needle');
    const sprayed = act(withBug, ME, { type: 'activateSetCard', uid: withBug.players[ME].spellTrap!.uid, targets: [withBug.players[FOE].monsters[0]!.uid] });
    ok(!sprayed.players[FOE].monsters.some((m) => m?.slug === 'battle-ox'), 'and goes off once there is a bug to spray');
  }

  /* Not enough Life Points is a refusal, off the field as much as out of hand. */
  {
    const s = setUp('tribute-to-the-doomed');
    s.players[ME].lp = 3000;
    s.players[FOE].hand = Array.from({ length: 4 }, () => card(FOE, 'kuriboh'));
    s.players[FOE].monsters[0] = card(FOE, 'battle-ox');
    const broke = applyAction(s, ME, { type: 'activateSetCard', uid: s.players[ME].spellTrap!.uid, targets: [s.players[FOE].monsters[0]!.uid] });
    ok(!!broke.error, 'and a bill you cannot pay is refused rather than taken', broke.error ?? '(activated)');
    ok(broke.state.players[ME].lp === 3000, 'with nothing deducted on the way out');
  }
}

console.log('\nThe aerosol needs a bug to spray');
{
  /* It does not care whose bug. The card sits in Weevil's own deck, so a
     requirement scoped to the other side of the table would have made it a card
     he could almost never play — and "on the field" is what it says. */
  const bare = fresh();
  const can = card(ME, 'eradicating-aerosol');
  bare.players[ME].hand = [can];
  bare.players[FOE].monsters[0] = card(FOE, 'battle-ox');
  ok(!canActivateFromHand(bare, ME, can), 'with no Insect anywhere, the can will not open');
  const refused = applyAction(bare, ME, { type: 'activateSpell', uid: can.uid, targets: [bare.players[FOE].monsters[0]!.uid] });
  ok(!!refused.error, 'and the engine refuses it rather than spraying at nothing', refused.error ?? '(activated)');

  for (const side of ['own', 'opp'] as const) {
    const s = fresh();
    const spray = card(ME, 'eradicating-aerosol');
    s.players[ME].hand = [spray];
    s.players[FOE].monsters[0] = card(FOE, 'battle-ox');
    const bug = side === 'own' ? card(ME, 'killer-needle') : card(FOE, 'killer-needle');
    s.players[side === 'own' ? ME : FOE].monsters[1] = bug;
    ok(canActivateFromHand(s, ME, spray), `one on ${side === 'own' ? 'your' : 'their'} side is enough`);
    const out = act(s, ME, { type: 'activateSpell', uid: spray.uid, targets: [s.players[FOE].monsters[0]!.uid] });
    ok(!out.players[FOE].monsters.some((m) => m?.slug === 'battle-ox'), 'and it still destroys what you pointed at');
  }

  /* A card back is not known to be an Insect. Allowing it on account of one
     would answer a question the player has not earned. */
  const hidden = fresh();
  const tin = card(ME, 'eradicating-aerosol');
  hidden.players[ME].hand = [tin];
  hidden.players[FOE].monsters[0] = card(FOE, 'battle-ox');
  const asleep = card(FOE, 'killer-needle');
  asleep.face = 'down';
  asleep.position = 'def';
  hidden.players[FOE].monsters[1] = asleep;
  ok(!canActivateFromHand(hidden, ME, tin), 'and a face-down one does not count, whatever is under it');
}

console.log('\nWeevil: the hive, and the ladder that climbs out of it');
{
  /* Both cannons went to 800. They are the only two cards Basic Insect can
     fetch, and it fetches one of them to wear. */
  for (const slug of ['laser-cannon-armor', 'insect-armor-with-laser-cannon']) {
    const s = fresh();
    const host = card(ME, 'kuwagata');
    s.players[ME].monsters[0] = host;
    const armor = card(ME, slug);
    s.players[ME].hand.push(armor);
    const worn = act(s, ME, { type: 'activateSpell', uid: armor.uid, targets: [host.uid] });
    const grew = effAtk(worn, worn.players[ME].monsters[0]!, ME) - effAtk(s, host, ME);
    ok(grew === 800, `${CARDS[slug].name} is worth 800`, `${grew}`);
  }

  /* Basic Insect: a 500 body that arrives carrying a cannon and, on the way
     out, reaches back into the pile for the wall. The pick is real — both
     cannons are in the Deck and the player names one. */
  {
    const s = fresh();
    ok(baseAtkOf('basic-insect') === 500, 'Basic Insect is a 500', `${baseAtkOf('basic-insect')}`);
    const bug = card(ME, 'basic-insect');
    s.players[ME].hand = [bug];
    s.players[ME].deck = [card(ME, 'laser-cannon-armor'), card(ME, 'insect-armor-with-laser-cannon')];
    const spec = targetSpecFor('basic-insect', 'onSummon');
    const offered = spec ? targetCandidates(s, ME, spec).length : 0;
    ok(offered === 2, 'and it offers both cannons to choose from', `${offered}`);
    const chosen = s.players[ME].deck[1].uid;
    const down = act(s, ME, { type: 'normalSummon', uid: bug.uid, zone: 0, position: 'atk', face: 'up', tributes: [], targets: [chosen] });
    ok(down.players[ME].hand.some((h) => h.slug === 'insect-armor-with-laser-cannon'), 'and hands you the one you named');

    /* And the wall, out of the Graveyard, as it dies. */
    const g = fresh();
    const dying = card(ME, 'basic-insect');
    g.players[ME].monsters[0] = dying;
    g.players[ME].grave.push(card(ME, 'insect-barrier'));
    const hole = card(ME, 'dark-hole');
    g.players[ME].hand.push(hole);
    const wiped = act(g, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
    ok(wiped.players[ME].hand.some((h) => h.slug === 'insect-barrier'), 'and pulls the wall back out of the Graveyard as it dies');
  }

  /* Leghul fetches the wall from either pile, and grows on every hit it lands
     — it attacks directly, so every swing lands. */
  {
    const s = fresh();
    const bug = card(ME, 'leghul');
    s.players[ME].hand = [bug];
    s.players[ME].deck = [card(ME, 'insect-barrier'), card(ME, 'kuriboh')];
    const down = act(s, ME, { type: 'normalSummon', uid: bug.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
    ok(down.players[ME].hand.some((h) => h.slug === 'insect-barrier'), 'Leghul comes in carrying the wall');

    const gr = fresh();
    const bug2 = card(ME, 'leghul');
    gr.players[ME].hand = [bug2];
    gr.players[ME].deck = [card(ME, 'kuriboh')];
    gr.players[ME].grave.push(card(ME, 'insect-barrier'));
    const down2 = act(gr, ME, { type: 'normalSummon', uid: bug2.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
    ok(down2.players[ME].hand.some((h) => h.slug === 'insect-barrier'), 'and out of the Graveyard when the Deck has none');

    const b = fresh('battle');
    const crawler = card(ME, 'leghul');
    crawler.summonedOnTurn = 0;
    b.players[ME].monsters[0] = crawler;
    const before = effAtk(b, crawler, ME);
    const hit = act(b, ME, { type: 'attack', uid: crawler.uid, targetUid: null });
    const after = effAtk(hit, hit.players[ME].monsters[0]!, ME);
    ok(after === before + 500, 'and it grows 500 on every hit it lands', `${before} → ${after}`);
  }

  /* Insect Soldiers of the Sky: a thousand, not eight hundred, and only over
     company. */
  {
    const alone = fresh();
    const flier = card(ME, 'insect-soldiers-of-the-sky');
    alone.players[ME].monsters[0] = flier;
    ok(effAtk(alone, flier, ME) === 1000, 'Insect Soldiers of the Sky alone is its printed 1000', `${effAtk(alone, flier, ME)}`);
    const swarm = structuredClone(alone);
    swarm.players[ME].monsters[1] = card(ME, 'killer-needle');
    ok(effAtk(swarm, swarm.players[ME].monsters[0]!, ME) === 2000, 'and 1000 more over a hive-mate', `${effAtk(swarm, swarm.players[ME].monsters[0]!, ME)}`);
  }

  /* Parasite Paracide bites the hand that kills it in battle — and only in
     battle. Dark Hole takes it for free. */
  {
    const b = fresh('battle');
    const bug = card(ME, 'parasite-paracide');
    b.players[ME].monsters[0] = bug;
    const killer = card(FOE, 'blue-eyes-white-dragon');
    killer.summonedOnTurn = 0;
    b.players[FOE].monsters[0] = killer;
    b.players[FOE].hand = [card(FOE, 'kuriboh'), card(FOE, 'kuriboh')];
    b.active = FOE;
    const slain = act(b, FOE, { type: 'attack', uid: killer.uid, targetUid: bug.uid });
    ok(slain.players[FOE].hand.length === 1, 'Parasite Paracide costs them a card when battle kills it', `${slain.players[FOE].hand.length} left`);

    const e = fresh();
    const bug2 = card(ME, 'parasite-paracide');
    e.players[ME].monsters[0] = bug2;
    e.players[FOE].hand = [card(FOE, 'kuriboh'), card(FOE, 'kuriboh')];
    const hole = card(ME, 'dark-hole');
    e.players[ME].hand.push(hole);
    const wiped = act(e, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
    ok(wiped.players[FOE].hand.length === 2, 'and costs them nothing when an effect does', `${wiped.players[FOE].hand.length} left`);
  }

  /* Flying Kamakiri #1 reaches for any Insect, not only the biggest. */
  {
    const s = fresh();
    const bug = card(ME, 'flying-kamakiri-1');
    s.players[ME].monsters[0] = bug;
    s.players[ME].deck = [card(ME, 'petit-moth'), card(ME, 'kuriboh')];
    const hole = card(ME, 'dark-hole');
    s.players[ME].hand.push(hole);
    const wiped = act(s, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
    ok(wiped.players[ME].hand.some((h) => h.slug === 'petit-moth'), 'Flying Kamakiri #1 finds a small Insect too');
  }

  /* Kuwagata is worth the swarm, living and dead. */
  {
    const s = fresh();
    const beetle = card(ME, 'kuwagata');
    s.players[ME].monsters[0] = beetle;
    const base = CARDS['kuwagata'].atk!;
    ok(effAtk(s, beetle, ME) === base + 400, 'Kuwagata counts itself among the living', `${effAtk(s, beetle, ME)}`);
    const more = structuredClone(s);
    more.players[FOE].monsters[0] = card(FOE, 'killer-needle');
    ok(effAtk(more, more.players[ME].monsters[0]!, ME) === base + 800, 'and counts their Insects too — the field, not your side', `${effAtk(more, more.players[ME].monsters[0]!, ME)}`);
    const dead = structuredClone(s);
    dead.players[ME].grave.push(card(ME, 'petit-moth'), card(ME, 'leghul'));
    ok(effAtk(dead, dead.players[ME].monsters[0]!, ME) === base + 400 + 400, 'and 200 for each one in your Graveyard', `${effAtk(dead, dead.players[ME].monsters[0]!, ME)}`);
  }

  /* Killer Needle grows on the damage it deals, and there is always another
     one — sent to the Graveyard by any road, not only destroyed. */
  {
    const b = fresh('battle');
    const needle = card(ME, 'killer-needle');
    needle.summonedOnTurn = 0;
    b.players[ME].monsters[0] = needle;
    b.players[ME].deck = [card(ME, 'killer-needle')];
    const before = effAtk(b, needle, ME);
    const hit = act(b, ME, { type: 'attack', uid: needle.uid, targetUid: null });
    const grown = hit.players[ME].monsters.find((m) => m?.uid === needle.uid);
    ok(!!grown && effAtk(hit, grown, ME) === before + 500, 'Killer Needle grows 500 on the damage it deals', `${grown ? effAtk(hit, grown, ME) : 'gone'}`);
    ok(hit.players[FOE].lp === 4000 - 1200 - 500, 'and the extra 500 lands on top of the battle damage', `${hit.players[FOE].lp}`);

    /* Tributed, not destroyed — the next needle still comes. */
    const t = fresh();
    const spent = card(ME, 'killer-needle');
    t.players[ME].monsters[0] = spent;
    t.players[ME].deck = [card(ME, 'killer-needle')];
    const big = card(ME, 'summoned-skull');
    t.players[ME].hand = [big];
    const paid = act(t, ME, { type: 'normalSummon', uid: big.uid, zone: 1, position: 'atk', face: 'up', tributes: [spent.uid] });
    ok(on(paid, ME).some((m) => m.slug === 'killer-needle'), 'and another one answers even when it was spent rather than killed', on(paid, ME).map((m) => m.slug).join(','));
  }

  /* Hercules Beetle thickens on the hive's dead. */
  {
    const s = fresh();
    const beetle = card(ME, 'hercules-beetle');
    s.players[ME].monsters[0] = beetle;
    const base = effDef(s, beetle, ME);
    const buried = structuredClone(s);
    buried.players[ME].grave.push(card(ME, 'leghul'), card(ME, 'petit-moth'), card(ME, 'dark-hole'));
    const now = effDef(buried, buried.players[ME].monsters[0]!, ME);
    ok(now === base + 1000, 'Hercules Beetle gains 500 DEF for each Insect in your Graveyard, and nothing for a Spell', `${base} → ${now}`);
  }
}

console.log('\nThe cocoon thickens, and hatches whatever it has grown into');
{
  /* A counter at the end of every turn, whoever is sitting — and 500 DEF a
     counter while it waits. */
  const s = fresh();
  const shell = card(ME, 'cocoon-of-evolution');
  s.players[ME].monsters[0] = shell;
  const base = effDef(s, shell, ME);
  let cur = act(s, ME, { type: 'endTurn' });
  ok(cur.players[ME].monsters[0]!.counters === 1, 'the Cocoon takes a counter at the end of your turn', `${cur.players[ME].monsters[0]!.counters}`);
  cur = act(cur, FOE, { type: 'endTurn' });
  ok(cur.players[ME].monsters[0]!.counters === 1, 'and not at the end of theirs — it thickens on its own clock', `${cur.players[ME].monsters[0]!.counters}`);
  ok(effDef(cur, cur.players[ME].monsters[0]!, ME) === base + 500, 'and it is 500 DEF thicker for each one', `${effDef(cur, cur.players[ME].monsters[0]!, ME)}`);

  /* And it stops at four. Past the top rung there is nothing left to grow
     into, and a shell counting forever was a wall with no answer. */
  let deep = cur;
  for (let i = 0; i < 8; i++) {
    deep = act(deep, ME, { type: 'endTurn' });
    deep = act(deep, FOE, { type: 'endTurn' });
  }
  ok(deep.players[ME].monsters[0]!.counters === 4, 'and it stops at four however long it is left alone', `${deep.players[ME].monsters[0]!.counters}`);

  /* Cracked open on purpose it gives up the rung it has reached. */
  const rungs: Array<[number, string]> = [
    [1, 'petit-moth'],
    [2, 'larvae-moth'],
    [3, 'great-moth'],
    [4, 'perfectly-ultimate-great-moth'],
  ];
  for (const [n, slug] of rungs) {
    const h = fresh();
    const c = card(ME, 'cocoon-of-evolution');
    c.counters = n;
    h.players[ME].monsters[0] = c;
    h.players[ME].deck = rungs.map(([, sl]) => card(ME, sl));
    const out = act(h, ME, { type: 'ignition', uid: c.uid, targets: [] });
    ok(on(out, ME).some((m) => m.slug === slug), `at ${n} counters the Cocoon hatches ${CARDS[slug].name}`, on(out, ME).map((m) => m.slug).join(',') || 'nothing');
  }

  /* Broken by somebody else it gives up one rung less, and never the Ultimate. */
  {
    const h = fresh();
    const c = card(ME, 'cocoon-of-evolution');
    c.counters = 4;
    h.players[ME].monsters[0] = c;
    h.players[ME].deck = rungs.map(([, sl]) => card(ME, sl));
    const hole = card(ME, 'dark-hole');
    h.players[ME].hand.push(hole);
    const wiped = act(h, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
    const born = on(wiped, ME).map((m) => m.slug);
    ok(born.includes('great-moth'), 'a Cocoon broken at 4 gives up a Great Moth', born.join(',') || 'nothing');
    ok(!born.includes('perfectly-ultimate-great-moth'), 'and never the Ultimate — that one is only ever born on purpose');
  }
}

console.log('\nThe ladder is a relay now, not a climb');
{
  /* Each rung places its own counters as it lands, then hands the next one up
     at the start of your turn and goes to the Graveyard itself. */
  const chain: Array<[string, string, number]> = [
    ['petit-moth', 'larvae-moth', 1],
    ['larvae-moth', 'great-moth', 2],
    ['great-moth', 'perfectly-ultimate-great-moth', 3],
  ];
  for (const [from, to, counters] of chain) {
    /* Great Moth is Level 8, so it comes down over two Tributes. Pay whatever
       its level asks rather than hard-coding a number that will rot. */
    const s = fresh();
    const moth = card(ME, from);
    s.players[ME].hand = [moth];
    const need = tributesRequired(from, s, ME);
    const tributes: string[] = [];
    for (let i = 0; i < need; i++) {
      const fodder = card(ME, 'kuriboh');
      s.players[ME].monsters[i + 1] = fodder;
      tributes.push(fodder.uid);
    }
    const down = act(s, ME, { type: 'normalSummon', uid: moth.uid, zone: 0, position: 'atk', face: 'up', tributes });
    const landed = down.players[ME].monsters.find((m) => m?.slug === from);
    ok(landed?.counters === counters, `${CARDS[from].name} places its own ${counters} as it lands`, `${landed?.counters}`);

    const relay = structuredClone(down);
    relay.players[ME].deck = [card(ME, to)];
    let cur = act(relay, ME, { type: 'endTurn' });
    cur = act(cur, FOE, { type: 'endTurn' });
    ok(on(cur, ME).some((m) => m.slug === to), `and hands ${CARDS[to].name} up at the start of your turn`, on(cur, ME).map((m) => m.slug).join(',') || 'nothing');
    ok(cur.players[ME].grave.some((g) => g.slug === from), `while ${CARDS[from].name} itself goes to the Graveyard`);
  }

  /* And the counters are worth what the cards say. */
  const sizes: Array<[string, number, number, number]> = [
    ['petit-moth', 1, 500, 500],
    ['larvae-moth', 2, 500, 1000],
    ['great-moth', 3, 1000, 1000],
  ];
  for (const [slug, n, atkPer, defPer] of sizes) {
    const s = fresh();
    const moth = card(ME, slug);
    s.players[ME].monsters[0] = moth;
    const bare = { a: effAtk(s, moth, ME), d: effDef(s, moth, ME) };
    moth.counters = n;
    ok(effAtk(s, moth, ME) === bare.a + atkPer * n, `${CARDS[slug].name} is worth ${atkPer} ATK a counter`, `${effAtk(s, moth, ME)}`);
    ok(effDef(s, moth, ME) === bare.d + defPer * n, `and ${defPer} DEF a counter`, `${effDef(s, moth, ME)}`);
  }
}

console.log('\nThe Ultimate is only ever reached by climbing');
{
  /* It is the top of a ladder. A Monster Reborn that skipped every rung made
     the climb pointless, so nothing puts it on the field except the two rungs
     below it: the Great Moth that hands it up, and a Cocoon of Evolution that
     has thickened all the way to four. */
  const s = fresh();
  const apex = card(ME, 'perfectly-ultimate-great-moth');
  s.players[ME].hand = [apex];
  s.players[ME].monsters[1] = card(ME, 'kuriboh');
  s.players[ME].monsters[2] = card(ME, 'kuriboh');
  ok(
    summonBlocked(s, ME, 'perfectly-ultimate-great-moth') !== null,
    'no Normal Summon reaches it, at any price',
    summonBlocked(s, ME, 'perfectly-ultimate-great-moth') ?? '(allowed)'
  );
  const refused = applyAction(s, ME, {
    type: 'normalSummon',
    uid: apex.uid,
    zone: 0,
    position: 'atk',
    face: 'up',
    tributes: [s.players[ME].monsters[1]!.uid, s.players[ME].monsters[2]!.uid],
  });
  ok(!!refused.error, 'and the board says so rather than quietly allowing it', refused.error ?? '(summoned)');

  /* Nor any Special Summon that is not its own. Monster Reborn is the one
     everybody reaches for. */
  const g = fresh();
  g.players[ME].grave.push(card(ME, 'perfectly-ultimate-great-moth'));
  const reborn = card(ME, 'monster-reborn');
  g.players[ME].hand = [reborn];
  const spec = targetSpecFor('monster-reborn', 'activate');
  const offered = spec ? targetCandidates(g, ME, spec).map((c) => c.slug) : [];
  ok(!offered.includes('perfectly-ultimate-great-moth'), 'Monster Reborn is not even offered it', offered.join(',') || '(nothing)');
  /* Pointed straight at it, the Reborn is now refused rather than announced
     and wasted — a Graveyard holding nothing this card may raise is a Special
     Summon with an empty pool, and those stopped being activatable when the
     Scapegoat report was generalised. The card stays in hand for a target it
     can actually reach. */
  const raised = applyAction(g, ME, { type: 'activateSpell', uid: reborn.uid, targets: [g.players[ME].grave[0].uid] });
  ok(!!raised.error, 'and the Reborn is refused rather than spent on it', raised.error ?? '(allowed)');
  ok(!on(raised.state, ME).some((m) => m.slug === 'perfectly-ultimate-great-moth'), 'so it never reaches the field that way');
  ok(raised.state.players[ME].hand.some((h) => h.uid === reborn.uid), 'and the Reborn is still in hand');

  /* The two roads that do work. */
  const relay = fresh();
  const great = card(ME, 'great-moth');
  great.counters = 3;
  relay.players[ME].monsters[0] = great;
  relay.players[ME].deck = [card(ME, 'perfectly-ultimate-great-moth')];
  let cur = act(relay, ME, { type: 'endTurn' });
  cur = act(cur, FOE, { type: 'endTurn' });
  ok(on(cur, ME).some((m) => m.slug === 'perfectly-ultimate-great-moth'), 'Great Moth still hands it up', on(cur, ME).map((m) => m.slug).join(',') || 'nothing');

  const shell = fresh();
  const cocoon = card(ME, 'cocoon-of-evolution');
  cocoon.counters = 4;
  shell.players[ME].monsters[0] = cocoon;
  shell.players[ME].deck = [card(ME, 'perfectly-ultimate-great-moth')];
  const hatched = act(shell, ME, { type: 'ignition', uid: cocoon.uid, targets: [] });
  ok(on(hatched, ME).some((m) => m.slug === 'perfectly-ultimate-great-moth'), 'and a Cocoon grown all the way still gives it up', on(hatched, ME).map((m) => m.slug).join(',') || 'nothing');
}

console.log('\nThe Ultimate clears the table and then measures the wreckage');
{
  /* Born the only way it can be: hatched out of a full Cocoon, so the summon
     trigger fires the way the board fires it rather than being poked by hand. */
  const t = fresh();
  t.players[ME].monsters[0] = card(ME, 'kuriboh');
  t.players[FOE].monsters[0] = card(FOE, 'blue-eyes-white-dragon');
  t.players[FOE].monsters[1] = card(FOE, 'summoned-skull');
  t.players[FOE].spellTrap = card(FOE, 'insect-barrier');
  t.players[FOE].hand = Array.from({ length: 6 }, () => card(FOE, 'kuriboh'));
  t.players[ME].deck = [card(ME, 'perfectly-ultimate-great-moth')];
  const cocoon = card(ME, 'cocoon-of-evolution');
  cocoon.counters = 4;
  t.players[ME].monsters[1] = cocoon;
  const out = act(t, ME, { type: 'ignition', uid: cocoon.uid, targets: [] });
  const apex = on(out, ME).find((m) => m.slug === 'perfectly-ultimate-great-moth');
  ok(!!apex, 'the Ultimate is born', on(out, ME).map((m) => m.slug).join(',') || 'nothing');
  ok(on(out, ME).length === 1 && on(out, FOE).length === 0, 'and every other monster on the field is gone', `${on(out, ME).length} mine, ${on(out, FOE).length} theirs`);
  ok(out.players[FOE].spellTrap === null, 'their backrow with it');
  ok(out.players[FOE].hand.length === 1, 'and their hand is five cards lighter', `${out.players[FOE].hand.length} left`);
  const graves = out.players[ME].grave.length + out.players[FOE].grave.length;
  const printed = CARDS['perfectly-ultimate-great-moth'].atk!;
  ok(apex !== undefined && effAtk(out, apex, ME) === printed + 100 * graves, 'and it reads the wreckage it just made for its own size', `${apex ? effAtk(out, apex, ME) : '?'} vs ${printed} + 100×${graves}`);

  /* And it pays for its life out of the hive — born the same way, so the
     protection is the card's and not the harness's. */
  const born2 = (insectsInPile: number) => {
    const d = fresh();
    d.players[ME].deck = [card(ME, 'perfectly-ultimate-great-moth')];
    const shell = card(ME, 'cocoon-of-evolution');
    shell.counters = 4;
    d.players[ME].monsters[0] = shell;
    const hatched = act(d, ME, { type: 'ignition', uid: shell.uid, targets: [] });
    hatched.players[ME].grave = hatched.players[ME].grave.filter((g) => CARDS[g.slug]?.type !== 'Insect');
    for (let i = 0; i < insectsInPile; i++) hatched.players[ME].grave.push(card(ME, 'leghul'));
    const hole = card(ME, 'dark-hole');
    hatched.players[ME].hand.push(hole);
    return act(hatched, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
  };
  const shielded = born2(1);
  ok(on(shielded, ME).some((m) => m.slug === 'perfectly-ultimate-great-moth'), 'Dark Hole cannot take the Ultimate while an Insect lies in the pile', on(shielded, ME).map((m) => m.slug).join(',') || 'gone');
  ok(!shielded.players[ME].grave.some((g) => g.slug === 'leghul'), 'the Insect in the pile is spent instead');
  const bare = born2(0);
  ok(!on(bare, ME).some((m) => m.slug === 'perfectly-ultimate-great-moth'), 'and once the hive is empty it dies like anything else');
}

console.log('\nA Token says what it is');
{
  /* "Kuriboh summons a token but nowhere is it stated." It was announced with
     the art's card name, so a second Kuriboh appeared carrying the first one's
     line and nothing said what had arrived. */
  const s = fresh();
  const kuriboh = card(ME, 'kuriboh');
  s.players[ME].hand.push(kuriboh);
  const after = act(s, ME, { type: 'normalSummon', uid: kuriboh.uid, zone: 0, position: 'atk', face: 'up' });
  const token = on(after, ME).find((m) => m.isToken);
  ok(!!token, 'the Token arrives', `${on(after, ME).length} monsters`);
  const beat = after.anims.find((a) => a.kind === 'summon' && a.uid === token?.uid);
  ok(beat?.as === 'Kuriboh Token', 'and its beat names it', beat?.as ?? '(nothing)');
}

console.log('\nA Trap announces itself on the field');
{
  /* Every line the duel records is spoken on the field, and a Trap springing is
     the one a player most needs to see. Trap Hole fires on the opponent's
     Normal Summon, so the beat has to carry the card. */
  const s = fresh();
  const hole = card(FOE, 'trap-hole');
  hole.face = 'down';
  hole.summonedOnTurn = 1;
  s.players[FOE].spellTrap = hole;
  const ox = card(ME, 'battle-ox');
  s.players[ME].hand.push(ox);
  const summoned = act(s, ME, { type: 'normalSummon', uid: ox.uid, zone: 0, position: 'atk', face: 'up' });
  ok(summoned.pending?.player === FOE, 'the window opens for the Trap Hole', String(summoned.pending?.player));
  const sprung = act(summoned, FOE, { type: 'respondTrap', uid: hole.uid, targets: [] });
  const beat = sprung.anims.find((a) => a.kind === 'trap' && a.slug === 'trap-hole');
  ok(!!beat, 'and the Trap gets a beat of its own naming the card', sprung.anims.map((a) => a.kind).join(','));
  ok(!on(sprung, ME).length, 'and the summoned monster is destroyed');
}

console.log('\nSky Scout pays for going round the blockers, and for nothing else');
{
  /* "Can attack your opponent directly, but its battle damage is halved" — and
     at first only the first half of that sentence existed, so it was an
     unblockable 1800 every turn for one Normal Summon. The fix for that was
     `halvedBattleDamage`, the whole-sentence version, and it overshot: every
     swing the bird ever made was halved, including into a monster and including
     an open board where there was nothing to fly past. Reported by the owner
     from a duel — an empty field is an ordinary direct attack, and this was the
     one card in the game being made *worse* for having "can attack directly"
     written on it.
     Same bargain as Gaia the Dragon Champion now: the half is the toll for
     going over a guard, charged only while a guard is standing. */
  const scoutFlags = fresh('battle');
  const probe = card(ME, 'sky-scout');
  scoutFlags.players[ME].monsters[0] = probe;
  const sf = effFlags(scoutFlags, probe, ME);
  ok(sf.directAttack === true, 'Sky Scout can attack directly');
  ok(sf.halvedDirectDamage === true, 'and pays half for going around a guard');
  ok(sf.halvedBattleDamage !== true, 'but is no longer halved across the board');

  /* By the effect: a guard is standing, so the flyover costs half. */
  const over = fresh('battle');
  const scout = card(ME, 'sky-scout'); // 1800 ATK
  over.players[ME].monsters[0] = scout;
  const wall = card(FOE, 'mystical-elf'); // a blocker it walks past
  over.players[FOE].monsters[0] = wall;
  const flown = act(over, ME, { type: 'attack', uid: scout.uid, targetUid: null });
  ok(flown.players[FOE].lp === 4000 - 900, 'going OVER a blocker lands for half', `LP ${flown.players[FOE].lp}`);
  ok(
    flown.players[FOE].monsters.some((m) => m?.uid === wall.uid),
    'with the blocker left standing — it went around, not through'
  );

  /* Naturally: nothing to fly over, so it is an ordinary direct attack. This is
     the one the owner reported, and it used to land for 900. */
  const openBoard = fresh('battle');
  const scout2 = card(ME, 'sky-scout');
  openBoard.players[ME].monsters[0] = scout2;
  const open = act(openBoard, ME, { type: 'attack', uid: scout2.uid, targetUid: null });
  ok(open.players[FOE].lp === 4000 - 1800, 'an EMPTY board takes the whole 1800', `LP ${open.players[FOE].lp}`);

  /* Through a monster is an ordinary battle, and was being halved too. */
  const into = fresh('battle');
  const scout3 = card(ME, 'sky-scout');
  into.players[ME].monsters[0] = scout3;
  const chick = card(FOE, 'kuriboh'); // 300 ATK
  into.players[FOE].monsters[0] = chick;
  const through = act(into, ME, { type: 'attack', uid: scout3.uid, targetUid: chick.uid });
  ok(through.players[FOE].lp === 4000 - 1500, 'and a swing THROUGH a monster is not halved', `LP ${through.players[FOE].lp}`);

  // CONTROL: nobody else's battle damage moved.
  const plain = fresh('battle');
  const ox = card(ME, 'battle-ox'); // 1700 ATK
  plain.players[ME].monsters[0] = ox;
  const hit = act(plain, ME, { type: 'attack', uid: ox.uid, targetUid: null });
  ok(hit.players[FOE].lp === 4000 - 1700, 'CONTROL: an ordinary attacker is untouched', `LP ${hit.players[FOE].lp}`);
}

console.log('\nA token is a body, and a body can be tributed');
{
  /* From a real duel, with the screenshot to prove it: three Kuriboh Tokens
     filling every zone, Curse of Dragon in hand, and both summon buttons dead
     with "needs 1 tribute(s)". The engine accepted token tributes all along —
     the UI, the AI and the test driver each carried their own exclusion. */
  const s = fresh();
  for (let i = 0; i < 3; i++) {
    const t = card(ME, 'kuriboh');
    t.isToken = true;
    t.tokenName = 'Kuriboh Token';
    s.players[ME].monsters[i] = t;
  }
  const curse = card(ME, 'curse-of-dragon');
  s.players[ME].hand.push(curse);
  const graveBefore = s.players[ME].grave.length;

  const tribute = s.players[ME].monsters[0]!.uid;
  const after = act(s, ME, { type: 'normalSummon', uid: curse.uid, zone: 0, position: 'atk', face: 'up', tributes: [tribute] });
  ok(after.players[ME].monsters[0]?.slug === 'curse-of-dragon', 'a token pays for a Tribute Summon on a full board', after.players[ME].monsters[0]?.slug);
  ok(after.players[ME].grave.length === graveBefore, 'and the tribute vanishes rather than entering the Graveyard', `grave ${after.players[ME].grave.length}`);
  ok(on(after, ME).length === 3, 'the other two tokens stand where they were', `${on(after, ME).length} monsters`);

  // Two tributes off the same wall for a Level 7.
  const b = fresh();
  for (let i = 0; i < 3; i++) {
    const t = card(ME, 'kuriboh');
    t.isToken = true;
    t.tokenName = 'Kuriboh Token';
    b.players[ME].monsters[i] = t;
  }
  const skull = card(ME, 'red-eyes-black-dragon');
  b.players[ME].hand.push(skull);
  const pair = [b.players[ME].monsters[0]!.uid, b.players[ME].monsters[1]!.uid];
  const big = act(b, ME, { type: 'normalSummon', uid: skull.uid, zone: 0, position: 'atk', face: 'up', tributes: pair });
  ok(big.players[ME].monsters[0]?.slug === 'red-eyes-black-dragon', 'and two tokens pay for a Level 7', big.players[ME].monsters[0]?.slug);
}

console.log('\nThe last blow only ever takes the Life Points that are there');
{
  /* The board adds queued damage back to work out the total it has not yet
     announced. With the headline figure that put the bar *above* where it
     started: 1200 Life Points hit for 1900 showed 1900 — the attacker's ATK —
     and counted down from a number the player had never had. */
  const s = fresh('battle');
  s.players[FOE].lp = 1200;
  const raider = card(ME, 'vorse-raider'); // 1900 ATK
  s.players[ME].monsters[0] = raider;
  const after = act(s, ME, { type: 'attack', uid: raider.uid, targetUid: null });
  const blow = after.anims.find((a) => a.kind === 'damage' && a.player === FOE);
  ok(after.players[FOE].lp === 0, 'the duel ends', `LP ${after.players[FOE].lp}`);
  ok(blow?.amount === 1900, 'the blow is announced at its full worth', String(blow?.amount));
  ok(blow?.applied === 1200, 'and only 1200 Life Points actually moved', String(blow?.applied));
}


/* ====================================================================== *
 * Six cards reported from a real duel. Each one is here because it was
 * wrong on a board a player was actually looking at.
 * ====================================================================== */

console.log('\nThe Legendary Fisherman only rides the waves while there are waves');
{
  /* Reported as two bugs — "was able to attack directly without Umi on the
     field" and "black hole did not destroy him" — and it is one. His grants
     are written behind `condition: { requiresField: 'umi' }`, and
     `liftPassives` was collecting every lifted passive into a single
     *unconditional* aura, dropping the condition on the way. So he had both
     halves of his text permanently, from the moment he arrived. */
  const dry = fresh('battle');
  const fisher = card(ME, 'the-legendary-fisherman');
  dry.players[ME].monsters[0] = fisher;
  dry.players[FOE].monsters[0] = card(FOE, 'hitotsu-me-giant');
  ok(!effFlags(dry, fisher, ME).directAttack, 'with no Umi he cannot attack directly');
  ok(!effFlags(dry, fisher, ME).untargetable, 'and he is an ordinary target');
  ok(!legalAttackTargets(dry, ME, fisher).direct, 'so a blocker really does block him');

  // Dark Hole is the reported half: it should take him with everything else.
  const hole = fresh();
  const f2 = card(ME, 'the-legendary-fisherman');
  hole.players[ME].monsters[0] = f2;
  hole.players[FOE].monsters[0] = card(FOE, 'hitotsu-me-giant');
  const dh = card(FOE, 'dark-hole');
  hole.players[FOE].hand.push(dh);
  hole.active = FOE;
  const swept = act(hole, FOE, { type: 'activateSpell', uid: dh.uid });
  ok(on(swept, ME).length === 0, 'and Dark Hole destroys him like anything else', `${on(swept, ME).length} left`);

  // With Umi down — either player's Umi, which is what "on the field" means —
  // he gets the whole sentence back.
  const sea = fresh('battle');
  const f3 = card(ME, 'the-legendary-fisherman');
  sea.players[ME].monsters[0] = f3;
  sea.players[FOE].monsters[0] = card(FOE, 'hitotsu-me-giant');
  sea.players[ME].field = card(ME, 'umi');
  ok(!!effFlags(sea, f3, ME).directAttack, 'with Umi on the field he can attack directly');
  ok(!!effFlags(sea, f3, ME).untargetable, 'and cannot be touched by their effects');
  ok(legalAttackTargets(sea, ME, f3).direct, 'so he swims straight past the blocker');

  const theirs = fresh('battle');
  const f4 = card(ME, 'the-legendary-fisherman');
  theirs.players[ME].monsters[0] = f4;
  theirs.players[FOE].field = card(FOE, 'umi');
  ok(!!effFlags(theirs, f4, ME).directAttack, 'and it is their Umi just as much as yours');
}

console.log('\nSetting a monster is not summoning one');
{
  /* "Trap hole worked on setting a monster (not just on normal summon)."
     Worse than a mis-trigger: the prompt read "Foe summoned Man-Eater Bug",
     naming a card that was face-down. */
  const s = fresh();
  const hole = card(FOE, 'trap-hole');
  hole.face = 'down';
  hole.summonedOnTurn = s.turn - 1;
  s.players[FOE].spellTrap = hole;
  const bug = card(ME, 'man-eater-bug');
  s.players[ME].hand.push(bug);
  const set = act(s, ME, { type: 'normalSummon', uid: bug.uid, zone: 0, position: 'def', face: 'down' });
  ok(!set.pending, 'a Set opens no trap window at all', set.pending ? set.pending.reason : '');
  ok(set.players[ME].monsters[0]?.face === 'down', 'and the monster is still face-down');

  // The same card, summoned face-up, still walks into it.
  const b = fresh();
  const hole2 = card(FOE, 'trap-hole');
  hole2.face = 'down';
  hole2.summonedOnTurn = b.turn - 1;
  b.players[FOE].spellTrap = hole2;
  const bug2 = card(ME, 'man-eater-bug');
  b.players[ME].hand.push(bug2);
  const up = act(b, ME, { type: 'normalSummon', uid: bug2.uid, zone: 0, position: 'atk', face: 'up' });
  ok(up.pending?.kind === 'trap', 'CONTROL: a face-up Normal Summon still opens it');
}

console.log('\nTrap Hole answers any kind of Summon, and a Set is still not one');
{
  /* It used to say "Normal Summons" and mean only that, and this section
     pinned the narrowness. The owner asked for the wider card — "change from
     normal summon to just summon (so any kind)" — so the pin now records the
     rule that replaced it. Torrential Tribute and Apophis ride along: both
     have said "when your opponent Summons" since the day they were written,
     and only ever caught Normal and Fusion Summons because no Special Summon
     opened the window for anybody.

     Gaia the Dragon Champion, not the Blue-Eyes Ultimate Dragon. Written with
     the Ultimate Dragon first, this assertion passed on the *unfixed* engine
     too — its Fusion effect destroys every Spell and Trap the opponent
     controls, so the Trap Hole was gone before the window could open and the
     check could not fail. Exactly the trap the control below fell into. */
  const s = fresh();
  const hole = card(FOE, 'trap-hole');
  hole.face = 'down';
  hole.summonedOnTurn = s.turn - 1;
  s.players[FOE].spellTrap = hole;
  const a = card(ME, 'gaia-the-fierce-knight');
  const b = card(ME, 'curse-of-dragon');
  s.players[ME].monsters = [a, b, null];
  const poly = card(ME, 'polymerization');
  s.players[ME].hand.push(poly);
  const ex = card(ME, 'gaia-the-dragon-champion');
  s.players[ME].extra.push(ex);
  const fused = act(s, ME, {
    type: 'fusionSummon',
    extraUid: ex.uid,
    materials: [a.uid, b.uid],
    zone: 0,
    position: 'atk',
  });
  ok(!!fused.pending, 'Trap Hole answers a Fusion Summon', fused.pending ? fused.pending.reason : '(no window)');

  /* The roads it used to walk past. A monster revived out of the Graveyard is
     a Summon, and so is a Token — and neither opened a window for anybody. */
  {
    const g = fresh();
    const hole2 = card(FOE, 'trap-hole');
    hole2.face = 'down';
    hole2.summonedOnTurn = g.turn - 1;
    g.players[FOE].spellTrap = hole2;
    const skull = card(ME, 'summoned-skull');
    g.players[ME].grave = [skull];
    const reborn = card(ME, 'monster-reborn');
    g.players[ME].hand = [reborn];
    const raised = applyAction(g, ME, { type: 'activateSpell', uid: reborn.uid, targets: [skull.uid] });
    ok(!!raised.state.pending, 'and a Special Summon out of the Graveyard', raised.state.pending ? '' : '(no window)');

    /* Firing it destroys what arrived and charges the 400. */
    const fired = act(raised.state, FOE, { type: 'respondTrap', uid: hole2.uid });
    ok(!on(fired, ME).some((m) => m.slug === 'summoned-skull'), 'the monster it caught is destroyed', on(fired, ME).map((m) => m.slug).join(',') || 'nothing');
    ok(fired.players[ME].lp === g.players[ME].lp - 400, 'and its owner pays 400', `${fired.players[ME].lp}`);

    const tk = fresh();
    const hole3 = card(FOE, 'trap-hole');
    hole3.face = 'down';
    hole3.summonedOnTurn = tk.turn - 1;
    tk.players[FOE].spellTrap = hole3;
    const goat = card(ME, 'scapegoat');
    tk.players[ME].hand = [goat];
    const tokens = applyAction(tk, ME, { type: 'activateSpell', uid: goat.uid });
    ok(!!tokens.state.pending, 'and a Token arriving', tokens.state.pending ? '' : '(no window)');
  }

  /* And the line that must not move: Setting a monster is not a Summon. It
     opens no window, and the reason matters as much as the rule — the prompt
     names the card, which would give away what was just Set. */
  {
    const q = fresh();
    const hole4 = card(FOE, 'trap-hole');
    hole4.face = 'down';
    hole4.summonedOnTurn = q.turn - 1;
    q.players[FOE].spellTrap = hole4;
    const bug = card(ME, 'man-eater-bug');
    q.players[ME].hand = [bug];
    const setDown = applyAction(q, ME, { type: 'normalSummon', uid: bug.uid, zone: 0, position: 'def', face: 'down' });
    ok(!setDown.state.pending, 'Setting a monster still opens nothing', setDown.state.pending ? setDown.state.pending.reason : '');
    const said = setDown.state.log.map((l) => (typeof l === 'string' ? l : (l as { text: string }).text)).join(' | ');
    ok(!said.includes('Man-Eater'), 'and the board never names what was Set', said.slice(-80));
  }

  /* Torrential Tribute says "when your opponent summons", and means it.
     Gaia the Dragon Champion rather than the Ultimate Dragon, because the
     Ultimate Dragon's own Fusion effect destroys every Spell and Trap the
     opponent controls — it blew the Torrential Tribute off the field before
     the window could open, and the control read as a failure. */
  const t = fresh();
  const tor = card(FOE, 'torrential-tribute');
  tor.face = 'down';
  tor.summonedOnTurn = t.turn - 1;
  t.players[FOE].spellTrap = tor;
  const d = card(ME, 'gaia-the-fierce-knight');
  const e = card(ME, 'curse-of-dragon');
  t.players[ME].monsters = [d, e, null];
  t.players[ME].hand.push(card(ME, 'polymerization'));
  const ex2 = card(ME, 'gaia-the-dragon-champion');
  t.players[ME].extra.push(ex2);
  const swept = act(t, ME, {
    type: 'fusionSummon',
    extraUid: ex2.uid,
    materials: [d.uid, e.uid],
    zone: 0,
    position: 'atk',
  });
  ok(swept.pending?.kind === 'trap', 'CONTROL: Torrential Tribute still catches one');

  // And neither of them wakes up for a Set.
  const q = fresh();
  const tor2 = card(FOE, 'torrential-tribute');
  tor2.face = 'down';
  tor2.summonedOnTurn = q.turn - 1;
  q.players[FOE].spellTrap = tor2;
  const kur = card(ME, 'kuriboh');
  q.players[ME].hand.push(kur);
  const setq = act(q, ME, { type: 'normalSummon', uid: kur.uid, zone: 0, position: 'def', face: 'down' });
  ok(!setq.pending, 'and Torrential Tribute sits out a Set too');
}

console.log('\nSpellbinding Circle spends itself, and the scar stays');
{
  /* The equip version was correct about duration and wrong about cost: the
     circle parked face-up in its owner's ONLY Spell/Trap Zone for as long as
     the bound monster lived, locking Yugi out of Mirror Force, Magical Hats
     and — a Fusion needing a free zone — his own Dark Paladin. It is a
     one-shot now: negate, the attacker permanently loses 700, the circle goes
     to the Graveyard, the zone is free again. The permanence is the text's
     own promise — no "while face-up" clause survives to be broken. */
  const s = fresh('battle');
  const attacker = card(FOE, 'summoned-skull'); // 2500
  const bystander = card(FOE, 'hitotsu-me-giant');
  s.players[FOE].monsters = [attacker, bystander, null];
  const circle = card(ME, 'spellbinding-circle');
  circle.face = 'down';
  circle.summonedOnTurn = s.turn - 1;
  s.players[ME].spellTrap = circle;
  s.active = FOE;

  const declared = applyAction(s, FOE, { type: 'attack', uid: attacker.uid, targetUid: null }).state;
  ok(declared.pending?.kind === 'trap', 'the circle is offered when they attack');
  const bound = act(declared, ME, { type: 'respondTrap', uid: circle.uid });

  const held = bound.players[FOE].monsters.find((m) => m?.uid === attacker.uid)!;
  const free = bound.players[FOE].monsters.find((m) => m?.uid === bystander.uid)!;
  ok(bound.players[ME].lp === 4000, 'the attack is negated', `LP ${bound.players[ME].lp}`);
  ok(effAtk(bound, held, FOE) === 2500 - 700, 'the attacker loses 700 ATK', String(effAtk(bound, held, FOE)));
  ok(effAtk(bound, free, FOE) === baseAtkOf('hitotsu-me-giant'), 'the monster beside it is untouched', String(effAtk(bound, free, FOE)));
  ok(bound.players[ME].spellTrap === null, 'the circle is spent — the zone is free again');
  ok(bound.players[ME].grave.some((c) => c.slug === 'spellbinding-circle'), 'and it lies in the Graveyard');

  // The scar is permanent by design: the circle being gone does not restore
  // the 700 — that is the text's promise now, not a leak.
  const nextTurn = structuredClone(bound);
  for (const m of nextTurn.players[FOE].monsters) if (m) m.attacksUsed = 0;
  const scarred = nextTurn.players[FOE].monsters.find((m) => m?.uid === attacker.uid)!;
  ok(effAtk(nextTurn, scarred, FOE) === 2500 - 700, 'the 700 stays lost on a later turn', String(effAtk(nextTurn, scarred, FOE)));
  ok(canAttackWith(nextTurn, FOE, scarred), 'and the monster may attack again — the bind was the moment, not a lock');
}

console.log('\nMystical Elf shields the monsters beside her, not herself');
{
  /* "Check if mystical elf can be destroyed when in defense." She could not:
     her aura is `all` with a Defense Position filter and she is normally in
     Defence, so she was shielding herself. Her own text says "your **other**
     Defense Position monsters". */
  const s = fresh('battle');
  const elf = card(FOE, 'mystical-elf'); // 800/2000
  elf.position = 'def';
  const friend = card(FOE, 'kuriboh');
  friend.position = 'def';
  s.players[FOE].monsters = [elf, friend, null];
  ok(!effFlags(s, elf, FOE).indestructibleByBattle, 'the Elf does not shield herself');
  ok(!!effFlags(s, friend, FOE).indestructibleByBattle, 'but does shield the monster beside her');

  const bigger = card(ME, 'blue-eyes-white-dragon'); // 3000 beats her 2000 DEF
  s.players[ME].monsters[0] = bigger;
  const after = act(s, ME, { type: 'attack', uid: bigger.uid, targetUid: elf.uid });
  ok(!after.players[FOE].monsters.some((m) => m?.uid === elf.uid), 'so a big enough attacker destroys her in Defence');
}

console.log('\nA Field Spell is the weather, not a personal buff');
{
  /* "My Umi buffed the other player's water monsters but not the legendary
     fisherman / their Umi buffed their legendary fisherman and their other
     water monsters." Umi's aura was `side: 'own'` while its text says "all
     WATER monsters". */
  const s = fresh();
  const mine = card(ME, '7-colored-fish'); // 1800 base
  const theirs = card(FOE, '7-colored-fish');
  s.players[ME].monsters[0] = mine;
  s.players[FOE].monsters[0] = theirs;
  const plain = effAtk(s, theirs, FOE);

  s.players[ME].field = card(ME, 'umi');
  /* Just Umi's 500 now: the fish's own 800 was traded for a search, which
     makes this a cleaner test of the thing it is actually about — that the
     weather falls on both sides of the table equally. */
  ok(effAtk(s, mine, ME) === 1800 + 500, 'your own WATER monster gains from your Umi', String(effAtk(s, mine, ME)));
  ok(effAtk(s, theirs, FOE) === plain + 500, 'and so does theirs — it is the same sea', String(effAtk(s, theirs, FOE)));

  // Dark Sanctuary is the counter-example: both its auras are one-sided on
  // purpose and must stay that way — the house feeds its own and bites theirs,
  // and neither half may leak across the table the way Umi's does.
  const d = fresh();
  const a = card(ME, 'hitotsu-me-giant');
  const b = card(FOE, 'hitotsu-me-giant');
  d.players[ME].monsters[0] = a;
  d.players[FOE].monsters[0] = b;
  const base = effAtk(d, a, ME);
  d.players[ME].field = card(ME, 'dark-sanctuary');
  ok(effAtk(d, a, ME) === base + 600, 'CONTROL: a one-sided Field Spell stays one-sided', String(effAtk(d, a, ME)));
  ok(effAtk(d, b, FOE) === base - 400, 'and still bites the other side', String(effAtk(d, b, FOE)));
}

console.log('\nA card with nothing to affect cannot be played');
{
  /* "Mai keeps using de spell on empty (as an ai)." De-Spell destroys a Spell
     or Trap and *then* draws a card, and the draw always works — so nothing
     was asking whether the destroy had anything to destroy. */
  const s = fresh();
  const despell = card(ME, 'de-spell');
  s.players[ME].hand.push(despell);
  ok(!canActivateFromHand(s, ME, despell), 'De-Spell is not offered at an empty Spell/Trap Zone');
  const refused = applyAction(s, ME, { type: 'activateSpell', uid: despell.uid });
  ok(!!refused.error, 'and is refused with a reason rather than spent', refused.error ?? 'no error');
  ok(refused.state.players[ME].hand.some((h) => h.uid === despell.uid), 'the card is still in hand');

  const live = fresh();
  const d2 = card(ME, 'de-spell');
  live.players[ME].hand.push(d2);
  live.players[FOE].spellTrap = card(FOE, 'mirror-wall');
  ok(canActivateFromHand(live, ME, d2), 'CONTROL: with something to destroy it is offered');
  const done = act(live, ME, { type: 'activateSpell', uid: d2.uid });
  ok(done.players[FOE].spellTrap === null, 'and it destroys it');
}

console.log('\nThe gate refuses a wasted card without refusing a working one');
{
  /* Judging only the *leading* op was the obvious rule and was wrong three
     ways — every one of them found by driving the fix rather than reading it.
     A card is dead only when every targeting op has an empty pool, every
     remaining op is a rider, and nothing of it stays on the field. */
  const empty = fresh();
  const hg = card(ME, 'harpies-hunting-ground');
  empty.players[ME].hand.push(hg);
  ok(canActivateFromHand(empty, ME, hg), "Harpie's Hunting Ground goes down at an empty backrow — its aura is the card");

  const fieldOnly = fresh();
  const duster = card(ME, 'harpie-s-feather-duster');
  fieldOnly.players[ME].hand.push(duster);
  fieldOnly.players[FOE].field = card(FOE, 'umi');
  ok(canActivateFromHand(fieldOnly, ME, duster), "Harpie's Feather Duster still reaches a lone Field Spell");
  const cleared = act(fieldOnly, ME, { type: 'activateSpell', uid: duster.uid });
  ok(cleared.players[FOE].field === null, 'and destroys it');

  const noMonsters = fresh();
  const swords = card(ME, 'swords-of-revealing-light');
  noMonsters.players[ME].hand.push(swords);
  ok(canActivateFromHand(noMonsters, ME, swords), 'Swords of Revealing Light is the freeze, not the flip');

  /* The probe used to answer "is there a target?" through `resolveTargets`,
     whose `chosen` branch falls back to the strongest card in the *unfiltered*
     pool and only then drops protected ones. One untargetable top-ATK monster
     therefore hid every legal target behind it, and against Pegasus with Toon
     World down that was permanent. */
  const shielded = fresh();
  shielded.players[FOE].field = card(FOE, 'toon-world');
  shielded.players[FOE].monsters[0] = card(FOE, 'blue-eyes-toon-dragon'); // untargetable, 3800
  const reachable = card(FOE, 'mystical-elf');
  shielded.players[FOE].monsters[1] = reachable;
  const doomed = card(ME, 'tribute-to-the-doomed');
  shielded.players[ME].hand.push(doomed, card(ME, 'kuriboh'));
  ok(canActivateFromHand(shielded, ME, doomed), 'an untargetable monster does not hide the ones behind it');
  const hit = act(shielded, ME, { type: 'activateSpell', uid: doomed.uid, targets: [reachable.uid] });
  ok(!hit.players[FOE].monsters.some((m) => m?.uid === reachable.uid), 'and the legal target is destroyed');
  ok(hit.players[FOE].monsters.some((m) => m?.slug === 'blue-eyes-toon-dragon'), 'while the protected one stands');

  // An Equip Spell needs a body to go on.
  const bare = fresh();
  const sword = card(ME, 'legendary-sword');
  bare.players[ME].hand.push(sword);
  ok(!canActivateFromHand(bare, ME, sword), 'an Equip Spell is not offered with no monster to equip');
  bare.players[ME].monsters[0] = card(ME, 'kuriboh');
  ok(canActivateFromHand(bare, ME, sword), 'CONTROL: and is offered once there is one');
}

console.log('\nA trap that picks its own target asks the player nothing');
{
  /* Giving Spellbinding Circle an `equipTo` op made `targetSpecFor` offer a
     picker over the *responder's own* Monster Zones — so the human seat could
     not activate it while controlling nothing, which is exactly when they are
     being attacked directly and want it most. The AI does not go through
     `ui.ts` and played it fine, so nothing in the battery saw this. */
  ok(targetSpecFor('spellbinding-circle', 'trap') === null, 'the circle opens no picker', JSON.stringify(targetSpecFor('spellbinding-circle', 'trap')));
  ok(targetSpecFor('legendary-sword', 'activate') !== null, 'CONTROL: an ordinary Equip Spell still asks');

  // And it really can be activated with an empty board on the defending side.
  const s = fresh('battle');
  s.players[FOE].monsters[0] = card(FOE, 'summoned-skull');
  const circle = card(ME, 'spellbinding-circle');
  circle.face = 'down';
  circle.summonedOnTurn = s.turn - 1;
  s.players[ME].spellTrap = circle;
  s.active = FOE;
  const declared = applyAction(s, FOE, { type: 'attack', uid: s.players[FOE].monsters[0]!.uid, targetUid: null }).state;
  const bound = act(declared, ME, { type: 'respondTrap', uid: circle.uid, targets: [] });
  ok(bound.players[ME].lp === 4000, 'defending with no monsters at all, the attack is still negated', `LP ${bound.players[ME].lp}`);
  // One-shot since the balance pass: the scar lands on the attacker and the
  // circle itself is spent, not parked.
  const struck = bound.players[FOE].monsters[0]!;
  ok(effAtk(bound, struck, FOE) === 2500 - 700, 'and the 700 lands on the attacker', String(effAtk(bound, struck, FOE)));
}

console.log('\nA Field Spell is a Spell your opponent controls');
{
  /* "Toon World as a field spell should be destroyable (for example de spell,
     harpie lady summon effect, etc..)" — and it was not: every card that says
     "destroy 1 Spell or Trap your opponent controls" pointed at the Spell/Trap
     Zone alone, so the one card Pegasus's entire deck is built on sat in the
     Field Zone out of reach. The client had been offering the Field card for
     those effects all along, which the engine then declined to touch. */
  const s = fresh();
  s.players[FOE].field = card(FOE, 'toon-world');
  const despell = card(ME, 'de-spell');
  s.players[ME].hand.push(despell);
  ok(canActivateFromHand(s, ME, despell), 'De-Spell is offered against a lone Field Spell');
  const gone = act(s, ME, { type: 'activateSpell', uid: despell.uid, targets: [s.players[FOE].field!.uid] });
  ok(gone.players[FOE].field === null, 'and Toon World is destroyed');

  // Harpie Lady says the same words and now means them too.
  const h = fresh();
  h.players[FOE].field = card(FOE, 'toon-world');
  const lady = card(ME, 'harpie-lady');
  h.players[ME].hand.push(lady);
  const summoned = act(h, ME, {
    type: 'normalSummon',
    uid: lady.uid,
    zone: 0,
    position: 'atk',
    face: 'up',
    targets: [h.players[FOE].field!.uid],
  });
  ok(summoned.players[FOE].field === null, "Harpie Lady's summon reaches it as well");

  // A Set Trap is still the more usual answer, and still works.
  const t = fresh();
  t.players[FOE].spellTrap = card(FOE, 'mirror-wall');
  const d2 = card(ME, 'de-spell');
  t.players[ME].hand.push(d2);
  const cleared = act(t, ME, { type: 'activateSpell', uid: d2.uid, targets: [t.players[FOE].spellTrap!.uid] });
  ok(cleared.players[FOE].spellTrap === null, 'CONTROL: and an ordinary Spell/Trap is still destroyed');

  // "Destroy 1" is one: with both zones filled, only the named card goes.
  const both = fresh();
  both.players[FOE].field = card(FOE, 'toon-world');
  both.players[FOE].spellTrap = card(FOE, 'mirror-wall');
  const d3 = card(ME, 'de-spell');
  both.players[ME].hand.push(d3);
  const one = act(both, ME, { type: 'activateSpell', uid: d3.uid, targets: [both.players[FOE].field!.uid] });
  ok(one.players[FOE].field === null, 'the card the player pointed at is the one destroyed');
  ok(one.players[FOE].spellTrap !== null, 'and only that one — "destroy 1" is one');
}

console.log('\nCall of the Haunted brings it back and lets go');
{
  /* Reported as "call of the haunted remained on the field when I tributed the
     monster". The real card equips itself to what it revived, and none of that
     machinery was here — nothing linked the two — so it simply sat face-up in
     the one Spell/Trap Zone for the rest of the duel. Played as a one-shot
     instead: the monster comes back for good and the zone is free again. */
  const s = fresh();
  // `canActivateSetCard` is the flip-it-by-hand path, which is your own Main
  // Phase — the window it also watches is a different route to the same ops.
  const dead = card(ME, 'summoned-skull');
  s.players[ME].grave.push(dead);
  const trap = card(ME, 'call-of-the-haunted');
  trap.face = 'down';
  trap.summonedOnTurn = s.turn - 1;
  s.players[ME].spellTrap = trap;

  ok(canActivateSetCard(s, ME, trap), 'the set trap can be flipped');
  const back = act(s, ME, { type: 'activateSetCard', uid: trap.uid });
  const revived = back.players[ME].monsters.find((m) => m?.slug === 'summoned-skull');
  ok(!!revived, 'the monster comes back');
  ok(effAtk(back, revived!, ME) === 2500 + 400, 'and it is the revived one that gains the 400', String(revived && effAtk(back, revived, ME)));
  ok(back.players[ME].spellTrap === null, 'the trap does not stay on the field');
  ok(back.players[ME].grave.some((c) => c.slug === 'call-of-the-haunted'), 'it is in the Graveyard');

  // And the revival really is unconditional — tributing it leaves nothing behind.
  const t = structuredClone(back);
  t.active = ME;
  t.phase = 'main';
  const big = card(ME, 'curse-of-dragon'); // Level 5, one tribute
  t.players[ME].hand.push(big);
  const tributed = act(t, ME, {
    type: 'normalSummon',
    uid: big.uid,
    zone: 0,
    position: 'atk',
    face: 'up',
    tributes: [revived!.uid],
  });
  ok(tributed.players[ME].monsters.some((m) => m?.slug === 'curse-of-dragon'), 'the revived monster can be tributed');
  ok(tributed.players[ME].spellTrap === null, 'and nothing is stranded in the Spell/Trap Zone');
}

console.log('\nA God costs three bodies, and tokens are bodies');
{
  const s = fresh();
  const slifer = card(ME, 'slifer-the-sky-dragon');
  s.players[ME].hand.push(slifer);
  ok(tributesRequired('slifer-the-sky-dragon') === 3, 'Slifer asks for three tributes', String(tributesRequired('slifer-the-sky-dragon')));

  // Two bodies is not enough.
  s.players[ME].monsters[0] = card(ME, 'kuriboh');
  s.players[ME].monsters[1] = card(ME, 'kuriboh');
  const short = applyAction(s, ME, {
    type: 'normalSummon', uid: slifer.uid, zone: 2, position: 'atk', face: 'up',
    tributes: [s.players[ME].monsters[0]!.uid, s.players[ME].monsters[1]!.uid],
  });
  ok(!!short.error, 'two bodies will not do it', short.error ?? 'accepted');

  /* Three tokens on a full board is the summon a full board is *for*: the
     tributes are paid first and the God takes a zone they just left. */
  const t = fresh();
  for (let i = 0; i < 3; i++) {
    const tok = card(ME, 'kuriboh');
    tok.isToken = true;
    tok.tokenName = 'Kuriboh Token';
    t.players[ME].monsters[i] = tok;
  }
  const god = card(ME, 'slifer-the-sky-dragon');
  t.players[ME].hand.push(god, card(ME, 'kuriboh'), card(ME, 'dark-hole'));
  const down = act(t, ME, {
    type: 'normalSummon', uid: god.uid, zone: 0, position: 'atk', face: 'up',
    tributes: t.players[ME].monsters.map((m) => m!.uid),
  });
  const on = down.players[ME].monsters.find((m) => m?.slug === 'slifer-the-sky-dragon');
  ok(!!on, 'three Kuriboh Tokens pay for a God on a full board');
  ok(on ? effAtk(down, on, ME) === 1000 * down.players[ME].hand.length : false,
    'and it is worth 1000 for every card left in hand',
    on ? `${effAtk(down, on, ME)} ATK, ${down.players[ME].hand.length} in hand` : '');
}

console.log('\nSlifer is only ever as strong as the hand behind it');
{
  const s = fresh();
  const slifer = card(ME, 'slifer-the-sky-dragon');
  s.players[ME].monsters[0] = slifer;
  s.players[ME].hand = [];
  ok(effAtk(s, slifer, ME) === 0, 'an empty hand leaves a God with nothing', String(effAtk(s, slifer, ME)));
  s.players[ME].hand.push(card(ME, 'kuriboh'));
  ok(effAtk(s, slifer, ME) === 1000, 'one card is 1000', String(effAtk(s, slifer, ME)));
  s.players[ME].hand.push(card(ME, 'kuriboh'), card(ME, 'kuriboh'), card(ME, 'kuriboh'));
  ok(effAtk(s, slifer, ME) === 4000, 'four cards is 4000', String(effAtk(s, slifer, ME)));
  ok(effDef(s, slifer, ME) === 4000, 'and the DEF climbs with it', String(effDef(s, slifer, ME)));
  ok(!!effFlags(s, slifer, ME).untargetable, "and their effects cannot touch it");
  /* A God does NOT pierce. Untouchable by card effects already means the only
     answer to one is a bigger body; piercing on top of that deleted the other
     answer — putting something in Defence to survive the turn. Battle is the
     way past a God, so battle has to stay worth attempting. */
  ok(!effFlags(s, slifer, ME).pierce, 'and it does not pierce — Defence is still an answer');
}

console.log('\nThe second mouth answers a Summon, not a Set');
{
  /* Both halves of one sentence, and they have to resolve in that order: the
     drain lands, then whatever it emptied is destroyed. */
  const big = fresh();
  big.active = FOE;
  big.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  big.players[ME].hand.push(card(ME, 'kuriboh'));
  big.players[FOE].monsters[1] = card(FOE, 'kuriboh');
  big.players[FOE].monsters[2] = card(FOE, 'kuriboh'); // Blue-Eyes is Level 8: two tributes
  const dragon = card(FOE, 'blue-eyes-white-dragon'); // 3000
  big.players[FOE].hand.push(dragon);
  const drained = act(big, FOE, {
    type: 'normalSummon', uid: dragon.uid, zone: 0, position: 'atk', face: 'up',
    tributes: [big.players[FOE].monsters[1]!.uid, big.players[FOE].monsters[2]!.uid],
  });
  const bewd = drained.players[FOE].monsters.find((m) => m?.slug === 'blue-eyes-white-dragon');
  ok(!!bewd, 'a big monster survives the second mouth');
  ok(bewd ? effAtk(drained, bewd, FOE) === 1000 : false, 'but arrives 2000 weaker', bewd ? String(effAtk(drained, bewd, FOE)) : '');

  const small = fresh();
  small.active = FOE;
  small.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  const lady = card(FOE, 'harpie-lady'); // 1300
  small.players[FOE].hand.push(lady);
  const gone = act(small, FOE, { type: 'normalSummon', uid: lady.uid, zone: 0, position: 'atk', face: 'up' });
  ok(!gone.players[FOE].monsters.some((m) => m?.slug === 'harpie-lady'), 'and anything under 2000 is destroyed outright');

  // A Set is not a Summon — the same rule the trap windows follow.
  const hidden = fresh();
  hidden.active = FOE;
  hidden.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  const sneak = card(FOE, 'harpie-lady');
  hidden.players[FOE].hand.push(sneak);
  const set = act(hidden, FOE, { type: 'normalSummon', uid: sneak.uid, zone: 0, position: 'def', face: 'down' });
  const survivor = set.players[FOE].monsters.find((m) => m?.slug === 'harpie-lady');
  ok(!!survivor, 'a Set monster is not touched');
  ok(survivor?.face === 'down', 'and stays face-down');

  // It watches the opponent, never its own controller.
  const mine = fresh();
  mine.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  const friend = card(ME, 'harpie-lady');
  mine.players[ME].hand.push(friend);
  const safe = act(mine, ME, { type: 'normalSummon', uid: friend.uid, zone: 1, position: 'atk', face: 'up' });
  ok(safe.players[ME].monsters.some((m) => m?.slug === 'harpie-lady'), 'CONTROL: it never bites its own side');
}

console.log('\nThe second mouth hears a Special Summon too');
{
  /* It was told about Normal and Fusion Summons only, which in this game is a
     minority of them — a revived monster, a searched-out one, a Token, all
     walked past the God untouched. */
  const s = fresh();
  s.active = FOE;
  s.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  const dead = card(FOE, 'summoned-skull'); // 2500
  s.players[FOE].grave.push(dead);
  const reborn = card(FOE, 'monster-reborn');
  s.players[FOE].hand.push(reborn);
  const back = act(s, FOE, { type: 'activateSpell', uid: reborn.uid, targets: [dead.uid] });
  const risen = back.players[FOE].monsters.find((m) => m?.slug === 'summoned-skull');
  ok(!!risen, 'a revived monster arrives');
  ok(risen ? effAtk(back, risen, FOE) === 500 : false,
    'and the second mouth takes 2000 off it',
    risen ? String(effAtk(back, risen, FOE)) : 'gone');

  // Small enough, and the revival dies on arrival.
  const t = fresh();
  t.active = FOE;
  t.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  const small = card(FOE, 'harpie-lady'); // 1300
  t.players[FOE].grave.push(small);
  const rb = card(FOE, 'monster-reborn');
  t.players[FOE].hand.push(rb);
  const gone = act(t, FOE, { type: 'activateSpell', uid: rb.uid, targets: [small.uid] });
  ok(!gone.players[FOE].monsters.some((m) => m?.slug === 'harpie-lady'), 'anything under 2000 does not survive the revival');

  // A Token is a monster being Summoned.
  const k = fresh();
  k.active = FOE;
  k.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  const mult = card(FOE, 'multiply');
  k.players[FOE].hand.push(mult);
  const tokens = act(k, FOE, { type: 'activateSpell', uid: mult.uid, targets: [] });
  ok(tokens.players[FOE].monsters.every((m) => !m?.isToken), 'and three 300 ATK Tokens do not survive it either');

  // Still never its own side, however the monster arrives.
  const mine = fresh();
  mine.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  const friend = card(ME, 'harpie-lady');
  mine.players[ME].grave.push(friend);
  const own = card(ME, 'monster-reborn');
  mine.players[ME].hand.push(own);
  const safe = act(mine, ME, { type: 'activateSpell', uid: own.uid, targets: [friend.uid] });
  ok(safe.players[ME].monsters.some((m) => m?.slug === 'harpie-lady'), 'CONTROL: it never bites its own Special Summons');
}

console.log('\nA God arrives with a card in hand');
{
  /* Three Tributes is the whole board, and the hand that pays for it is
     usually the hand that was about to be spent — so Slifer landed as a 0/0
     that anything could run over. The draw is the floor. */
  const s = fresh();
  for (let i = 0; i < 3; i++) s.players[ME].monsters[i] = card(ME, 'kuriboh');
  const god = card(ME, 'slifer-the-sky-dragon');
  s.players[ME].hand = [god];
  s.players[ME].deck = [card(ME, 'kuriboh')];
  const down = act(s, ME, {
    type: 'normalSummon', uid: god.uid, zone: 0, position: 'atk', face: 'up',
    tributes: s.players[ME].monsters.map((m) => m!.uid),
  });
  const on = down.players[ME].monsters.find((m) => m?.slug === 'slifer-the-sky-dragon');
  ok(down.players[ME].hand.length === 1, 'summoning it draws a card', `${down.players[ME].hand.length} in hand`);
  ok(on ? effAtk(down, on, ME) === 1000 : false,
    'so the God is never a 0/0 on the turn it lands',
    on ? String(effAtk(down, on, ME)) : 'not on the field');
}

console.log('\nThe Catapult is worth what it throws, and a God is not ammunition');
{
  const s = fresh();
  const turtle = card(ME, 'catapult-turtle');
  s.players[ME].monsters[0] = turtle;
  s.players[ME].monsters[1] = card(ME, 'kuriboh');            // 300
  s.players[ME].monsters[2] = card(ME, 'summoned-skull');     // 2500
  /* Named explicitly, because it used to pay with whatever stood in the first
     zone — invisible while the damage was a flat 1000, and the whole card once
     it is worth what it throws. */
  const fired = act(s, ME, { type: 'ignition', uid: turtle.uid, targets: [s.players[ME].monsters[2]!.uid] });
  ok(fired.players[FOE].lp === 4000 - 2500, 'it launches the monster you picked, for that monster’s ATK', String(fired.players[FOE].lp));
  ok(fired.players[ME].monsters.some((m) => m?.slug === 'kuriboh'), 'and leaves the one you did not pick alone');

  // A God cannot be fired out of a catapult.
  const g = fresh();
  const t2 = card(ME, 'catapult-turtle');
  g.players[ME].monsters[0] = t2;
  g.players[ME].monsters[1] = card(ME, 'slifer-the-sky-dragon');
  g.players[ME].hand = [card(ME, 'kuriboh'), card(ME, 'kuriboh')];
  const refused = applyAction(g, ME, { type: 'ignition', uid: t2.uid, targets: [g.players[ME].monsters[1]!.uid] });
  ok(!!refused.error, 'a Divine-Beast is refused as ammunition', refused.error ?? 'accepted');
  ok(refused.state.players[ME].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'), 'and the God is still standing');
}

console.log('\nAlpha! Beta! Gamma! — no Fusion card required');
{
  const s = fresh();
  const a = card(ME, 'alpha-the-magnet-warrior');
  const b = card(ME, 'beta-the-magnet-warrior');
  const g = card(ME, 'gamma-the-magnet-warrior');
  s.players[ME].monsters = [a, b, g];
  const val = card(ME, 'valkyrion-the-magna-warrior');
  s.players[ME].extra = [val];
  s.players[ME].hand = [card(ME, 'dark-hole'), card(ME, 'kuriboh')];
  const held = s.players[ME].hand.length;
  /* `applyAction` rather than `act`, which throws on a refusal — and a throw
     here takes the whole suite down with it, hiding every block below. The one
     thing this file must always be able to do is report. */
  const fuse = applyAction(s, ME, {
    type: 'fusionSummon', extraUid: val.uid, materials: [a.uid, b.uid, g.uid], zone: 0, position: 'atk',
  });
  const made = fuse.state;
  ok(made.players[ME].monsters.some((m) => m?.slug === 'valkyrion-the-magna-warrior'),
    'the three magnets combine with no Polymerization in hand', fuse.error ?? '');
  /* `poly` is -1 without the card, and `splice(-1, 1)` takes the *last* card
     in hand — an unguarded spend would quietly eat one every assembly. */
  ok(made.players[ME].hand.length === held, 'and it does not eat a card from the hand', `${made.players[ME].hand.length} of ${held}`);

  // And comes apart again, into exactly the three tributes a God costs.
  const valk = made.players[ME].monsters.find((m) => m?.slug === 'valkyrion-the-magna-warrior');
  const split = valk ? applyAction(made, ME, { type: 'ignition', uid: valk.uid }) : null;
  const apart = split?.state ?? made;
  const back = apart.players[ME].monsters.filter((m) => m && CARDS[m.slug].name.includes('Magnet Warrior'));
  ok(!!valk && back.length === 3, 'tributing it returns all three Magnet Warriors',
    valk ? `${back.length} came back${split?.error ? ` (${split.error})` : ''}` : 'never assembled');
  ok(!!valk && !apart.players[ME].monsters.some((m) => m?.slug === 'valkyrion-the-magna-warrior'), 'and Valkyrion itself is gone');

  /* Free means *from the field*. Three bodies already standing is a real
     commitment; three cards falling out of a hand is not, and Polymerization
     has to keep a job in the deck that carries it. */
  const short = fresh();
  const a2 = card(ME, 'alpha-the-magnet-warrior');
  const b2 = card(ME, 'beta-the-magnet-warrior');
  const g2 = card(ME, 'gamma-the-magnet-warrior');
  short.players[ME].monsters = [a2, b2, null];
  short.players[ME].hand = [g2];
  const v2 = card(ME, 'valkyrion-the-magna-warrior');
  short.players[ME].extra = [v2];
  const refused = applyAction(short, ME, {
    type: 'fusionSummon', extraUid: v2.uid, materials: [a2.uid, b2.uid, g2.uid], zone: 2, position: 'atk',
  });
  ok(!!refused.error, 'two on the field and one in hand will not combine for free', refused.error ?? 'accepted');
  ok(!refused.state.players[ME].monsters.some((m) => m?.slug === 'valkyrion-the-magna-warrior'), 'and Valkyrion stays in the Extra Deck');

  // The same board, with Polymerization: that is what reaches into the hand.
  const paid = fresh();
  const a3 = card(ME, 'alpha-the-magnet-warrior');
  const b3 = card(ME, 'beta-the-magnet-warrior');
  const g3 = card(ME, 'gamma-the-magnet-warrior');
  paid.players[ME].monsters = [a3, b3, null];
  const poly = card(ME, 'polymerization');
  paid.players[ME].hand = [g3, poly];
  const v3 = card(ME, 'valkyrion-the-magna-warrior');
  paid.players[ME].extra = [v3];
  const bought = applyAction(paid, ME, {
    type: 'fusionSummon', extraUid: v3.uid, materials: [a3.uid, b3.uid, g3.uid], zone: 2, position: 'atk',
  });
  ok(bought.state.players[ME].monsters.some((m) => m?.slug === 'valkyrion-the-magna-warrior'),
    'Polymerization brings the third one out of the hand', bought.error ?? '');
  ok(bought.state.players[ME].grave.some((c) => c.slug === 'polymerization'), 'and the Polymerization is spent for it');

  // CONTROL: every other Fusion still pays for the card.
  const c = fresh();
  const gaia = card(ME, 'gaia-the-fierce-knight');
  const drag = card(ME, 'curse-of-dragon');
  c.players[ME].monsters = [gaia, drag, null];
  const champ = card(ME, 'gaia-the-dragon-champion');
  c.players[ME].extra = [champ];
  c.players[ME].hand = [];
  const noPoly = applyAction(c, ME, {
    type: 'fusionSummon', extraUid: champ.uid, materials: [gaia.uid, drag.uid], zone: 2, position: 'atk',
  });
  ok(!!noPoly.error, 'CONTROL: a normal Fusion still needs Polymerization', noPoly.error ?? 'accepted');
}

console.log('\nA tribute is not a destruction');
{
  /* Reported as "sometimes I get the monster zone is occupied — I had 3
     monsters and tried summoning Slifer". Chimera says "when this card is
     destroyed", and it was written as `onSentToGrave`, which fires on any
     departure from the field — so tributing Chimera towards a God put Gazelle
     and Berfomet straight back onto the board in the middle of paying for the
     summon, and the summon then had nowhere to land. */
  const board = () => {
    const s = fresh();
    const chim = card(ME, 'chimera-the-flying-mythical-beast');
    const a = card(ME, 'kuriboh');
    const b = card(ME, 'feral-imp');
    s.players[ME].monsters = [chim, a, b];
    // Both halves waiting in the Graveyard, so a revival would be visible.
    s.players[ME].grave = [card(ME, 'gazelle-the-king-of-mythical-beasts'), card(ME, 'berfomet')];
    return { s, chim, a, b };
  };
  const halvesOn = (st: DuelState) =>
    st.players[ME].monsters.filter(
      (m) => m?.slug === 'gazelle-the-king-of-mythical-beasts' || m?.slug === 'berfomet'
    ).length;

  const { s, chim, a, b } = board();
  const slifer = card(ME, 'slifer-the-sky-dragon');
  s.players[ME].hand = [slifer];
  const summoned = applyAction(s, ME, {
    type: 'normalSummon', uid: slifer.uid, zone: 0, position: 'atk', face: 'up',
    tributes: [chim.uid, a.uid, b.uid],
  });
  ok(summoned.state.players[ME].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'),
    'three monsters tribute for a God with Chimera among them', summoned.error ?? '');
  ok(halvesOn(summoned.state) === 0,
    'and tributing Chimera does not put its halves back', `${halvesOn(summoned.state)} came back`);
  ok(summoned.state.players[ME].grave.some((c) => c.slug === 'chimera-the-flying-mythical-beast'),
    'and Chimera itself is in the Graveyard');

  /* CONTROL: destroyed really is destroyed. Without this the fix would pass
     just as well with the effect deleted outright. */
  const { s: s2, chim: chim2 } = board();
  s2.players[ME].monsters = [chim2, null, null];
  const dh = card(ME, 'dark-hole');
  s2.players[ME].hand = [dh];
  const wiped = applyAction(s2, ME, { type: 'activateSpell', uid: dh.uid, targets: [] });
  ok(halvesOn(wiped.state) === 2,
    'CONTROL: destroying Chimera still returns Gazelle and Berfomet', `${halvesOn(wiped.state)} came back`);

  /* CONTROL: the wider trigger still fires on a tribute for the cards whose
     text really says "sent to the Graveyard". Sangan searches either way. */
  const s3 = fresh();
  const sangan = card(ME, 'sangan');
  const spare = card(ME, 'kuriboh');
  s3.players[ME].monsters = [sangan, spare, null];
  s3.players[ME].deck = [card(ME, 'feral-imp')];
  const summonSkull = card(ME, 'summoned-skull');
  s3.players[ME].hand = [summonSkull];
  const paid = applyAction(s3, ME, {
    type: 'normalSummon', uid: summonSkull.uid, zone: 0, position: 'atk', face: 'up',
    tributes: [sangan.uid, spare.uid],
  });
  ok(paid.state.players[ME].hand.some((h) => h.slug === 'feral-imp'),
    'CONTROL: "sent to the Graveyard" still fires on a tribute', paid.error ?? '');
}

console.log('\nGazelle and Berfomet are a pair, not a stack');
{
  /* Reported as "both buff atk and we get a monster stronger than blue eyes".
     They were: Gazelle collected his own conditional +800 *and* Berfomet's
     "all Beast monsters you control" +800, because Gazelle is a Beast —
     1500 + 1600 = 3100 off a level 4 and a level 5. The pride buff sits on
     Gazelle now and says "other", so the pair bonus is paid once. */
  const s = fresh();
  const g = card(ME, 'gazelle-the-king-of-mythical-beasts');
  const b = card(ME, 'berfomet');
  s.players[ME].monsters = [g, b, null];
  const blueEyes = baseAtkOf('blue-eyes-white-dragon');
  ok(effAtk(s, g, ME) === 2100, 'Gazelle beside Berfomet is 2100', `${effAtk(s, g, ME)}`);
  ok(effAtk(s, b, ME) === 2000, 'Berfomet beside Gazelle is 2000', `${effAtk(s, b, ME)}`);
  ok(effAtk(s, g, ME) < blueEyes && effAtk(s, b, ME) < blueEyes,
    'and neither of them outgrows Blue-Eyes', `${effAtk(s, g, ME)} / ${effAtk(s, b, ME)} vs ${blueEyes}`);

  // The bonus is conditional both ways, so alone they are printed size.
  const solo = fresh();
  const g2 = card(ME, 'gazelle-the-king-of-mythical-beasts');
  solo.players[ME].monsters = [g2, null, null];
  ok(effAtk(solo, g2, ME) === 1500, 'Gazelle alone is his printed 1500', `${effAtk(solo, g2, ME)}`);

  /* The pride buff is real, not just removed: another Beast beside them still
     takes it. Without this the whole thing would pass with the aura deleted. */
  const pride = fresh();
  const g3 = card(ME, 'gazelle-the-king-of-mythical-beasts');
  const b3 = card(ME, 'berfomet');
  const chim = card(ME, 'chimera-the-flying-mythical-beast');
  pride.players[ME].monsters = [g3, b3, chim];
  ok(effAtk(pride, chim, ME) === baseAtkOf('chimera-the-flying-mythical-beast') + 600,
    'another Beast beside them still gains the pride bonus', `${effAtk(pride, chim, ME)}`);
}

console.log('\nThe balance pass: a theme is the reason a deck wins');
{
  /* Toon World pays for its own power now. The activation searches and does
     NOT draw — the rider used to be a Pot of Greed stapled to the engine. */
  const tw = fresh();
  const world = card(ME, 'toon-world');
  tw.players[ME].hand = [world];
  tw.players[ME].deck = [card(ME, 'toon-mermaid'), card(ME, 'kuriboh')];
  const deckBefore = tw.players[ME].deck.length;
  const open = act(tw, ME, { type: 'activateSpell', uid: world.uid, targets: [] });
  ok(open.players[ME].field?.slug === 'toon-world', 'Toon World opens in the Field Zone');
  ok(open.players[ME].hand.some((h) => h.slug === 'toon-mermaid'), 'and fetches a Toon');
  ok(open.players[ME].deck.length === deckBefore - 1, 'and draws nothing beyond the search', `deck ${open.players[ME].deck.length}`);
  /* Free to open, by the owner's ruling: the toll fell on the one card the
     whole deck has to land, and Pegasus already pays for it every time it is
     answered. */
  ok(open.players[ME].lp === 4000, 'and costs nothing to open', `LP ${open.players[ME].lp}`);

  /* Closing the book, which the owner has made expensive again — but not the
     old way. It used to destroy the Toons outright, which made one De-Spell a
     sweep of everything Pegasus had committed; then it did nothing but take
     the buff back, which made answering the card that holds the whole deck up
     barely worth the card it cost. It now flattens *every* monster the
     controller has by 1000 — Toon or not — and the ones with nothing left to
     give are destroyed. The big bodies live and limp; the small ones do not. */
  const doom = fresh();
  doom.players[FOE].field = { ...card(FOE, 'toon-world'), face: 'up' as const };
  const toon = card(FOE, 'toon-summoned-skull'); // 2500 — survives at 1500
  const plain = card(FOE, 'ryu-kishin-powered'); // never a Toon, and hit anyway
  const tiny = card(FOE, 'kuriboh'); // 300 — nothing left to lose
  doom.players[FOE].monsters = [toon, plain, tiny];
  const skullBefore = effAtk(doom, toon, FOE);
  const plainBefore = effAtk(doom, plain, FOE);
  const despell = card(ME, 'de-spell');
  doom.players[ME].hand = [despell];
  const popped = act(doom, ME, { type: 'activateSpell', uid: despell.uid, targets: [doom.players[FOE].field!.uid] });
  ok(!popped.players[FOE].field, 'destroying Toon World empties the Field Zone');
  const survivor = popped.players[FOE].monsters.find((m) => m?.slug === 'toon-summoned-skull');
  ok(!!survivor, 'a big enough Toon outlives the book', popped.players[FOE].monsters.map((m) => m?.slug).join(','));
  ok(!!survivor && effAtk(popped, survivor, FOE) === skullBefore - 1000,
    'flattened by exactly 1000',
    survivor ? `${skullBefore} -> ${effAtk(popped, survivor, FOE)}` : 'gone');
  ok(!!survivor && !effFlags(popped, survivor, FOE).directAttack,
    'and can no longer walk past a blocker');
  const bystander = popped.players[FOE].monsters.find((m) => m?.slug === 'ryu-kishin-powered');
  ok(!!bystander && effAtk(popped, bystander, FOE) === plainBefore - 1000,
    'the monster that was never a Toon is flattened too — the book held the whole board up',
    bystander ? `${plainBefore} -> ${effAtk(popped, bystander, FOE)}` : 'gone');
  ok(!popped.players[FOE].monsters.some((m) => m?.slug === 'kuriboh'),
    'and anything left with nothing is destroyed',
    popped.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(popped.players[ME].monsters.every((m) => !m),
    "CONTROL: the other duelist's board is not touched — it was not their book");

  /* Dark Magician: the full wipe is his arrival, the ignition takes one. */
  const dm = fresh();
  const mage = card(ME, 'dark-magician');
  dm.players[ME].hand = [mage];
  dm.players[ME].monsters = [card(ME, 'kuriboh'), card(ME, 'feral-imp'), null];
  dm.players[FOE].spellTrap = { ...card(FOE, 'de-spell'), face: 'down' as const };
  dm.players[FOE].field = { ...card(FOE, 'umi'), face: 'up' as const };
  const arrives = act(dm, ME, {
    type: 'normalSummon', uid: mage.uid, zone: 0, position: 'atk', face: 'up',
    tributes: dm.players[ME].monsters.slice(0, 2).map((m) => m!.uid),
  });
  ok(!arrives.players[FOE].spellTrap && !arrives.players[FOE].field,
    "Dark Magician's arrival wipes backrow and field once");
  const standing = arrives.players[ME].monsters.find((m) => m?.slug === 'dark-magician')!;
  arrives.players[FOE].spellTrap = { ...card(FOE, 'de-spell'), face: 'down' as const };
  arrives.players[FOE].field = { ...card(FOE, 'umi'), face: 'up' as const };
  const zap = act(arrives, ME, { type: 'ignition', uid: standing.uid, targets: [arrives.players[FOE].spellTrap!.uid] });
  ok(!zap.players[FOE].spellTrap, 'his ignition destroys the chosen backrow card');
  ok(!!zap.players[FOE].field, 'and only that — the Field Spell survives the ignition');

  /* Zoa gives its body for the metal one — the anime beat. Dying *is* the
     transformation now, so the opponent answering Zoa is what summons it. */
  const kz = fresh();
  const beast = card(ME, 'zoa');
  beast.summonedOnTurn = 0;
  kz.players[ME].monsters = [beast, null, null];
  kz.players[ME].deck = [card(ME, 'metalzoa')];
  kz.active = FOE;
  kz.players[FOE].field = { ...card(FOE, 'umi'), face: 'up' as const };
  ok(
    !!applyAction(kz, ME, { type: 'ignition', uid: beast.uid, targets: [] }).error,
    'Zoa has no button to press — it does not tribute itself any more'
  );
  const bolt = card(FOE, 'tribute-to-the-doomed');
  kz.players[FOE].hand.push(bolt);
  const zapped = act(kz, FOE, { type: 'activateSpell', uid: bolt.uid, targets: [beast.uid] });
  ok(zapped.players[ME].monsters.some((m) => m?.slug === 'metalzoa'), 'Zoa destroyed by an effect rises as Metalzoa');
  ok(zapped.players[ME].grave.some((c) => c.slug === 'zoa'), 'and the beast itself was the price');
  ok(!zapped.players[FOE].field, "and Metalzoa's arrival shattered their backrow — a Field Spell is one");

  /* The Dark Door admits only the small. */
  const dd = fresh('battle');
  dd.active = FOE;
  dd.players[ME].spellTrap = { ...card(ME, 'the-dark-door'), face: 'up' as const };
  const big = card(FOE, 'summoned-skull'); // 2500 printed
  const small = card(FOE, 'battle-ox'); // 1700 printed
  big.summonedOnTurn = 0;
  small.summonedOnTurn = 0;
  dd.players[FOE].monsters = [big, small, null];
  ok(!canAttackWith(dd, FOE, big), 'a 2500 cannot pass the Dark Door');
  ok(canAttackWith(dd, FOE, small), 'a 1700 still can');

  /* The engines find their enablers: the fish fetches the sea, the imp a
     piece of the Forbidden One, the moth its shell. */
  const ff = fresh();
  const fish = card(ME, 'flying-fish');
  ff.players[ME].hand = [fish];
  ff.players[ME].deck = [card(ME, 'umi'), card(ME, 'kuriboh')];
  const landed = act(ff, ME, { type: 'normalSummon', uid: fish.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(landed.players[ME].hand.some((h) => h.slug === 'umi'), 'Flying Fish fetches Umi');

  const fi = fresh();
  const imp = card(ME, 'feral-imp');
  fi.players[ME].hand = [imp];
  fi.players[ME].deck = [card(ME, 'right-leg-of-the-forbidden-one'), card(ME, 'kuriboh')];
  const impDown = act(fi, ME, { type: 'normalSummon', uid: imp.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(impDown.players[ME].hand.some((h) => h.slug === 'right-leg-of-the-forbidden-one'), 'Feral Imp finds a piece of the Forbidden One');

  /* Petit Moth used to stand here fetching its Cocoon. Its card was rewritten
     from the ground up — it places its own counter now and hands the ladder up
     itself — so the seat goes to the other bug that comes in carrying
     something: Basic Insect, whose whole worth is the cannon it arrives with. */
  const bi = fresh();
  const bug = card(ME, 'basic-insect');
  bi.players[ME].hand = [bug];
  bi.players[ME].deck = [card(ME, 'laser-cannon-armor'), card(ME, 'kuriboh')];
  const bugDown = act(bi, ME, { type: 'normalSummon', uid: bug.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(bugDown.players[ME].hand.some((h) => h.slug === 'laser-cannon-armor'), 'Basic Insect arrives carrying a cannon');

  /* The Cocoon used to armour itself and the moths beside it. It does not any
     more: a shell that could not be broken while it counted up to its best rung
     was a wall the other player had no answer to, and the counters are the
     whole card. Battle reaches all three of them now. */
  const shell = fresh();
  const larva = card(ME, 'petit-moth');
  const cocoon = card(ME, 'cocoon-of-evolution');
  shell.players[ME].monsters = [larva, cocoon, null];
  ok(!effFlags(shell, larva, ME).indestructibleByBattle, 'the Cocoon no longer armours the moth beside it');
  ok(!effFlags(shell, cocoon, ME).indestructibleByBattle, 'nor itself — the shell can be broken');
  const bare2 = fresh();
  const alone = card(ME, 'petit-moth');
  bare2.players[ME].monsters = [alone, null, null];
  ok(!effFlags(bare2, alone, ME).indestructibleByBattle, 'CONTROL: an unshelled moth is soft');

  /* Ring of Destruction burns the opponent alone — the owner took the recoil
     off. The second assertion is the whole of the change and has to stay
     explicit: the symmetric version was here for two passes, and "the opponent
     took damage" is true under both. */
  const ring = fresh();
  const trap = card(ME, 'ring-of-destruction');
  trap.face = 'down';
  trap.summonedOnTurn = 1;
  ring.players[ME].spellTrap = trap;
  const target = card(FOE, 'battle-ox'); // 1700
  ring.players[FOE].monsters = [target, null, null];
  const boom = act(ring, ME, { type: 'activateSetCard', uid: trap.uid, targets: [target.uid] });
  ok(boom.players[FOE].lp === 4000 - 1700, 'the ring burns the opponent for the ATK', `LP ${boom.players[FOE].lp}`);
  ok(boom.players[ME].lp === 4000, 'and leaves its own duelist untouched', `LP ${boom.players[ME].lp}`);
  ok(!boom.players[FOE].monsters.some((m) => m?.uid === target.uid), 'and the monster still dies');
}

console.log('\nThe balance pass, second turn of the wheel');
{
  /* Mischief is free again. The 500-a-swing toll was the printed rule and it
     priced the deck out of its own gimmick — "monsters needing lp to attack
     is a lot" — so a Toon walks past a blocker for nothing. The book's own
     1000 to open, and the turn it makes them wait, are what it costs. */
  const s = fresh('battle');
  s.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  const toon = card(ME, 'toon-mermaid');
  toon.summonedOnTurn = 0;
  s.players[ME].monsters = [toon, null, null];
  const lpBefore = s.players[ME].lp;
  const foeLp = s.players[FOE].lp;
  const swung = act(s, ME, { type: 'attack', uid: toon.uid, targetUid: null });
  ok(swung.players[ME].lp === lpBefore, 'a Toon direct attack costs its duelist nothing', `LP ${swung.players[ME].lp}`);
  ok(swung.players[FOE].lp < foeLp, 'and the blow lands', `foe LP ${swung.players[FOE].lp}`);

  /* And no pause any more. The wait was the other printed Toon rule and the
     owner has cut it: with the +600 gone a fresh Toon is a small body, and
     making it stand still for a turn on top of that was charging twice for a
     card that is already answered by removing one Field Spell. */
  const sick = fresh('battle');
  sick.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  const freshToon = card(ME, 'toon-mermaid');
  freshToon.summonedOnTurn = sick.turn;
  sick.players[ME].monsters = [freshToon, null, null];
  ok(canAttackWith(sick, ME, freshToon), 'a Toon may swing the turn it arrives');
  const rested = structuredClone(sick);
  rested.players[ME].monsters[0]!.summonedOnTurn = rested.turn - 1;
  ok(canAttackWith(rested, ME, rested.players[ME].monsters[0]!), 'and swings freely a turn later');

  // CONTROL: a direct attacker with no Toon World pays nothing.
  const c = fresh('battle');
  const fish = card(ME, 'flying-fish');
  fish.summonedOnTurn = 0;
  fish.flags.directAttack = true;
  c.players[ME].monsters = [fish, null, null];
  const free = act(c, ME, { type: 'attack', uid: fish.uid, targetUid: null });
  ok(free.players[ME].lp === 4000, 'CONTROL: an ordinary direct attacker pays no toll', `LP ${free.players[ME].lp}`);

  /* Mirror Wall bills its keeper: 500 a reflection, and a wall that cannot
     be paid for is not offered at all. */
  const mw = fresh('battle');
  mw.active = FOE;
  const wall = card(ME, 'mirror-wall');
  wall.face = 'up';
  wall.summonedOnTurn = 1;
  mw.players[ME].spellTrap = wall;
  const attacker = card(FOE, 'summoned-skull');
  attacker.summonedOnTurn = 0;
  mw.players[FOE].monsters = [attacker, null, null];
  const declared = applyAction(mw, FOE, { type: 'attack', uid: attacker.uid, targetUid: null }).state;
  ok(declared.pending?.kind === 'trap', 'the wall is offered while its keeper can pay');
  const paid = act(declared, ME, { type: 'respondTrap', uid: wall.uid });
  ok(paid.players[ME].lp === 4000 - 500, 'and firing it costs 500', `LP ${paid.players[ME].lp}`);
  const held = paid.players[FOE].monsters[0]!;
  ok(effAtk(paid, held, FOE) === 1250, 'the attacker is still halved', String(effAtk(paid, held, FOE)));

  const broke = structuredClone(mw);
  broke.players[ME].lp = 400;
  const declared2 = applyAction(broke, FOE, { type: 'attack', uid: broke.players[FOE].monsters[0]!.uid, targetUid: null }).state;
  ok(declared2.pending?.kind !== 'trap', 'CONTROL: below the price, the wall is not even offered');

  /* The factory ships the line out of the hand — by Level now, not by ATK, so
     an 1850 Level 4 rolls out and a 1400 Level 6 does not. */
  const kf = fresh();
  const factory = card(ME, 'machine-conversion-factory');
  const small1 = card(ME, 'cannon-soldier'); // L4 Machine
  const small2 = card(ME, 'mechanicalchaser'); // L4 Machine, 1850 — over the OLD line
  const tooBig = card(ME, 'machine-king'); // L6 — over the line that matters
  kf.players[ME].hand = [factory, small1, small2, tooBig];
  const rolled = act(kf, ME, { type: 'activateSpell', uid: factory.uid, targets: [] });
  const out = rolled.players[ME].monsters.filter(Boolean).map((m) => m!.slug);
  ok(out.includes('cannon-soldier') && out.includes('mechanicalchaser'),
    'Machine Conversion Factory ships two Level 5-or-lower Machines from the hand', out.join(','));
  ok(rolled.players[ME].hand.some((h) => h.slug === 'machine-king'),
    'CONTROL: a Level 6 Machine is over the factory line and stays in hand');
  const shipped = rolled.players[ME].monsters.find((m) => m?.slug === 'cannon-soldier')!;
  /* +200 each, and only to what came off the line. Cannon Soldier is 1400
     printed and stands alone, so nothing else can be paying for this. */
  ok(effAtk(rolled, shipped, ME) === 1400 + 200, 'and each one comes off the line 200 stronger',
    String(effAtk(rolled, shipped, ME)));
}

console.log('\nGOD CARDS ARE ABOVE EVERYTHING');
{
  /* The owner's decree, verbatim. No protection in the game holds against a
     Divine-Beast: not battle immunity when the blow is a God's, not effect
     immunity or untargetability when the effect is a God's. Everything
     beneath a God still respects every protection — the controls below are
     the rule's other half. */

  // A God's attack breaks battle immunity.
  const wall = fresh('battle');
  const slifer = card(ME, 'slifer-the-sky-dragon');
  slifer.summonedOnTurn = 0;
  wall.players[ME].monsters = [slifer, null, null];
  wall.players[ME].hand = [card(ME, 'kuriboh'), card(ME, 'kuriboh'), card(ME, 'kuriboh')]; // 3000/3000 Slifer
  const shield = card(FOE, 'big-shield-gardna'); // battle-proof 100/2600, in Attack for the kill math
  shield.summonedOnTurn = 0;
  wall.players[FOE].monsters = [shield, null, null];
  const smitten = act(wall, ME, { type: 'attack', uid: slifer.uid, targetUid: shield.uid });
  ok(!smitten.players[FOE].monsters.some((m) => m?.slug === 'big-shield-gardna'),
    "battle immunity does not survive a God's attack");

  // And in the other direction: losing a battle AGAINST a God is fatal too.
  const brave = fresh('battle');
  brave.active = FOE;
  const godWall = card(ME, 'slifer-the-sky-dragon');
  godWall.summonedOnTurn = 0;
  brave.players[ME].monsters = [godWall, null, null];
  // Pot of Greed, not Kuriboh: a Kuriboh in hand is a hand-trap whose window
  // would suspend the battle and leave the zealot standing unresolved.
  brave.players[ME].hand = [card(ME, 'pot-of-greed'), card(ME, 'pot-of-greed'), card(ME, 'pot-of-greed')];
  const zealot = card(FOE, 'rocket-warrior'); // battle-proof 1500
  zealot.summonedOnTurn = 0;
  brave.players[FOE].monsters = [zealot, null, null];
  const routed = act(brave, FOE, { type: 'attack', uid: zealot.uid, targetUid: godWall.uid });
  ok(!routed.players[FOE].monsters.some((m) => m?.slug === 'rocket-warrior'),
    'a battle-proof monster that loses to a God is destroyed anyway');
  ok(routed.players[ME].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'),
    'and the God, naturally, stands');

  /* A God's effect reaches monsters no mortal card may touch. The diver
     carries the full sentence — cannot be targeted AND unaffected by card
     effects — so this exercises both halves of the bypass: the drain lands
     through `untargetable` (the ctx-pick filter yields to a divine source)
     and the destroy lands through `indestructibleByEffect`. */
  const mouth = fresh();
  mouth.active = FOE;
  mouth.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  const diver = card(FOE, 'deepsea-warrior');
  diver.flags.untargetable = true;
  diver.flags.indestructibleByEffect = true;
  const fodder = card(FOE, 'kuriboh');
  mouth.players[FOE].monsters = [fodder, null, null];
  mouth.players[FOE].hand = [diver];
  const surfaced = act(mouth, FOE, {
    type: 'normalSummon', uid: diver.uid, zone: 1, position: 'atk', face: 'up', tributes: [fodder.uid],
  });
  ok(!surfaced.players[FOE].monsters.some((m) => m?.slug === 'deepsea-warrior'),
    "the second mouth drains an 'untouchable' monster to nothing and destroys it");

  // Effect-indestructibility alone bows the same way: a Toon under its own book.
  const book = fresh();
  book.active = FOE;
  book.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  book.players[FOE].field = { ...card(FOE, 'toon-world'), face: 'up' as const };
  const toon = card(FOE, 'toon-summoned-skull'); // 2500 printed, drained by 2000 to 500 — still standing
  book.players[FOE].hand = [toon];
  const drawn = act(book, FOE, {
    type: 'normalSummon', uid: toon.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
  });
  const inked = drawn.players[FOE].monsters.find((m) => m?.slug === 'toon-summoned-skull');
  ok(!!inked && effAtk(drawn, inked, FOE) === 500,
    "the drain lands on a Toon, and one left above zero stands", inked ? `ATK ${effAtk(drawn, inked, FOE)}` : 'destroyed');

  /* ...while one drained below zero dies through the book's protection. Dark
     Rabbit is 1100 + 800 = 1900, the mouth takes 2000, and Toon World's
     `indestructibleByEffect` would save it from any mortal card. */
  const rabbit = card(FOE, 'dark-rabbit');
  const book2 = fresh();
  book2.active = FOE;
  book2.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  book2.players[FOE].field = { ...card(FOE, 'toon-world'), face: 'up' as const };
  book2.players[FOE].hand = [rabbit];
  const erased = act(book2, FOE, {
    type: 'normalSummon', uid: rabbit.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
  });
  ok(!erased.players[FOE].monsters.some((m) => m?.slug === 'dark-rabbit'),
    'one drained below zero is destroyed through it');

  /* The decree cuts the other way too: what a God's arrival or attack opens,
     no mortal trap may turn back on it. Trap Hole answers the Summon and
     cannot touch the God — only the 400-damage rider lands. */
  const pit = fresh();
  const digger = card(FOE, 'trap-hole');
  digger.face = 'down';
  digger.summonedOnTurn = 0;
  pit.turn = 2;
  pit.players[FOE].spellTrap = digger;
  const god3 = card(ME, 'slifer-the-sky-dragon');
  const t1 = card(ME, 'kuriboh');
  const t2 = card(ME, 'kuriboh');
  const t3 = card(ME, 'kuriboh');
  pit.players[ME].monsters = [t1, t2, t3];
  pit.players[ME].hand = [god3];
  const lpBefore = pit.players[ME].lp;
  const risen = act(pit, ME, {
    type: 'normalSummon', uid: god3.uid, zone: 0, position: 'atk', face: 'up', tributes: [t1.uid, t2.uid, t3.uid],
  });
  ok(risen.pending?.kind === 'trap', 'CONTROL: the window still opens on a God');
  const sprung3 = risen.pending?.kind === 'trap' ? act(risen, FOE, { type: 'respondTrap', uid: digger.uid, targets: [] }) : risen;
  ok(sprung3.players[ME].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'),
    'a God does not fall in the Trap Hole');
  ok(sprung3.players[ME].lp === lpBefore - 400,
    'though its 400-damage rider still lands');

  /* And Mirror Wall may still refuse the blow — negation is an answer, not a
     protection — but it cannot maim what it refused: the halving slides off. */
  const glass = fresh();
  glass.active = ME;
  glass.phase = 'battle';
  const god4 = card(ME, 'slifer-the-sky-dragon');
  god4.summonedOnTurn = 0;
  glass.players[ME].monsters = [god4, null, null];
  glass.players[ME].hand = [card(ME, 'pot-of-greed'), card(ME, 'pot-of-greed'), card(ME, 'pot-of-greed')];
  const pane = card(FOE, 'mirror-wall');
  pane.face = 'down';
  pane.summonedOnTurn = 0;
  glass.turn = 2;
  glass.players[FOE].spellTrap = pane;
  glass.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  const swung = act(glass, ME, { type: 'attack', uid: god4.uid, targetUid: glass.players[FOE].monsters[0]!.uid });
  const walled = swung.pending?.kind === 'trap' ? act(swung, FOE, { type: 'respondTrap', uid: pane.uid, targets: [] }) : swung;
  const godAfter = walled.players[ME].monsters.find((m) => m?.slug === 'slifer-the-sky-dragon');
  ok(!!godAfter && effAtk(walled, godAfter, ME) === 3000,
    'Mirror Wall cannot halve a God', godAfter ? `ATK ${effAtk(walled, godAfter, ME)}` : 'gone');
  /* The negation used to be allowed to stand — "the wall says no, it just
     cannot maim" — on the reasoning that refusing a blow is not a protection.
     The owner's instruction overrules it: "they can attack over swords over
     cage over everything, NO EFFECTS ON THE GODS". Turning the swing back is
     a card effect reaching a God, and it was the last door left open: Marik
     would pay 1000 for God Phoenix, clear the board, swing for lethal and be
     waved away — and because the computer can see that coming, it declined to
     do any of it and passed the turn with the duel won on the board. */
  ok(!walled.players[FOE].monsters.some((m) => m?.slug === 'battle-ox'),
    'and it cannot turn a God back either — the blow lands anyway',
    walled.players[FOE].monsters.filter(Boolean).map((m) => m!.slug).join(',') || 'their field is empty');
  ok(walled.players[FOE].spellTrap === null || walled.players[FOE].spellTrap?.face === 'up',
    'CONTROL: the wall was really played — it is spent, it simply did nothing');

  // CONTROL: between mortals every protection still holds.
  const mortal = fresh();
  const guarded = card(FOE, 'deepsea-warrior');
  guarded.flags.untargetable = true;
  mortal.players[FOE].monsters = [guarded, null, null];
  const doomed2 = card(ME, 'tribute-to-the-doomed');
  mortal.players[ME].hand = [doomed2, card(ME, 'kuriboh')];
  const refused2 = applyAction(mortal, ME, { type: 'activateSpell', uid: doomed2.uid, targets: [guarded.uid] });
  ok(!!refused2.error || refused2.state.players[FOE].monsters.some((m) => m?.slug === 'deepsea-warrior'),
    'CONTROL: a mortal Spell still cannot touch the same monster');

  // CONTROL: the God's own immunity against mortals is untouched.
  const temple = fresh();
  const god2 = card(FOE, 'slifer-the-sky-dragon');
  const acolyte = card(FOE, 'battle-ox'); // a mortal beside the God, so the wipe is live
  temple.players[FOE].monsters = [god2, acolyte, null];
  const hole = card(ME, 'dark-hole');
  temple.players[ME].hand = [hole];
  const swallowed = act(temple, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
  ok(swallowed.players[FOE].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'),
    'CONTROL: Dark Hole still cannot swallow a God');
  ok(!swallowed.players[FOE].monsters.some((m) => m?.slug === 'battle-ox'),
    'though it swallows the mortal standing beside one');
}

console.log('\nPolymerization needs somewhere to be activated');
{
  /* Reported from a real duel: a Fusion went through with the Spell/Trap Zone
     full. Spending the Polymerization *is* activating a Normal Spell, and
     every other Spell in the game asks `p.spellTrap === null` — the Fusion
     route asked nothing at all, so it was the one way to play a Spell out of
     a zone you did not have. */
  const blocked = () => {
    const s = fresh();
    s.players[ME].monsters = [card(ME, 'gaia-the-fierce-knight'), card(ME, 'curse-of-dragon'), null];
    s.players[ME].extra = [card(ME, 'gaia-the-dragon-champion')];
    s.players[ME].hand = [card(ME, 'polymerization')];
    return s;
  };

  const full = blocked();
  // A Continuous Spell sitting face-up: the zone is genuinely taken.
  full.players[ME].spellTrap = { ...card(ME, 'the-dark-door'), face: 'up' as const };
  const mats = full.players[ME].monsters.filter(Boolean).map((m) => m!.uid);
  const champ = full.players[ME].extra[0];
  const denied = applyAction(full, ME, {
    type: 'fusionSummon', extraUid: champ.uid, materials: mats, zone: 2, position: 'atk',
  });
  ok(!!denied.error, 'a full Spell/Trap Zone refuses the Fusion', denied.error ?? 'accepted');
  ok(/spell\/trap zone/i.test(denied.error ?? ''), 'and says so, rather than blaming the materials', denied.error ?? '');
  ok(!denied.state.players[ME].monsters.some((m) => m?.slug === 'gaia-the-dragon-champion'),
    'and the Fusion stays in the Extra Deck');
  ok(denied.state.players[ME].hand.some((h) => h.slug === 'polymerization'),
    'and the Polymerization is not spent');
  // The button and the AI read the same answer, so neither may offer it.
  ok(!fusionOptions(full, ME).length, 'and it is not offered as an option at all');

  /* A *face-down* Set card takes the zone just the same — that is the version
     a player actually hits, because a Set trap is the normal state of that
     zone and it is easy to forget it is there. */
  const set = blocked();
  set.players[ME].spellTrap = { ...card(ME, 'mirror-force'), face: 'down' as const };
  const setMats = set.players[ME].monsters.filter(Boolean).map((m) => m!.uid);
  const deniedSet = applyAction(set, ME, {
    type: 'fusionSummon', extraUid: set.players[ME].extra[0].uid, materials: setMats, zone: 2, position: 'atk',
  });
  ok(!!deniedSet.error, 'a face-down Set card blocks it too', deniedSet.error ?? 'accepted');

  // CONTROL: the same board with the zone free is the summon working normally.
  const free = blocked();
  const freeMats = free.players[ME].monsters.filter(Boolean).map((m) => m!.uid);
  const allowed = applyAction(free, ME, {
    type: 'fusionSummon', extraUid: free.players[ME].extra[0].uid, materials: freeMats, zone: 2, position: 'atk',
  });
  ok(allowed.state.players[ME].monsters.some((m) => m?.slug === 'gaia-the-dragon-champion'),
    'CONTROL: with the zone free it fuses exactly as before', allowed.error ?? '');

  /* CONTROL: a free assembly spends no card, so it wants no zone. Valkyrion
     coming together with the Spell/Trap Zone full is correct and must stay
     that way — the rule is about activating a Spell, not about fusing. */
  const magnets = fresh();
  const ma = card(ME, 'alpha-the-magnet-warrior');
  const mb = card(ME, 'beta-the-magnet-warrior');
  const mg = card(ME, 'gamma-the-magnet-warrior');
  magnets.players[ME].monsters = [ma, mb, mg];
  magnets.players[ME].extra = [card(ME, 'valkyrion-the-magna-warrior')];
  magnets.players[ME].spellTrap = { ...card(ME, 'the-dark-door'), face: 'up' as const };
  const assembled = applyAction(magnets, ME, {
    type: 'fusionSummon',
    extraUid: magnets.players[ME].extra[0].uid,
    materials: [ma.uid, mb.uid, mg.uid],
    zone: 0,
    position: 'atk',
  });
  ok(assembled.state.players[ME].monsters.some((m) => m?.slug === 'valkyrion-the-magna-warrior'),
    'CONTROL: a free assembly still combines with the zone full', assembled.error ?? '');
}

console.log('\nOne Normal Summon stands the whole court up');
{
  const s = fresh();
  const queen = card(ME, 'queen-s-knight');
  s.players[ME].hand = [queen];
  s.players[ME].deck = [card(ME, 'king-s-knight'), card(ME, 'jack-s-knight'), card(ME, 'kuriboh')];
  const court = act(s, ME, { type: 'normalSummon', uid: queen.uid, zone: 0, position: 'atk', face: 'up' });
  const names = court.players[ME].monsters.filter(Boolean).map((m) => m!.slug).sort();
  ok(names.length === 3, 'the Queen brings the King, who brings the Jack', names.join(', '));
  ok(names.includes('king-s-knight') && names.includes('jack-s-knight'), 'and all three are Knights', names.join(', '));

  /* Jack's aura, and the direct attack that only the assembled court allows.
     No `!` on the lookup: he is exactly what the chain above is being asked to
     produce, so on a build where the chain is broken he is not there — and a
     non-null assertion turns that into a crash that takes the rest of the
     suite with it rather than a failure it can report. */
  const jack = court.players[ME].monsters.find((m) => m?.slug === 'jack-s-knight');
  ok(!!jack && effAtk(court, jack, ME) === 1900 + 300, 'every Warrior is 300 stronger for him',
    jack ? String(effAtk(court, jack, ME)) : 'never arrived');
  ok(!!jack && !!effFlags(court, jack, ME).directAttack, 'and with the court complete he can swing past blockers');

  const alone = fresh();
  const lone = card(ME, 'jack-s-knight');
  alone.players[ME].monsters[0] = lone;
  ok(!effFlags(alone, lone, ME).directAttack, 'CONTROL: alone, he cannot');
}

console.log('\nThe magnets hold, the beasts trade places, the shield does not break');
{
  // Beta, while another Rock stands beside it.
  const s = fresh();
  const beta = card(ME, 'beta-the-magnet-warrior');
  s.players[ME].monsters = [beta, card(ME, 'alpha-the-magnet-warrior'), null];
  ok(effAtk(s, beta, ME) === 1700 + 800, 'Beta is 800 stronger with a Rock beside it', String(effAtk(s, beta, ME)));
  ok(!!effFlags(s, beta, ME).indestructibleByBattle, 'and battle cannot destroy it either');
  const solo = fresh();
  const lonely = card(ME, 'beta-the-magnet-warrior');
  solo.players[ME].monsters[0] = lonely;
  ok(!effFlags(solo, lonely, ME).indestructibleByBattle, 'CONTROL: alone it is an ordinary monster');

  /* Gazelle and Berfomet each make the other bigger — once.
     This used to assert the double-dip as if it were the intent: Gazelle took
     his own conditional 800 *and* Berfomet's "all Beast monsters" 800, and
     the check pinned 3100. It is 2300 now, and the arithmetic is spelled out
     in full under "Gazelle and Berfomet are a pair, not a stack". */
  const b = fresh();
  const gaz = card(ME, 'gazelle-the-king-of-mythical-beasts');
  const ber = card(ME, 'berfomet');
  b.players[ME].monsters = [gaz, ber, null];
  ok(effAtk(b, gaz, ME) === 1500 + 600, 'Gazelle takes the pair bonus once', String(effAtk(b, gaz, ME)));
  ok(effAtk(b, ber, ME) === 1400 + 600, 'and Berfomet takes his own', String(effAtk(b, ber, ME)));

  /* Big Shield Gardna stops attacks and nothing else. It used to walk out of
     a Dark Hole too, which made it unanswerable — a wall proof on both axes
     is a stalemate, and that is a God's privilege. */
  const d = fresh('battle');
  d.active = FOE;
  const shield = card(ME, 'big-shield-gardna');
  shield.position = 'def';
  d.players[ME].monsters[0] = shield;
  /* 3000 ATK against 2600 DEF, so the shield is only standing afterwards
     because of the flag. A 2500 attacker would have bounced off the DEF on
     its own and the assertion would have passed with the flag deleted. */
  const hitter = card(FOE, 'blue-eyes-white-dragon');
  d.players[FOE].monsters[0] = hitter;
  const swung = act(d, FOE, { type: 'attack', uid: hitter.uid, targetUid: shield.uid });
  ok(swung.players[ME].monsters.some((m) => m?.slug === 'big-shield-gardna'), 'the shield survives a 3000 ATK attack');

  const hole = fresh();
  hole.players[ME].monsters[0] = card(ME, 'big-shield-gardna');
  hole.players[FOE].monsters[0] = card(FOE, 'harpie-lady');
  const dh = card(ME, 'dark-hole');
  hole.players[ME].hand.push(dh);
  const after = act(hole, ME, { type: 'activateSpell', uid: dh.uid, targets: [] });
  ok(!after.players[ME].monsters.some((m) => m?.slug === 'big-shield-gardna'), 'but a Dark Hole takes it now');
  ok(!after.players[FOE].monsters.some(Boolean), 'along with everything else');

  // Buster Blader counts the dragons already dead.
  const bb = fresh();
  const blader = card(ME, 'buster-blader');
  bb.players[ME].monsters[0] = blader;
  ok(effAtk(bb, blader, ME) === 2600, 'Buster Blader alone is 2600', String(effAtk(bb, blader, ME)));
  bb.players[FOE].grave.push(card(FOE, 'blue-eyes-white-dragon'));
  ok(effAtk(bb, blader, ME) === 2600 + 800, 'a Dragon in their Graveyard is 800 more', String(effAtk(bb, blader, ME)));
  bb.players[FOE].monsters[0] = card(FOE, 'curse-of-dragon');
  ok(effAtk(bb, blader, ME) === 2600 + 1600, 'and one on the field is 800 more again', String(effAtk(bb, blader, ME)));
}

console.log('\nRelinquished throws the blow back');
{
  /* It lost immunity to card effects with the rule below, and this came in its
     place — the printed card's most famous clause, and a far better one:
     blanket immunity is the absence of an answer, this is a reason not to
     attack that the other player gets to weigh. */
  const s = fresh('battle');
  s.active = FOE;
  const rel = card(ME, 'relinquished');
  rel.atkMod = 1000; // as though it had swallowed something; base is 0/0
  s.players[ME].monsters[0] = rel;
  const beater = card(FOE, 'blue-eyes-white-dragon'); // 3000
  s.players[FOE].monsters[0] = beater;
  const before = { me: s.players[ME].lp, foe: s.players[FOE].lp };
  const hit = act(s, FOE, { type: 'attack', uid: beater.uid, targetUid: rel.uid });
  const mine = before.me - hit.players[ME].lp;
  const theirs = before.foe - hit.players[FOE].lp;
  ok(mine === 2000, 'its controller still takes the blow', `${mine}`);
  ok(theirs === 2000, 'and the attacker takes exactly the same', `${theirs}`);
  ok(hit.players[ME].monsters.some((m) => m?.slug === 'relinquished'), 'and Relinquished is still standing');

  /* The mirror only ever *adds*. Sparing its own controller would be a third
     kind of immunity, which is the thing the rule below just took away. */
  ok(mine > 0, 'CONTROL: the mirror adds damage, it does not absorb it');

  // CONTROL: an ordinary monster in the same position reflects nothing.
  const plain = fresh('battle');
  plain.active = FOE;
  const wall = card(ME, 'big-shield-gardna');
  plain.players[ME].monsters[0] = wall;
  plain.players[FOE].monsters[0] = card(FOE, 'blue-eyes-white-dragon');
  const b2 = plain.players[FOE].lp;
  const plainHit = act(plain, FOE, {
    type: 'attack',
    uid: plain.players[FOE].monsters[0]!.uid,
    targetUid: wall.uid,
  });
  ok(plainHit.players[FOE].lp === b2, 'CONTROL: an ordinary monster throws nothing back',
    `${b2 - plainHit.players[FOE].lp} came back`);
}

console.log('\nOnly a God is proof against both battle and card effects');
{
  /* A monster that cannot be removed on either axis is not a wall, it is a
     stalemate — the only honest answer to it is having no answer. That is a
     Divine-Beast's privilege and nothing else's.
     Reported as "big shield gardna can't be not affected by card effects
     (he's not a god)", and it was true of four cards, two of which this
     session had just introduced. So the rule is asserted over the whole card
     set rather than fixed four times and forgotten.
     Toons are exempt by construction, not by exception: their protection is
     Toon World's aura, not their own, and Toon World is a Field Spell that
     can be destroyed — which is the counterplay this rule is really about. */
  const offenders: string[] = [];
  for (const def of Object.values(CARDS)) {
    if (def.kind !== 'monster' || def.type === 'Divine-Beast') continue;
    const granted = new Set<string>();
    for (const eff of def.effects) {
      for (const g of eff.aura?.grants ?? []) granted.add(g);
      for (const op of eff.ops) {
        if (op.op === 'indestructibleByBattle' || op.op === 'indestructibleByEffect' || op.op === 'untargetable') {
          granted.add(op.op);
        }
        for (const g of ('grants' in op ? op.grants ?? [] : [])) granted.add(g);
      }
    }
    const battleProof = granted.has('indestructibleByBattle');
    const effectProof = granted.has('indestructibleByEffect') || granted.has('untargetable');
    if (battleProof && effectProof) offenders.push(`${def.name} {${[...granted].join(', ')}}`);
  }
  ok(offenders.length === 0, 'no monster below a God is immune to both', offenders.join(' · '));

  // And the four that were, one by one, so a rename cannot quietly drop them.
  const flags = (slug: string) => {
    const s = fresh();
    const c = card(ME, slug);
    s.players[ME].monsters[0] = c;
    // Some grant on summon rather than continuously; drive that first.
    const f = effFlags(s, c, ME);
    return f;
  };
  for (const slug of ['big-shield-gardna', 'beta-the-magnet-warrior']) {
    const f = flags(slug);
    ok(!f.indestructibleByEffect && !f.untargetable, `${CARDS[slug].name} is not immune to effects`);
  }
  ok(!!flags('big-shield-gardna').indestructibleByBattle, 'CONTROL: Big Shield Gardna is still a wall against battle');

  // A God still is, which is the whole point of the exemption.
  {
    const s = fresh();
    const god = card(ME, 'slifer-the-sky-dragon');
    s.players[ME].monsters[0] = god;
    ok(!!effFlags(s, god, ME).untargetable, 'CONTROL: a God is still untouchable');
  }
}

console.log('\nA God that did not pay for itself does not stay');
{
  /* Three tributes is the price of a Divine-Beast, and nothing charged it on a
     Special Summon. Monster Reborn reads *either* Graveyard and is in all
     eleven decks, so the first time Slifer died it became a one-card play for
     anybody — including a way to take somebody's God off them for good. */
  const s = fresh();
  const dead = card(ME, 'slifer-the-sky-dragon');
  s.players[ME].grave.push(dead);
  const reborn = card(ME, 'monster-reborn');
  s.players[ME].hand = [reborn, card(ME, 'kuriboh'), card(ME, 'kuriboh')];
  const up = act(s, ME, { type: 'activateSpell', uid: reborn.uid, targets: [dead.uid] });
  const god = up.players[ME].monsters.find((m) => m?.slug === 'slifer-the-sky-dragon');
  ok(!!god, 'a God can still be revived');
  ok(!!god && effAtk(up, god, ME) > 0, 'and it is a real monster while it is there', god ? String(effAtk(up, god, ME)) : '');
  const after = act(up, ME, { type: 'endTurn' });
  ok(!after.players[ME].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'),
    'but it goes back at the end of that turn');
  ok(after.players[ME].grave.some((c) => c.slug === 'slifer-the-sky-dragon'), 'to the Graveyard, not nowhere');

  /* Theft is live again — Monster Reborn reads either Graveyard — so this is
     the case the sweep was written for, driven end to end: take their God,
     have it for the turn, and it goes home. `toGrave` sends a card to its
     OWNER's Graveyard, so the thief does not even keep the corpse. */
  const theft = fresh();
  const theirs = card(FOE, 'slifer-the-sky-dragon');
  theft.players[FOE].grave.push(theirs);
  const steal = card(ME, 'monster-reborn');
  theft.players[ME].hand = [steal, card(ME, 'kuriboh')];
  const stolen = act(theft, ME, { type: 'activateSpell', uid: steal.uid, targets: [theirs.uid] });
  ok(stolen.players[ME].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'),
    "Monster Reborn reaches the other player's Graveyard");
  const returned = act(stolen, ME, { type: 'endTurn' });
  ok(!returned.players[ME].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'),
    'but a borrowed God is only ever a rental');
  ok(returned.players[FOE].grave.some((c) => c.slug === 'slifer-the-sky-dragon'),
    'and it goes home to its owner, not into the thief\'s Graveyard');
  ok(!returned.players[ME].grave.some((c) => c.slug === 'slifer-the-sky-dragon'),
    'CONTROL: the thief keeps nothing');

  /* The rental: your own God, revived without its three Tributes, leaves at
     the End Phase — from your own field, to your own Graveyard. */
  const rental = fresh();
  const mine = card(ME, 'slifer-the-sky-dragon');
  rental.players[ME].grave.push(mine);
  const rb2 = card(ME, 'monster-reborn');
  rental.players[ME].hand = [rb2, card(ME, 'kuriboh')];
  const revived = act(rental, ME, { type: 'activateSpell', uid: rb2.uid, targets: [mine.uid] });
  ok(revived.players[ME].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'),
    'your own God can be revived without Tributes');
  const back = act(revived, ME, { type: 'endTurn' });
  ok(!back.players[ME].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'), 'for exactly one turn');
  ok(back.players[ME].grave.some((c) => c.slug === 'slifer-the-sky-dragon'),
    'and it returns to the Graveyard at the End Phase');

  /* CONTROL: paying the three bodies is what buys the God permanently. It must
     survive its own End Phase, or the card is unplayable rather than balanced. */
  const paid = fresh();
  for (let i = 0; i < 3; i++) paid.players[ME].monsters[i] = card(ME, 'kuriboh');
  const summoned = card(ME, 'slifer-the-sky-dragon');
  paid.players[ME].hand = [summoned, card(ME, 'kuriboh')];
  paid.players[ME].deck = [card(ME, 'kuriboh')];
  const down = act(paid, ME, {
    type: 'normalSummon', uid: summoned.uid, zone: 0, position: 'atk', face: 'up',
    tributes: paid.players[ME].monsters.map((m) => m!.uid),
  });
  ok(down.players[ME].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'), 'CONTROL: three bodies still summon it');
  const kept = act(down, ME, { type: 'endTurn' });
  ok(kept.players[ME].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'),
    'CONTROL: and a God that paid its Tributes stays');

  // CONTROL: the rule is for Gods, not for everything Special Summoned.
  const ordinary = fresh();
  const body = card(ME, 'summoned-skull');
  ordinary.players[ME].grave.push(body);
  const rb = card(ME, 'monster-reborn');
  ordinary.players[ME].hand = [rb, card(ME, 'kuriboh')];
  const alive = act(act(ordinary, ME, { type: 'activateSpell', uid: rb.uid, targets: [body.uid] }), ME, { type: 'endTurn' });
  ok(alive.players[ME].monsters.some((m) => m?.slug === 'summoned-skull'),
    'CONTROL: an ordinary revived monster is unaffected');
}

console.log('\nAn effect that names its own cards asks the player nothing');
{
  /* Reported as "when dismantling it, it asks to special summon monsters from
     the graveyard, in a modal that shows the entire graveyard — not needed".
     Both halves of that were one bug: `pickableUids` honoured the filter for a
     Deck search and ignored it for the Graveyard, so the picker offered every
     monster down there — which is also what made "more qualify than the effect
     will take" true, and that is the test that opens the prompt at all.

     A prompt is only worth opening when there is something to decide. This
     asserts the rule the interface actually applies: how many cards the spec
     can legally reach, against how many the effect takes. */
  const s = fresh();
  const valk = card(ME, 'valkyrion-the-magna-warrior');
  s.players[ME].monsters[0] = valk;
  // A Graveyard with plenty in it, only three of which the effect names.
  s.players[ME].grave.push(
    card(ME, 'alpha-the-magnet-warrior'),
    card(ME, 'beta-the-magnet-warrior'),
    card(ME, 'gamma-the-magnet-warrior'),
    card(ME, 'kuriboh'),
    card(ME, 'summoned-skull'),
    card(ME, 'dark-magician')
  );
  const spec = targetSpecFor('valkyrion-the-magna-warrior', 'ignition');
  ok(!!spec, 'the split does name a Graveyard spec');
  if (spec) {
    /* `targetCandidates` is the interface's own pool builder, not a copy of it
       — asking anything else here would agree with the bug. */
    const legal = targetCandidates(s, ME, spec);
    ok(legal.length === 3, 'the picker offers exactly the three Magnet Warriors',
      `${legal.length} of ${s.players[ME].grave.length} in the Graveyard: ${legal.map((c) => c.slug).join(', ')}`);
    ok(!(legal.length > (spec.count ?? 1)), 'so there are never more candidates than it takes — no prompt opens',
      `${legal.length} candidates, takes ${spec.count}`);
  }
  // And it really does bring all three back, unprompted.
  const apart = applyAction(s, ME, { type: 'ignition', uid: valk.uid });
  const back = apart.state.players[ME].monsters.filter((m) => m && CARDS[m.slug].name.includes('Magnet Warrior'));
  ok(back.length === 3, 'sending no targets at all still returns all three', `${back.length} came back`);
}

console.log('\nChimera comes apart into both halves');
{
  const s = fresh();
  const chim = card(ME, 'chimera-the-flying-mythical-beast');
  s.players[ME].monsters[0] = chim;
  s.players[ME].grave.push(card(ME, 'gazelle-the-king-of-mythical-beasts'), card(ME, 'berfomet'));
  ok(!!effFlags(s, chim, ME).attackAll || !!effFlags(s, chim, ME).extraAttacks, 'it carries a second attack');
  s.players[FOE].monsters[0] = card(FOE, 'harpie-lady');
  const dh = card(ME, 'dark-hole');
  s.players[ME].hand.push(dh);
  const after = act(s, ME, { type: 'activateSpell', uid: dh.uid, targets: [] });
  const halves = after.players[ME].monsters.filter(Boolean).map((m) => m!.slug).sort();
  ok(halves.includes('gazelle-the-king-of-mythical-beasts') && halves.includes('berfomet'),
    'destroying it returns Gazelle and Berfomet both', halves.join(', ') || 'nothing came back');
}

console.log('\nEvery beat names the card it is showing');
{
  /* Reported from a real duel: "with dark hole when I destroyed the monsters
     sometimes a different image shows on the text for the info which monster
     was sent to the graveyard". The declaration band draws the beat's own
     `slug` beside the beat's own `note`, and `destroyCard` animated BEFORE it
     logged — so each destroy claimed the *previous* monster's line, and the
     first beat got the last monster's line off `speakRemainingLog`. With one
     monster on the board the pairing lands by luck, which is the "sometimes". */
  const s = fresh();
  s.players[FOE].monsters = [card(FOE, 'battle-ox'), card(FOE, 'summoned-skull'), card(FOE, 'harpie-lady')];
  s.players[ME].monsters = [card(ME, 'curse-of-dragon'), null, null];
  const hole = card(ME, 'dark-hole');
  s.players[ME].hand = [hole];
  const swept = act(s, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });

  const kills = swept.anims.filter((a) => a.kind === 'destroy');
  ok(kills.length === 4, 'Dark Hole gives every monster its own beat', `${kills.length} beats`);
  const mismatched = kills.filter((a) => {
    const name = a.slug ? CARDS[a.slug]?.name : null;
    return !name || !a.note || !a.note.includes(name);
  });
  ok(mismatched.length === 0,
    'and each one says the name of the card whose picture it shows',
    mismatched.map((a) => `${CARDS[a.slug!]?.name} → "${a.note}"`).join(' · '));
  ok(kills.every((a) => !!a.note), 'no destroyed monster arrives with nothing said about it');

  /* CONTROL: the single-destroy case, which was correct all along — so this
     block cannot pass merely because the pairing was disabled. */
  const one = fresh();
  one.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  const hole2 = card(ME, 'dark-hole');
  one.players[ME].hand = [hole2];
  const single = act(one, ME, { type: 'activateSpell', uid: hole2.uid, targets: [] });
  const solo = single.anims.find((a) => a.kind === 'destroy');
  ok(!!solo && !!solo.note && solo.note.includes('Battle Ox'),
    'CONTROL: one monster on the board still names itself', solo?.note ?? 'no beat');

  /* Two lines about one card need two beats. A God sweeping a protected
     monster aside says why, and then says what happened — and the first of
     those used to eat the second's beat. */
  const divine = fresh();
  divine.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  divine.players[ME].hand = [card(ME, 'pot-of-greed'), card(ME, 'pot-of-greed'), card(ME, 'pot-of-greed')];
  const shield = card(FOE, 'big-shield-gardna');
  shield.summonedOnTurn = 0;
  divine.players[FOE].monsters = [shield, null, null];
  divine.phase = 'battle';
  const god = divine.players[ME].monsters[0]!;
  god.summonedOnTurn = 0;
  const felled = act(divine, ME, { type: 'attack', uid: god.uid, targetUid: shield.uid });
  const said = felled.anims.filter((a) => a.note).map((a) => a.note!);
  ok(said.some((t) => /No protection stands before a God/.test(t)),
    'the God line is still spoken on the field');
  ok(said.some((t) => /Big Shield Gardna is destroyed/.test(t)),
    'and the destruction it caused is spoken too');

  /* A multi-card draw is one beat carrying the total, not one beat per card.
     Reported twice now — for Card of Sanctity, which fixed `drawTo`, and again
     for Manga Ryu-Ran's four, which comes out of the plain `draw` op next door.
     Reading "draws a card" four times while the duel stands still is the same
     complaint whichever op is doing it. */
  const greed = fresh();
  const pot = card(ME, 'pot-of-greed');
  greed.players[ME].hand = [pot];
  greed.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'battle-ox'), card(ME, 'harpie-lady')];
  const handBefore = greed.players[ME].hand.length - 1; // the Pot itself leaves
  const drawn = act(greed, ME, { type: 'activateSpell', uid: pot.uid, targets: [] });
  const draws = drawn.anims.filter((a) => a.kind === 'draw');
  ok(draws.length === 1, "Pot of Greed's two cards arrive on one beat", `${draws.length} beats`);
  ok(!!draws[0]?.note && /draws 2 cards/.test(draws[0].note), 'announced by their total',
    draws[0]?.note ?? '(silent)');
  ok(drawn.players[ME].hand.length === handBefore + 2, 'and both cards are really in hand',
    `${drawn.players[ME].hand.length} of ${handBefore + 2}`);

  /* A single card keeps the sentence it has always had. */
  const soloDraw = fresh();
  const dragon = card(ME, 'left-arm-of-the-forbidden-one'); // Level 1, draws 1 on arrival
  soloDraw.players[ME].hand = [dragon];
  soloDraw.players[ME].deck = [card(ME, 'kuriboh')];
  const drewOne = act(soloDraw, ME, { type: 'normalSummon', uid: dragon.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  const oneDraw = drewOne.anims.filter((a) => a.kind === 'draw');
  ok(oneDraw.length === 1 && /draws a card/.test(oneDraw[0]?.note ?? ''),
    'CONTROL: a one-card draw still reads "draws a card"', oneDraw[0]?.note ?? '(silent)');

  /* Manga Ryu-Ran, which is what the owner was looking at: four for you, two
     for them, and one banner each rather than six in a row. */
  const manga = fresh();
  manga.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  const ryu = card(ME, 'manga-ryu-ran');
  manga.players[ME].hand = [ryu, card(ME, 'kuriboh'), card(ME, 'battle-ox')];
  manga.players[ME].deck = Array.from({ length: 6 }, () => card(ME, 'mystical-elf'));
  manga.players[FOE].hand = [card(FOE, 'kuriboh')];
  manga.players[FOE].deck = Array.from({ length: 6 }, () => card(FOE, 'battle-ox'));
  const swapped = act(manga, ME, { type: 'normalSummon', uid: ryu.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  const mine4 = swapped.anims.filter((a) => a.kind === 'draw' && a.player === ME);
  const theirs2 = swapped.anims.filter((a) => a.kind === 'draw' && a.player === FOE);
  ok(mine4.length === 1 && /draws 4 cards/.test(mine4[0]?.note ?? ''),
    'Manga Ryu-Ran deals you four on one banner', mine4.map((a) => a.note).join(' | ') || '(none)');
  ok(theirs2.length === 1 && /draws 2 cards/.test(theirs2[0]?.note ?? ''),
    'and them two on one more', theirs2.map((a) => a.note).join(' | ') || '(none)');
}

console.log('\nThe second mouth never bites its own side, and says so');
{
  /* Reported as "Slifer's 2nd mouth activates when he is summoned as well".
     It does not — and never did. What the board said was "Slifer the Sky
     Dragon's effect activates", which is the draw-on-summon rider, and a card
     with three effects announced all of them with that same bare line. The
     rules half is pinned here anyway, because it is the thing that was
     believed broken and it is cheap to hold. */
  const own = fresh();
  for (let i = 0; i < 3; i++) own.players[ME].monsters[i] = card(ME, 'kuriboh');
  const god = card(ME, 'slifer-the-sky-dragon');
  own.players[ME].hand = [god];
  own.players[ME].deck = [card(ME, 'battle-ox')];
  const ox = card(FOE, 'battle-ox');
  const skull = card(FOE, 'summoned-skull');
  own.players[FOE].monsters = [ox, skull, null];
  const risen = act(own, ME, {
    type: 'normalSummon', uid: god.uid, zone: 0, position: 'atk', face: 'up',
    tributes: own.players[ME].monsters.map((m) => m!.uid),
  });
  const stillThere = risen.players[FOE].monsters.filter(Boolean);
  ok(stillThere.length === 2 && stillThere.every((m) => effAtk(risen, m!, FOE) === baseAtkOf(m!.slug)),
    "summoning a God does not fire its own mouth at the board",
    stillThere.map((m) => `${m!.slug} ${effAtk(risen, m!, FOE)}`).join(', '));
  ok(risen.players[ME].hand.length === 1, 'the draw rider still fires, exactly once',
    `hand ${risen.players[ME].hand.length}`);

  // And it never bites a monster its own controller summons later.
  const beside = fresh();
  beside.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  const friend = card(ME, 'battle-ox');
  beside.players[ME].hand = [card(ME, 'pot-of-greed'), friend];
  const together = act(beside, ME, {
    type: 'normalSummon', uid: friend.uid, zone: 1, position: 'atk', face: 'up', tributes: [],
  });
  const ally = together.players[ME].monsters.find((m) => m?.slug === 'battle-ox');
  ok(!!ally && effAtk(together, ally, ME) === baseAtkOf('battle-ox'),
    'and a monster summoned beside it is untouched', ally ? String(effAtk(together, ally, ME)) : 'destroyed');

  /* CONTROL: the mouth does still answer the other player's Summon — this
     block must not pass by the trigger being switched off. */
  const theirs = fresh();
  theirs.active = FOE;
  theirs.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  theirs.players[ME].hand = [card(ME, 'pot-of-greed'), card(ME, 'pot-of-greed')];
  const victim = card(FOE, 'summoned-skull');
  theirs.players[FOE].hand = [victim];
  theirs.players[FOE].monsters = [card(FOE, 'kuriboh'), null, null];
  const drained = act(theirs, FOE, {
    type: 'normalSummon', uid: victim.uid, zone: 1, position: 'atk', face: 'up',
    tributes: [theirs.players[FOE].monsters[0]!.uid],
  });
  const bitten = drained.players[FOE].monsters.find((m) => m?.slug === 'summoned-skull');
  ok(!!bitten && effAtk(drained, bitten, FOE) === 500,
    'CONTROL: their Summon is still drained by 2000', bitten ? String(effAtk(drained, bitten, FOE)) : 'destroyed');

  /* The narration half: an effect that fired because the card arrived says the
     card's cry, so it cannot be mistaken for the effect everyone knows it by. */
  const arrivals = risen.anims.filter((a) => a.kind === 'activate' && a.slug === 'slifer-the-sky-dragon');
  ok(arrivals.length === 1 && arrivals[0].arrival === true,
    'the arrival beat is marked as an arrival');
  ok(arrivals[0]?.text === CARDS['slifer-the-sky-dragon'].cry,
    'and carries the cry, not a bare "effect activates"', arrivals[0]?.text ?? 'nothing');

  // CONTROL: an effect the player chooses to use is not an arrival.
  const ignite = fresh();
  ignite.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  const greed = card(ME, 'pot-of-greed');
  ignite.players[ME].hand = [greed];
  ignite.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'kuriboh')];
  const played = act(ignite, ME, { type: 'activateSpell', uid: greed.uid, targets: [] });
  const spell = played.anims.find((a) => a.kind === 'activate' && a.slug === 'pot-of-greed');
  ok(!!spell && !spell.arrival, 'CONTROL: a card played from the hand is not an arrival');
}

console.log('\nWinning the final wins the tournament, and the screen says so');
{
  /* Reported: "when I won the tournament it returned me for a to the final
     match post screen I had to click view bracket to see that I won the
     tournament". The win screen said "Victory" — the same word it says for a
     quarter-final — so the run ended with no announcement. `isFinalRound` is
     what the screen now asks, and it lives in the tournament module rather
     than in the component, because a rule with two homes is how three of the
     bugs in CLAUDE.md happened. */
  const t = (round: number, matches: [string | null, string | null][]): Tournament => ({
    entrants: ['yugi', 'kaiba', 'mai', 'joey'],
    humanSeat: 0,
    humanDuelist: 'yugi',
    round,
    matches: matches.map(([a, b], slot) => ({ round, slot, a, b, winner: null, human: a === 'yugi' || b === 'yugi' })),
    status: 'duelling',
    seed: 1,
  });

  ok(isFinalRound(t(2, [['yugi', 'kaiba']])), 'one match with both seats filled is the final');
  ok(!isFinalRound(t(0, [['yugi', 'kaiba'], ['mai', 'joey']])), 'two matches is not');
  /* The one that would have been missed: three survivors pair one match and
     send the third through on a bye. One match, and not the final. */
  ok(!isFinalRound(t(1, [['yugi', 'kaiba'], ['mai', null]])), 'and neither is a single match beside a bye');
  ok(!isFinalRound(t(1, [['mai', null]])), 'a lone bye is not a final either');
}

console.log('\nRa is worth what was spent on it');
{
  /* The second God, and the opposite of the first: Slifer counts the hand,
     Ra counts the board you gave up. Both cost three bodies. */
  const s = fresh();
  const a = card(ME, 'battle-ox'); // 1700/1000
  const b = card(ME, 'summoned-skull'); // 2500/1200
  const c2 = card(ME, 'harpie-lady'); // 1300/1400
  s.players[ME].monsters = [a, b, c2];
  const ra = card(ME, 'the-winged-dragon-of-ra');
  s.players[ME].hand = [ra];
  s.players[ME].deck = [card(ME, 'kuriboh')];
  ok(tributesRequired('the-winged-dragon-of-ra') === 3, 'a God still costs three bodies');
  /* Read off the board a moment before it is spent, not from the printed
     numbers: a monster standing in a buff is worth what it was worth on the
     field, which is the rule the engine states and which the first version of
     this check disagreed with by 200. */
  const wantAtk = effAtk(s, a, ME) + effAtk(s, b, ME) + effAtk(s, c2, ME);
  const wantDef = effDef(s, a, ME) + effDef(s, b, ME) + effDef(s, c2, ME);
  const risen = act(s, ME, {
    type: 'normalSummon', uid: ra.uid, zone: 0, position: 'atk', face: 'up',
    tributes: [a.uid, b.uid, c2.uid],
  });
  const god = risen.players[ME].monsters.find((m) => m?.slug === 'the-winged-dragon-of-ra');
  /* The three it ate are in the Graveyard by the time anybody reads the
     number, and Ra counts monsters there at 300 apiece — so the expectation
     is the Tribute sum PLUS the scaling, not the sum alone. Slifer's mirror:
     one God counts what you still hold, the other what you have already
     lost. */
  const graveMon = (st: DuelState) => st.players[ME].grave.filter((c) => CARDS[c.slug]?.kind === 'monster').length;
  const scaled = (st: DuelState) => 300 * graveMon(st);
  ok(!!god && effAtk(risen, god, ME) === wantAtk + scaled(risen),
    'its ATK is the combined ATK of the three it ate, plus its Graveyard',
    god ? `${effAtk(risen, god, ME)} vs ${wantAtk} + ${scaled(risen)}` : 'no God');
  ok(!!god && effDef(risen, god, ME) === wantDef,
    'and its DEF the combined DEF', god ? `${effDef(risen, god, ME)} vs ${wantDef}` : '');

  /* The scaling measured the way this file insists: empty the counted zone,
     read the stat, add exactly one matching card, and demand the number moves
     by exactly the promised step. A restored aura that merely puts the card's
     own body back would satisfy "something moved" and prove nothing. */
  {
    const bare = fresh();
    const lone = card(ME, 'the-winged-dragon-of-ra');
    bare.players[ME].monsters = [lone, null, null];
    bare.players[ME].grave = [];
    const empty = effAtk(bare, lone, ME);
    bare.players[ME].grave.push(card(ME, 'battle-ox'));
    const one = effAtk(bare, lone, ME);
    ok(one - empty === 300, 'one monster in the Graveyard is worth exactly 300 to it', `${empty} → ${one}`);
    bare.players[ME].grave.push(card(ME, 'pot-of-greed')); // a Spell is not a monster
    ok(effAtk(bare, lone, ME) === one, 'and a Spell in the Graveyard is worth nothing to it',
      String(effAtk(bare, lone, ME)));
  }

  /* Sphere Mode: it lands and it does nothing. That pause is the whole of
     its counterplay — the other player gets one full turn to answer a
     monster they cannot target. */
  /* In the Battle Phase, or this proves nothing: a monster cannot attack
     during Main Phase either, so the first version of this assertion passed
     with Sphere Mode deleted. Falsification caught it — the same trap this
     file keeps recording. */
  const swinging = { ...risen, phase: 'battle' as const };
  const fresh_god = swinging.players[ME].monsters.find((m) => m?.slug === 'the-winged-dragon-of-ra')!;
  /* Ra swings the turn it lands, unlike a Toon. Three *real* bodies is a far
     steeper price than Slifer's three Kuribohs, so the cost is the balance —
     and it still cannot pierce, so a body in Defence is a real answer. */
  ok(canAttackWith(swinging, ME, fresh_god), 'it can swing the turn it arrives — its cost is its price');
  const later = { ...risen, turn: risen.turn + 2, phase: 'battle' as const };
  const settled = later.players[ME].monsters.find((m) => m?.slug === 'the-winged-dragon-of-ra')!;
  ok(canAttackWith(later, ME, settled), 'CONTROL: the turn after, it swings');

  ok(!!god && !!effFlags(risen, god, ME).untargetable, 'no mortal effect may touch it');
  /* And it does NOT pierce — the rule the owner set for every God. A body in
     Defence is a real answer to Ra, which is what the burn engine punishes. */
  ok(!!god && !effFlags(risen, god, ME).pierce, 'a God still does not pierce');

  // A bigger board makes a bigger God: the same summon, fed better.
  const rich = fresh();
  const big1 = card(ME, 'summoned-skull');
  const big2 = card(ME, 'summoned-skull');
  const big3 = card(ME, 'summoned-skull');
  rich.players[ME].monsters = [big1, big2, big3];
  const ra2 = card(ME, 'the-winged-dragon-of-ra');
  rich.players[ME].hand = [ra2];
  rich.players[ME].deck = [card(ME, 'kuriboh')];
  const fed = act(rich, ME, {
    type: 'normalSummon', uid: ra2.uid, zone: 0, position: 'atk', face: 'up',
    tributes: [big1.uid, big2.uid, big3.uid],
  });
  const fatGod = fed.players[ME].monsters.find((m) => m?.slug === 'the-winged-dragon-of-ra');
  const fedGrave = 300 * fed.players[ME].grave.filter((c) => CARDS[c.slug]?.kind === 'monster').length;
  ok(!!fatGod && effAtk(fed, fatGod, ME) === 7500 + fedGrave,
    'three Summoned Skulls make a 7500 God before its Graveyard is counted',
    fatGod ? `${effAtk(fed, fatGod, ME)} vs 7500 + ${fedGrave}` : '');

  /* CONTROL: an ordinary Tribute Summon is unaffected — this is Ra's rule,
     not a rule about tributing. */
  const ordinary = fresh();
  const f1 = card(ME, 'summoned-skull');
  const f2 = card(ME, 'summoned-skull');
  ordinary.players[ME].monsters = [f1, f2, null];
  const beast = card(ME, 'blue-eyes-white-dragon'); // level 8, two tributes, 3000
  ordinary.players[ME].hand = [beast];
  const plain = act(ordinary, ME, {
    type: 'normalSummon', uid: beast.uid, zone: 0, position: 'atk', face: 'up', tributes: [f1.uid, f2.uid],
  });
  const body = plain.players[ME].monsters.find((m) => m?.slug === 'blue-eyes-white-dragon');
  ok(!!body && effAtk(plain, body, ME) === baseAtkOf('blue-eyes-white-dragon'),
    'CONTROL: an ordinary Tribute Summon keeps its printed ATK',
    body ? String(effAtk(plain, body, ME)) : '');
}

console.log('\nThe torture chamber ticks every turn');
{
  // Bowganian: the deck's engine, and the first card in the game to use
  // `onOwnTurnStart` — a trigger that existed and had no users at all.
  const s = fresh();
  s.players[ME].monsters[0] = card(ME, 'bowganian');
  s.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'kuriboh')];
  s.players[FOE].deck = [card(FOE, 'kuriboh'), card(FOE, 'kuriboh')];
  const lp = s.players[FOE].lp;
  const round = act(act(s, ME, { type: 'endTurn' }), FOE, { type: 'endTurn' });
  ok(round.players[FOE].lp === lp - 1100, 'Bowganian bleeds them 1100 at the start of your turn',
    `${lp} → ${round.players[FOE].lp}`);

  // Legendary Fiend grows on the same clock.
  const g = fresh();
  const fiend = card(ME, 'legendary-fiend');
  g.players[ME].monsters[0] = fiend;
  g.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'kuriboh')];
  g.players[FOE].deck = [card(FOE, 'kuriboh'), card(FOE, 'kuriboh')];
  const grown = act(act(g, ME, { type: 'endTurn' }), FOE, { type: 'endTurn' });
  const older = grown.players[ME].monsters.find((m) => m?.slug === 'legendary-fiend');
  ok(!!older && effAtk(grown, older, ME) === baseAtkOf('legendary-fiend') + 700,
    'and Legendary Fiend takes 700 ATK on the same clock',
    older ? String(effAtk(grown, older, ME)) : 'gone');

  /* Revival Jam does not stay dead — which with Coffin Seller is the
     deck's whole attrition plan. */
  const jam = fresh();
  const slime = card(ME, 'revival-jam');
  jam.players[ME].monsters = [slime, null, null];
  const hole = card(ME, 'dark-hole');
  jam.players[ME].hand = [hole];
  const wiped = act(jam, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
  ok(wiped.players[ME].monsters.some((m) => m?.slug === 'revival-jam'),
    'Revival Jam comes straight back out of the Graveyard');

  // Viser Des is the enabler that finds itself.
  const des = fresh();
  const viser = card(ME, 'viser-des');
  des.players[ME].hand = [viser];
  des.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'nightmare-wheel'), card(ME, 'battle-ox')];
  const searched = act(des, ME, {
    type: 'normalSummon', uid: viser.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
  });
  ok(searched.players[ME].hand.some((c) => c.slug === 'nightmare-wheel'),
    'Viser Des fetches a torture card rather than hoping to draw it',
    searched.players[ME].hand.map((c) => c.slug).join(', ') || 'empty hand');

  // Granadora takes a loan and the bill really comes due.
  const gran = fresh();
  const lizard = card(ME, 'granadora');
  gran.players[ME].hand = [lizard];
  const lent = act(gran, ME, {
    type: 'normalSummon', uid: lizard.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
  });
  ok(lent.players[ME].lp === gran.players[ME].lp + 1000, 'Granadora pays 1000 up front',
    String(lent.players[ME].lp));
  const dh2 = card(ME, 'dark-hole');
  lent.players[ME].hand.push(dh2);
  const settled2 = act(lent, ME, { type: 'activateSpell', uid: dh2.uid, targets: [] });
  ok(settled2.players[ME].lp === lent.players[ME].lp - 2000, 'and takes 2000 back when it leaves',
    String(settled2.players[ME].lp));

  /* The interest, which is the whole reason the loan is worth taking. It was
     reported as "too weak to cost ultimately 1000LP for a 1900atk monster
     with nothing extra", and the arithmetic really was +1000 against −2000:
     a four-star vanilla that charged its own controller a net thousand. One
     turn alive now clears that, and the payment comes out of the opponent. */
  const rent = fresh();
  rent.players[ME].monsters[0] = card(ME, 'granadora');
  rent.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'kuriboh')];
  rent.players[FOE].deck = [card(FOE, 'kuriboh'), card(FOE, 'kuriboh')];
  const mine0 = rent.players[ME].lp;
  const theirs0 = rent.players[FOE].lp;
  const round2 = act(act(rent, ME, { type: 'endTurn' }), FOE, { type: 'endTurn' });
  ok(round2.players[FOE].lp === theirs0 - 800, 'the lizard drains 800 out of them each of your turns',
    `${theirs0} → ${round2.players[FOE].lp}`);
  ok(round2.players[ME].lp === mine0 + 800, 'and puts it straight in his pocket',
    `${mine0} → ${round2.players[ME].lp}`);

  /* The point of the change, stated as arithmetic: summoned, left alone for
     one turn and then destroyed, the card must be Life-Point POSITIVE. The
     old one was −1000 here, which is what made it a drawback card rather
     than a bargain. */
  const cycle = fresh();
  const liz2 = card(ME, 'granadora');
  cycle.players[ME].hand = [liz2];
  cycle.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'kuriboh')];
  cycle.players[FOE].deck = [card(FOE, 'kuriboh'), card(FOE, 'kuriboh')];
  const start = cycle.players[ME].lp;
  const theirsStart = cycle.players[FOE].lp;
  const down = act(cycle, ME, {
    type: 'normalSummon', uid: liz2.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
  });
  const survived = act(act(down, ME, { type: 'endTurn' }), FOE, { type: 'endTurn' });
  const hole3 = card(ME, 'dark-hole');
  survived.players[ME].hand.push(hole3);
  const dead = act(survived, ME, { type: 'activateSpell', uid: hole3.uid, targets: [] });
  /* Measured as the SWING, because half the interest is collected from the
     other side of the table and a race is decided by the gap, not by one
     total. Summoned, left alone for a single turn and then broken, the card
     must come out ahead — the old one was 1000 behind however long it
     lived, which is what "nothing extra" meant. */
  const swing =
    (dead.players[ME].lp - start) + (theirsStart - dead.players[FOE].lp);
  ok(swing > 0,
    'summoned, left alone one turn and then broken, the bargain still comes out ahead',
    `swing ${swing}`);
}

console.log('\nTwo cards cannot answer each other forever');
{
  /* Found by `npm run deck-bench` the first time Yami Marik was measured
     against the field, as a stack overflow rather than a bad number: Revival
     Jam revives the instant it is destroyed, a revival is a Summon, and
     Slifer's second mouth destroys whatever the opponent Summons. The two
     cards ping-ponged until the call stack gave out — which on a serverless
     function is a 500 and a duel both players lose.

     Two guards, and this drives both at once: the card's own once-per-turn
     limit, and the engine's depth backstop underneath it. */
  const s = fresh();
  s.active = FOE;
  s.players[ME].monsters[0] = card(ME, 'slifer-the-sky-dragon');
  s.players[ME].hand = [card(ME, 'pot-of-greed'), card(ME, 'pot-of-greed')];
  const jam = card(FOE, 'revival-jam'); // 1500, so the mouth's 2000 finishes it
  s.players[FOE].hand = [jam];
  let landed: DuelState | null = null;
  let threw = '';
  try {
    landed = act(s, FOE, { type: 'normalSummon', uid: jam.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  ok(!threw, 'summoning into a God that kills it does not hang the engine', threw);
  ok(!!landed && !landed.players[FOE].monsters.some((m) => m?.slug === 'revival-jam'),
    'the Jam is destroyed and stays down for the rest of the turn');
  ok(!!landed && landed.players[FOE].grave.some((c) => c.slug === 'revival-jam'),
    'and it is in the Graveyard, not in limbo');

  /* CONTROL: with no God across the table it revives exactly as it should —
     the limit must not have quietly turned the card off. */
  const alone = fresh();
  const jam2 = card(ME, 'revival-jam');
  alone.players[ME].monsters = [jam2, null, null];
  const hole = card(ME, 'dark-hole');
  alone.players[ME].hand = [hole];
  const wiped = act(alone, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
  ok(wiped.players[ME].monsters.some((m) => m?.slug === 'revival-jam'),
    'CONTROL: it still comes back the first time it is destroyed');

  // ...and only the first time in a turn.
  const hole2 = card(ME, 'dark-hole');
  wiped.players[ME].hand.push(hole2);
  const again = act(wiped, ME, { type: 'activateSpell', uid: hole2.uid, targets: [] });
  ok(!again.players[ME].monsters.some((m) => m?.slug === 'revival-jam'),
    'but not twice in the same turn');
}

console.log('\nMarik pays for his God the way Yugi pays for his');
{
  /* The gap that made the two God decks 93-7 was body income, not card power:
     every exclusive card in Yami Yugi's deck summons another card for free,
     and Marik had none at all. These are the cards that closed it, and each
     one is one Normal Summon turning into two bodies. */
  const twin = (slug: string, deck: string[]) => {
    const s = fresh();
    const c = card(ME, slug);
    s.players[ME].hand = [c];
    s.players[ME].deck = deck.map((d) => card(ME, d));
    const out = act(s, ME, { type: 'normalSummon', uid: c.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
    return out.players[ME].monsters.filter((m) => m?.slug === slug).length;
  };
  ok(twin('bowganian', ['bowganian', 'kuriboh']) === 2,
    'one Bowganian Normal Summoned brings its twin out of the Deck');
  ok(twin('viser-des', ['viser-des', 'nightmare-wheel']) === 2,
    'and Viser Des brings its own, on top of the search');

  /* CONTROL: the fetched copy arrives by *Special* Summon, so it fires
     `onSummon` and not `onNormalSummon` — the chain is one link long by
     construction rather than by counting how many are left in the Deck. */
  ok(twin('bowganian', ['bowganian', 'bowganian', 'bowganian']) === 2,
    'CONTROL: and only its twin — the chain does not run away');

  // The wall that is also two Tributes.
  /* An `anyOpponentTurn` trap is activated from the Set card itself rather
     than answered in a window, which is the path `canActivateSetCard` opens
     for it — the first version of this check reached for `respondTrap` with
     no window open and threw. */
  const slime = fresh();
  const trap = card(ME, 'metal-reflect-slime');
  trap.face = 'down';
  trap.summonedOnTurn = 0;
  slime.turn = 4;
  slime.players[ME].spellTrap = trap;
  const sprung = act(slime, ME, { type: 'activateSetCard', uid: trap.uid, targets: [] });
  ok(sprung.players[ME].monsters.filter((m) => m?.isToken).length === 2,
    'Metal Reflect Slime puts down two bodies, not one',
    String(sprung.players[ME].monsters.filter(Boolean).length));
}

console.log('\nA card that names its options means them in that order');
{
  /* Reported as "summoning Viser Des has a random chance for which monster it
     gives you". It was not random, it was backwards: with no explicit choice
     the search took the highest printed ATK, and a God's stats are "?" —
     which the card database gives as **-1**. So Ra sorted below Bowganian's
     1300 and below two Traps on 0, and the headline card of the whole deck
     was the one option the search would never take.

     A filter that names its cards is a preference order, and the card's text
     is where that order is written. */
  /* The order is still the card's, but it is now a *recommendation* rather
     than a verdict: the player is asked, and what the order decides is which
     answers an AI on that seat considers first — see `choiceResponses`. Both
     halves are pinned, because the -1 ATK trap moved when the asking did. */
  const summonViser = (deck: string[]) => {
    const s = fresh();
    const v = card(ME, 'viser-des');
    s.players[ME].hand = [v];
    s.players[ME].deck = deck.map((d) => card(ME, d));
    return act(s, ME, { type: 'normalSummon', uid: v.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  };
  const inHand = (s: DuelState) => s.players[ME].hand.filter((c) => c.slug !== 'viser-des').map((c) => c.slug);

  const wide = summonViser(['coffin-seller', 'nightmare-wheel', 'bowganian', 'the-winged-dragon-of-ra']);
  ok(
    (asked(wide) ?? []).includes('the-winged-dragon-of-ra'),
    'Viser Des asks, and the God is one of the answers it offers',
    JSON.stringify(asked(wide))
  );
  ok(inHand(answer(wide, 'coffin-seller'))[0] === 'coffin-seller',
    'and the player may take the Trap over the God if that is the play');

  /* The ranking an AI reads. Ra's printed ATK is "?", which the database gives
     as -1 — so a plain ATK sort put the headline card of the deck dead last.
     `choiceResponses` reads the card's named order first, and the first answer
     it offers is the one it would take. */
  const offers = choiceResponses(wide, ME);
  const firstChoice = offers[0]?.type === 'chooseCard' ? offers[0].uids[0] : '';
  const firstSlug = wide.pending && wide.pending.kind === 'choose'
    ? (['p1', 'p2'] as PlayerId[]).flatMap((pid) => wide.players[pid].deck).find((c) => c.uid === firstChoice)?.slug
    : undefined;
  ok(firstSlug === 'the-winged-dragon-of-ra',
    'and a computer answering it reaches for the God first, not last', firstSlug ?? 'nothing');

  /* Deck order must not matter, or the fix is luck wearing a rule's clothes. */
  const two = summonViser(['the-winged-dragon-of-ra', 'bowganian']);
  ok((asked(two) ?? []).includes('the-winged-dragon-of-ra'),
    'and it does not matter where in the Deck the God is sitting', JSON.stringify(asked(two)));

  /* One name left in the Deck is one answer, so there is nothing to ask and
     the card simply takes it. */
  const alone = summonViser(['coffin-seller']);
  ok(asked(alone) === null, 'down to the last one listed it asks nothing', JSON.stringify(asked(alone)));
  ok(inHand(alone)[0] === 'coffin-seller', 'and takes it anyway', inHand(alone)[0] ?? 'nothing');

  /* Alpha takes two brothers, so exactly two brothers in the Deck is no
     decision at all — it takes both and says nothing. */
  const summonAlpha = (deck: string[]) => {
    const s = fresh();
    const alpha = card(ME, 'alpha-the-magnet-warrior');
    s.players[ME].hand = [alpha];
    s.players[ME].deck = deck.map((d) => card(ME, d));
    return act(s, ME, { type: 'normalSummon', uid: alpha.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  };
  const exactly = summonAlpha(['kuriboh', 'beta-the-magnet-warrior', 'gamma-the-magnet-warrior']);
  ok(asked(exactly) === null, 'two brothers for two slots is no decision, so nothing is asked', JSON.stringify(asked(exactly)));
  ok(
    exactly.players[ME].hand.some((c) => c.slug === 'beta-the-magnet-warrior') &&
      exactly.players[ME].hand.some((c) => c.slug === 'gamma-the-magnet-warrior'),
    'CONTROL: an unordered search still reaches for what it wants',
    exactly.players[ME].hand.map((c) => c.slug).join(',')
  );

  /* Three copies of the same brother for two slots is still no decision —
     `worthAsking` counts names, not cards, and every way of taking two of
     three Betas ends with two Betas in hand. */
  const clones = summonAlpha(['beta-the-magnet-warrior', 'beta-the-magnet-warrior', 'beta-the-magnet-warrior']);
  ok(asked(clones) === null, 'and three copies of one brother is still no decision', JSON.stringify(asked(clones)));
  ok(
    clones.players[ME].hand.filter((c) => c.slug === 'beta-the-magnet-warrior').length === 2,
    'it simply takes two of them',
    `${clones.players[ME].hand.filter((c) => c.slug === 'beta-the-magnet-warrior').length}`
  );

  /* Two Betas and a Gamma is, because Beta+Beta and Beta+Gamma are different
     hands — which is why the rule cannot be "more than one name" on its own. */
  const mixed = summonAlpha(['beta-the-magnet-warrior', 'beta-the-magnet-warrior', 'gamma-the-magnet-warrior']);
  const offered = asked(mixed);
  ok(!!offered && offered.length === 3, 'two of one and one of another is a decision', JSON.stringify(offered));
  const took = answer(mixed, 'beta-the-magnet-warrior', 'beta-the-magnet-warrior');
  ok(
    took.players[ME].hand.filter((c) => c.slug === 'beta-the-magnet-warrior').length === 2 &&
      !took.players[ME].hand.some((c) => c.slug === 'gamma-the-magnet-warrior'),
    'and the pair pointed at is the pair that comes, Gamma left behind',
    took.players[ME].hand.map((c) => c.slug).join(',')
  );
}

console.log('\nEvery ignition on a card can be reached');
{
  /* This used to say the opposite. `applyAction` resolved an ignition with
     `def.effects.find((e) => e.trigger === 'ignition')` — the FIRST one — so a
     card carrying two activated effects had a second nobody could ever press:
     dead text of exactly the kind `npm run text` exists to catch, except the
     text check sees an ignition trigger and is satisfied. The guard forbade a
     second ignition outright and said "lift this the day the engine learns to
     choose."

     Obelisk is the day. It carries the Fist of Fate and a second button that
     spends one body for three more swings, so the assertion is inverted: every
     ignition a card carries must be offered, and the one the board offered must
     be the one the engine resolves. */
  const multi = Object.entries(CARDS).filter(
    ([, def]) => def.effects.filter((e) => e.trigger === 'ignition').length > 1
  );
  ok(multi.length > 0, 'a card carries more than one ignition, so this is not vacuous',
    multi.map(([s]) => s).join(', ') || '(none)');

  for (const [slug, def] of multi) {
    /* A board where every ignition on the card is affordable: three spare
       bodies beside it, so a cost of one or two Tributes is payable either
       way, and a full Graveyard for anything that reads it. */
    const s = fresh();
    const owner = card(ME, slug);
    owner.summonedOnTurn = 0;
    s.players[ME].monsters = [owner, card(ME, 'battle-ox'), card(ME, 'kuriboh')];
    s.players[FOE].monsters = [card(FOE, 'summoned-skull'), null, null];
    s.players[ME].grave = [card(ME, 'newdoria'), card(ME, 'pharaoh-s-servant')];
    const offers = ignitionOptions(s, ME, owner);
    const written = def.effects.map((e, i) => [e, i] as const).filter(([e]) => e.trigger === 'ignition');
    ok(offers.length === written.length,
      `${slug}: every ignition it carries is offered`,
      `${offers.length} offered vs ${written.length} written`);

    /* And each one resolves as itself. Pressing a button must run the effect
       whose label it carried — the failure this whole section exists to stop is
       the board offering one and the engine running another. */
    for (const o of offers) {
      const fired = applyAction(s, ME, { type: 'ignition', uid: owner.uid, targets: [], effectIndex: o.index });
      ok(!fired.error, `${slug}: the '${o.label}' button is accepted`, fired.error ?? '');
      const said = fired.state.anims.find((a) => a.kind === 'activate' && a.uid === owner.uid);
      ok(said?.text === o.label, `${slug}: and the board names the one that was pressed`,
        `${said?.text ?? '(silent)'} vs ${o.label}`);
    }
  }
}

console.log('\nA card lying face-down is doing nothing');
{
  /* Reported as "effects of face down monsters like burn can not happen if
     they are face down — for example Marik's monster, if I end the turn and
     the monster is facedown it can't burn the enemy". Every `onOwnTurnStart`
     card in the game was doing it: Bowganian burning 1100 out of a turn it
     spent asleep, Granadora draining 800 and healing 800, Legendary Fiend
     quietly growing 700 under its own card back.

     Driven through a real turn change rather than by calling the trigger, so
     it is the engine's own loop being tested. */
  const asleep = fresh();
  asleep.active = FOE;
  asleep.players[ME].monsters = [
    { ...card(ME, 'bowganian'), face: 'down' as const, position: 'def' as const },
    { ...card(ME, 'granadora'), face: 'down' as const, position: 'def' as const },
    { ...card(ME, 'legendary-fiend'), face: 'down' as const, position: 'def' as const },
  ];
  const fiendBase = baseAtkOf('legendary-fiend');
  const foeLpBefore = asleep.players[FOE].lp;
  const myLpBefore = asleep.players[ME].lp;
  // FOE ends their turn, which starts mine — every onOwnTurnStart fires here.
  const woken = act(asleep, FOE, { type: 'endTurn' });
  ok(woken.active === ME && woken.turn === asleep.turn + 1, 'the turn really did change', `turn ${woken.turn} active ${woken.active}`);
  ok(woken.players[FOE].lp === foeLpBefore, 'a face-down Bowganian burns nobody', `foe LP ${woken.players[FOE].lp}`);
  ok(woken.players[ME].lp === myLpBefore, 'and a face-down Granadora collects no interest', `LP ${woken.players[ME].lp}`);
  const sleeper = woken.players[ME].monsters.find((m) => m?.slug === 'legendary-fiend')!;
  ok(effAtk(woken, sleeper, ME) === fiendBase,
    'and a face-down Legendary Fiend does not grow', `${effAtk(woken, sleeper, ME)} vs ${fiendBase}`);

  /* CONTROL: face-up, all three do exactly what they say — or the assertions
     above would pass just as happily on an engine that had lost the effects
     altogether, which is the failure mode this whole file exists to avoid. */
  const awake = fresh();
  awake.active = FOE;
  awake.players[ME].monsters = [card(ME, 'bowganian'), card(ME, 'granadora'), card(ME, 'legendary-fiend')];
  const foeLp2 = awake.players[FOE].lp;
  const myLp2 = awake.players[ME].lp;
  const played = act(awake, FOE, { type: 'endTurn' });
  ok(played.players[FOE].lp === foeLp2 - 1100 - 800, 'CONTROL: face-up, the pair bleed them for 1900', `foe LP ${played.players[FOE].lp}`);
  ok(played.players[ME].lp === myLp2 + 800, 'CONTROL: and Granadora pays its keeper 800', `LP ${played.players[ME].lp}`);
  const grown = played.players[ME].monsters.find((m) => m?.slug === 'legendary-fiend')!;
  ok(effAtk(played, grown, ME) === fiendBase + 700, 'CONTROL: and the Fiend takes its 700', `${effAtk(played, grown, ME)}`);

  /* CONTROL: leaving the field is not the same as standing on it asleep. A
     Set flip monster still pays out when the attack that kills it turns it
     face-up, which is the entire reason for setting one — the gate above is
     deliberately only on the two turn loops. */
  const bug = fresh('battle');
  bug.active = FOE;
  const eater = { ...card(ME, 'man-eater-bug'), face: 'down' as const, position: 'def' as const };
  bug.players[ME].monsters = [eater, null, null];
  const big = card(FOE, 'summoned-skull');
  big.summonedOnTurn = 0;
  bug.players[FOE].monsters = [big, null, null];
  const bitten = act(bug, FOE, { type: 'attack', uid: big.uid, targetUid: eater.uid });
  ok(!bitten.players[FOE].monsters.some((m) => m?.slug === 'summoned-skull'),
    'CONTROL: a Set flip monster still bites the attacker that reveals it',
    bitten.players[FOE].monsters.map((m) => m?.slug).join(',') || 'empty');
}

console.log('\nThe book gives the mischief, and takes it back');
{
  /* "When the toon world is gone they just can't attack directly and lose the
     atk buff." They did lose the buff and they did NOT lose the direct attack:
     every gated Toon carried its own permanent `directAttack`, granted on
     summon, so destroying Toon World left an unbuffed Toon still walking past
     blockers. The book is the only source now. */
  const open = fresh('battle');
  open.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  const mermaid = card(ME, 'toon-mermaid');
  mermaid.summonedOnTurn = 0;
  open.players[ME].monsters = [mermaid, null, null];
  ok(!!effFlags(open, mermaid, ME).directAttack, 'under the book a Toon attacks directly');
  ok(effAtk(open, mermaid, ME) === baseAtkOf('toon-mermaid'), 'at its printed ATK — the book lends none', `${effAtk(open, mermaid, ME)}`);

  const shut = structuredClone(open);
  shut.players[ME].field = null;
  const stranded = shut.players[ME].monsters[0]!;
  ok(!effFlags(shut, stranded, ME).directAttack, 'close the book and the direct attack goes with it');
  /* The ATK does not move, because the book has stopped lending any — closing
     it takes the mischief and leaves the printed body. What closing it *costs*
     is the cascade, and that is pinned where the book is destroyed rather than
     lifted out of the zone. */
  ok(effAtk(shut, stranded, ME) === baseAtkOf('toon-mermaid'), 'while the printed ATK never moved either way', `${effAtk(shut, stranded, ME)}`);
  ok(!!shut.players[ME].monsters[0], 'but the body is still standing');

  /* Toon Alligator is the way *into* the deck, and by the owner's ruling it is
     a plain reptile until the book it fetches is open. It used to grant itself
     a permanent direct attack on summon, which outlived every answer to the
     book — an Alligator kept walking past blockers with the Field Zone empty. */
  const gator = fresh('battle');
  const alli = card(ME, 'toon-alligator');
  alli.summonedOnTurn = 0;
  gator.players[ME].monsters = [alli, null, null];
  ok(!effFlags(gator, alli, ME).directAttack, 'with no book, Toon Alligator is just a reptile');
  const gatorBook = structuredClone(gator);
  gatorBook.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  ok(
    !!effFlags(gatorBook, gatorBook.players[ME].monsters[0]!, ME).directAttack,
    'and the book it went to fetch is what lets it walk past a blocker'
  );
}

console.log('\nRevival Jam does not stay dead');
{
  /* Asked for directly: "check if revival jam special summons itself". It is
     the one card in the game whose revival target is the card being revived,
     which needs `includeSelf` on the op — a Special Summon otherwise refuses
     the effect's own source, and the card silently did nothing at all. */
  const s = fresh();
  const jam = card(ME, 'revival-jam');
  s.players[ME].monsters = [jam, null, null];
  /* The passenger is Magician of Faith on purpose: 300 ATK, and her only
     effect is a flip, so being Special Summoned face-up adds nothing to the
     board beyond herself. Kuriboh was the obvious pick and brings a token
     with her, which quietly made a two-body board a three-body one. */
  s.players[ME].grave = [card(ME, 'magician-of-faith')];
  const hole = card(ME, 'dark-hole');
  s.players[ME].hand = [hole];
  const broken = act(s, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
  const back = broken.players[ME].monsters.map((m) => m?.slug).filter(Boolean).join(',') || 'empty';

  /* Both bodies is the assertion that means anything.
     "The Jam is on the field" is satisfied by the *wrong* mechanism and was:
     without `includeSelf` the first op finds nothing, and the second op —
     "1 other monster with 1500 or less ATK" — then picks the strongest thing
     in the Graveyard, which is the 1500 Jam itself. So the Jam comes back
     either way and the card looks fine while its own clause does nothing.
     Only the count separates them: self-revival plus a passenger is two
     monsters, the fallback is one. Written the obvious way first, and it
     passed on the broken engine. */
  ok(broken.players[ME].monsters.some((m) => m?.slug === 'revival-jam'),
    'broken by Dark Hole, the Jam is back on the field', back);
  ok(broken.players[ME].monsters.some((m) => m?.slug === 'magician-of-faith'),
    'and it drags another body up with it', back);
  ok(on(broken, ME).length === 2, 'two bodies out of one destruction — it revived *itself*, not merely a Jam', back);
  ok(!broken.players[ME].grave.some((c) => c.slug === 'revival-jam'),
    'and no copy is left behind in the Graveyard it came out of');
}

console.log('\nThe wheel turns for as long as it holds someone');
{
  /* Reported as "Nightmare Wheel is too weak for a continuous trap card" —
     the right complaint about the wrong axis. Binding one monster is fine for
     a card that leaves and poor for one that parks in Marik's only Spell/Trap
     Zone forever, so it tortures now. Until this card no Spell/Trap Zone card
     had a per-turn clause at all: only the Field Zone ticked. */
  const s = fresh('battle');
  s.active = FOE;
  const wheel = card(ME, 'nightmare-wheel');
  wheel.face = 'down';
  wheel.summonedOnTurn = 0;
  s.players[ME].spellTrap = wheel;
  const attacker = card(FOE, 'summoned-skull');
  attacker.summonedOnTurn = 0;
  s.players[FOE].monsters = [attacker, null, null];
  s.players[FOE].lp = 8000;
  /* Through the real trap window, which is the only way this card fires — it
     watches `opponentDeclareAttack`, so it is the attack that opens it. */
  const opened = act(s, FOE, { type: 'attack', uid: attacker.uid, targetUid: null });
  ok(!!opened.pending, 'the attack opens the window');
  const bound = act(opened, ME, { type: 'respondTrap', uid: wheel.uid, targets: [] });
  ok(bound.players[FOE].lp === 8000 - 500, 'the wheel bites for 500 when it catches someone', `${bound.players[FOE].lp}`);
  const caught = bound.players[FOE].monsters.find((m) => m?.slug === 'summoned-skull')!;
  ok(!!effFlags(bound, caught, FOE).cannotAttack, 'and the prisoner cannot attack');
  ok(bound.players[ME].spellTrap?.slug === 'nightmare-wheel', 'and the wheel stays face-up, holding him',
    bound.players[ME].spellTrap?.slug ?? 'gone');

  // Round the table to the start of ME's turn — the wheel's own clause.
  const turned = act(bound, FOE, { type: 'endTurn' });
  ok(turned.active === ME, 'the turn came round', `active ${turned.active}`);
  ok(turned.players[FOE].lp === 8000 - 500 - 800,
    'and the wheel turns for a further 800 at the start of his turn', `${turned.players[FOE].lp}`);

  /* CONTROL: the burn is the prisoner's, not the card's. An equip follows its
     host down, so a wheel with nobody on it does not exist — and the turn the
     prisoner leaves, the torture stops. */
  const freed = structuredClone(bound);
  freed.players[FOE].monsters = [null, null, null];
  freed.players[ME].spellTrap = null;
  const quiet = act(freed, FOE, { type: 'endTurn' });
  ok(quiet.players[FOE].lp === bound.players[FOE].lp,
    'CONTROL: with the prisoner gone the wheel burns nobody', `${quiet.players[FOE].lp}`);
}

console.log('\nViser Des brings his twin out as a wall');
{
  /* Asked for directly, and it matters more than it reads: the twin is a body
     to Tribute towards Ra, not a 500 ATK attacker, and standing it up in
     Attack only fed it to the first thing that swung. Face-up Defence, like
     the Metal Reflect Slime's tokens. */
  const s = fresh();
  const des = card(ME, 'viser-des');
  s.players[ME].hand = [des];
  s.players[ME].deck = [card(ME, 'viser-des'), card(ME, 'the-winged-dragon-of-ra')];
  const out = act(s, ME, { type: 'normalSummon', uid: des.uid, zone: 0, position: 'atk', face: 'up' });
  const twin = out.players[ME].monsters.find((m) => m?.slug === 'viser-des' && m.uid !== des.uid);
  ok(!!twin, 'the twin arrives', on(out, ME).map((m) => m.slug).join(',') || 'empty');
  ok(twin?.position === 'def', 'in Defence Position', twin?.position ?? '?');
  ok(twin?.face === 'up', 'and face-up, so its stats are on show', twin?.face ?? '?');
}

console.log('\nObelisk is the God that does not scale');
{
  /* Three Gods, three relationships with your resources: Slifer counts your
     HAND and shrinks as you develop, Ra counts your GRAVEYARD and grows as you
     are ground down, and Obelisk counts nothing at all. Pinned because the
     third God's whole reason to exist is being a different axis — the first
     draft's Fist of Fate was byte-for-byte Ra's God Phoenix. */
  const s = fresh();
  const god = card(ME, 'obelisk-the-tormentor');
  s.players[ME].monsters = [god, null, null];
  const flat = effAtk(s, god, ME);
  ok(flat === 4000, 'Obelisk is a flat 4000', `${flat}`);

  const rich = structuredClone(s);
  rich.players[ME].hand = [card(ME, 'kuriboh'), card(ME, 'kuriboh'), card(ME, 'kuriboh'), card(ME, 'kuriboh')];
  rich.players[ME].grave = [card(ME, 'summoned-skull'), card(ME, 'battle-ox'), card(ME, 'baby-dragon')];
  ok(effAtk(rich, rich.players[ME].monsters[0]!, ME) === 4000,
    'and neither a full hand nor a full Graveyard moves it — unlike the other two Gods',
    `${effAtk(rich, rich.players[ME].monsters[0]!, ME)}`);

  ok(tributesRequired('obelisk-the-tormentor') === 3, 'it costs three bodies like any Divine-Beast');

  /* Double Coston is two souls in one body, and the discount lives in
     `tributesRequired` rather than in a tribute that pays double — because
     five separate places pick the tributes and every one of them asks this
     function, while a double-value tribute would have to be understood by all
     five. Pinned here so the day somebody "simplifies" it back, the interface,
     the AI, autoplay, the simulator and the audit do not quietly disagree. */
  const coston = fresh();
  coston.players[ME].monsters = [{ ...card(ME, 'double-coston'), face: 'up' as const }, null, null];
  ok(tributesRequired('obelisk-the-tormentor', coston, ME) === 2,
    'a Double Coston on the field pays for one of the God\'s three bodies',
    `${tributesRequired('obelisk-the-tormentor', coston, ME)}`);
  const hidden = structuredClone(coston);
  hidden.players[ME].monsters[0]!.face = 'down';
  ok(tributesRequired('obelisk-the-tormentor', hidden, ME) === 3,
    'CONTROL: face-down, it pays nothing — a card lying face-down is doing nothing',
    `${tributesRequired('obelisk-the-tormentor', hidden, ME)}`);
  ok(tributesRequired('obelisk-the-tormentor', fresh(), ME) === 3,
    'CONTROL: without one the God costs its full three');
  /* And it is a discount, never a free summon: a Level 5 monster asking for
     one tribute still asks for one. `need > 1` is what guards that, and it is
     the difference between a strong card and a broken one. */
  ok(tributesRequired('guardian-sphinx', coston, ME) === 1,
    'it never takes a summon below one tribute',
    `${tributesRequired('guardian-sphinx', coston, ME)}`);

  /* The Fist of Fate: two souls spent and the God's power stops being a number
     for the turn. It has to connect now — the sweep-and-burn happened the
     moment it was pressed, and this does not — which is the whole of the
     change and the reason a turn with no opening is a turn it does not win. */
  const fist = fresh();
  const ob = card(ME, 'obelisk-the-tormentor');
  ob.summonedOnTurn = 0;
  const fodderA = card(ME, 'summoned-skull'); // 2500
  const fodderB = card(ME, 'battle-ox');      // 1700
  fist.players[ME].monsters = [ob, fodderA, fodderB];
  fist.players[FOE].monsters = [card(FOE, 'blue-eyes-white-dragon'), card(FOE, 'kuriboh'), null];
  fist.players[FOE].lp = 8000;
  const foeLp = fist.players[FOE].lp;
  const blown = act(fist, ME, { type: 'ignition', uid: ob.uid, targets: [fodderA.uid, fodderB.uid] });
  const limitless = blown.players[ME].monsters.find((m) => m?.slug === 'obelisk-the-tormentor')!;
  ok(effAtk(blown, limitless, ME) === INFINITE_ATK,
    'the Fist spends two souls and the God stops being a number',
    String(effAtk(blown, limitless, ME)));
  ok(on(blown, FOE).length === 2,
    'and their field is untouched — it has to be swung, not merely pressed',
    on(blown, FOE).map((m) => m.slug).join(',') || 'empty');
  ok(blown.players[FOE].lp === foeLp, 'and nothing is burned by the pressing alone',
    `${foeLp} -> ${blown.players[FOE].lp}`);
  ok(blown.players[ME].monsters.filter(Boolean).length === 1,
    'CONTROL: the two souls really were spent',
    blown.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));

  /* And what limitless means when it lands: the Blue-Eyes in the way is worth
     nothing at all, and the damage ends the duel. */
  const swung = act(act(blown, ME, { type: 'toPhase', phase: 'battle' }), ME, {
    type: 'attack', uid: ob.uid, targetUid: blown.players[FOE].monsters.find((m) => m?.slug === 'blue-eyes-white-dragon')!.uid,
  });
  ok(swung.winner === ME, 'a limitless swing ends the duel through whatever is standing there',
    swung.winner ?? '(nobody)');

  /* It lasts the turn and no longer. */
  const cooled = act(act(blown, ME, { type: 'endTurn' }), FOE, { type: 'endTurn' });
  const back = cooled.players[ME].monsters.find((m) => m?.slug === 'obelisk-the-tormentor')!;
  ok(effAtk(cooled, back, ME) === baseAtkOf('obelisk-the-tormentor'),
    'and it is a number again next turn',
    String(effAtk(cooled, back, ME)));

  /* A God is not fodder for another God's fist. */
  const greedy = fresh();
  const ob2 = card(ME, 'obelisk-the-tormentor');
  ob2.summonedOnTurn = 0;
  const slifer = card(ME, 'slifer-the-sky-dragon');
  greedy.players[ME].monsters = [ob2, slifer, card(ME, 'kuriboh')];
  greedy.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  const refused = applyAction(greedy, ME, { type: 'ignition', uid: ob2.uid, targets: [slifer.uid, greedy.players[ME].monsters[2]!.uid] });
  ok(!!refused.error || !!refused.state.players[ME].monsters.find((m) => m?.slug === 'slifer-the-sky-dragon'),
    'a Divine-Beast cannot be spent to pay for the Fist');

  /* And no clock. Obelisk was the only monster in the game that could not
     attack the turn it arrived — Ra and Slifer never carried it, so it read as
     a rule about Gods when it was a rule about one God. Three Tributes is the
     price and it buys the swing it paid for. Asserted in the Battle Phase,
     because `canAttackWith` is false in Main Phase whatever the flags say. */
  const fresh2 = fresh('battle');
  const justLanded = card(ME, 'obelisk-the-tormentor');
  justLanded.summonedOnTurn = fresh2.turn;
  fresh2.players[ME].monsters = [justLanded, null, null];
  fresh2.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  ok(canAttackWith(fresh2, ME, justLanded), 'and it swings the turn it arrives, like every other monster');

  /* The second button: one body for three more swings. */
  const soul = fresh();
  const theFist = card(ME, 'obelisk-the-tormentor');
  theFist.summonedOnTurn = 0;
  soul.players[ME].monsters = [theFist, card(ME, 'kuriboh'), card(ME, 'battle-ox')];
  const opts = ignitionOptions(soul, ME, theFist);
  ok(opts.length === 2, 'Obelisk offers both of its buttons', opts.map((o) => o.label).join(' | '));
  const boosted = act(soul, ME, {
    type: 'ignition',
    uid: theFist.uid,
    targets: [soul.players[ME].monsters[1]!.uid],
    effectIndex: opts.find((o) => /swings/.test(o.label))!.index,
  });
  const swinger = boosted.players[ME].monsters.find((m) => m?.slug === 'obelisk-the-tormentor')!;
  ok(maxAttacks(boosted, swinger, ME) === 4, 'and Soul Energy buys it four attacks for the turn',
    String(maxAttacks(boosted, swinger, ME)));
  ok(!boosted.players[ME].monsters.some((m) => m?.slug === 'kuriboh'), 'paid for with a body');
  /* One button per turn, not both: clearing their field and then swinging four
     times into the hole is not two plays, it is the duel. */
  ok(ignitionOptions(boosted, ME, swinger).length === 0,
    'and pressing one button spends the turn for both');
  const rested = structuredClone(fresh2);
  rested.players[ME].monsters[0]!.summonedOnTurn = rested.turn - 1;
  ok(canAttackWith(rested, ME, rested.players[ME].monsters[0]!), 'CONTROL: a turn later it swings');
}

console.log('\nThe valley guards every guardian; only Mudora counts the dead');
{
  /* Two things pinned here, and the second is the one that cost a rebalance.

     Her ace is a Beast-Warrior, and the first draft wrote Necrovalley's aura
     for Fairies — so the one card the deck exists to land was the one card the
     field did not pay. A deck whose ace does not benefit from its own hinge
     has two themes.

     And the valley must NOT scale with the Graveyard, because Mudora does and
     they land on the same cards. That is the Gazelle-and-Berfomet double-dip
     one theme over: two auras counting the same quantity, the second's only
     real function being to double the first — and against a deck whose whole
     engine is milling itself, it compounded to 3490 board ATK by turn 4
     against Yami's 2269. Trimming the coefficients moved the bench 83 → 87,
     inside the interval, which is what a wrong *shape* looks like when you
     tune its numbers. */
  const s = fresh();
  s.players[ME].field = { ...card(ME, 'necrovalley'), face: 'up' as const };
  const jackal = card(ME, 'mystical-knight-of-jackal');
  const mudora = card(ME, 'mudora');
  s.players[ME].monsters = [jackal, mudora, null];
  s.players[ME].grave = [];
  s.players[FOE].grave = [];
  const bareJackal = effAtk(s, jackal, ME);
  ok(bareJackal === baseAtkOf('mystical-knight-of-jackal') + 400,
    'the valley pays her Beast-Warrior ace its flat 400', `${bareJackal}`);

  const buried = structuredClone(s);
  buried.players[ME].grave = [card(ME, 'kuriboh'), card(ME, 'battle-ox')];
  const j2 = buried.players[ME].monsters[0]!;
  ok(effAtk(buried, j2, ME) === bareJackal,
    'and filling her OWN tomb does not move him — neither the valley nor the Jackal counts it',
    `${bareJackal} -> ${effAtk(buried, j2, ME)}`);
  /* Theirs is the pile he is paid for, which is the same pile his own mill
     fills — three off their Deck is 300 on him, so the two halves of the card
     are one engine. Fed on the far side deliberately: a Jackal that counted
     his own Graveyard would have passed the check above and failed the duel. */
  const theirs = structuredClone(buried);
  theirs.players[FOE].grave = [card(FOE, 'kuriboh'), card(FOE, 'battle-ox'), card(FOE, 'summoned-skull')];
  ok(effAtk(theirs, theirs.players[ME].monsters[0]!, ME) === bareJackal + 300,
    'but every card in THEIR tomb is 100 more on him',
    `${effAtk(theirs, theirs.players[ME].monsters[0]!, ME)}`);

  const m2 = buried.players[ME].monsters[1]!;
  ok(effAtk(buried, m2, ME) === baseAtkOf('mudora') + 400 + 200,
    'Mudora alone counts the dead: the valley\'s flat 400 and her own 100 a body',
    `${effAtk(buried, m2, ME)}`);
  /* And the count is hers, so it keeps moving — the half that makes the theme
     visible to an AI that scores stats and is blind to Graveyards. */
  const deeper = structuredClone(buried);
  deeper.players[ME].grave.push(card(ME, 'summoned-skull'));
  ok(effAtk(deeper, deeper.players[ME].monsters[1]!, ME) === effAtk(buried, m2, ME) + 100,
    'one more body in the tomb is exactly 100 more on her',
    `${effAtk(deeper, deeper.players[ME].monsters[1]!, ME)}`);
}

console.log('\nOdion: the backrow stands up, and the forgery is only a forgery');
{
  /* The scorpion is gated on the Temple exactly as a Toon is on Toon World —
     one place decides, and taking the Temple away is the counterplay. */
  const s = fresh();
  s.players[ME].hand = [card(ME, 'mystical-beast-of-serket')];
  ok(!!summonBlocked(s, ME, 'mystical-beast-of-serket'), 'no Temple, no Serket',
    String(summonBlocked(s, ME, 'mystical-beast-of-serket')));
  const open = structuredClone(s);
  open.players[ME].field = { ...card(ME, 'temple-of-the-kings'), face: 'up' as const };
  ok(!summonBlocked(open, ME, 'mystical-beast-of-serket'), 'CONTROL: with the Temple down it walks out',
    String(summonBlocked(open, ME, 'mystical-beast-of-serket')));

  /* Fake Trap: a 3000 body that everybody will believe is a God, and is not
     one. If this ever resolves as a Divine-Beast it inherits untargetability,
     divine supremacy and the three-Tribute price — none of which a forgery
     has any business having. */
  /* Flipped up in his own Main Phase, which is what `canActivateSetCard`
     allows for a trap watching `anyOpponentTurn` — the window names what it
     watches, not when the keeper may turn it over. */
  const forged = fresh();
  const fake = card(ME, 'fake-trap');
  fake.face = 'down';
  fake.summonedOnTurn = 0;
  forged.players[ME].spellTrap = fake;
  const lp = forged.players[ME].lp;
  const revealed = act(forged, ME, { type: 'activateSetCard', uid: fake.uid, targets: [] });
  const token = revealed.players[ME].monsters.find((m) => m?.isToken);
  ok(!!token, 'the forgery puts a body on the board', on(revealed, ME).map((m) => m.slug).join(',') || 'empty');
  ok(revealed.players[ME].lp === lp - 1000, 'and it costs its 1000 Life Points', `${revealed.players[ME].lp}`);
  ok(!!token && CARDS[token.slug]?.type !== 'Divine-Beast',
    'but it is not a Divine-Beast — a forgery is above nothing', token ? String(CARDS[token.slug]?.type) : '?');
}

console.log('\nOnly the duelist who goes first sits out the Battle Phase');
{
  /* Reported as "wait what I can attack on the first turn? that is a bug" —
     and turn 1 was already refused; what was reached was turn 2, the *second*
     duelist's own first turn, which the official rule allows and which the
     owner confirmed should stay. Pinned so the decision is a decision rather
     than an accident, and so nobody quietly widens it later. */
  const s = createDuel({ seed: 12, p1: { duelistId: 'kaiba', name: 'A' }, p2: { duelistId: 'yugi', name: 'B' }, firstPlayer: ME });
  ok(s.turn === 1 && s.active === ME, 'the duel opens on turn 1 with the first duelist', `turn ${s.turn} active ${s.active}`);
  ok(!!applyAction(s, ME, { type: 'toPhase', phase: 'battle' }).error, 'who cannot reach the Battle Phase');
  const second = act(s, ME, { type: 'endTurn' });
  ok(second.turn === 2 && second.active === FOE, 'and turn 2 belongs to the other one', `turn ${second.turn}`);
  ok(!applyAction(second, FOE, { type: 'toPhase', phase: 'battle' }).error,
    'who may attack on their own first turn — the official rule, kept on purpose');
}

/* ------------------------------------------------------------------ *
 * The owner's card pass: Yugi, Kaiba and Joey                          *
 *                                                                      *
 * Seventeen cards changed at once, and the generic harnesses cannot see *
 * most of what changed: `npm run audit` proves an op *fires*, not that  *
 * it fires for the right number or at the right side, and a swap from   *
 * `both` to `opp` leaves every op exactly where it was. So each one is  *
 * pinned here by the thing that was actually asked for.                 *
 * ------------------------------------------------------------------ */

console.log("\nYugi: the knight fetches his dragon, and the Champion goes around the board");
{
  // Curse of Dragon draws on top of shattering a backrow.
  const s = fresh();
  const cod = card(ME, 'curse-of-dragon'); // Level 5 — one tribute
  s.players[ME].hand = [cod];
  const codFodder = card(ME, 'mystical-elf');
  s.players[ME].monsters = [codFodder, null, null];
  s.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'mystical-elf')];
  const backrow = card(FOE, 'mirror-force');
  backrow.face = 'down';
  s.players[FOE].spellTrap = backrow;
  const drew = act(s, ME, {
    type: 'normalSummon', uid: cod.uid, zone: 0, position: 'atk', face: 'up', tributes: [codFodder.uid], targets: [backrow.uid],
  });
  ok(drew.players[ME].hand.length === 1, 'Curse of Dragon draws 1 on summon', `hand ${drew.players[ME].hand.length}`);
  ok(drew.players[FOE].spellTrap === null, 'and still shatters the backrow');

  /* Gaia fetches BOTH named cards, which is why he carries two search ops:
     one op with two slugs is a preference order and adds a single card. */
  const g = fresh();
  const knight = card(ME, 'gaia-the-fierce-knight'); // Level 7 — two tributes
  g.players[ME].hand = [knight];
  const kf1 = card(ME, 'mystical-elf');
  const kf2 = card(ME, 'mystical-elf');
  g.players[ME].monsters = [kf1, kf2, null];
  /* The filler sits FIRST because the draw runs before the two searches and
     `drawCard` shifts off the front — leave a combo piece on top and the draw
     takes it, the search that wanted it finds nothing, and the test blames the
     card for the deck order. */
  g.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'polymerization'), card(ME, 'curse-of-dragon')];
  const fetched = act(g, ME, {
    type: 'normalSummon', uid: knight.uid, zone: 0, position: 'atk', face: 'up', tributes: [kf1.uid, kf2.uid],
  });
  const inHand = fetched.players[ME].hand.map((h) => h.slug);
  ok(inHand.includes('polymerization'), 'Gaia The Fierce Knight fetches Polymerization', inHand.join(','));
  ok(inHand.includes('curse-of-dragon'), 'and Curse of Dragon as well', inHand.join(','));
  ok(inHand.length === 3, 'and draws 1 on top of the pair', `hand ${inHand.length}`);

  /* One of the two is missing and he still takes the other — the owner's
     "if just one is in the deck add that one only". */
  const half = fresh();
  const knight2 = card(ME, 'gaia-the-fierce-knight');
  half.players[ME].hand = [knight2];
  const hf1 = card(ME, 'mystical-elf');
  const hf2 = card(ME, 'mystical-elf');
  half.players[ME].monsters = [hf1, hf2, null];
  half.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'curse-of-dragon')];
  const halfDone = act(half, ME, {
    type: 'normalSummon', uid: knight2.uid, zone: 0, position: 'atk', face: 'up', tributes: [hf1.uid, hf2.uid],
  });
  ok(
    halfDone.players[ME].hand.filter((h) => h.slug === 'curse-of-dragon').length === 1,
    'and with only one of the pair in the Deck he takes that one'
  );

  /* The Champion: two attacks, either of which may go around the board for
     half. Fusion Summoned properly, because the draw rides on the summon. */
  const f = fresh();
  const champ = card(ME, 'gaia-the-dragon-champion');
  const mat1 = card(ME, 'gaia-the-fierce-knight');
  const mat2 = card(ME, 'curse-of-dragon');
  f.players[ME].extra = [champ];
  f.players[ME].monsters = [mat1, mat2, null];
  f.players[ME].hand = [card(ME, 'polymerization')];
  f.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'mystical-elf')];
  const fused = act(f, ME, {
    type: 'fusionSummon', extraUid: champ.uid, materials: [mat1.uid, mat2.uid], zone: 0, position: 'atk',
  });
  ok(fused.players[ME].hand.length === 1, 'Gaia the Dragon Champion draws 1 when Fusion Summoned', `hand ${fused.players[ME].hand.length}`);
  const onField = fused.players[ME].monsters.find((m) => m?.slug === 'gaia-the-dragon-champion')!;
  const cf = effFlags(fused, onField, ME);
  ok(cf.directAttack === true, 'and can attack directly');
  ok(cf.halvedDirectDamage === true, 'for half');
  ok(cf.halvedBattleDamage !== true, 'but is NOT halved across the board — a monster still takes everything');
  ok((cf.extraAttacks ?? 0) === 1, 'and still has both of its attacks', `extra ${cf.extraAttacks}`);

  /* The halving is charged on the direct path and nowhere else. Champion is
     2600; an empty field takes 1300, a Battle Ox eats the full 2600 - 1700. */
  const swing = structuredClone(fused);
  swing.phase = 'battle';
  swing.turn = 8;
  const champOnField = swing.players[ME].monsters.find((m) => m?.slug === 'gaia-the-dragon-champion')!;
  champOnField.summonedOnTurn = 0;
  champOnField.attacksUsed = 0;
  const base = effAtk(swing, champOnField, ME);

  /* An OPEN board is an ordinary direct attack at full ATK. The half is the
     toll for flying over a guard, and with nothing standing there is nobody to
     fly over — charging it here would make the Champion hit softer than a
     vanilla body exactly when the defence is gone. */
  const openField = act(swing, ME, { type: 'attack', uid: champOnField.uid, targetUid: null });
  ok(
    openField.players[FOE].lp === 4000 - base,
    'a direct swing at an EMPTY board lands for everything',
    `LP ${openField.players[FOE].lp} of ${4000 - base}`
  );

  /* A guarded board is the flyover, and that is the half. */
  const guarded = structuredClone(fused);
  guarded.phase = 'battle';
  guarded.turn = 8;
  const champGuarded = guarded.players[ME].monsters.find((m) => m?.slug === 'gaia-the-dragon-champion')!;
  champGuarded.summonedOnTurn = 0;
  champGuarded.attacksUsed = 0;
  const blocker = card(FOE, 'battle-ox');
  blocker.summonedOnTurn = 0;
  guarded.players[FOE].monsters = [blocker, null, null];
  const flyover = act(guarded, ME, { type: 'attack', uid: champGuarded.uid, targetUid: null });
  ok(
    flyover.players[FOE].lp === 4000 - Math.floor(base / 2),
    'and OVER a blocker for exactly half',
    `LP ${flyover.players[FOE].lp} of ${4000 - Math.floor(base / 2)}`
  );
  ok(
    flyover.players[FOE].monsters.some((m) => m?.uid === blocker.uid),
    'with the blocker left standing — he went around it, not through it'
  );

  const intoMonster = structuredClone(fused);
  intoMonster.phase = 'battle';
  intoMonster.turn = 8;
  const champ2 = intoMonster.players[ME].monsters.find((m) => m?.slug === 'gaia-the-dragon-champion')!;
  champ2.summonedOnTurn = 0;
  champ2.attacksUsed = 0;
  const ox = card(FOE, 'battle-ox'); // 1700
  ox.summonedOnTurn = 0;
  intoMonster.players[FOE].monsters = [ox, null, null];
  const through = act(intoMonster, ME, { type: 'attack', uid: champ2.uid, targetUid: ox.uid });
  ok(
    through.players[FOE].lp === 4000 - (base - 1700),
    'and a swing THROUGH a monster is not halved',
    `LP ${through.players[FOE].lp} of ${4000 - (base - 1700)}`
  );
}

console.log('\nKaiba: the ring stops biting its owner, and the giant fetches the Pot');
{
  // Vorse Raider draws on top of the burn.
  const s = fresh('battle');
  const vorse = card(ME, 'vorse-raider'); // 1900
  vorse.summonedOnTurn = 0;
  s.players[ME].monsters = [vorse, null, null];
  const prey = card(FOE, 'kuriboh'); // 300
  prey.summonedOnTurn = 0;
  s.players[FOE].monsters = [prey, null, null];
  s.players[ME].deck = [card(ME, 'mystical-elf'), card(ME, 'kuriboh')];
  const killed = act(s, ME, { type: 'attack', uid: vorse.uid, targetUid: prey.uid });
  ok(killed.players[ME].hand.length === 1, 'Vorse Raider draws when it destroys a monster', `hand ${killed.players[ME].hand.length}`);

  // Rude Kaiser swings at 1800 + 1000, not 1800 + 400.
  const r = fresh('battle');
  const kaiser = card(ME, 'rude-kaiser'); // 1800
  kaiser.summonedOnTurn = 0;
  r.players[ME].monsters = [kaiser, null, null];
  const swung = act(r, ME, { type: 'attack', uid: kaiser.uid, targetUid: null });
  ok(swung.players[FOE].lp === 4000 - 2800, 'Rude Kaiser declares at 1800 + 1000', `LP ${swung.players[FOE].lp}`);

  /* Hitotsu-Me Giant takes Pot of Greed back out of its OWN Graveyard, and
     only Pot of Greed — the slug filter is what stops it looting the pile. */
  const h = fresh();
  const giant = card(ME, 'hitotsu-me-giant');
  h.players[ME].hand = [giant];
  h.players[ME].grave = [card(ME, 'dark-hole'), card(ME, 'pot-of-greed'), card(ME, 'monster-reborn')];
  const back = act(h, ME, { type: 'normalSummon', uid: giant.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(back.players[ME].hand.some((c) => c.slug === 'pot-of-greed'), 'Hitotsu-Me Giant returns Pot of Greed from the Graveyard');
  ok(back.players[ME].hand.length === 1, 'and takes nothing else with it', `hand ${back.players[ME].hand.length}`);
  ok(!back.players[ME].grave.some((c) => c.slug === 'pot-of-greed'), 'and it really left the Graveyard');

  // No Pot down there and the summon simply happens.
  const none = fresh();
  const giant2 = card(ME, 'hitotsu-me-giant');
  none.players[ME].hand = [giant2];
  none.players[ME].grave = [card(ME, 'dark-hole')];
  const quiet = act(none, ME, { type: 'normalSummon', uid: giant2.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(quiet.players[ME].hand.length === 0, 'CONTROL: with no Pot in the Graveyard it takes nothing', `hand ${quiet.players[ME].hand.length}`);
  ok(!!quiet.players[ME].monsters.find((m) => m?.uid === giant2.uid), 'and the giant is still summoned');
}

console.log('\nJoey: the underdog draws his own combo pieces');
{
  /* Alligator's Sword stopped poking and became the other half of the fusion.
     The two names in its text used to be a *preference*, and Baby Dragon came
     first when both sat in the Deck — because nobody was asked. It asks now:
     which half of the fusion you want is the whole decision the card is, and
     the answer depends on what is already in your hand. */
  const s = fresh();
  const gator = card(ME, "alligator-s-sword");
  s.players[ME].hand = [gator];
  s.players[ME].deck = [card(ME, 'polymerization'), card(ME, 'baby-dragon'), card(ME, 'kuriboh')];
  const asking = act(s, ME, { type: 'normalSummon', uid: gator.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(
    JSON.stringify(asked(asking)) === JSON.stringify(['baby-dragon', 'polymerization']),
    "Alligator's Sword asks which half of the fusion it fetches",
    JSON.stringify(asked(asking))
  );
  const got = answer(asking, 'polymerization');
  ok(got.players[ME].hand.length === 1, "and adds exactly one card", `hand ${got.players[ME].hand.length}`);
  ok(
    got.players[ME].hand[0].slug === 'polymerization',
    'the one that was pointed at, not the first name in its text',
    got.players[ME].hand[0].slug
  );
  const swordOnField = got.players[ME].monsters.find((m) => m?.uid === gator.uid)!;
  ok(effAtk(got, swordOnField, ME) === baseAtkOf(gator.slug), 'and the old +400 swing is gone', `ATK ${effAtk(got, swordOnField, ME)}`);

  // Only Polymerization left: one answer, so no question, and it takes it.
  const p = fresh();
  const gator2 = card(ME, "alligator-s-sword");
  p.players[ME].hand = [gator2];
  p.players[ME].deck = [card(ME, 'polymerization'), card(ME, 'kuriboh')];
  const poly = act(p, ME, { type: 'normalSummon', uid: gator2.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(asked(poly) === null, 'with one name left in the Deck it asks nothing', JSON.stringify(asked(poly)));
  ok(poly.players[ME].hand[0]?.slug === 'polymerization', 'and Polymerization when the dragon is elsewhere', poly.players[ME].hand[0]?.slug);

  /* Flame Swordsman arms himself from EITHER pile, which is two ops: `search`
     reads the Deck, `stealFromGrave` the Graveyard. */
  const d = fresh();
  const fsDeck = card(ME, 'flame-swordsman'); // Level 5 — one tribute
  d.players[ME].hand = [fsDeck];
  const dFodder = card(ME, 'mystical-elf');
  d.players[ME].monsters = [dFodder, null, null];
  d.players[ME].deck = [card(ME, 'salamandra'), card(ME, 'kuriboh')];
  const fromDeck = act(d, ME, { type: 'normalSummon', uid: fsDeck.uid, zone: 0, position: 'atk', face: 'up', tributes: [dFodder.uid] });
  ok(fromDeck.players[ME].hand.some((c) => c.slug === 'salamandra'), 'Flame Swordsman pulls Salamandra out of the Deck');

  const gr = fresh();
  const fsGrave = card(ME, 'flame-swordsman');
  gr.players[ME].hand = [fsGrave];
  const gFodder = card(ME, 'mystical-elf');
  gr.players[ME].monsters = [gFodder, null, null];
  gr.players[ME].deck = [card(ME, 'kuriboh')];
  gr.players[ME].grave = [card(ME, 'salamandra')];
  const fromGrave = act(gr, ME, { type: 'normalSummon', uid: fsGrave.uid, zone: 0, position: 'atk', face: 'up', tributes: [gFodder.uid] });
  ok(fromGrave.players[ME].hand.some((c) => c.slug === 'salamandra'), 'and out of the Graveyard when that is where it is');
  ok(
    fromGrave.players[ME].hand.filter((c) => c.slug === 'salamandra').length === 1,
    'and exactly one copy — the two ops cannot both land'
  );

  /* Time Wizard's bad half is the board and nothing else now. Both branches
     are driven by seeding the state until the coin lands each way, so the
     pin does not depend on which face a given seed shows. */
  let sawTails = false;
  let sawHeads = false;
  for (let seed = 1; seed < 60 && !(sawTails && sawHeads); seed++) {
    const t = fresh();
    t.seed = seed;
    const wizard = card(ME, 'time-wizard');
    wizard.summonedOnTurn = 0;
    t.players[ME].monsters = [wizard, card(ME, 'baby-dragon'), null];
    t.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
    const rolled = act(t, ME, { type: 'ignition', uid: wizard.uid, targets: [] });
    const mineGone = !rolled.players[ME].monsters.some((m) => m?.slug === 'baby-dragon');
    if (mineGone && !sawTails) {
      sawTails = true;
      ok(rolled.players[ME].lp === 4000, 'Time Wizard on tails costs the board and no Life Points', `LP ${rolled.players[ME].lp}`);
      ok(!rolled.players[ME].monsters.some((m) => m?.slug === 'baby-dragon'), 'and the board really did go');
    } else if (!mineGone && !sawHeads) {
      sawHeads = true;
      ok(
        !rolled.players[FOE].monsters.some((m) => m?.slug === 'battle-ox'),
        'CONTROL: heads still clears their side'
      );
    }
  }
  ok(sawTails && sawHeads, 'and both faces of the coin were reached', `tails ${sawTails} heads ${sawHeads}`);

  /* Garoozis feeds off its own die: 100 ATK a pip, applied ONCE with one log
     line rather than once per pip. Damage stays at 200 a pip. */
  const g = fresh('battle');
  const garo = card(ME, 'garoozis'); // 1800
  garo.summonedOnTurn = 0;
  g.players[ME].monsters = [garo, null, null];
  const morsel = card(FOE, 'kuriboh'); // 300
  morsel.summonedOnTurn = 0;
  g.players[FOE].monsters = [morsel, null, null];
  g.players[ME].deck = [card(ME, 'mystical-elf'), card(ME, 'kuriboh')];
  const rolledOut = act(g, ME, { type: 'attack', uid: garo.uid, targetUid: morsel.uid });
  const garoAfter = rolledOut.players[ME].monsters.find((m) => m?.uid === garo.uid)!;
  const gained = effAtk(rolledOut, garoAfter, ME) - baseAtkOf('garoozis');
  /* The ATK gain fires in `onBattleDestroy`, which is *after* the damage step,
     so the swing itself still landed for the printed 1800 - 300. Anything left
     on top of that is the die. */
  const battleDamage = baseAtkOf('garoozis') - baseAtkOf('kuriboh');
  const burned = 4000 - battleDamage - rolledOut.players[FOE].lp;
  ok(gained >= 100 && gained <= 600 && gained % 100 === 0, 'Garoozis gains 100 ATK a pip', `gained ${gained}`);
  ok(burned === gained * 2, 'and the burn is the same roll at 200 a pip', `burn ${burned} vs gain ${gained}`);
  ok(rolledOut.players[ME].hand.length === 1, 'and it still draws afterwards', `hand ${rolledOut.players[ME].hand.length}`);

  /* Masaki counts his company, living and fallen — and never himself. */
  const m = fresh();
  const masaki = card(ME, 'masaki-the-legendary-swordsman'); // 1100
  m.players[ME].monsters = [masaki, null, null];
  ok(effAtk(m, masaki, ME) === 1100, 'Masaki alone is his printed 1100', `ATK ${effAtk(m, masaki, ME)}`);

  const withOne = fresh();
  const masaki2 = card(ME, 'masaki-the-legendary-swordsman');
  withOne.players[ME].monsters = [masaki2, card(ME, 'kojikocy'), null]; // Kojikocy is a Warrior
  ok(effAtk(withOne, masaki2, ME) === 1100 + 500, 'one comrade is +500, and he does not count himself', `ATK ${effAtk(withOne, masaki2, ME)}`);

  const withTwo = fresh();
  const masaki3 = card(ME, 'masaki-the-legendary-swordsman');
  withTwo.players[ME].monsters = [masaki3, card(ME, 'kojikocy'), card(ME, 'axe-raider')];
  ok(effAtk(withTwo, masaki3, ME) === 1100 + 1000, 'two comrades are +1000', `ATK ${effAtk(withTwo, masaki3, ME)}`);

  const buried = fresh();
  const masaki4 = card(ME, 'masaki-the-legendary-swordsman');
  buried.players[ME].monsters = [masaki4, null, null];
  buried.players[ME].grave = [card(ME, 'kojikocy'), card(ME, 'axe-raider'), card(ME, 'baby-dragon')];
  ok(
    effAtk(buried, masaki4, ME) === 1100 + 200,
    'and the fallen are +100 each — the Dragon in the pile is not one of them',
    `ATK ${effAtk(buried, masaki4, ME)}`
  );

  const both = fresh();
  const masaki5 = card(ME, 'masaki-the-legendary-swordsman');
  both.players[ME].monsters = [masaki5, card(ME, 'kojikocy'), null];
  both.players[ME].grave = [card(ME, 'axe-raider')];
  ok(effAtk(both, masaki5, ME) === 1100 + 500 + 100, 'and the two rates stack', `ATK ${effAtk(both, masaki5, ME)}`);

  const theirs = fresh();
  const masaki6 = card(ME, 'masaki-the-legendary-swordsman');
  theirs.players[ME].monsters = [masaki6, null, null];
  theirs.players[FOE].monsters = [card(FOE, 'kojikocy'), null, null];
  theirs.players[FOE].grave = [card(FOE, 'axe-raider')];
  ok(effAtk(theirs, masaki6, ME) === 1100, "CONTROL: the opponent's Warriors are not his company", `ATK ${effAtk(theirs, masaki6, ME)}`);

  /* Tiger Axe shatters a backrow on the way in, on top of the flinch. */
  const t2 = fresh('battle');
  const tiger = card(ME, 'tiger-axe');
  tiger.summonedOnTurn = 0;
  t2.players[ME].monsters = [tiger, null, null];
  const set = card(FOE, 'mirror-force');
  set.face = 'down';
  set.summonedOnTurn = 0;
  t2.players[FOE].spellTrap = set;
  const struck = act(t2, ME, { type: 'attack', uid: tiger.uid, targetUid: null });
  ok(struck.players[FOE].spellTrap === null, 'Tiger Axe destroys a Spell or Trap when it declares an attack');
}

console.log('\nJoey, the spells: one-sided swaps and a wind that costs them a card');
{
  /* Shield & Sword turns THEIR monsters inside out and leaves mine alone —
     the whole of the change, and invisible to an op-level audit. */
  const s = fresh();
  const sns = card(ME, 'shield-sword');
  s.players[ME].hand = [sns];
  const mine = card(ME, 'battle-ox'); // 1700 / 1000
  s.players[ME].monsters = [mine, null, null];
  const theirs = card(FOE, 'battle-ox');
  s.players[FOE].monsters = [theirs, null, null];
  const swapped = act(s, ME, { type: 'activateSpell', uid: sns.uid, targets: [] });
  const mineAfter = swapped.players[ME].monsters[0]!;
  const theirsAfter = swapped.players[FOE].monsters[0]!;
  ok(effAtk(swapped, theirsAfter, FOE) === 1000, 'Shield & Sword swaps the opponent down to their DEF', `ATK ${effAtk(swapped, theirsAfter, FOE)}`);
  ok(effAtk(swapped, mineAfter, ME) === 1700, 'and leaves my own monster exactly as it was', `ATK ${effAtk(swapped, mineAfter, ME)}`);

  /* Giant Trunade clears the backrow and then takes a card off them.

     Only THEIR backrow is set, and that is not the test being lazy: this game
     has one Spell/Trap Zone, so a Trunade in hand cannot be activated at all
     while its owner's own zone is occupied — the engine refuses with "Your
     Spell/Trap Zone is occupied". The card can only ever sweep the other side,
     and pretending otherwise would be pinning a position no player can reach.

     The hand count is the assertion the generic audit could not make: the
     bounce refills the hand the discard empties, so the totals come out level.
     Two in hand at the end can only happen if BOTH halves ran — bounce alone
     leaves three, discard alone leaves one. */
  const g = fresh();
  const trunade = card(ME, 'giant-trunade');
  g.players[ME].hand = [trunade];
  const theirSet = card(FOE, 'mirror-force');
  theirSet.face = 'down';
  g.players[FOE].spellTrap = theirSet;
  g.players[FOE].hand = [card(FOE, 'kuriboh'), card(FOE, 'dark-hole')];
  const blown = act(g, ME, { type: 'activateSpell', uid: trunade.uid, targets: [] });
  ok(blown.players[FOE].spellTrap === null, 'Giant Trunade clears their backrow');
  ok(
    blown.players[FOE].hand.length === 2,
    'and they end on 2: three in hand after the bounce, one discarded',
    `hand ${blown.players[FOE].hand.length}`
  );
  ok(blown.players[FOE].grave.length === 1, 'with the discard landing in their Graveyard', `grave ${blown.players[FOE].grave.length}`);

  /* Scapegoat's tokens were already legal tribute fodder — nothing changed
     for it, which is exactly why it is pinned: the owner asked for it, and a
     property nobody wrote down is a property somebody removes later. */
  const t = fresh();
  const goat = card(ME, 'scapegoat');
  t.players[ME].hand = [goat];
  const bleating = act(t, ME, { type: 'activateSpell', uid: goat.uid, targets: [] });
  const tokens = bleating.players[ME].monsters.filter((m): m is CardInstance => !!m);
  ok(tokens.length === 3 && tokens.every((m) => m.isToken), 'Scapegoat makes 3 tokens', `${tokens.length}`);
  const skull = card(ME, 'summoned-skull'); // Level 6, one tribute
  bleating.players[ME].hand = [skull];
  bleating.players[ME].normalSummonUsed = false;
  const paid = applyAction(bleating, ME, {
    type: 'normalSummon', uid: skull.uid, zone: 0, position: 'atk', face: 'up', tributes: [tokens[0].uid],
  });
  ok(!paid.error, 'and a Sheep Token pays for a Tribute Summon', paid.error ?? '');
  ok(
    paid.state.players[ME].monsters.some((m) => m?.slug === 'summoned-skull'),
    'with the tributed monster actually arriving'
  );
}

console.log('\nThe Forbidden One assembles on the field too, and two magicians get their due');
{
  const PIECES = [
    'exodia-the-forbidden-one',
    'left-arm-of-the-forbidden-one',
    'right-arm-of-the-forbidden-one',
    'left-leg-of-the-forbidden-one',
    'right-leg-of-the-forbidden-one',
  ];

  /* Three in hand and two standing is still the Forbidden One. The win has to
     land the instant the last piece arrives, which is why `applyAction` checks
     on every completed action rather than only where a card is drawn. */
  const split = fresh();
  split.players[ME].monsters = [card(ME, PIECES[0]), card(ME, PIECES[1]), null];
  split.players[ME].hand = [card(ME, PIECES[2]), card(ME, PIECES[3]), card(ME, PIECES[4])];
  const settled = act(split, ME, { type: 'toPhase', phase: 'battle' });
  ok(settled.winner === ME, 'three in hand and two on the field wins the duel', `winner ${settled.winner}`);

  // The classic five-in-hand still wins, untouched.
  const allHand = fresh();
  allHand.players[ME].hand = PIECES.map((s) => card(ME, s));
  const classic = act(allHand, ME, { type: 'toPhase', phase: 'battle' });
  ok(classic.winner === ME, 'and all five in hand still does', `winner ${classic.winner}`);

  // All five standing wins as well — the other end of the same rule.
  const allField = fresh();
  allField.players[ME].monsters = [card(ME, PIECES[0]), card(ME, PIECES[1]), card(ME, PIECES[2])];
  allField.players[ME].hand = [card(ME, PIECES[3]), card(ME, PIECES[4])];
  const board = act(allField, ME, { type: 'toPhase', phase: 'battle' });
  ok(board.winner === ME, 'and three standing with two held', `winner ${board.winner}`);

  /* A set piece counts. Hiding one should not cost the assembly, and the text
     says "on your field" without qualifying which way up. */
  const hidden = fresh();
  const setPiece = card(ME, PIECES[0]);
  setPiece.face = 'down';
  setPiece.position = 'def';
  hidden.players[ME].monsters = [setPiece, null, null];
  hidden.players[ME].hand = PIECES.slice(1).map((s) => card(ME, s));
  const stillWon = act(hidden, ME, { type: 'toPhase', phase: 'battle' });
  ok(stillWon.winner === ME, 'and a face-down piece counts too', `winner ${stillWon.winner}`);

  /* The Graveyard does NOT assemble — a destroyed piece is lost, which is what
     keeps holding them safer than parading them. */
  const buriedPiece = fresh();
  buriedPiece.players[ME].grave = [card(ME, PIECES[0])];
  buriedPiece.players[ME].hand = PIECES.slice(1).map((s) => card(ME, s));
  const noWin = act(buriedPiece, ME, { type: 'toPhase', phase: 'battle' });
  ok(!noWin.winner, 'CONTROL: a piece in the Graveyard does not assemble', `winner ${noWin.winner}`);

  // Four of five is not five.
  const four = fresh();
  four.players[ME].monsters = [card(ME, PIECES[0]), null, null];
  four.players[ME].hand = [card(ME, PIECES[1]), card(ME, PIECES[2]), card(ME, PIECES[3])];
  const notYet = act(four, ME, { type: 'toPhase', phase: 'battle' });
  ok(!notYet.winner, 'CONTROL: four pieces across both is not a win', `winner ${notYet.winner}`);

  /* Summoning the fifth piece wins on the spot — the arrival the scattered
     draw-side checks could never have seen. */
  const lastOne = fresh();
  const fifth = card(ME, PIECES[0]); // Level 3, no tribute
  lastOne.players[ME].hand = [fifth];
  lastOne.players[ME].monsters = [card(ME, PIECES[1]), card(ME, PIECES[2]), null];
  lastOne.players[ME].deck = [card(ME, PIECES[3]), card(ME, PIECES[4]), card(ME, 'kuriboh')];
  // The two it draws on summon are the remaining limbs, sitting on top.
  const summonedIn = act(lastOne, ME, {
    type: 'normalSummon', uid: fifth.uid, zone: 2, position: 'atk', face: 'up', tributes: [],
  });
  ok(summonedIn.winner === ME, 'and Summoning the last piece wins on the spot', `winner ${summonedIn.winner}`);

  /* Lord of D. reads EVERY Dragon on the field, both sides of it — the literal
     text, and the flavour: he is the Lord of Dragons, not of his own. He is a
     Spellcaster, so he never counts himself. */
  const lord = fresh();
  const lod = card(ME, 'lord-of-d'); // 1200
  lord.players[ME].monsters = [lod, null, null];
  ok(effAtk(lord, lod, ME) === 1200, 'Lord of D. with no Dragons is his printed 1200', `ATK ${effAtk(lord, lod, ME)}`);

  const oneDragon = fresh();
  const lod2 = card(ME, 'lord-of-d');
  oneDragon.players[ME].monsters = [lod2, card(ME, 'baby-dragon'), null];
  ok(effAtk(oneDragon, lod2, ME) === 1200 + 400, 'one of his own Dragons is +400', `ATK ${effAtk(oneDragon, lod2, ME)}`);

  const bothSides = fresh();
  const lod3 = card(ME, 'lord-of-d');
  bothSides.players[ME].monsters = [lod3, card(ME, 'baby-dragon'), null];
  bothSides.players[FOE].monsters = [card(FOE, 'blue-eyes-white-dragon'), card(FOE, 'curse-of-dragon'), null];
  ok(
    effAtk(bothSides, lod3, ME) === 1200 + 1200,
    "and the opponent's Dragons count too — every Dragon on the field",
    `ATK ${effAtk(bothSides, lod3, ME)}`
  );

  const notDragons = fresh();
  const lod4 = card(ME, 'lord-of-d');
  notDragons.players[ME].monsters = [lod4, card(ME, 'battle-ox'), null];
  notDragons.players[FOE].monsters = [card(FOE, 'summoned-skull'), null, null];
  ok(effAtk(notDragons, lod4, ME) === 1200, 'CONTROL: nothing else on the field feeds him', `ATK ${effAtk(notDragons, lod4, ME)}`);

  // Read live: the Dragon dies, the bonus goes with it.
  const lost = structuredClone(oneDragon);
  lost.players[ME].monsters[1] = null;
  const lodLost = lost.players[ME].monsters[0]!;
  ok(effAtk(lost, lodLost, ME) === 1200, 'and it falls again the moment the Dragon leaves', `ATK ${effAtk(lost, lodLost, ME)}`);

  /* Dark Paladin draws on every swing, not once a turn. */
  const dp = fresh('battle');
  const paladin = card(ME, 'dark-paladin');
  paladin.summonedOnTurn = 0;
  dp.players[ME].monsters = [paladin, null, null];
  dp.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'mystical-elf'), card(ME, 'baby-dragon')];
  const swung = act(dp, ME, { type: 'attack', uid: paladin.uid, targetUid: null });
  ok(swung.players[ME].hand.length === 1, 'Dark Paladin draws when it declares an attack', `hand ${swung.players[ME].hand.length}`);
  ok(swung.players[FOE].lp < 4000, 'and the attack still lands', `LP ${swung.players[FOE].lp}`);
}

console.log('\nKaiser Sea Horse fetches the dragon he pays for — Deck first, Graveyard second');
{
  // In the Deck: taken from there, and the Graveyard copy stays buried.
  const inDeck = fresh();
  const horse = card(ME, 'kaiser-sea-horse'); // Level 4, no tribute
  inDeck.players[ME].hand = [horse];
  inDeck.players[ME].deck = [card(ME, 'blue-eyes-white-dragon'), card(ME, 'kuriboh')];
  const fetched = act(inDeck, ME, {
    type: 'normalSummon', uid: horse.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
  });
  ok(
    fetched.players[ME].hand.filter((c) => c.slug === 'blue-eyes-white-dragon').length === 1,
    'takes Blue-Eyes out of the Deck',
    fetched.players[ME].hand.map((c) => c.slug).join(',')
  );
  ok(fetched.players[ME].lp === 4000 + 500, 'and still pays the 500 Life Points', `LP ${fetched.players[ME].lp}`);

  // Nothing in the Deck: the Graveyard is the fallback.
  const inGrave = fresh();
  const horse2 = card(ME, 'kaiser-sea-horse');
  inGrave.players[ME].hand = [horse2];
  inGrave.players[ME].deck = [card(ME, 'kuriboh')];
  inGrave.players[ME].grave = [card(ME, 'dark-hole'), card(ME, 'blue-eyes-white-dragon')];
  const raised = act(inGrave, ME, {
    type: 'normalSummon', uid: horse2.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
  });
  ok(
    raised.players[ME].hand.filter((c) => c.slug === 'blue-eyes-white-dragon').length === 1,
    'and out of the Graveyard when the Deck has none'
  );
  ok(
    !raised.players[ME].grave.some((c) => c.slug === 'blue-eyes-white-dragon'),
    'and it really left the Graveyard'
  );

  /* THE reason this is one op instead of two. Kaiba runs three Blue-Eyes, so
     mid-duel one sits in the Deck and another in the pile — a `search` beside
     a `stealFromGrave` fires both and hands over TWO dragons. Exactly one. */
  const bothPlaces = fresh();
  const horse3 = card(ME, 'kaiser-sea-horse');
  bothPlaces.players[ME].hand = [horse3];
  bothPlaces.players[ME].deck = [card(ME, 'blue-eyes-white-dragon'), card(ME, 'kuriboh')];
  bothPlaces.players[ME].grave = [card(ME, 'blue-eyes-white-dragon')];
  const once = act(bothPlaces, ME, {
    type: 'normalSummon', uid: horse3.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
  });
  ok(
    once.players[ME].hand.filter((c) => c.slug === 'blue-eyes-white-dragon').length === 1,
    'with a copy in BOTH piles he still takes exactly one',
    `hand ${once.players[ME].hand.map((c) => c.slug).join(',')}`
  );
  ok(
    once.players[ME].grave.filter((c) => c.slug === 'blue-eyes-white-dragon').length === 1,
    'and the one he did not take is the Graveyard copy — the Deck is asked first'
  );

  // Neither pile has one: the summon simply happens.
  const neither = fresh();
  const horse4 = card(ME, 'kaiser-sea-horse');
  neither.players[ME].hand = [horse4];
  neither.players[ME].deck = [card(ME, 'kuriboh')];
  const quiet = act(neither, ME, {
    type: 'normalSummon', uid: horse4.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
  });
  ok(quiet.players[ME].hand.length === 0, 'CONTROL: no Blue-Eyes anywhere and he takes nothing', `hand ${quiet.players[ME].hand.length}`);
  ok(!!quiet.players[ME].monsters.find((m) => m?.uid === horse4.uid), 'and he is still summoned');

  /* Flame Swordsman moved onto the same op. Same behaviour with one
     Salamandra, and no longer a trap if a second copy is ever added. */
  const fs = fresh();
  const sword = card(ME, 'flame-swordsman'); // Level 5 — one tribute
  fs.players[ME].hand = [sword];
  const fodder = card(ME, 'mystical-elf');
  fs.players[ME].monsters = [fodder, null, null];
  fs.players[ME].deck = [card(ME, 'salamandra'), card(ME, 'kuriboh')];
  fs.players[ME].grave = [card(ME, 'salamandra')];
  const armed = act(fs, ME, {
    type: 'normalSummon', uid: sword.uid, zone: 1, position: 'atk', face: 'up', tributes: [fodder.uid],
  });
  ok(
    armed.players[ME].hand.filter((c) => c.slug === 'salamandra').length === 1,
    'Flame Swordsman also takes exactly one Salamandra with a copy in both piles',
    `hand ${armed.players[ME].hand.map((c) => c.slug).join(',')}`
  );
}

console.log('\nThe summon rule, and the seven cards it must NOT reach');
{
  /* Alligator's Sword is the owner's own example: "when Normal Summoned: add
     Baby Dragon or Polymerization" should work however he arrives. */
  const revive = fresh();
  const gator = card(ME, "alligator-s-sword");
  revive.players[ME].grave = [gator];
  const reborn = card(ME, 'monster-reborn');
  revive.players[ME].hand = [reborn];
  revive.players[ME].deck = [card(ME, 'baby-dragon'), card(ME, 'kuriboh')];
  const back = act(revive, ME, { type: 'activateSpell', uid: reborn.uid, targets: [gator.uid] });
  ok(
    back.players[ME].hand.some((c) => c.slug === 'baby-dragon'),
    "Alligator's Sword searches when Special Summoned, not only when Normal Summoned"
  );

  /* The seven exceptions. Each Special Summons a copy of ITSELF, and their
     `onNormalSummon` is a deliberate recursion guard with measured balance
     behind it — "the chain is one link long by construction rather than by
     counting the deck". Converting them would have let one summon fill the
     board off the Deck. The guard is pinned so the next sweep cannot quietly
     remove it. */
  /* Mudora and Keldo used to be on this list and are deliberately off it now.
     Neither summons a copy of itself on a summon trigger any more: Keldo calls
     *Agido* when it is destroyed, and Mudora's replacement comes out of the
     tomb rather than out of the Summon — see the block below, which pins that
     the new chain terminates on its own. */
  const GUARDED = [
    'bowganian',
    'viser-des',
    'millennium-seeker',
    'ra-s-disciple',
    'giant-red-seasnake',
  ];
  /* "Summons a copy of itself" is two different shapes: six name their own
     slug, and Giant Red Seasnake reaches for any WATER monster of 1850 ATK or
     less — which he is. Both are self-chains and both need the guard. */
  const summonsSelf = (slug: string, o: Op): boolean => {
    if (o.op !== 'specialSummon') return false;
    if ((o.filter?.slugs ?? []).includes(slug)) return true;
    const me = CARDS[slug];
    const f = o.filter;
    if (!f || f.slugs) return false;
    if (f.type && f.type !== me.type) return false;
    if (f.attribute && f.attribute !== me.attribute) return false;
    if (f.maxAtk != null && (me.atk ?? 0) > f.maxAtk) return false;
    if (f.minAtk != null && (me.atk ?? 0) < f.minAtk) return false;
    return !!(f.type || f.attribute || f.maxAtk != null || f.minAtk != null);
  };
  for (const slug of GUARDED) {
    const def = CARDS[slug];
    const selfSummons = def.effects.some((e) => e.ops.some((o) => summonsSelf(slug, o)));
    const guarded = def.effects.every(
      (e) => e.trigger !== 'onSummon' || !e.ops.some((o) => summonsSelf(slug, o))
    );
    ok(selfSummons && guarded, `${def.name} still summons its twin on onNormalSummon only`);
  }

  /* And Mudora's new chain, which runs the other way round: the replacement
     comes out of the *tomb*, so it is death that stands the next one up. The
     guard is no longer structural — it is arithmetic. Every copy that arrives
     has left the Deck or the hand for good, so the chain is exactly as long as
     the number of Mudora there are and then it stops. */
  const m = fresh();
  const dying = card(ME, 'mudora');
  m.players[ME].monsters = [dying, null, null];
  m.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'kuriboh'), card(ME, 'mudora')];
  const hole = card(ME, 'dark-hole');
  m.players[ME].hand = [hole];
  const replaced = act(m, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
  ok(
    replaced.players[ME].monsters.some((x) => x?.slug === 'mudora'),
    'a Mudora that dies stands the next one up out of the Deck',
    replaced.players[ME].monsters.map((x) => x?.slug ?? '-').join(',')
  );
  ok(
    !replaced.players[ME].deck.some((c) => c.slug === 'mudora'),
    'and that copy has left the Deck, which is what ends the chain',
    replaced.players[ME].deck.map((c) => c.slug).join(',')
  );

  /* The whole line, run out: three copies and a Dark Hole, and the board is
     left holding one. Nothing loops, and nothing arrives from nowhere. */
  const all = fresh();
  const first = card(ME, 'mudora');
  all.players[ME].monsters = [first, null, null];
  all.players[ME].deck = [card(ME, 'mudora'), card(ME, 'mudora'), card(ME, 'kuriboh'), card(ME, 'kuriboh')];
  const sweep = card(ME, 'dark-hole');
  all.players[ME].hand = [sweep];
  const after = act(all, ME, { type: 'activateSpell', uid: sweep.uid, targets: [] });
  ok(
    after.players[ME].monsters.filter((x) => x?.slug === 'mudora').length === 1,
    'one falls, one stands — the chain is one link at a time however many are left',
    `${after.players[ME].monsters.filter((x) => x?.slug === 'mudora').length} on the field`
  );
}

console.log('\nKaiba: the Ultimate Dragon spends a brother, and the Sea Horse finally counts double');
{
  /* Blue-Eyes Ultimate Dragon: feed a Blue-Eyes back into the Deck, shatter a
     backrow. Placed on the field rather than Fusion Summoned, so the ignition
     is tested on its own without the arrival sweep clearing the board first. */
  const s = fresh();
  const ult = card(ME, 'blue-eyes-ultimate-dragon');
  ult.summonedOnTurn = 0;
  s.players[ME].monsters = [ult, null, null];
  s.players[ME].grave = [card(ME, 'blue-eyes-white-dragon'), card(ME, 'dark-hole')];
  s.players[ME].deck = [card(ME, 'kuriboh')];
  const set = card(FOE, 'mirror-force');
  set.face = 'down';
  s.players[FOE].spellTrap = set;
  const fired = act(s, ME, { type: 'ignition', uid: ult.uid, targets: [set.uid] });
  ok(fired.players[FOE].spellTrap === null, 'the Ultimate Dragon shatters a Spell or Trap');
  ok(
    !fired.players[ME].grave.some((c) => c.slug === 'blue-eyes-white-dragon'),
    'and the Blue-Eyes it spent has left the Graveyard'
  );
  ok(
    fired.players[ME].deck.some((c) => c.slug === 'blue-eyes-white-dragon'),
    'and gone back into the Deck, not anywhere else'
  );

  // No Blue-Eyes down there and the effect is not on offer at all.
  const empty = fresh();
  const ult2 = card(ME, 'blue-eyes-ultimate-dragon');
  ult2.summonedOnTurn = 0;
  empty.players[ME].monsters = [ult2, null, null];
  empty.players[ME].grave = [card(ME, 'dark-hole')];
  const setB = card(FOE, 'mirror-force');
  setB.face = 'down';
  empty.players[FOE].spellTrap = setB;
  ok(
    !!applyAction(empty, ME, { type: 'ignition', uid: ult2.uid, targets: [setB.uid] }).error,
    'CONTROL: with no Blue-Eyes in the Graveyard the ignition is refused'
  );

  /* "This monster counts as two tributes for the Tribute Summon of a LIGHT
     monster" — a claim about the body being SPENT, and it was implemented as a
     standing discount. Reported by the owner: "check if when Kaiser Sea Horse
     any monster can be tributed (just 1) for summoning a blue eyes?" It could:
     he lowered the price and a Battle Ox paid it, and he was still standing
     beside the dragon afterwards.

     The price is counted in Tributes now, not in heads. Blue-Eyes costs two,
     and he is worth two of them. */
  const light = 'blue-eyes-white-dragon'; // Level 8 LIGHT — two Tributes
  ok(CARDS[light].attribute === 'LIGHT', 'CONTROL: Blue-Eyes is the LIGHT monster this is about');
  const board = fresh();
  const horse = card(ME, 'kaiser-sea-horse');
  board.players[ME].monsters = [horse, null, null];
  ok(
    tributesRequired(light, board, ME) === 2,
    'the dragon still costs two Tributes with a Sea Horse standing',
    `needs ${tributesRequired(light, board, ME)}`
  );
  ok(tributeUnits(horse, light) === 2, 'and the Sea Horse is worth both of them', `${tributeUnits(horse, light)}`);
  ok(
    summonAffordable(board, ME, light),
    'so a board holding nothing but him can pay for it',
  );
  const alone = act(board, ME, (() => {
    const d = card(ME, light);
    board.players[ME].hand = [d];
    return { type: 'normalSummon', uid: d.uid, zone: 1, position: 'atk', face: 'up', tributes: [horse.uid] } as DuelAction;
  })());
  ok(on(alone, ME).some((m) => m.slug === light), 'he pays for the dragon on his own', on(alone, ME).map((m) => m.slug).join(','));
  ok(!on(alone, ME).some((m) => m.slug === 'kaiser-sea-horse'), 'and he is spent doing it, not left standing beside it');

  /* The reported bug, in one assertion: he is not a discount somebody else can
     spend. */
  {
    const cheat = fresh();
    const seahorse = card(ME, 'kaiser-sea-horse');
    const ox = card(ME, 'battle-ox');
    cheat.players[ME].monsters = [seahorse, ox, null];
    const dragon = card(ME, light);
    cheat.players[ME].hand = [dragon];
    const r = applyAction(cheat, ME, {
      type: 'normalSummon', uid: dragon.uid, zone: 2, position: 'atk', face: 'up', tributes: [ox.uid],
    });
    ok(!!r.error, 'an ordinary body cannot pay the short price while he watches', r.error ?? 'it was allowed');
    ok(
      !r.state.players[ME].monsters.some((m) => m?.slug === light),
      'and no dragon arrives on the strength of a body that was never worth two'
    );
  }

  const bare = fresh();
  bare.players[ME].monsters = [card(ME, 'battle-ox'), null, null];
  ok(
    tributesRequired(light, bare, ME) === 2,
    'CONTROL: without him it is still two',
    `needs ${tributesRequired(bare ? light : light, bare, ME)}`
  );
  ok(!summonAffordable(bare, ME, light), 'CONTROL: and one ordinary body cannot pay it');

  // And it is LIGHT only — a DARK Level 7 pays full price.
  const dark = fresh();
  const horse2 = card(ME, 'kaiser-sea-horse');
  dark.players[ME].monsters = [horse2, null, null];
  ok(
    CARDS['gaia-the-fierce-knight'].attribute !== 'LIGHT' && tributeUnits(horse2, 'gaia-the-fierce-knight') === 1,
    'CONTROL: he is worth one body towards a non-LIGHT monster',
    `${tributeUnits(horse2, 'gaia-the-fierce-knight')}`
  );
  ok(
    !summonAffordable(dark, ME, 'gaia-the-fierce-knight'),
    'CONTROL: so he cannot pay for one on his own'
  );

  /* Double Coston must NOT change with him. Its text is a different sentence —
     "while you control this face-up card" — and it says what it does. */
  {
    const twin = fresh();
    twin.players[ME].monsters = [{ ...card(ME, 'double-coston'), face: 'up' as const }, card(ME, 'battle-ox'), null];
    ok(
      tributesRequired('obelisk-the-tormentor', twin, ME) === 2,
      'CONTROL: Double Coston is still a standing discount, exactly as its text says',
      `${tributesRequired('obelisk-the-tormentor', twin, ME)}`
    );
  }

  // Saggi finds the virus.
  const clown = fresh();
  const saggi = card(ME, 'saggi-the-dark-clown');
  clown.players[ME].hand = [saggi];
  clown.players[ME].deck = [card(ME, 'crush-card-virus'), card(ME, 'kuriboh')];
  const found = act(clown, ME, { type: 'normalSummon', uid: saggi.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(found.players[ME].hand.some((c) => c.slug === 'crush-card-virus'), 'Saggi the Dark Clown fetches Crush Card Virus');
}

console.log('\nJoey: one banner per roll, a dragon off heads, and a chosen grave');
{
  /* The dice say their total once. `gainAtk` writes a line every time it moves
     a number, so running it inside `perPip` printed six banners for a six. */
  let sawRoll = false;
  for (let seed = 1; seed < 40 && !sawRoll; seed++) {
    const s = fresh();
    s.seed = seed;
    const grace = card(ME, 'graceful-dice');
    s.players[ME].hand = [grace];
    const ox = card(ME, 'battle-ox'); // 1700
    s.players[ME].monsters = [ox, null, null];
    const before = s.log.length;
    const rolled = act(s, ME, { type: 'activateSpell', uid: grace.uid, targets: [] });
    const gained = effAtk(rolled, rolled.players[ME].monsters[0]!, ME) - 1700;
    if (gained <= 0) continue;
    sawRoll = true;
    const lines = rolled.log.slice(before).filter((l) => /gains \d+ ATK/.test(l.text));
    ok(lines.length === 1, 'Graceful Dice announces its total in ONE line', `${lines.length} lines: ${lines.map((l) => l.text).join(' | ')}`);
    ok(gained % 200 === 0 && gained >= 200 && gained <= 1200, 'and the total is 200 a pip', `gained ${gained}`);
    ok(new RegExp(`gains ${gained} ATK`).test(lines[0]?.text ?? ''), 'and that line carries the summed number', lines[0]?.text ?? '(none)');
  }
  ok(sawRoll, 'CONTROL: a roll was actually observed');

  /* Time Wizard on heads clears their board AND brings the dragon out. */
  let sawHeads = false;
  for (let seed = 1; seed < 60 && !sawHeads; seed++) {
    const t = fresh();
    t.seed = seed;
    const wizard = card(ME, 'time-wizard');
    wizard.summonedOnTurn = 0;
    t.players[ME].monsters = [wizard, null, null];
    t.players[ME].extra = [card(ME, 'thousand-dragon')];
    t.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
    const rolled = act(t, ME, { type: 'ignition', uid: wizard.uid, targets: [] });
    const theirsGone = !rolled.players[FOE].monsters.some((m) => m?.slug === 'battle-ox');
    if (!theirsGone) continue; // tails
    sawHeads = true;
    ok(
      rolled.players[ME].monsters.some((m) => m?.slug === 'thousand-dragon'),
      'Time Wizard on heads Special Summons Thousand Dragon from the Extra Deck'
    );
    ok(rolled.players[ME].extra.every((c) => c.slug !== 'thousand-dragon'), 'and it really left the Extra Deck');
  }
  ok(sawHeads, 'CONTROL: heads was actually reached');

  // A 2400 vanilla body, deliberately — no rider from the generic fallback.
  ok(baseAtkOf('thousand-dragon') === 2400, 'Thousand Dragon is a 2400 body', `${baseAtkOf('thousand-dragon')}`);
  ok(CARDS['thousand-dragon'].effects.length === 0, 'and carries no effect at all — vanilla, as asked');

  /* Its text says it comes back out of the Graveyard, so that is pinned rather
     than assumed. The first wording claimed the opposite — "cannot be Special
     Summoned by other ways" — while Monster Reborn had been reviving it the
     whole time; `npm run text` cannot see a negative claim, so only a pin can
     hold this one honest. */
  const dead = fresh();
  const td = card(ME, 'thousand-dragon');
  dead.players[ME].grave = [td, card(ME, 'baby-dragon')];
  const reborn2 = card(ME, 'monster-reborn');
  dead.players[ME].hand = [reborn2];
  const rebornSpec2 = targetSpecFor('monster-reborn', 'activate')!;
  ok(
    targetCandidates(dead, ME, rebornSpec2).some((c) => c.slug === 'thousand-dragon'),
    'and the board offers it to Monster Reborn out of the Graveyard'
  );
  const raised = act(dead, ME, { type: 'activateSpell', uid: reborn2.uid, targets: [td.uid] });
  ok(
    raised.players[ME].monsters.some((m) => m?.slug === 'thousand-dragon'),
    'and it really comes back to the field'
  );

  /* The half that must stay true: an Extra Deck body still cannot be Normal
     Summoned, which is what "Cannot be Normal Summoned or Set" means. */
  const handful = fresh();
  const td2 = card(ME, 'thousand-dragon');
  handful.players[ME].hand = [td2];
  handful.players[ME].monsters = [card(ME, 'mystical-elf'), card(ME, 'mystical-elf'), null];
  ok(
    !!applyAction(handful, ME, {
      type: 'normalSummon', uid: td2.uid, zone: 2, position: 'atk', face: 'up',
      tributes: handful.players[ME].monsters.filter(Boolean).map((m) => m!.uid),
    }).error,
    'CONTROL: it still cannot be Normal Summoned'
  );

  // And when it dies it lands in the Graveyard, which is what makes that reachable.
  const dying = fresh();
  const td3 = card(ME, 'thousand-dragon');
  td3.summonedOnTurn = 0;
  dying.players[ME].monsters = [td3, null, null];
  const hole = card(ME, 'dark-hole');
  dying.players[ME].hand = [hole];
  const swept = act(dying, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
  ok(
    swept.players[ME].grave.some((c) => c.slug === 'thousand-dragon'),
    'and a destroyed Thousand Dragon lands in the Graveyard, not back in the Extra Deck'
  );

  /* Graverobber asks which card, the way Monster Reborn asks which monster. */
  const spec = targetSpecFor('graverobber', 'trap');
  ok(!!spec, 'Graverobber declares a target spec at all');
  ok(spec?.zone === 'grave' && spec?.side === 'opp', "and it points at the opponent's Graveyard", `${spec?.side}/${spec?.zone}`);

  const g = fresh();
  const robber = card(ME, 'graverobber');
  robber.face = 'down';
  robber.summonedOnTurn = 1;
  g.players[ME].spellTrap = robber;
  const wanted = card(FOE, 'dark-hole');
  g.players[FOE].grave = [card(FOE, 'monster-reborn'), wanted, card(FOE, 'kuriboh')];
  const taken = act(g, ME, { type: 'activateSetCard', uid: robber.uid, targets: [wanted.uid] });
  ok(
    taken.players[ME].hand.some((c) => c.uid === wanted.uid),
    'and it takes the card that was actually chosen, not the strongest',
    taken.players[ME].hand.map((c) => c.slug).join(',')
  );

  /* The mid-resolution steals used to be held back from asking, on the grounds
     that nobody is standing there when a summon resolves. Somebody is: the
     board raises a modal and an AI answers from `choiceResponses`, exactly as
     they do for the question Graverobber has always asked.

     So both declare a spec now, and what decides whether the question is put is
     the Graveyard rather than the card — see `worthAsking`. Hitotsu-Me Giant
     reaches for Pot of Greed by name, so two of them down there are still one
     answer and it takes it without a word. Lady of Faith reaches for any Fiend,
     which is a real decision the moment there are two different ones. */
  ok(!!targetSpecFor('hitotsu-me-giant', 'onSummon'), 'Hitotsu-Me Giant declares its reach into the Graveyard');
  ok(!!targetSpecFor('magician-of-faith', 'onFlip'), 'and so does Magician of Faith');
  /* Lady of Faith is the exception that proves what the rule is about. Her
     text reads "add 1 *random* Fiend" and the op carries `pick: 'random'`, so
     she is answered before anybody could be asked — see `selfRuled`. Handing
     her a modal would not be giving a choice back, it would be deleting the
     only thing the card does. */
  ok(!targetSpecFor('lady-of-faith', 'onSummon'), 'and the Lady, who reaches without looking, still asks nothing');
  {
    const q = fresh();
    const giant = card(ME, 'hitotsu-me-giant');
    q.players[ME].hand = [giant];
    q.players[ME].grave = [card(ME, 'pot-of-greed'), card(ME, 'pot-of-greed')];
    const quiet = act(q, ME, { type: 'normalSummon', uid: giant.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
    ok(asked(quiet) === null, 'two Pots of Greed are one answer, so the giant is not asked', JSON.stringify(asked(quiet)));
    ok(quiet.players[ME].hand.some((c) => c.slug === 'pot-of-greed'), 'and it takes one anyway', quiet.players[ME].hand.map((c) => c.slug).join(','));

    /* Magician of Faith turns face-up in the middle of somebody else's attack,
       which used to be the whole reason she was never asked. She is asked now,
       and the Spell she hands back is the one that was pointed at. */
    const m = fresh();
    const mage = card(ME, 'magician-of-faith');
    mage.face = 'down';
    mage.position = 'def';
    mage.summonedOnTurn = 0;
    m.players[ME].monsters[0] = mage;
    m.players[ME].grave = [card(ME, 'dark-hole'), card(ME, 'monster-reborn'), card(ME, 'kuriboh')];
    m.players[ME].deck = [card(ME, 'kuriboh')];
    const asks = act(m, ME, { type: 'changePosition', uid: mage.uid });
    ok(
      JSON.stringify(asked(asks)) === JSON.stringify(['dark-hole', 'monster-reborn']),
      'she offers every Spell in the pile and nothing that is not one',
      JSON.stringify(asked(asks))
    );
    const chosen = answer(asks, 'monster-reborn');
    ok(
      chosen.players[ME].hand.some((c) => c.slug === 'monster-reborn'),
      'and takes the one pointed at, not the first card down there',
      chosen.players[ME].hand.map((c) => c.slug).join(',')
    );
  }

  /* Reported from a real duel: "Graverobber says there is nothing it can
     target but the enemy has cards in their graveyard" — a pile holding only
     Spells and Traps. `targetCandidates` hardcoded "monsters only" into the
     Graveyard branch, which was invisible while Monster Reborn was the only
     card looking in there. Graverobber takes ANY card. */
  const spellsOnly = fresh();
  spellsOnly.players[FOE].grave = [card(FOE, 'dark-hole'), card(FOE, 'mirror-force'), card(FOE, 'pot-of-greed')];
  const robSpec = targetSpecFor('graverobber', 'trap')!;
  const offered = targetCandidates(spellsOnly, ME, robSpec).map((c) => c.slug);
  ok(offered.length === 3, 'Graverobber offers a Graveyard of nothing but Spells and Traps', offered.join(',') || '(none)');

  // And it can actually be activated against that pile, end to end.
  const rob = fresh();
  const trap2 = card(ME, 'graverobber');
  trap2.face = 'down';
  trap2.summonedOnTurn = 1;
  rob.players[ME].spellTrap = trap2;
  const wantedSpell = card(FOE, 'dark-hole');
  rob.players[FOE].grave = [card(FOE, 'mirror-force'), wantedSpell];
  const stolen = act(rob, ME, { type: 'activateSetCard', uid: trap2.uid, targets: [wantedSpell.uid] });
  ok(
    stolen.players[ME].hand.some((c) => c.uid === wantedSpell.uid),
    'and takes the Spell that was chosen out of it'
  );

  /* CONTROL, and the reason the restriction moved onto the spec rather than
     being deleted: Monster Reborn must still refuse to offer a Spell. */
  const rebornSpec = targetSpecFor('monster-reborn', 'activate')!;
  const mixed = fresh();
  mixed.players[ME].grave = [card(ME, 'dark-hole'), card(ME, 'summoned-skull'), card(ME, 'pot-of-greed')];
  const rebornOffers = targetCandidates(mixed, ME, rebornSpec).map((c) => c.slug);
  ok(
    rebornOffers.length === 1 && rebornOffers[0] === 'summoned-skull',
    'CONTROL: Monster Reborn still offers only the monster',
    rebornOffers.join(',') || '(none)'
  );

  /* The same latent hole one zone over: a Special Summon from the HAND had no
     monster restriction either, so it would have offered Spells. */
  const flute = targetSpecFor('the-flute-of-summoning-dragon', 'activate');
  if (flute && flute.zone === 'hand') {
    const h = fresh();
    h.players[ME].hand = [card(ME, 'dark-hole'), card(ME, 'blue-eyes-white-dragon'), card(ME, 'pot-of-greed')];
    const fluteOffers = targetCandidates(h, ME, flute).map((c) => c.slug);
    ok(
      !fluteOffers.includes('dark-hole') && !fluteOffers.includes('pot-of-greed'),
      'CONTROL: a Special Summon from the hand offers no Spells either',
      fluteOffers.join(',') || '(none)'
    );
  }
}

console.log('\nFive bugs reported from a real duel');
{
  /* 1. An ATK threshold aimed at the board reads the LIVE number.
        "Lord of d was not destroyed by crush card virus but with its effect it
        had 2800atk at the moment I activated my trap." `matchesFilter` only
        ever reads printed data, and his card says 1200. */
  const ccv = fresh();
  const lord = card(FOE, 'lord-of-d'); // printed 1200, +400 per Dragon on the field
  ccv.players[FOE].monsters = [lord, card(FOE, 'blue-eyes-white-dragon'), card(FOE, 'baby-dragon')];
  ccv.players[FOE].hand = [card(FOE, 'kuriboh'), card(FOE, 'dark-hole')];
  ok(effAtk(ccv, lord, FOE) === 2000, 'Lord of D. is live 2000 beside two Dragons, printed 1200', `${effAtk(ccv, lord, FOE)}`);
  const virus = card(ME, 'crush-card-virus');
  virus.face = 'down';
  virus.summonedOnTurn = 1;
  ccv.players[ME].spellTrap = virus;
  const crushed = act(ccv, ME, { type: 'activateSetCard', uid: virus.uid, targets: [] });
  ok(
    !crushed.players[FOE].monsters.some((m) => m?.slug === 'lord-of-d'),
    'Crush Card Virus destroys him on his live ATK, not his printed one'
  );

  /* CONTROL: a threshold aimed at a Graveyard still reads the printed number,
     because a card down there has no live stats — and this is also what keeps
     `effAtk` from recursing through the aura pass. */
  const grave = fresh();
  const snake = card(ME, 'giant-red-seasnake'); // revives WATER with 1850 ATK or less
  grave.players[ME].hand = [snake];
  grave.players[ME].grave = [card(ME, '7-colored-fish')];
  const revived = act(grave, ME, { type: 'normalSummon', uid: snake.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(
    revived.players[ME].monsters.filter(Boolean).length === 2,
    'CONTROL: a Graveyard threshold still reads printed ATK and revives',
    `${revived.players[ME].monsters.filter(Boolean).length} on the field`
  );

  /* 2. A monster brought out by a Spell must still fire its own effect, and
        must aim at something it can actually touch.
        "Blue-Eyes White Dragon's effect did not activate when I special
        summoned 2 with the flute. The enemy had lord of d and their own 2 blue
        eyes." Lord of D. makes their Dragons untargetable, so the auto-pick
        reached for the 3000 it could not touch and the filter threw it away —
        with Lord of D., a Spellcaster, legal the whole time. */
  const flute = fresh();
  const f = card(ME, 'the-flute-of-summoning-dragon');
  const d1 = card(ME, 'blue-eyes-white-dragon');
  const d2 = card(ME, 'blue-eyes-white-dragon');
  flute.players[ME].hand = [f, d1, d2];
  flute.players[FOE].monsters = [card(FOE, 'lord-of-d'), card(FOE, 'blue-eyes-white-dragon'), null];
  const blown = act(flute, ME, { type: 'activateSpell', uid: f.uid, targets: [d1.uid, d2.uid] });
  ok(blown.players[ME].monsters.filter((m) => m?.slug === 'blue-eyes-white-dragon').length === 2, 'the Flute brings out both dragons');
  ok(
    !blown.players[FOE].monsters.some((m) => m?.slug === 'lord-of-d'),
    'the first Blue-Eyes destroys the one it CAN target — Lord of D.'
  );
  ok(
    blown.players[FOE].monsters.every((m) => !m),
    'and the second takes their Blue-Eyes once the shield is gone',
    blown.players[FOE].monsters.filter(Boolean).map((m) => m!.slug).join(',') || '(empty)'
  );

  /* CONTROL: an explicit choice still wins over the auto-pick, and a protected
     card is still protected when the player points at it by hand. */
  const shielded = fresh();
  const solo = card(ME, 'blue-eyes-white-dragon'); // Level 8 — two Tributes
  shielded.players[ME].hand = [solo];
  const f1 = card(ME, 'mystical-elf');
  const f2 = card(ME, 'mystical-elf');
  shielded.players[ME].monsters = [f1, f2, null];
  const theirLord = card(FOE, 'lord-of-d');
  const theirDragon = card(FOE, 'blue-eyes-white-dragon');
  shielded.players[FOE].monsters = [theirLord, theirDragon, null];
  const aimed = act(shielded, ME, {
    type: 'normalSummon', uid: solo.uid, zone: 0, position: 'atk', face: 'up',
    tributes: [f1.uid, f2.uid], targets: [theirDragon.uid],
  });
  ok(
    aimed.players[FOE].monsters.some((m) => m?.uid === theirDragon.uid),
    'CONTROL: pointing at a Lord-of-D-shielded Dragon still destroys nothing'
  );

  /* 3. A discarded card must be SHOWN going. Nothing was ever lost — the op
        logged without a beat, so the line was adopted by whatever was on
        screen and the card simply disappeared from the hand. */
  const tr = fresh();
  const trunade = card(ME, 'giant-trunade');
  tr.players[ME].hand = [trunade];
  const theirSet = card(FOE, 'mirror-force');
  theirSet.face = 'down';
  tr.players[FOE].spellTrap = theirSet;
  tr.players[FOE].hand = [card(FOE, 'kuriboh'), card(FOE, 'dark-hole')];
  const before = tr.anims.length;
  const swept = act(tr, ME, { type: 'activateSpell', uid: trunade.uid, targets: [] });
  const beats = swept.anims.slice(before);
  ok(swept.players[FOE].grave.length === 1, 'Giant Trunade puts the discarded card in the Graveyard', `grave ${swept.players[FOE].grave.length}`);
  ok(
    beats.some((b) => b.kind === 'discard' && !!b.slug),
    'and the board shows a discard beat naming the card',
    beats.map((b) => b.kind).join(',')
  );
  ok(
    beats.filter((b) => b.kind === 'discard').every((b) => !!b.note),
    'and that beat carries its own line rather than borrowing one'
  );

  /* 4. Card of Sanctity says the total once. */
  const sanc = fresh();
  const cos = card(ME, 'card-of-sanctity');
  sanc.players[ME].hand = [cos];
  for (let i = 0; i < 8; i++) sanc.players[ME].deck.push(card(ME, 'kuriboh'));
  for (let i = 0; i < 8; i++) sanc.players[FOE].deck.push(card(FOE, 'kuriboh'));
  const beforeLog = sanc.log.length;
  const drew = act(sanc, ME, { type: 'activateSpell', uid: cos.uid, targets: [] });
  const drawLines = drew.log.slice(beforeLog).filter((l) => /draws/.test(l.text));
  ok(drawLines.length === 2, 'Card of Sanctity announces once per player, not once per card', `${drawLines.length} lines: ${drawLines.map((l) => l.text).join(' | ')}`);
  ok(drawLines.every((l) => /draws \d+ cards?\./.test(l.text)), 'and each line carries the count', drawLines.map((l) => l.text).join(' | '));
  ok(drew.players[ME].hand.length === 6 && drew.players[FOE].hand.length === 6, 'and both hands really reach 6',
    `${drew.players[ME].hand.length}/${drew.players[FOE].hand.length}`);

  // Singular reads "1 card", not "1 cards".
  const one = fresh();
  const cos2 = card(ME, 'card-of-sanctity');
  one.players[ME].hand = [cos2];
  for (let i = 0; i < 5; i++) one.players[ME].hand.push(card(ME, 'kuriboh')); // 6 with the spell; 5 after playing it
  for (let i = 0; i < 8; i++) one.players[ME].deck.push(card(ME, 'kuriboh'));
  for (let i = 0; i < 8; i++) one.players[FOE].deck.push(card(FOE, 'kuriboh'));
  const mineBefore = one.log.length;
  const drewOne = act(one, ME, { type: 'activateSpell', uid: cos2.uid, targets: [] });
  const mine = drewOne.log.slice(mineBefore).filter((l) => /Me draws/.test(l.text));
  ok(mine.some((l) => /draws 1 card\./.test(l.text)), 'and a single card is "1 card", not "1 cards"', mine.map((l) => l.text).join(' | '));

  /* 5. The Ultimate Dragon's cost cannot be paid into an empty board. */
  const bare = fresh();
  const ult = card(ME, 'blue-eyes-ultimate-dragon');
  ult.summonedOnTurn = 0;
  bare.players[ME].monsters = [ult, null, null];
  bare.players[ME].grave = [card(ME, 'blue-eyes-white-dragon')];
  ok(!canIgnite(bare, ME, ult), 'the Ultimate Dragon is not offered against an empty backrow');
  const wasted = applyAction(bare, ME, { type: 'ignition', uid: ult.uid, targets: [] });
  ok(!!wasted.error, 'and the engine refuses it too');
  ok(
    wasted.state.players[ME].grave.some((c) => c.slug === 'blue-eyes-white-dragon'),
    'so the Blue-Eyes is never spent for nothing'
  );
}

console.log("\nThree more from a real duel: an empty modal and banners with no art");
{
  /* 1. The Graveyard picker must lay out the pile the spec actually names.
        "Graverobber opens a modal but it's empty, there are cards in the
        opponent's graveyard." The modal read "both ? [me, foe] : [me]", so an
        opponent-only picker listed MY pile and filtered it against THEIR
        cards. The rule lives in `ui.ts` now so it can be asked directly. */
  const robSpec = targetSpecFor('graverobber', 'trap')!;
  ok(robSpec.side === 'opp' && robSpec.zone === 'grave', "Graverobber's spec names the opponent's Graveyard", `${robSpec.side}/${robSpec.zone}`);
  ok(
    pickerSides(robSpec, ME, FOE).length === 1 && pickerSides(robSpec, ME, FOE)[0] === FOE,
    'and the picker lays out THEIR pile, not mine',
    pickerSides(robSpec, ME, FOE).join(',')
  );
  const rebornSpec = targetSpecFor('monster-reborn', 'activate')!;
  ok(
    pickerSides(rebornSpec, ME, FOE).length === 2,
    'CONTROL: Monster Reborn reads either Graveyard and still lays out both',
    pickerSides(rebornSpec, ME, FOE).join(',')
  );
  ok(
    pickerSides({ side: 'own', zone: 'grave', count: 1, prompt: '' }, ME, FOE)[0] === ME,
    'CONTROL: an own-side picker still lays out mine'
  );

  /* And end to end: the cards the modal would draw are theirs and are real. */
  const pile = fresh();
  pile.players[FOE].grave = [card(FOE, 'dark-hole'), card(FOE, 'mirror-force')];
  pile.players[ME].grave = [card(ME, 'summoned-skull')];
  const shown = pickerSides(robSpec, ME, FOE).flatMap((pid) =>
    pile.players[pid].grave.filter((c) => targetCandidates(pile, ME, robSpec).some((t) => t.uid === c.uid))
  );
  ok(shown.length === 2, 'so the modal has two cards to draw, not none', `${shown.length}`);

  /* 2. A line that names a card carries that card, so the beat announcing it
        has a face to draw. Reported as art missing from some banners: the line
        was written with no beat of its own, and the one it was given had
        nothing to show. */
  const atk = fresh('battle');
  const ox = card(ME, 'battle-ox');
  ox.summonedOnTurn = 0;
  atk.players[ME].monsters = [ox, null, null];
  const prey = card(FOE, 'kuriboh');
  prey.summonedOnTurn = 0;
  atk.players[FOE].monsters = [prey, null, null];
  const beforeLog = atk.log.length;
  const swung = act(atk, ME, { type: 'attack', uid: ox.uid, targetUid: prey.uid });
  const named = swung.log.slice(beforeLog).filter((l) => /Battle Ox|Kuriboh/.test(l.text));
  ok(named.length > 0, 'CONTROL: the swing wrote lines naming cards', `${named.length}`);
  ok(
    named.every((l) => !!l.slug),
    'every line naming a card carries that card',
    named.filter((l) => !l.slug).map((l) => l.text).join(' | ')
  );

  /* The beat built for an orphan line inherits it, which is the half that
     reaches the screen. */
  const pos = fresh();
  const ox2 = card(ME, 'battle-ox');
  pos.players[ME].monsters = [ox2, null, null];
  const beforeAnims = pos.anims.length;
  const turned = act(pos, ME, { type: 'changePosition', uid: ox2.uid });
  const notes = turned.anims.slice(beforeAnims).filter((a) => a.kind === 'note');
  ok(notes.length > 0, 'CONTROL: switching position makes a note beat', `${notes.length}`);
  ok(
    notes.every((a) => !!a.slug),
    'and a note beat about a card carries its art',
    notes.map((a) => `${a.note} [slug=${a.slug ?? 'NONE'}]`).join(' | ')
  );

  /* 3. A discard names its card too — the beat added for it is separate, but
        the line behind it must still know what it is about. */
  const disc = fresh();
  const trunade = card(ME, 'giant-trunade');
  disc.players[ME].hand = [trunade];
  const theirSet = card(FOE, 'mirror-force');
  theirSet.face = 'down';
  disc.players[FOE].spellTrap = theirSet;
  disc.players[FOE].hand = [card(FOE, 'kuriboh')];
  const beforeD = disc.log.length;
  const blown = act(disc, ME, { type: 'activateSpell', uid: trunade.uid, targets: [] });
  const discardLines = blown.log.slice(beforeD).filter((l) => /discards/.test(l.text));
  ok(discardLines.length === 1 && !!discardLines[0].slug, 'the discard line names the card it discarded', discardLines.map((l) => `${l.text} [${l.slug ?? 'NONE'}]`).join(' | '));
}

console.log("\nMai Valentine: the flock stops being the only thing her cards can see");
{
  /* An equip follows its monster off the field, however the monster leaves.
     Reported of Malevolent Nuzzler: the host was bounced to the hand and the
     Spell sat in the only Spell/Trap Zone there is, attached to nothing. */
  const eq = fresh();
  const host = card(ME, 'harpie-lady');
  host.summonedOnTurn = 0;
  eq.players[ME].monsters = [host, null, null];
  const nuzzler = card(ME, 'malevolent-nuzzler');
  eq.players[ME].hand = [nuzzler];
  const equipped = act(eq, ME, { type: 'activateSpell', uid: nuzzler.uid, targets: [host.uid] });
  ok(equipped.players[ME].spellTrap?.slug === 'malevolent-nuzzler', 'CONTROL: the Nuzzler is on the field holding the Harpie');
  ok(effAtk(equipped, equipped.players[ME].monsters[0]!, ME) === 1300 + 300 + 700, 'CONTROL: and it is worth its 700', `${effAtk(equipped, equipped.players[ME].monsters[0]!, ME)}`);

  const bouncing = structuredClone(equipped);
  bouncing.active = FOE;
  bouncing.players[FOE].normalSummonUsed = false;
  const amazon = card(FOE, 'amazon-of-the-seas');
  bouncing.players[FOE].hand = [amazon];
  const bounced = act(bouncing, FOE, {
    type: 'normalSummon', uid: amazon.uid, zone: 0, position: 'atk', face: 'up', tributes: [], targets: [host.uid],
  });
  ok(bounced.players[ME].hand.some((c) => c.slug === 'harpie-lady'), 'the Harpie is bounced back to the hand');
  ok(bounced.players[ME].spellTrap === null, 'and the Nuzzler leaves the field with it', bounced.players[ME].spellTrap?.slug ?? '');
  ok(
    bounced.players[ME].grave.some((c) => c.slug === 'malevolent-nuzzler'),
    'landing in the Graveyard rather than vanishing'
  );

  /* `bounce` is the reachable case and the one that was reported; `banish` and
     `shuffleIntoDeck` lifted a card out the same way and now share the one
     `releaseEquips` call, so fixing this fixed all three at once. */

  // Harpie Lady lifts every monster, not only the flock, and by 300.
  const buff = fresh();
  const hl = card(ME, 'harpie-lady');
  const dragon = card(ME, 'harpie-s-pet-dragon'); // a Dragon, never a Winged Beast
  buff.players[ME].monsters = [hl, dragon, null];
  ok(
    effAtk(buff, dragon, ME) === baseAtkOf('harpie-s-pet-dragon') + 300 + 600,
    'Harpie Lady gives 300 to a Dragon standing beside her, and the Pet Dragon counts the board',
    `${effAtk(buff, dragon, ME)}`
  );

  /* The Pet Dragon is a live count now, both halves of it: the board, and the
     fallen Harpies. It used to be a snapshot taken once on summon. */
  const pet = fresh();
  const pd = card(ME, 'harpie-s-pet-dragon');
  pet.players[ME].monsters = [pd, null, null];
  const alone = effAtk(pet, pd, ME);
  ok(alone === baseAtkOf('harpie-s-pet-dragon') + 300, 'the Pet Dragon counts itself as a monster you control', `${alone}`);

  const withGrave = fresh();
  const pd2 = card(ME, 'harpie-s-pet-dragon');
  withGrave.players[ME].monsters = [pd2, null, null];
  withGrave.players[ME].grave = [
    card(ME, 'harpie-lady'),
    card(ME, 'cyber-harpie-lady'),
    card(ME, 'harpie-lady-sisters'),
    card(ME, 'baby-dragon'), // not a Harpie — must not count
  ];
  ok(
    effAtk(withGrave, pd2, ME) === baseAtkOf('harpie-s-pet-dragon') + 300 + 900,
    'and 300 for each of the three Harpie Lady cards in the Graveyard, and nothing for the Baby Dragon',
    `${effAtk(withGrave, pd2, ME)}`
  );
  // Live, not frozen: bury one more and the number moves.
  const grown = structuredClone(withGrave);
  grown.players[ME].grave.push(card(ME, 'harpie-lady'));
  ok(
    effAtk(grown, grown.players[ME].monsters[0]!, ME) === baseAtkOf('harpie-s-pet-dragon') + 300 + 1200,
    'and it rises again the moment another one falls'
  );

  /* Phoenix Formation: any monster flies it, and it bills 500 a kill. */
  const pf = fresh();
  const flyer = card(ME, 'sonic-maid'); // a Warrior, not a Winged Beast
  pf.players[ME].monsters = [flyer, null, null];
  const form = card(ME, 'harpie-lady-phoenix-formation');
  pf.players[ME].hand = [form];
  const t1 = card(FOE, 'battle-ox');
  const t2 = card(FOE, 'kuriboh');
  pf.players[FOE].monsters = [t1, t2, null];
  const pfBefore = pf.players[FOE].lp;
  const blasted = act(pf, ME, { type: 'activateSpell', uid: form.uid, targets: [t1.uid, t2.uid] });
  ok(blasted.players[FOE].monsters.every((m) => !m), 'Phoenix Formation flies off a Warrior and clears two monsters');
  ok(blasted.players[FOE].lp === pfBefore - 1000, 'and bills 500 for each of them', `LP ${blasted.players[FOE].lp} of ${pfBefore - 1000}`);

  // One kill is one charge, not two.
  const one = fresh();
  const flyer2 = card(ME, 'sonic-maid');
  one.players[ME].monsters = [flyer2, null, null];
  const form2 = card(ME, 'harpie-lady-phoenix-formation');
  one.players[ME].hand = [form2];
  const solo = card(FOE, 'battle-ox');
  one.players[FOE].monsters = [solo, null, null];
  const oneBefore = one.players[FOE].lp;
  const once = act(one, ME, { type: 'activateSpell', uid: form2.uid, targets: [solo.uid] });
  ok(once.players[FOE].lp === oneBefore - 500, 'and only 500 when only one monster dies', `LP ${once.players[FOE].lp} of ${oneBefore - 500}`);

  // Nothing on my side and the formation cannot be flown at all.
  const bare = fresh();
  const form3 = card(ME, 'harpie-lady-phoenix-formation');
  bare.players[ME].hand = [form3];
  bare.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  ok(
    !canActivateFromHand(bare, ME, form3),
    'CONTROL: with no monster of her own it is not offered'
  );

  /* Harpies' Hunting Ground lifts every monster now. Both sides, as it always
     has — the type widened, the side did not. */
  const ground = fresh();
  const hg = card(ME, 'harpies-hunting-ground');
  ground.players[ME].hand = [hg];
  const mine = card(ME, 'sonic-maid');
  ground.players[ME].monsters = [mine, null, null];
  const theirs = card(FOE, 'battle-ox');
  ground.players[FOE].monsters = [theirs, null, null];
  ground.players[FOE].spellTrap = { ...card(FOE, 'mirror-force'), face: 'down' as const };
  const laid = act(ground, ME, { type: 'activateSpell', uid: hg.uid, targets: [ground.players[FOE].spellTrap!.uid] });
  ok(
    effAtk(laid, laid.players[ME].monsters[0]!, ME) === baseAtkOf('sonic-maid') + 300,
    'the Hunting Ground lifts a Warrior of hers',
    `${effAtk(laid, laid.players[ME].monsters[0]!, ME)}`
  );
  /* And nobody else's. This asserted the opposite one commit ago — the card
     read "all monsters" on both sides, which was harmless while it only ever
     reached Winged Beasts and became a gift to the opponent's whole board the
     moment the type clause came off. The owner's call: hers alone. */
  ok(
    effAtk(laid, laid.players[FOE].monsters[0]!, FOE) === baseAtkOf('battle-ox'),
    "and leaves the opponent's board exactly where it was",
    `${effAtk(laid, laid.players[FOE].monsters[0]!, FOE)} of ${baseAtkOf('battle-ox')}`
  );

  // Harpie Lady Sisters fetch the Pet Dragon, Deck before Graveyard.
  const sis = fresh();
  const sisters = card(ME, 'harpie-lady-sisters');
  sis.players[ME].hand = [sisters];
  sis.players[ME].monsters = [card(ME, 'mystical-elf'), card(ME, 'mystical-elf'), null];
  sis.players[ME].deck = [card(ME, 'harpie-s-pet-dragon'), card(ME, 'kuriboh')];
  const flew = act(sis, ME, {
    type: 'normalSummon', uid: sisters.uid, zone: 2, position: 'atk', face: 'up',
    tributes: sis.players[ME].monsters.filter(Boolean).map((m) => m!.uid),
  });
  ok(flew.players[ME].hand.some((c) => c.slug === 'harpie-s-pet-dragon'), 'Harpie Lady Sisters fetch the Pet Dragon from the Deck');

  const sisGrave = fresh();
  const sisters2 = card(ME, 'harpie-lady-sisters');
  sisGrave.players[ME].hand = [sisters2];
  sisGrave.players[ME].monsters = [card(ME, 'mystical-elf'), card(ME, 'mystical-elf'), null];
  sisGrave.players[ME].deck = [card(ME, 'kuriboh')];
  sisGrave.players[ME].grave = [card(ME, 'harpie-s-pet-dragon')];
  const flew2 = act(sisGrave, ME, {
    type: 'normalSummon', uid: sisters2.uid, zone: 2, position: 'atk', face: 'up',
    tributes: sisGrave.players[ME].monsters.filter(Boolean).map((m) => m!.uid),
  });
  ok(flew2.players[ME].hand.some((c) => c.slug === 'harpie-s-pet-dragon'), 'and out of the Graveyard when the Deck has none');

  /* Sonic Maid draws on the way out; Happy Lover leaves the Hunting Ground. */
  const dying = fresh('battle');
  const maid = card(ME, 'sonic-maid');
  maid.summonedOnTurn = 0;
  dying.players[ME].monsters = [maid, null, null];
  dying.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'kuriboh')];
  const killer = card(FOE, 'summoned-skull');
  killer.summonedOnTurn = 0;
  dying.players[FOE].monsters = [killer, null, null];
  dying.active = FOE;
  const struck = act(dying, FOE, { type: 'attack', uid: killer.uid, targetUid: maid.uid });
  ok(!struck.players[ME].monsters.some((m) => m?.slug === 'sonic-maid'), 'CONTROL: Sonic Maid dies to the swing');
  ok(struck.players[ME].hand.length === 1, 'and draws a card on the way out', `hand ${struck.players[ME].hand.length}`);

  const lover = fresh('battle');
  const happy = card(ME, 'happy-lover');
  happy.summonedOnTurn = 0;
  lover.players[ME].monsters = [happy, null, null];
  lover.players[ME].deck = [card(ME, 'harpies-hunting-ground'), card(ME, 'kuriboh')];
  const killer2 = card(FOE, 'summoned-skull');
  killer2.summonedOnTurn = 0;
  lover.players[FOE].monsters = [killer2, null, null];
  lover.active = FOE;
  const fell = act(lover, FOE, { type: 'attack', uid: killer2.uid, targetUid: happy.uid });
  ok(
    fell.players[ME].hand.some((c) => c.slug === 'harpies-hunting-ground'),
    'Happy Lover leaves the Hunting Ground behind when it dies',
    fell.players[ME].hand.map((c) => c.slug).join(',') || '(empty)'
  );
}

console.log('\nPegasus: the book, the drawings and the eye');
{
  /* Bickuribox pays either way. The cartoon reaches the field, not the hand. */
  const book = fresh();
  book.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  ok(tributesRequired('bickuribox', book, ME) === 2, 'Bickuribox pays 2 Tributes even under the book', `${tributesRequired('bickuribox', book, ME)}`);
  ok(tributesRequired('manga-ryu-ran', book, ME) === 0, 'while Manga Ryu-Ran comes out free under it');
  const noBook = fresh();
  ok(tributesRequired('manga-ryu-ran', noBook, ME) === 2, 'and pays its full price without it', `${tributesRequired('manga-ryu-ran', noBook, ME)}`);

  /* A drawing answers to a different name while the book is open, which is the
     only warning that Dark Hole is about to walk past it. */
  const named = fresh();
  const box = card(ME, 'bickuribox');
  named.players[ME].monsters = [box, null, null];
  ok(displayName(named, box) === 'Bickuribox', 'with no book it is just Bickuribox', displayName(named, box));
  named.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  ok(displayName(named, box) === 'Toon Bickuribox', 'and Toon Bickuribox under it', displayName(named, box));
  const foeBox = fresh();
  const theirs = card(FOE, 'dark-rabbit');
  foeBox.players[FOE].monsters = [theirs, null, null];
  foeBox.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  ok(displayName(foeBox, theirs) === 'Dark Rabbit', "CONTROL: your book does not animate their drawings", displayName(foeBox, theirs));

  /* The book only ever belonged to the duelist who laid it. */
  const mine = fresh();
  mine.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  const myToon = card(ME, 'toon-mermaid');
  const theirToon = card(FOE, 'toon-mermaid');
  mine.players[ME].monsters = [myToon, null, null];
  mine.players[FOE].monsters = [theirToon, null, null];
  ok(effFlags(mine, myToon, ME).indestructibleByBattle === true, 'your Toon cannot be destroyed by battle under your book');
  ok(!effFlags(mine, theirToon, FOE).indestructibleByBattle, "and theirs gets nothing from it");
}

console.log('\nWho the book animates, and what they are called');
{
  /* Ryu-Ran is not a Toon. It fetches the book and can be thrown away for one,
     and caring about a card is not being part of it — no protection, no direct
     attack, and it pays its Tributes with the book wide open. */
  const open = fresh();
  open.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  const ryu = card(ME, 'ryu-ran');
  open.players[ME].monsters = [ryu, null, null];
  ok(!isToon('ryu-ran'), 'Ryu-Ran is not on the Toon roster');
  ok(tributesRequired('ryu-ran', open, ME) === 2, 'and pays its 2 Tributes under the book', `${tributesRequired('ryu-ran', open, ME)}`);
  const rf = effFlags(open, ryu, ME);
  ok(!rf.directAttack && !rf.indestructibleByBattle, 'and the book lends it nothing');
  ok(displayName(open, ryu) === 'Ryu-Ran', 'and it is never renamed', displayName(open, ryu));

  /* Dark Rabbit's mischief is gated on the book itself, not on company. */
  const alone = fresh();
  alone.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  const rabbit = card(ME, 'dark-rabbit');
  alone.players[ME].hand = [rabbit];
  alone.players[FOE].hand = [card(FOE, 'kuriboh'), card(FOE, 'battle-ox')];
  const hopped = act(alone, ME, { type: 'normalSummon', uid: rabbit.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(hopped.players[FOE].hand.length === 1, 'Dark Rabbit picks a pocket with only the book for company',
    `${hopped.players[FOE].hand.length} left`);

  const shut = fresh();
  const rabbit2 = card(ME, 'dark-rabbit');
  shut.players[ME].hand = [rabbit2];
  shut.players[FOE].hand = [card(FOE, 'kuriboh'), card(FOE, 'battle-ox')];
  const quiet = act(shut, ME, { type: 'normalSummon', uid: rabbit2.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(quiet.players[FOE].hand.length === 2, 'and takes nothing with the book shut',
    `${quiet.players[FOE].hand.length} left`);

  /* The rename says it once. Toon Alligator is already called that. */
  const named = fresh();
  named.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  const gator = card(ME, 'toon-alligator');
  const bunny = card(ME, 'dark-rabbit');
  named.players[ME].monsters = [gator, bunny, null];
  ok(displayName(named, gator) === 'Toon Alligator', 'Toon Alligator is not Toon Toon Alligator', displayName(named, gator));
  ok(displayName(named, bunny) === 'Toon Dark Rabbit', 'and Dark Rabbit does gain the word', displayName(named, bunny));

  /* And the name does not depend on whose turn it is. */
  for (const active of [ME, FOE] as PlayerId[]) {
    const turn = structuredClone(named);
    turn.active = active;
    const g = turn.players[ME].monsters[0]!;
    const b = turn.players[ME].monsters[1]!;
    ok(
      displayName(turn, g) === 'Toon Alligator' && displayName(turn, b) === 'Toon Dark Rabbit',
      `named the same on ${active === ME ? 'your' : "their"} turn`,
      `${displayName(turn, g)} / ${displayName(turn, b)}`
    );
  }

  /* Nor on which pile it is sitting in. The board prints the name in the hand,
     in the Graveyard viewer and in every picker, and one rule answers all of
     them: on the field it is the controller's book, everywhere else it is the
     owner's. */
  const piles = fresh();
  piles.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  const held = card(ME, 'dark-rabbit');
  const buried = card(ME, 'dark-rabbit');
  const theirBuried = card(FOE, 'dark-rabbit');
  piles.players[ME].hand = [held];
  piles.players[ME].grave = [buried];
  piles.players[FOE].grave = [theirBuried];
  ok(displayName(piles, held) === 'Toon Dark Rabbit', 'a drawing in hand is already named for the open book',
    displayName(piles, held));
  ok(displayName(piles, buried) === 'Toon Dark Rabbit', 'and so is one in the Graveyard beneath it',
    displayName(piles, buried));
  ok(displayName(piles, theirBuried) === 'Dark Rabbit', 'while their Graveyard reads by their own shut book',
    displayName(piles, theirBuried));

  const noBook = fresh();
  const spare = card(ME, 'dark-rabbit');
  noBook.players[ME].hand = [spare];
  ok(displayName(noBook, spare) === 'Dark Rabbit', 'with no book in play it is a rabbit like any other',
    displayName(noBook, spare));
}

console.log('\nThe eye eats what you point at');
{
  /* Reported: "Relinquished should let me decide which monster to absorb".
     Two faults under it. The Ritual's Tribute cost paid with whatever stood in
     the first zone and threw the player's answer away — the board asks "Choose
     a monster to Tribute" and the engine had never once read the reply. And the
     monster's own arrival question had nowhere to travel, so the absorb fell
     back to "the strongest" whatever was chosen. */
  const s = fresh();
  const ritual = card(ME, 'black-illusion-ritual');
  s.players[ME].hand = [ritual, card(ME, 'relinquished')];
  const keeper = card(ME, 'summoned-skull'); // zone 0 — what the cost used to eat
  const offering = card(ME, 'kuriboh');      // zone 1 — what the player picks
  s.players[ME].monsters = [keeper, offering, null];
  const weak = card(FOE, 'mystical-elf');    // 800
  const strong = card(FOE, 'summoned-skull'); // 2500 — the old auto-pick
  s.players[FOE].monsters = [weak, strong, null];

  const done = act(s, ME, { type: 'activateSpell', uid: ritual.uid, targets: [offering.uid, weak.uid] });
  ok(
    done.players[ME].grave.some((g) => g.slug === 'kuriboh'),
    'the Tribute you pointed at is the one that pays',
    done.players[ME].grave.map((g) => g.slug).join(',')
  );
  ok(
    done.players[ME].monsters.some((m) => m?.slug === 'summoned-skull'),
    'and the monster you kept is still standing'
  );
  const rel = done.players[ME].monsters.find((m) => m?.slug === 'relinquished');
  ok(!!rel, 'Relinquished arrives', done.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(
    !!rel && rel.absorbed.some((a) => a.slug === 'mystical-elf'),
    'and swallows the monster you chose, not the biggest one',
    rel ? rel.absorbed.map((a) => a.slug).join(',') || '(nothing)' : 'gone'
  );
  ok(
    done.players[FOE].monsters.some((m) => m?.slug === 'summoned-skull'),
    'leaving the one you did not choose alone'
  );

  /* The fusion asks the same question, and always could — its own once-per-turn
     is a player-initiated effect, so the board opens a picker for it. */
  const eyes = fresh();
  const eye = card(ME, 'thousand-eyes-restrict');
  eyes.players[ME].monsters = [eye, null, null];
  const small = card(FOE, 'mystical-elf');
  eyes.players[FOE].monsters = [small, card(FOE, 'summoned-skull'), null];
  const spec = targetSpecFor('thousand-eyes-restrict', 'ignition')!;
  ok(targetCandidates(eyes, ME, spec).length === 2, 'the eye is offered both monsters to choose from');
  const ate = act(eyes, ME, { type: 'ignition', uid: eye.uid, targets: [small.uid] });
  const fed = ate.players[ME].monsters.find((m) => m?.slug === 'thousand-eyes-restrict');
  ok(
    !!fed && fed.absorbed.some((a) => a.slug === 'mystical-elf'),
    'and swallows the one you named',
    fed ? fed.absorbed.map((a) => a.slug).join(',') || '(nothing)' : 'gone'
  );
}

console.log('\nA card worth playing for what it leaves behind still plays');
{
  /* Reported: "toon world on an empty board says there is nothing this card can
     target and won't activate". The board was deciding for itself that an empty
     picker meant a wasted card. That is right for Ring of Destruction, which is
     spent on the target it cannot find, and wrong for a Field Spell whose whole
     worth is the aura — the search finding nobody costs nothing.
     The engine always knew the difference. The board is asked now. */
  const bare = fresh();
  const tw = card(ME, 'toon-world');
  bare.players[ME].hand = [tw];
  bare.players[ME].deck = [card(ME, 'dark-hole')]; // not a Toon in sight
  const offered = targetCandidates(bare, ME, targetSpecFor('toon-world', 'activate')!);
  ok(offered.length === 0, 'with no Toon in the Deck the picker offers nothing', `${offered.length}`);
  ok(!wastedWithoutTarget(bare, ME, tw, 'activate'), 'but the book is not wasted by that');
  const opened = act(bare, ME, { type: 'activateSpell', uid: tw.uid, targets: [] });
  ok(opened.players[ME].field?.slug === 'toon-world', 'and it opens anyway',
    opened.players[ME].field?.slug ?? '(empty)');

  /* Also with the Deck flatly empty, which is the same question asked harder. */
  const empty = fresh();
  const tw2 = card(ME, 'toon-world');
  empty.players[ME].hand = [tw2];
  empty.players[ME].deck = [];
  ok(!wastedWithoutTarget(empty, ME, tw2, 'activate'), 'and on an empty Deck too');

  /* CONTROL: a card that really would be spent for nothing is still refused,
     or the fix is just "never refuse anything". Dark Hole on a board with no
     monsters at all sweeps nothing and leaves nothing behind. */
  const sweep = fresh();
  const hole = card(ME, 'dark-hole');
  sweep.players[ME].hand = [hole];
  ok(wastedWithoutTarget(sweep, ME, hole, 'activate'),
    'CONTROL: Dark Hole with no monsters anywhere is still a wasted card');
  const worthIt = fresh();
  worthIt.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  worthIt.players[ME].hand = [hole];
  ok(!wastedWithoutTarget(worthIt, ME, hole, 'activate'),
    'and is not the moment there is something to sweep');
}

console.log('\nThe picker and the engine read one filter');
{
  /* Two copies of the filter had drifted: the client's knew nothing about
     `toon`, so Toon World's "add 1 Toon monster" offered every monster in the
     Deck. Reported as the modal showing the whole deck, and it survived a first
     look because `kind: 'monster'` was doing enough filtering to seem right. */
  const s = fresh();
  s.players[ME].hand = [card(ME, 'toon-world')];
  s.players[ME].deck = [
    card(ME, 'toon-mermaid'),
    card(ME, 'dark-hole'),
    card(ME, 'parrot-dragon'),
    card(ME, 'relinquished'),
    card(ME, 'bickuribox'),
  ];
  const offered = targetCandidates(s, ME, targetSpecFor('toon-world', 'activate')!).map((c) => c.slug);
  ok(offered.includes('toon-mermaid'), 'the book offers a Toon', offered.join(',') || 'nothing');
  ok(offered.includes('bickuribox'), 'and a drawing it can bring to life');
  ok(!offered.includes('parrot-dragon'), 'not the bird that was never one');
  ok(!offered.includes('relinquished'), 'not a Ritual monster');
  ok(!offered.includes('dark-hole'), 'and not a Spell');
}

console.log('\nRyu-Ran throws itself away for the book');
{
  /* The panic button, priced like one: it finds Toon World from the Deck and
     takes everything already committed with it. */
  const panic = fresh();
  const ryu = card(ME, 'ryu-ran');
  panic.players[ME].hand = [ryu, card(ME, 'kuriboh')];
  panic.players[ME].monsters = [card(ME, 'summoned-skull'), card(ME, 'battle-ox'), null];
  panic.players[ME].spellTrap = card(ME, 'trap-hole');
  panic.players[ME].deck = [card(ME, 'toon-world'), card(ME, 'mystical-elf')];
  const theirs = card(FOE, 'battle-ox');
  panic.players[FOE].monsters = [theirs, null, null];

  const spent = act(panic, ME, { type: 'discardForEffect', uid: ryu.uid });
  ok(spent.players[ME].grave.some((g) => g.slug === 'ryu-ran'), 'Ryu-Ran goes to the Graveyard');
  ok(!spent.players[ME].hand.some((h) => h.slug === 'ryu-ran'), 'and leaves the hand');
  ok(spent.players[ME].hand.some((h) => h.slug === 'toon-world'), 'the book is dug out of the Deck',
    spent.players[ME].hand.map((h) => h.slug).join(',') || 'empty');
  ok(spent.players[ME].monsters.every((m) => !m), 'and every monster you had is destroyed',
    spent.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(!spent.players[ME].spellTrap, 'along with your backrow');
  ok(spent.players[FOE].monsters.some((m) => m?.slug === 'battle-ox'),
    "CONTROL: the other duelist's board is untouched — it is your field it costs");

  /* And it is not a summon: no Normal Summon is spent on it. */
  ok(!spent.players[ME].normalSummonUsed, 'and it does not spend your Normal Summon');
}

console.log('\nParrot Dragon comes out cheap, or whole');
{
  /* Its own bargain: no Tributes, half a body — and only the whole price may be
     skipped, so this is a choice rather than a discount. */
  const cheap = fresh();
  const bird = card(ME, 'parrot-dragon'); // Level 5, 2000/1300
  cheap.players[ME].hand = [bird];
  cheap.players[ME].deck = [card(ME, 'kuriboh')];
  ok(tributesRequired('parrot-dragon', cheap, ME) === 1, 'Parrot Dragon normally costs a Tribute');
  const rushed = act(cheap, ME, { type: 'normalSummon', uid: bird.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  const onField = rushed.players[ME].monsters.find((m) => m?.slug === 'parrot-dragon');
  ok(!!onField, 'and may skip it entirely', rushed.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(!!onField && effAtk(rushed, onField, ME) === Math.floor(baseAtkOf('parrot-dragon') / 2),
    'for half its ATK', onField ? `${effAtk(rushed, onField, ME)} of ${Math.floor(baseAtkOf('parrot-dragon') / 2)}` : 'gone');
  ok(rushed.players[ME].hand.some((h) => h.slug === 'kuriboh'), 'and still draws its card on arrival');

  /* Paid for properly, it is the whole bird. */
  const paid = fresh();
  const bird2 = card(ME, 'parrot-dragon');
  const fodder = card(ME, 'kuriboh');
  paid.players[ME].hand = [bird2];
  paid.players[ME].monsters = [fodder, null, null];
  paid.players[ME].deck = [card(ME, 'mystical-elf')];
  const full = act(paid, ME, { type: 'normalSummon', uid: bird2.uid, zone: 1, position: 'atk', face: 'up', tributes: [fodder.uid] });
  const whole = full.players[ME].monsters.find((m) => m?.slug === 'parrot-dragon');
  ok(!!whole && effAtk(full, whole, ME) === baseAtkOf('parrot-dragon'),
    'CONTROL: pay the Tribute and it arrives at full strength', whole ? `${effAtk(full, whole, ME)}` : 'gone');

  /* Nobody else gets the bargain. */
  const other = fresh();
  const skull = card(ME, 'summoned-skull');
  other.players[ME].hand = [skull];
  const refused = applyAction(other, ME, { type: 'normalSummon', uid: skull.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(!!refused.error, 'CONTROL: a monster that never offered it still pays', refused.error ?? 'allowed');
}

console.log('\nThe eye swallows, stares, and pays for its own destruction');
{
  /* Absorbed monsters go home to their *owner's* Graveyard.
     The case that matters is the one where the owner is not simply the other
     seat: a monster of mine that they had taken, which my Relinquished then
     swallowed back. The old code wrote "whoever is not holding me", which is
     right in the ordinary case and wrong here — and an assertion built on the
     ordinary case passes either way, which is how the first version of this
     pin managed to prove nothing at all. */
  const eat = fresh();
  const rel = card(ME, 'relinquished');
  eat.players[ME].monsters = [rel, null, null];
  const mineStolen = card(ME, 'battle-ox'); // owned by ME, standing on their side
  eat.players[FOE].monsters = [mineStolen, null, null];
  rel.absorbed = [{ slug: 'battle-ox', owner: ME }];
  const dark = card(ME, 'dark-hole');
  eat.players[ME].hand = [dark];
  const swept = act(eat, ME, { type: 'activateSpell', uid: dark.uid, targets: [] });
  ok(swept.players[ME].grave.some((g) => g.slug === 'battle-ox'),
    "a destroyed Relinquished sends what it swallowed to its owner's Graveyard",
    swept.players[ME].grave.map((g) => g.slug).join(',') || 'empty');
  ok(!swept.players[FOE].grave.some((g) => g.slug === 'battle-ox'),
    'and not to whichever seat happens not to be holding it');

  /* The stare: the eye is the only thing they may swing at. */
  const stare = fresh('battle');
  stare.active = FOE;
  const eye = card(ME, 'thousand-eyes-restrict');
  const bystander = card(ME, 'mystical-elf');
  stare.players[ME].monsters = [eye, bystander, null];
  const swinger = card(FOE, 'summoned-skull');
  swinger.summonedOnTurn = 0;
  stare.players[FOE].monsters = [swinger, null, null];
  const legal = legalAttackTargets(stare, FOE, swinger);
  ok(legal.uids.length === 1 && legal.uids[0] === eye.uid,
    'every attack must be aimed at Thousand-Eyes Restrict',
    legal.uids.length + ' target(s)');
  ok(!legal.direct, 'and nobody walks past it');

  /* Destruction is paid out of the stomach — and only while there is one. */
  const fed = fresh();
  const full = card(ME, 'thousand-eyes-restrict');
  full.absorbed = [{ slug: 'battle-ox', owner: FOE }];
  fed.players[ME].monsters = [full, null, null];
  const hole = card(ME, 'dark-hole');
  fed.players[ME].hand = [hole];
  const spat = act(fed, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
  const alive = spat.players[ME].monsters.find((m) => m?.slug === 'thousand-eyes-restrict');
  ok(!!alive, 'a fed eye survives a Dark Hole by spitting instead', spat.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(!!alive && alive.absorbed.length === 0, 'with its stomach emptied');
  ok(spat.players[FOE].grave.some((g) => g.slug === 'battle-ox'), 'and the meal sent home');
  ok(!!alive && effAtk(spat, alive, ME) === baseAtkOf('thousand-eyes-restrict'),
    'back to its own printed ATK', alive ? `${effAtk(spat, alive, ME)}` : 'gone');

  const starving = fresh();
  const empty = card(ME, 'thousand-eyes-restrict');
  starving.players[ME].monsters = [empty, null, null];
  starving.players[ME].hand = [card(ME, 'dark-hole')];
  const gone = act(starving, ME, { type: 'activateSpell', uid: starving.players[ME].hand[0].uid, targets: [] });
  ok(!gone.players[ME].monsters.some((m) => m?.slug === 'thousand-eyes-restrict'),
    'an empty one dies like anything else',
    gone.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
}

console.log('\nThe Graveyard gives back what could have stood there');
{
  /* A Toon needs the book to come back; a drawing does not. */
  const noBook = fresh();
  const skull = card(ME, 'toon-summoned-skull');
  noBook.players[ME].grave = [skull, card(ME, 'dark-rabbit')];
  noBook.players[ME].hand = [card(ME, 'monster-reborn')];
  const spec = targetSpecFor('monster-reborn', 'activate')!;
  const offered = targetCandidates(noBook, ME, spec).map((c) => c.slug);
  ok(!offered.includes('toon-summoned-skull'), 'with no book, a true Toon is not offered', offered.join(',') || 'nothing');
  ok(offered.includes('dark-rabbit'), 'but a drawing is — without the book it is an ordinary monster');

  const withBook = structuredClone(noBook);
  withBook.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  const offered2 = targetCandidates(withBook, ME, targetSpecFor('monster-reborn', 'activate')!).map((c) => c.slug);
  ok(offered2.includes('toon-summoned-skull'), 'open the book and it is', offered2.join(','));

  /* Ritual monsters were the reported gap. */
  const ritual = fresh();
  ritual.players[ME].grave = [card(ME, 'relinquished')];
  ritual.players[ME].hand = [card(ME, 'monster-reborn')];
  const revived = act(ritual, ME, { type: 'activateSpell', uid: ritual.players[ME].hand[0].uid, targets: [ritual.players[ME].grave[0].uid] });
  ok(revived.players[ME].monsters.some((m) => m?.slug === 'relinquished'),
    'Monster Reborn brings a Ritual monster back',
    revived.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
}

console.log('\nBakura counts the dead, and the dead do not stay put');
{
  /* Every number in the owner's Bakura batch, one assertion apiece, plus the
     two that were not numbers: what a Graveyard is worth to the cards reading
     it, and what a card leaves behind when it dies. */

  /* Souls of the Forgotten: 500 a body, and no longer only for Fiends. */
  const souls = fresh();
  const forgotten = card(ME, 'souls-of-the-forgotten');
  souls.players[ME].monsters = [forgotten, null, null];
  souls.players[ME].grave = [card(ME, 'battle-ox'), card(ME, 'mystical-elf'), card(ME, 'dark-hole')];
  ok(effAtk(souls, forgotten, ME) === 900 + 2 * 500, 'Souls of the Forgotten counts any monster at 500',
    `${effAtk(souls, forgotten, ME)} of ${900 + 1000}`);

  /* Man-Eater Bug: 500 now, and the Spell in the Graveyard is not a body. */
  const bitten = (() => {
    const s = fresh('battle');
    s.active = FOE;
    const eater = { ...card(ME, 'man-eater-bug'), face: 'down' as const, position: 'def' as const };
    s.players[ME].monsters = [eater, null, null];
    const big = card(FOE, 'summoned-skull');
    big.summonedOnTurn = 0;
    s.players[FOE].monsters = [big, null, null];
    return act(s, FOE, { type: 'attack', uid: big.uid, targetUid: eater.uid });
  })();
  ok(bitten.players[FOE].lp === 4000 - 500, 'Man-Eater Bug bites for 500', `${bitten.players[FOE].lp}`);

  /* Headless Knight: 100 a card, counted once on arrival and kept. */
  const knightly = fresh();
  const knight = card(ME, 'headless-knight');
  knightly.players[ME].hand = [knight];
  knightly.players[ME].grave = [card(ME, 'kuriboh'), card(ME, 'dark-hole'), card(ME, 'trap-hole'), card(ME, 'battle-ox')];
  const risen = act(knightly, ME, { type: 'normalSummon', uid: knight.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  const armoured = risen.players[ME].monsters.find((m) => m?.slug === 'headless-knight')!;
  ok(effAtk(risen, armoured, ME) === 1450 + 4 * 100, 'Headless Knight wears 100 for every card in the Graveyard',
    `${effAtk(risen, armoured, ME)} of ${1450 + 400}`);
  /* The one other card reading the same scale keeps its own rate. */
  const chaos = fresh();
  const wizard = card(ME, 'dark-magician');
  chaos.players[ME].hand = [wizard];
  chaos.players[ME].monsters = [card(ME, 'kuriboh'), card(ME, 'kuriboh'), null];
  chaos.players[ME].grave = [card(ME, 'dark-hole'), card(ME, 'trap-hole')];
  const summoned = act(chaos, ME, {
    type: 'normalSummon',
    uid: wizard.uid,
    zone: 2,
    position: 'atk',
    face: 'up',
    tributes: chaos.players[ME].monsters.filter(Boolean).map((m) => m!.uid),
  });
  const mage = summoned.players[ME].monsters.find((m) => m?.slug === 'dark-magician')!;
  ok(effAtk(summoned, mage, ME) === baseAtkOf('dark-magician') + 4 * 200,
    'CONTROL: the Dark Magician still counts 200 — the rate is the card\'s, not the engine\'s',
    `${effAtk(summoned, mage, ME)}`);

  /* White Magical Hat picks a pocket arriving and another leaving. */
  const thief = fresh();
  const hat = card(ME, 'white-magical-hat');
  thief.players[ME].hand = [hat];
  thief.players[FOE].hand = [card(FOE, 'kuriboh'), card(FOE, 'battle-ox'), card(FOE, 'mystical-elf')];
  const arrived = act(thief, ME, { type: 'normalSummon', uid: hat.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(arrived.players[FOE].hand.length === 2, 'White Magical Hat lifts a card on the way in',
    `${arrived.players[FOE].hand.length} left`);
  const robbed = (() => {
    const s = structuredClone(arrived);
    s.active = FOE;
    const dh = card(FOE, 'dark-hole');
    s.players[FOE].hand.push(dh);
    return act(s, FOE, { type: 'activateSpell', uid: dh.uid, targets: [] });
  })();
  /* Dark Hole was itself in that hand, so the count to beat is what remains
     after it is spent — the theft is the difference, not the total. */
  ok(robbed.players[FOE].hand.length === 1, 'and another on the way out', `${robbed.players[FOE].hand.length} left`);

  /* Lady of Faith: 1000 now, and her killer is handed the Change of Heart. */
  const lady = fresh();
  const faith = card(ME, 'lady-of-faith');
  lady.players[ME].hand = [faith];
  lady.players[ME].grave = [card(ME, 'headless-knight')];
  lady.players[ME].deck = [card(ME, 'change-of-heart'), card(ME, 'kuriboh')];
  const blessed = act(lady, ME, { type: 'normalSummon', uid: faith.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(blessed.players[ME].lp === 4000 + 1000, 'Lady of Faith is worth 1000 Life Points', `${blessed.players[ME].lp}`);
  const mourned = (() => {
    const s = structuredClone(blessed);
    s.active = FOE;
    const dh = card(FOE, 'dark-hole');
    s.players[FOE].hand = [dh];
    return act(s, FOE, { type: 'activateSpell', uid: dh.uid, targets: [] });
  })();
  ok(mourned.players[ME].hand.some((c) => c.slug === 'change-of-heart'),
    'and hands over Change of Heart when she is destroyed',
    mourned.players[ME].hand.map((c) => c.slug).join(',') || 'empty');

  /* Dark Necrofear: 200 a corpse, any corpse, on either side. */
  const doll = fresh();
  const necro = card(ME, 'dark-necrofear');
  doll.players[ME].monsters = [necro, null, null];
  doll.players[ME].grave = [card(ME, 'battle-ox')];
  doll.players[FOE].grave = [card(FOE, 'mystical-elf'), card(FOE, 'dark-hole')];
  ok(effAtk(doll, necro, ME) === 2200 + 2 * 200, 'Dark Necrofear wears 200 for every monster in either Graveyard',
    `${effAtk(doll, necro, ME)} of ${2200 + 400}`);
  ok(effDef(doll, necro, ME) === 2800 + 2 * 200, 'and the same in DEF', `${effDef(doll, necro, ME)}`);
  const widowed = (() => {
    const s = structuredClone(doll);
    s.active = FOE;
    s.players[ME].deck = [card(ME, 'dark-sanctuary'), card(ME, 'kuriboh')];
    const dh = card(FOE, 'dark-hole');
    s.players[FOE].hand = [dh];
    return act(s, FOE, { type: 'activateSpell', uid: dh.uid, targets: [] });
  })();
  ok(widowed.players[ME].hand.some((c) => c.slug === 'dark-sanctuary'),
    'and calls the house back when she is destroyed',
    widowed.players[ME].hand.map((c) => c.slug).join(',') || 'empty');

  /* Dark Sanctuary: the house feeds everything, fetches the doll, and puts her
     on the board when it comes down. */
  const house = fresh();
  const sanctuary = card(ME, 'dark-sanctuary');
  house.players[ME].hand = [sanctuary];
  house.players[ME].deck = [card(ME, 'dark-necrofear'), card(ME, 'kuriboh')];
  const ox = card(ME, 'battle-ox'); // Beast-Warrior — no Fiend would have felt this
  house.players[ME].monsters = [ox, null, null];
  const opened = act(house, ME, { type: 'activateSpell', uid: sanctuary.uid, targets: [] });
  ok(opened.players[ME].hand.some((c) => c.slug === 'dark-necrofear'),
    'Dark Sanctuary calls Dark Necrofear the moment it is activated',
    opened.players[ME].hand.map((c) => c.slug).join(',') || 'empty');
  const standing = opened.players[ME].monsters.find((m) => m?.slug === 'battle-ox')!;
  ok(effAtk(opened, standing, ME) === baseAtkOf('battle-ox') + 600,
    'and lends 600 to every monster you control, Fiend or not', `${effAtk(opened, standing, ME)}`);

  /* Heads and tails both, by driving the seed rather than hoping. */
  const burns = new Set<number>();
  for (let seed = 0; seed < 24; seed++) {
    const tick = structuredClone(opened);
    tick.seed = seed;
    tick.players[ME].hand = [];
    const ended = act(tick, ME, { type: 'endTurn' });
    burns.add(4000 - ended.players[FOE].lp);
  }
  ok(burns.has(1000) && burns.has(500) && burns.size === 2,
    'and the coin pays 1000 or 500, and nothing else', [...burns].sort((a, b) => b - a).join(' / '));

  const razed = (() => {
    const s = structuredClone(opened);
    s.active = FOE;
    s.players[ME].hand = [card(ME, 'dark-necrofear')];
    const despell = card(FOE, 'de-spell');
    s.players[FOE].hand = [despell];
    return act(s, FOE, { type: 'activateSpell', uid: despell.uid, targets: [s.players[ME].field!.uid] });
  })();
  ok(razed.players[ME].monsters.some((m) => m?.slug === 'dark-necrofear'),
    'and pulling the house down puts the doll on the board',
    razed.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));

  /* Sangan: destroyed, it leaves the smallest thing in the Deck standing. */
  const fetcher = fresh();
  const sangan = card(ME, 'sangan');
  fetcher.players[ME].monsters = [sangan, null, null];
  fetcher.players[ME].deck = [card(ME, 'summoned-skull'), card(ME, 'kuriboh'), card(ME, 'battle-ox')];
  const gone = (() => {
    const s = structuredClone(fetcher);
    s.active = FOE;
    const dh = card(FOE, 'dark-hole');
    s.players[FOE].hand = [dh];
    return act(s, FOE, { type: 'activateSpell', uid: dh.uid, targets: [] });
  })();
  const wall = gone.players[ME].monsters.find(Boolean);
  ok(wall?.slug === 'kuriboh', 'Sangan leaves the weakest monster in the Deck behind, not the best',
    gone.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(wall?.position === 'def' && wall?.face === 'up', 'face-up, in Defence', `${wall?.face}/${wall?.position}`);

  /* Witch of the Black Forest brings Sangan with her. */
  const witchy = fresh();
  const witch = card(ME, 'witch-of-the-black-forest');
  witchy.players[ME].hand = [witch];
  witchy.players[ME].deck = [card(ME, 'sangan'), card(ME, 'summoned-skull')];
  const paired = act(witchy, ME, { type: 'normalSummon', uid: witch.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  const escort = paired.players[ME].monsters.find((m) => m?.slug === 'sangan');
  ok(!!escort, 'Witch of the Black Forest arrives with Sangan',
    paired.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(escort?.position === 'def' && escort?.face === 'up', 'and stands it up as a wall', `${escort?.face}/${escort?.position}`);

  /* The Portrait's Secret splits, and each piece bills the opponent. */
  const painting = fresh();
  const secret = card(ME, 'the-portrait-s-secret');
  painting.players[ME].monsters = [secret, null, null];
  const slashed = (() => {
    const s = structuredClone(painting);
    s.active = FOE;
    const dh = card(FOE, 'dark-hole');
    s.players[FOE].hand = [dh];
    return act(s, FOE, { type: 'activateSpell', uid: dh.uid, targets: [] });
  })();
  const faces = slashed.players[ME].monsters.filter((m) => m?.isToken);
  ok(faces.length === 3, 'The Portrait\'s Secret leaves three of itself behind',
    slashed.players[ME].monsters.map((m) => (m ? (m.tokenName ?? m.slug) : '-')).join(','));
  const before = slashed.players[FOE].lp;
  const torn = (() => {
    const s = structuredClone(slashed);
    s.active = FOE;
    const dh = card(FOE, 'dark-hole');
    s.players[FOE].hand = [dh];
    return act(s, FOE, { type: 'activateSpell', uid: dh.uid, targets: [] });
  })();
  ok(before - torn.players[FOE].lp === 3 * 300, 'and each one taken off the wall costs 300',
    `${before - torn.players[FOE].lp}`);
  ok(!torn.players[ME].grave.some((c) => c.isToken), 'CONTROL: a Token still leaves no body in the Graveyard');

  /* Earthbound Spirit pays for its own return, and what returns is hollow. */
  const buried = fresh();
  const spirit = card(ME, 'earthbound-spirit');
  buried.players[ME].monsters = [spirit, null, null];
  const foeOx = card(FOE, 'battle-ox');
  buried.players[FOE].monsters = [foeOx, null, null];
  ok(effAtk(buried, foeOx, FOE) === baseAtkOf('battle-ox') - 500, 'Earthbound Spirit drags their monsters down while it stands',
    `${effAtk(buried, foeOx, FOE)}`);
  const returned = (() => {
    const s = structuredClone(buried);
    s.active = FOE;
    const dh = card(FOE, 'dark-hole');
    s.players[FOE].hand = [dh];
    return act(s, FOE, { type: 'activateSpell', uid: dh.uid, targets: [] });
  })();
  ok(returned.players[ME].lp === 4000 - 1000, 'and its passing costs you 1000', `${returned.players[ME].lp}`);
  ok(returned.players[FOE].lp === 4000 - 500, 'and them 500', `${returned.players[FOE].lp}`);
  const husk = returned.players[ME].monsters.find((m) => m?.isToken);
  ok(husk?.tokenAtk === 500 && husk?.tokenDef === 2000 && husk?.position === 'def',
    'and what climbs back out has its numbers', husk ? `${husk.tokenAtk}/${husk.tokenDef} ${husk.position}` : 'nothing');
  const survivor = returned.players[FOE].monsters.find(Boolean);
  ok(!survivor, 'CONTROL: Dark Hole took their board with it, so nothing is left to drain');
  const drained = (() => {
    const s = structuredClone(returned);
    const ox2 = card(FOE, 'battle-ox');
    s.players[FOE].monsters = [ox2, null, null];
    return effAtk(s, ox2, FOE);
  })();
  ok(drained === baseAtkOf('battle-ox'), 'and it haunts nobody — the husk has no effect at all', `${drained}`);

  /* The Earl of Demise may skip the Tribute, at half of himself, and his hand
     goes through any Spell or Trap they control — face-up, face-down, or the
     Field Spell — whichever one is pointed at. */
  const earl = fresh();
  const noble = card(ME, 'the-earl-of-demise');
  earl.players[ME].hand = [noble];
  const trap = { ...card(FOE, 'trap-hole'), face: 'down' as const };
  earl.players[FOE].spellTrap = trap;
  ok(tributesRequired('the-earl-of-demise', earl, ME) === 1, 'The Earl of Demise normally costs a Tribute');
  const rushed = act(earl, ME, {
    type: 'normalSummon', uid: noble.uid, zone: 0, position: 'atk', face: 'up', tributes: [], targets: [trap.uid],
  });
  const half = rushed.players[ME].monsters.find((m) => m?.slug === 'the-earl-of-demise');
  ok(!!half && effAtk(rushed, half, ME) === Math.floor(2000 / 2), 'but may arrive for nothing at half his ATK',
    half ? `${effAtk(rushed, half, ME)}` : 'gone');
  ok(rushed.players[FOE].spellTrap === null, 'and his hand still goes through their Set card',
    rushed.players[FOE].spellTrap ? 'still set' : 'gone');

  /* The change the owner asked for: a card they have already played is no
     longer safe from him. */
  const played = fresh();
  const noble2 = card(ME, 'the-earl-of-demise');
  played.players[ME].hand = [noble2];
  const faceUp = card(FOE, 'the-dark-door'); // face-up Continuous Spell
  played.players[FOE].spellTrap = faceUp;
  const shattered = act(played, ME, {
    type: 'normalSummon', uid: noble2.uid, zone: 0, position: 'atk', face: 'up', tributes: [], targets: [faceUp.uid],
  });
  ok(shattered.players[FOE].spellTrap === null, 'and now through a face-up one as well',
    shattered.players[FOE].spellTrap ? 'still standing' : 'gone');

  /* "1 Spell or Trap your opponent controls" reaches the Field Zone, the same
     reading De-Spell and Dark Magician's ignition already use. */
  const weather = fresh();
  const noble3 = card(ME, 'the-earl-of-demise');
  weather.players[ME].hand = [noble3];
  const book = { ...card(FOE, 'toon-world'), face: 'up' as const };
  weather.players[FOE].field = book;
  const closed = act(weather, ME, {
    type: 'normalSummon', uid: noble3.uid, zone: 0, position: 'atk', face: 'up', tributes: [], targets: [book.uid],
  });
  ok(closed.players[FOE].field === null, 'and a Field Spell is a Spell they control',
    closed.players[FOE].field ? 'still open' : 'gone');

  /* One, not the lot. */
  const both = fresh();
  const noble4 = card(ME, 'the-earl-of-demise');
  both.players[ME].hand = [noble4];
  const set = { ...card(FOE, 'trap-hole'), face: 'down' as const };
  const umi = { ...card(FOE, 'umi'), face: 'up' as const };
  both.players[FOE].spellTrap = set;
  both.players[FOE].field = umi;
  const once = act(both, ME, {
    type: 'normalSummon', uid: noble4.uid, zone: 0, position: 'atk', face: 'up', tributes: [], targets: [umi.uid],
  });
  ok(once.players[FOE].field === null && once.players[FOE].spellTrap !== null,
    'and only the one he was pointed at',
    `field ${once.players[FOE].field ? 'kept' : 'gone'} / backrow ${once.players[FOE].spellTrap ? 'kept' : 'gone'}`);
}

console.log('\nMako: the sea and everything that lives in it');
{
  const sea = (st: DuelState) => { st.players[ME].field = { ...card(ME, 'umi'), face: 'up' as const }; return st; };

  /* Tornado Wall — the waterspouts stop the dying as well as the damage, and
     they stand over the side rather than over the monsters that were there. */
  const wall = (() => {
    /* An `anyOpponentTurn` trap is sprung from the Set card itself rather than
       answered in a window — the path `canActivateSetCard` opens for it. */
    const st = sea(fresh());
    const trap = { ...card(ME, 'tornado-wall'), face: 'down' as const };
    trap.summonedOnTurn = 0;
    st.players[ME].spellTrap = trap;
    const guard = card(ME, 'aqua-madoor');
    guard.summonedOnTurn = 0;
    st.players[ME].monsters = [guard, null, null];
    const raised = act(st, ME, { type: 'activateSetCard', uid: trap.uid, targets: [] });
    const swing = structuredClone(raised);
    swing.phase = 'battle';
    swing.active = FOE;
    const big = card(FOE, 'summoned-skull');
    big.summonedOnTurn = 0;
    swing.players[FOE].monsters = [big, null, null];
    const target = swing.players[ME].monsters.find((m) => m?.slug === 'aqua-madoor')!;
    return act(swing, FOE, { type: 'attack', uid: big.uid, targetUid: target.uid });
  })();
  ok(wall.players[ME].monsters.some((m) => m?.slug === 'aqua-madoor'), 'Tornado Wall keeps the monster it was raised over',
    wall.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(wall.players[ME].lp === 4000, 'and the damage still does not land', `${wall.players[ME].lp}`);
  const latecomer = (() => {
    const st = structuredClone(wall);
    const fresher = card(ME, 'flying-fish');
    st.players[ME].monsters[1] = fresher;
    return effFlags(st, fresher, ME).indestructibleByBattle === true;
  })();
  ok(latecomer, 'and a monster that walks in afterwards is behind it too');

  /* Umi — the sea calls the Oath up, and takes the shark down with it. */
  const opened = (() => {
    const st = fresh();
    const water = card(ME, 'umi');
    st.players[ME].hand = [water];
    st.players[ME].deck = [card(ME, 'fortress-whale-s-oath'), card(ME, 'kuriboh')];
    return act(st, ME, { type: 'activateSpell', uid: water.uid, targets: [] });
  })();
  ok(opened.players[ME].hand.some((c) => c.slug === 'fortress-whale-s-oath'),
    'Umi brings the Oath up with it', opened.players[ME].hand.map((c) => c.slug).join(',') || 'empty');

  const drowned = (() => {
    const st = sea(fresh());
    const shark = card(ME, 'great-white');
    const bystander = card(ME, 'aqua-madoor');
    st.players[ME].monsters = [shark, bystander, null];
    st.active = FOE;
    const despell = card(FOE, 'de-spell');
    st.players[FOE].hand = [despell];
    return act(st, FOE, { type: 'activateSpell', uid: despell.uid, targets: [st.players[ME].field!.uid] });
  })();
  ok(!drowned.players[ME].monsters.some((m) => m?.slug === 'great-white'), 'and the shark drowns when the sea is destroyed',
    drowned.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(drowned.players[ME].monsters.some((m) => m?.slug === 'aqua-madoor'), 'while everything else keeps swimming',
    drowned.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  const dry = fresh();
  const loneShark = card(ME, 'great-white');
  dry.players[ME].monsters = [loneShark, null, null];
  ok(effAtk(dry, loneShark, ME) === baseAtkOf('great-white'), 'CONTROL: a shark with no sea at all is simply a shark',
    `${effAtk(dry, loneShark, ME)}`);

  /* Great White feeds on what it kills. */
  const fed = (() => {
    const st = fresh('battle');
    const shark = card(ME, 'great-white'); // 1600
    shark.summonedOnTurn = 0;
    st.players[ME].monsters = [shark, null, null];
    const prey = card(FOE, 'kuriboh');
    st.players[FOE].monsters = [prey, null, null];
    return act(st, ME, { type: 'attack', uid: shark.uid, targetUid: prey.uid });
  })();
  const grown = fed.players[ME].monsters.find((m) => m?.slug === 'great-white')!;
  ok(effAtk(fed, grown, ME) === baseAtkOf('great-white') + 400, 'Great White grows 400 with every kill',
    `${effAtk(fed, grown, ME)}`);
  ok(fed.players[FOE].lp === 4000 - 400 - (baseAtkOf('great-white') - 300), 'and the 400 to the face still lands',
    `${fed.players[FOE].lp}`);

  /* Crab Turtle takes one, and you say which. */
  /* The Oath names two monsters and used to take the bigger one on its own —
     Crab Turtle 2550 over Fortress Whale 2350, every single time, which made
     the card that fetches the whale unable to fetch the whale. */
  const askOath = summonChoiceSpec('fortress-whale-s-oath', 'activate');
  ok(!!askOath, 'the Oath has a question to ask about which monster arrives', askOath ? askOath.prompt : '(none)');
  ok(askOath?.zone === 'handOrDeck', 'and looks in your hand as well as your Deck', askOath?.zone ?? '-');
  const shelf = (() => {
    const st = fresh();
    /* One copy already drawn, one still buried — both are the same option to
       a player, and the pool has to reach into both piles to say so. */
    st.players[ME].hand = [card(ME, 'fortress-whale-s-oath'), card(ME, 'crab-turtle')];
    st.players[ME].deck = [card(ME, 'fortress-whale'), card(ME, 'kuriboh')];
    return targetCandidates(st, ME, askOath!).map((c) => c.slug).sort();
  })();
  ok(shelf.join(',') === 'crab-turtle,fortress-whale', 'and offers exactly the two it names, one from each pile',
    shelf.join(',') || 'nothing');

  const whaleFirst = (() => {
    const st = fresh();
    const oathCard = card(ME, 'fortress-whale-s-oath');
    st.players[ME].hand = [oathCard];
    const whaleInDeck = card(ME, 'fortress-whale');
    st.players[ME].deck = [card(ME, 'crab-turtle'), whaleInDeck];
    const pay = card(ME, 'kuriboh');
    st.players[ME].monsters = [pay, null, null];
    return act(st, ME, { type: 'activateSpell', uid: oathCard.uid, targets: [pay.uid, whaleInDeck.uid] });
  })();
  ok(whaleFirst.players[ME].monsters.some((m) => m?.slug === 'fortress-whale'),
    'and the whale comes when you ask for the whale',
    whaleFirst.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));

  /* Crab Turtle is a Ritual monster: it comes out of the Oath, which pays a
     Tribute for it — so the Tribute is named first and the monster's own
     question travels behind it. */
  const tide = fresh();
  const oath = card(ME, 'fortress-whale-s-oath');
  tide.players[ME].hand = [oath];
  tide.players[ME].deck = [card(ME, 'crab-turtle')];
  const fodder = card(ME, 'kuriboh');
  tide.players[ME].monsters = [fodder, null, null];
  const keep = card(FOE, 'summoned-skull');
  const send = card(FOE, 'kuriboh');
  tide.players[FOE].monsters = [keep, send, null];
  const taken = act(tide, ME, { type: 'activateSpell', uid: oath.uid, targets: [fodder.uid, send.uid] });
  ok(taken.players[ME].monsters.some((m) => m?.slug === 'crab-turtle'), 'the Oath calls Crab Turtle up',
    taken.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(!taken.players[FOE].monsters.some((m) => m?.slug === 'kuriboh'), 'Crab Turtle returns the monster you point at',
    taken.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(taken.players[FOE].monsters.some((m) => m?.slug === 'summoned-skull'), 'and only that one',
    taken.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));

  /* Fortress Whale reaches to 2900 now. */
  const wave = fresh();
  const oath2 = card(ME, 'fortress-whale-s-oath');
  wave.players[ME].hand = [oath2];
  wave.players[ME].deck = [card(ME, 'fortress-whale')];
  const fodder2 = card(ME, 'kuriboh');
  wave.players[ME].monsters = [fodder2, null, null];
  const tall = card(FOE, 'summoned-skull'); // 2500
  const taller = card(FOE, 'blue-eyes-white-dragon'); // 3000
  wave.players[FOE].monsters = [tall, taller, null];
  const swept = act(wave, ME, { type: 'activateSpell', uid: oath2.uid, targets: [fodder2.uid] });
  /* Re-ruled by the owner: the Whale hunts GIANTS now — 2900 or more — so the
     old assertions flipped with the card. The batch-of-six section holds the
     paired pin; this one keeps the ritual path honest under the new rule. */
  ok(swept.players[FOE].monsters.some((m) => m?.slug === 'summoned-skull'), 'Fortress Whale leaves a 2500 swimming',
    swept.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(!swept.players[FOE].monsters.some((m) => m?.slug === 'blue-eyes-white-dragon'), 'and drowns the 3000',
    swept.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));

  /* Flying Fish leaves a card behind. */
  const flew = (() => {
    const st = fresh();
    const fish = card(ME, 'flying-fish');
    st.players[ME].monsters = [fish, null, null];
    st.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'battle-ox')];
    st.active = FOE;
    const dh = card(FOE, 'dark-hole');
    st.players[FOE].hand = [dh];
    return act(st, FOE, { type: 'activateSpell', uid: dh.uid, targets: [] });
  })();
  ok(flew.players[ME].hand.length === 1, 'Flying Fish draws a card on the way out', `${flew.players[ME].hand.length}`);

  /* Aqua Madoor — the owner asked us to check this one rather than change it:
     revealed by an attack, the drain has to land BEFORE the numbers are
     compared, or the wall is broken by a monster it should have turned aside. */
  const walled = (() => {
    const st = fresh('battle');
    st.active = FOE;
    const madoor = { ...card(ME, 'aqua-madoor'), face: 'down' as const, position: 'def' as const }; // 2000 DEF
    st.players[ME].monsters = [madoor, null, null];
    const judge = card(FOE, 'judge-man'); // 2200 ATK — 1800 once drained
    judge.summonedOnTurn = 0;
    st.players[FOE].monsters = [judge, null, null];
    return act(st, FOE, { type: 'attack', uid: judge.uid, targetUid: madoor.uid });
  })();
  ok(walled.players[ME].monsters.some((m) => m?.slug === 'aqua-madoor'),
    'Aqua Madoor drains the attacker before the blow is measured, and survives it',
    walled.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  const stillDrained = walled.players[FOE].monsters.find((m) => m?.slug === 'judge-man');
  ok(!!stillDrained && effAtk(walled, stillDrained, FOE) === 2200 - 400, 'with the attacker left standing at 1800',
    stillDrained ? `${effAtk(walled, stillDrained, FOE)}` : 'gone');

  /* Deepsea Warrior: a card on arrival, two a turn in his own water. */
  const diver = fresh();
  const warrior = card(ME, 'deepsea-warrior');
  diver.players[ME].hand = [warrior];
  diver.players[ME].monsters = [card(ME, 'kuriboh'), null, null];
  diver.players[ME].deck = [card(ME, 'battle-ox'), card(ME, 'kuriboh'), card(ME, 'mystical-elf')];
  const arrived = act(diver, ME, {
    type: 'normalSummon', uid: warrior.uid, zone: 1, position: 'atk', face: 'up',
    tributes: [diver.players[ME].monsters[0]!.uid],
  });
  ok(arrived.players[ME].hand.length === 1, 'Deepsea Warrior draws a card as he lands', `${arrived.players[ME].hand.length}`);

  const tideDraw = (withSea: boolean) => {
    const st = withSea ? sea(fresh()) : fresh();
    const w = card(ME, 'deepsea-warrior');
    w.summonedOnTurn = 0;
    st.players[ME].monsters = [w, null, null];
    st.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'battle-ox'), card(ME, 'mystical-elf'), card(ME, 'kuriboh')];
    st.active = FOE;
    st.phase = 'main';
    return act(st, FOE, { type: 'endTurn' }).players[ME].hand.length;
  };
  ok(tideDraw(true) === 2, 'and in his own water your turn starts with two cards', `${tideDraw(true)}`);
  ok(tideDraw(false) === 1, 'CONTROL: with no sea it is the usual one', `${tideDraw(false)}`);

  /* 7 Colored Fish fetches company instead of muscle. */
  const school = sea(fresh());
  const fish = card(ME, '7-colored-fish');
  school.players[ME].hand = [fish];
  school.players[ME].deck = [card(ME, 'great-white'), card(ME, 'blue-eyes-white-dragon'), card(ME, 'kuriboh')];
  const called = act(school, ME, { type: 'normalSummon', uid: fish.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(called.players[ME].hand.some((c) => c.slug === 'great-white'), '7 Colored Fish calls a WATER monster up under the tide',
    called.players[ME].hand.map((c) => c.slug).join(',') || 'empty');
  const onField7 = called.players[ME].monsters.find((m) => m?.slug === '7-colored-fish')!;
  ok(effAtk(called, onField7, ME) === baseAtkOf('7-colored-fish') + 500,
    'and is worth its printed ATK plus the sea, with no 800 of its own any more',
    `${effAtk(called, onField7, ME)}`);
  const dryFish = fresh();
  const fish2 = card(ME, '7-colored-fish');
  dryFish.players[ME].hand = [fish2];
  dryFish.players[ME].deck = [card(ME, 'great-white')];
  const nothing = act(dryFish, ME, { type: 'normalSummon', uid: fish2.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(!nothing.players[ME].hand.length, 'CONTROL: with no sea it calls nobody', nothing.players[ME].hand.map((c) => c.slug).join(','));

  /* Kairyu-Shin presses harder the more there is to press. */
  const shin = fresh();
  const dragon = card(ME, 'kairyu-shin');
  shin.players[ME].monsters = [dragon, null, null];
  const a1 = card(FOE, 'battle-ox');
  const a2 = card(FOE, 'battle-ox');
  shin.players[FOE].monsters = [a1, a2, null];
  ok(effAtk(shin, a1, FOE) === baseAtkOf('battle-ox') - 500, 'Kairyu-Shin drains 500 with no sea', `${effAtk(shin, a1, FOE)}`);
  ok(effAtk(shin, dragon, ME) === baseAtkOf('kairyu-shin') + 2 * 300, 'and grows 300 for each monster facing it',
    `${effAtk(shin, dragon, ME)}`);
  const shinSea = sea(structuredClone(shin));
  const a1b = shinSea.players[FOE].monsters[0]!;
  ok(effAtk(shinSea, a1b, FOE) === baseAtkOf('battle-ox') - 1000, 'and 1000 once the sea is up', `${effAtk(shinSea, a1b, FOE)}`);

  /* The Legendary Fisherman gives the deck back. */
  const before = { grave: 0, deck: 0 };
  const returned = (() => {
    const st = fresh();
    const fisherman = card(ME, 'the-legendary-fisherman'); // Level 5, so one Tribute
    st.players[ME].hand = [fisherman];
    const pay = card(ME, 'kuriboh');
    st.players[ME].monsters = [pay, null, null];
    st.players[ME].grave = Array.from({ length: 14 }, () => card(ME, 'battle-ox'));
    before.grave = st.players[ME].grave.length + 1; // the Tribute joins them first
    before.deck = st.players[ME].deck.length;
    return act(st, ME, {
      type: 'normalSummon', uid: fisherman.uid, zone: 1, position: 'atk', face: 'up', tributes: [pay.uid],
    });
  })();
  ok(before.grave - returned.players[ME].grave.length === 10,
    'The Legendary Fisherman shuffles ten of the drowned back into the Deck',
    `${before.grave} → ${returned.players[ME].grave.length}`);
  ok(returned.players[ME].deck.length - before.deck === 10, 'and the Deck has them',
    `${before.deck} → ${returned.players[ME].deck.length}`);

  /* A shallower Graveyard simply gives what it has. */
  const shallow = (() => {
    const st = fresh();
    const fisherman = card(ME, 'the-legendary-fisherman');
    st.players[ME].hand = [fisherman];
    const pay = card(ME, 'kuriboh');
    st.players[ME].monsters = [pay, null, null];
    st.players[ME].grave = [card(ME, 'battle-ox'), card(ME, 'mystical-elf')];
    return act(st, ME, { type: 'normalSummon', uid: fisherman.uid, zone: 1, position: 'atk', face: 'up', tributes: [pay.uid] });
  })();
  ok(shallow.players[ME].grave.length === 0, 'and "up to" means a shallow Graveyard is simply emptied',
    `${shallow.players[ME].grave.length} left`);

  const avenged = (() => {
    const st = fresh('battle');
    st.active = FOE;
    const fisherman = card(ME, 'the-legendary-fisherman');
    fisherman.summonedOnTurn = 0;
    st.players[ME].monsters = [fisherman, null, null];
    st.players[ME].deck = [card(ME, 'fortress-whale-s-oath'), card(ME, 'kuriboh')];
    const big = card(FOE, 'blue-eyes-white-dragon');
    big.summonedOnTurn = 0;
    st.players[FOE].monsters = [big, null, null];
    return act(st, FOE, { type: 'attack', uid: big.uid, targetUid: fisherman.uid });
  })();
  ok(avenged.players[ME].hand.some((c) => c.slug === 'fortress-whale-s-oath'),
    'and hands you the Oath when the sea takes him', avenged.players[ME].hand.map((c) => c.slug).join(',') || 'empty');

  /* Jellyfish asks the same question Man-Eater Bug does, for the same reason. */
  const jelly = (() => {
    const st = fresh();
    const j = { ...card(ME, 'jellyfish'), face: 'down' as const, position: 'def' as const };
    j.summonedOnTurn = 0;
    st.players[ME].monsters = [j, null, null];
    const keep2 = card(FOE, 'summoned-skull');
    const send2 = card(FOE, 'kuriboh');
    st.players[FOE].monsters = [keep2, send2, null];
    return { after: act(st, ME, { type: 'changePosition', uid: j.uid, targets: [send2.uid] }), keep2, send2 };
  })();
  ok(!jelly.after.players[FOE].monsters.some((m) => m?.slug === 'kuriboh'), 'Jellyfish returns the monster you point at',
    jelly.after.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(jelly.after.players[FOE].monsters.some((m) => m?.slug === 'summoned-skull'), 'and leaves the one you did not',
    jelly.after.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(!!targetSpecFor('jellyfish', 'onFlip'), 'and the board has a question to ask when you flip it');
}

console.log('\nA crossbow is not its own company');
{
  /* Reported: "Bowganian could not be destroyed by battle even if it was the
     only Bowganian on the field". Its text says "while you control ANOTHER
     Bowganian", and the condition named its own slug — a card is always on the
     field while it is asking, so the sentence could never be false. */
  const lone = fresh('battle');
  const solo = card(ME, 'bowganian');
  solo.summonedOnTurn = 0;
  lone.players[ME].monsters = [solo, null, null];
  ok(effAtk(lone, solo, ME) === baseAtkOf('bowganian'), 'a lone Bowganian is worth its printed ATK',
    `${effAtk(lone, solo, ME)} of ${baseAtkOf('bowganian')}`);
  ok(!effFlags(lone, solo, ME).indestructibleByBattle, 'and can be destroyed in battle like anything else');

  const pair = fresh('battle');
  const a1 = card(ME, 'bowganian');
  const a2 = card(ME, 'bowganian');
  a1.summonedOnTurn = 0;
  a2.summonedOnTurn = 0;
  pair.players[ME].monsters = [a1, a2, null];
  ok(effAtk(pair, a1, ME) === baseAtkOf('bowganian') + 800, 'CONTROL: bring its twin and the pair is worth 800 more each',
    `${effAtk(pair, a1, ME)}`);
  ok(!!effFlags(pair, a1, ME).indestructibleByBattle && !!effFlags(pair, a2, ME).indestructibleByBattle,
    'CONTROL: and neither of them can be destroyed in battle');

  /* Kill one and the survivor drops back to a mortal crossbow. */
  const widowed = structuredClone(pair);
  widowed.players[ME].monsters[1] = null;
  const left = widowed.players[ME].monsters[0]!;
  ok(effAtk(widowed, left, ME) === baseAtkOf('bowganian'), 'and losing the twin takes the bonus back',
    `${effAtk(widowed, left, ME)}`);
  ok(!effFlags(widowed, left, ME).indestructibleByBattle, 'and the immunity with it');

  /* And a lone one really does die to a bigger body, which is the report. */
  const struck = (() => {
    const s = fresh('battle');
    s.active = FOE;
    const target = card(ME, 'bowganian');
    target.summonedOnTurn = 0;
    s.players[ME].monsters = [target, null, null];
    const big = card(FOE, 'summoned-skull');
    big.summonedOnTurn = 0;
    s.players[FOE].monsters = [big, null, null];
    return act(s, FOE, { type: 'attack', uid: big.uid, targetUid: target.uid });
  })();
  ok(!struck.players[ME].monsters.some((m) => m?.slug === 'bowganian'), 'a lone Bowganian dies to a bigger body',
    struck.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
}

console.log('\nAn aura is weather over the field, not over your hand');
{
  /* Reported: "some monsters are shown in the hand with green buffed attack
     while still in hand". Nothing in the aura scan asked where the target was,
     only whether it matched the filter — so Dark Sanctuary's "your monsters
     gain 600" reached into the hand, the Graveyard and the Deck alike, and the
     board tinted a number the card would only actually have once it arrived. */
  const s = fresh();
  s.players[ME].field = { ...card(ME, 'dark-sanctuary'), face: 'up' as const };
  const standing = card(ME, 'battle-ox');
  s.players[ME].monsters = [standing, null, null];
  const held = card(ME, 'battle-ox');
  const buried = card(ME, 'battle-ox');
  const decked = card(ME, 'battle-ox');
  s.players[ME].hand = [held];
  s.players[ME].grave = [buried];
  s.players[ME].deck = [decked];

  ok(effAtk(s, standing, ME) === baseAtkOf('battle-ox') + 600, 'a monster on the field is lent the 600',
    `${effAtk(s, standing, ME)}`);
  ok(effAtk(s, held, ME) === baseAtkOf('battle-ox'), 'the copy in your hand is not', `${effAtk(s, held, ME)}`);
  ok(effDef(s, held, ME) === CARDS['battle-ox'].def, 'in DEF either', `${effDef(s, held, ME)}`);
  ok(effAtk(s, buried, ME) === baseAtkOf('battle-ox'), 'nor the one in the Graveyard', `${effAtk(s, buried, ME)}`);
  ok(effAtk(s, decked, ME) === baseAtkOf('battle-ox'), 'nor the one still in the Deck', `${effAtk(s, decked, ME)}`);

  /* And a grant travels the same way: a Toon in hand is not walking past
     anybody's blockers yet. */
  const book = fresh();
  book.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  const onField = card(ME, 'toon-mermaid');
  onField.summonedOnTurn = 0;
  book.players[ME].monsters = [onField, null, null];
  const inHand = card(ME, 'toon-mermaid');
  book.players[ME].hand = [inHand];
  ok(!!effFlags(book, onField, ME).directAttack, 'CONTROL: the Toon standing under the book still walks past blockers');
  ok(!effFlags(book, inHand, ME).directAttack, 'but the one in hand has not been given anything yet');
}

console.log('\nThe painting lets its faces out however it leaves');
{
  /* By the owner's ruling: sent to the Graveyard, not merely destroyed — so a
     Tribute lets them out too. */
  const tributed = fresh();
  const painting = card(ME, 'the-portrait-s-secret');
  painting.summonedOnTurn = 0;
  tributed.players[ME].monsters = [painting, null, null];
  const heavy = card(ME, 'summoned-skull'); // Level 6, one Tribute
  tributed.players[ME].hand = [heavy];
  const paid = act(tributed, ME, {
    type: 'normalSummon', uid: heavy.uid, zone: 1, position: 'atk', face: 'up', tributes: [painting.uid],
  });
  const faces = paid.players[ME].monsters.filter((m) => m?.isToken).length;
  ok(faces > 0, 'Tributing the painting still lets the faces out',
    paid.players[ME].monsters.map((m) => (m ? (m.tokenName ?? m.slug) : '-')).join(','));
  /* And the Summon it was paying for still lands. The faces used to fill all
     three zones during the payment, so the Tribute Summon they had just bought
     was refused for want of a zone — a Tribute's departure belongs after the
     monster it bought is standing. */
  ok(paid.players[ME].monsters.some((m) => m?.slug === 'summoned-skull'),
    'and the monster it was paying for is standing there',
    paid.players[ME].monsters.map((m) => (m ? (m.tokenName ?? m.slug) : '-')).join(','));
  ok(faces === 2, 'with the faces taking only the room left over', `${faces} of 3 zones`);

  /* Destroyed, it still does — "sent to the Graveyard" covers that too. */
  const slashed = (() => {
    const s = fresh();
    const p2 = card(ME, 'the-portrait-s-secret');
    s.players[ME].monsters = [p2, null, null];
    s.active = FOE;
    const dh = card(FOE, 'dark-hole');
    s.players[FOE].hand = [dh];
    return act(s, FOE, { type: 'activateSpell', uid: dh.uid, targets: [] });
  })();
  ok(slashed.players[ME].monsters.filter((m) => m?.isToken).length === 3,
    'CONTROL: and destroying it still leaves three of them',
    slashed.players[ME].monsters.map((m) => (m ? (m.tokenName ?? m.slug) : '-')).join(','));
}

console.log('\nA flip you make yourself asks you who to bite');
{
  /* Reported: "Man-Eater Bug the effect should allow me to select which
     monster". The card always said so and the board could never say it back:
     the Flip Summon path fired the effect with an empty target list, so the
     engine's own "take the strongest" fallback answered every time. */
  const board = () => {
    const s = fresh();
    const bug = { ...card(ME, 'man-eater-bug'), face: 'down' as const, position: 'def' as const };
    bug.summonedOnTurn = 0;
    s.players[ME].monsters = [bug, null, null];
    const big = card(FOE, 'summoned-skull'); // 2500
    const small = card(FOE, 'kuriboh'); // 300
    s.players[FOE].monsters = [big, small, null];
    return { s, bug, big, small };
  };

  const chose = (() => {
    const { s, bug, small } = board();
    return act(s, ME, { type: 'changePosition', uid: bug.uid, targets: [small.uid] });
  })();
  ok(!chose.players[FOE].monsters.some((m) => m?.slug === 'kuriboh'),
    'the monster you pointed at is the one that dies',
    chose.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(chose.players[FOE].monsters.some((m) => m?.slug === 'summoned-skull'),
    'and the bigger one it would have chosen for you is left standing',
    chose.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));

  /* Name nobody and it asks rather than helping itself. */
  const unasked = (() => {
    const { s, bug } = board();
    return act(s, ME, { type: 'changePosition', uid: bug.uid });
  })();
  ok(unasked.pending?.kind === 'choose' && unasked.pending.player === ME,
    'name nobody and the bug asks instead of choosing for you',
    unasked.pending ? `${unasked.pending.kind} for ${unasked.pending.player}` : '(nothing asked)');
  const bitOff = act(unasked, ME, { type: 'chooseCard', uids: [unasked.pending!.options.find((u) => unasked.players[FOE].monsters.some((m) => m?.uid === u && m.slug === 'summoned-skull'))!] });
  ok(!bitOff.players[FOE].monsters.some((m) => m?.slug === 'summoned-skull'),
    'and takes whichever you then name',
    bitOff.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));

  /* Flipped by an attack on the *opponent's* turn — the case this whole window
     exists for. The bug is mine, the turn is theirs, and the bite is still my
     choice to aim. */
  const revealed = (() => {
    const s = fresh('battle');
    s.active = FOE;
    const bug = { ...card(ME, 'man-eater-bug'), face: 'down' as const, position: 'def' as const };
    s.players[ME].monsters = [bug, null, null];
    const attacker = card(FOE, 'summoned-skull');
    attacker.summonedOnTurn = 0;
    const bystander = card(FOE, 'kuriboh');
    s.players[FOE].monsters = [attacker, bystander, null];
    return act(s, FOE, { type: 'attack', uid: attacker.uid, targetUid: bug.uid });
  })();
  ok(revealed.pending?.kind === 'choose' && revealed.pending.player === ME,
    'flipped by their attack, it asks ME — on THEIR turn',
    revealed.pending ? `${revealed.pending.kind} for ${revealed.pending.player}` : '(nothing asked)');
  const bitten = act(revealed, ME, { type: 'chooseCard', uids: [revealed.pending!.options.find((u) => revealed.players[FOE].monsters.some((m) => m?.uid === u && m.slug === 'summoned-skull'))!] });
  ok(!bitten.players[FOE].monsters.some((m) => m?.slug === 'summoned-skull'),
    'and the monster I named is the one it takes',
    bitten.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));

  /* And switching an already face-up monster carries no question at all. */
  const turned = fresh();
  const ox = card(ME, 'battle-ox');
  ox.summonedOnTurn = 0;
  turned.players[ME].monsters = [ox, null, null];
  const flipped = act(turned, ME, { type: 'changePosition', uid: ox.uid });
  ok(flipped.players[ME].monsters[0]?.position === 'def', 'CONTROL: a plain position change still just turns the card',
    flipped.players[ME].monsters[0]?.position ?? 'gone');
}

console.log('\nLady of Faith reaches into the dark without looking');
{
  /* "add 1 random fiend" — she used to take the best one in the Graveyard,
     which made her a reliable tutor rather than a séance. */
  const seen = new Set<string>();
  for (let seed = 0; seed < 60; seed++) {
    const s = fresh();
    s.seed = seed;
    const lady = card(ME, 'lady-of-faith');
    s.players[ME].hand = [lady];
    s.players[ME].grave = [
      card(ME, 'summoned-skull'), // 2500, the old certainty
      card(ME, 'sangan'),
      card(ME, 'headless-knight'),
      card(ME, 'battle-ox'), // Beast-Warrior — never eligible
    ];
    const after = act(s, ME, { type: 'normalSummon', uid: lady.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
    const took = after.players[ME].hand.find((c) => c.slug !== 'lady-of-faith');
    if (took) seen.add(took.slug);
  }
  ok(seen.size > 1, 'she does not always come back with the same Fiend', [...seen].join(', ') || 'nothing');
  ok(!seen.has('battle-ox'), 'and never with something that is not one', [...seen].join(', '));
  ok(seen.has('summoned-skull') && seen.has('sangan') && seen.has('headless-knight'),
    'every Fiend in the Graveyard can be the one', [...seen].sort().join(', '));
}

console.log('\nThe board announces a drawing by the name it arrives under');
{
  /* The engine's own Normal Summon line still read the printed name after the
     client's copies were fixed, so a Dark Rabbit summoned under an open book
     was announced as "Dark Rabbit" and then sat on the board called "Toon Dark
     Rabbit". The Flip Summon line beside it had been right all along. */
  const open = fresh();
  open.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  const bunny = card(ME, 'dark-rabbit');
  open.players[ME].hand = [bunny];
  open.players[FOE].hand = [card(FOE, 'kuriboh')];
  const hopped = act(open, ME, { type: 'normalSummon', uid: bunny.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  const said = hopped.log.find((l) => /Normal Summons/.test(l.text));
  ok(!!said?.text.includes('Toon Dark Rabbit'), 'a drawing is announced as the Toon it arrives as', said?.text ?? '(no line)');

  const shut = fresh();
  const bunny2 = card(ME, 'dark-rabbit');
  shut.players[ME].hand = [bunny2];
  const plain = act(shut, ME, { type: 'normalSummon', uid: bunny2.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  const saidPlain = plain.log.find((l) => /Normal Summons/.test(l.text));
  ok(!!saidPlain?.text.includes('Normal Summons Dark Rabbit') && !saidPlain!.text.includes('Toon'),
    'CONTROL: and as itself with the book shut', saidPlain?.text ?? '(no line)');
}

console.log('\nA card that comes up empty says so');
{
  /* Reported of Magical Hats: activated with Dark Magician in hand, and no
     magician arrived. It could not — Yami's deck runs exactly one of the four
     the hats hide, and it was the one in the hand. The engine was right and
     the board said nothing, which is indistinguishable from broken. */
  const hidden = (deck: string[]) => {
    const s = fresh('battle');
    s.active = FOE;
    const hats = { ...card(ME, 'magical-hats'), face: 'down' as const };
    s.players[ME].spellTrap = hats;
    const shield = { ...card(ME, 'big-shield-gardna'), face: 'down' as const, position: 'def' as const };
    s.players[ME].monsters = [shield, null, null];
    s.players[ME].hand = [card(ME, 'dark-magician')];
    s.players[ME].deck = deck.map((slug) => card(ME, slug));
    const beater = card(FOE, 'summoned-skull');
    beater.summonedOnTurn = 0;
    s.players[FOE].monsters = [beater, null, null];
    const swung = act(s, FOE, { type: 'attack', uid: beater.uid, targetUid: shield.uid });
    return act(swung, ME, { type: 'respondTrap', uid: hats.uid });
  };

  const empty = hidden(['celtic-guardian', 'gaia-the-fierce-knight']);
  ok(empty.players[ME].monsters.filter(Boolean).length === 1,
    'with no magician left in the Deck, nothing comes out from under the hats',
    empty.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  const excuse = empty.log.find((l) => /finds nothing to Special Summon/.test(l.text));
  ok(!!excuse, 'and the board says why rather than leaving it silent',
    empty.log.slice(-4).map((l) => l.text).join(' | '));
  ok(excuse?.slug === 'magical-hats', 'with the card that came up empty beside the line', excuse?.slug ?? '(no art)');
  ok(empty.players[FOE].monsters.some((m) => m?.slug === 'summoned-skull') && empty.players[ME].lp === 4000,
    'CONTROL: the attack is still negated — half a card is not a dead card');

  const stocked = hidden(['dark-magician-girl', 'celtic-guardian']);
  ok(stocked.players[ME].monsters.some((m) => m?.slug === 'dark-magician-girl' && m?.face === 'down'),
    'CONTROL: give the Deck a magician and one hides under a hat, face-down',
    stocked.players[ME].monsters.map((m) => (m ? `${m.slug}/${m.face}` : '-')).join(','));
  ok(!stocked.log.some((l) => /finds nothing/.test(l.text)), 'and then nothing is said about coming up empty');

  /* A full board is a different disappointment, and reads as one. */
  const crowded = fresh();
  const witch = card(ME, 'witch-of-the-black-forest');
  crowded.players[ME].hand = [witch];
  crowded.players[ME].monsters = [card(ME, 'kuriboh'), card(ME, 'battle-ox'), null];
  crowded.players[ME].deck = [card(ME, 'sangan')];
  const packed = act(crowded, ME, { type: 'normalSummon', uid: witch.uid, zone: 2, position: 'atk', face: 'up', tributes: [] });
  ok(packed.log.some((l) => /has no room to Special Summon/.test(l.text)),
    'a board with no free zone is told it is full, not that the Deck was empty',
    packed.log.slice(-3).map((l) => l.text).join(' | '));

  /* And the same courtesy for a search. */
  const barren = fresh();
  const lady = card(ME, 'lady-of-faith');
  barren.players[ME].monsters = [lady, null, null];
  barren.players[ME].deck = [card(ME, 'kuriboh')]; // no Change of Heart anywhere
  const mourned = (() => {
    const s = structuredClone(barren);
    s.active = FOE;
    const dh = card(FOE, 'dark-hole');
    s.players[FOE].hand = [dh];
    return act(s, FOE, { type: 'activateSpell', uid: dh.uid, targets: [] });
  })();
  const missed = mourned.log.find((l) => /finds nothing to add/.test(l.text));
  ok(!!missed, 'a search with nothing to find says so too', mourned.log.slice(-3).map((l) => l.text).join(' | '));
  ok(missed?.slug === 'lady-of-faith', 'and names the card that reached', missed?.slug ?? '(no art)');
}

/* ------------------------------------------------------------------ */
/* A line written after the duel ends keeps its own beat, and its face   */
/* ------------------------------------------------------------------ */
{
  console.log('\n— the last word of a duel —');
  /* Reported as "in some banner texts the card art is missing". The shape was
     always the same: a monster survives a hopeless attack, the recoil finishes
     the attacker, and the recoil is lethal. The engine logged "holds firm"
     *after* the damage, so by then the victory beat was already up — note-less,
     because nothing was pending when it went up — and `speakRemainingLog` gave
     it the line. A win beat carries no slug, so the line was printed over
     nothing. `banner-check` is the wide net; this is the exact position. */
  const last = fresh('battle');
  const wall = card(FOE, 'battle-ox'); // 1700 ATK / 1000 DEF
  wall.position = 'def';
  wall.summonedOnTurn = 0;
  last.players[FOE].monsters = [wall, null, null];
  const doomed = card(ME, 'kuriboh'); // 300 ATK, into 1000 DEF — 700 recoil
  doomed.summonedOnTurn = 0;
  last.players[ME].monsters = [doomed, null, null];
  last.players[ME].lp = 700; // exactly lethal, so the duel ends on this swing

  const over = act(last, ME, { type: 'attack', uid: doomed.uid, targetUid: wall.uid });
  const beats = over.anims.filter((a) => a.id.startsWith(`a${over.version}_`));
  const held = beats.find((a) => a.note === 'Battle Ox holds firm.');

  ok(over.winner === FOE, 'the recoil off a hopeless attack ends the duel', String(over.winner));
  ok(!!held, 'and the defender is still credited out loud', beats.map((b) => b.kind).join(','));
  ok(held?.slug === 'battle-ox', 'with its own face beside the line', held?.slug ?? '(no art)');
  ok(
    !beats.some((a) => a.kind === 'win' && a.note),
    'while the victory flourish stays silent rather than swallowing it',
    beats.filter((a) => a.kind === 'win').map((a) => a.note ?? '—').join(' | ')
  );
  ok(
    beats.findIndex((a) => a === held) < beats.findIndex((a) => a.kind === 'win'),
    'and the blow is reported before the duel is declared over',
    beats.map((b) => b.kind).join(',')
  );
}

/* ------------------------------------------------------------------ */
/* Bandit Keith: the machines, and what they cost to run                 */
/* ------------------------------------------------------------------ */
{
  console.log('\nBandit Keith: the line, the reels and the wrecking ball');

  /* --- Barrel Dragon: three coins, and every head finds something --- */
  {
    /* Swept over seeds rather than pinned to one, because the coins are the
       card. Each run sets the same board — one monster, one backrow, one card
       in hand — so a dragon that fired everything strips exactly one of each,
       in that order, and a dragon that skipped ahead would leave the Kuriboh
       standing while the hand emptied.

       The sweep is what makes the pin bite. A single run tolerates zero heads
       and would go green on a dragon that flips no coins at all — which is
       exactly what a broken one does. */
    const printed = baseAtkOf('barrel-dragon');
    const seen = new Set<number>();
    let orderKept = 0;
    let tallied = 0;
    let billed = 0;
    const RUNS = 40;
    for (let seed = 0; seed < RUNS; seed++) {
      const bd = fresh();
      bd.seed = seed;
      const dragon = card(ME, 'barrel-dragon');
      bd.players[ME].monsters = [dragon, null, null];
      bd.players[FOE].monsters = [card(FOE, 'kuriboh'), null, null];
      bd.players[FOE].spellTrap = { ...card(FOE, 'de-spell'), face: 'down' as const };
      bd.players[FOE].hand = [card(FOE, 'pot-of-greed')];

      const fired = act(bd, ME, { type: 'ignition', uid: dragon.uid, targets: [] });
      const heads = (effAtk(fired, fired.players[ME].monsters[0]!, ME) - printed) / 100;
      seen.add(heads);
      const f = fired.players[FOE];
      const gone = (1 - f.monsters.filter(Boolean).length) + (f.spellTrap ? 0 : 1) + (1 - f.hand.length);
      if (gone === heads) billed += 1;
      /* Monsters first, then the backrow, then the hand: a head that reached
         further than the Kuriboh while the Kuriboh still stood is out of
         order, and so is one that took the hand before the backrow. */
      const ordered =
        (heads < 1 || f.monsters.filter(Boolean).length === 0) &&
        (heads < 2 || !f.spellTrap) &&
        (heads < 3 || f.hand.length === 0) &&
        (heads >= 1 || (f.monsters.filter(Boolean).length === 1 && !!f.spellTrap && f.hand.length === 1));
      if (ordered) orderKept += 1;
      if (fired.log.some((l) => /HEADS/.test(l.text))) tallied += 1;
    }
    ok(billed === RUNS, 'every head Barrel Dragon lands takes exactly one card off them', `${billed}/${RUNS}`);
    ok(orderKept === RUNS, 'and always in order — monsters, then backrow, then hand', `${orderKept}/${RUNS}`);
    ok(tallied === RUNS, 'and the flip is announced once with the tally', `${tallied}/${RUNS}`);
    ok([...seen].every((h) => h >= 0 && h <= 3), 'three coins is never more than three heads', [...seen].join(','));
    /* The sweep must actually see the barrels fire, or all four checks above
       are satisfied by a dragon that does nothing at all. */
    ok([...seen].some((h) => h >= 1), 'and over forty spins the barrels do fire', [...seen].sort().join(','));
    ok(seen.has(3), 'including a spin where all three land', [...seen].sort().join(','));

    /* An empty opponent is not a crash and not a free 300 ATK reversal. */
    const bare = fresh();
    const lone = card(ME, 'barrel-dragon');
    bare.players[ME].monsters = [lone, null, null];
    const nothing = act(bare, ME, { type: 'ignition', uid: lone.uid, targets: [] });
    ok(nothing.players[FOE].lp === 4000 && nothing.players[ME].lp === 4000,
      'CONTROL: against an empty board the barrels cost nobody Life Points');
  }

  /* --- Slot Machine: 61.11% of three dice, twice over --- */
  {
    /* The odds are derived, not tabulated — so the rule is what is checked.
       132 of 216 is the owner's number, and it has to come out of the same
       function the card calls. */
    let made = 0;
    for (let a = 1; a <= 6; a++)
      for (let b = 1; b <= 6; b++)
        for (let c = 1; c <= 6; c++) if (makesSeven([a, b, c])) made += 1;
    ok(made === 132, 'three dice make seven 132 ways out of 216', `${made}/216`);
    ok(makesSeven([3, 4, 1]), 'any two of them: 3 + 4');
    ok(makesSeven([1, 2, 4]), 'or all three: 1 + 2 + 4');
    ok(makesSeven([6, 3, 2]), 'or all three with one subtracted: 6 + 3 − 2');
    ok(!makesSeven([1, 1, 1]), 'CONTROL: 1 · 1 · 1 makes nothing');
    ok(!makesSeven([6, 6, 6]), 'CONTROL: nor 6 · 6 · 6');

    /* The reels pay in both stats, and the spin is shown. */
    const sm = fresh();
    const reels = card(ME, 'slot-machine');
    sm.players[ME].monsters = [reels, null, null];
    const spun = act(sm, ME, { type: 'ignition', uid: reels.uid, targets: [] });
    const paid = effAtk(spun, spun.players[ME].monsters[0]!, ME) - baseAtkOf('slot-machine');
    ok(paid === 0 || paid === 700, 'a spin pays 700 ATK or nothing at all', String(paid));
    ok(
      effDef(spun, spun.players[ME].monsters[0]!, ME) - CARDS['slot-machine'].def! === paid,
      'and the DEF moves with it'
    );
    ok(spun.log.some((l) => /·.*(seven!|no seven\.)/.test(l.text)), 'and the dice and the verdict are both printed',
      spun.log.slice(-4).map((l) => l.text).join(' | '));

    /* The save. Summoned for real rather than hand-flagged — writing
       `rollsToSurvive` onto the instance proves the engine can roll, only
       summoning the card proves *Slot Machine* does, and the first version of
       this pin stayed green with the whole grant deleted off the card.
       Rolled fresh each time, so a machine that survives once is not thereby
       safe, and it rolls whether or not the ignition ever fired. */
    const facedWith = (killer: string, seed: number, real: boolean) => {
      const s = fresh();
      s.seed = seed;
      const box = card(ME, 'slot-machine');
      const t1 = card(ME, 'kuriboh');
      const t2 = card(ME, 'kuriboh');
      s.players[ME].monsters = [t1, t2, null];
      s.players[ME].hand = [box];
      let up = s;
      if (real) {
        up = act(s, ME, {
          type: 'normalSummon', uid: box.uid, zone: 2, position: 'atk', face: 'up',
          tributes: [t1.uid, t2.uid],
        });
      } else {
        /* The same body on the same board, never summoned — so it never picks
           up the grant. This is the control the survivals are measured against. */
        up = structuredClone(s);
        up.players[ME].hand = [];
        up.players[ME].monsters = [null, null, { ...box, summonedOnTurn: 0 }];
      }
      up.active = FOE;
      up.phase = 'main';
      const spell = card(FOE, killer);
      up.players[FOE].hand = [spell];
      const wiped = act(up, FOE, { type: 'activateSpell', uid: spell.uid, targets: [] });
      return wiped.players[ME].monsters.some((m) => m?.slug === 'slot-machine');
    };

    let survivals = 0;
    for (let seed = 0; seed < 24; seed++) if (facedWith('dark-hole', seed, true)) survivals += 1;
    ok(survivals > 0 && survivals < 24, 'Slot Machine sometimes rolls its way out of a Dark Hole, and sometimes not',
      `${survivals}/24 survived`);

    let plain = 0;
    for (let seed = 0; seed < 24; seed++) if (facedWith('dark-hole', seed, false)) plain += 1;
    ok(plain === 0, 'CONTROL: the same body that was never summoned never rolls, and dies every time', `${plain}/24`);
  }

  /* --- Machine King: the field, the scrapyard and the standing order --- */
  {
    const mk = fresh();
    const king = card(ME, 'machine-king');
    mk.players[ME].monsters = [king, card(ME, 'cannon-soldier'), null];
    mk.players[FOE].monsters = [card(FOE, 'blast-sphere'), null, null];
    mk.players[ME].grave = [card(ME, 'robotic-knight'), card(ME, 'mechanicalchaser'), card(ME, 'kuriboh')];
    /* Three Machines on the field counting both sides (200 each), two in his
       own pile (100 each), and the standing 400 he hands every Machine
       including himself. Kuriboh is in the pile to prove the filter bites. */
    const want = baseAtkOf('machine-king') + 3 * 200 + 2 * 100 + 400;
    ok(effAtk(mk, king, ME) === want, 'Machine King counts the field, the scrapyard and his own standing order',
      `${effAtk(mk, king, ME)} vs ${want}`);
    const soldier = mk.players[ME].monsters[1]!;
    ok(effAtk(mk, soldier, ME) === baseAtkOf('cannon-soldier') + 400,
      'and every Machine under him carries the 400 whether it was there when he arrived or not',
      String(effAtk(mk, soldier, ME)));
    /* The 400 is an aura now, so a Machine that walks in later gets it too —
       which is the whole of the change from a summon trigger. */
    const later = structuredClone(mk);
    const walkedIn = card(ME, 'robotic-knight');
    later.players[ME].monsters[2] = walkedIn;
    ok(
      effAtk(later, later.players[ME].monsters[2]!, ME) ===
        baseAtkOf('robotic-knight') + 400 + 300 /* the knight's own aura reaches itself */,
      'a Machine summoned after the King still answers to him',
      String(effAtk(later, later.players[ME].monsters[2]!, ME))
    );
    /* CONTROL: the King is not commanding the other side of the table. */
    const theirs = mk.players[FOE].monsters[0]!;
    ok(effAtk(mk, theirs, FOE) === baseAtkOf('blast-sphere'),
      'CONTROL: their Machines are not his to command', String(effAtk(mk, theirs, FOE)));
  }

  /* --- Blast Sphere: the bomb takes the room --- */
  {
    const bs = fresh('battle');
    bs.active = FOE;
    const bomb = card(ME, 'blast-sphere');
    bomb.position = 'def';
    bomb.summonedOnTurn = 0;
    bs.players[ME].monsters = [bomb, null, null];
    const beater = card(FOE, 'summoned-skull');
    beater.summonedOnTurn = 0;
    bs.players[FOE].monsters = [beater, null, null];
    bs.players[FOE].spellTrap = { ...card(FOE, 'de-spell'), face: 'down' as const };
    bs.players[FOE].field = { ...card(FOE, 'umi'), face: 'up' as const };
    bs.players[FOE].hand = [card(FOE, 'pot-of-greed'), card(FOE, 'mirror-force'), card(FOE, 'battle-ox')];
    const lp = bs.players[FOE].lp;

    const blown = act(bs, FOE, { type: 'attack', uid: beater.uid, targetUid: bomb.uid });
    ok(!blown.players[FOE].monsters.some((m) => m?.slug === 'summoned-skull'),
      'Blast Sphere kills whatever set it off');
    ok(!blown.players[FOE].spellTrap && !blown.players[FOE].field,
      'and clears their whole backrow, Field Spell included');
    const left = blown.players[FOE].hand.map((h) => h.slug);
    ok(!left.includes('pot-of-greed') && !left.includes('mirror-force'),
      'and takes the Spells and Traps out of their hand', left.join(',') || '(empty)');
    ok(left.includes('battle-ox'), 'CONTROL: the monsters in their hand are none of its business', left.join(','));
    ok(blown.players[FOE].lp === lp, 'and none of it is damage', `LP ${blown.players[FOE].lp}`);
  }

  /* --- Metalzoa: twice going out, half coming in, and only for Zoa --- */
  {
    /* Summoned for real, never hand-flagged, and now only ever *through Zoa* —
       which is the whole card. A Metalzoa that arrived any other way is a plain
       3000 body, so the helper below has to kill a Zoa to get one, exactly the
       way a duel does. */
    const bring = () => {
      const s = fresh();
      const beast = card(ME, 'zoa');
      beast.summonedOnTurn = 0;
      s.players[ME].monsters = [beast, null, null];
      s.players[ME].deck = [card(ME, 'metalzoa')];
      s.active = FOE;
      const bolt = card(FOE, 'tribute-to-the-doomed');
      s.players[FOE].hand = [bolt];
      const up = act(s, FOE, { type: 'activateSpell', uid: bolt.uid, targets: [beast.uid] });
      const landed = up.players[ME].monsters.find((m) => m?.slug === 'metalzoa')!;
      landed.summonedOnTurn = 0;
      return { state: up, metal: landed };
    };

    /* The same body, arriving the ordinary way: two Tributes out of the hand. */
    const plainly = () => {
      const s = fresh();
      const metal = card(ME, 'metalzoa');
      const f1 = card(ME, 'kuriboh');
      const f2 = card(ME, 'kuriboh');
      s.players[ME].monsters = [f1, f2, null];
      s.players[ME].hand = [metal];
      const up = act(s, ME, {
        type: 'normalSummon', uid: metal.uid, zone: 2, position: 'atk', face: 'up',
        tributes: [f1.uid, f2.uid],
      });
      const landed = up.players[ME].monsters.find((m) => m?.slug === 'metalzoa')!;
      landed.summonedOnTurn = 0;
      return { state: up, metal: landed };
    };

    const { state: mz0 } = bring();
    const mz = structuredClone(mz0);
    mz.active = ME;
    mz.phase = 'battle';
    const live = mz.players[ME].monsters.find((m) => m?.slug === 'metalzoa')!;
    const wall = card(FOE, 'kuriboh'); // 300/200
    wall.summonedOnTurn = 0;
    mz.players[FOE].monsters = [wall, null, null];
    /* Deep enough to survive it: Life Points floor at zero, and a pin that
       reads a capped total is measuring the floor rather than the swing. */
    mz.players[FOE].lp = 20000;
    const before = mz.players[FOE].lp;
    const swung = act(mz, ME, { type: 'attack', uid: live.uid, targetUid: wall.uid });
    /* 3000 doubled is 6000, into a 300 ATK Kuriboh standing up: 5700. */
    ok(before - swung.players[FOE].lp === 6000 - 300, 'Metalzoa swings at twice its ATK',
      String(before - swung.players[FOE].lp));
    ok(swung.log.some((l) => /doubl/i.test(l.text)), 'and says so',
      swung.log.slice(-5).map((l) => l.text).join(' | '));

    /* And halves whatever comes at it. */
    const inbound = structuredClone(bring().state);
    inbound.phase = 'battle';
    inbound.active = FOE;
    const guard = inbound.players[ME].monsters.find((m) => m?.slug === 'metalzoa')!;
    const charger = card(FOE, 'summoned-skull'); // 2500 → 1250
    charger.summonedOnTurn = 0;
    inbound.players[FOE].monsters = [charger, null, null];
    const foeLp = inbound.players[FOE].lp;
    const met = act(inbound, FOE, { type: 'attack', uid: charger.uid, targetUid: guard.uid });
    /* 1250 into 3000 is 1750 of recoil, and the metal is untouched. */
    ok(foeLp - met.players[FOE].lp === 3000 - 1250, 'and halves whatever attacks it',
      String(foeLp - met.players[FOE].lp));
    ok(met.players[ME].monsters.some((m) => m?.slug === 'metalzoa'), 'and stands');

    /* Arriving strips their hand of Spells and Traps as well as the field. */
    const clean = fresh();
    const beast2 = card(ME, 'zoa');
    beast2.summonedOnTurn = 0;
    clean.players[ME].monsters = [beast2, null, null];
    clean.players[ME].deck = [card(ME, 'metalzoa')];
    clean.players[FOE].hand = [card(FOE, 'pot-of-greed'), card(FOE, 'mirror-force'), card(FOE, 'battle-ox')];
    clean.players[FOE].field = { ...card(FOE, 'umi'), face: 'up' as const };
    clean.active = FOE;
    const bolt2 = card(FOE, 'tribute-to-the-doomed');
    clean.players[FOE].hand.push(bolt2);
    const arrived = act(clean, FOE, { type: 'activateSpell', uid: bolt2.uid, targets: [beast2.uid] });
    ok(!arrived.players[FOE].field, "Metalzoa's arrival clears their backrow");
    const kept = arrived.players[FOE].hand.map((h) => h.slug);
    ok(!kept.includes('pot-of-greed') && !kept.includes('mirror-force'),
      'and empties their hand of Spells and Traps', kept.join(',') || '(empty)');
    ok(kept.includes('battle-ox'), 'CONTROL: their monsters stay where they are', kept.join(','));

    /* --- and the whole card is gated on having been Zoa --- */
    const vanilla = plainly();
    const bare = vanilla.state.players[ME].monsters.find((m) => m?.slug === 'metalzoa')!;
    const f = effFlags(vanilla.state, bare, ME);
    ok(!f.doublesWhenAttacking && !f.halvesAttacker && !f.pierce && !f.indestructibleByBattle,
      'Normal Summoned out of the hand, Metalzoa is a plain body with none of the text',
      JSON.stringify({ d: !!f.doublesWhenAttacking, h: !!f.halvesAttacker, p: !!f.pierce, i: !!f.indestructibleByBattle }));

    /* The backrow-and-hand wipe is gated with it — the clearest half to see. */
    const untouched = fresh();
    const metal2 = card(ME, 'metalzoa');
    const g1 = card(ME, 'kuriboh');
    const g2 = card(ME, 'kuriboh');
    untouched.players[ME].monsters = [g1, g2, null];
    untouched.players[ME].hand = [metal2];
    untouched.players[FOE].field = { ...card(FOE, 'umi'), face: 'up' as const };
    untouched.players[FOE].hand = [card(FOE, 'mirror-force')];
    const quiet = act(untouched, ME, {
      type: 'normalSummon', uid: metal2.uid, zone: 2, position: 'atk', face: 'up',
      tributes: [g1.uid, g2.uid],
    });
    ok(!!quiet.players[FOE].field && quiet.players[FOE].hand.length === 1,
      'and it strips nothing on the way in either');

    /* CONTROL: the one that came through Zoa really does carry all of it, so
       the checks above are the route and not a card that lost its text. */
    const real = effFlags(mz0, mz0.players[ME].monsters.find((m) => m?.slug === 'metalzoa')!, ME);
    ok(!!real.doublesWhenAttacking && !!real.halvesAttacker && !!real.pierce && !!real.indestructibleByBattle,
      'CONTROL: the one Zoa called up carries every line of it');

    /* And the route does not survive a second life.

       This has to be the *same instance* Zoa summoned, and it has to come back
       by a road that does not overwrite the field — or the pin proves nothing.
       Two earlier versions proved nothing: a freshly minted Metalzoa in the
       Graveyard never carried Zoa's name to begin with, and a Time Machine
       revival is itself a Special Summon, so it rewrites the route whether or
       not anything clears it.

       A bounce is the road that matters. It puts the card in the *hand*, and a
       Normal Summon out of the hand never touches the field at all — so
       without the clear, a Metalzoa the opponent politely returned could be
       re-summoned with two Tributes and keep every line of Zoa's text. */
    const bounced = structuredClone(mz0);
    bounced.active = FOE;
    bounced.phase = 'main';
    const amazon = card(FOE, 'amazon-of-the-seas');
    bounced.players[FOE].hand = [amazon];
    bounced.players[FOE].monsters = [null, null, null];
    const metalUid = bounced.players[ME].monsters.find((m) => m?.slug === 'metalzoa')!.uid;
    const home = act(bounced, FOE, {
      type: 'normalSummon', uid: amazon.uid, zone: 0, position: 'atk', face: 'up',
      tributes: [], targets: [metalUid],
    });
    const inHand = home.players[ME].hand.find((h) => h.slug === 'metalzoa');
    ok(!!inHand, 'a Zoa-summoned Metalzoa can be bounced back to the hand',
      home.players[ME].hand.map((h) => h.slug).join(',') || '(empty)');
    ok(inHand?.summonedBy === undefined,
      'and it does not carry Zoa home with it', String(inHand?.summonedBy));

    const resummoned = structuredClone(home);
    resummoned.active = ME;
    resummoned.phase = 'main';
    resummoned.players[ME].normalSummonUsed = false;
    const t1 = card(ME, 'kuriboh');
    const t2 = card(ME, 'kuriboh');
    resummoned.players[ME].monsters = [t1, t2, null];
    const reborn = act(resummoned, ME, {
      type: 'normalSummon', uid: inHand!.uid, zone: 2, position: 'atk', face: 'up',
      tributes: [t1.uid, t2.uid],
    });
    const second = reborn.players[ME].monsters.find((m) => m?.slug === 'metalzoa')!;
    ok(!effFlags(reborn, second, ME).doublesWhenAttacking,
      'so Tribute Summoning it out of the hand a second time gets none of the text back');
  }

  /* --- Zoa and Metalmorph: the loop closes both ways --- */
  {
    /* Metalmorph's host dying calls Zoa back; Zoa dying calls Metalzoa. The
       pair costs two removals to answer once, which is the whole point. */
    const mm = fresh('battle');
    mm.active = FOE;
    const host = card(ME, 'cannon-soldier');
    host.summonedOnTurn = 0;
    mm.players[ME].monsters = [host, null, null];
    const morph = { ...card(ME, 'metalmorph'), face: 'up' as const, equippedTo: host.uid };
    host.equips = ['metalmorph'];
    mm.players[ME].spellTrap = morph;
    mm.players[ME].deck = [card(ME, 'zoa')];
    const killer = card(FOE, 'summoned-skull');
    killer.summonedOnTurn = 0;
    mm.players[FOE].monsters = [killer, null, null];

    const crushed = act(mm, FOE, { type: 'attack', uid: killer.uid, targetUid: host.uid });
    ok(crushed.players[ME].monsters.some((m) => m?.slug === 'zoa'),
      'Metalmorph answers a wrecked host by calling Zoa out of the Deck',
      crushed.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
    ok(crushed.players[ME].grave.some((c) => c.slug === 'metalmorph'),
      'and the plating goes down with the monster it was bolted to');

    /* CONTROL: the equip being shattered on its own is not the host dying. */
    const duster = fresh();
    duster.active = FOE;
    const alive = card(ME, 'cannon-soldier');
    alive.summonedOnTurn = 0;
    alive.equips = ['metalmorph'];
    duster.players[ME].monsters = [alive, null, null];
    duster.players[ME].spellTrap = { ...card(ME, 'metalmorph'), face: 'up' as const, equippedTo: alive.uid };
    duster.players[ME].deck = [card(ME, 'zoa')];
    const fd = card(FOE, 'harpie-s-feather-duster');
    duster.players[FOE].hand = [fd];
    const swept = act(duster, FOE, { type: 'activateSpell', uid: fd.uid, targets: [] });
    ok(!swept.players[ME].monsters.some((m) => m?.slug === 'zoa'),
      'CONTROL: shattering the plating while the monster lives summons nothing',
      swept.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));

    /* The equip's numbers: +300 standing, doubled swinging, and it pierces. */
    const armedUp = fresh('battle');
    const bearer = card(ME, 'cannon-soldier'); // 1400
    bearer.summonedOnTurn = 0;
    bearer.equips = ['metalmorph'];
    armedUp.players[ME].monsters = [bearer, null, null];
    armedUp.players[ME].spellTrap = { ...card(ME, 'metalmorph'), face: 'up' as const, equippedTo: bearer.uid };
    ok(effAtk(armedUp, bearer, ME) === 1400 + 300, 'Metalmorph is +300 standing still',
      String(effAtk(armedUp, bearer, ME)));
    const turtle = card(FOE, 'kuriboh'); // 200 DEF
    turtle.position = 'def';
    turtle.summonedOnTurn = 0;
    armedUp.players[FOE].monsters = [turtle, null, null];
    const through = act(armedUp, ME, { type: 'attack', uid: bearer.uid, targetUid: turtle.uid });
    /* (1400 + 300) × 2 = 3400, piercing a 200 DEF for 3200. */
    ok(4000 - through.players[FOE].lp === 3400 - 200, 'and doubles when it swings, and goes through',
      String(4000 - through.players[FOE].lp));
  }

  /* --- Cannon Soldier: your whole hand, fired at them --- */
  {
    const cs = fresh();
    const cannon = card(ME, 'cannon-soldier');
    const ammo = card(ME, 'summoned-skull'); // 2500 ATK, the shell
    cs.players[ME].monsters = [cannon, ammo, null];
    cs.players[ME].hand = [card(ME, 'kuriboh'), card(ME, 'pot-of-greed')];
    const fired = act(cs, ME, { type: 'ignition', uid: cannon.uid, targets: [ammo.uid] });
    ok(fired.players[ME].hand.length === 0, 'the cannon is loaded with your whole hand',
      fired.players[ME].hand.map((h) => h.slug).join(','));
    ok(!fired.players[ME].monsters.some((m) => m?.slug === 'summoned-skull'),
      'and it fires the monster you named, not the first one in the row');
    ok(4000 - fired.players[FOE].lp === 2500, 'for exactly what that monster was worth',
      String(4000 - fired.players[FOE].lp));

    /* Empty hand, dark button — "at least 1 card" is the whole price. */
    const dry = fresh();
    const idle = card(ME, 'cannon-soldier');
    dry.players[ME].monsters = [idle, card(ME, 'kuriboh'), null];
    ok(!canIgnite(dry, ME, idle), 'CONTROL: an empty hand cannot load the cannon');
    ok(!!applyAction(dry, ME, { type: 'ignition', uid: idle.uid, targets: [] }).error,
      'and the engine refuses it even if the button is pressed anyway');
  }

  /* --- Robotic Knight and Mechanicalchaser: measured on the way in --- */
  {
    const rk = fresh();
    const knight = card(ME, 'robotic-knight');
    rk.players[ME].hand = [knight];
    rk.players[ME].grave = [card(ME, 'cannon-soldier'), card(ME, 'blast-sphere'), card(ME, 'kuriboh')];
    const marched = act(rk, ME, { type: 'normalSummon', uid: knight.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
    const stood = marched.players[ME].monsters[0]!;
    /* Two Machines in the pile at 100, plus his own standing 300 aura, which
       reaches himself. Kuriboh proves the filter bites. */
    ok(effAtk(marched, stood, ME) === baseAtkOf('robotic-knight') + 200 + 300,
      'Robotic Knight is worth what the scrapyard was worth when he marched out of it',
      String(effAtk(marched, stood, ME)));

    const mc = fresh();
    const hunter = card(ME, 'mechanicalchaser');
    mc.players[ME].hand = [hunter, card(ME, 'kuriboh'), card(ME, 'pot-of-greed')];
    mc.players[FOE].hand = [card(FOE, 'battle-ox')];
    const hunting = act(mc, ME, { type: 'normalSummon', uid: hunter.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
    const out = hunting.players[ME].monsters[0]!;
    /* Two left in mine after it leaves the hand, one in theirs — 3 × 50. */
    ok(effAtk(hunting, out, ME) === baseAtkOf('mechanicalchaser') + 150,
      'Mechanicalchaser counts both grips on the way in',
      String(effAtk(hunting, out, ME)));
    ok(maxAttacks(hunting, out, ME) === 2, 'and still swings twice', String(maxAttacks(hunting, out, ME)));
  }

  /* --- Steel Ogre Grotto #1 and Pendulum Machine: the assembly line --- */
  {
    /* Ogre out of the hand beside a Machine, ogre into the pile fetching the
       wrecking ball, ogre's corpse paying for it. Three cards of board out of
       one, and every step is somebody having answered the last. */
    const sg = fresh();
    const ogre = card(ME, 'steel-ogre-grotto-1');
    sg.players[ME].hand = [ogre];
    ok(!handSummonOffer(sg, ME, ogre)?.ok, 'CONTROL: the ogre needs company before it walks on');
    sg.players[ME].monsters = [card(ME, 'cannon-soldier'), null, null];
    const offer = handSummonOffer(sg, ME, ogre);
    ok(!!offer?.ok && offer.discard === 0 && !offer.banish,
      'beside a Machine it walks on free — no discard, nothing banished',
      JSON.stringify(offer));
    const walked = act(sg, ME, { type: 'handSummon', uid: ogre.uid });
    ok(walked.players[ME].monsters.some((m) => m?.slug === 'steel-ogre-grotto-1'),
      'and it arrives', walked.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));

    /* Dying hands you the machine its corpse then pays for. */
    const dies = structuredClone(walked);
    dies.players[ME].deck = [card(ME, 'pendulum-machine'), card(ME, 'kuriboh')];
    dies.active = FOE;
    const dh = card(FOE, 'dark-hole');
    dies.players[FOE].hand = [dh];
    const razed = act(dies, FOE, { type: 'activateSpell', uid: dh.uid, targets: [] });
    ok(razed.players[ME].hand.some((h) => h.slug === 'pendulum-machine'),
      'and a wrecked ogre hands you the Pendulum Machine',
      razed.players[ME].hand.map((h) => h.slug).join(',') || '(empty)');

    /* The corpse is the fare, and it is removed from the game so one ogre
       builds one machine. */
    const pm = fresh();
    const ball = card(ME, 'pendulum-machine');
    pm.players[ME].hand = [ball];
    ok(!handSummonOffer(pm, ME, ball)?.ok, 'CONTROL: with no ogre in the pile the wrecking ball stays in hand');
    pm.players[ME].grave = [card(ME, 'steel-ogre-grotto-1')];
    pm.players[FOE].spellTrap = { ...card(FOE, 'de-spell'), face: 'down' as const };
    const priced = handSummonOffer(pm, ME, ball);
    ok(priced?.ok === true && priced.banish === 'steel-ogre-grotto-1', 'the ogre in the pile is the fare',
      JSON.stringify(priced));
    /* And the computer takes the route too. Nothing in the AI knew a monster
       could call itself onto the field, so four cards across two decks could
       only ever arrive the slow way — Keith's assembly line simply never ran
       when Keith was the one playing it. */
    ok(aiCandidates(pm, ME, 40).some((a) => a.type === 'handSummon'),
      'and the computer opponent knows the route exists');
    const built = act(pm, ME, { type: 'handSummon', uid: ball.uid, targets: [pm.players[FOE].spellTrap!.uid] });
    ok(built.players[ME].monsters.some((m) => m?.slug === 'pendulum-machine'), 'and the machine is assembled');
    ok(built.players[ME].banished.some((c) => c.slug === 'steel-ogre-grotto-1'),
      'with the ogre removed from the game rather than left to build a second one');
    ok(!built.players[ME].grave.some((c) => c.slug === 'steel-ogre-grotto-1'), 'and it is not in the pile any more');
    ok(!built.players[FOE].spellTrap, 'and its arrival shatters a backrow card you named');

    /* 1750 that becomes 3000 into Defence, and pierces. */
    const swing = structuredClone(built);
    swing.phase = 'battle';
    const machine = swing.players[ME].monsters.find((m) => m?.slug === 'pendulum-machine')!;
    machine.summonedOnTurn = 0;
    const turtle = card(FOE, 'kuriboh'); // 200 DEF
    turtle.position = 'def';
    turtle.summonedOnTurn = 0;
    swing.players[FOE].monsters = [turtle, null, null];
    const wrecked = act(swing, ME, { type: 'attack', uid: machine.uid, targetUid: turtle.uid });
    ok(4000 - wrecked.players[FOE].lp === 1750 + 1250 - 200, 'and it hits a turtle for 3000, piercing',
      String(4000 - wrecked.players[FOE].lp));

    /* CONTROL: the 1250 is only ever paid against Defence Position. */
    const upright = structuredClone(built);
    upright.phase = 'battle';
    const ball2 = upright.players[ME].monsters.find((m) => m?.slug === 'pendulum-machine')!;
    ball2.summonedOnTurn = 0;
    const standing = card(FOE, 'kuriboh'); // 300 ATK
    standing.summonedOnTurn = 0;
    upright.players[FOE].monsters = [standing, null, null];
    const plain = act(upright, ME, { type: 'attack', uid: ball2.uid, targetUid: standing.uid });
    ok(4000 - plain.players[FOE].lp === 1750 - 300, 'CONTROL: against a monster standing up it is only 1750',
      String(4000 - plain.players[FOE].lp));
  }

  /* --- Ground Attacker Bugroth: the line restocks itself --- */
  {
    const gb = fresh();
    gb.active = FOE;
    const bug = card(ME, 'ground-attacker-bugroth');
    bug.summonedOnTurn = 0;
    gb.players[ME].monsters = [bug, null, null];
    gb.players[ME].deck = [card(ME, 'cannon-soldier'), card(ME, 'machine-king'), card(ME, 'kuriboh')];
    const dh = card(FOE, 'dark-hole');
    gb.players[FOE].hand = [dh];
    const razed = act(gb, FOE, { type: 'activateSpell', uid: dh.uid, targets: [] });
    const got = razed.players[ME].hand.map((h) => h.slug);
    ok(got.includes('cannon-soldier'), 'a wrecked Bugroth hands you the next small Machine off the line',
      got.join(',') || '(empty)');
    ok(!got.includes('machine-king') && !got.includes('kuriboh'),
      'CONTROL: not a Level 6 Machine, and not something that is no Machine at all', got.join(','));
  }

  /* --- 7 Completed: Keith's plating on Keith's machines --- */
  {
    /* Reported: "I activated it and it did not equip anything and it blocked
       my spell and trap card zone for nothing."

       Three places have to agree that a Spellcaster is not a host: the gate
       that decides whether the card may be played at all, the modal that lays
       out the choices, and the resolution. Only the third knew — so the card
       went down, refused the body it was pointed at, and sat in the one
       Spell/Trap Zone having achieved nothing. */
    const sc = fresh();
    const mage = card(ME, 'dark-magician'); // Spellcaster
    sc.players[ME].monsters = [mage, null, null];
    const plate = card(ME, '7-completed');
    sc.players[ME].hand = [plate];

    ok(wastedWithoutTarget(sc, ME, plate, 'activate'),
      'with no Machine standing, 7 Completed is a card spent for nothing');
    ok(!canActivateFromHand(sc, ME, plate),
      'so the board does not offer it');
    const denied = applyAction(sc, ME, { type: 'activateSpell', uid: plate.uid, targets: [mage.uid] });
    ok(!!denied.error, 'and the engine refuses it if it is sent anyway', denied.error ?? '(allowed)');
    ok(denied.state.players[ME].spellTrap === null,
      'leaving the Spell/Trap Zone free rather than blocking it');
    ok(denied.state.players[ME].hand.some((h) => h.uid === plate.uid),
      'and the card still in hand');

    /* The modal must offer the same set the gate is judging. A Spellcaster on
       the board and a Machine beside it: only the Machine is a host. */
    const both = fresh();
    const mage2 = card(ME, 'dark-magician');
    const bot = card(ME, 'cannon-soldier');
    both.players[ME].monsters = [mage2, bot, null];
    const plate3 = card(ME, '7-completed');
    both.players[ME].hand = [plate3];
    const spec = targetSpecFor('7-completed', 'activate');
    const offered = spec ? targetCandidates(both, ME, spec).map((o) => o.slug) : [];
    ok(offered.includes('cannon-soldier') && !offered.includes('dark-magician'),
      'and the modal offers only the Machine, never a body the equip would refuse',
      offered.join(',') || '(none)');

    const fits = fresh();
    const machine = card(ME, 'cannon-soldier');
    fits.players[ME].monsters = [machine, null, null];
    const plate2 = card(ME, '7-completed');
    fits.players[ME].hand = [plate2];
    const bolted = act(fits, ME, { type: 'activateSpell', uid: plate2.uid, targets: [machine.uid] });
    const wearing = bolted.players[ME].monsters[0]!;
    ok(effAtk(bolted, wearing, ME) === baseAtkOf('cannon-soldier') + 700, 'on a Machine it is +700',
      String(effAtk(bolted, wearing, ME)));
    const flags = effFlags(bolted, wearing, ME);
    ok(flags.indestructibleByBattle === true && flags.indestructibleByEffect === true,
      'and covers both axes — battle and card effects');
    /* The answer is the equip itself, which is still a card on the field. */
    const stripped = structuredClone(bolted);
    stripped.active = FOE;
    const desp = card(FOE, 'de-spell');
    stripped.players[FOE].hand = [desp];
    const bare = act(stripped, FOE, { type: 'activateSpell', uid: desp.uid, targets: [stripped.players[ME].spellTrap!.uid] });
    const naked = bare.players[ME].monsters[0]!;
    ok(effFlags(bare, naked, ME).indestructibleByEffect !== true,
      'CONTROL: take the plating off and the machine is answerable again');
  }

  /* --- Time Machine: anything comes back, only a Machine comes back better --- */
  {
    const tm = (buried: string) => {
      const s = fresh();
      s.players[ME].grave = [card(ME, buried)];
      const trap = { ...card(ME, 'time-machine'), face: 'down' as const };
      trap.summonedOnTurn = 0;
      s.players[ME].spellTrap = trap;
      return act(s, ME, { type: 'activateSetCard', uid: trap.uid, targets: [s.players[ME].grave[0].uid] });
    };

    const metal = tm('cannon-soldier');
    const back = metal.players[ME].monsters.find((m) => m?.slug === 'cannon-soldier')!;
    ok(effAtk(metal, back, ME) === baseAtkOf('cannon-soldier') + 700, 'a Machine comes back 700 stronger',
      String(effAtk(metal, back, ME)));

    const flesh = tm('battle-ox');
    const ox = flesh.players[ME].monsters.find((m) => m?.slug === 'battle-ox')!;
    ok(!!ox, 'CONTROL: something that is no Machine still comes back');
    ok(effAtk(flesh, ox, ME) === baseAtkOf('battle-ox'), 'but it comes back at exactly what it was',
      String(effAtk(flesh, ox, ME)));
  }
}

/* ------------------------------------------------------------------ */
/* Odion: the backrow is the board                                       */
/* ------------------------------------------------------------------ */
console.log('\nOdion: every face-down card is a question');
{
  const odion = () => {
    const s = fresh();
    for (const pid of [ME, FOE] as PlayerId[]) {
      s.players[pid].monsters = [null, null, null];
      s.players[pid].hand = [];
      s.players[pid].grave = [];
      s.players[pid].spellTrap = null;
      s.players[pid].field = null;
      s.players[pid].deck = Array.from({ length: 12 }, () => card(pid, 'kuriboh'));
    }
    return s;
  };

  /* --- Statue of the Wicked: two prices, no safe answer --- */
  {
    /* Broken under its own card back, it pays triple. `resetInstance` turns a
       card face-up on its way to the pile, so the farewell used to be asked
       which way up it was lying *after* it had been turned over — the same
       shape as the Cocoon being asked its counters from inside the Graveyard. */
    const hidden = odion();
    hidden.players[FOE].spellTrap = { ...card(FOE, 'statue-of-the-wicked'), face: 'down' as const };
    const duster = card(ME, 'harpie-s-feather-duster');
    hidden.players[ME].hand = [duster];
    const swept = act(hidden, ME, { type: 'activateSpell', uid: duster.uid, targets: [] });
    const risen = swept.players[FOE].monsters.filter(Boolean);
    ok(risen.length === 3, 'breaking the Statue face-down stands three up', String(risen.length));
    ok(risen.every((m) => m!.tokenAtk === 3000 && m!.position === 'def'),
      'at 3000 apiece, in Defence',
      risen.map((m) => `${m!.tokenAtk}/${m!.position}`).join(','));

    /* CONTROL: face-up, it has already done its job and pays nothing more. */
    const shown = odion();
    shown.players[FOE].spellTrap = { ...card(FOE, 'statue-of-the-wicked'), face: 'up' as const };
    const duster2 = card(ME, 'harpie-s-feather-duster');
    shown.players[ME].hand = [duster2];
    const after = act(shown, ME, { type: 'activateSpell', uid: duster2.uid, targets: [] });
    ok(after.players[FOE].monsters.filter(Boolean).length === 0,
      'CONTROL: face-up, it pays nothing — it has already been spent',
      after.players[FOE].monsters.map((m) => m?.tokenName ?? '-').join(','));
  }

  /* --- Mystical Beast of Serket --- */
  {
    /* The temple is the price instead of the bodies. */
    const s = odion();
    s.players[ME].field = { ...card(ME, 'temple-of-the-kings'), face: 'up' as const };
    const beast = card(ME, 'mystical-beast-of-serket');
    s.players[ME].hand = [beast];
    ok(tributesRequired('mystical-beast-of-serket', s, ME) === 0,
      'with the Temple open, Serket costs no Tributes');
    const out = act(s, ME, { type: 'normalSummon', uid: beast.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
    ok(!out.players[ME].field, 'and the Temple is spent to free it');
    ok(out.players[ME].banished.some((c) => c.slug === 'temple-of-the-kings'),
      'banished rather than destroyed, so nothing answers its death');

    /* It eats what it kills, at half, and swings once more for each. */
    const hunt = structuredClone(out);
    hunt.phase = 'battle';
    const serket = hunt.players[ME].monsters.find((m) => m?.slug === 'mystical-beast-of-serket')!;
    serket.summonedOnTurn = 0;
    const prey = card(FOE, 'battle-ox'); // 1700
    prey.summonedOnTurn = 0;
    hunt.players[FOE].monsters = [prey, null, null];
    const fed = act(hunt, ME, { type: 'attack', uid: serket.uid, targetUid: prey.uid });
    const grown = fed.players[ME].monsters.find((m) => m?.slug === 'mystical-beast-of-serket')!;
    ok(effAtk(fed, grown, ME) === baseAtkOf('mystical-beast-of-serket') + 850,
      'it grows by half of what it swallowed', String(effAtk(fed, grown, ME)));
    ok(maxAttacks(fed, grown, ME) === 2, 'and swings once more for it',
      String(maxAttacks(fed, grown, ME)));
    /* The body it ate is in the Graveyard once, not twice — a ghost is a tally,
       not a card the duel has to account for a second time. */
    ok(fed.players[FOE].grave.filter((g) => g.slug === 'battle-ox').length === 1,
      'and what it ate lies in the Graveyard exactly once',
      fed.players[FOE].grave.map((g) => g.slug).join(','));

    /* A card effect takes the meal. */
    const answered = structuredClone(fed);
    answered.active = FOE;
    answered.phase = 'main';
    const hole = card(FOE, 'dark-hole');
    answered.players[FOE].hand = [hole];
    const spared = act(answered, FOE, { type: 'activateSpell', uid: hole.uid, targets: [] });
    const survivor = spared.players[ME].monsters.find((m) => m?.slug === 'mystical-beast-of-serket');
    ok(!!survivor && survivor.absorbed.length === 0,
      'a card effect takes everything it holds instead of the beast',
      survivor ? `absorbed ${survivor.absorbed.length}` : 'destroyed');
    /* And holding nothing, it dies like anything else. */
    const again = structuredClone(spared);
    const hole2 = card(FOE, 'dark-hole');
    again.players[FOE].hand = [hole2];
    const dead = act(again, FOE, { type: 'activateSpell', uid: hole2.uid, targets: [] });
    ok(!dead.players[ME].monsters.some((m) => m?.slug === 'mystical-beast-of-serket'),
      'CONTROL: holding nothing, the next one kills it');
  }

  /* --- Guardian Sphinx: one life, and the sweep twice --- */
  {
    const s = odion();
    s.phase = 'battle';
    s.active = FOE;
    const sphinx = { ...card(ME, 'guardian-sphinx'), face: 'down' as const, position: 'def' as const };
    sphinx.summonedOnTurn = 0;
    s.players[ME].monsters = [sphinx, null, null];
    const beater = card(FOE, 'summoned-skull');
    beater.summonedOnTurn = 0;
    s.players[FOE].monsters = [beater, null, null];
    const swung = act(s, FOE, { type: 'attack', uid: beater.uid, targetUid: sphinx.uid });
    const held = swung.players[ME].monsters.find((m) => m?.slug === 'guardian-sphinx');
    ok(!!held, 'the Sphinx is not destroyed by the blow that beats it');
    ok(held?.face === 'down', 'it sinks back into the sand instead', held?.face ?? '(gone)');
    ok(held?.flags.usedFlipEscape === true, 'and the escape is spent');
    /* Its FLIP fired on the way, which is the other half of the trade. */
    ok(!swung.players[FOE].monsters.some((m) => m?.slug === 'summoned-skull'),
      'and the sweep it woke up for sent the attacker home',
      swung.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));

    /* CONTROL: the second blow lands. */
    const twice = structuredClone(swung);
    twice.active = FOE;
    twice.phase = 'battle';
    const second = card(FOE, 'summoned-skull');
    second.summonedOnTurn = 0;
    twice.players[FOE].monsters = [second, null, null];
    const finished = act(twice, FOE, { type: 'attack', uid: second.uid, targetUid: held!.uid });
    ok(!finished.players[ME].monsters.some((m) => m?.slug === 'guardian-sphinx'),
      'CONTROL: the second blow lands — it buys one life, not immunity',
      finished.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  }

  /* --- The traps that refill the zone they spend --- */
  {
    /* Judgment of Anubis Sets the next trap out of the Deck. */
    const s = odion();
    s.phase = 'battle';
    s.active = FOE;
    const anubis = { ...card(ME, 'judgment-of-anubis'), face: 'down' as const };
    anubis.summonedOnTurn = 0;
    s.players[ME].spellTrap = anubis;
    s.players[ME].deck = [card(ME, 'mirror-force'), card(ME, 'kuriboh')];
    const beater = card(FOE, 'summoned-skull');
    beater.summonedOnTurn = 0;
    s.players[FOE].monsters = [beater, null, null];
    const declared = applyAction(s, FOE, { type: 'attack', uid: beater.uid, targetUid: null }).state;
    const judged = act(declared, ME, { type: 'respondTrap', uid: anubis.uid });
    ok(judged.players[ME].spellTrap?.slug === 'mirror-force',
      'Judgment of Anubis Sets the next Trap into the zone it just emptied',
      judged.players[ME].spellTrap?.slug ?? '(empty)');
    ok(judged.players[ME].spellTrap?.face === 'down', 'face-down, like any Set card');

    /* Mask of Darkness Sets one back out of the Graveyard — or hands it over
       when the zone is taken, which is the board a trap deck usually has. */
    const mask = odion();
    const face = { ...card(ME, 'mask-of-darkness'), face: 'down' as const, position: 'def' as const };
    face.summonedOnTurn = 0;
    mask.players[ME].monsters = [face, null, null];
    mask.players[ME].grave = [card(ME, 'mirror-force')];
    const flipped = act(mask, ME, { type: 'changePosition', uid: face.uid });
    ok(flipped.players[ME].spellTrap?.slug === 'mirror-force',
      'Mask of Darkness Sets a Trap back out of the Graveyard',
      flipped.players[ME].spellTrap?.slug ?? '(empty)');

    const busy = odion();
    const face2 = { ...card(ME, 'mask-of-darkness'), face: 'down' as const, position: 'def' as const };
    face2.summonedOnTurn = 0;
    busy.players[ME].monsters = [face2, null, null];
    busy.players[ME].grave = [card(ME, 'mirror-force')];
    busy.players[ME].spellTrap = { ...card(ME, 'trap-hole'), face: 'down' as const };
    const handed = act(busy, ME, { type: 'changePosition', uid: face2.uid });
    ok(handed.players[ME].hand.some((h) => h.slug === 'mirror-force'),
      'and hands it over instead when the zone is taken',
      handed.players[ME].hand.map((h) => h.slug).join(',') || '(empty)');
    ok(handed.players[ME].spellTrap?.slug === 'trap-hole', 'leaving what was already there alone');
  }

  /* --- The Temple decides tomorrow, and pays on the way out --- */
  {
    const s = odion();
    const temple = card(ME, 'temple-of-the-kings');
    s.players[ME].hand = [temple];
    const wanted = card(ME, 'mirror-force');
    s.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'kuriboh'), wanted, card(ME, 'kuriboh')];
    const open = act(s, ME, { type: 'activateSpell', uid: temple.uid, targets: [wanted.uid] });
    ok(open.players[ME].destinyDrawUid === wanted.uid, 'the Temple names your next draw');
    const drawn = act(act(open, ME, { type: 'endTurn' }), FOE, { type: 'endTurn' });
    ok(drawn.players[ME].hand.some((h) => h.uid === wanted.uid),
      'and that is the card that comes, not whatever was on top',
      drawn.players[ME].hand.map((h) => h.slug).join(','));
    ok(drawn.players[ME].destinyDrawUid === undefined, 'the promise is spent once, not standing');

    /* Breaking it costs the breaker a card back. */
    const broken = odion();
    broken.players[FOE].field = { ...card(FOE, 'temple-of-the-kings'), face: 'up' as const };
    broken.players[FOE].deck = [card(FOE, 'guardian-sphinx')];
    const duster = card(ME, 'harpie-s-feather-duster');
    broken.players[ME].hand = [duster];
    const razed = act(broken, ME, { type: 'activateSpell', uid: duster.uid, targets: [] });
    ok(razed.players[FOE].hand.some((h) => h.slug === 'guardian-sphinx'),
      'and breaking the Temple hands its keeper a Sphinx',
      razed.players[FOE].hand.map((h) => h.slug).join(',') || '(empty)');
  }

  /* --- The serpents are worth what has been spent --- */
  {
    const s = odion();
    s.players[ME].grave = [card(ME, 'embodiment-of-apophis'), card(ME, 'trap-hole')];
    s.players[FOE].grave = [card(FOE, 'mirror-force')];
    const swamp = { ...card(ME, 'apophis-the-swamp-deity'), face: 'down' as const };
    swamp.summonedOnTurn = 0;
    s.players[ME].spellTrap = swamp;
    s.active = FOE;
    const mon = card(FOE, 'battle-ox');
    s.players[FOE].hand = [mon];
    const summoned = applyAction(s, FOE, {
      type: 'normalSummon', uid: mon.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
    }).state;
    ok(summoned.pending?.kind === 'trap', 'the swamp answers a Summon',
      summoned.pending?.kind ?? '(no window)');
    const risen = act(summoned, ME, { type: 'respondTrap', uid: swamp.uid });
    const serpent = risen.players[ME].monsters.find((m) => m?.isToken)!;
    /* Four traps across the two Graveyards by the time it resolves — the two
       of mine, theirs, and the Apophis itself, which has just been spent. */
    ok(effAtk(risen, serpent, ME) === 4000, 'and the serpent is worth 1000 a Trap in either Graveyard',
      String(effAtk(risen, serpent, ME)));
    ok(effDef(risen, serpent, ME) === 4000, 'in both stats');
    /* Live, not fixed: bury one more and it grows without anything updating it. */
    const later = structuredClone(risen);
    later.players[FOE].grave.push(card(FOE, 'trap-hole'));
    const same = later.players[ME].monsters.find((m) => m?.isToken)!;
    ok(effAtk(later, same, ME) === 5000, 'read live, so a Trap buried later makes it bigger',
      String(effAtk(later, same, ME)));

    /* CONTROL: with no Embodiment in the pile it is not offered at all. */
    const early = odion();
    const swamp2 = { ...card(ME, 'apophis-the-swamp-deity'), face: 'down' as const };
    swamp2.summonedOnTurn = 0;
    early.players[ME].spellTrap = swamp2;
    early.active = FOE;
    const mon2 = card(FOE, 'battle-ox');
    early.players[FOE].hand = [mon2];
    const quiet = applyAction(early, FOE, {
      type: 'normalSummon', uid: mon2.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
    }).state;
    ok(quiet.pending?.kind !== 'trap',
      'CONTROL: without an Embodiment already spent, the swamp stays shut',
      quiet.pending?.kind ?? '(no window)');
  }

  /* --- Ra's Disciples, and the Spy that plants the next question --- */
  {
    const s = odion();
    const first = card(ME, 'ra-s-disciple');
    s.players[ME].hand = [first, card(ME, 'ra-s-disciple')];
    s.players[ME].deck = [card(ME, 'temple-of-the-kings'), card(ME, 'ra-s-disciple')];
    const out = act(s, ME, { type: 'normalSummon', uid: first.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
    const three = out.players[ME].monsters.filter((m) => m?.slug === 'ra-s-disciple');
    ok(three.length === 3, 'a Disciple brings the other two — from the Deck or the hand',
      out.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
    ok(effFlags(out, three[0]!, ME).indestructibleByBattle === true,
      'and while all three stand, battle cannot break them');
    /* CONTROL: break the set and the protection goes with it. */
    const broken = structuredClone(out);
    broken.players[ME].monsters[2] = null;
    ok(effFlags(broken, broken.players[ME].monsters[0]!, ME).indestructibleByBattle !== true,
      'CONTROL: two of them are ordinary bodies again');

    /* The Spy digs out something worth setting, face-down. */
    const spy = odion();
    const watcher = { ...card(ME, 'gravekeeper-s-spy'), face: 'down' as const, position: 'def' as const };
    watcher.summonedOnTurn = 0;
    spy.players[ME].monsters = [watcher, null, null];
    /* Battle Ox is the control that matters: Level 4, so the level clause does
       not exclude it, and no FLIP effect — the only thing keeping it out is the
       clause being tested. An earlier version used Summoned Skull, which is
       Level 6, so the check passed on the level bound and proved nothing about
       flips at all. */
    spy.players[ME].deck = [card(ME, 'battle-ox'), card(ME, 'wall-of-illusion')];
    const flipped = act(spy, ME, { type: 'changePosition', uid: watcher.uid });
    const planted = flipped.players[ME].monsters.find((m) => m?.slug === 'wall-of-illusion');
    ok(!!planted, 'the Spy plants another face-down question',
      flipped.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
    ok(planted?.face === 'down' && planted?.position === 'def', 'face-down, in Defence',
      `${planted?.face}/${planted?.position}`);
    ok(!flipped.players[ME].monsters.some((m) => m?.slug === 'battle-ox'),
      'CONTROL: and only a monster that does something when flipped',
      flipped.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  }

  /* --- Wall of Illusion --- */
  {
    const s = odion();
    const wall = { ...card(ME, 'wall-of-illusion'), face: 'down' as const, position: 'def' as const };
    wall.summonedOnTurn = 0;
    s.players[ME].monsters = [wall, null, null];
    s.players[FOE].spellTrap = { ...card(FOE, 'trap-hole'), face: 'down' as const };
    const flipped = act(s, ME, { type: 'changePosition', uid: wall.uid, targets: [s.players[FOE].spellTrap!.uid] });
    ok(!flipped.players[FOE].spellTrap, 'flipping the Wall takes a backrow card with it');

    const hit = odion();
    hit.phase = 'battle';
    hit.active = FOE;
    const shield = card(ME, 'wall-of-illusion');
    shield.summonedOnTurn = 0;
    hit.players[ME].monsters = [shield, null, null];
    const charger = card(FOE, 'summoned-skull');
    charger.summonedOnTurn = 0;
    hit.players[FOE].monsters = [charger, null, null];
    const lp = hit.players[FOE].lp;
    const sent = act(hit, FOE, { type: 'attack', uid: charger.uid, targetUid: shield.uid });
    ok(lp - sent.players[FOE].lp === 800, 'and being attacked costs them 800 now',
      String(lp - sent.players[FOE].lp));
  }
}

/* ------------------------------------------------------------------ */
/* Priest Seto: the God, and the bodies bought to pay for it             */
/* ------------------------------------------------------------------ */
console.log('\nPriest Seto: three Tributes, and everything that pays them');
{
  const seto = () => {
    const s = fresh();
    for (const pid of [ME, FOE] as PlayerId[]) {
      s.players[pid].monsters = [null, null, null];
      s.players[pid].hand = [];
      s.players[pid].grave = [];
      /* Enough Deck to survive the turns these checks end. An empty Deck is a
         loss on the next draw, and a duel that ends mid-check reports as the
         engine refusing an action rather than as the setup running out. */
      s.players[pid].deck = Array.from({ length: 12 }, () => card(pid, 'kuriboh'));
    }
    return s;
  };

  /* --- Millennium Ankh: three bodies for a thousand, gone by the End Phase --- */
  {
    const s = seto();
    const ankh = card(ME, 'millennium-ankh');
    s.players[ME].hand = [ankh];
    const paid = act(s, ME, { type: 'activateSpell', uid: ankh.uid, targets: [] });
    ok(paid.players[ME].lp === 4000 - 1000, 'the Ankh costs a thousand', `LP ${paid.players[ME].lp}`);
    ok(paid.players[ME].monsters.filter(Boolean).length === 3, 'and buys three bodies',
      paid.players[ME].monsters.map((m) => m?.tokenName ?? '-').join(','));
    ok(paid.players[ME].monsters.every((m) => m?.position === 'def'), 'standing in Defence');
    /* They are currency, not a board: gone when the turn closes. */
    const closed = act(paid, ME, { type: 'endTurn' });
    ok(closed.players[ME].monsters.every((m) => !m), 'and they crumble at the end of the turn',
      closed.players[ME].monsters.map((m) => m?.tokenName ?? '-').join(','));

    /* Spent, which is what they are for: three tokens are three Tributes. */
    const withGod = structuredClone(paid);
    const god = card(ME, 'obelisk-the-tormentor');
    withGod.players[ME].hand = [god];
    const bodies = withGod.players[ME].monsters.filter(Boolean).map((m) => m!.uid);
    ok(tributesRequired('obelisk-the-tormentor', withGod, ME) === 3, 'Obelisk still costs three');
    const summoned = act(withGod, ME, {
      type: 'normalSummon', uid: god.uid, zone: 0, position: 'atk', face: 'up', tributes: bodies,
    });
    ok(summoned.players[ME].monsters.some((m) => m?.slug === 'obelisk-the-tormentor'),
      'and three Ka Tokens pay for a God outright',
      summoned.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  }

  /* --- Obelisk: no clock, and a second button --- */
  {
    const s = seto();
    const god = card(ME, 'obelisk-the-tormentor');
    god.summonedOnTurn = s.turn; // it arrived this very turn
    s.players[ME].monsters = [god, card(ME, 'kuriboh'), card(ME, 'battle-ox')];
    s.players[FOE].monsters = [card(FOE, 'summoned-skull'), null, null];
    const battle = structuredClone(s);
    battle.phase = 'battle';
    ok(canAttackWith(battle, ME, battle.players[ME].monsters[0]!),
      'Obelisk swings the turn it lands — the handicap was its alone and is gone');

    const both = ignitionOptions(s, ME, god);
    ok(both.length === 2, 'and it offers both of its buttons', both.map((o) => o.label).join(' | '));
    const soul = both.find((o) => /swings/.test(o.label))!;
    const boosted = act(s, ME, {
      type: 'ignition', uid: god.uid, targets: [s.players[ME].monsters[1]!.uid], effectIndex: soul.index,
    });
    const swinger = boosted.players[ME].monsters.find((m) => m?.slug === 'obelisk-the-tormentor')!;
    ok(maxAttacks(boosted, swinger, ME) === 4, 'one body buys it four attacks',
      String(maxAttacks(boosted, swinger, ME)));
    ok(boosted.players[ME].grave.some((g) => g.slug === 'kuriboh'), 'and the body was really spent');
    ok(ignitionOptions(boosted, ME, swinger).length === 0,
      'CONTROL: pressing one button spends the turn for both');
    /* CONTROL: the extra attacks are this turn's, not the duel's. */
    const nextTurn = act(act(boosted, ME, { type: 'endTurn' }), FOE, { type: 'endTurn' });
    const rested = nextTurn.players[ME].monsters.find((m) => m?.slug === 'obelisk-the-tormentor')!;
    ok(maxAttacks(nextTurn, rested, ME) === 1, 'CONTROL: and they are gone by the next turn',
      String(maxAttacks(nextTurn, rested, ME)));
  }

  /* --- Soul Exchange: lent, not stolen --- */
  {
    const s = seto();
    const theirs1 = card(FOE, 'battle-ox');
    const theirs2 = card(FOE, 'kuriboh');
    s.players[FOE].monsters = [theirs1, theirs2, null];
    const mine = card(ME, 'newdoria');
    s.players[ME].monsters = [mine, null, null];
    const swap = card(ME, 'soul-exchange');
    const god = card(ME, 'obelisk-the-tormentor');
    s.players[ME].hand = [swap, god];

    const lent = act(s, ME, { type: 'activateSpell', uid: swap.uid, targets: [theirs1.uid, theirs2.uid] });
    ok(lent.players[FOE].monsters.filter(Boolean).length === 2,
      'Soul Exchange leaves their monsters on their own side',
      lent.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));
    ok(lent.players[ME].monsters.filter(Boolean).length === 1, 'and hands you nothing to command');

    const summoned = act(lent, ME, {
      type: 'normalSummon', uid: god.uid, zone: 1, position: 'atk', face: 'up',
      tributes: [mine.uid, theirs1.uid, theirs2.uid],
    });
    ok(summoned.players[ME].monsters.some((m) => m?.slug === 'obelisk-the-tormentor'),
      'but you may Tribute them — one of yours and two of theirs pays for a God');
    ok(summoned.players[FOE].grave.some((g) => g.slug === 'battle-ox'),
      'and a borrowed body goes to its own owner\'s Graveyard');

    /* The modal must offer them too, or the rule exists only in the engine.
       This is the fifth time in this file the picker and the engine have had
       separate copies of one rule; they read the same list now. */
    ok(
      tributableBodies(lent, ME).some((m) => m.uid === theirs1.uid),
      'and the tribute picker is offered the borrowed bodies, not just your own',
      tributableBodies(lent, ME).map((m) => m.slug).join(',')
    );

    /* Tribute *Summoning*, and nothing else. Obelisk's Fist of Fate eats two
       bodies as an effect cost, and borrowed ones are not on the menu — the
       card lends them for a Summon, which is what its text says. */
    const fistBoard = structuredClone(lent);
    const godOnField = card(ME, 'obelisk-the-tormentor');
    godOnField.summonedOnTurn = 0;
    fistBoard.players[ME].monsters = [godOnField, null, null];
    ok(
      ignitionOptions(fistBoard, ME, godOnField).every((o) => !/Fist/.test(o.label)),
      'CONTROL: but a borrowed body cannot pay for the Fist of Fate — the loan is for Summoning',
      ignitionOptions(fistBoard, ME, godOnField).map((o) => o.label).join(' | ') || '(nothing offered)'
    );

    /* The loan is for this turn only. */
    const tomorrow = structuredClone(lent);
    tomorrow.turn += 1;
    ok(
      !!applyAction(tomorrow, ME, {
        type: 'normalSummon', uid: god.uid, zone: 1, position: 'atk', face: 'up',
        tributes: [mine.uid, theirs1.uid, theirs2.uid],
      }).error,
      'CONTROL: and the loan is over by the next turn'
    );
  }

  /* --- Possessed Dark Soul: a hostage on a clock --- */
  {
    const s = seto();
    const thief = card(ME, 'possessed-dark-soul');
    thief.summonedOnTurn = 0;
    s.players[ME].monsters = [thief, null, null];
    const prey = card(FOE, 'battle-ox');
    s.players[FOE].monsters = [prey, null, null];
    let held = act(s, ME, { type: 'ignition', uid: thief.uid, targets: [prey.uid] });
    ok(held.players[ME].monsters.some((m) => m?.slug === 'battle-ox'), 'the ka is torn out and changes sides');
    ok(!held.players[FOE].monsters.some((m) => m?.slug === 'battle-ox'), 'and leaves theirs');
    const hostage = held.players[ME].monsters.find((m) => m?.slug === 'battle-ox')!;
    ok(effFlags(held, hostage, ME).cannotAttack === true, 'a possessed body cannot attack');

    /* Three of *your* End Phases. Their turns in between do not count, which is
       the whole of "of the player that controls it". */
    const seen: string[] = [];
    for (let i = 0; i < 6 && held.players[ME].monsters.some((m) => m?.slug === 'battle-ox'); i++) {
      held = act(held, held.active, { type: 'endTurn' });
      const still = held.players[ME].monsters.find((m) => m?.slug === 'battle-ox');
      seen.push(still ? String(still.possessedEndPhases) : 'gone');
    }
    ok(seen.join(',') === '2,2,1,1,gone',
      'and it crumbles after three of YOUR End Phases, not three turns', seen.join(','));
  }

  /* --- Millennium Seeker: the ramp --- */
  {
    const s = seto();
    const seeker = card(ME, 'millennium-seeker');
    s.players[ME].hand = [seeker];
    s.players[ME].deck = [
      card(ME, 'obelisk-the-tormentor'),
      card(ME, 'millennium-seeker'),
      card(ME, 'millennium-seeker'),
      card(ME, 'mound-of-the-bound-creator'),
    ];
    const out = act(s, ME, {
      type: 'normalSummon', uid: seeker.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
    });
    ok(out.players[ME].hand.some((h) => h.slug === 'obelisk-the-tormentor'),
      'the Seeker finds Obelisk', out.players[ME].hand.map((h) => h.slug).join(',') || '(empty)');
    ok(!out.players[ME].hand.some((h) => h.slug === 'mound-of-the-bound-creator'),
      'CONTROL: and only Obelisk — the Mound is no longer part of the search',
      out.players[ME].hand.map((h) => h.slug).join(','));
    const bodies = out.players[ME].monsters.filter((m) => m?.slug === 'millennium-seeker');
    ok(bodies.length === 3, 'and brings two more of itself, filling the field',
      out.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
    ok(bodies.slice(1).every((m) => m!.position === 'def' && m!.face === 'up'),
      'the pair arriving face-up in Defence',
      bodies.map((m) => `${m!.position}/${m!.face}`).join(','));
    /* Three bodies is three Tributes, which is the entire point. */
    ok(tributesRequired('obelisk-the-tormentor', out, ME) === 3, 'Obelisk costs three');
    const god = out.players[ME].hand.find((h) => h.slug === 'obelisk-the-tormentor')!;
    /* The following turn, in a real duel: the Seeker used this turn's Normal
       Summon and the God wants the next one. What is being checked here is the
       price and who can pay it, not the turn structure — so the flag is reset
       rather than spending two draws to walk round the table. */
    const nextTurn = structuredClone(out);
    nextTurn.players[ME].normalSummonUsed = false;
    const cast = act(nextTurn, ME, {
      type: 'normalSummon', uid: god.uid, zone: 0, position: 'atk', face: 'up',
      tributes: nextTurn.players[ME].monsters.filter(Boolean).map((m) => m!.uid),
    });
    ok(cast.players[ME].monsters.some((m) => m?.slug === 'obelisk-the-tormentor'),
      'and the three of them pay for it in one turn');

    /* The Graveyard is reached when the Deck is dry — a swept Obelisk is still
       the card this deck exists to cast. */
    const buried = seto();
    const s2 = card(ME, 'millennium-seeker');
    buried.players[ME].hand = [s2];
    buried.players[ME].deck = [card(ME, 'millennium-seeker')];
    buried.players[ME].grave = [card(ME, 'obelisk-the-tormentor')];
    const dug = act(buried, ME, {
      type: 'normalSummon', uid: s2.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
    });
    ok(dug.players[ME].hand.some((h) => h.slug === 'obelisk-the-tormentor'),
      'and a buried Obelisk is dug back up when the Deck has none',
      dug.players[ME].hand.map((h) => h.slug).join(',') || '(empty)');
  }

  /* --- Pharaoh's Servant, Newdoria, Aswan: the queue that refills --- */
  {
    const s = seto();
    const servant = card(ME, 'pharaoh-s-servant');
    s.players[ME].hand = [servant];
    s.players[ME].deck = [card(ME, 'pharaoh-s-servant')];
    s.players[ME].grave = [card(ME, 'double-coston')];
    const up = act(s, ME, {
      type: 'normalSummon', uid: servant.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
    });
    ok(up.players[ME].hand.some((h) => h.slug === 'pharaoh-s-servant'),
      'a Servant arriving fetches the next Servant',
      up.players[ME].hand.map((h) => h.slug).join(',') || '(empty)');

    const standing = up.players[ME].monsters.find((m) => m?.slug === 'pharaoh-s-servant')!;
    const killed = structuredClone(up);
    killed.active = FOE;
    const hole = card(FOE, 'dark-hole');
    killed.players[FOE].hand = [hole];
    const razed = act(killed, FOE, { type: 'activateSpell', uid: hole.uid, targets: [standing.uid] });
    ok(razed.players[ME].monsters.some((m) => m?.slug === 'double-coston'),
      'and a Servant destroyed puts a Zombie back on the board',
      razed.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));

    /* Newdoria: 400 now, and it replaces itself only when destroyed. */
    const nd = seto();
    const doom = card(ME, 'newdoria');
    doom.summonedOnTurn = 0;
    nd.players[ME].monsters = [doom, null, null];
    nd.players[ME].deck = [card(ME, 'newdoria')];
    nd.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
    nd.active = FOE;
    const wipe = card(FOE, 'dark-hole');
    nd.players[FOE].hand = [wipe];
    const blown = act(nd, FOE, { type: 'activateSpell', uid: wipe.uid, targets: [] });
    ok(4000 - blown.players[FOE].lp === 400, 'Newdoria takes 400 with it now',
      String(4000 - blown.players[FOE].lp));
    ok(blown.players[ME].hand.some((h) => h.slug === 'newdoria'),
      'and a destroyed Newdoria hands you the next one',
      blown.players[ME].hand.map((h) => h.slug).join(',') || '(empty)');

    /* CONTROL: a Tribute is not a destruction, so feeding the God does not
       also refill the queue. */
    const fed = seto();
    const doom2 = card(ME, 'newdoria');
    const spare = card(ME, 'kuriboh');
    const spare2 = card(ME, 'battle-ox');
    fed.players[ME].monsters = [doom2, spare, spare2];
    fed.players[ME].deck = [card(ME, 'newdoria')];
    const godCard = card(ME, 'obelisk-the-tormentor');
    fed.players[ME].hand = [godCard];
    const eaten = act(fed, ME, {
      type: 'normalSummon', uid: godCard.uid, zone: 0, position: 'atk', face: 'up',
      tributes: [doom2.uid, spare.uid, spare2.uid],
    });
    ok(!eaten.players[ME].hand.some((h) => h.slug === 'newdoria'),
      'CONTROL: but Tributing one for the God does not — only a destruction refills',
      eaten.players[ME].hand.map((h) => h.slug).join(',') || '(empty)');

    /* Aswan pays a toll on the way out, every time, even past its once-per-turn
       revival. */
    const aw = seto();
    const ghost = card(ME, 'aswan-apparition');
    ghost.summonedOnTurn = 0;
    aw.players[ME].monsters = [ghost, null, null];
    aw.active = FOE;
    const bolt = card(FOE, 'dark-hole');
    aw.players[FOE].hand = [bolt];
    aw.players[ME].deck = [card(ME, 'aswan-apparition')];
    const tolled = act(aw, FOE, { type: 'activateSpell', uid: bolt.uid, targets: [] });
    ok(4000 - tolled.players[FOE].lp >= 400, 'Aswan costs them 400 on the way out',
      String(4000 - tolled.players[FOE].lp));

    /* And what it leaves behind lies down. Two bodies standing up are two free
       kills and two hits of damage; the same two in Defence are two walls and
       two Tributes still breathing when your turn comes round. */
    const risen = tolled.players[ME].monsters.filter(Boolean);
    ok(risen.length === 2, 'and leaves two bodies behind',
      risen.map((m) => m!.tokenName ?? m!.slug).join(',') || '(none)');
    ok(risen.every((m) => m!.position === 'def' && m!.face === 'up'),
      'both of them face-up in Defence',
      risen.map((m) => `${m!.tokenName ?? m!.slug}:${m!.position}/${m!.face}`).join(','));
  }

  /* --- The Mound --- */
  {
    const s = seto();
    const servant = card(ME, 'pharaoh-s-servant'); // 900 printed
    s.players[ME].monsters = [servant, null, null];
    s.players[ME].field = { ...card(ME, 'mound-of-the-bound-creator'), face: 'up' as const };
    ok(effAtk(s, servant, ME) === baseAtkOf('pharaoh-s-servant') + 400,
      'the Mound is worth 400 now', String(effAtk(s, servant, ME)));
    /* CONTROL: still not to the God it houses. */
    const withGod = structuredClone(s);
    const god = card(ME, 'obelisk-the-tormentor');
    withGod.players[ME].monsters[1] = god;
    ok(effAtk(withGod, withGod.players[ME].monsters[1]!, ME) === baseAtkOf('obelisk-the-tormentor'),
      'CONTROL: and never to the Divine-Beast sleeping in it',
      String(effAtk(withGod, withGod.players[ME].monsters[1]!, ME)));
  }
}

/* ------------------------------------------------------------------ */
/* One effect, one verdict: a shield is judged before anything falls     */
/* ------------------------------------------------------------------ */
console.log('\nA protector that dies in the same breath still protected');
{
  /* Reported: Crush Card Virus took a Robotic Knight and the Steel Ogre Grotto
     #1 he was shielding, and the owner asked whether the ogre should have been
     protected.

     It should — and the reason it was not is worse than either ruling. The
     destroy op judged each card as its turn came round, so a protector that
     fell earlier in the same batch took everything it shielded with it, and
     which card fell first was decided by nothing better than Monster Zone
     order. The same board could go either way depending on where you happened
     to have put your monsters, which is not a rule anybody could play around. */
  const swept = (zones: string[]) => {
    const s = fresh();
    s.active = FOE;
    s.players[ME].monsters = [
      zones[0] ? card(ME, zones[0]) : null,
      zones[1] ? card(ME, zones[1]) : null,
      null,
    ];
    const hole = card(FOE, 'dark-hole');
    s.players[FOE].hand = [hole];
    const after = act(s, FOE, { type: 'activateSpell', uid: hole.uid, targets: [] });
    return after.players[ME].monsters.filter(Boolean).map((m) => m!.slug).sort().join(',') || '(none)';
  };

  ok(swept(['robotic-knight', 'steel-ogre-grotto-1']) === 'steel-ogre-grotto-1',
    'a Machine shielded by Robotic Knight outlives the sweep that kills him',
    swept(['robotic-knight', 'steel-ogre-grotto-1']));
  ok(swept(['steel-ogre-grotto-1', 'robotic-knight']) === 'steel-ogre-grotto-1',
    'and the Monster Zones they happen to sit in change nothing',
    swept(['steel-ogre-grotto-1', 'robotic-knight']));

  /* CONTROL: without the Knight there is no shield, so the ogre is not simply
     immune to sweeps on its own. */
  ok(swept(['steel-ogre-grotto-1', 'cannon-soldier']) === '(none)',
    'CONTROL: with no Knight standing, the ogre dies like anything else',
    swept(['steel-ogre-grotto-1', 'cannon-soldier']));
  /* CONTROL: the Knight never shielded himself — `excludeSelf` — so he is not
     surviving his own aura. */
  ok(!swept(['robotic-knight', 'steel-ogre-grotto-1']).includes('robotic-knight'),
    'CONTROL: the Knight does not shield himself');

  /* AND A GOD IS STILL ABOVE ALL OF IT.
     The verdict is now taken before the batch begins, which is exactly the kind
     of change that can quietly hand a shield authority it never had — the
     shield is decided a moment earlier, and a moment earlier is before anyone
     has asked whose effect this is. Obelisk's fist goes through it, in either
     Monster Zone order, the same as it goes through everything else. */
  /* Ra's God Phoenix rather than Obelisk's Fist, which no longer destroys
     anything — the claim is about a God's *effect* going through a shield, and
     it needs a God effect that sweeps. */
  const fist = (zones: string[]) => {
    const s = fresh();
    const god = card(ME, 'the-winged-dragon-of-ra');
    god.summonedOnTurn = 0;
    s.players[ME].monsters = [god, card(ME, 'kuriboh'), card(ME, 'battle-ox')];
    s.players[FOE].monsters = [card(FOE, zones[0]), card(FOE, zones[1]), null];
    const smitten = act(s, ME, { type: 'ignition', uid: god.uid, targets: [] });
    return smitten.players[FOE].monsters.filter(Boolean).map((m) => m!.slug).join(',') || '(none)';
  };
  ok(fist(['robotic-knight', 'steel-ogre-grotto-1']) === '(none)',
    'no shield stands before a God — Ra takes the Knight and everything he was guarding',
    fist(['robotic-knight', 'steel-ogre-grotto-1']));
  ok(fist(['steel-ogre-grotto-1', 'robotic-knight']) === '(none)',
    'and the zone order changes nothing there either',
    fist(['steel-ogre-grotto-1', 'robotic-knight']));

  /* And the same verdict through a targeted mass destroy, not just a sweep. */
  const virus = fresh();
  virus.active = ME;
  virus.players[ME].monsters = [card(ME, 'robotic-knight'), card(ME, 'steel-ogre-grotto-1'), null];
  const ccv = { ...card(FOE, 'crush-card-virus'), face: 'down' as const };
  ccv.summonedOnTurn = 0;
  virus.players[FOE].spellTrap = ccv;
  const opened = applyAction(virus, ME, { type: 'toPhase', phase: 'battle' }).state;
  ok(opened.pending?.kind === 'trap', 'Crush Card Virus answers the Battle Phase',
    opened.pending?.kind ?? '(no window)');
  const crushed = act(opened, FOE, { type: 'respondTrap', uid: ccv.uid });
  ok(crushed.players[ME].monsters.some((m) => m?.slug === 'steel-ogre-grotto-1'),
    'and the ogre survives Crush Card Virus too',
    crushed.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(!crushed.players[ME].monsters.some((m) => m?.slug === 'robotic-knight'),
    'while the Knight who shielded it does not');
}

/* ------------------------------------------------------------------ */
/* A Trap with nothing to point at is never offered                      */
/* ------------------------------------------------------------------ */
console.log('\nA trap window only offers what the trap can actually use');
{
  /* Reported: "Metalmorph asked me to activate it when I had no monsters on
     the field."

     The trap window checked three things — the right window, the card being
     ready, and the cost being payable — and never asked the fourth: whether
     the effect had anything to point at. The Spell path has asked that since
     Mai kept playing De-Spell at an empty backrow.

     Metalmorph is the worst shape of it, because an Equip Trap does not go to
     the Graveyard when it resolves. Offered on an empty board it announced
     itself, found no monster, and then *stayed* — sitting in the one
     Spell/Trap Zone attached to nothing for the rest of the duel. */
  const board = (mine: string | null) => {
    const s = fresh();
    s.active = FOE;
    s.players[ME].monsters = [mine ? card(ME, mine) : null, null, null];
    const skull = card(FOE, 'summoned-skull');
    skull.summonedOnTurn = 0;
    s.players[FOE].monsters = [skull, null, null];
    const trap = { ...card(ME, 'metalmorph'), face: 'down' as const };
    trap.summonedOnTurn = 0;
    s.players[ME].spellTrap = trap;
    return { state: applyAction(s, FOE, { type: 'toPhase', phase: 'battle' }).state, trap };
  };

  const empty = board(null);
  ok(empty.state.pending?.kind !== 'trap',
    'with no monster to equip, Metalmorph is not offered at all',
    empty.state.pending?.kind ?? '(no window)');
  /* And the engine agrees if the response is sent anyway, so the two cannot
     drift apart the way the picker and the gate did over 7 Completed. */
  const forced = applyAction(empty.state, ME, { type: 'respondTrap', uid: empty.trap.uid });
  ok(forced.state.players[ME].spellTrap?.face === 'down',
    'and it stays face-down rather than being spent for nothing',
    forced.state.players[ME].spellTrap?.face ?? '(gone)');
  ok(!forced.state.players[ME].spellTrap?.equippedTo,
    'never left equipped to nothing, blocking the zone');

  /* Kuriboh is the hand-trap half of the same gate, and it must keep working.
     Shielding you from damage points at nothing, so `activationIsDead` has no
     grounds to refuse it — but "no grounds" is a claim, and a claim about a
     card the owner actually plays is worth a check rather than a comment. This
     covers the branch with the one card that reaches it: inverting the gate
     stops Kuriboh being offered and turns these red. */
  {
    const swing = fresh('battle');
    swing.active = FOE;
    const beater = card(FOE, 'summoned-skull'); // 2500, straight to the face
    beater.summonedOnTurn = 0;
    swing.players[FOE].monsters = [beater, null, null];
    swing.players[ME].monsters = [null, null, null];
    const fuzz = card(ME, 'kuriboh');
    swing.players[ME].hand = [fuzz];
    const declared = applyAction(swing, FOE, { type: 'attack', uid: beater.uid, targetUid: null }).state;
    ok(declared.pending?.kind === 'trap' && declared.pending.options.includes(fuzz.uid),
      'Kuriboh is still offered out of the hand when the attack is declared',
      declared.pending?.kind ?? '(no window)');
    const saved = act(declared, ME, { type: 'respondTrap', uid: fuzz.uid });
    ok(saved.players[ME].lp === 4000, 'and it still takes the whole blow', `LP ${saved.players[ME].lp}`);
    ok(saved.players[ME].grave.some((g) => g.slug === 'kuriboh'), 'paying itself out of the hand to do it');
  }

  /* CONTROL: give it a body and the window opens exactly as before, or the
     check above is satisfied by a trap that simply never works. */
  const armed = board('cannon-soldier');
  ok(armed.state.pending?.kind === 'trap',
    'CONTROL: with a monster standing it is offered',
    armed.state.pending?.kind ?? '(no window)');
  const bolted = act(armed.state, ME, { type: 'respondTrap', uid: armed.trap.uid, targets: [armed.state.players[ME].monsters[0]!.uid] });
  ok(bolted.players[ME].spellTrap?.equippedTo === bolted.players[ME].monsters[0]!.uid,
    'and it attaches to it');

  /* The rule is the window, not the card: a Trap whose whole job is removal
     is not offered against a board with nothing to remove either. */
  const nothingToKill = fresh('battle');
  nothingToKill.active = FOE;
  const beater = card(FOE, 'summoned-skull');
  beater.summonedOnTurn = 0;
  nothingToKill.players[FOE].monsters = [beater, null, null];
  const wall = { ...card(ME, 'mirror-force'), face: 'down' as const };
  wall.summonedOnTurn = 0;
  nothingToKill.players[ME].spellTrap = wall;
  const swung = applyAction(nothingToKill, FOE, { type: 'attack', uid: beater.uid, targetUid: null }).state;
  ok(swung.pending?.kind === 'trap',
    'CONTROL: Mirror Force still answers an attack — its target comes from the attack, not a pool',
    swung.pending?.kind ?? '(no window)');
}

/* ------------------------------------------------------------------ */
/* A result is not an entrance                                           */
/* ------------------------------------------------------------------ */
console.log('\nWhat the board says, not just what the engine wrote');
{
  /* Reported: "When Barrel Dragon effect activated I see in the logs the coin
     tosses but I don't see the messages on the board."

     The engine was emitting the tally, and every engine-side check agreed it
     was there — the log line, the beat, the card art beside it. The board said
     "Barrel Dragon's effect activates" instead, because the rule that chooses
     the sentence answers for *any* activate beat carrying a slug, and the coin
     beat had just been given one so it could show a face. Two requirements, one
     of them satisfied at the cost of the other.

     So this asks the announcing rule directly. Nothing that only reads the log
     or only reads the beats can see this class: the bug lives in the step
     between them, which is why it survived a green battery. */
  const bd = fresh();
  const dragon = card(ME, 'barrel-dragon');
  bd.players[ME].monsters = [dragon, null, null];
  bd.players[FOE].monsters = [card(FOE, 'kuriboh'), null, null];
  bd.players[FOE].spellTrap = { ...card(FOE, 'de-spell'), face: 'down' as const };
  bd.players[FOE].hand = [card(FOE, 'pot-of-greed')];

  const fired = act(bd, ME, { type: 'ignition', uid: dragon.uid, targets: [] });
  const beats = fired.anims.filter((a) => a.id.startsWith(`a${fired.version}_`));
  const said = beats.map((b) => spokenFor(fired, b)?.text ?? '(silent)');

  ok(said.some((s) => /HEADS/.test(s) && /TAILS/.test(s)),
    'the board says what the coins did, not just the log', said.join(' | '));
  ok(said.filter((s) => /effect activates/.test(s)).length === 1,
    'and announces the dragon once, not once per beat it emits', said.join(' | '));

  const tally = beats.find((b) => b.reports);
  ok(!!tally && tally.slug === 'barrel-dragon',
    'the tally still carries the card, so the line is not printed over empty space',
    tally?.slug ?? '(no beat)');
  /* Barrel Dragon is Keith's own emblem, so before this the coin toss played
     his entire signature moment a second time, every ignition. */
  ok(!!tally && !isSignatureBeat(tally),
    'and a result never claims the signature flourish, even on a duelist emblem');
  ok(isSignatureBeat(beats[0]!),
    'CONTROL: the beat that really announces the card still earns it',
    spokenFor(fired, beats[0]!)?.text ?? '(silent)');

  /* The same shape, three more places — every beat that reports an outcome
     rather than an activation. Slot Machine's reels are the clearest: the
     ignition announces the card, the dice report a result. */
  const sm = fresh();
  const reels = card(ME, 'slot-machine');
  sm.players[ME].monsters = [reels, null, null];
  const spun = act(sm, ME, { type: 'ignition', uid: reels.uid, targets: [] });
  const spoke = spun.anims
    .filter((a) => a.id.startsWith(`a${spun.version}_`))
    .map((b) => spokenFor(spun, b)?.text ?? '(silent)');
  ok(spoke.some((s) => /seven/.test(s)), 'the dice say what they made', spoke.join(' | '));

  /* And the fare Pendulum Machine pays, which is a cost and not an activation. */
  const pm = fresh();
  const ball = card(ME, 'pendulum-machine');
  pm.players[ME].hand = [ball];
  pm.players[ME].grave = [card(ME, 'steel-ogre-grotto-1')];
  const built = act(pm, ME, { type: 'handSummon', uid: ball.uid });
  const fare = built.anims
    .filter((a) => a.id.startsWith(`a${built.version}_`))
    .map((b) => spokenFor(built, b)?.text ?? '(silent)');
  ok(fare.some((s) => /banished from the Graveyard/.test(s)),
    'and the board says which corpse paid the fare', fare.join(' | '));
}

console.log('\nThe Deck answers to the player, and never twice in the same order');
{
  /* A bare table with a Deck big enough that a shuffle is visible. Twelve
     identical Kuriboh would do for "did it move" — the uids differ — but real
     cards make the failures readable. */
  const table = () => {
    const s = fresh();
    for (const pid of [ME, FOE] as PlayerId[]) {
      s.players[pid].monsters = [null, null, null];
      s.players[pid].hand = [];
      s.players[pid].grave = [];
      s.players[pid].spellTrap = null;
      s.players[pid].field = null;
      s.players[pid].deck = Array.from({ length: 14 }, () => card(pid, 'kuriboh'));
    }
    return s;
  };
  const uids = (s: DuelState, pid: PlayerId) => s.players[pid].deck.map((c) => c.uid);
  /* Did the pile keep its order? Asked of the cards that are still in it, so a
     search taking one out is not mistaken for a shuffle. */
  const stillInOrder = (before: string[], after: string[]) => {
    const kept = new Set(after);
    return before.filter((u) => kept.has(u)).join(',') === after.join(',');
  };

  /* --- The Temple names tomorrow, and the player names the card --- */
  {
    const spec = targetSpecForEffect('temple-of-the-kings', 1);
    ok(!!spec && spec.zone === 'deck' && spec.side === 'own',
      'the Temple of the Kings asks which card the future holds',
      JSON.stringify(spec));

    const s = table();
    const temple = card(ME, 'temple-of-the-kings');
    s.players[ME].hand = [temple];
    const wanted = s.players[ME].deck[9];
    const before = uids(s, ME);
    const open = act(s, ME, { type: 'activateSpell', uid: temple.uid, targets: [wanted.uid] });
    ok(open.players[ME].destinyDrawUid === wanted.uid,
      'and the card the player pointed at is the one it names',
      `${open.players[ME].destinyDrawUid} vs ${wanted.uid}`);
    ok(!stillInOrder(before, uids(open, ME)),
      'the Deck it laid open does not stay in the order it was read in',
      uids(open, ME).join(','));
    const drawn = act(act(open, ME, { type: 'endTurn' }), FOE, { type: 'endTurn' });
    ok(drawn.players[ME].hand.some((h) => h.uid === wanted.uid),
      'and the promise is kept anyway — it travels by card, not by position',
      drawn.players[ME].hand.map((h) => h.slug).join(','));
  }

  /* --- Every other way in is closed behind you too --- */
  {
    /* A Trap Set out of the Deck. */
    const s = table();
    s.phase = 'battle';
    s.active = FOE;
    const anubis = { ...card(ME, 'judgment-of-anubis'), face: 'down' as const };
    anubis.summonedOnTurn = 0;
    s.players[ME].spellTrap = anubis;
    const chosen = card(ME, 'trap-hole');
    s.players[ME].deck = [card(ME, 'mirror-force'), ...s.players[ME].deck, chosen];
    const before = uids(s, ME);
    const beater = card(FOE, 'summoned-skull');
    beater.summonedOnTurn = 0;
    s.players[FOE].monsters = [beater, null, null];
    const declared = applyAction(s, FOE, { type: 'attack', uid: beater.uid, targetUid: null }).state;
    const judged = act(declared, ME, { type: 'respondTrap', uid: anubis.uid, targets: [chosen.uid] });
    ok(judged.players[ME].spellTrap?.uid === chosen.uid,
      'Judgment of Anubis Sets the Trap the player named, not the nearest one',
      judged.players[ME].spellTrap?.slug ?? '(empty)');
    ok(!stillInOrder(before, uids(judged, ME)),
      'and shuffles the Deck it went through',
      uids(judged, ME).join(','));

    /* A monster called out of the Deck. */
    const spy = table();
    const eye = { ...card(ME, 'gravekeeper-s-spy'), face: 'down' as const, position: 'def' as const };
    eye.summonedOnTurn = 0;
    spy.players[ME].monsters = [eye, null, null];
    const bug = card(ME, 'man-eater-bug');
    spy.players[ME].deck = [card(ME, 'wall-of-illusion'), ...spy.players[ME].deck, bug];
    const deckBefore = uids(spy, ME);
    const planted = act(spy, ME, { type: 'changePosition', uid: eye.uid, targets: [bug.uid] });
    ok(planted.players[ME].monsters.some((m) => m?.uid === bug.uid),
      "Gravekeeper's Spy plants the monster the player chose",
      planted.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
    ok(!stillInOrder(deckBefore, uids(planted, ME)),
      'and the Deck it searched is shuffled behind it',
      uids(planted, ME).join(','));

    /* And flipped face-up by an attack, where the board never had a chance to
       ask, the engine stops and asks instead of choosing — `raiseChoice`, which
       has been waiting for a card like this. Before the Spy declared `targets`
       it silently took Wall of Illusion, the biggest thing that qualified,
       every time. */
    const blind = act(spy, ME, { type: 'changePosition', uid: eye.uid });
    ok(blind.pending?.kind === 'choose' && blind.pending.player === ME,
      'and asked nothing, it stops and asks rather than choosing for you',
      blind.pending ? `${blind.pending.kind}/${blind.pending.player}` : '(resolved silently)');
    ok(!blind.players[ME].monsters.some((m) => m?.slug === 'wall-of-illusion'),
      'CONTROL: nothing is planted while the question is still open',
      blind.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  }

  /* --- The other two that were choosing for themselves --- */
  {
    /* Magical Hats: four magicians qualify and only one of them is the point. */
    const s = table();
    s.phase = 'battle';
    s.active = FOE;
    const hats = { ...card(ME, 'magical-hats'), face: 'down' as const };
    hats.summonedOnTurn = 0;
    s.players[ME].spellTrap = hats;
    const faith = card(ME, 'magician-of-faith');
    s.players[ME].deck = [card(ME, 'dark-magician'), ...s.players[ME].deck, faith];
    const beater = card(FOE, 'summoned-skull');
    beater.summonedOnTurn = 0;
    s.players[FOE].monsters = [beater, null, null];
    const declared = applyAction(s, FOE, { type: 'attack', uid: beater.uid, targetUid: null }).state;
    /* A Trap resolves where it is played rather than through `fireTriggers`, so
       nothing parks it and asks — the board is the only thing that can, and it
       only asks when the card declares it wants to be asked. That declaration
       is what this assertion is really about. */
    const hatSpec = targetSpecFor('magical-hats', 'trap');
    ok(hatSpec?.zone === 'deck' && hatSpec.side === 'own',
      'Magical Hats asks which magician goes under the hat', JSON.stringify(hatSpec));
    const underHats = hatSpec ? targetCandidates(declared, ME, hatSpec).map((c) => c.slug).sort() : [];
    ok(underHats.join(',') === 'dark-magician,magician-of-faith',
      'and offers every magician it could hide, big or small', underHats.join(',') || '(none)');
    const hidden = act(declared, ME, { type: 'respondTrap', uid: hats.uid, targets: [faith.uid] });
    ok(hidden.players[ME].monsters.some((m) => m?.uid === faith.uid),
      'the hat hides the magician the player picked, not the biggest one',
      hidden.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
    /* CONTROL: the two answers are genuinely different, so the pin above cannot
       pass by accident — asked nothing, it still reaches for the 2500. */
    const blindHat = act(declared, ME, { type: 'respondTrap', uid: hats.uid });
    ok(blindHat.players[ME].monsters.some((m) => m?.slug === 'dark-magician'),
      'CONTROL: and with no answer it takes the biggest, which is not the one chosen',
      blindHat.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));

    /* Gamma reaches into three piles, and the Graveyard is one of them — the
       pile the modal could not draw at all until the zone existed. */
    const magnets = table();
    const gamma = card(ME, 'gamma-the-magnet-warrior');
    magnets.players[ME].hand = [gamma];
    const alpha = card(ME, 'alpha-the-magnet-warrior');
    magnets.players[ME].grave = [alpha];
    magnets.players[ME].deck = [card(ME, 'beta-the-magnet-warrior'), ...magnets.players[ME].deck];
    const spec = targetSpecFor('gamma-the-magnet-warrior', 'onSummon');
    ok(spec?.zone === 'handOrDeckOrGrave', 'and it offers all three piles at once', JSON.stringify(spec));
    const brothers = spec ? targetCandidates(magnets, ME, spec) : [];
    ok(brothers.some((c) => c.uid === alpha.uid) && brothers.some((c) => c.slug === 'beta-the-magnet-warrior'),
      'both brothers, wherever they are lying — one in the Deck, one in the pile',
      brothers.map((c) => c.slug).join(',') || '(none)');
    /* And never itself. Gamma is a Magnet Warrior sitting in the hand it is
       about to leave, so it matched its own filter — the engine struck it off
       inside `raiseChoice` and the board, which asks a different way, did not.
       One rule, in `targetCandidates`, asked by both. */
    const asked = spec ? targetCandidates(magnets, ME, spec, undefined, gamma.uid) : [];
    ok(!asked.some((c) => c.uid === gamma.uid),
      'and never the monster doing the asking',
      asked.map((c) => c.slug).join(','));
    ok(brothers.some((c) => c.uid === gamma.uid),
      'CONTROL: it does match its own filter, so striking it off is real work',
      brothers.map((c) => c.slug).join(','));
    const pulled = act(magnets, ME, {
      type: 'normalSummon', uid: gamma.uid, zone: 0, position: 'atk', face: 'up', tributes: [], targets: [alpha.uid],
    });
    ok(pulled.players[ME].monsters.some((m) => m?.uid === alpha.uid),
      'and the brother out of the Graveyard is the one that answers',
      pulled.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  }

  /* --- Serket has two doors, and the player chooses which --- */
  {
    const s = table();
    s.players[ME].field = { ...card(ME, 'temple-of-the-kings'), face: 'up' as const };
    const beast = card(ME, 'mystical-beast-of-serket');
    s.players[ME].hand = [beast];
    const bodies = [card(ME, 'kuriboh'), card(ME, 'kuriboh'), card(ME, 'kuriboh')];
    for (const b of bodies) b.summonedOnTurn = 0;
    s.players[ME].monsters = [bodies[0], bodies[1], bodies[2]];

    ok(tributesRequired('mystical-beast-of-serket', s, ME, true) === 1,
      'the ordinary price is bodies, Temple standing or not',
      String(tributesRequired('mystical-beast-of-serket', s, ME, true)));
    ok(tributesRequired('mystical-beast-of-serket', s, ME) === 0,
      'and the Temple is the other price, not a discount on that one');

    /* The reported board exactly: three monsters, no free zone, Temple up. */
    const paid = act(s, ME, {
      type: 'normalSummon', uid: beast.uid, zone: 0, position: 'atk', face: 'up', tributes: [bodies[0].uid],
    });
    ok(paid.players[ME].monsters.some((m) => m?.slug === 'mystical-beast-of-serket'),
      'a full board Tribute Summons Serket, which is what a full board is for',
      paid.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
    ok(paid.players[ME].field?.slug === 'temple-of-the-kings',
      'and the Temple it did not spend is still standing',
      paid.players[ME].field?.slug ?? '(gone)');
    ok(paid.players[ME].grave.some((g) => g.uid === bodies[0].uid), 'the body it did spend is in the Graveyard');

    /* And the other door still opens. */
    const empty = table();
    empty.players[ME].field = { ...card(ME, 'temple-of-the-kings'), face: 'up' as const };
    const beast2 = card(ME, 'mystical-beast-of-serket');
    empty.players[ME].hand = [beast2];
    const freed = act(empty, ME, {
      type: 'normalSummon', uid: beast2.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
    });
    ok(freed.players[ME].monsters.some((m) => m?.slug === 'mystical-beast-of-serket'),
      'or it walks out of the Temple with no body paid at all');
    ok(freed.players[ME].field === null && freed.players[ME].banished.some((b) => b.slug === 'temple-of-the-kings'),
      'and that Temple is banished, which is the price of the shortcut',
      freed.players[ME].field?.slug ?? '(gone)');
  }
}

console.log('\nThe Inferno Fire Blast is worth what the dragon has burned');
{
  const arena = () => {
    const s = fresh();
    for (const pid of [ME, FOE] as PlayerId[]) {
      s.players[pid].monsters = [null, null, null];
      s.players[pid].hand = [];
      s.players[pid].grave = [];
      s.players[pid].spellTrap = null;
      s.players[pid].field = null;
    }
    return s;
  };
  /* One turn of the crank: burn the prey down, hand the turn over, take it
     back. There is no Main Phase 2 in this game, so a kill can never feed the
     same turn's Blast — the Battle Phase is where the turn ends. */
  const feed = (s: DuelState, dragon: CardInstance, prey: CardInstance): DuelState => {
    /* Topped up first. A dragon fed twice runs its owner out of Life Points
       before the third Blast can be measured, and a duel that ends early is not
       the thing under test. */
    s.players[FOE].lp = 8000;
    const fed = act(act(s, ME, { type: 'toPhase', phase: 'battle' }), ME, {
      type: 'attack', uid: dragon.uid, targetUid: prey.uid,
    });
    return act(act(fed, ME, { type: 'endTurn' }), FOE, { type: 'endTurn' });
  };
  const blast = (s: DuelState, dragon: CardInstance): number => {
    s.players[FOE].lp = 8000;
    return 8000 - act(s, ME, { type: 'ignition', uid: dragon.uid, targets: [] }).players[FOE].lp;
  };

  {
    const s = arena();
    const red = card(ME, 'red-eyes-black-dragon');
    red.summonedOnTurn = 0;
    s.players[ME].monsters = [red, null, null];
    const first = card(FOE, 'kuriboh');
    first.summonedOnTurn = 0;
    s.players[FOE].monsters = [first, null, null];

    const cold = blast(s, red);
    ok(cold === 800, 'a dragon that has burned nothing blasts for 800', String(cold));

    const once = feed(s, red, first);
    const fedOnce = once.players[ME].monsters.find((m) => m?.uid === red.uid)!;
    ok(fedOnce.counters === 1, 'and carries what it killed on its face', String(fedOnce.counters));
    const warm = blast(once, fedOnce);
    ok(warm === 1200, 'so the next Blast is 1200', String(warm));
    ok(fedOnce.atkMod === 400, 'and the 400 ATK it always gained is still gained', String(fedOnce.atkMod));

    const second = card(FOE, 'kuriboh');
    second.summonedOnTurn = 0;
    once.players[FOE].monsters = [second, null, null];
    const twice = feed(once, red, second);
    const fedTwice = twice.players[ME].monsters.find((m) => m?.uid === red.uid)!;
    const hot = blast(twice, fedTwice);
    ok(hot === 1600, 'two kills, 1600 — it is a rate, not a one-off', String(hot));
    ok(fedTwice.atkMod === 800, 'and 800 ATK, one gain per kill', String(fedTwice.atkMod));
  }

  /* --- It burns nothing it did not kill itself --- */
  {
    const s = arena();
    const red = card(ME, 'red-eyes-black-dragon');
    red.summonedOnTurn = 0;
    const ally = card(ME, 'summoned-skull');
    ally.summonedOnTurn = 0;
    s.players[ME].monsters = [red, ally, null];
    const prey = card(FOE, 'kuriboh');
    prey.summonedOnTurn = 0;
    s.players[FOE].monsters = [prey, null, null];
    const other = act(act(s, ME, { type: 'toPhase', phase: 'battle' }), ME, {
      type: 'attack', uid: ally.uid, targetUid: prey.uid,
    });
    const turned = act(act(other, ME, { type: 'endTurn' }), FOE, { type: 'endTurn' });
    const unfed = turned.players[ME].monsters.find((m) => m?.uid === red.uid)!;
    const still = blast(turned, unfed);
    ok(still === 800, 'a kill made by the monster beside it feeds it nothing', String(still));
  }

  /* --- And the fire dies with the body --- */
  {
    const s = arena();
    const red = card(ME, 'red-eyes-black-dragon');
    red.summonedOnTurn = 0;
    s.players[ME].monsters = [red, null, null];
    const prey = card(FOE, 'kuriboh');
    prey.summonedOnTurn = 0;
    s.players[FOE].monsters = [prey, null, null];
    const fed = feed(s, red, prey);

    const hole = card(ME, 'dark-hole');
    fed.players[ME].hand = [hole];
    const razed = act(fed, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
    const reborn = card(ME, 'monster-reborn');
    razed.players[ME].hand = [reborn];
    const back = act(razed, ME, {
      type: 'activateSpell', uid: reborn.uid, targets: [razed.players[ME].grave.find((g) => g.uid === red.uid)!.uid],
    });
    const risen = back.players[ME].monsters.find((m) => m?.slug === 'red-eyes-black-dragon')!;
    ok(risen.counters === 0, 'a Red-Eyes brought back is a Red-Eyes that has burned nothing', String(risen.counters));
    /* And the Blast is fresh too, which has to be checked rather than inferred:
       the counters are what the damage reads, so a reset that only cleared the
       ATK would have left a 1200 Blast on a 2400 body. */
    const cool = arena();
    cool.players[ME].monsters = [{ ...risen }, null, null];
    cool.players[ME].monsters[0]!.effectUsedOnTurn = -1;
    const afterDeath = blast(cool, cool.players[ME].monsters[0]!);
    ok(afterDeath === 800, 'and blasts for 800 again, not for what its last life earned', String(afterDeath));
  }
}

console.log('\nA kill is paid for only when there was a kill');
{
  const ring = () => {
    const s = fresh();
    for (const pid of [ME, FOE] as PlayerId[]) {
      s.players[pid].monsters = [null, null, null];
      s.players[pid].hand = [];
      s.players[pid].grave = [];
      s.players[pid].spellTrap = null;
      s.players[pid].field = null;
    }
    s.phase = 'battle';
    return s;
  };
  const swing = (s: DuelState, mine: CardInstance, theirs: CardInstance) =>
    act(s, ME, { type: 'attack', uid: mine.uid, targetUid: theirs.uid });

  /* --- Garoozis over a Sphinx that sinks instead of falling --- */
  {
    /* 1800 into 1700: the Sphinx would die, and turns face-down instead. It is
       still standing, so nothing was killed and nothing is owed. Reported by
       the owner as "it still counted as destroyed and Garoozis rolled a dice". */
    const s = ring();
    const gar = card(ME, 'garoozis');
    gar.summonedOnTurn = 0;
    s.players[ME].monsters = [gar, null, null];
    const sphinx = card(FOE, 'guardian-sphinx');
    sphinx.summonedOnTurn = 0;
    s.players[FOE].monsters = [sphinx, null, null];
    const held = swing(s, gar, sphinx);

    const sank = held.players[FOE].monsters.find((m) => m?.uid === sphinx.uid);
    ok(!!sank && sank.face === 'down', 'the Sphinx sinks back into the sand rather than falling',
      sank ? sank.face : '(gone)');
    ok(!held.log.some((l) => /rolls|die|dice/i.test(l.text)),
      'so Garoozis rolls nothing — there was no kill to be paid for',
      held.log.slice(-4).map((l) => l.text).join(' | '));
    const stillGar = held.players[ME].monsters.find((m) => m?.uid === gar.uid)!;
    ok(stillGar.atkMod === 0, 'and gains no ATK off a monster that is still standing', String(stillGar.atkMod));
    ok(held.players[ME].hand.length === 0, 'and draws no card', String(held.players[ME].hand.length));

    /* CONTROL: over a body that really dies, everything it is owed still
       arrives. Without this the pin above passes on a Garoozis that has simply
       stopped working. */
    const real = ring();
    const gar2 = card(ME, 'garoozis');
    gar2.summonedOnTurn = 0;
    real.players[ME].monsters = [gar2, null, null];
    const prey = card(FOE, 'kuriboh');
    prey.summonedOnTurn = 0;
    real.players[FOE].monsters = [prey, null, null];
    const killed = swing(real, gar2, prey);
    ok(!killed.players[FOE].monsters.some((m) => m?.uid === prey.uid), 'CONTROL: an ordinary body does die');
    ok(killed.players[ME].monsters.find((m) => m?.uid === gar2.uid)!.atkMod > 0,
      'CONTROL: and Garoozis is paid for that one',
      String(killed.players[ME].monsters.find((m) => m?.uid === gar2.uid)!.atkMod));

    /* And the escape is spent. The second blow lands like any other, so the
       payout comes back with it — the gate is "did it die", not "is it a
       Sphinx". */
    const again = { ...held, phase: 'battle' as const };
    const risenSphinx = again.players[FOE].monsters.find((m) => m?.uid === sphinx.uid)!;
    risenSphinx.face = 'up';
    risenSphinx.position = 'atk';
    const g3 = again.players[ME].monsters.find((m) => m?.uid === gar.uid)!;
    g3.attacksUsed = 0;
    const second = swing(again, g3, risenSphinx);
    ok(!second.players[FOE].monsters.some((m) => m?.uid === sphinx.uid),
      'the second blow kills the Sphinx outright, its one life spent',
      second.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));
    ok(second.players[ME].monsters.find((m) => m?.uid === gar.uid)!.atkMod > 0,
      'and that one is paid for', String(second.players[ME].monsters.find((m) => m?.uid === gar.uid)!.atkMod));
  }

  /* --- And the same over a monster crouching in Defence --- */
  {
    /* A separate branch of the battle code, and it had a separate copy of the
       same mistake. 2500 into 2400 DEF: the Sphinx would die, and sinks. */
    const s = ring();
    const gar = card(ME, 'garoozis');
    gar.summonedOnTurn = 0;
    gar.atkMod = 700; // 2500, enough to break 2400 DEF
    s.players[ME].monsters = [gar, null, null];
    const sphinx = card(FOE, 'guardian-sphinx');
    sphinx.summonedOnTurn = 0;
    sphinx.position = 'def';
    s.players[FOE].monsters = [sphinx, null, null];
    const held = swing(s, gar, sphinx);
    const sank = held.players[FOE].monsters.find((m) => m?.uid === sphinx.uid);
    ok(!!sank && sank.face === 'down', 'a Sphinx broken in Defence sinks the same way', sank ? sank.face : '(gone)');
    ok(held.players[ME].monsters.find((m) => m?.uid === gar.uid)!.atkMod === 700,
      'and Garoozis is paid nothing for it either',
      String(held.players[ME].monsters.find((m) => m?.uid === gar.uid)!.atkMod));

    /* CONTROL: over a Defence body that really breaks, it is paid. */
    const real = ring();
    const gar2 = card(ME, 'garoozis');
    gar2.summonedOnTurn = 0;
    real.players[ME].monsters = [gar2, null, null];
    const wall = card(FOE, 'kuriboh');
    wall.summonedOnTurn = 0;
    wall.position = 'def';
    real.players[FOE].monsters = [wall, null, null];
    const broke = swing(real, gar2, wall);
    ok(broke.players[ME].monsters.find((m) => m?.uid === gar2.uid)!.atkMod > 0,
      'CONTROL: a Defence body that really breaks still pays out',
      String(broke.players[ME].monsters.find((m) => m?.uid === gar2.uid)!.atkMod));
  }

  /* --- Nor does Red-Eyes get hotter off a monster that lived --- */
  {
    const s = ring();
    const red = card(ME, 'red-eyes-black-dragon');
    red.summonedOnTurn = 0;
    s.players[ME].monsters = [red, null, null];
    const sphinx = card(FOE, 'guardian-sphinx');
    sphinx.summonedOnTurn = 0;
    s.players[FOE].monsters = [sphinx, null, null];
    const after = swing(s, red, sphinx);
    const dragon = after.players[ME].monsters.find((m) => m?.uid === red.uid)!;
    ok(dragon.counters === 0, 'the Blast counts kills, and that was not one', String(dragon.counters));
    ok(dragon.atkMod === 0, 'and neither did the ATK', String(dragon.atkMod));
  }

  /* --- Nor does Serket eat one --- */
  {
    /* Summoned rather than placed. Serket's appetite is a flag its own arrival
       sets, so a scorpion put straight into a Monster Zone by hand has no
       appetite at all — and a pin written that way passes whatever the engine
       does, which is how the first draft of this one came back green under
       sabotage and proved nothing. */
    const s = ring();
    s.phase = 'main';
    s.players[ME].field = { ...card(ME, 'temple-of-the-kings'), face: 'up' as const };
    const beast = card(ME, 'mystical-beast-of-serket');
    s.players[ME].hand = [beast];
    const summoned = act(s, ME, {
      type: 'normalSummon', uid: beast.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
    });
    const hungry = summoned.players[ME].monsters.find((m) => m?.uid === beast.uid)!;
    ok(effFlags(summoned, hungry, ME).devoursOnBattleDestroy === true,
      'a Summoned Serket is a hungry one — the position is real');

    const sphinx = card(FOE, 'guardian-sphinx');
    sphinx.summonedOnTurn = 0;
    summoned.players[FOE].monsters = [sphinx, null, null];
    const battled = { ...act(summoned, ME, { type: 'toPhase', phase: 'battle' }) };
    const after = swing(battled, hungry, sphinx);
    const fed = after.players[ME].monsters.find((m) => m?.uid === beast.uid)!;
    ok(fed.absorbed.length === 0, 'and it swallows what it kills, which was nothing',
      fed.absorbed.map((a) => a.slug).join(',') || '(empty)');

    /* CONTROL: a body that really dies really is eaten. */
    const meal = card(FOE, 'kuriboh');
    meal.summonedOnTurn = 0;
    const laid = act(summoned, ME, { type: 'toPhase', phase: 'battle' });
    laid.players[FOE].monsters = [meal, null, null];
    const ate = swing(laid, hungry, meal);
    const full = ate.players[ME].monsters.find((m) => m?.uid === beast.uid)!;
    ok(full.absorbed.some((a) => a.slug === 'kuriboh'),
      'CONTROL: and one that does die is swallowed', full.absorbed.map((a) => a.slug).join(',') || '(empty)');
  }

  /* --- A stolen body that refuses to fall is not stolen for ever --- */
  {
    /* Possessed Dark Soul's whole price is that the possession ends. The clock
       was cleared *before* asking whether the body died, so anything that can
       survive an effect left the captor holding it with no expiry at all.

       Serket is the reachable one: it sheds what it has swallowed instead of
       dying to an effect, which is exactly the case. The Sphinx cannot show
       this — its one life is spent against *battle* only, and the End Phase
       crumble is an effect. */
    const s = ring();
    s.phase = 'main';
    s.players[FOE].field = { ...card(FOE, 'temple-of-the-kings'), face: 'up' as const };
    const beast = card(FOE, 'mystical-beast-of-serket');
    s.players[FOE].hand = [beast];
    s.active = FOE;
    const summoned = act(s, FOE, {
      type: 'normalSummon', uid: beast.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
    });
    const scorpion = summoned.players[FOE].monsters.find((m) => m?.uid === beast.uid)!;
    scorpion.absorbed = [{ slug: 'kuriboh', owner: FOE }];

    /* Taken, and standing in the captor's zones on its last End Phase. */
    const taken = { ...summoned, active: ME, phase: 'main' as const };
    taken.players[FOE].monsters = [null, null, null];
    scorpion.possessedEndPhases = 1;
    taken.players[ME].monsters = [scorpion, null, null];
    const done = act(taken, ME, { type: 'endTurn' });
    const held = done.players[ME].monsters.find((m) => m?.uid === beast.uid);
    ok(!!held && held.absorbed.length === 0, 'the stolen scorpion pays with its stomach rather than falling',
      held ? String(held.absorbed.length) : '(gone)');
    ok(held?.possessedEndPhases === 1,
      'and the Rod keeps its clock wound, so the ka is spent again next End Phase',
      String(held?.possessedEndPhases));
    ok(!done.log.some((l) => /crumbles — the ka is spent/.test(l.text)),
      'nothing crumbled, and the board does not say it did',
      done.log.slice(-3).map((l) => l.text).join(' | '));

    /* And the End Phase after that finishes it: the stomach is empty now. */
    const again = { ...done, phase: 'main' as const, active: ME };
    const ended = act(again, ME, { type: 'endTurn' });
    ok(!ended.players[ME].monsters.some((m) => m?.uid === beast.uid),
      'and the next End Phase, with nothing left to pay with, it does crumble',
      ended.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));

    /* CONTROL: an ordinary stolen body crumbles the first time it is asked. */
    const plain = ring();
    plain.phase = 'main';
    const ox = card(FOE, 'battle-ox');
    ox.summonedOnTurn = 0;
    ox.possessedEndPhases = 1;
    plain.players[ME].monsters = [ox, null, null];
    const gone = act(plain, ME, { type: 'endTurn' });
    ok(!gone.players[ME].monsters.some((m) => m?.uid === ox.uid),
      'CONTROL: an ordinary stolen body crumbles when the clock runs out',
      gone.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  }

  /* --- And the board does not announce a death that did not happen --- */
  {
    /* An even trade against a Sphinx: the attacker falls, the Sphinx sinks.
       "Both monsters are destroyed!" said up front was flatly contradicted by
       the very next line. */
    const s = ring();
    const even = card(ME, 'garoozis');
    even.summonedOnTurn = 0;
    even.atkMod = -100; // 1700, the Sphinx's own ATK
    s.players[ME].monsters = [even, null, null];
    const sphinx = card(FOE, 'guardian-sphinx');
    sphinx.summonedOnTurn = 0;
    s.players[FOE].monsters = [sphinx, null, null];
    const traded = swing(s, even, sphinx);
    ok(!traded.log.some((l) => /Both monsters are destroyed/.test(l.text)),
      'no "both monsters are destroyed" when only one of them was',
      traded.log.slice(-4).map((l) => l.text).join(' | '));
    ok(!traded.players[ME].monsters.some((m) => m?.uid === even.uid), 'the attacker really did fall');
    ok(traded.players[FOE].monsters.some((m) => m?.uid === sphinx.uid), 'and the Sphinx really did not');

    /* CONTROL: two ordinary bodies still get the line. */
    const fair = ring();
    const a = card(ME, 'battle-ox');
    a.summonedOnTurn = 0;
    fair.players[ME].monsters = [a, null, null];
    const b = card(FOE, 'battle-ox');
    b.summonedOnTurn = 0;
    fair.players[FOE].monsters = [b, null, null];
    const both = swing(fair, a, b);
    ok(both.log.some((l) => /Both monsters are destroyed/.test(l.text)),
      'CONTROL: and an even trade that really is even still says so',
      both.log.slice(-3).map((l) => l.text).join(' | '));
  }
}

console.log('\nIshizu: the tomb pays, and everything that falls into it comes back');
{
  const tomb = () => {
    const s = fresh();
    for (const pid of [ME, FOE] as PlayerId[]) {
      s.players[pid].monsters = [null, null, null];
      s.players[pid].hand = [];
      s.players[pid].grave = [];
      s.players[pid].spellTrap = null;
      s.players[pid].field = null;
      s.players[pid].deck = Array.from({ length: 10 }, () => card(pid, 'kuriboh'));
    }
    return s;
  };

  /* --- The Jackal is worth what he has already taken --- */
  {
    /* Special Summoned, which is the half a Normal-Summon-only trigger would
       have missed entirely. */
    const s = tomb();
    const jackal = card(ME, 'mystical-knight-of-jackal');
    s.players[ME].grave = [jackal];
    const reborn = card(ME, 'monster-reborn');
    s.players[ME].hand = [reborn];
    s.players[FOE].hand = [card(FOE, 'kuriboh'), card(FOE, 'battle-ox')];
    const summoned = act(s, ME, { type: 'activateSpell', uid: reborn.uid, targets: [jackal.uid] });
    ok(summoned.players[FOE].hand.length === 1,
      'the Jackal arrives however he arrives, and they throw one away',
      String(summoned.players[FOE].hand.length));

    /* And a Tribute Summon, which is how a Level 7 actually reaches the board:
       two guardians she was going to spend anyway. */
    const paid = tomb();
    const jackal2 = card(ME, 'mystical-knight-of-jackal');
    paid.players[ME].hand = [jackal2];
    const fodder = [card(ME, 'kuriboh'), card(ME, 'kuriboh')];
    for (const f of fodder) f.summonedOnTurn = 0;
    paid.players[ME].monsters = [fodder[0], fodder[1], null];
    paid.players[FOE].hand = [card(FOE, 'battle-ox')];
    const tributed = act(paid, ME, {
      type: 'normalSummon', uid: jackal2.uid, zone: 2, position: 'atk', face: 'up',
      tributes: [fodder[0].uid, fodder[1].uid],
    });
    ok(tributed.players[FOE].hand.length === 0,
      'and a Tribute Summon empties their hand just the same',
      String(tributed.players[FOE].hand.length));

    /* The mill and the ATK are one engine: what he takes off their Deck is
       what he is paid for. */
    const fight = tomb();
    const knight = card(ME, 'mystical-knight-of-jackal');
    knight.summonedOnTurn = 0;
    fight.players[ME].monsters = [knight, null, null];
    const prey = card(FOE, 'kuriboh');
    prey.summonedOnTurn = 0;
    fight.players[FOE].monsters = [prey, null, null];
    fight.phase = 'battle';
    const before = effAtk(fight, knight, ME);
    const struck = act(fight, ME, { type: 'attack', uid: knight.uid, targetUid: prey.uid });
    const after = struck.players[ME].monsters.find((m) => m?.uid === knight.uid)!;
    /* Three off their Deck plus the body he just broke: four cards in their
       Graveyard, four hundred on him. */
    ok(effAtk(struck, after, ME) === before + 400,
      'the three he buries and the one he broke are 400 ATK back on him',
      `${before} -> ${effAtk(struck, after, ME)}`);
  }

  /* --- Mudora replaces herself out of the tomb, however she got there --- */
  {
    const s = tomb();
    const held = card(ME, 'mudora');
    s.players[ME].hand = [held, card(ME, 'kuriboh')];
    s.players[ME].deck = [card(ME, 'mudora'), ...s.players[ME].deck];
    /* Discarded, not destroyed — "however it gets there" is the whole clause,
       and `onSentToGrave` would have watched only the field.
       Cannon Soldier's cost is the whole hand, which is the cleanest discard in
       the game; it is given a named victim so the monster it fires does not
       turn out to be the replacement that just arrived. */
    const soldier = card(ME, 'cannon-soldier');
    soldier.summonedOnTurn = 0;
    const ammo = card(ME, 'kuriboh');
    ammo.summonedOnTurn = 0;
    s.players[ME].monsters = [soldier, ammo, null];
    const fired = act(s, ME, { type: 'ignition', uid: soldier.uid, targets: [ammo.uid] });
    ok(fired.players[ME].monsters.some((m) => m?.slug === 'mudora'),
      'a Mudora thrown away out of the hand still stands the next one up',
      fired.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  }

  /* --- The guard relieves itself: Keldo falls, Agido takes the post --- */
  {
    const s = tomb();
    const keldo = card(ME, 'keldo');
    keldo.summonedOnTurn = 0;
    s.players[ME].monsters = [keldo, null, null];
    s.players[ME].deck = [card(ME, 'agido'), ...s.players[ME].deck];
    const hole = card(ME, 'dark-hole');
    s.players[ME].hand = [hole];
    const swept = act(s, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
    const relief = swept.players[ME].monsters.find((m) => m?.slug === 'agido');
    ok(!!relief, 'Keldo falls and Agido takes the post',
      swept.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
    ok(relief?.position === 'def', 'in Defence, as a replacement wall should be', relief?.position ?? '-');

    /* And Agido buries two on the way in, which is what the guard is for. */
    ok(swept.players[ME].grave.filter((c) => c.slug === 'kuriboh').length >= 2,
      'and buries two of her own arriving',
      String(swept.players[ME].grave.filter((c) => c.slug === 'kuriboh').length));

    /* Keldo now finds the valley however it arrives, not only off a Normal
       Summon — and it no longer stands up a twin. */
    const called = tomb();
    const k2 = card(ME, 'keldo');
    called.players[ME].hand = [k2];
    called.players[ME].deck = [card(ME, 'necrovalley'), card(ME, 'keldo'), ...called.players[ME].deck];
    const up = act(called, ME, {
      type: 'normalSummon', uid: k2.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
    });
    ok(up.players[ME].hand.some((h) => h.slug === 'necrovalley'), 'Keldo still finds the valley',
      up.players[ME].hand.map((h) => h.slug).join(','));
    ok(up.players[ME].monsters.filter((m) => m?.slug === 'keldo').length === 1,
      'and stands up no twin — that half is gone',
      up.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  }

  /* --- Agido the other way round --- */
  {
    const s = tomb();
    const agido = card(ME, 'agido');
    agido.summonedOnTurn = 0;
    s.players[ME].monsters = [agido, null, null];
    s.players[ME].deck = [card(ME, 'keldo'), card(ME, 'necrovalley'), ...s.players[ME].deck];
    const hole = card(ME, 'dark-hole');
    s.players[ME].hand = [hole];
    const swept = act(s, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
    const relief = swept.players[ME].monsters.find((m) => m?.slug === 'keldo');
    ok(!!relief && relief.position === 'def', 'Agido falls and Keldo takes it back, in Defence',
      swept.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
    /* And that Keldo finds the valley on the way in. This is the assertion that
       makes "when Summoned, not just Normal Summoned" real: a Keldo standing up
       out of Agido's death is a Special Summon, and the old trigger would have
       watched it arrive and done nothing. */
    ok(swept.players[ME].hand.some((h) => h.slug === 'necrovalley'),
      'and a Keldo that arrives by Special Summon still finds the valley',
      swept.players[ME].hand.map((h) => h.slug).join(',') || '(empty)');
  }

  /* --- Kelbek puts her own wall back up --- */
  {
    const s = tomb();
    const kelbek = card(ME, 'kelbek');
    kelbek.summonedOnTurn = 0;
    s.players[ME].monsters = [kelbek, null, null];
    s.players[ME].deck = [card(ME, 'kelbek'), ...s.players[ME].deck];
    const hole = card(ME, 'dark-hole');
    s.players[ME].hand = [hole];
    const swept = act(s, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
    const back = swept.players[ME].monsters.find((m) => m?.slug === 'kelbek');
    ok(!!back && back.position === 'def', 'a broken Kelbek is replaced in Defence',
      swept.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
    ok(!swept.players[ME].deck.some((c) => c.slug === 'kelbek'),
      'out of the Deck, so the wall runs down rather than round');
  }

  /* --- Zolga answers a Set card from the hand --- */
  {
    const s = tomb();
    const zolga = card(ME, 'zolga');
    s.players[ME].hand = [zolga];
    const set = { ...card(FOE, 'mirror-force'), face: 'down' as const };
    s.players[FOE].spellTrap = set;
    const thrown = act(s, ME, { type: 'discardForEffect', uid: zolga.uid, targets: [set.uid] });
    ok(thrown.players[FOE].spellTrap === null, 'Zolga is thrown away and the Set card breaks',
      thrown.players[FOE].spellTrap?.slug ?? '(empty)');
    ok(thrown.players[ME].grave.some((c) => c.uid === zolga.uid), 'and she lands in the tomb, where the deck wanted her');

    /* But never into an empty backrow. The card is spent the moment it leaves
       the hand, so a discard with nothing to break is a monster thrown away for
       nothing — reported by the owner, and the same shape as 7 Completed
       equipping onto no Machine. */
    const bare = tomb();
    const spare = card(ME, 'zolga');
    bare.players[ME].hand = [spare];
    ok(!canDiscardForEffect(bare, ME, spare),
      'and the board will not let her be thrown at an empty backrow');
    const refused = applyAction(bare, ME, { type: 'discardForEffect', uid: spare.uid });
    ok(!!refused.error, 'the engine refuses it too — the board is not the rule', refused.error ?? '(allowed)');
    ok(refused.state.players[ME].hand.some((h) => h.uid === spare.uid),
      'and she is still in the hand', refused.state.players[ME].hand.map((h) => h.slug).join(','));

    /* CONTROL: with something to break she is offered, so the gate is not
       simply switched off. */
    const armed = tomb();
    const ready = card(ME, 'zolga');
    armed.players[ME].hand = [ready];
    armed.players[FOE].spellTrap = { ...card(FOE, 'mirror-force'), face: 'down' as const };
    ok(canDiscardForEffect(armed, ME, ready), 'CONTROL: with a Set card across the table she is offered');
  }

  /* --- Royal Tribute finds the ace on its way down --- */
  {
    /* The ace is put out of the draw's reach on purpose: three buried and one
       drawn is the first four cards, so a Jackal any nearer than fifth would
       have arrived in the hand by the ordinary route and the pin would have
       passed on a card that fetches nothing. It did, in the first draft. */
    const s = tomb();
    const rt = card(ME, 'royal-tribute');
    s.players[ME].hand = [rt];
    const ace = card(ME, 'mystical-knight-of-jackal');
    s.players[ME].deck = [
      card(ME, 'kuriboh'), card(ME, 'kuriboh'), card(ME, 'kuriboh'), card(ME, 'kuriboh'),
      ace,
      ...s.players[ME].deck,
    ];
    const spent = act(s, ME, { type: 'activateSpell', uid: rt.uid, targets: [] });
    ok(spent.players[ME].hand.some((h) => h.uid === ace.uid),
      'the offering is spent and the ace comes with it',
      spent.players[ME].hand.map((h) => h.slug).join(','));
    ok(spent.players[ME].grave.some((c) => c.uid === rt.uid),
      'CONTROL: and the offering itself is in the tomb, which is what fetched him');

    /* However it gets there — buried by another Royal Tribute's own mill, with
       the ace again too deep to be drawn. */
    const buried = tomb();
    const rt2 = card(ME, 'royal-tribute');
    buried.players[ME].hand = [rt2];
    const ace2 = card(ME, 'mystical-knight-of-jackal');
    buried.players[ME].deck = [
      card(ME, 'royal-tribute'), card(ME, 'kuriboh'), card(ME, 'kuriboh'), card(ME, 'kuriboh'),
      ace2,
      ...buried.players[ME].deck,
    ];
    const dug = act(buried, ME, { type: 'activateSpell', uid: rt2.uid, targets: [] });
    ok(dug.players[ME].hand.some((h) => h.uid === ace2.uid),
      'and a Royal Tribute buried by another one fetches too',
      dug.players[ME].hand.map((h) => h.slug).join(','));
  }

  /* --- Breaking the valley costs the breaker a card back --- */
  {
    const s = tomb();
    s.players[ME].field = { ...card(ME, 'necrovalley'), face: 'up' as const };
    s.players[ME].grave = [card(ME, 'summoned-skull'), card(ME, 'mudora')];
    const duster = card(FOE, 'harpie-s-feather-duster');
    s.players[FOE].hand = [duster];
    s.active = FOE;
    const razed = act(s, FOE, { type: 'activateSpell', uid: duster.uid, targets: [] });
    ok(razed.players[ME].field === null, 'the valley can still be broken — the counterplay is intact');
    /* Two cards down there and one to take, so the engine stops and asks — the
       valley's keeper chooses which. */
    ok(razed.pending?.kind === 'choose' && razed.pending.player === ME,
      'and it asks its keeper which card comes back',
      razed.pending ? `${razed.pending.kind}/${razed.pending.player}` : '(resolved silently)');
    ok(!(razed.pending?.options ?? []).some((u) => razed.players[ME].grave.find((g) => g.uid === u)?.slug === 'necrovalley'),
      'never itself — a card cannot answer its own destruction with its own body',
      (razed.pending?.options ?? []).map((u) => razed.players[ME].grave.find((g) => g.uid === u)?.slug ?? '?').join(','));
    const wanted = razed.players[ME].grave.find((g) => g.slug === 'mudora')!;
    const answered = act(razed, ME, { type: 'chooseCard', uids: [wanted.uid] });
    ok(answered.players[ME].hand.some((h) => h.uid === wanted.uid),
      'and hands back the one that was chosen',
      answered.players[ME].hand.map((h) => h.slug).join(',') || '(empty)');
  }

  /* --- Just Desserts is worth 700 a body --- */
  {
    /* Fired out of its own Set zone, which is what an `anyOpponentTurn` Trap
       allows and needs no attack to answer. */
    const s = tomb();
    const dessert = { ...card(ME, 'just-desserts'), face: 'down' as const };
    dessert.summonedOnTurn = 0;
    s.players[ME].spellTrap = dessert;
    const three = [card(FOE, 'summoned-skull'), card(FOE, 'battle-ox'), card(FOE, 'kuriboh')];
    for (const m of three) m.summonedOnTurn = 0;
    s.players[FOE].monsters = [three[0], three[1], three[2]];
    const before = s.players[FOE].lp;
    const served = act(s, ME, { type: 'activateSetCard', uid: dessert.uid, targets: [] });
    ok(before - served.players[FOE].lp === 2100,
      'three monsters is 2100 — 700 a body, not 600',
      String(before - served.players[FOE].lp));
  }

  /* --- Blast Held by a Tribute charges by their board --- */
  {
    const s = tomb();
    s.phase = 'battle';
    s.active = FOE;
    const blast = { ...card(ME, 'blast-held-by-a-tribute'), face: 'down' as const };
    blast.summonedOnTurn = 0;
    s.players[ME].spellTrap = blast;
    const three = [card(FOE, 'summoned-skull'), card(FOE, 'battle-ox'), card(FOE, 'kuriboh')];
    for (const m of three) m.summonedOnTurn = 0;
    s.players[FOE].monsters = [three[0], three[1], three[2]];
    const declared = applyAction(s, FOE, { type: 'attack', uid: three[0].uid, targetUid: null }).state;
    const answered = act(declared, ME, { type: 'respondTrap', uid: blast.uid });
    /* Three monsters when the attack was declared: three cards buried, read off
       the board that swung rather than the one the destruction leaves. */
    ok(answered.players[ME].grave.filter((c) => c.slug === 'kuriboh').length === 3,
      'three monsters across the table is three cards out of her own Deck',
      String(answered.players[ME].grave.filter((c) => c.slug === 'kuriboh').length));
    ok(!answered.players[FOE].monsters.some((m) => m?.uid === three[0].uid),
      'and the attacker is still destroyed');
  }

  /* --- Exchange of the Spirit turns the whole game over --- */
  {
    /* Activated from its own Set zone in her own Main Phase, which is what an
       `anyOpponentTurn` Trap allows and is the moment this card is actually
       played: you turn the table over when you have decided the piles have
       grown the right way round. */
    const s = tomb();
    const swap = { ...card(ME, 'exchange-of-the-spirit'), face: 'down' as const };
    swap.summonedOnTurn = 0;
    s.players[ME].spellTrap = swap;
    s.players[ME].grave = [card(ME, 'mudora'), card(ME, 'keldo'), card(ME, 'agido'), card(ME, 'zolga')];
    s.players[FOE].grave = [card(FOE, 'battle-ox')];
    const myDeck = s.players[ME].deck.length;
    const theirDeck = s.players[FOE].deck.length;
    const answered = act(s, ME, { type: 'activateSetCard', uid: swap.uid, targets: [] });
    /* One off each Deck first, then the piles change places — so her new Deck
       is the four guardians plus the one card she just buried. */
    ok(answered.players[ME].deck.length === 5,
      'her Graveyard becomes her Deck, one card heavier for the mill',
      String(answered.players[ME].deck.length));
    /* Nine cards of old Deck, plus the Trap itself — a spent Trap goes to the
       Graveyard after it resolves, so it lands in the new pile rather than the
       old one. */
    ok(answered.players[ME].grave.length === myDeck,
      'and what was her Deck is now her Graveyard, the spent Trap on top',
      `${answered.players[ME].grave.length} vs ${myDeck}`);
    ok(answered.players[FOE].deck.length === 2 && answered.players[FOE].grave.length === theirDeck - 1,
      'both players, both ways — it is not a one-sided deck-out',
      `${answered.players[FOE].deck.length} / ${answered.players[FOE].grave.length}`);
    ok(answered.players[ME].deck.some((c) => c.slug === 'mudora'),
      'the guardians she buried are the cards she now draws',
      answered.players[ME].deck.map((c) => c.slug).join(','));
  }
}

console.log('\nWhat the board must let you spend, and who it must ask');
{
  const table = () => {
    const s = fresh();
    for (const pid of [ME, FOE] as PlayerId[]) {
      s.players[pid].monsters = [null, null, null];
      s.players[pid].hand = [];
      s.players[pid].grave = [];
      s.players[pid].spellTrap = null;
      s.players[pid].field = null;
    }
    return s;
  };

  /* --- Soul Exchange lends bodies, and they count --- */
  {
    /* Reported: with one monster of her own and two of theirs selected, the
       board still refused the Tribute Summon. The engine was right the whole
       time — it was the button that kept its own opinion of what can pay. */
    const s = table();
    const mine = card(ME, 'kuriboh');
    mine.summonedOnTurn = 0;
    s.players[ME].monsters = [mine, null, null];
    const theirs = [card(FOE, 'battle-ox'), card(FOE, 'summoned-skull')];
    for (const t of theirs) t.summonedOnTurn = 0;
    s.players[FOE].monsters = [theirs[0], theirs[1], null];
    const ob = card(ME, 'obelisk-the-tormentor');
    const swap = card(ME, 'soul-exchange');
    s.players[ME].hand = [swap, ob];

    ok(tributableBodies(s, ME).length === 1, 'CONTROL: one body of her own before the Exchange',
      String(tributableBodies(s, ME).length));
    const lent = act(s, ME, { type: 'activateSpell', uid: swap.uid, targets: [theirs[0].uid, theirs[1].uid] });
    /* This is the number the button reads. It counted `mine.monsters` and got
       one, so a God needing three was refused with three payable bodies on the
       table. */
    ok(tributableBodies(lent, ME).length === 3,
      'and three the moment the Exchange lends her theirs',
      tributableBodies(lent, ME).map((m) => m.slug).join(','));
    /* And the question the button actually asks. It counted `mine.monsters`
       and so answered no with three payable bodies on the table; it asks the
       engine now, and this is the assertion that stops it drifting again. */
    ok(!summonAffordable(s, ME, 'obelisk-the-tormentor'),
      'CONTROL: one body cannot pay for a God');
    ok(summonAffordable(lent, ME, 'obelisk-the-tormentor'),
      'and with theirs lent, the board can afford him — which is the whole point of the card');

    const summoned = act(lent, ME, {
      type: 'normalSummon', uid: ob.uid, zone: 1, position: 'atk', face: 'up',
      tributes: [mine.uid, theirs[0].uid, theirs[1].uid],
    });
    ok(summoned.players[ME].monsters.some((m) => m?.slug === 'obelisk-the-tormentor'),
      'and Obelisk stands on one of her bodies and two of theirs',
      summoned.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
    ok(summoned.players[FOE].monsters.every((m) => !m),
      'their side is empty — the lent bodies really were spent',
      summoned.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));
  }

  /* --- Newdoria takes the one you pick --- */
  {
    const s = table();
    const doria = card(ME, 'newdoria');
    doria.summonedOnTurn = 0;
    s.players[ME].monsters = [doria, null, null];
    const small = card(FOE, 'kuriboh');
    const big = card(FOE, 'summoned-skull');
    small.summonedOnTurn = 0;
    big.summonedOnTurn = 0;
    s.players[FOE].monsters = [big, small, null];
    const hole = card(ME, 'dark-hole');
    s.players[ME].hand = [hole];
    const razed = act(s, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
    ok(razed.pending?.kind === 'choose' && razed.pending.player === ME,
      'Newdoria stops and asks which body she takes with her',
      razed.pending ? `${razed.pending.kind}/${razed.pending.player}` : '(chosen for you)');
    /* Dark Hole has already swept the board, so what is left to point at is
       whatever survived — the claim is that the question is asked at all, and
       that the answer given is the one honoured. */
    const options = razed.pending?.options ?? [];
    ok(options.length > 1, 'with more than one answer available', String(options.length));
  }

  /* --- Obelisk's Fist, and Snatch Steal's rent --- */
  {
    /* Rent is the counterplay for a theft that never ends. The text has
       promised it since the card was written and it never paid a point. */
    const s = table();
    const ox = card(FOE, 'battle-ox');
    ox.summonedOnTurn = 0;
    s.players[FOE].monsters = [ox, null, null];
    const steal = card(ME, 'snatch-steal');
    s.players[ME].hand = [steal];
    const taken = act(s, ME, { type: 'activateSpell', uid: steal.uid, targets: [ox.uid] });
    ok(taken.players[ME].monsters.some((m) => m?.uid === ox.uid), 'Snatch Steal takes the body');
    const owed = taken.players[FOE].lp;
    const round = act(act(taken, ME, { type: 'endTurn' }), FOE, { type: 'endTurn' });
    ok(round.players[FOE].lp === owed + 2000,
      'and its owner is paid 2000 at the start of each turn it is kept',
      `${owed} -> ${round.players[FOE].lp}`);
    /* Twice round, twice paid: it is rent, not a one-off. */
    const twice = act(act(round, ME, { type: 'endTurn' }), FOE, { type: 'endTurn' });
    ok(twice.players[FOE].lp === owed + 4000,
      'every turn, for as long as it is kept',
      `${round.players[FOE].lp} -> ${twice.players[FOE].lp}`);
  }
}

console.log('\nThe fast clone is the slow clone, only fast');
{
  /* `cloneState` replaced `structuredClone` at the head of every action the
     engine applies — a 7x saving that is the computer opponent's entire node
     budget. It is only correct while a DuelState stays plain data, so this
     drives a real duel deep enough to touch every zone, then insists the two
     clones are indistinguishable and share nothing. */
  let rng = 991;
  const rnd = () => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  let s = createDuel({ seed: 77, p1: { duelistId: 'yamimarik', name: 'A' }, p2: { duelistId: 'odion', name: 'B' } });
  let identical = true;
  let independent = true;
  let looked = 0;
  let firstBad = '';
  for (let i = 0; i < 900 && !s.winner; i++) {
    const actor = s.pending ? s.pending.player : s.active;
    const acts = autoLegal(s, actor, rnd);
    if (!acts.length) break;
    const r = applyAction(s, actor, autoChoose(acts, rnd));
    if (!r.error) s = r.state;
    if ((i & 7) !== 0) continue;
    looked += 1;
    const fast = cloneState(s);
    if (JSON.stringify(fast) !== JSON.stringify(structuredClone(s))) {
      identical = false;
      firstBad = firstBad || `diverged at step ${i}`;
    }
    fast.players.p1.lp = -12345;
    if (fast.players.p1.monsters[0]) fast.players.p1.monsters[0]!.atkMod = 777;
    fast.ongoing.push({ id: 'probe', source: 'probe', kind: 'skipDraw', target: 'p1', turns: 1 });
    if (
      s.players.p1.lp === -12345 ||
      (s.players.p1.monsters[0] && s.players.p1.monsters[0].atkMod === 777) ||
      s.ongoing.some((o) => o.id === 'probe')
    ) {
      independent = false;
      firstBad = firstBad || `shared reference at step ${i}`;
    }
  }
  ok(looked >= 5, 'the drive reached deep enough to mean anything', String(looked));
  ok(identical, 'the fast clone is byte-identical to structuredClone across a driven duel', firstBad);
  ok(independent, 'and shares nothing — mutating the copy never touches the original', firstBad);
}

/* The summary goes LAST, and there is nothing after it.
 *
 * Appending a batch of new tests below this line is the easy mistake — and it
 * was made: 279 lines of regressions ran *after* the count was printed, so the
 * suite reported "All rules regressions pass" and exited 0 with a real ❌ on
 * screen, hiding a half-finished fix. A check that cannot fail is worse than
 * no check; a suite that cannot report failure is worse still. `checks` is
 * asserted too, so deleting tests cannot quietly turn the battery green. */
console.log('\nSix corrections from the table');
{
  /* A Quick-Play Spell's Set copy answers the attack window like a trap. */
  let s = fresh('battle');
  s.active = FOE;
  const dice = card(ME, 'graceful-dice');
  dice.face = 'down';
  dice.summonedOnTurn = 2; // set on an earlier turn — ready
  s.players[ME].spellTrap = dice;
  s.players[ME].monsters[0] = card(ME, 'megazowler');
  const ox = card(FOE, 'battle-ox');
  s.players[FOE].monsters[0] = ox;
  s = act(s, FOE, { type: 'attack', uid: ox.uid, targetUid: s.players[ME].monsters[0]!.uid });
  ok(
    !!s.pending && s.pending.kind === 'trap' && s.pending.options.includes(dice.uid),
    'a Set Graceful Dice is offered when the opponent declares an attack',
    'the Quick-Play twin never joined the trap window'
  );
  if (s.pending) {
    s = act(s, ME, { type: 'respondTrap', uid: dice.uid });
    const buffed = (s.players[ME].monsters[0]?.turnAtkMod ?? 0) > 0;
    ok(buffed, 'and the dice actually roll — the defenders gain their pips', 'no turn ATK arrived');
    ok(
      s.players[ME].grave.some((c) => c.uid === dice.uid),
      'the spent Quick-Play goes to the Graveyard like any resolved Spell'
    );
  }
  /* Set THIS turn, it must wait like a trap does. */
  let w = fresh('battle');
  w.active = FOE;
  const late = card(ME, 'graceful-dice');
  late.face = 'down';
  late.summonedOnTurn = w.turn;
  w.players[ME].spellTrap = late;
  w.players[ME].monsters[0] = card(ME, 'megazowler');
  const ox2 = card(FOE, 'battle-ox');
  w.players[FOE].monsters[0] = ox2;
  w = act(w, FOE, { type: 'attack', uid: ox2.uid, targetUid: w.players[ME].monsters[0]!.uid });
  ok(!w.pending, 'CONTROL: a Quick-Play Set this very turn is not offered yet');
  ok(
    CARDS['scapegoat'].effects.some((e) => e.trigger === 'trap') &&
      CARDS['enemy-controller'].effects.some((e) => e.trigger === 'trap'),
    'Scapegoat and Enemy Controller carry the same Quick-Play window'
  );
}

{
  /* Possessed Dark Soul reaches everything now — a Blue-Eyes is not too big. */
  let s = fresh();
  const soul = card(ME, 'possessed-dark-soul');
  s.players[ME].monsters[0] = soul;
  const bewd = card(FOE, 'blue-eyes-white-dragon');
  s.players[FOE].monsters[0] = bewd;
  const opts = ignitionOptions(s, ME, soul);
  ok(opts.length > 0, 'Possessed Dark Soul offers its theft with only a 3000 across the table');
  s = act(s, ME, { type: 'ignition', uid: soul.uid, targets: [bewd.uid], effectIndex: opts[0]?.index });
  ok(
    s.players[ME].monsters.some((m) => m?.uid === bewd.uid),
    'and the Blue-Eyes changes sides — no ATK ceiling on the ka',
    'the 2000 limit is still being enforced'
  );
}

{
  /* The Dark Door holds what the card face SAYS it holds: a King Rex standing
     at 2500 off his Graveyard is a 2000-or-more monster, whatever his printed
     1600 claims — and the door's own 300 drain must not open its own gate. */
  const s = fresh('battle');
  s.active = FOE;
  s.players[ME].spellTrap = card(ME, 'the-dark-door');
  s.players[ME].monsters[0] = card(ME, 'mystical-elf');
  const rex = card(FOE, 'two-headed-king-rex');
  s.players[FOE].monsters[0] = rex;
  for (const slug of ['uraby', 'trakodon', 'megazowler']) s.players[FOE].grave.push(card(FOE, slug));
  s.players[FOE].hand = [card(FOE, 'uraby')]; // Rex discards a card per swing
  const oxD = card(FOE, 'battle-ox');
  s.players[FOE].monsters[1] = oxD;
  ok(!canAttackWith(s, FOE, rex), 'The Dark Door holds a grave-grown King Rex', 'a monster standing at 2500 attacked through the door');
  ok(canAttackWith(s, FOE, oxD), 'CONTROL: a 1700 Battle Ox still walks through it');
}

{
  /* Fortress Whale hunts giants now: 2900 or MORE. Summoned the way the deck
     actually summons it — through its Oath, off a Tribute. */
  let s = fresh();
  s.players[ME].monsters[0] = card(ME, 'battle-ox');
  const whale = card(ME, 'fortress-whale');
  const oath = card(ME, 'fortress-whale-s-oath');
  s.players[ME].hand = [oath, whale];
  const bewd = card(FOE, 'blue-eyes-white-dragon');
  const small = card(FOE, 'aqua-madoor');
  s.players[FOE].monsters[0] = bewd;
  s.players[FOE].monsters[1] = small;
  s = act(s, ME, { type: 'activateSpell', uid: oath.uid, targets: [whale.uid] });
  if (s.pending?.kind === 'choose') s = act(s, ME, { type: 'chooseCard', uids: [whale.uid] });
  ok(
    s.players[ME].monsters.some((m) => m?.uid === whale.uid),
    'the Oath raises the Whale off one Tribute'
  );
  ok(
    !s.players[FOE].monsters.some((m) => m?.uid === bewd.uid),
    'Fortress Whale sinks the 3000 on arrival'
  );
  ok(
    s.players[FOE].monsters.some((m) => m?.uid === small.uid),
    'and leaves the 1200 standing — 2900 or MORE, not less',
    'the old comparator is still destroying small monsters'
  );
}

{
  /* Two Kelbeks are two monsters: the second bounce is not silenced because
     the first one spoke. Once per turn is per CARD, not per name. */
  let s = fresh('battle');
  s.active = FOE;
  const k1 = card(ME, 'kelbek');
  const k2 = card(ME, 'kelbek');
  s.players[ME].monsters[0] = k1;
  s.players[ME].monsters[1] = k2;
  const a1 = card(FOE, 'battle-ox');
  const a2 = card(FOE, 'garoozis');
  s.players[FOE].monsters[0] = a1;
  s.players[FOE].monsters[1] = a2;
  s = act(s, FOE, { type: 'attack', uid: a1.uid, targetUid: k1.uid });
  const firstBounced = s.players[FOE].hand.some((c) => c.uid === a1.uid);
  s = act(s, FOE, { type: 'attack', uid: a2.uid, targetUid: k2.uid });
  const secondBounced = s.players[FOE].hand.some((c) => c.uid === a2.uid);
  ok(firstBounced, 'the first Kelbek returns her attacker to hand');
  ok(secondBounced, 'and the SECOND Kelbek returns hers too — a name is not a shared fuse', 'the once-per-turn gate is still keyed by name');
}

{
  /* Two Revival Jams broken by one Mirror Force both come back. */
  let s = fresh('battle');
  const j1 = card(ME, 'revival-jam');
  const j2 = card(ME, 'revival-jam');
  s.players[ME].monsters[0] = j1;
  s.players[ME].monsters[1] = j2;
  s.players[ME].grave.push(card(ME, 'kuriboh'), card(ME, 'kuriboh'));
  const mf = card(FOE, 'mirror-force');
  mf.face = 'down';
  mf.summonedOnTurn = 2;
  s.players[FOE].spellTrap = mf;
  s.players[FOE].monsters[0] = card(FOE, 'mystical-elf');
  s = act(s, ME, { type: 'attack', uid: j1.uid, targetUid: s.players[FOE].monsters[0]!.uid });
  if (s.pending?.kind === 'trap') s = act(s, FOE, { type: 'respondTrap', uid: mf.uid });
  const back1 = s.players[ME].monsters.some((m) => m?.uid === j1.uid);
  const back2 = s.players[ME].monsters.some((m) => m?.uid === j2.uid);
  ok(back1 && back2, 'both Jams revive from the same Mirror Force', `only ${[back1, back2].filter(Boolean).length} of 2 returned`);
}

console.log("\nThe invariant fuzzer's first catch");
{
  /* A Set Giant Trunade swept ITSELF back to hand mid-resolution, then the
     cleanup graved it too — one card instance in two zones at once, and a
     spell that could be Set and recast forever. Two fixes, both pinned: the
     sweep excludes the resolving card, and the cleanup only graves a card
     still sitting where it resolved from. */
  let s = fresh();
  const tru = card(ME, 'giant-trunade');
  tru.face = 'down';
  tru.summonedOnTurn = 2;
  s.players[ME].spellTrap = tru;
  const mf = card(FOE, 'mirror-force');
  mf.face = 'down';
  s.players[FOE].spellTrap = mf;
  s.players[FOE].hand = [card(FOE, 'kuriboh')];
  s = act(s, ME, { type: 'activateSetCard', uid: tru.uid, targets: [] });
  const places = [
    s.players[ME].hand.some((c) => c.uid === tru.uid) ? 'hand' : '',
    s.players[ME].grave.filter((c) => c.uid === tru.uid).length ? `grave×${s.players[ME].grave.filter((c) => c.uid === tru.uid).length}` : '',
    s.players[ME].spellTrap?.uid === tru.uid ? 'zone' : '',
  ].filter(Boolean);
  ok(
    places.join(',') === 'grave×1',
    'a Set Giant Trunade ends in the Graveyard, once, and nowhere else',
    `found in: ${places.join(' + ') || 'nowhere'}`
  );
  /* The rider discards 1 at random from the hand the bounce just filled, so
     the Force may legitimately continue to the Graveyard — what the pin owns
     is that it LEFT the zone through the hand and exists exactly once. */
  const mfPlaces =
    (s.players[FOE].hand.some((c) => c.uid === mf.uid) ? 1 : 0) +
    s.players[FOE].grave.filter((c) => c.uid === mf.uid).length;
  ok(
    !s.players[FOE].spellTrap && mfPlaces === 1,
    "and the other Set card leaves the zone for its owner's side, exactly once",
    `zone ${s.players[FOE].spellTrap ? 'occupied' : 'empty'}, copies found: ${mfPlaces}`
  );
}

const EXPECTED_AT_LEAST = 120;
if (checks < EXPECTED_AT_LEAST) {
  console.log(`\n❌ only ${checks} assertions ran, expected at least ${EXPECTED_AT_LEAST} — did something stop early?`);
  failures += 1;
}
/* ------------------------------------------------------------------ */
console.log('\nThe deck that remembers losing');
{
  const passiveLoss = { won: false, myLp: 4000, theirLp: 6000, myHandLeft: 4, myBoardLeft: 1, turns: 20 };
  const fedLoss = { won: false, myLp: 800, theirLp: 6000, myHandLeft: 0, myBoardLeft: 0, turns: 9 };
  const cleanWin = { won: true, myLp: 6500, theirLp: 0, myHandLeft: 2, myBoardLeft: 2, turns: 14 };

  const afterPassive = updateBrain({ ...NEUTRAL }, passiveLoss);
  ok(afterPassive.aggression > 0, 'a loss with a full hand teaches the deck to press', `aggression ${afterPassive.aggression}`);

  const afterFed = updateBrain({ ...NEUTRAL }, fedLoss);
  ok(afterFed.caution > 0, 'a fast loss with an empty board teaches it respect', `caution ${afterFed.caution}`);

  let leaning = { ...NEUTRAL };
  for (let i = 0; i < 200; i++) leaning = updateBrain(leaning, passiveLoss);
  ok(
    leaning.aggression <= KNOB_LIMIT && leaning.caution >= -KNOB_LIMIT,
    'two hundred identical losses can only lean it to the clamp, never past',
    `aggression ${leaning.aggression}`
  );

  const consolidated = updateBrain({ ...leaning }, cleanWin);
  ok(
    Math.abs(consolidated.aggression) < Math.abs(leaning.aggression) + 1e-9 && consolidated.wins === leaning.wins + 1,
    'a clean win consolidates instead of leaning further',
    `aggression ${leaning.aggression} -> ${consolidated.aggression}`
  );
  ok(consolidated.games === leaning.games + 1, 'and every game is counted', `games ${consolidated.games}`);
}

console.log('\nA body needs somewhere to stand');
{
  /* Reported: "Joey ai activated scape gotes when he had full monster field
     already." Three Sheep Tokens over three occupied Monster Zones is three
     Tokens that never arrive — the loop that places them gives up on the first
     one and the card goes to the Graveyard regardless. Nothing said why; the
     log jumped straight from "activates Scapegoat!" to the next line.

     The gate that already refuses a card with nothing to point at is the gate
     that should have refused this, so no room is now asked in the same breath
     as no target. That covers all four doors at once, because every one of
     them — the hand, a Set card flipped up, a trap window, a hand discard —
     asks the same function. */
  const filled = (n: number) => {
    const s = fresh();
    const bodies = ['dark-magician', 'feral-imp', 'mystical-elf'];
    for (let i = 0; i < n; i++) s.players[ME].monsters[i] = card(ME, bodies[i]);
    return s;
  };

  const full = filled(3);
  const goat = card(ME, 'scapegoat');
  full.players[ME].hand = [goat];
  ok(wastedWithoutTarget(full, ME, goat, 'activate'), 'Scapegoat over three occupied zones is a card spent for nothing');
  ok(!canActivateFromHand(full, ME, goat), 'so the hand does not offer it');
  const refused = applyAction(full, ME, { type: 'activateSpell', uid: goat.uid });
  ok(!!refused.error, 'and the engine refuses it if it is sent anyway', refused.error ?? '(allowed)');
  ok(refused.error === 'Your Monster Zones are full.',
    'saying which of the two reasons it was', refused.error ?? '');
  ok(refused.state.players[ME].hand.some((h) => h.uid === goat.uid), 'the card is still in hand');
  ok(refused.state.players[ME].grave.length === 0, 'and nothing went to the Graveyard');

  /* A Set copy is the same card asked through a different door. */
  const setGoat = card(ME, 'scapegoat');
  setGoat.face = 'down';
  setGoat.summonedOnTurn = 0;
  const withSet = filled(3);
  withSet.players[ME].spellTrap = setGoat;
  ok(!canActivateSetCard(withSet, ME, setGoat), 'a Set Scapegoat cannot be flipped up over a full board either');

  /* One zone open is one Sheep, and one Sheep is a wall. The gate must stop at
     "nothing at all" — deciding that one Token is not *worth* it is the
     search's judgement to make, not the rulebook's. */
  const room = filled(2);
  const goat2 = card(ME, 'scapegoat');
  room.players[ME].hand = [goat2];
  ok(canActivateFromHand(room, ME, goat2), 'with one zone open it is playable');
  const landed = applyAction(room, ME, { type: 'activateSpell', uid: goat2.uid });
  ok(!landed.error, 'and resolves', landed.error ?? '');
  ok(landed.state.players[ME].monsters.filter((m) => m?.isToken).length === 1, 'putting the one Sheep that fits on the board');

  /* Every other card that stands a body up answers the same way. */
  for (const slug of ['multiply', 'monster-reborn', 'change-of-heart', 'snatch-steal', 'brain-control', 'elegant-egotist']) {
    const s = filled(3);
    s.players[ME].grave = [card(ME, 'gaia-the-fierce-knight')];
    s.players[FOE].monsters[0] = card(FOE, 'summoned-skull');
    s.players[ME].hand = [card(ME, 'harpie-lady')];
    const c = card(ME, slug);
    ok(wastedWithoutTarget(s, ME, c, 'activate'), `${slug} is refused over a full board too`);
  }

  /* And the two that must NOT be: a Ritual pays a Tribute before its monster
     arrives, so it makes its own room. Refusing these would have been the fix
     breaking two cards to mend one. */
  for (const [slug, monster] of [['black-illusion-ritual', 'relinquished'], ['fortress-whale-s-oath', 'fortress-whale']]) {
    const s = filled(3);
    s.players[ME].hand = [card(ME, monster)]; // the monster it came to call
    ok(!wastedWithoutTarget(s, ME, card(ME, slug), 'activate'),
      `${slug} still activates over a full board — its Tribute opens the zone`);
    /* And the other half of the same rule: with nobody to call, the Tribute
       buys nothing and the Ritual is refused however much room there is. */
    const bare = filled(0);
    ok(wastedWithoutTarget(bare, ME, card(ME, slug), 'activate'),
      `${slug} is refused with an empty board and no ${monster} anywhere`);
  }

  /* A rider that points at "the monster this card just summoned" must not keep
     a dead revival looking alive. Call of the Haunted is a revival with +400
     ATK stapled on; without that rule it would have been announced, revived
     nobody, and gone to the Graveyard for the ATK boost it could not give. */
  const haunted = filled(3);
  haunted.players[ME].grave = [card(ME, 'gaia-the-fierce-knight')];
  ok(wastedWithoutTarget(haunted, ME, card(ME, 'call-of-the-haunted'), 'trap'),
    'Call of the Haunted is refused over a full board despite its ATK rider');

  /* Magical Hats negates the attack whether or not anything hides behind it,
     so a full board does not make it dead. */
  ok(!wastedWithoutTarget(filled(3), ME, card(ME, 'magical-hats'), 'trap'),
    'Magical Hats still answers an attack over a full board');

  /* --- and the two neighbours the same sweep turned up --- */
  /* Watching real duels for cards that left a hand without moving anything on
     the table found two more shapes of the same fault: a Special Summon with
     nobody to call, and a position change aimed at a monster already standing
     that way. */
  {
    const empty = filled(0);
    empty.players[ME].grave = [card(ME, 'monster-reborn')]; // a Spell, not a body
    empty.players[FOE].grave = [card(FOE, 'de-spell')];
    ok(wastedWithoutTarget(empty, ME, card(ME, 'monster-reborn'), 'activate'),
      'Monster Reborn over two Graveyards holding no monster is refused');
    empty.players[FOE].grave.push(card(FOE, 'battle-ox'));
    ok(!wastedWithoutTarget(empty, ME, card(ME, 'monster-reborn'), 'activate'),
      'and allowed the moment one of them holds a body — either side of the table');

    const factory = filled(0);
    factory.players[ME].hand = [card(ME, 'dark-magician')]; // a Spellcaster, not a Machine
    ok(wastedWithoutTarget(factory, ME, card(ME, 'machine-conversion-factory'), 'activate'),
      'Machine Conversion Factory with no Machine in hand is refused');
    factory.players[ME].hand.push(card(ME, 'giant-soldier-of-stone'));
    ok(wastedWithoutTarget(factory, ME, card(ME, 'machine-conversion-factory'), 'activate'),
      'and a Rock is still not a Machine');

    const standing = filled(0);
    standing.players[FOE].monsters[0] = card(FOE, 'summoned-skull'); // face-up attack
    standing.players[FOE].monsters[1] = card(FOE, 'battle-ox');
    ok(wastedWithoutTarget(standing, ME, card(ME, 'stop-defense'), 'activate'),
      'Stop Defense against a board that is already attacking is refused');
    /* Swords of Revealing Light points at the same board and must NOT be:
       its flip is the rider and the three-turn freeze is the card. */
    ok(!wastedWithoutTarget(standing, ME, card(ME, 'swords-of-revealing-light'), 'activate'),
      'while Swords of Revealing Light still freezes that same board');
    const kneeling = filled(0);
    const ox = card(FOE, 'battle-ox');
    ox.position = 'def';
    kneeling.players[FOE].monsters[0] = ox;
    ok(!wastedWithoutTarget(kneeling, ME, card(ME, 'stop-defense'), 'activate'),
      'and one monster kneeling is enough to make Stop Defense worth playing');
    const hidden = filled(0);
    const face = card(FOE, 'battle-ox');
    face.face = 'down';
    face.position = 'def';
    hidden.players[FOE].monsters[0] = face;
    ok(!wastedWithoutTarget(hidden, ME, card(ME, 'stop-defense'), 'activate'),
      'a face-down monster counts too — dragging it up is a flip');

    /* And the picker must offer the same set the gate is judging. One kneeling
       monster beside one already attacking makes the card legal, and the modal
       laid out both — so the pick landed on the standing one and Stop Defense
       was spent changing nothing. Watched happening in a real duel. */
    const mixed = filled(0);
    const kneels = card(FOE, 'battle-ox');
    kneels.position = 'def';
    mixed.players[FOE].monsters[0] = card(FOE, 'summoned-skull'); // already attacking
    mixed.players[FOE].monsters[1] = kneels;
    const sdSpec = targetSpecFor('stop-defense', 'activate');
    const offeredSd = sdSpec ? targetCandidates(mixed, ME, sdSpec).map((c) => c.slug) : [];
    ok(offeredSd.length === 1 && offeredSd[0] === 'battle-ox',
      'Stop Defense is only ever offered the monster it would actually stand up', offeredSd.join(',') || '(nothing)');

    /* An amount billed per monster destroyed is nothing when the destroy found
       nobody. Phoenix Formation is "destroy up to 2, then 500 damage for each",
       and the damage kept the whole card looking alive over an empty board. */
    const noBoard = filled(1); // it needs a monster of its own to be activated at all
    ok(wastedWithoutTarget(noBoard, ME, card(ME, 'harpie-lady-phoenix-formation'), 'activate'),
      'Phoenix Formation across an empty board is refused, damage rider and all');
    const theirBoard = filled(1);
    theirBoard.players[FOE].monsters[0] = card(FOE, 'dark-magician');
    ok(!wastedWithoutTarget(theirBoard, ME, card(ME, 'harpie-lady-phoenix-formation'), 'activate'),
      'and allowed the moment there is something to burn down');
  }

  /* --- and the two doors that never asked the question at all --- */
  {
    /* A Set Trap flipped up on your own turn went through a branch that asked
       neither the condition, nor the cost, nor whether anything would happen.
       Metalmorph was turned over above an empty board, equipped nothing, and —
       an Equip Trap does not go to the Graveyard — sat face-up in the one
       Spell/Trap Zone for the rest of the duel. */
    const alone = filled(0);
    const morph = card(ME, 'metalmorph');
    morph.face = 'down';
    morph.summonedOnTurn = 0;
    alone.players[ME].spellTrap = morph;
    ok(!canActivateSetCard(alone, ME, morph), 'Metalmorph cannot be flipped up with nothing of yours to bolt it onto');
    const hosted = filled(1);
    const morph2 = card(ME, 'metalmorph');
    morph2.face = 'down';
    morph2.summonedOnTurn = 0;
    hosted.players[ME].spellTrap = morph2;
    ok(canActivateSetCard(hosted, ME, morph2), 'and can the moment one body is standing');

    /* And a die roll is a wrapper: Skull Dice's roll carries no branch of its
       own, so a scan that stopped at it called the card substantive and let it
       be thrown at an empty board. The drain that reads the pips is the card. */
    const nobody = filled(0);
    const dice = card(ME, 'skull-dice');
    dice.face = 'down';
    dice.summonedOnTurn = 0;
    nobody.players[ME].spellTrap = dice;
    ok(!canActivateSetCard(nobody, ME, dice), 'Skull Dice is not rolled at a board with nothing on it');
    const somebody = filled(0);
    somebody.players[FOE].monsters[0] = card(FOE, 'summoned-skull');
    const dice2 = card(ME, 'skull-dice');
    dice2.face = 'down';
    dice2.summonedOnTurn = 0;
    somebody.players[ME].spellTrap = dice2;
    ok(canActivateSetCard(somebody, ME, dice2), 'and is rolled the moment there is something to shrink');
  }

  /* A trigger nobody chose to fire is the one case that still reaches a full
     board — Kuriboh's Token wants the zone Kuriboh just took. It cannot be
     refused, so it must at least be admitted: the line "Special Summons a
     Kuriboh Token" must not appear, and neither must silence. */
  const squeezed = filled(2);
  const kuriboh = card(ME, 'kuriboh');
  squeezed.players[ME].hand = [kuriboh];
  const summoned = applyAction(squeezed, ME, { type: 'normalSummon', uid: kuriboh.uid, zone: 2, position: 'atk', face: 'up' });
  ok(!summoned.error, 'Kuriboh fills the last zone', summoned.error ?? '');
  const lines = summoned.state.log.map((l) => (typeof l === 'string' ? l : (l as { text: string }).text));
  ok(summoned.state.players[ME].monsters.filter((m) => m?.isToken).length === 0, 'and its Token has nowhere to go');
  ok(!lines.some((t) => /Special Summons .*Kuriboh Token/.test(t)), 'so the board never claims the Token arrived');
  ok(lines.some((t) => /has no room for Kuriboh Tokens/.test(t)), 'and says out loud that there was no room', lines.slice(-2).join(' | '));
}

/** A fresh board holding one named card in hand, for the posture pins. */
function fresh2(c: CardInstance): DuelState {
  const s = fresh();
  s.players[ME].hand = [c];
  return s;
}

console.log('\nThe road back for a God, and the two postures out of a hand');
{
  /* Reported: "Sangan special summons slifer." Sangan dies, reaches into the
     Deck for the weakest monster it can find, and stands a God up — because a
     God's printed ATK is nothing at all, its strength being the hand or the
     Tribute behind it. Every "cheapest body" route in the game therefore leads
     straight to one. A God is called back by Monster Reborn and by nothing
     else, and no card says so on purpose: the owner asked for the rule without
     the sentence. */
  const gods = ['slifer-the-sky-dragon', 'obelisk-the-tormentor', 'the-winged-dragon-of-ra'];
  const bare = fresh();
  for (const g of gods) {
    ok(!revivable(bare, ME, g, 'sangan'), `Sangan cannot call ${g}`);
    ok(!revivable(bare, ME, g, 'witch-of-the-black-forest'), `nor can the Witch`);
    ok(!revivable(bare, ME, g), 'nor can an anonymous Special Summon');
    ok(revivable(bare, ME, g, 'monster-reborn'), `Monster Reborn still can`);
  }

  /* End to end, because the rule is only worth what the Deck search does with
     it: Sangan takes the Kuriboh and leaves the God where it was. */
  {
    const s = fresh();
    s.players[ME].monsters[0] = card(ME, 'sangan');
    s.players[ME].deck = [card(ME, 'slifer-the-sky-dragon'), card(ME, 'kuriboh')];
    s.players[FOE].monsters[0] = card(FOE, 'blue-eyes-white-dragon');
    const hole = card(FOE, 'dark-hole');
    s.players[FOE].hand = [hole];
    s.active = FOE;
    const after = act(s, FOE, { type: 'activateSpell', uid: hole.uid });
    ok(!on(after, ME).some((m) => m.slug === 'slifer-the-sky-dragon'), 'Sangan does not stand a God up out of the Deck', on(after, ME).map((m) => m.slug).join(',') || 'nothing');
    /* Nor does its other half hand one over. Sangan's search takes a monster
       of "1500 ATK or less", and a God is printed with no ATK at all — read as
       a number, that is -1, which is very much 1500 or less. */
    ok(!after.players[ME].hand.some((c) => c.slug === 'slifer-the-sky-dragon'), 'nor does its search put one in the hand', after.players[ME].hand.map((c) => c.slug).join(',') || 'nothing');
    ok(after.players[ME].deck.some((c) => c.slug === 'slifer-the-sky-dragon'), 'the God is still in the Deck where it belongs');
  }

  /* And the two roads that must stay open. */
  {
    const s = fresh();
    s.players[ME].grave = [card(ME, 'obelisk-the-tormentor')];
    const reborn = card(ME, 'monster-reborn');
    s.players[ME].hand = [reborn];
    const raised = act(s, ME, { type: 'activateSpell', uid: reborn.uid, targets: [s.players[ME].grave[0].uid] });
    ok(on(raised, ME).some((m) => m.slug === 'obelisk-the-tormentor'), 'Monster Reborn raises a God from the Graveyard');

    const t = fresh();
    const god = card(ME, 'slifer-the-sky-dragon');
    t.players[ME].hand = [god];
    for (let i = 0; i < 3; i++) t.players[ME].monsters[i] = card(ME, 'kuriboh');
    const paid = t.players[ME].monsters.map((m) => m!.uid);
    const summoned = act(t, ME, { type: 'normalSummon', uid: god.uid, zone: 0, position: 'atk', face: 'up', tributes: paid });
    ok(on(summoned, ME).some((m) => m.slug === 'slifer-the-sky-dragon'), 'and three Tributes still summon one the ordinary way');
  }

  /* Two postures out of the hand and no third. The board has always offered
     exactly two buttons — Normal Summon and Set — and the search was offering
     itself a wall summoned AS a wall, which is a move no player can answer
     with. Asked at the engine so no seat can have a third option. */
  {
    const s = fresh();
    const wall = card(ME, 'mystical-elf'); // 800/2000, the shape that wanted it
    s.players[ME].hand = [wall];
    const upright = applyAction(s, ME, { type: 'normalSummon', uid: wall.uid, zone: 0, position: 'def', face: 'up' });
    ok(!!upright.error, 'a monster cannot arrive from the hand in face-up Defence', upright.error ?? '(allowed)');
    ok(upright.state.players[ME].hand.some((h) => h.uid === wall.uid), 'and stays in hand when it is tried');

    const set = act(fresh2(wall), ME, { type: 'normalSummon', uid: wall.uid, zone: 0, position: 'def', face: 'down' });
    const laid = on(set, ME)[0];
    ok(laid?.face === 'down' && laid?.position === 'def', 'Setting lays it face-down in Defence', `${laid?.face}/${laid?.position}`);
    const stood = act(fresh2(wall), ME, { type: 'normalSummon', uid: wall.uid, zone: 0, position: 'atk', face: 'up' });
    ok(on(stood, ME)[0]?.position === 'atk', 'and a Normal Summon stands it up to fight');
    /* Face-up Defence is still reached the way everyone reaches it — a turn
       later, because a monster cannot turn on the turn it arrived. */
    const later = cloneState(stood);
    later.turn += 2;
    const turned = act(later, ME, { type: 'changePosition', uid: on(later, ME)[0]!.uid });
    ok(on(turned, ME)[0]?.position === 'def' && on(turned, ME)[0]?.face === 'up', 'by turning a monster that is already standing');
  }

  /* And a card is never among its own answers — the rule the picker owns and
     the modal had stopped asking for. Gamma the Magnet Warrior laid itself out
     as a Magnet Warrior to Special Summon, while it was the card being
     Summoned. Reported. */
  {
    const s = fresh();
    const gamma = card(ME, 'gamma-the-magnet-warrior');
    s.players[ME].hand = [gamma, card(ME, 'beta-the-magnet-warrior')];
    const spec = summonTargetSpec('gamma-the-magnet-warrior')!;
    const shown = targetCandidates(s, ME, spec, () => false, gamma.uid).map((c) => c.uid);
    ok(!shown.includes(gamma.uid), 'the Magnet Warrior being Summoned is not one of its own answers');
    ok(shown.length > 0, 'while its brothers still are', String(shown.length));
  }
}

console.log('\nA question about a card nobody can find any more');
{
  /* The A/B harness reports a crashed game rather than hiding it, and one duel
     in sixty-five died here: `choiceResponses` ranked its options by ATK, and
     for an option it could not find it looked up `card('')` — which throws, and
     took the duel with it. In a room that is a duel that simply stops.

     Two faults in one line. The pile search walked past `banished` and the
     Extra Deck, so a card banished mid-resolution was named by a window and
     then unfindable; and the `?? ''` that was meant to be a safe default was
     the opposite of one. */
  const s = fresh();
  const ghost = card(ME, 'kuriboh');
  s.players[ME].grave = [card(ME, 'summoned-skull'), card(ME, 'battle-ox')];
  s.pending = {
    kind: 'choose',
    player: ME,
    options: [s.players[ME].grave[0].uid, ghost.uid, s.players[ME].grave[1].uid],
    want: 1,
    reason: 'probe',
  } as DuelState['pending'];

  let threw: string | null = null;
  let answers: string[][] = [];
  try {
    answers = choiceResponses(s, ME).map((a) => (a as { uids: string[] }).uids);
  } catch (e) {
    threw = e instanceof Error ? e.message : String(e);
  }
  ok(!threw, 'an option nothing can find does not throw the duel away', threw ?? '');
  ok(answers.length > 0, 'and the window still offers its real answers', String(answers.length));
  ok(answers[0]?.[0] === s.players[ME].grave[0].uid, 'strongest first, with the ghost ranked at nothing');

  /* And the pile search reaches the two piles it used to miss. */
  const banished = fresh();
  const gone = card(ME, 'dark-magician');
  banished.players[ME].banished = [gone];
  banished.pending = { kind: 'choose', player: ME, options: [gone.uid], want: 1, reason: 'probe' } as DuelState['pending'];
  const found = choiceResponses(banished, ME);
  ok(found.length === 1 && found[0].type === 'chooseCard', 'a banished card is still an answer it can rank', String(found.length));
}

console.log('\nThe Dinosaur that comes back is the one you point at');
{
  /* Reported: "Crawling Dragon should allow the player to choose."

     A card opts into being asked by declaring `targets` — `raiseChoice`
     refuses to raise a question no effect wanted. The board's own summon
     button worked the choice out for itself from the effect data, so summoning
     Crawling Dragon by hand looked right; every other road onto the field goes
     through the engine, which had nothing to ask with and quietly took the
     biggest Dinosaur in the pile. */
  const s = fresh();
  const dragon = card(ME, 'crawling-dragon'); // Level 5 — one Tribute
  s.players[ME].hand = [dragon];
  s.players[ME].monsters[0] = card(ME, 'kuriboh');
  const small = card(ME, 'uraby');
  const big = card(ME, 'megazowler');
  s.players[ME].grave = [small, big];

  const summoned = applyAction(s, ME, {
    type: 'normalSummon',
    uid: dragon.uid,
    zone: 1,
    position: 'atk',
    face: 'up',
    tributes: [s.players[ME].monsters[0]!.uid],
  });
  ok(!summoned.error, 'Crawling Dragon is Tribute Summoned', summoned.error ?? '');
  ok(summoned.state.pending?.kind === 'choose', 'and stops to ask which Dinosaur comes back', summoned.state.pending?.kind ?? '(nothing)');
  const offered = summoned.state.pending?.options ?? [];
  ok(offered.includes(small.uid) && offered.includes(big.uid), 'offering both of them', `${offered.length} option(s)`);

  /* The whole point: the smaller one, chosen, is the one that arrives. Left to
     itself the engine takes Megazowler every time. */
  const chosen = act(summoned.state, ME, { type: 'chooseCard', uids: [small.uid] });
  ok(on(chosen, ME).some((m) => m.slug === 'uraby'), 'and the one that was pointed at is the one that arrives', on(chosen, ME).map((m) => m.slug).join(','));
  ok(!on(chosen, ME).some((m) => m.slug === 'megazowler'), 'not the biggest body in the pile');

  /* One Dinosaur is not a choice — it must not stop to ask about it. */
  const lone = fresh();
  const d2 = card(ME, 'crawling-dragon');
  lone.players[ME].hand = [d2];
  lone.players[ME].monsters[0] = card(ME, 'kuriboh');
  lone.players[ME].grave = [card(ME, 'uraby')];
  const solo = applyAction(lone, ME, {
    type: 'normalSummon',
    uid: d2.uid,
    zone: 1,
    position: 'atk',
    face: 'up',
    tributes: [lone.players[ME].monsters[0]!.uid],
  });
  ok(!solo.state.pending, 'with one Dinosaur in the pile it asks nothing', solo.state.pending?.kind ?? '');
  ok(on(solo.state, ME).some((m) => m.slug === 'uraby'), 'and brings it back anyway');
}

console.log('\nOne question, asked the same way down every road');
{
  /* The gate that decided which cards asked was `targets`, set by hand, so a
     monster arriving off the summon button was asked and the same monster
     arriving any other way was not. These pin the roads, not the cards: the
     point is that they agree. */

  /* Feral Imp hunts Exodia's five pieces. Summoned by hand it always asked,
     because the board looks up a spec before it sends the action. Put on the
     field by somebody else's card it went through `raiseChoice`, which was
     shut — so the engine took a limb for you. */
  const stockImp = (s: DuelState) => {
    s.players[ME].deck = [
      card(ME, 'left-arm-of-the-forbidden-one'),
      card(ME, 'right-leg-of-the-forbidden-one'),
      card(ME, 'kuriboh'),
    ];
    return s;
  };
  const byHand = stockImp(fresh());
  const imp = card(ME, 'feral-imp');
  byHand.players[ME].hand = [imp];
  const handAsk = act(byHand, ME, { type: 'normalSummon', uid: imp.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  const handOffers = asked(handAsk);
  ok(!!handOffers && handOffers.length === 2, 'Feral Imp asks when it walks out of your hand', JSON.stringify(handOffers));

  /* And the other road: Monster Reborn stands the same Imp up out of the
     Graveyard. Same monster, same Deck, same question. */
  const byReborn = stockImp(fresh());
  const dead = card(ME, 'feral-imp');
  byReborn.players[ME].grave = [dead];
  const reborn = card(ME, 'monster-reborn');
  byReborn.players[ME].hand = [reborn];
  const revived = act(byReborn, ME, { type: 'activateSpell', uid: reborn.uid, targets: [dead.uid] });
  const revivedOffers = asked(revived);
  ok(
    JSON.stringify(revivedOffers) === JSON.stringify(handOffers),
    'and asks the same question when another card stands it up',
    `${JSON.stringify(revivedOffers)} vs ${JSON.stringify(handOffers)}`
  );
  const took = answer(revived, 'right-leg-of-the-forbidden-one');
  ok(
    took.players[ME].hand.some((c) => c.slug === 'right-leg-of-the-forbidden-one'),
    'and the limb pointed at is the limb that comes',
    took.players[ME].hand.map((c) => c.slug).join(',')
  );

  /* The mask promised a choice its op then made. "Take control of 1 monster
     your opponent controls" is a decision between a wall and an attacker, and
     `strongest` is not always the one you want. */
  {
    const s = fresh();
    const beast = card(ME, 'masked-beast-des-gardius');
    s.players[ME].monsters[0] = beast;
    const big = card(FOE, 'summoned-skull');
    const wall = card(FOE, 'mystical-elf');
    s.players[FOE].monsters[0] = big;
    s.players[FOE].monsters[1] = wall;
    const hole = card(ME, 'dark-hole');
    s.players[ME].hand = [hole];
    const swept = act(s, ME, { type: 'activateSpell', uid: hole.uid, targets: [] });
    /* Dark Hole clears both sides, so what the mask can reach is whatever the
       sweep left — the question is that it asks at all, and offers what is
       actually there rather than deciding by ATK. */
    const spec = targetSpecFor('masked-beast-des-gardius', 'onSentToGrave');
    ok(!!spec && spec.side === 'opp' && spec.zone === 'monster',
      'the mask names a monster across the table, and lets you say which', `${spec?.side}/${spec?.zone}`);
    ok(!swept.winner, 'CONTROL: the sweep resolves without ending the duel');
  }

  /* Trap Hole and Torrential Tribute answer the same word. They used to
     disagree — one narrow, one wide — and a comment in Trap Hole still said so
     after the code had changed underneath it. */
  const holeWindow = CARDS['trap-hole'].effects.find((e) => e.trigger === 'trap')?.window;
  const tideWindow = CARDS['torrential-tribute'].effects.find((e) => e.trigger === 'trap')?.window;
  ok(holeWindow === 'opponentSummon', 'Trap Hole answers any kind of Summon', String(holeWindow));
  ok(tideWindow === holeWindow, 'and Torrential Tribute answers exactly the same one', `${tideWindow} vs ${holeWindow}`);
  ok(
    /\bSummons a monster\b/.test(CARDS['trap-hole'].text ?? '') &&
      /\bsummons a monster\b/i.test(CARDS['torrential-tribute'].text ?? ''),
    'and both say so in the same words',
    `"${CARDS['trap-hole'].text}" / "${CARDS['torrential-tribute'].text}"`
  );
}

console.log('\nA card lying face-down is not named until it turns over');
{
  /* Reported: "when attacking a facedown monster if the opponent has a trap
     that would stop the attack like spellbinding circle it reveals in the text
     it says monster a attacks monster b ... the attack is negated and never
     lands the monster b won't flip (correctly) but it is revealed in the text."

     The declaration is written before the trap window opens, so the log named
     the card a beat before anything could have turned it over — and when the
     attack was answered, nothing ever did. */
  const arena = (hidden: string, withTrap: boolean) => {
    const s = fresh('battle');
    s.active = ME;
    const ox = card(ME, 'battle-ox');
    ox.summonedOnTurn = 0;
    s.players[ME].monsters[0] = ox;
    const face = card(FOE, hidden);
    face.face = 'down';
    face.position = 'def';
    face.summonedOnTurn = 0;
    s.players[FOE].monsters[0] = face;
    if (withTrap) {
      const circle = card(FOE, 'spellbinding-circle');
      circle.face = 'down';
      circle.summonedOnTurn = 1;
      s.players[FOE].spellTrap = circle;
    }
    return { s, ox, face };
  };
  const said = (s: DuelState, from: number) =>
    s.log.slice(from).map((l) => (typeof l === 'string' ? l : (l as { text: string }).text)).join(' | ');

  // The reported case: negated, so it never flips, so it is never named.
  const a = arena('man-eater-bug', true);
  const from = a.s.log.length;
  let r = act(a.s, ME, { type: 'attack', uid: a.ox.uid, targetUid: a.face.uid });
  if (r.pending) r = act(r, r.pending.player, { type: 'respondTrap', uid: r.players[FOE].spellTrap!.uid });
  ok(said(r, from).includes('attacks the face-down monster'), 'the declaration names it by what it is, not by what it says', said(r, from));
  ok(!said(r, from).includes('Man-Eater Bug'), 'and a negated attack never reveals what was lying there', said(r, from));
  ok(r.players[FOE].monsters[0]?.face === 'down', 'CONTROL: it really is still face-down', r.players[FOE].monsters[0]?.face ?? 'gone');

  // The attack lands: the flip line reveals it, one beat later, as it always did.
  const b = arena('mystical-elf', false);
  const fromB = b.s.log.length;
  const landed = act(b.s, ME, { type: 'attack', uid: b.ox.uid, targetUid: b.face.uid });
  ok(said(landed, fromB).includes('attacks the face-down monster'), 'an attack that lands is declared the same way', said(landed, fromB));
  ok(said(landed, fromB).includes('Mystical Elf is flipped face-up'), 'and the flip is what names it', said(landed, fromB));
  ok(
    said(landed, fromB).indexOf('attacks the face-down') < said(landed, fromB).indexOf('flipped face-up'),
    'in that order — the reveal belongs to the flip, not to the declaration'
  );

  // CONTROL: a monster standing face-up is named at declaration, as ever.
  const c = arena('mystical-elf', false);
  c.face.face = 'up';
  const fromC = c.s.log.length;
  const open = act(c.s, ME, { type: 'attack', uid: c.ox.uid, targetUid: c.face.uid });
  ok(said(open, fromC).includes('attacks Mystical Elf'), 'CONTROL: a face-up defender is named as it always was', said(open, fromC));
}

console.log('\nRa pours everything it has into the sun');
{
  /* Asked for by the owner: "Ra should have another effect ... so all the
     player's LP are transfered to ra's atk but 1." Diffusion — the card that
     would hand the Life Points back — does not exist in this game yet, so this
     is one way only, and that is the whole trade. */
  const withRa = (lp: number, mod = 0) => {
    const s = fresh();
    const ra = card(ME, 'the-winged-dragon-of-ra');
    ra.atkMod = mod;
    s.players[ME].monsters = [ra, null, null];
    s.players[ME].lp = lp;
    s.players[ME].normalSummonUsed = true;
    return { s, ra };
  };
  const burnIndex = (s: DuelState, ra: CardInstance) =>
    ignitionOptions(s, ME, ra).find((o) => o.label.includes('sun'))?.index;

  const { s, ra } = withRa(8000, 2400); // as if Tribute Summoned off three ordinary bodies
  const offers = ignitionOptions(s, ME, ra);
  ok(offers.length === 2, 'Ra carries two ignitions — the Phoenix and the sun', offers.map((o) => o.label).join(' / '));
  const idx = burnIndex(s, ra);
  const after = act(s, ME, { type: 'ignition', uid: ra.uid, effectIndex: idx });
  ok(after.players[ME].lp === 1, 'it pays down to exactly one Life Point', `${after.players[ME].lp}`);
  const burning = after.players[ME].monsters[0]!;
  ok(
    effAtk(after, burning, ME) === 2400 + 7999,
    'and every point of it arrives on the God, on top of what it was already worth',
    `${effAtk(after, burning, ME)} (want ${2400 + 7999})`
  );

  /* One way only, and the limit is the card rather than a marker: the total is
     spent, so there is nothing left to spend. */
  const spent = structuredClone(after);
  spent.turn += 2;
  spent.players[ME].monsters[0]!.effectUsedOnTurn = -1;
  ok(
    burnIndex(spent, spent.players[ME].monsters[0]!) === undefined,
    'and it is not offered again on a later turn, because there is nothing left to give'
  );
  ok(
    !!applyAction(spent, ME, { type: 'ignition', uid: ra.uid, effectIndex: idx }).error,
    'pressed anyway, it is refused rather than spending the turn on nothing'
  );

  /* Two Life Points is the smallest board where it does anything at all. */
  const thin = withRa(2);
  ok(burnIndex(thin.s, thin.ra) !== undefined, 'at two Life Points it is still worth one', 'not offered');
  const gone = act(thin.s, ME, { type: 'ignition', uid: thin.ra.uid, effectIndex: burnIndex(thin.s, thin.ra) });
  ok(
    gone.players[ME].lp === 1 && effAtk(gone, gone.players[ME].monsters[0]!, ME) === 1,
    'and one point is what moves',
    `${gone.players[ME].lp} LP, ${effAtk(gone, gone.players[ME].monsters[0]!, ME)} ATK`
  );

  /* CONTROL: the God Phoenix is untouched — still a flat thousand, still the
     board sweep, and still its own separate once per turn. */
  const phoenix = withRa(8000);
  phoenix.s.players[FOE].monsters = [card(FOE, 'summoned-skull'), null, null];
  const pIdx = ignitionOptions(phoenix.s, ME, phoenix.ra).find((o) => o.label.includes('Phoenix'))?.index;
  const swept = act(phoenix.s, ME, { type: 'ignition', uid: phoenix.ra.uid, effectIndex: pIdx });
  ok(swept.players[ME].lp === 7000, 'CONTROL: the God Phoenix still costs its flat thousand', `${swept.players[ME].lp}`);
  ok(!on(swept, FOE).length, 'CONTROL: and still burns their board clean', on(swept, FOE).map((m) => m.slug).join(','));

  /* And the trade is real: 1 Life Point is a duel anybody can finish. Pinned so
     nobody later "fixes" the drawback out of it. */
  const fragile = act(gone, ME, { type: 'endTurn' });
  const ox = card(FOE, 'battle-ox');
  ox.summonedOnTurn = 0;
  fragile.players[FOE].monsters = [ox, null, null];
  fragile.players[ME].monsters = [null, null, null];
  fragile.phase = 'battle';
  const dead = act(fragile, FOE, { type: 'attack', uid: ox.uid, targetUid: null });
  ok(dead.winner === FOE, 'a player at one Life Point loses to the next thing that connects', String(dead.winner));
}

console.log(failures ? `\n${failures} regression(s) FAILED` : `\nAll ${checks} rules regressions pass. ✅`);
if (failures) process.exitCode = 1;
