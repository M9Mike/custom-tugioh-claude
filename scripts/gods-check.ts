/**
 * The five things reported from a real duel, driven through the real engine.
 *
 *   npx tsx scripts/gods-check.ts
 *
 * Four of them are engine rules and are played out here as actual actions —
 * a Dark Hole really activated, an attack really declared, a trap window
 * really opened. The fifth (the victory splash) is in `Duel.tsx` and is
 * covered by `npm run e2e` in a browser; its condition is asserted here as
 * far as pure code can reach.
 *
 * Every assertion below was run against the unfixed engine first and every one
 * of them was red there. A regression written after a fix, green against the
 * fix, has proven nothing yet.
 */
import { applyAction, canAttackWith, createDuel, effAtk, effDef, ignitionOptions, maxAttacks, tributeFodder } from '../src/game/engine';
import { CARDS } from '../src/game/cards';
import type { CardInstance, DuelState, PlayerId } from '../src/game/types';

const ME: PlayerId = 'p1';
const FOE: PlayerId = 'p2';
let checks = 0;
let bad = 0;

function ok(cond: boolean, what: string, detail = '') {
  checks += 1;
  if (!cond) bad += 1;
  console.log(`  ${cond ? '✅' : '❌'} ${what}${cond || !detail ? '' : ` — ${detail}`}`);
}

function fresh(phase: 'main' | 'battle' = 'main'): DuelState {
  const s = createDuel({
    seed: 11,
    p1: { duelistId: 'yami', name: 'Yami' },
    p2: { duelistId: 'kaiba', name: 'Kaiba' },
    firstPlayer: 'p1',
  });
  s.turn = 4;
  s.phase = phase;
  s.active = ME;
  for (const pid of [ME, FOE] as PlayerId[]) {
    s.players[pid].monsters = [null, null, null];
    s.players[pid].spellTrap = null;
    s.players[pid].field = null;
    s.players[pid].hand = [];
  }
  return s;
}

let n = 0;
function card(owner: PlayerId, slug: string): CardInstance {
  n += 1;
  return {
    uid: `c${n}`, slug, owner, face: 'up', position: 'atk',
    atkMod: 0, defMod: 0, turnAtkMod: 0, turnDefMod: 0, counters: 0,
    equips: [], equippedTo: undefined, flags: {}, turnFlags: {},
    summonedOnTurn: 0, attacksUsed: 0, effectUsedOnTurn: -1,
    absorbed: [], isToken: false,
  };
}

/* A rejected action returns the state untouched, so a check driven through one
   passes by never happening — the "Tornado Wall is not offered" assertion did
   exactly that on its first run, because the attack behind it was illegal and
   no window opened at all. Nothing here may fail quietly. */
function act(s: DuelState, pid: PlayerId, a: Parameters<typeof applyAction>[2]): DuelState {
  const r = applyAction(s, pid, a);
  if (r.error) throw new Error(`${a.type} rejected: ${r.error}`);
  return r.state;
}
const on = (s: DuelState, pid: PlayerId) => s.players[pid].monsters.filter((m): m is CardInstance => !!m);

/* ------------------------------------------------------------------ */
console.log('\nA God is destroyed by a bigger body and by nothing else');
{
  /* The report, verbatim: "WTF SLIFER GOT DESTROYED BY BLACK HOLE". Dark Hole
     names no target, so it never went near `isProtectedTarget` — it arrives
     straight at `destroyCard`, which is why the God's untargetable aura did
     not save it. */
  const s = fresh();
  const slifer = card(ME, 'slifer-the-sky-dragon');
  s.players[ME].monsters = [slifer, card(ME, 'kuriboh'), null];
  s.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  const hole = card(FOE, 'dark-hole');
  s.players[FOE].hand = [hole];
  s.active = FOE;
  const swept = act(s, FOE, { type: 'activateSpell', uid: hole.uid, targets: [] });
  ok(on(swept, ME).some((m) => m.slug === 'slifer-the-sky-dragon'),
    "their Dark Hole does not touch Slifer",
    on(swept, ME).map((m) => m.slug).join(',') || 'the God is gone');
  ok(!on(swept, ME).some((m) => m.slug === 'kuriboh') && on(swept, FOE).length === 0,
    'CONTROL: it still sweeps every mortal on both sides',
    `mine ${on(swept, ME).length}, theirs ${on(swept, FOE).length}`);

  /* And your own sweep is no different. `isProtectedTarget` exempts the
     actor's own side so a protection cannot stop its owner using their own
     card — which is the exact hole a two-sided sweep fell through. */
  const mine = fresh();
  const god2 = card(ME, 'slifer-the-sky-dragon');
  mine.players[ME].monsters = [god2, null, null];
  mine.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  const ownHole = card(ME, 'dark-hole');
  mine.players[ME].hand = [ownHole];
  const own = act(mine, ME, { type: 'activateSpell', uid: ownHole.uid, targets: [] });
  ok(on(own, ME).some((m) => m.slug === 'slifer-the-sky-dragon'),
    'and neither does your own',
    on(own, ME).map((m) => m.slug).join(',') || 'the God is gone');

  /* A targeted removal was already refused, and stays refused. */
  const ring = fresh();
  const god3 = card(ME, 'obelisk-the-tormentor');
  ring.players[ME].monsters = [god3, null, null];
  ring.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  const fissure = card(FOE, 'fissure');
  ring.players[FOE].hand = [fissure];
  ring.active = FOE;
  const after = applyAction(ring, FOE, { type: 'activateSpell', uid: fissure.uid, targets: [god3.uid] });
  ok(on(after.state, ME).some((m) => m.slug === 'obelisk-the-tormentor'),
    'a targeted removal cannot reach Obelisk either',
    after.error ?? on(after.state, ME).map((m) => m.slug).join(','));

  /* The one thing that does work: a bigger body. */
  const war = fresh('battle');
  const god4 = card(FOE, 'slifer-the-sky-dragon');
  god4.atkMod = -8000; // a thin hand, so a mortal can out-fight it
  war.players[FOE].monsters = [god4, null, null];
  const killer = card(ME, 'blue-eyes-white-dragon');
  war.players[ME].monsters = [killer, null, null];
  const fought = act(war, ME, { type: 'attack', uid: killer.uid, targetUid: god4.uid });
  ok(!on(fought, FOE).some((m) => m.slug === 'slifer-the-sky-dragon'),
    'CONTROL: a bigger ATK in battle still kills it — that is the only answer',
    on(fought, FOE).map((m) => m.slug).join(',') || 'gone');
}

