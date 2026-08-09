/**
 * Every banner the board prints, and whether it has a face beside it.
 *
 *   npx tsx scripts/banner-check.ts [duels] [seed]
 *
 * The banner is the line the duel says out loud as a beat plays, and a line
 * that names a card is supposed to show that card. Two of them did not —
 * "Battle Ox holds firm." and "Bowganian cannot be destroyed by battle." were
 * printed over empty space whenever the blow that provoked them also ended the
 * duel, because the note-less victory beat adopted the line and had no art of
 * its own to lend it.
 *
 * Finding that by eye took a duel ending in exactly that way. This finds it by
 * playing several hundred duels and reading every banner the way the board
 * does — `declare` and `spoken` below are copied from Duel.tsx, because the
 * question is what the *player* sees, not what the engine stored.
 *
 * Plenty of banners are artless on purpose: "Turn 4 — Yugi's turn" is chrome,
 * "Yugi sets a card" must not reveal what was set, and a draw is hidden
 * information. Those are named in ALLOWED. The check is that nothing outside
 * that list goes artless — in practice, that no line naming a card loses its
 * picture — so a new shape has to be looked at once and then declared, rather
 * than slipping in unseen.
 */
import { CARDS, DUELISTS } from '../src/game/cards';
import { chooseAction, legalActions } from '../src/game/autoplay';
import { applyAction, createDuel } from '../src/game/engine';
import type { AnimEvent, DuelState, PlayerId } from '../src/game/types';

const GAMES = Number(process.argv[2] ?? 400);
let rngState = Number(process.argv[3] ?? 24680) >>> 0;
const rnd = () => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return rngState / 4294967296;
};

/**
 * Banners that carry no card art and should not.
 *
 * Card names are folded to «card», duelist names to «player» and digits to N,
 * so one entry covers every monster and every duel. Three reasons appear here
 * and no fourth is expected:
 *
 *   chrome   — the turn and phase markers, which are about the duel itself
 *   player   — a line whose subject is a duelist, not a card
 *   hidden   — a line that must not reveal a card: a Set card, a drawn card
 */
const ALLOWED = new Map<string, string>([
  ["Turn N — «player»'s turn.", 'chrome'],
  ['«player» enters the Battle Phase.', 'chrome'],
  ['«player» draws a card.', 'hidden'],
  ['«player» draws N card.', 'hidden'],
  ['«player» draws N cards.', 'hidden'],
  ['«player» sets a monster.', 'hidden'],
  ['«player» sets a card.', 'hidden'],
  ['«player» sends N cards from the top of their Deck to the Graveyard.', 'hidden'],
  ['«player» takes N damage. (N LP)', 'player'],
  ['«player» gains N Life Points. (N LP)', 'player'],
  ['«player» pays N Life Points.', 'player'],
  ['«player» declines to respond.', 'player'],
  ["«player»'s monsters are locked down.", 'player'],
  ['«player» takes no battle damage.', 'player'],
  ['«player» is shielded from battle damage.', 'player'],
  ['The attack is negated!', 'player'],
  /* Two cards, so no one picture is right — and it only goes artless when the
     destroy beat that used to adopt it never happens, which Thousand-Eyes
     Restrict now causes by shedding what it swallowed instead of dying. */
  ['Both monsters are destroyed!', 'chrome'],
  ['There is no monster to equip.', 'player'],
  /* The die and the coin are their own picture — the beat renders the face, and
     the card that threw it took its bow on the beat immediately before. */
  ['Dice roll: N!', 'chrome'],
  ['Coin flip: HEADS!', 'chrome'],
  ['Coin flip: TAILS!', 'chrome'],
]);

