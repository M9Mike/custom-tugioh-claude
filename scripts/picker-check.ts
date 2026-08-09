/**
 * The layer the *player* actually touches.
 *
 * Every other harness in this repo drives `applyAction` directly with explicit
 * arguments. A player never does that. A player goes
 *
 *     board → targetSpecFor → targetCandidates → pickerSides → the modal
 *
 * and only then does the engine hear about it. That whole path had almost no
 * coverage, and it is exactly where two reported bugs lived — both of them
 * Graverobber, both of them invisible to a battery that was otherwise green:
 *
 *   1. `targetCandidates` hardcoded "monsters only" into the Graveyard branch,
 *      correct while Monster Reborn was the only card looking in there. Against
 *      a pile of Spells and Traps it returned nothing, so the board refused a
 *      card the engine was perfectly happy to resolve. Reported as "Graverobber
 *      says there is nothing it can target".
 *   2. The modal then drew `both ? [me, foe] : [me]`, so an opponent-only picker
 *      laid out MY Graveyard and filtered it against THEIR cards. Reported as
 *      "the modal is empty".
 *
 * Note what both have in common: the engine was right the whole time. Driving
 * `applyAction` with a target chosen by hand passed in both cases — which is
 * why `npm run rules` stayed green through both bugs.
 *
 * So this asks the questions the board asks, in the board's order:
 *
 *   A. If the engine will let this card be used and its effect names a target,
 *      the board must be able to offer at least one. Anything else is a card
 *      the interface refuses and the rules allow.
 *   B. Everything offered must sit on the side and in the zone the spec names —
 *      no phantom options the engine would then throw away.
 *   C. Everything offered must sit in a pile the modal actually draws, so the
 *      list the player sees is the list the board computed.
 *
 * Each card is given a position built to satisfy its own filter: if it names
 * slugs, those cards are placed where it will look. The claim is therefore
 * "given everything this card could want, the board still offered nothing",
 * which is a bug every time rather than a thin position.
 *
 *   npx tsx scripts/picker-check.ts            # every card
 *   npx tsx scripts/picker-check.ts graverobber  # one card, verbose
 */
import { canActivateFromHand, canActivateSetCard, canChangePosition, canIgnite, createDuel, matchesFilter } from '../src/game/engine';
import { CARDS } from '../src/game/cards';
import { pickerSides, targetCandidates, targetSpecFor, type TargetSpec } from '../src/game/ui';
import type { CardDef, CardFilter, CardInstance, DuelState, PlayerId, Trigger } from '../src/game/types';

const ONLY = process.argv[2];
const ME: PlayerId = 'p1';
const FOE: PlayerId = 'p2';

let uidSeq = 0;
let checks = 0;
const problems: string[] = [];

function fail(msg: string) {
  problems.push(msg);
}
/** `label` is what a pass reads as; `msg` is the complaint, only shown on failure. */
function ok(pass: boolean, label: string, msg: string) {
  checks += 1;
  if (!pass) fail(msg);
  if (ONLY) console.log(`  ${pass ? '✅' : '❌'} ${pass ? label : msg}`);
}