/* ------------------------------------------------------------------ */
console.log('\nA God attacks through Swords, the Cage and everything else');
{
  /* Swords of Revealing Light freezes the monsters; the Steelcage takes the
     Battle Phase itself away, one level higher, so both doors need the
     exemption or the God never reaches the one it has. */
  const s = fresh('battle');
  const god = card(ME, 'slifer-the-sky-dragon');
  const mortal = card(ME, 'kuriboh');
  s.players[ME].monsters = [god, mortal, null];
  s.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  s.ongoing.push({ id: 'f1', source: 'swords-of-revealing-light', kind: 'freezeMonsters', target: ME, turns: 3 });
  ok(canAttackWith(s, ME, god), 'Swords of Revealing Light does not hold a God down');
  ok(!canAttackWith(s, ME, mortal), 'CONTROL: it still holds every mortal beside it');

  const caged = fresh();
  const god2 = card(ME, 'slifer-the-sky-dragon');
  caged.players[ME].monsters = [god2, null, null];
  caged.ongoing.push({ id: 'f2', source: 'nightmare-s-steelcage', kind: 'skipBattlePhase', target: ME, turns: 2 });
  const entered = applyAction(caged, ME, { type: 'toPhase', phase: 'battle' });
  ok(entered.state.phase === 'battle', 'the Steelcage does not keep a God out of the Battle Phase', entered.error ?? '');

  const noGod = fresh();
  noGod.players[ME].monsters = [card(ME, 'kuriboh'), null, null];
  noGod.ongoing.push({ id: 'f3', source: 'nightmare-s-steelcage', kind: 'skipBattlePhase', target: ME, turns: 2 });
  const blocked = applyAction(noGod, ME, { type: 'toPhase', phase: 'battle' });
  ok(blocked.state.phase !== 'battle', 'CONTROL: without one, the Cage still shuts the Battle Phase');

  /* A face-down God is a card lying face-down, and does nothing — including
     this. */
  const hidden = fresh();
  const asleep = card(ME, 'slifer-the-sky-dragon');
  asleep.face = 'down';
  hidden.players[ME].monsters = [asleep, null, null];
  hidden.ongoing.push({ id: 'f4', source: 'nightmare-s-steelcage', kind: 'skipBattlePhase', target: ME, turns: 2 });
  ok(applyAction(hidden, ME, { type: 'toPhase', phase: 'battle' }).state.phase !== 'battle',
    'CONTROL: a face-down God opens nothing — it is not on the field yet');
}

/* ------------------------------------------------------------------ */
console.log('\nRevival Jam comes back lying down, and brings company');
{
  const s = fresh();
  const jam = card(ME, 'revival-jam');
  s.players[ME].monsters = [jam, null, null];
  s.players[ME].grave = [card(ME, 'magician-of-faith'), card(ME, 'battle-ox')];
  s.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  const hole = card(FOE, 'dark-hole');
  s.players[FOE].hand = [hole];
  s.active = FOE;
  const after = act(s, FOE, { type: 'activateSpell', uid: hole.uid, targets: [] });
  const back = on(after, ME);
  ok(back.length === 2, 'it revives itself and one other body', `${back.length} on the board`);
  ok(back.every((m) => m.position === 'def'), 'both arrive in Defense Position',
    back.map((m) => `${m.slug}:${m.position}`).join(' '));
  ok(back.every((m) => m.face === 'up'), 'and both arrive face-up',
    back.map((m) => `${m.slug}:${m.face}`).join(' '));
}

