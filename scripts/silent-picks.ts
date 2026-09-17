/**
 * Every choice the engine makes that the player was never offered.
 *
 * The picker is derived from the effect data, so a card asks a question only if
 * some branch of `src/game/ui.ts` recognises the op that would ask it. Six
 * separate reports have now been the same shape — "it should let me select
 * which one" — and each was fixed one card at a time: Gravekeeper's Spy, the
 * Temple of the Kings, Mask of Darkness, Man-Eater Bug, Luster Dragon,
 * E - Emergency Call. Fixing them one at a time is how the seventh happens.
 *
 * So this asks the question of every card at once: for each effect, does it
 * contain an op that reaches into a pool of cards and takes one — and if so,
 * does the picker produce a question for it?
 *
 * A card that has *decided* is not a fault and is not listed:
 *   - `pick: 'strongest' | 'weakest' | 'random'` — but only where the card's
 *     own text says so, which is checked rather than assumed; see `decided`
 *   - a filter naming exactly one slug, or a pool the board cannot vary
 *   - `all`, which takes everything and chooses nothing
 *
 *   npx tsx scripts/silent-picks.ts
 */
import { CARDS } from '../src/game/cards';
import { specChainForEffect } from '../src/game/ui';
import type { CardDef, CardEffect, Op } from '../src/game/types';

/** Ops that reach into a pool and lift a card out of it. */
const PICKS_FROM_A_POOL = new Set([
  'search',
  'specialSummon',
  'stealFromGrave',
  'setTrap',
  'destinyDraw',
  'shuffleIntoDeck',
  'returnToExtra',
]);

/**
 * The card has already answered — and the card's TEXT is what answers it.
 *
 * `strongest` was trusted on sight, on the grounds that a card asking for the
 * biggest thing says so in its own words. Three did not. Dark Jeroid printed
 * "1 monster your opponent controls loses 1500 ATK" and always drained the
 * biggest one — reported — and beside it sat Ryu-Ran's "1 monster your
 * opponent controls with 1600 or less ATK", which took the smallest, and
 * Elemental HERO Wildheart, whose one sentence asks on the summon and decided
 * for itself on the attack. So the word has to be in the text: a pick is the
 * card's own only where the card says it out loud.
 */
const SELF_RULED = ['strongest', 'weakest', 'random'] as const;
const SAYS_SO: Record<(typeof SELF_RULED)[number], RegExp> = {
  strongest: /strongest|highest atk|highest attack|most atk/i,
  weakest: /weakest|lowest atk|lowest attack|least atk/i,
  random: /random/i,
};
function ruled(pick: string, text: string): boolean {
  return (SELF_RULED as readonly string[]).includes(pick) && SAYS_SO[pick as (typeof SELF_RULED)[number]].test(text);
}
function decided(op: Op, text: string): boolean {
  if ('pick' in op && typeof op.pick === 'string' && ruled(op.pick, text)) return true;
  /* And the same word worn on the selector rather than on the op. The
     Legendary Fisherman shuffles "10 random cards", which the card says out
     loud and which lives in `sel('own', 'random', …)` — two places one rule can
     be written, and a sweep that reads only one of them reports a card that is
     doing exactly what its text promises. */
  if ('target' in op && op.target && ruled(op.target.pick, text)) return true;
  /* One named card is not a choice — Avian fetching "Polymerization" has
     exactly one answer however many copies are down there. Read off the
     selector as well as off the op: the Ultimate Dragon's "1 Blue-Eyes White
     Dragon from your Graveyard" carries its filter on the target, and one
     named card is one answer wherever the name is written. */
  const filter = 'filter' in op ? op.filter : undefined;
  if (filter?.slugs && filter.slugs.length === 1) return true;
  const tf = 'target' in op && op.target ? op.target.filter : undefined;
  if (tf?.slugs && tf.slugs.length === 1) return true;
  /* `all` takes the lot. */
  if ('all' in op && op.all) return true;
  if ('target' in op && op.target && op.target.pick === 'all') return true;
  return false;
}

/** Every op in an effect, including the ones nested inside a branch. */
function flatten(ops: Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    out.push(op);
    if (op.op === 'cascade') for (const b of op.branches) out.push(...flatten(b.ops));
    if (op.op === 'coinFlip') out.push(...flatten(op.heads), ...flatten(op.tails));
    if (op.op === 'diceRoll') out.push(...flatten(op.perPip));
  }
  return out;
}

