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
import { applyAction, canActivateFromHand, canActivateSetCard, canAttackWith, canIgnite, createDuel, effAtk, effDef, effFlags, fusionOptions, legalAttackTargets, summonBlocked, tributesRequired } from '../src/game/engine';
import { CARDS, baseAtk as baseAtkOf } from '../src/game/cards';
import { pickerSides, targetCandidates, targetSpecFor } from '../src/game/ui';
import { isFinalRound, type Tournament } from '../src/server/tournament';
import type { CardInstance, DuelAction, DuelState, Op, PlayerId } from '../src/game/types';

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

  const after = act(s, ME, { type: 'attack', uid: big.uid, targetUid: bug.uid });

  ok(on(after, FOE).length === 0, 'the attacked face-down monster is destroyed');
  ok(
    on(after, ME).length < 2,
    'and its flip effect still resolved — being destroyed by the attack does not cancel it',
    `attacker side went 2 -> ${on(after, ME).length}`
  );
}

/* ------------------------------------------------------------------ */
console.log('\nThe Earl of Demise only blows up cards that are actually set');
{
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
    });
    const survived = !!after.players[FOE].spellTrap;
    ok(
      survived === (face === 'up'),
      `a face-${face} Spell ${face === 'up' ? 'survives' : 'is destroyed'}`,
      `it ${survived ? 'survived' : 'was destroyed'}`
    );
  }
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

  ok(added.length === 1, 'Sangan adds exactly one card', `added ${added.join(', ') || 'nothing'}`);
  ok(
    added[0] === 'hitotsu-me-giant',
    'and it is the strongest one under the cap, not the first in the deck',
    `got ${added[0] ?? 'nothing'}`
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
  ok(effAtk(withToon, toon, ME) === 1400 + 600, 'and gains 600 ATK', `ATK ${effAtk(withToon, toon, ME)}`);
  /* Effect-indestructible since the 8000-LP pass, not untargetable: nothing
     may DESTROY a Toon while the book is open, but binds and debuffs land. */
  ok(flags.directAttack === true && flags.indestructibleByEffect === true && flags.pierce === true, 'with direct attack, effect-indestructibility and piercing');
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
  const s = fresh();
  const fish = card(ME, '7-colored-fish');
  const beast = card(ME, 'amphibian-beast');
  s.players[ME].monsters[0] = fish;
  s.players[ME].monsters[1] = beast;

  const fishBare = effAtk(s, fish, ME);
  ok(fishBare === 1800, '7 Colored Fish is 1800 with no Umi', `${fishBare}`);

  s.players[ME].field = card(ME, 'umi');
  // 1800 + 800 of its own + 400 from Umi's WATER aura.
  ok(effAtk(s, fish, ME) === 3100, 'and 3100 once Umi is up, having been summoned first', `${effAtk(s, fish, ME)}`);
  ok(effFlags(s, fish, ME).pierce === true, 'with the piercing its text promises');
  ok(effAtk(s, beast, ME) === 2400 + 500 + 500, 'Amphibian Beast gains its 500 too', `${effAtk(s, beast, ME)}`);
  ok((effFlags(s, beast, ME).extraAttacks ?? 0) === 1, 'and can attack twice');

  s.players[ME].field = null;
  ok(effAtk(s, fish, ME) === 1800, 'and it all lapses when Umi leaves', `${effAtk(s, fish, ME)}`);
  ok(!effFlags(s, fish, ME).pierce, 'piercing included');
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

  const after = flipItOver(['monster-reborn'], ['dark-hole']);
  const got = after.players[ME].hand.map((c) => c.slug);
  ok(got.includes('monster-reborn'), 'takes your own Spell back', got.join(', ') || '(empty)');
  ok(!got.includes('dark-hole'), 'and leaves theirs where it fell', got.join(', '));

  // With nothing of your own to take, the other Graveyard is still fair game —
  // which is what keeps the card's own "either Graveyard" honest.
  const after2 = flipItOver([], ['dark-hole']);
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

console.log('\nA moth knows which rung of its own ladder it is on');
{
  /* Larvae Moth and both Great Moths sit in Weevil's main deck, so one can be
     Normal Summoned straight out of the hand — and it arrived with no counters,
     needing three more End Phases to reach the rung above the one it was
     already standing on. */
  /* Read off a real Weevil deck, not a card built by this file — the engine
     seeds the counters where every instance is made, and a hand-rolled one
     would sail past that and prove nothing about the game. */
  const weevil = createDuel({ seed: 3, p1: { duelistId: 'weevil', name: 'W' }, p2: { duelistId: 'yugi', name: 'Y' } });
  const held = [...weevil.players.p1.deck, ...weevil.players.p1.hand];
  const stages: Array<[string, number]> = [
    ['petit-moth', 0],
    ['larvae-moth', 2],
    ['great-moth', 3],
    ['perfectly-ultimate-great-moth', 4],
  ];
  for (const [slug, want] of stages) {
    const found = held.filter((c) => c.slug === slug);
    ok(
      found.length > 0 && found.every((c) => c.counters === want),
      `${CARDS[slug].name} starts on ${want}`,
      found.length ? `got ${found.map((c) => c.counters).join('/')}` : 'not in the deck'
    );
  }
  // And the ladder still climbs: Petit Moth reaches Larvae Moth on the second
  // End Phase, which is the same rung a hand-summoned Larvae Moth starts on.
  const s = fresh();
  const petit = card(ME, 'petit-moth');
  s.players[ME].monsters[0] = petit;
  let cur = s;
  for (let i = 0; i < 2; i++) {
    cur = act(cur, ME, { type: 'endTurn' });
    cur = act(cur, FOE, { type: 'endTurn' });
  }
  ok(cur.players[ME].monsters[0]?.slug === 'larvae-moth', 'Petit Moth becomes Larvae Moth on its second End Phase', cur.players[ME].monsters[0]?.slug);
}

console.log('\nInsect Barrier does both halves of its sentence');
{
  const s = fresh();
  const barrier = card(ME, 'insect-barrier');
  s.players[ME].hand.push(barrier);
  const ox = card(FOE, 'battle-ox');
  s.players[FOE].monsters[0] = ox;
  const after = act(s, ME, { type: 'activateSpell', uid: barrier.uid, targets: [] });
  ok(effAtk(after, after.players[FOE].monsters[0]!, FOE) === 1700 - 400, 'their monsters lose 400 ATK', `${effAtk(after, after.players[FOE].monsters[0]!, FOE)}`);
  const theirTurn = act(after, ME, { type: 'endTurn' });
  ok(!canAttackWith(theirTurn, FOE, theirTurn.players[FOE].monsters[0]!), 'and cannot attack on their next turn');
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

console.log('\nSky Scout pays for going round the blockers');
{
  /* "Can attack your opponent directly, but its battle damage is halved" — and
     only the first half of that sentence existed, so it was an unblockable 1800
     every turn for one Normal Summon. */
  const direct = fresh('battle');
  const scout = card(ME, 'sky-scout'); // 1800 ATK
  direct.players[ME].monsters[0] = scout;
  direct.players[FOE].monsters[0] = card(FOE, 'mystical-elf'); // a blocker it walks past
  const swung = act(direct, ME, { type: 'attack', uid: scout.uid, targetUid: null });
  ok(swung.players[FOE].lp === 4000 - 900, 'the direct attack lands for half', `LP ${swung.players[FOE].lp}`);

  // Halved wherever it inflicts battle damage, which is what the sentence says.
  const over = fresh('battle');
  const scout2 = card(ME, 'sky-scout');
  over.players[ME].monsters[0] = scout2;
  const chick = card(FOE, 'kuriboh'); // 300 ATK
  over.players[FOE].monsters[0] = chick;
  const through = act(over, ME, { type: 'attack', uid: scout2.uid, targetUid: chick.uid });
  ok(through.players[FOE].lp === 4000 - 750, 'and so does the damage over a body it beats', `LP ${through.players[FOE].lp}`);

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

console.log('\nTrap Hole says "Normal Summons", so a Fusion Summon is not its business');
{
  /* Gaia the Dragon Champion, not the Blue-Eyes Ultimate Dragon. Written with
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
  ok(!fused.pending, 'Trap Hole sits out a Fusion Summon', fused.pending ? fused.pending.reason : '');

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
  // 7 Colored Fish also gains its own 800 from Umi, on both sides of the table.
  ok(effAtk(s, mine, ME) === 1800 + 500 + 800, 'your own WATER monster gains from your Umi', String(effAtk(s, mine, ME)));
  ok(effAtk(s, theirs, FOE) === plain + 500 + 800, 'and so does theirs — it is the same sea', String(effAtk(s, theirs, FOE)));

  // Dark Sanctuary is the counter-example: "your opponent's monsters lose 400"
  // is one-sided on purpose, and must stay that way.
  const d = fresh();
  const a = card(ME, 'hitotsu-me-giant');
  const b = card(FOE, 'hitotsu-me-giant');
  d.players[ME].monsters[0] = a;
  d.players[FOE].monsters[0] = b;
  const base = effAtk(d, a, ME);
  d.players[ME].field = card(ME, 'dark-sanctuary');
  ok(effAtk(d, a, ME) === base, 'CONTROL: a one-sided Field Spell stays one-sided', String(effAtk(d, a, ME)));
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
  ok(open.players[ME].lp === 4000 - 1000, 'and costs its printed 1000 Life Points', `LP ${open.players[ME].lp}`);

  /* Closing the book takes what the book was giving, and nothing more.
     Reported as "Toon world is too weak now … destroying all monsters when
     the toon world is a lot": the Toons used to be destroyed outright when it
     left, which made a single De-Spell a one-card sweep of everything Pegasus
     had committed. Losing the 600 ATK and the direct attack is already an
     answer the whole roster can reach — that is the counterplay, and it is
     enough. The bodies stay. */
  const doom = fresh();
  doom.players[FOE].field = { ...card(FOE, 'toon-world'), face: 'up' as const };
  const toon = card(FOE, 'toon-summoned-skull');
  const plain = card(FOE, 'ryu-kishin-powered');
  doom.players[FOE].monsters = [toon, plain, null];
  const buffed = effAtk(doom, toon, FOE);
  const despell = card(ME, 'de-spell');
  doom.players[ME].hand = [despell];
  const popped = act(doom, ME, { type: 'activateSpell', uid: despell.uid, targets: [doom.players[FOE].field!.uid] });
  ok(!popped.players[FOE].field, 'destroying Toon World empties the Field Zone');
  const survivor = popped.players[FOE].monsters.find((m) => m?.slug === 'toon-summoned-skull');
  ok(!!survivor, 'the Toons outlive the book', popped.players[FOE].monsters.map((m) => m?.slug).join(','));
  ok(!!survivor && effAtk(popped, survivor, FOE) === buffed - 600,
    'and lose exactly the 600 the book was lending them',
    survivor ? `${buffed} -> ${effAtk(popped, survivor, FOE)}` : 'gone');
  ok(!!survivor && !effFlags(popped, survivor, FOE).directAttack,
    'and can no longer walk past a blocker');
  ok(popped.players[FOE].monsters.some((m) => m?.slug === 'ryu-kishin-powered'),
    'CONTROL: the monster that was never a Toon is untouched either way');

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

  /* Zoa gives its body for the metal one — the anime beat. */
  const kz = fresh();
  const beast = card(ME, 'zoa');
  beast.summonedOnTurn = 0;
  kz.players[ME].monsters = [beast, null, null];
  kz.players[ME].deck = [card(ME, 'metalzoa')];
  const reborn = act(kz, ME, { type: 'ignition', uid: beast.uid, targets: [] });
  ok(reborn.players[ME].monsters.some((m) => m?.slug === 'metalzoa'), 'Zoa transforms into Metalzoa');
  ok(reborn.players[ME].grave.some((c) => c.slug === 'zoa'), 'and the beast itself was the price');

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

  const pm = fresh();
  const moth = card(ME, 'petit-moth');
  pm.players[ME].hand = [moth];
  pm.players[ME].deck = [card(ME, 'cocoon-of-evolution'), card(ME, 'kuriboh')];
  const mothDown = act(pm, ME, { type: 'normalSummon', uid: moth.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(mothDown.players[ME].hand.some((h) => h.slug === 'cocoon-of-evolution'), 'Petit Moth fetches its Cocoon');

  // And the Cocoon holds the larva: battle cannot crack the shell around it.
  const shell = fresh();
  const larva = card(ME, 'petit-moth');
  const cocoon = card(ME, 'cocoon-of-evolution');
  shell.players[ME].monsters = [larva, cocoon, null];
  ok(!!effFlags(shell, larva, ME).indestructibleByBattle, 'the Cocoon shields the moth beside it');
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

  /* And the pause: a Toon summoned this turn waits — the other printed Toon
     rule, and the turn the opponent is given to answer a free 3800. */
  const sick = fresh('battle');
  sick.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  const freshToon = card(ME, 'toon-mermaid');
  freshToon.summonedOnTurn = sick.turn;
  sick.players[ME].monsters = [freshToon, null, null];
  ok(!canAttackWith(sick, ME, freshToon), 'a Toon summoned this turn cannot attack yet');
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

  /* The factory ships the line out of the hand. */
  const kf = fresh();
  const factory = card(ME, 'machine-conversion-factory');
  const small1 = card(ME, 'cannon-soldier'); // 1400 Machine
  const small2 = card(ME, 'robotic-knight'); // 1600 Machine
  const tooBig = card(ME, 'mechanicalchaser'); // 1850 — over the line
  kf.players[ME].hand = [factory, small1, small2, tooBig];
  const rolled = act(kf, ME, { type: 'activateSpell', uid: factory.uid, targets: [] });
  const out = rolled.players[ME].monsters.filter(Boolean).map((m) => m!.slug);
  ok(out.includes('cannon-soldier') && out.includes('robotic-knight'),
    'Machine Conversion Factory ships two small Machines from the hand', out.join(','));
  ok(rolled.players[ME].hand.some((h) => h.slug === 'mechanicalchaser'),
    'CONTROL: an 1850 Machine is over the factory line and stays in hand');
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
  const toon = card(FOE, 'toon-summoned-skull'); // 2500 + 600 book = 3100, drained to 1100 — still standing
  book.players[FOE].hand = [toon];
  const drawn = act(book, FOE, {
    type: 'normalSummon', uid: toon.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
  });
  const inked = drawn.players[FOE].monsters.find((m) => m?.slug === 'toon-summoned-skull');
  ok(!!inked && effAtk(drawn, inked, FOE) === 1100,
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
  ok(walled.players[FOE].monsters.some((m) => m?.slug === 'battle-ox'),
    'CONTROL: the negation itself still holds — the wall says no, it just cannot maim');

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

  // Pot of Greed draws twice, and each draw is its own beat with its own line.
  const greed = fresh();
  const pot = card(ME, 'pot-of-greed');
  greed.players[ME].hand = [pot];
  greed.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'battle-ox'), card(ME, 'harpie-lady')];
  const drawn = act(greed, ME, { type: 'activateSpell', uid: pot.uid, targets: [] });
  const draws = drawn.anims.filter((a) => a.kind === 'draw');
  ok(draws.length === 2 && draws.every((a) => !!a.note),
    'both of Pot of Greed\'s draws are announced', `${draws.length} beats, ${draws.filter((a) => a.note).length} spoken`);
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
  const fetched = (deck: string[]) => {
    const s = fresh();
    const v = card(ME, 'viser-des');
    s.players[ME].hand = [v];
    s.players[ME].deck = deck.map((d) => card(ME, d));
    const out = act(s, ME, { type: 'normalSummon', uid: v.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
    return out.players[ME].hand.filter((c) => c.slug !== 'viser-des').map((c) => c.slug);
  };

  ok(fetched(['coffin-seller', 'nightmare-wheel', 'bowganian', 'the-winged-dragon-of-ra'])[0] === 'the-winged-dragon-of-ra',
    'the God is named first, so the God is what it fetches');
  /* Deck order must not matter, or the fix is luck wearing a rule's clothes. */
  ok(fetched(['the-winged-dragon-of-ra', 'bowganian'])[0] === 'the-winged-dragon-of-ra',
    'and it does not matter where in the Deck it is sitting');
  ok(fetched(['coffin-seller', 'nightmare-wheel', 'bowganian'])[0] === 'bowganian',
    'with no God to find it takes the next one named');
  ok(fetched(['coffin-seller', 'nightmare-wheel'])[0] === 'nightmare-wheel',
    'and the next after that');
  ok(fetched(['coffin-seller'])[0] === 'coffin-seller', 'down to the last one listed');

  /* CONTROL: a search with no named list still takes the strongest, which is
     what a player would have said if there were anyone to ask. */
  const anyDeck = fresh();
  const alpha = card(ME, 'alpha-the-magnet-warrior');
  anyDeck.players[ME].hand = [alpha];
  anyDeck.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'beta-the-magnet-warrior'), card(ME, 'gamma-the-magnet-warrior')];
  const magnets = act(anyDeck, ME, {
    type: 'normalSummon', uid: alpha.uid, zone: 0, position: 'atk', face: 'up', tributes: [],
  });
  ok(magnets.players[ME].hand.some((c) => c.slug === 'beta-the-magnet-warrior'),
    'CONTROL: an unordered search still reaches for what it wants');
}

console.log('\nOnly the first ignition on a card can ever be reached');
{
  /* `applyAction` resolves an ignition with
     `def.effects.find((e) => e.trigger === 'ignition')` — the FIRST one — and
     `canIgnite` asks the same question. So a card carrying two activated
     effects has a second one that no player and no AI can ever use: dead text
     of exactly the kind `npm run text` exists to catch, except the text check
     sees an ignition trigger and is satisfied.

     Found by giving Ra both the God Phoenix and the One-Turn Kill; the audit
     caught it because the second effect never fired. Asserted over the whole
     card set so the next card to try it fails here rather than shipping half
     a sentence. Lift this the day the engine learns to choose. */
  const offenders = Object.entries(CARDS)
    .filter(([, def]) => def.effects.filter((e) => e.trigger === 'ignition').length > 1)
    .map(([slug]) => slug);
  ok(offenders.length === 0,
    'no card carries a second ignition the engine cannot reach', offenders.join(', '));
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
  ok(effAtk(open, mermaid, ME) === baseAtkOf('toon-mermaid') + 600, 'and carries the 600', `${effAtk(open, mermaid, ME)}`);

  const shut = structuredClone(open);
  shut.players[ME].field = null;
  const stranded = shut.players[ME].monsters[0]!;
  ok(!effFlags(shut, stranded, ME).directAttack, 'close the book and the direct attack goes with it');
  ok(effAtk(shut, stranded, ME) === baseAtkOf('toon-mermaid'), 'and so does the 600', `${effAtk(shut, stranded, ME)}`);
  ok(!!shut.players[ME].monsters[0], 'but the body is still standing');

  /* CONTROL: Toon Alligator is the way *into* the deck and is never gated —
     its own text promises the direct attack with no book required, and it
     keeps it. Removing the innate grant from the five gated Toons must not
     have taken the enabler's with it. */
  const gator = fresh('battle');
  const alli = card(ME, 'toon-alligator');
  alli.summonedOnTurn = 0;
  gator.players[ME].monsters = [alli, null, null];
  ok(!!effFlags(gator, alli, ME).directAttack, 'CONTROL: Toon Alligator needs no book to be a nuisance');
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

  /* The Fist of Fate: two souls spent, their field erased, and the souls come
     out the other side as damage. The burn is what separates it from Ra. */
  const fist = fresh();
  const ob = card(ME, 'obelisk-the-tormentor');
  ob.summonedOnTurn = 0;
  const fodderA = card(ME, 'summoned-skull'); // 2500
  const fodderB = card(ME, 'battle-ox');      // 1700
  fist.players[ME].monsters = [ob, fodderA, fodderB];
  fist.players[FOE].monsters = [card(FOE, 'blue-eyes-white-dragon'), card(FOE, 'kuriboh'), null];
  // The real pool, because 2500 + 1700 through a 4000 test pool floors at zero
  // and the assertion would be measuring the floor rather than the burn.
  fist.players[FOE].lp = 8000;
  const foeLp = fist.players[FOE].lp;
  const blown = act(fist, ME, { type: 'ignition', uid: ob.uid, targets: [fodderA.uid, fodderB.uid] });
  ok(on(blown, FOE).length === 0, 'the Fist erases their whole field',
    on(blown, FOE).map((m) => m.slug).join(',') || 'empty');
  ok(blown.players[FOE].lp === foeLp - (2500 + 1700),
    'and burns them for exactly what the two souls were worth',
    `${foeLp} -> ${blown.players[FOE].lp}`);
  ok(!!blown.players[ME].monsters.find((m) => m?.slug === 'obelisk-the-tormentor'),
    'CONTROL: the God itself is still standing');

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

  /* The same clock Ra carries: the turn it lands is the turn they get to
     answer it. Asserted in the Battle Phase, because `canAttackWith` is false
     in Main Phase anyway and the check would pass on a deleted flag. */
  const fresh2 = fresh('battle');
  const justLanded = card(ME, 'obelisk-the-tormentor');
  justLanded.summonedOnTurn = fresh2.turn;
  fresh2.players[ME].monsters = [justLanded, null, null];
  ok(!canAttackWith(fresh2, ME, justLanded), 'and it cannot attack the turn it arrives');
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
  const bareJackal = effAtk(s, jackal, ME);
  ok(bareJackal === baseAtkOf('mystical-knight-of-jackal') + 300,
    'the valley pays her Beast-Warrior ace its flat 300', `${bareJackal}`);

  const buried = structuredClone(s);
  buried.players[ME].grave = [card(ME, 'kuriboh'), card(ME, 'battle-ox')];
  const j2 = buried.players[ME].monsters[0]!;
  ok(effAtk(buried, j2, ME) === bareJackal,
    'and filling the tomb does not move him — the valley counts nothing',
    `${bareJackal} -> ${effAtk(buried, j2, ME)}`);
  const m2 = buried.players[ME].monsters[1]!;
  ok(effAtk(buried, m2, ME) === baseAtkOf('mudora') + 300 + 400,
    'Mudora alone counts the dead: the valley\'s flat 300 and her own 200 a body',
    `${effAtk(buried, m2, ME)}`);
  /* And the count is hers, so it keeps moving — the half that makes the theme
     visible to an AI that scores stats and is blind to Graveyards. */
  const deeper = structuredClone(buried);
  deeper.players[ME].grave.push(card(ME, 'summoned-skull'));
  ok(effAtk(deeper, deeper.players[ME].monsters[1]!, ME) === effAtk(buried, m2, ME) + 200,
    'one more body in the tomb is exactly 200 more on her',
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
     Named order is a preference, so Baby Dragon comes first when both sit
     in the Deck. */
  const s = fresh();
  const gator = card(ME, "alligator-s-sword");
  s.players[ME].hand = [gator];
  s.players[ME].deck = [card(ME, 'polymerization'), card(ME, 'baby-dragon'), card(ME, 'kuriboh')];
  const got = act(s, ME, { type: 'normalSummon', uid: gator.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(got.players[ME].hand.length === 1, "Alligator's Sword adds exactly one card", `hand ${got.players[ME].hand.length}`);
  ok(got.players[ME].hand[0].slug === 'baby-dragon', 'and it is Baby Dragon, the first name in its text', got.players[ME].hand[0].slug);
  const swordOnField = got.players[ME].monsters.find((m) => m?.uid === gator.uid)!;
  ok(effAtk(got, swordOnField, ME) === baseAtkOf(gator.slug), 'and the old +400 swing is gone', `ATK ${effAtk(got, swordOnField, ME)}`);

  // Only Polymerization left, and it takes that instead.
  const p = fresh();
  const gator2 = card(ME, "alligator-s-sword");
  p.players[ME].hand = [gator2];
  p.players[ME].deck = [card(ME, 'polymerization'), card(ME, 'kuriboh')];
  const poly = act(p, ME, { type: 'normalSummon', uid: gator2.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
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
  const GUARDED = [
    'bowganian',
    'viser-des',
    'millennium-seeker',
    'mudora',
    'keldo',
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

  /* And the guard actually holds: Normal Summon Mudora and exactly ONE twin
     joins him, not a full board. This is the assertion the type-level check
     above cannot make. */
  const m = fresh();
  const mudora = card(ME, 'mudora');
  m.players[ME].hand = [mudora];
    /* Fillers on top: Mudora's own mill takes two off the Deck BEFORE the twin
     is fetched, and with the copies on top it buried them and then found
     nothing — the test's deck order, not the card. */
  m.players[ME].deck = [card(ME, 'kuriboh'), card(ME, 'kuriboh'), card(ME, 'mudora'), card(ME, 'mudora')];
  const twinned = act(m, ME, { type: 'normalSummon', uid: mudora.uid, zone: 0, position: 'atk', face: 'up', tributes: [] });
  ok(
    twinned.players[ME].monsters.filter((x) => x?.slug === 'mudora').length === 2,
    'Mudora brings exactly one twin — the chain is one link, not a full board',
    `${twinned.players[ME].monsters.filter((x) => x?.slug === 'mudora').length} on the field`
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

  /* Kaiser Sea Horse counts as two Tributes for a LIGHT monster. Reported as
     broken from a real duel — the sentence had never been implemented. */
  const light = 'blue-eyes-white-dragon'; // Level 8 LIGHT — two Tributes
  ok(CARDS[light].attribute === 'LIGHT', 'CONTROL: Blue-Eyes is the LIGHT monster this is about');
  const board = fresh();
  const horse = card(ME, 'kaiser-sea-horse');
  board.players[ME].monsters = [horse, null, null];
  ok(
    tributesRequired(light, board, ME) === 1,
    'with Kaiser Sea Horse standing, a LIGHT Level 8 needs only one Tribute',
    `needs ${tributesRequired(light, board, ME)}`
  );

  const bare = fresh();
  bare.players[ME].monsters = [card(ME, 'battle-ox'), null, null];
  ok(
    tributesRequired(light, bare, ME) === 2,
    'CONTROL: without him it is still two',
    `needs ${tributesRequired(bare ? light : light, bare, ME)}`
  );

  // And it is LIGHT only — a DARK Level 7 pays full price.
  const dark = fresh();
  dark.players[ME].monsters = [card(ME, 'kaiser-sea-horse'), null, null];
  ok(
    CARDS['gaia-the-fierce-knight'].attribute !== 'LIGHT' &&
      tributesRequired('gaia-the-fierce-knight', dark, ME) === 2,
    'CONTROL: he does nothing for a non-LIGHT monster',
    `needs ${tributesRequired('gaia-the-fierce-knight', dark, ME)}`
  );

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

  /* CONTROL: the mid-resolution steals must NOT have grown a prompt. Nobody is
     there to answer one when a summon resolves. */
  ok(!targetSpecFor('hitotsu-me-giant', 'onSummon'), 'CONTROL: Hitotsu-Me Giant still asks nothing');
  ok(!targetSpecFor('lady-of-faith', 'onSummon'), 'CONTROL: Lady of Faith still asks nothing');

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
  ok(
    effAtk(laid, laid.players[FOE].monsters[0]!, FOE) === baseAtkOf('battle-ox') + 300,
    "and still lifts the opponent's board too — the card says 'all'",
    `${effAtk(laid, laid.players[FOE].monsters[0]!, FOE)}`
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

/* The summary goes LAST, and there is nothing after it.
 *
 * Appending a batch of new tests below this line is the easy mistake — and it
 * was made: 279 lines of regressions ran *after* the count was printed, so the
 * suite reported "All rules regressions pass" and exited 0 with a real ❌ on
 * screen, hiding a half-finished fix. A check that cannot fail is worse than
 * no check; a suite that cannot report failure is worse still. `checks` is
 * asserted too, so deleting tests cannot quietly turn the battery green. */
const EXPECTED_AT_LEAST = 120;
if (checks < EXPECTED_AT_LEAST) {
  console.log(`\n❌ only ${checks} assertions ran, expected at least ${EXPECTED_AT_LEAST} — did something stop early?`);
  failures += 1;
}
console.log(failures ? `\n${failures} regression(s) FAILED` : `\nAll ${checks} rules regressions pass. ✅`);
if (failures) process.exitCode = 1;