/* ------------------------------------------------------------------ */
console.log('\nTornado Wall is not offered without Umi');
{
  /* Reported as "Tornado Wall activated without Umi". It was: the offer asked
     whether the cost was payable and never whether the condition was met, so
     the card was announced, its one condition-gated effect skipped, and the
     card spent for nothing. */
  /* `anyOpponentTurn` opens when the opponent *enters the Battle Phase*, not
     when they declare an attack — so the window has to be opened the way the
     card really sees it. */
  const dry = fresh();
  const wall = card(ME, 'tornado-wall');
  wall.face = 'down';
  wall.summonedOnTurn = 0;
  dry.players[ME].spellTrap = wall;
  dry.players[ME].monsters = [card(ME, 'kuriboh'), null, null];
  dry.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  dry.active = FOE;
  const swung = act(dry, FOE, { type: 'toPhase', phase: 'battle' });
  ok(!swung.pending || !swung.pending.options.includes(wall.uid),
    'with no Umi anywhere it is never offered',
    swung.pending ? `offered: ${swung.pending.options.length}` : 'no window');
  ok(swung.players[ME].spellTrap?.uid === wall.uid,
    'CONTROL: so the card is still in the zone, unspent');

  const sea = fresh();
  const wall2 = card(ME, 'tornado-wall');
  wall2.face = 'down';
  wall2.summonedOnTurn = 0;
  sea.players[ME].spellTrap = wall2;
  sea.players[ME].field = { ...card(ME, 'umi'), face: 'up' as const };
  sea.players[ME].monsters = [card(ME, 'kuriboh'), null, null];
  sea.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  sea.active = FOE;
  const wet = act(sea, FOE, { type: 'toPhase', phase: 'battle' });
  ok(!!wet.pending && wet.pending.options.includes(wall2.uid),
    'CONTROL: with Umi down it is offered exactly as it should be',
    wet.pending ? `offered: ${wet.pending.options.length}` : 'no window at all');
}

/* ------------------------------------------------------------------ */
console.log('\nThe duel is over before the board has said so');
{
  /* The board's half of this lives in `Duel.tsx` and is checked in a browser
     by `npm run e2e`. What is checkable here is the thing the fix depends on:
     the killing blow really is still sitting unplayed in `state.anims` on the
     same commit that carries the winner, so a win screen that waits on
     `unspoken` has something to wait for. If this ever came back empty the
     client-side guard would be waiting on nothing. */
  const s = fresh('battle');
  s.players[FOE].lp = 100;
  const killer = card(ME, 'blue-eyes-white-dragon');
  s.players[ME].monsters = [killer, null, null];
  const over = act(s, ME, { type: 'attack', uid: killer.uid, targetUid: null });
  ok(over.winner === ME, 'the duel really ends on that swing', String(over.winner));
  ok(over.anims.length > 0,
    'and the blow that ended it arrives in the same commit, still unplayed',
    `${over.anims.length} beats`);
}

/* ------------------------------------------------------------------ */
console.log('\nNor is a God stolen — by the road round the back either');
{
  /* Reported as "Mirror Gate worked on obelisk 🤪".
   *
   * The decree lists stealing among the things no card effect may do, and
   * `resolveTargets` enforces it — on the road it walks. `swapControl` has two
   * that it does not: when nothing was named it falls back to the attacking
   * monster, and the body going back the other way is read the same way. Both
   * reach `findOnField` directly, so both stepped round the guard.
   *
   * Which is why it looked fine until it did not: with an ordinary monster
   * standing beside the God the picker filtered the God out and the card
   * behaved. Obelisk attacking *alone* left the fallback as the only road.
   */
  const alone = () => {
    const s = fresh('battle');
    s.active = FOE;
    const wall = card(ME, 'elemental-hero-clayman');
    s.players[ME].monsters = [wall, null, null];
    const gate = { ...card(ME, 'mirror-gate'), face: 'down' as const };
    s.players[ME].spellTrap = gate;
    const god = card(FOE, 'obelisk-the-tormentor');
    s.players[FOE].monsters = [god, null, null];
    let out = act(s, FOE, { type: 'attack', uid: god.uid, targetUid: wall.uid });
    out = act(out, ME, { type: 'respondTrap', uid: gate.uid });
    let g = 0;
    while (out.pending && g++ < 8) {
      const pd = out.pending;
      out = act(out, pd.player, pd.kind === 'choose'
        ? { type: 'chooseCard', uids: pd.options.length ? [pd.options[0]] : [] }
        : { type: 'respondTrap', uid: null });
    }
    return { out, god };
  };
  const { out, god } = alone();
  ok(!on(out, ME).some((m) => m.uid === god.uid),
    'Mirror Gate cannot take a God that attacked alone',
    on(out, ME).map((m) => m.slug).join(',') || '(empty)');
  ok(on(out, FOE).some((m) => m.uid === god.uid),
    'and it is still standing where it was',
    on(out, FOE).map((m) => m.slug).join(',') || '(empty)');

  /* CONTROL, and the point of it: the card is not simply broken. An ordinary
     attacker on the same road is taken exactly as before. */
  const s2 = fresh('battle');
  s2.active = FOE;
  const wall2 = card(ME, 'elemental-hero-clayman');
  s2.players[ME].monsters = [wall2, null, null];
  const gate2 = { ...card(ME, 'mirror-gate'), face: 'down' as const };
  s2.players[ME].spellTrap = gate2;
  const skull = card(FOE, 'summoned-skull');
  s2.players[FOE].monsters = [skull, null, null];
  let mortal = act(s2, FOE, { type: 'attack', uid: skull.uid, targetUid: wall2.uid });
  mortal = act(mortal, ME, { type: 'respondTrap', uid: gate2.uid });
  let g2 = 0;
  while (mortal.pending && g2++ < 8) {
    const pd = mortal.pending;
    mortal = act(mortal, pd.player, pd.kind === 'choose'
      ? { type: 'chooseCard', uids: pd.options.length ? [pd.options[0]] : [] }
      : { type: 'respondTrap', uid: null });
  }
  ok(on(mortal, ME).some((m) => m.uid === skull.uid),
    'CONTROL: an ordinary attacker on that same road is still taken',
    on(mortal, ME).map((m) => m.slug).join(',') || '(empty)');

  /* And the other half of the exchange. The decree sits above the line that
     lets a player's own cards touch their own monsters, so a God of *mine* is
     not handed over either. */
  const s3 = fresh('battle');
  s3.active = FOE;
  const myGod = card(ME, 'obelisk-the-tormentor');
  s3.players[ME].monsters = [myGod, null, null];
  const gate3 = { ...card(ME, 'mirror-gate'), face: 'down' as const };
  s3.players[ME].spellTrap = gate3;
  const ox = card(FOE, 'battle-ox');
  s3.players[FOE].monsters = [ox, null, null];
  let given = act(s3, FOE, { type: 'attack', uid: ox.uid, targetUid: myGod.uid });
  given = act(given, ME, { type: 'respondTrap', uid: gate3.uid });
  let g3 = 0;
  while (given.pending && g3++ < 8) {
    const pd = given.pending;
    given = act(given, pd.player, pd.kind === 'choose'
      ? { type: 'chooseCard', uids: pd.options.length ? [pd.options[0]] : [] }
      : { type: 'respondTrap', uid: null });
  }
  ok(on(given, ME).some((m) => m.uid === myGod.uid),
    'and a God of my own is not handed across the table either',
    on(given, FOE).map((m) => m.slug).join(',') || '(empty)');
}

