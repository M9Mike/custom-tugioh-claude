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
import { applyAction, canActivateFromHand, canActivateSetCard, canAttackWith, createDuel, effAtk, effFlags, legalAttackTargets, tributesRequired } from '../src/game/engine';
import { CARDS } from '../src/game/cards';
import { targetSpecFor } from '../src/game/ui';
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
  const spare = card(ME, 'beaver-warrior');
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
    card(FOE, 'beaver-warrior'), // 1200, the strongest legal one
  ];
  s.players[FOE].hand = [];

  const after = act(s, ME, { type: 'attack', uid: killer.uid, targetUid: sangan.uid });
  const added = after.players[FOE].hand.map((c) => c.slug);

  ok(added.length === 1, 'Sangan adds exactly one card', `added ${added.join(', ') || 'nothing'}`);
  ok(
    added[0] === 'beaver-warrior',
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
  guarded.players[FOE].monsters[1] = card(FOE, 'celtic-guardian'); // another Warrior
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
  ok(grow('two-headed-king-rex') === rexEmpty + 400, 'Two-Headed King Rex counts only the Dinosaurs', `${grow('two-headed-king-rex')}`);

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
  ok(effAtk(s, fish, ME) === 3000, 'and 3000 once Umi is up, having been summoned first', `${effAtk(s, fish, ME)}`);
  ok(effFlags(s, fish, ME).pierce === true, 'with the piercing its text promises');
  ok(effAtk(s, beast, ME) === 2400 + 500 + 400, 'Amphibian Beast gains its 500 too', `${effAtk(s, beast, ME)}`);
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
  const elf = card(FOE, 'celtic-guardian');
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

console.log('\nSpellbinding Circle binds one monster, for as long as it is there');
{
  /* Three things at once, all reported: it froze *every* monster the opponent
     controlled rather than the attacker, it ran on a one-turn timer instead of
     on the card staying face-up, and the −700 was written into the monster so
     it survived the circle's destruction. */
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
  ok(effAtk(bound, held, FOE) === 2500 - 700, 'the bound monster loses 700 ATK', String(effAtk(bound, held, FOE)));
  /* The flag rather than `canAttackWith`, which is also false because the
     monster spent its attack declaring the one that was negated — it would
     have read as bound even with the lock removed. The next turn is the
     question a player is actually asking, so it is asked here too. */
  ok(!!effFlags(bound, held, FOE).cannotAttack, 'and is the one that cannot attack');
  ok(!effFlags(bound, free, FOE).cannotAttack, 'while the monster beside it is untouched');
  ok(canAttackWith(bound, FOE, free), 'and can still swing');

  const nextTurn = structuredClone(bound);
  for (const m of nextTurn.players[FOE].monsters) if (m) m.attacksUsed = 0;
  const stillHeld = nextTurn.players[FOE].monsters.find((m) => m?.uid === attacker.uid)!;
  ok(!canAttackWith(nextTurn, FOE, stillHeld), 'it is still bound on a later turn');
  ok(bound.players[ME].spellTrap?.uid === circle.uid, 'the circle stays face-up holding it', String(bound.players[ME].spellTrap?.slug));
  ok(bound.players[ME].spellTrap?.face === 'up', 'and is face-up');

  // Destroy the circle and the monster is whole again — the penalty was an
  // aura, never written into the card.
  const freed = structuredClone(nextTurn);
  freed.players[ME].spellTrap = null;
  const loose = freed.players[FOE].monsters.find((m) => m?.uid === attacker.uid)!;
  ok(effAtk(freed, loose, FOE) === 2500, 'destroy the circle and the ATK comes back', String(effAtk(freed, loose, FOE)));
  ok(canAttackWith(freed, FOE, loose), 'and it can attack again');

  /* The other half of the reported question: the circle follows its monster
     down. Taken off the board by battle rather than by Dark Hole, because the
     circle is sitting in my one Spell/Trap Zone and I cannot play a Spell
     while it is there — which is the point of the card. */
  const gone = structuredClone(bound);
  gone.active = ME;
  gone.phase = 'battle';
  const dragon = card(ME, 'blue-eyes-white-dragon'); // 3000 over its bound 1800
  gone.players[ME].monsters[0] = dragon;
  const killed = act(gone, ME, { type: 'attack', uid: dragon.uid, targetUid: attacker.uid });
  ok(!killed.players[FOE].monsters.some((m) => m?.uid === attacker.uid), 'the bound monster is destroyed');
  ok(killed.players[ME].spellTrap === null, 'and the circle leaves the field with it');
  ok(killed.players[ME].grave.some((c) => c.slug === 'spellbinding-circle'), 'landing in the Graveyard, not nowhere');
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
  ok(effAtk(s, mine, ME) === 1800 + 400 + 800, 'your own WATER monster gains from your Umi', String(effAtk(s, mine, ME)));
  ok(effAtk(s, theirs, FOE) === plain + 400 + 800, 'and so does theirs — it is the same sea', String(effAtk(s, theirs, FOE)));

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
  ok(bound.players[ME].spellTrap?.equippedTo === s.players[FOE].monsters[0]!.uid, 'and the circle lands on the attacker');
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