/** A pick the card's text never made — so it is the player's, not the card's. */
function unearned(op: Op): boolean {
  if ('target' in op && op.target && (SELF_RULED as readonly string[]).includes(op.target.pick)) return true;
  return 'pick' in op && typeof op.pick === 'string' && (SELF_RULED as readonly string[]).includes(op.pick);
}

/** Does this one op reach into a pool the player should be choosing from? */
function wantsAPick(op: Op, text: string): boolean {
  if (decided(op, text)) return false;
  if (PICKS_FROM_A_POOL.has(op.op)) return true;
  return 'target' in op && !!op.target && op.target.pick === 'chosen';
}

function silentOps(eff: CardEffect, text: string): Op[] {
  return flatten(eff.ops).filter((op) => {
    if (decided(op, text)) return false;
    if (PICKS_FROM_A_POOL.has(op.op)) return true;
    /* A `chosen` selector is the question itself, so one that produces no
       prompt is the same fault wearing the other hat. */
    return 'target' in op && !!op.target && op.target.pick === 'chosen';
  });
}

const faults: { slug: string; name: string; index: number; trigger: string; why: string }[] = [];

for (const def of Object.values(CARDS) as CardDef[]) {
  def.effects.forEach((eff, index) => {
    /* An aura asks nothing and a continuous effect has no moment to ask in. */
    if (eff.trigger === 'continuous') return;
    const text = def.text ?? '';
    /* A pick the text never made is a fault on its own, and counting prompts
       cannot find it: `strongest` raises no question, so there is nothing for
       a count to come up short of. Ryu-Ran hid behind exactly that — its
       Graveyard fetch put one prompt on the board, the tally read one asked
       against one wanted, and the monster it destroyed was still chosen by the
       engine. Asked before the tally, and one answer per effect. */
    const unearnedOps = flatten(eff.ops).filter((op) => !decided(op, text) && unearned(op));
    if (unearnedOps.length) {
      faults.push({
        slug: def.slug,
        name: def.name,
        index,
        trigger: eff.trigger,
        why: `${unearnedOps.map((o) => o.op).join(', ')} makes a pick the card's text never made`,
      });
      return;
    }
    const silent = silentOps(eff, text);
    const wantsCost = !!eff.cost?.tribute && !eff.cost.tributeSelf;
    const wantsDiscard = !!eff.cost?.discard;
    if (!silent.length && !wantsCost && !wantsDiscard) return;
    const asked = specChainForEffect(def.slug, index);
    if (!asked.length) {
      const why = silent.length
        ? `${silent.map((o) => o.op).join(', ')} picks from a pool with no prompt`
        : wantsCost
          ? 'a Tribute cost with no prompt'
          : 'a discard cost with no prompt';
      faults.push({ slug: def.slug, name: def.name, index, trigger: eff.trigger, why });
      return;
    }
    /* And one prompt per pick, not one prompt for all of them. A card asking
       *some* of its questions passes the line above and is still choosing for
       the player: Wroughtweiler makes four picks out of three different pools
       and was asked twice, one of those prompts standing in for three with the
       effect's whole `targets` count on it. Reported.
       A cascade contributes one question however many branches it carries —
       only one branch runs — which is why the count is taken from the ops as
       the chain sees them rather than from `flatten`. */
    const asking = eff.ops.filter((op) => {
      if (decided(op, text)) return false;
      if (op.op === 'cascade') return op.branches.some((b) => b.ops.some((o) => wantsAPick(o, text)));
      return wantsAPick(op, text);
    }).length;
    const want = asking + (wantsCost || wantsDiscard ? 1 : 0);
    if (asked.length < want) {
      faults.push({
        slug: def.slug,
        name: def.name,
        index,
        trigger: eff.trigger,
        why: `makes ${want} pick(s) and asks ${asked.length} question(s)`,
      });
    }
  });
}

console.log(`\nSilent picks — ${Object.keys(CARDS).length} cards\n`);
if (!faults.length) {
  console.log('Every card that chooses from a pool puts the choice to the player. ✅');
} else {
  console.log(`${faults.length} effect(s) choose for the player:\n`);
  for (const f of faults) {
    console.log(`  ❌ ${f.name} (${f.slug}) [${f.trigger}] — ${f.why}`);
  }
  console.log('\nEither the card should ask, or its text should say the pick is not the player\'s.');
  process.exitCode = 1;
}