/* ------------------------------------------------------------------ */
/* Ra eats                                                             */
/* ------------------------------------------------------------------ */
{
  console.log('\nThe sun feeds on its own board');
  const RA = 'the-winged-dragon-of-ra';
  const ra = (s: DuelState, uid: string) => s.players[ME].monsters.find((m) => m?.uid === uid)!;
  const button = (s: DuelState, uid: string, name: RegExp) =>
    ignitionOptions(s, ME, ra(s, uid)).find((o) => name.test(o.label));

  let s = fresh();
  const god = card(ME, RA);
  const bull = card(ME, 'battle-ox');     // 1700 / 1000
  const elf = card(ME, 'mystical-elf');   //  800 / 2000
  s.players[ME].monsters = [god, bull, elf];
  ok(effAtk(s, god, ME) === 0 && effDef(s, god, ME) === 0,
    'RA: a Ra put down by hand stands at nothing', `${effAtk(s, god, ME)}/${effDef(s, god, ME)}`);

  s = act(s, ME, { type: 'ignition', uid: god.uid, effectIndex: button(s, god.uid, /Feed the sun/)!.index, targets: [bull.uid] });
  /* 1700 + 1000 off the Ox, and the Ox is then a monster in the Graveyard,
     which Ra's other aura pays 300 for. Both halves, measured. */
  ok(effAtk(s, ra(s, god.uid), ME) === 1700 + 300,
    'RA: it swallows the Ox and stands at what the Ox was worth', String(effAtk(s, ra(s, god.uid), ME)));
  ok(effDef(s, ra(s, god.uid), ME) === 1000,
    'RA: and defends with what the Ox was defending with', String(effDef(s, ra(s, god.uid), ME)));

  /* Unlimited. The button is still there and it still works — this is the
     clause the owner asked for by name. */
  const again = button(s, god.uid, /Feed the sun/);
  ok(!!again, 'RA: and the mouth is open again in the same turn');
  s = act(s, ME, { type: 'ignition', uid: god.uid, effectIndex: again!.index, targets: [elf.uid] });
  ok(effAtk(s, ra(s, god.uid), ME) === 1700 + 800 + 600,
    'RA: twice in one turn', String(effAtk(s, ra(s, god.uid), ME)));
  ok(effDef(s, ra(s, god.uid), ME) === 1000 + 2000,
    'RA: and both mouthfuls of DEF with it', String(effDef(s, ra(s, god.uid), ME)));
  ok(!button(s, god.uid, /Feed the sun/),
    'RA: CONTROL: with nothing left beside it the button is gone');

  /* The easter egg: no filter, so the other two Gods are food. Everything else
     in this game that eats bodies writes `excludeType: 'Divine-Beast'`. */
  let feast = fresh();
  const sun = card(ME, RA);
  const sky = card(ME, 'slifer-the-sky-dragon');
  const earth = card(ME, 'obelisk-the-tormentor'); // 4000 / 4000
  feast.players[ME].monsters = [sun, sky, earth];
  feast.players[ME].hand = [card(ME, 'kuriboh'), card(ME, 'kuriboh')]; // Slifer is 2000/2000
  ok(effAtk(feast, sky, ME) === 2000, 'RA: Slifer stands at 2000 on a hand of two', String(effAtk(feast, sky, ME)));
  /* Asked before it is used, so a Ra that has been given the Divine-Beast
     filter every other eater carries reports it here rather than throwing on
     the line below — a check that dies says less than one that answers. */
  const menu = () => tributeFodder(feast, ME, CARDS[RA].effects.find((e) => /Feed the sun/.test(e.label ?? ''))!, sun.uid);
  ok(menu().some((m) => m.uid === sky.uid) && menu().some((m) => m.uid === earth.uid),
    'RA: the other two Gods are on the menu',
    menu().map((m) => m.slug).join(',') || '(nothing)');
  feast = act(feast, ME, { type: 'ignition', uid: sun.uid, effectIndex: button(feast, sun.uid, /Feed the sun/)!.index, targets: [sky.uid] });
  feast = act(feast, ME, { type: 'ignition', uid: sun.uid, effectIndex: button(feast, sun.uid, /Feed the sun/)!.index, targets: [earth.uid] });
  ok(effAtk(feast, ra(feast, sun.uid), ME) === 2000 + 4000 + 600,
    'RA: it swallows Slifer and Obelisk both', String(effAtk(feast, ra(feast, sun.uid), ME)));
  ok(effDef(feast, ra(feast, sun.uid), ME) === 2000 + 4000,
    'RA: and everything they were defending with', String(effDef(feast, ra(feast, sun.uid), ME)));
  ok(!feast.players[ME].monsters.some((m) => m?.uid === sky.uid || m?.uid === earth.uid),
    'RA: and they are gone from the board');

  /* CONTROL: Obelisk, which does carry the filter, still cannot. */
  const barred = fresh();
  const ob = card(ME, 'obelisk-the-tormentor');
  barred.players[ME].monsters = [ob, card(ME, 'slifer-the-sky-dragon'), card(ME, RA)];
  ok(ignitionOptions(barred, ME, ob).length === 0,
    'RA: CONTROL: Obelisk beside two Gods can feed on neither',
    ignitionOptions(barred, ME, ob).map((o) => o.label).join(',') || '(none)');
}

