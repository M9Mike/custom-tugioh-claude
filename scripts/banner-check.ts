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
 *
 * The second half asks the other half of the same question: whether every
 * place that prints a card's *name* asks the board what that card is called.
 * Four of them did not, and a drawing appeared to rename itself every time the
 * turn passed — tapping your own monster on your own turn opens the action
 * sheet, which read the printed name, while the same tap on the opponent's
 * turn opens the inspector, which read the Toon one.
 */
import { readFileSync } from 'node:fs';
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

/**
 * Every card face the duel screen paints must be told what to call the card.
 *
 * `GameCard` and `CardDetail` both fall back to the printed name when nobody
 * hands them one, which is right for a deck list and wrong for a board: four
 * of the duel screen's own renders took that fallback, so Dark Rabbit was
 * "Toon Dark Rabbit" in the inspector and plain "Dark Rabbit" in the action
 * sheet you get by tapping it on your own turn.
 *
 * Only the duel screen is scanned. The lobby and the front page show cards
 * that are not in play, and a card that is not in play has only its printed
 * name. A `compact` GameCard prints no name at all — it is the small board
 * face, all art and figures — so it is exempt.
 */
const nameless: string[] = [];
for (const file of ['src/components/Duel.tsx', 'src/components/CardDetail.tsx']) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const lines = src.split('\n');
  /* JSX elements are split across lines, so walk from each tag to its close. */
  for (let i = 0; i < lines.length; i++) {
    for (const tag of ['<GameCard', '<CardDetail'] as const) {
      if (!lines[i].includes(tag)) continue;
      let depth = 0;
      let el = '';
      for (let j = i; j < lines.length && j < i + 14; j++) {
        el += lines[j];
        for (const ch of lines[j]) {
          if (ch === '<') depth++;
          else if (ch === '>') depth--;
        }
        if (depth <= 0 && el.includes('>')) break;
      }
      const compact = tag === '<GameCard' && /\bcompact\b/.test(el);
      if (!compact && !el.includes('displayName')) {
        nameless.push(`${file}:${i + 1}  ${lines[i].trim()}`);
      }
    }
  }
}


/**
 * And every figure it paints must be the figure the card fights with.
 *
 * Our versions of some cards do not carry the printed numbers: Uraby is a 400
 * ATK mine whose whole worth is what it does from the Graveyard, and the card
 * database still says 1500. `atkOverride` is where that difference lives and
 * `baseAtk` is the one function that reads it — so anything reaching for `.atk`
 * on a card definition shows the number from the scrape rather than the number
 * on the field. Reported: "Uraby shows different atk def in hand and different
 * when summoned", with nothing on the board to explain the change.
 *
 * The tell in the original bug is worth remembering: the *tint* beside the
 * figure already asked `atkOverride ?? atk`, so the number rendered untinted —
 * announcing itself as the plain printed stat — while being neither.
 *
 * The search is scanned too, and that is where this first paid: two places
 * ranked a card in a pile by its printed ATK, so the computer valued Uraby as
 * a 1500 prize worth reviving and never as the cheapest thing to throw away.
 */
const printed: string[] = [];
for (const file of [
  'src/components/GameCard.tsx',
  'src/components/CardDetail.tsx',
  'src/components/Duel.tsx',
  'src/game/ai.ts',
]) {
  const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  src.split('\n').forEach((line, i) => {
    /* The tint legitimately names both halves, and `atkMod`, `tokenAtk` and
       `effAtk` are all something else entirely. */
    if (/\batkOverride\b|\bdefOverride\b/.test(line)) return;
    if (/\b(?:d|def0|cardDef|CARDS\[[^\]]+\])\??\.(?:atk|def)\b/.test(line)) {
      printed.push(`${file}:${i + 1}  ${line.trim()}`);
    }
  });
}

if (!artless.size && !nameless.length && !printed.length) {
  console.log(`\n✅ every banner outside the ${ALLOWED.size} declared shapes carries card art.`);
  console.log('✅ every card the duel screen names asks the board what to call it.');
  console.log('✅ and every figure it paints is the one the card fights with.');
  process.exit(0);
}

if (artless.size) {
  console.log(`\n❌ ${artless.size} banner shape(s) printed over empty space:`);
  for (const [shape, info] of [...artless].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`   [${info.kind}] ×${info.count}  ${shape}`);
    if (info.sample !== shape) console.log(`             e.g. ${info.sample}`);
  }
  console.log(
    '\nEither give the line its card — log(state, text, tone, player, logSlug(c)) —\n' +
      'or, if it is chrome, about a duelist, or hidden information, add it to ALLOWED.'
  );
}

if (nameless.length) {
  console.log(`\n❌ ${nameless.length} card face(s) print a name nobody supplied:`);
  for (const where of nameless) console.log(`   ${where}`);
  console.log(
    '\nPass displayName={shownName(c)} — or mark it compact if it shows no name.\n' +
      'A card on the board answers to what the board calls it, not to what is printed on it.'
  );
}

if (printed.length) {
  console.log(`\n❌ ${printed.length} place(s) read a stat off the printed card:`);
  for (const where of printed) console.log(`   ${where}`);
  console.log(
    '\nUse baseAtk(slug) / baseDef(slug), which read `atkOverride` where our version\n' +
      'differs from the database. Uraby is 400 on the field and 1500 in the scrape;\n' +
      'a player shown both numbers has no way to tell which one is real.'
  );
}
process.exit(1);