function mint(pid: PlayerId, slug: string): CardInstance {
  return {
    uid: `pick${uidSeq++}`,
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

/** Monsters, Spells and Traps that carry no filter of their own to confuse things. */
const PLAIN_MONSTERS = ['baby-dragon', 'harpie-lady', 'mystical-elf', 'battle-ox', 'summoned-skull'];
const PLAIN_SPELLS = ['dark-hole', 'pot-of-greed', 'monster-reborn'];
const PLAIN_TRAPS = ['mirror-force'];

/**
 * A deliberately generous board: both sides have monsters, a backrow, a Field
 * Spell, and Graveyards holding BOTH monsters and Spells/Traps.
 *
 * The mixed Graveyard is the point. A pile of monsters alone cannot tell a
 * picker that reads "any card" apart from one that reads "monsters only", and
 * that indistinguishability is precisely what hid the Graverobber bug.
 */
function stocked(): DuelState {
  const s = structuredClone(
    createDuel({ seed: 31337, p1: { duelistId: 'kaiba', name: 'Me' }, p2: { duelistId: 'yugi', name: 'Foe' } })
  );
  s.turn = 8;
  s.active = ME;
  s.phase = 'main';
  for (const pid of [ME, FOE] as PlayerId[]) {
    const p = s.players[pid];
    // One free Monster Zone each: an effect that Special Summons needs somewhere
    // to put what it finds, and a full board would fail it for the wrong reason.
    p.monsters = [mint(pid, 'baby-dragon'), mint(pid, 'battle-ox'), null];
    p.spellTrap = { ...mint(pid, 'mirror-force'), face: 'down' as const };
    p.field = mint(pid, 'umi');
    p.grave = [
      mint(pid, 'summoned-skull'),
      mint(pid, 'mystical-elf'),
      mint(pid, 'dark-hole'), // a Spell in the pile — the Graverobber case
      mint(pid, 'mirror-force'), // and a Trap
    ];
    p.hand = [mint(pid, 'harpie-lady'), mint(pid, 'pot-of-greed')];
    p.deck = [...PLAIN_MONSTERS, ...PLAIN_SPELLS].map((sl) => mint(pid, sl));
    p.lp = 8000;
    p.normalSummonUsed = false;
  }
  return s;
}

/**
 * A card in the game that satisfies this filter, if one exists.
 *
 * `self` is excluded on purpose. Alpha The Magnet Warrior searches on
 * `nameIncludes: 'Magnet Warrior'` and is itself the first card in the database
 * that matches — so an earlier version of this picked Alpha, declined to place
 * a card on top of the one being tested, and then reported the empty Deck it
 * had built itself as a bug in the card. A harness must not fail a position it
 * failed to set up.
 */
function cardMatching(f: CardFilter | undefined, self: string): string | null {
  if (!f) return PLAIN_MONSTERS.find((sl) => sl !== self) ?? null;
  if (f.slugs?.length) return f.slugs.find((sl) => sl !== self) ?? null;
  /* The engine's own filter, not a third copy of it. This was a copy, and like
     the client's it did not know about `toon` — so for Toon World's "add 1 Toon
     monster" it seeded the Deck with something that was not a Toon, the picker
     correctly refused to offer it, and the harness reported the card as broken.
     Three readings of one rule, and two of them wrong. */
  for (const def of Object.values(CARDS)) {
    if (def.slug === 'facedown' || def.slug === self) continue;
    if (matchesFilter(mint(ME, def.slug), f)) return def.slug;
  }
  return null;
}

/**
 * Put whatever the spec is looking for exactly where it will look, on the side
 * it names — so "the board offered nothing" can only mean the board is wrong.
 */
function satisfy(s: DuelState, spec: TargetSpec, self: string) {
  const wanted = cardMatching(spec.filter, self);
  if (!wanted) return;
  const sides: PlayerId[] = spec.side === 'both' ? [ME, FOE] : spec.side === 'opp' ? [FOE] : [ME];
  for (const pid of sides) {
    const p = s.players[pid];
    const c = mint(pid, wanted);
    const def = CARDS[wanted];
    switch (spec.zone) {
      case 'grave':
        p.grave.push(c);
        break;
      case 'deck':
        p.deck.push(c);
        break;
      case 'hand':
        p.hand.push(c);
        break;
      case 'monster':
        if (def?.kind === 'monster') {
          const z = p.monsters.findIndex((m) => !m);
          if (z >= 0) p.monsters[z] = c;
          else p.monsters[2] = c;
        }
        break;
      case 'spellTrap':
      case 'backrow':
        if (def?.kind !== 'monster') p.spellTrap = { ...c, face: 'down' };
        break;
      default:
        break;
    }
  }
}

/**
 * Strip the named zone back to nothing but cards the filter accepts, choosing
 * the *least monster-like* card it will take.
 *
 * The rich board above cannot see a picker that is secretly narrower than its
 * own spec: Graverobber reads "any card", and a Graveyard holding two monsters
 * and two Spells still hands back the two monsters even when the implementation
 * has quietly restricted itself to monsters. The bug only shows when the pile
 * holds nothing BUT Spells and Traps — which is exactly the board the owner
 * reported it from.
 *
 * So this builds that board on purpose: if the spec would accept a Spell, the
 * zone is emptied and filled with Spells alone. Offering nothing then is a
 * restriction the card never asked for.
 */
function narrowTo(s: DuelState, spec: TargetSpec, self: string): boolean {
  const f = spec.filter;
  // Only meaningful where a zone can hold both kinds and the spec accepts both.
  if (spec.zone !== 'grave' && spec.zone !== 'hand' && spec.zone !== 'deck') return false;
  /* Only a filter this harness can actually satisfy: none at all, or a bare
     list of named cards. Anything with a predicate — a type, an attribute, an
     ATK bound, `nameIncludes` — cannot be met by a pile of stock Spells, and
     filling one anyway would report the harness's own empty position as a bug
     in the card. Alpha The Magnet Warrior searches on `nameIncludes` and did
     exactly that before this guard existed. */
  if (f && Object.keys(f).some((k) => k !== 'slugs')) return false;
  const picks = (f?.slugs?.length ? f.slugs : [...PLAIN_SPELLS, ...PLAIN_TRAPS]).filter((sl) => sl !== self);
  if (!picks.length) return false;
  // If every card the filter names is a monster there is nothing to prove here.
  if (picks.every((sl) => CARDS[sl]?.kind === 'monster')) return false;

  const sides: PlayerId[] = spec.side === 'both' ? [ME, FOE] : spec.side === 'opp' ? [FOE] : [ME];
  for (const pid of sides) {
    const p = s.players[pid];
    const fill = picks.filter((sl) => CARDS[sl]?.kind !== 'monster').map((sl) => mint(pid, sl));
    if (!fill.length) return false;
    if (spec.zone === 'grave') p.grave = fill;
    else if (spec.zone === 'deck') p.deck = fill;
    else p.hand = fill;
  }
  return true;
}

/** Where the card under test has to sit for the engine to let it be used. */
type Seat = 'hand' | 'set' | 'field' | 'facedown';
function seatFor(def: CardDef, trigger: Trigger): Seat | null {
  if (trigger === 'ignition' || trigger === 'continuous') return 'field';
  if (trigger === 'trap') return 'set';
  if (trigger === 'activate') return 'hand';
  if (trigger === 'onSummon' || trigger === 'onNormalSummon') return def.kind === 'monster' ? 'hand' : null;
  /* A FLIP effect is reachable the moment you turn the monster over yourself,
     which is a play you make in your own Main Phase — so it gets asked, and it
     belongs in this harness. It was missing, which is exactly how Man-Eater
     Bug shipped for months choosing its own victim: the effect named a target,
     the board never offered one, and nothing here looked. */
  if (trigger === 'onFlip') return def.kind === 'monster' ? 'facedown' : null;
  return null;
}

function seat(s: DuelState, def: CardDef, where: Seat): CardInstance {
  const c = mint(ME, def.slug);
  if (where === 'hand') {
    s.players[ME].hand.push(c);
  } else if (where === 'facedown') {
    /* Set on an earlier turn, so it may be Flip Summoned now. */
    c.face = 'down';
    c.position = 'def';
    c.summonedOnTurn = 0;
    const z = s.players[ME].monsters.findIndex((m) => !m);
    s.players[ME].monsters[z >= 0 ? z : 2] = c;
  } else if (where === 'set') {
    c.face = 'down';
    c.summonedOnTurn = 1; // set on an earlier turn, so a Trap is live
    s.players[ME].spellTrap = c;
  } else {
    c.summonedOnTurn = 0;
    const z = s.players[ME].monsters.findIndex((m) => !m);
    s.players[ME].monsters[z >= 0 ? z : 2] = c;
  }
  return c;
}

/** Does the engine consider this card usable right now? */
function engineAllows(s: DuelState, c: CardInstance, where: Seat, trigger: Trigger): boolean {
  if (where === 'hand') {
    // A summon is not an activation: a monster with an onSummon target is
    // reachable whenever it can be Normal Summoned, which the summon path
    // decides. Treat it as allowed and let the target questions do the work.
    if (trigger === 'onSummon' || trigger === 'onNormalSummon') return true;
    return canActivateFromHand(s, ME, c);
  }
  if (where === 'set') return canActivateSetCard(s, ME, c);
  if (where === 'facedown') return canChangePosition(s, ME, c);
  return canIgnite(s, ME, c);
}

const TRIGGERS: Trigger[] = ['activate', 'trap', 'ignition', 'onSummon', 'onNormalSummon', 'onFlip'];

let examined = 0;
for (const def of Object.values(CARDS)) {
  if (def.slug === 'facedown') continue;
  if (ONLY && def.slug !== ONLY) continue;

  for (const trigger of TRIGGERS) {
    const spec = targetSpecFor(def.slug, trigger);
    if (!spec) continue;
    const where = seatFor(def, trigger);
    if (!where) continue;

    const s = stocked();
    satisfy(s, spec, def.slug);
    const c = seat(s, def, where);
    if (!engineAllows(s, c, where, trigger)) continue; // not reachable here; not this harness's question
    examined += 1;
    if (ONLY) console.log(`\n${def.slug} [${trigger}] — spec ${spec.side}/${spec.zone} ×${spec.count}`);

    const offered = targetCandidates(s, ME, spec);

    /* A. The board must have something to offer. */
    ok(
      offered.length > 0,
      `offers ${offered.length}`,
      `${def.name} (${def.slug}) [${trigger}] — the engine allows it and its effect names a ` +
        `${spec.side}/${spec.zone} target, but the board offers nothing to point at`
    );
    if (!offered.length) continue;

    /* B. Nothing phantom: every option is on the named side, in the named zone. */
    const sidesNamed: PlayerId[] = spec.side === 'both' ? [ME, FOE] : spec.side === 'opp' ? [FOE] : [ME];
    const zoneHolds = (pid: PlayerId, card: CardInstance): boolean => {
      const p = s.players[pid];
      switch (spec.zone) {
        case 'grave':
          return p.grave.some((g) => g.uid === card.uid);
        case 'deck':
          return p.deck.some((g) => g.uid === card.uid);
        case 'hand':
          return p.hand.some((g) => g.uid === card.uid);
        case 'monster':
          return p.monsters.some((m) => m?.uid === card.uid);
        case 'spellTrap':
          return p.spellTrap?.uid === card.uid;
        case 'backrow':
          return p.spellTrap?.uid === card.uid || p.field?.uid === card.uid;
        default:
          return true;
      }
    };
    const stray = offered.filter((o) => !sidesNamed.some((pid) => zoneHolds(pid, o)));
    ok(
      stray.length === 0,
      `every option is in a ${spec.side} ${spec.zone}`,
      `${def.name} (${def.slug}) [${trigger}] — offers ${stray.map((x) => x.slug).join(', ')} ` +
        `which is not in any ${spec.side} ${spec.zone}`
    );

    /* C. The modal must draw from a pile that actually holds the options. This
          is the second Graverobber bug exactly: the list was right and the
          modal looked somewhere else, so it rendered empty. */
    const drawn = pickerSides(spec, ME, FOE);
    const unreachable = offered.filter((o) => !drawn.some((pid) => zoneHolds(pid, o)));
    ok(
      unreachable.length === 0,
      `the modal draws ${drawn.join(' + ')}'s ${spec.zone}, which holds them`,
      `${def.name} (${def.slug}) [${trigger}] — the board offers ` +
        `${unreachable.map((x) => x.slug).join(', ')} but the modal only draws ` +
        `${drawn.join(' + ')}'s ${spec.zone}, so the picker opens empty`
    );

    /* D. The hostile position: a pile holding ONLY the awkward half of what the
          spec accepts. This is the one that catches a picker quietly narrower
          than its own spec — see `narrowTo`. */
    const hostile = stocked();
    const hc = seat(hostile, def, where);
    if (!narrowTo(hostile, spec, def.slug)) continue;
    if (!engineAllows(hostile, hc, where, trigger)) continue;
    const hostileSpec = targetSpecFor(def.slug, trigger)!;
    const narrowOffer = targetCandidates(hostile, ME, hostileSpec);
    const present = pickerSides(hostileSpec, ME, FOE).flatMap((pid) =>
      hostileSpec.zone === 'grave'
        ? hostile.players[pid].grave
        : hostileSpec.zone === 'deck'
          ? hostile.players[pid].deck
          : hostile.players[pid].hand
    );
    ok(
      narrowOffer.length > 0,
      `and still offers ${narrowOffer.length} from a ${hostileSpec.zone} of Spells and Traps alone`,
      `${def.name} (${def.slug}) [${trigger}] — its spec accepts any card, but with the ` +
        `${hostileSpec.side} ${hostileSpec.zone} holding only ${present.map((x) => x.slug).join(', ')} ` +
        'the board offers nothing: the picker is narrower than the card'
    );
  }
}

console.log(`\nPicker path — ${examined} card/trigger pairs reachable, ${checks} checks`);
if (problems.length) {
  console.log('\nCards the interface and the rules disagree about:');
  for (const p of problems) console.log(`  ❌ ${p}`);
  console.log(`\n${problems.length} problem(s)`);
  process.exitCode = 1;
} else if (!ONLY && examined < 20) {
  // A harness that examines almost nothing passes for the wrong reason.
  console.log(`\n❌ only ${examined} pairs were reachable — the position builder has probably drifted`);
  process.exitCode = 1;
} else {
  console.log('\nEvery card the rules allow, the board can point at. ✅');
}