/* ------------------------------------------------------------------ */
/* One clock per button                                                */
/* ------------------------------------------------------------------ */
{
  console.log('\nTwo "once per turn" clauses are two limits');
  const RA = 'the-winged-dragon-of-ra';
  const labels = (s: DuelState, c: CardInstance) => ignitionOptions(s, ME, c).map((o) => o.label);

  /* Reported: "Ra now if it activates one effect can't activate another". The
     clock lived on the card, so any one of its three buttons spent all of
     them. */
  let s = fresh();
  const god = card(ME, RA);
  const fodder = card(ME, 'battle-ox');
  s.players[ME].monsters = [god, fodder, null];
  s.players[FOE].monsters = [card(FOE, 'summoned-skull'), null, null];
  const live = () => s.players[ME].monsters.find((m) => m?.uid === god.uid)!;
  ok(labels(s, live()).length === 3, 'CLOCK: Ra offers all three', labels(s, live()).join(' / '));

  const at = (name: RegExp) => ignitionOptions(s, ME, live()).find((o) => name.test(o.label))!;
  s = act(s, ME, { type: 'ignition', uid: god.uid, effectIndex: at(/God Phoenix/).index });
  ok(s.players[FOE].monsters.every((m) => !m), 'CLOCK: the Phoenix burns their field');
  ok(labels(s, live()).length === 2, 'CLOCK: and the other two are still there',
    labels(s, live()).join(' / ') || '(none)');
  ok(!labels(s, live()).some((l) => /God Phoenix/.test(l)),
    'CLOCK: CONTROL: but the Phoenix itself is spent for the turn');

  s = act(s, ME, { type: 'ignition', uid: god.uid, effectIndex: at(/Feed the sun/).index, targets: [fodder.uid] });
  ok(labels(s, live()).some((l) => /Pour everything/.test(l)),
    'CLOCK: a third button after the other two', labels(s, live()).join(' / ') || '(none)');
  s = act(s, ME, { type: 'ignition', uid: god.uid, effectIndex: at(/Pour everything/).index });
  ok(s.players[ME].lp === 1, 'CLOCK: and it pours', `LP ${s.players[ME].lp}`);

  /* CONTROL: Obelisk's sentence really is "either … or …", and it keeps the
     one clock its text asks for. */
  let ob = fresh();
  const tormentor = card(ME, 'obelisk-the-tormentor');
  ob.players[ME].monsters = [tormentor, card(ME, 'battle-ox'), card(ME, 'mystical-elf')];
  const obLive = () => ob.players[ME].monsters.find((m) => m?.uid === tormentor.uid)!;
  ok(labels(ob, obLive()).length === 2, 'CLOCK: CONTROL: Obelisk offers both of his');
  const soul = ignitionOptions(ob, ME, obLive()).find((o) => /Soul Energy/.test(o.label))!;
  ob = act(ob, ME, { type: 'ignition', uid: tormentor.uid, effectIndex: soul.index, targets: [ob.players[ME].monsters[1]!.uid] });
  /* The zone the soul left, filled again before the question is asked.
     Without it this pin proved nothing: Soul Energy eats one of the two bodies
     beside Obelisk, the Fist of Fate wants two, and a board of one refuses it
     on the *cost* — so the count came back 0 whether the clock was shared or
     not, and deleting the clock left this line green. Three zones means either
     button starves the other by construction, so the fodder is put back and
     the only thing left standing between Obelisk and his second button is the
     clock itself. */
  const freed = ob.players[ME].monsters.findIndex((m) => !m);
  ob.players[ME].monsters[freed] = card(ME, 'battle-ox');
  ok(ignitionOptions(ob, ME, obLive()).length === 0,
    'CLOCK: CONTROL: and pressing either spends both — "once per turn, EITHER"',
    labels(ob, obLive()).join(' / ') || '(none)');
}

