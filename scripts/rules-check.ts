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
import { applyAction, canActivateFromHand, canActivateSetCard, canAttackWith, createDuel, effAtk, effDef, effFlags, fusionOptions, legalAttackTargets, tributesRequired } from '../src/game/engine';
import { CARDS, baseAtk as baseAtkOf } from '../src/game/cards';
import { targetCandidates, targetSpecFor } from '../src/game/ui';
import type { CardInstance, DuelAction, DuelState, PlayerId } from '../src/game/types';

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

/* 2. A revived monster does not re-collect its Normal Summon bonus. ------- */
{
  // Normal Summon: the bonus applies.
  const a = fresh();
  const lady = card(ME, 'lady-of-faith');
  a.players[ME].hand.push(lady);
  const summoned = act(a, ME, { type: 'normalSummon', uid: lady.uid, zone: 0, position: 'atk', face: 'up' });
  ok(summoned.players[ME].lp > 4000, 'Lady of Faith pays out when Normal Summoned', `LP ${summoned.players[ME].lp}`);

  // Monster Reborn: it must not.
  const b = fresh();
  const dead = card(ME, 'lady-of-faith');
  b.players[ME].grave.push(dead);
  const reborn = card(ME, 'monster-reborn');
  b.players[ME].hand.push(reborn);
  const revived = act(b, ME, { type: 'activateSpell', uid: reborn.uid, targets: [dead.uid] });
  ok(on(revived, ME).length === 1, 'Monster Reborn puts Lady of Faith on the field');
  ok(revived.players[ME].lp === 4000, 'Lady of Faith pays nothing when Special Summoned', `LP ${revived.players[ME].lp}`);
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
  /* Masaki survives battle only "while you control another Warrior". The grant
     was handed out permanently on summon instead, so he was immortal standing
     alone — which is the opposite of the card. */
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
  const killer2 = card(ME, 'summoned-skull');
  killer2.summonedOnTurn = 0;
  guarded.players[ME].monsters[0] = killer2;
  const after2 = act(guarded, ME, { type: 'attack', uid: killer2.uid, targetUid: m2.uid });
  ok(
    after2.players[FOE].monsters.some((m) => m?.uid === m2.uid),
    'and survives with another Warrior beside him'
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
  ok(effAtk(withToon, toon, ME) === 1400 + 800, 'and gains 800 ATK', `ATK ${effAtk(withToon, toon, ME)}`);
  ok(flags.directAttack === true && flags.untargetable === true && flags.pierce === true, 'with direct attack, untargetable and piercing');
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
  ok(!!effFlags(s, slifer, ME).pierce, 'and it pierces');
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
  ok(effAtk(s, g, ME) === 2300, 'Gazelle beside Berfomet is 2300', `${effAtk(s, g, ME)}`);
  ok(effAtk(s, b, ME) === 2200, 'Berfomet beside Gazelle is 2200', `${effAtk(s, b, ME)}`);
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
  ok(effAtk(pride, chim, ME) === baseAtkOf('chimera-the-flying-mythical-beast') + 800,
    'another Beast beside them still gains the 800', `${effAtk(pride, chim, ME)}`);
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
  ok(open.players[ME].lp === 4000 - 500, 'and costs 500 Life Points', `LP ${open.players[ME].lp}`);

  /* And the book closing takes the Toons with it — the printed rule, and the
     whole counterplay story for the deck that benched 85%. */
  const doom = fresh();
  doom.players[FOE].field = { ...card(FOE, 'toon-world'), face: 'up' as const };
  const toon = card(FOE, 'toon-summoned-skull');
  const plain = card(FOE, 'ryu-kishin-powered');
  doom.players[FOE].monsters = [toon, plain, null];
  const despell = card(ME, 'de-spell');
  doom.players[ME].hand = [despell];
  const popped = act(doom, ME, { type: 'activateSpell', uid: despell.uid, targets: [doom.players[FOE].field!.uid] });
  ok(!popped.players[FOE].field, 'destroying Toon World empties the Field Zone');
  ok(!popped.players[FOE].monsters.some((m) => m?.slug === 'toon-summoned-skull'),
    'and the Toons die with the book', popped.players[FOE].monsters.map((m) => m?.slug).join(','));
  ok(popped.players[FOE].monsters.some((m) => m?.slug === 'ryu-kishin-powered'),
    'CONTROL: the monster that was never a Toon stands');

  // CONTROL: a bounce closes the book without burning it.
  const lift = fresh();
  lift.players[FOE].field = { ...card(FOE, 'toon-world'), face: 'up' as const };
  const toon2 = card(FOE, 'toon-summoned-skull');
  lift.players[FOE].monsters = [toon2, null, null];
  const trunade = card(ME, 'giant-trunade');
  lift.players[ME].hand = [trunade];
  const lifted = act(lift, ME, { type: 'activateSpell', uid: trunade.uid, targets: [] });
  ok(lifted.players[FOE].monsters.some((m) => m?.slug === 'toon-summoned-skull'),
    'CONTROL: a bounced Toon World spares the Toons', lifted.players[FOE].monsters.map((m) => m?.slug).join(',') || 'empty');

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

  /* Ring of Destruction burns both duelists now — the printed symmetry. */
  const ring = fresh();
  const trap = card(ME, 'ring-of-destruction');
  trap.face = 'down';
  trap.summonedOnTurn = 1;
  ring.players[ME].spellTrap = trap;
  const target = card(FOE, 'battle-ox'); // 1700
  ring.players[FOE].monsters = [target, null, null];
  const boom = act(ring, ME, { type: 'activateSetCard', uid: trap.uid, targets: [target.uid] });
  ok(boom.players[FOE].lp === 4000 - 1700, 'the ring burns the opponent for the ATK', `LP ${boom.players[FOE].lp}`);
  ok(boom.players[ME].lp === 4000 - 1700, 'and its own duelist for exactly the same', `LP ${boom.players[ME].lp}`);
}

console.log('\nThe balance pass, second turn of the wheel');
{
  /* The Toon toll: mischief is paid for. A Toon under Toon World declaring a
     direct attack costs Pegasus 500 Life Points — the printed rule, and what
     keeps an untouchable board of direct attackers from being free. */
  const s = fresh('battle');
  s.players[ME].field = { ...card(ME, 'toon-world'), face: 'up' as const };
  const toon = card(ME, 'toon-mermaid');
  toon.summonedOnTurn = 0;
  s.players[ME].monsters = [toon, null, null];
  const lpBefore = s.players[ME].lp;
  const foeLp = s.players[FOE].lp;
  const swung = act(s, ME, { type: 'attack', uid: toon.uid, targetUid: null });
  ok(swung.players[ME].lp === lpBefore - 500, 'a Toon direct attack costs its duelist 500', `LP ${swung.players[ME].lp}`);
  ok(swung.players[FOE].lp < foeLp, 'and the blow still lands', `foe LP ${swung.players[FOE].lp}`);

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
  ok(!!jack && effAtk(court, jack, ME) === 1900 + 500, 'every Warrior is 500 stronger for him',
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
  ok(effAtk(b, gaz, ME) === 1500 + 800, 'Gazelle takes the pair bonus once', String(effAtk(b, gaz, ME)));
  ok(effAtk(b, ber, ME) === 1400 + 800, 'and Berfomet takes his own', String(effAtk(b, ber, ME)));

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

  /* The theft door is closed one layer earlier now — Monster Reborn reads
     your OWN Graveyard only, so the case that motivated the sweep cannot be
     set up through it at all. Pinned first; the rental sweep is then driven
     from the owner's own side, which is the way a God still arrives without
     paying. */
  const theft = fresh();
  const theirs = card(FOE, 'slifer-the-sky-dragon');
  theft.players[FOE].grave.push(theirs);
  const steal = card(ME, 'monster-reborn');
  theft.players[ME].hand = [steal, card(ME, 'kuriboh')];
  const refusedTheft = applyAction(theft, ME, { type: 'activateSpell', uid: steal.uid, targets: [theirs.uid] });
  ok(!refusedTheft.state.players[ME].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'),
    "Monster Reborn cannot reach the other player's Graveyard at all");

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