/* ---- copied from src/components/Duel.tsx: what the player actually reads ---- */
function declare(a: AnimEvent) {
  if (!a.slug || !a.player) return null;
  const name = a.as ?? CARDS[a.slug]?.name ?? a.slug;
  const actor = { name, slug: a.slug, who: a.player, form: 'actor' as const };
  switch (a.kind) {
    case 'activate':
      return CARDS[a.slug]?.kind === 'monster'
        ? { ...actor, form: 'card' as const, verb: "'s effect activates" }
        : { ...actor, verb: 'activates' };
    case 'summon':
      return { ...actor, verb: 'summons' };
    case 'trap':
      return { ...actor, verb: 'springs' };
    case 'fusion':
      return { ...actor, verb: 'fusion summons' };
    case 'attack':
      return { ...actor, verb: `attacks ${a.text ?? ''} with`.replace('  ', ' ') };
    case 'directAttack':
      return { ...actor, verb: 'attacks directly with' };
    case 'win':
      return { ...actor, verb: 'assembles' };
    default:
      return null;
  }
}

function spoken(a: AnimEvent): { text: string; slug?: string } | null {
  if (a.kind === 'activate' && a.arrival && a.text) return { text: a.text, slug: a.slug };
  const d = declare(a);
  if (d) {
    return {
      text: d.form === 'actor' ? `«player» ${d.verb} ${d.name}` : `${d.name}${d.verb}`,
      slug: d.slug,
    };
  }
  if (a.note) return { text: a.note, slug: a.slug };
  return null;
}
/* ---- end copy ---- */

/** One shape per sentence, so two Battle Oxen and two duels are one entry. */
function shapeOf(text: string, state: DuelState): string {
  let s = text;
  for (const def of Object.values(CARDS)) s = s.split(def.name).join('«card»');
  for (const p of ['p1', 'p2'] as PlayerId[]) s = s.split(state.players[p].name).join('«player»');
  return s.replace(/\d+/g, 'N');
}

const artless = new Map<string, { kind: string; count: number; sample: string }>();
const usedAllowance = new Set<string>();
let banners = 0;
const ids = DUELISTS.map((d) => d.id);

for (let g = 0; g < GAMES; g++) {
  let state: DuelState = createDuel({
    p1: { duelistId: ids[Math.floor(rnd() * ids.length)], name: 'Alpha' },
    p2: { duelistId: ids[Math.floor(rnd() * ids.length)], name: 'Beta' },
    seed: Math.floor(rnd() * 1e9),
  });
  for (let step = 0; step < 400 && !state.winner; step++) {
    const actor: PlayerId = state.pending ? state.pending.player : state.active;
    const acts = legalActions(state, actor, rnd);
    if (!acts.length) break;
    const res = applyAction(state, actor, chooseAction(acts, rnd));
    if (res.error) continue;
    state = res.state;
    /* The list is trimmed to a rolling window each action, so "new this action"
       is a question about the id prefix, not about the length. */
    for (const ev of state.anims.filter((a) => a.id.startsWith(`a${state.version}_`))) {
      const said = spoken(ev);
      if (!said) continue;
      banners++;
      if (said.slug) continue;
      const shape = shapeOf(said.text, state);
      if (ALLOWED.has(shape)) {
        usedAllowance.add(shape);
        continue;
      }
      const prev = artless.get(shape);
      if (prev) prev.count++;
      else artless.set(shape, { kind: ev.kind, count: 1, sample: said.text });
    }
  }
}

console.log(`${banners.toLocaleString()} banners over ${GAMES} duels`);

/* A shape that never appeared is an allowance nobody is using — either the line
   is gone or the duels stopped reaching it. Worth saying, not worth failing:
   which lines a random duel reaches is a matter of the dice. */
const unused = [...ALLOWED.keys()].filter((s) => !usedAllowance.has(s));
if (unused.length) {
  console.log(`\nnot reached this run (${unused.length}): ${unused.join(' · ')}`);
}

if (!artless.size) {
  console.log(`\n✅ every banner outside the ${ALLOWED.size} declared shapes carries card art.`);
  process.exit(0);
}

console.log(`\n❌ ${artless.size} banner shape(s) printed over empty space:`);
for (const [shape, info] of [...artless].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`   [${info.kind}] ×${info.count}  ${shape}`);
  if (info.sample !== shape) console.log(`             e.g. ${info.sample}`);
}
console.log(
  '\nEither give the line its card — log(state, text, tone, player, logSlug(c)) —\n' +
    'or, if it is chrome, about a duelist, or hidden information, add it to ALLOWED.'
);
process.exit(1);