/* ------------------------------------------------------------------ */
/* The pecking order                                                   */
/* ------------------------------------------------------------------ */
{
  console.log('\nAbove the Gods, the sun');
  const RA = 'the-winged-dragon-of-ra';

  /* Slifer's second mouth drains every monster the other player Summons and
     destroys what it empties. It reaches Ra like anything else, because the
     decree voids protection against a Divine-Beast and Slifer is one — which
     made the three Gods equals and the duel a race. Ra outranks them now. */
  let s = fresh();
  s.players[FOE].monsters = [card(FOE, 'slifer-the-sky-dragon'), null, null];
  s.players[FOE].hand = [card(FOE, 'kuriboh'), card(FOE, 'kuriboh'), card(FOE, 'kuriboh')];
  const god = card(ME, RA);
  s.players[ME].hand = [god];
  /* Three Kuribohs on purpose, so the God this pays for is a *small* one:
     900 off the Tributes and 900 off the pile they land in is 1800, and the
     mouth's 2000 would take it under and destroy it outright. A Ra paid for
     with a real board survives the drain by arithmetic, which would leave the
     line below passing on a rule that had been deleted. */
  s.players[ME].monsters = [card(ME, 'kuriboh'), card(ME, 'kuriboh'), card(ME, 'kuriboh')];
  const paid = s.players[ME].monsters.map((m) => m!.uid);
  s = act(s, ME, { type: 'normalSummon', uid: god.uid, zone: 0, position: 'atk', face: 'up', tributes: paid });
  const stands = s.players[ME].monsters.find((m) => m?.uid === god.uid);
  ok(!!stands, 'ORDER: Slifer\'s second mouth cannot reach Ra',
    s.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  /* Not merely alive — untouched. A God that survived at 2000 less is a God
     the mouth reached, and "alive" alone would pass on one that was simply too
     big to kill. 300 × 3 off the Tributes, 300 × 3 off the pile. */
  ok(!!stands && effAtk(s, stands, ME) === 900 + 900,
    'ORDER: and does not take 2000 off it on the way past',
    stands ? String(effAtk(s, stands, ME)) : '(gone)');

  /* CONTROL: the mouth still works on everything else, which is the half that
     proves the pin is reading the rule rather than a broken Slifer. */
  let c = fresh();
  c.players[FOE].monsters = [card(FOE, 'slifer-the-sky-dragon'), null, null];
  c.players[FOE].hand = [card(FOE, 'kuriboh')];
  const bull = card(ME, 'battle-ox'); // 1700, and 2000 takes it under
  c.players[ME].hand = [bull];
  c = act(c, ME, { type: 'normalSummon', uid: bull.uid, zone: 0, position: 'atk', face: 'up' });
  ok(!c.players[ME].monsters.some((m) => m?.uid === bull.uid),
    'ORDER: CONTROL: an ordinary body is drained to nothing and destroyed',
    c.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));

  /* And the other direction: Ra's own effect reaches both of them. */
  let burn = fresh();
  const sun = card(ME, RA);
  burn.players[ME].monsters = [sun, null, null];
  burn.players[FOE].monsters = [card(FOE, 'slifer-the-sky-dragon'), card(FOE, 'obelisk-the-tormentor'), null];
  const phoenix = ignitionOptions(burn, ME, sun).find((o) => /God Phoenix/.test(o.label))!;
  burn = act(burn, ME, { type: 'ignition', uid: sun.uid, effectIndex: phoenix.index });
  ok(burn.players[FOE].monsters.every((m) => !m),
    'ORDER: and the God Phoenix burns Slifer and Obelisk off the board',
    burn.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));
}

