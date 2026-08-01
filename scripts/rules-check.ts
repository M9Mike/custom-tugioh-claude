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
import { applyAction, canActivateSetCard, canAttackWith, createDuel, effAtk, effFlags, tributesRequired } from '../src/game/engine';
import { CARDS } from '../src/game/cards';
import type { CardInstance, DuelAction, DuelState, PlayerId } from '../src/game/types';

const ME: PlayerId = 'p1';
const FOE: PlayerId = 'p2';

let uid = 0;
let failures = 0;

function ok(pass: boolean, label: string, detail = '') {
  console.log(`  ${pass ? '✅' : '❌'} ${label}${!pass && detail ? ` — ${detail}` : ''}`);
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

console.log(failures ? `\n${failures} regression(s) FAILED` : '\nAll rules regressions pass. ✅');
if (failures) process.exitCode = 1;