/* ------------------------------------------------------------------ */
/* A limitless blow does not break the sun                             */
/* ------------------------------------------------------------------ */
{
  console.log('\nThe Fist of Fate against Ra');
  const RA = 'the-winged-dragon-of-ra';
  const fistInto = (victim: CardInstance) => {
    let s = fresh('main');
    s.active = FOE;
    const ob = card(FOE, 'obelisk-the-tormentor');
    s.players[FOE].monsters = [ob, card(FOE, 'kuriboh'), card(FOE, 'battle-ox')];
    s.players[ME].monsters = [victim, null, null];
    /* Read off the board rather than written down: this file's `fresh` does not
       touch Life Points, so a number in the assertion would be a pin about the
       starting total and not about the Fist. */
    const before = s.players[ME].lp;
    const fist = ignitionOptions(s, FOE, ob).find((o) => /Fist of Fate/.test(o.label))!;
    s = act(s, FOE, {
      type: 'ignition', uid: ob.uid, effectIndex: fist.index,
      targets: [s.players[FOE].monsters[1]!.uid, s.players[FOE].monsters[2]!.uid],
    });
    s = act(s, FOE, { type: 'toPhase', phase: 'battle' });
    return { before, after: act(s, FOE, { type: 'attack', uid: ob.uid, targetUid: victim.uid }) };
  };

  const sun = card(ME, RA);
  sun.atkMod = 3000;
  const { before: sunLp, after: held } = fistInto(sun);
  ok(held.players[ME].monsters.some((m) => m?.uid === sun.uid),
    'FIST: a limitless swing does not destroy Ra',
    held.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
  ok(held.players[ME].lp === sunLp && !held.winner,
    'FIST: and its controller is billed nothing for the attack',
    `LP ${sunLp} -> ${held.players[ME].lp}, winner ${held.winner ?? '(none)'}`);

  /* CONTROL: the Fist is still the Fist against anything else — and against a
     body this size it is the duel, which is exactly why the sun needs the
     clause. */
  const mortal = card(ME, 'summoned-skull');
  const { after: flat } = fistInto(mortal);
  ok(!flat.players[ME].monsters.some((m) => m?.uid === mortal.uid),
    'FIST: CONTROL: it still flattens anything that is not the sun');
  ok(flat.winner === FOE, 'FIST: CONTROL: and takes the duel with it', flat.winner ?? '(none)');

  /* CONTROL: an ordinary Obelisk swing — no Fist — kills Ra like any bigger
     body, which is the one answer to a God the decree deliberately leaves. */
  let plain = fresh('battle');
  plain.active = FOE;
  const ob2 = card(FOE, 'obelisk-the-tormentor'); // a flat 4000
  plain.players[FOE].monsters = [ob2, null, null];
  const small = card(ME, RA); // 0 ATK, nothing eaten
  plain.players[ME].monsters = [small, null, null];
  plain = act(plain, FOE, { type: 'attack', uid: ob2.uid, targetUid: small.uid });
  ok(!plain.players[ME].monsters.some((m) => m?.uid === small.uid),
    'FIST: CONTROL: and a bigger body with no Fist still breaks it',
    plain.players[ME].monsters.map((m) => m?.slug ?? '-').join(','));
}

/* ------------------------------------------------------------------ */
/* Fused with Ra                                                       */
/* ------------------------------------------------------------------ */
{
  console.log('\nWhat the sun becomes once it has eaten');
  const RA = 'the-winged-dragon-of-ra';
  const live = (s: DuelState, uid: string) => s.players[ME].monsters.find((m) => m?.uid === uid)!;
  /* "Fused with Ra" is the mouth: nothing in this game fuses with a God any
     other way, and the two clauses below hang off a meal rather than off the
     God being on the table at all. */
  const feed = (s: DuelState, raUid: string, foodUid: string) => {
    const b = ignitionOptions(s, ME, live(s, raUid)).find((o) => /Feed the sun/.test(o.label))!;
    return act(s, ME, { type: 'ignition', uid: raUid, effectIndex: b.index, targets: [foodUid] });
  };

  /* One swing per monster across the table. */
  let s = fresh();
  const god = card(ME, RA);
  const food = card(ME, 'battle-ox'); // 1700 / 1000
  s.players[ME].monsters = [god, food, null];
  s.players[FOE].monsters = [card(FOE, 'battle-ox'), card(FOE, 'kuriboh'), card(FOE, 'mystical-elf')];
  ok(maxAttacks(s, live(s, god.uid), ME) === 1,
    'FUSED: CONTROL: a Ra nobody has fed gets one swing like anything else',
    String(maxAttacks(s, live(s, god.uid), ME)));
  s = feed(s, god.uid, food.uid);
  ok(live(s, god.uid).swallowed === 1, 'FUSED: the Ox goes into it', String(live(s, god.uid).swallowed ?? 0));
  ok(maxAttacks(s, live(s, god.uid), ME) === 3,
    'FUSED: and it swings once at each of their three',
    String(maxAttacks(s, live(s, god.uid), ME)));

  /* And really takes all three, rather than merely being allowed to. */
  s.phase = 'battle';
  for (const t of s.players[FOE].monsters.filter(Boolean).map((m) => m!.uid)) {
    if (!s.players[FOE].monsters.some((m) => m?.uid === t)) continue;
    /* Asked rather than assumed. `act` throws on a refusal, which with the
       sweep deleted takes the whole battery down on the second swing and
       reports one crash instead of a fault list — and this file's rule is that
       a fault can be looked at rather than reasoned about. */
    const body = live(s, god.uid);
    if (body.attacksUsed >= maxAttacks(s, body, ME)) break;
    s = act(s, ME, { type: 'attack', uid: god.uid, targetUid: t });
  }
  ok(s.players[FOE].monsters.every((m) => !m),
    'FUSED: their whole board goes in one Battle Phase',
    s.players[FOE].monsters.map((m) => m?.slug ?? '-').join(','));

  /* The other clause: nothing but a blow reaches its owner. */
  let burn = fresh();
  const sun = card(ME, RA);
  const meal = card(ME, 'battle-ox');
  burn.players[ME].monsters = [sun, meal, null];
  const witch = card(FOE, 'dunames-dark-witch'); // 400 to the other player on arrival
  burn.players[FOE].hand = [witch];

  /* Read off the board rather than written down — this file's `fresh` does not
     touch Life Points, and a number in the assertion would be a pin about the
     starting total instead of about the shield. */
  const full = burn.players[ME].lp;

  /* CONTROL first, on a Ra that has not eaten — so the pin proves the meal is
     what raises the shield and not the God standing there. */
  const cold = act({ ...burn, active: FOE }, FOE, { type: 'normalSummon', uid: witch.uid, zone: 0, position: 'atk', face: 'up' });
  ok(cold.players[ME].lp < full,
    'FUSED: CONTROL: an unfed Ra shields nothing — the burn lands',
    `LP ${full} -> ${cold.players[ME].lp}`);

  burn = feed(burn, sun.uid, meal.uid);
  burn.active = FOE;
  const shielded = act(burn, FOE, { type: 'normalSummon', uid: witch.uid, zone: 0, position: 'atk', face: 'up' });
  ok(shielded.players[ME].lp === full,
    'FUSED: once it has eaten, no effect damage reaches its owner',
    `LP ${full} -> ${shielded.players[ME].lp}`);

  /* CONTROL: a blow still lands, which is the whole of what the clause leaves
     open — and the reason a fed Ra is not simply unbeatable. */
  let blow = fresh();
  const sun2 = card(ME, RA);
  const meal2 = card(ME, 'battle-ox');
  blow.players[ME].monsters = [sun2, meal2, null];
  blow = feed(blow, sun2.uid, meal2.uid);
  blow.phase = 'battle';
  blow.active = FOE;
  blow.players[FOE].monsters = [card(FOE, 'blue-eyes-white-dragon'), null, null]; // 3000 into its 2000
  const before = blow.players[ME].lp;
  const hit = act(blow, FOE, { type: 'attack', uid: blow.players[FOE].monsters[0]!.uid, targetUid: sun2.uid });
  ok(hit.players[ME].lp < before,
    'FUSED: CONTROL: a blow is the one thing that still reaches',
    `LP ${before} -> ${hit.players[ME].lp}`);

  /* And the shield is not a wall around the God's own price: a cost is not
     damage, so the pour still empties its owner from behind it. */
  let pourable = fresh();
  const sun3 = card(ME, RA);
  const meal3 = card(ME, 'battle-ox');
  pourable.players[ME].monsters = [sun3, meal3, null];
  pourable = feed(pourable, sun3.uid, meal3.uid);
  const pour = ignitionOptions(pourable, ME, live(pourable, sun3.uid)).find((o) => /Pour everything/.test(o.label))!;
  pourable = act(pourable, ME, { type: 'ignition', uid: sun3.uid, effectIndex: pour.index });
  ok(pourable.players[ME].lp === 1,
    'FUSED: and its own price is still payable from behind the shield',
    `LP ${pourable.players[ME].lp}`);

  /* A Ra that died comes back hungry — `resetInstance` clears the meal with
     the ATK it was worth, and a God revived out of the pile must not arrive
     already fused. */
  let died = fresh();
  const sun4 = card(ME, RA);
  const meal4 = card(ME, 'battle-ox');
  died.players[ME].monsters = [sun4, meal4, null];
  died = feed(died, sun4.uid, meal4.uid);
  const body = live(died, sun4.uid);
  ok(body.swallowed === 1, 'FUSED: fed', String(body.swallowed ?? 0));
  died.players[ME].monsters = [null, null, null];
  died.players[ME].grave = [body];
  const reborn = card(ME, 'monster-reborn');
  died.players[ME].hand = [reborn];
  died.active = ME;
  died.phase = 'main';
  const back = act(died, ME, { type: 'activateSpell', uid: reborn.uid, targets: [body.uid] });
  const risen = back.players[ME].monsters.find((m) => m?.uid === body.uid);
  ok(!!risen && !risen.swallowed,
    'FUSED: CONTROL: and one that died comes back hungry',
    risen ? String(risen.swallowed ?? 0) : '(never came back)');
}

console.log(`\n${bad ? `${bad} of ${checks} FAILED` : `All ${checks} checks pass. ✅`}`);
process.exitCode = bad ? 1 : 0;
