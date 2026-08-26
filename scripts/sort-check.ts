/**
 * The deck builder's order, checked against its own rules.
 *
 * Sorting is the kind of thing that looks right in a screenshot and is wrong in
 * the one case nobody photographed — a god with a computed ATK, two monsters
 * that tie, a search for a word that is a type rather than a name. All of it is
 * arithmetic over the card table, which is what this file is for.
 *
 *   npm run sort
 */

import { CARDS, DUELIST_BY_ID } from '../src/game/cards';
import { STARTER_POOL } from '../src/story/roster';
import { deckOrder, searchCards, trunkOrder } from '../src/story/deckSort';

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

const kindOf = (slug: string) => {
  const c = CARDS[slug];
  if (!c) return 'missing';
  if (c.kind === 'monster') return c.type === 'Divine-Beast' ? 'god' : 'monster';
  return c.kind;
};
const rank = (slug: string) => ['god', 'monster', 'spell', 'trap'].indexOf(kindOf(slug));

console.log('\nDeck builder order\n');

/* A pool wide enough to have all four groups in it, gods included. */
const everything = Object.keys(CARDS);
const withGods = [
  ...STARTER_POOL,
  'obelisk-the-tormentor',
  'slifer-the-sky-dragon',
  'the-winged-dragon-of-ra',
];

console.log('the deck');
{
  const out = deckOrder(withGods);
  check(out.length === withGods.length, 'nothing is lost or duplicated', `${out.length}`);
  check(new Set(out).size === out.length, 'and nothing is repeated');

  const ranks = out.map(rank);
  check(
    ranks.every((r, i) => i === 0 || ranks[i - 1] <= r),
    'gods, then monsters, then spells, then traps',
    out.slice(0, 6).map((s) => `${kindOf(s)}`).join(' ')
  );

  const gods = out.filter((s) => kindOf(s) === 'god');
  check(gods.length === 3 && out.slice(0, 3).every((s) => kindOf(s) === 'god'),
    'all three gods are at the very front', out.slice(0, 3).join(', '));

  const monsters = out.filter((s) => kindOf(s) === 'monster');
  const atks = monsters.map((s) => CARDS[s]!.atk ?? 0);
  check(
    atks.every((a, i) => i === 0 || atks[i - 1] >= a),
    'monsters run strongest first',
    atks.slice(0, 8).join(' ')
  );

  /* The tie-break is the whole reason the order is stable. */
  const tied = monsters.filter((s) => (CARDS[s]!.atk ?? 0) === (CARDS[monsters[0]]!.atk ?? 0));
  const names = tied.map((s) => CARDS[s]!.name);
  check(
    names.every((n, i) => i === 0 || names[i - 1].localeCompare(n) <= 0),
    'and cards on the same ATK run by name',
    names.join(', ')
  );

  /* Same contents in a different order must give the same answer. */
  const shuffled = [...withGods].reverse();
  check(
    deckOrder(shuffled).join() === out.join(),
    'the order depends on the contents and nothing else'
  );
}

console.log('\nSlifer and Ra do not sort as weak cards');
{
  /* Their printed ATK is -1 because it is computed at the table. */
  check(CARDS['slifer-the-sky-dragon']?.atk === -1, "Slifer's ATK really is -1 in the data");
  const out = deckOrder(['kuriboh', 'slifer-the-sky-dragon', 'obelisk-the-tormentor']);
  check(out[out.length - 1] === 'kuriboh', 'and he still outranks Kuriboh', out.join(' '));
}

console.log('\nthe trunk');
{
  const pool = withGods;
  for (const key of ['atk', 'def'] as const) {
    const out = trunkOrder(pool, key);
    const monsters = out.filter((s) => kindOf(s) === 'monster');
    const vals = monsters.map((s) => CARDS[s]![key] ?? 0);
    check(
      vals.every((v, i) => i === 0 || vals[i - 1] >= v),
      `sorting by ${key.toUpperCase()} runs highest first`,
      vals.slice(0, 8).join(' ')
    );
    const ranks = out.map(rank);
    check(
      ranks.every((r, i) => i === 0 || ranks[i - 1] <= r),
      `and by ${key.toUpperCase()} still groups by type`
    );
  }

  const byName = trunkOrder(pool, 'name');
  const names = byName.map((s) => CARDS[s]?.name ?? s);
  check(
    names.every((n, i) => i === 0 || names[i - 1].localeCompare(n) <= 0),
    'sorting by name ignores type entirely, which is the point of it'
  );

  check(
    trunkOrder(pool, 'type').length === pool.length &&
      trunkOrder(pool, 'atk').length === pool.length &&
      trunkOrder(pool, 'name').length === pool.length,
    'every sort keeps every card'
  );
}

console.log('\nsearch');
{
  check(searchCards(everything, '').length === everything.length, 'an empty query matches everything');
  const fiends = searchCards(everything, 'fiend');
  check(
    fiends.length > 0 && fiends.every((s) => (CARDS[s]!.type ?? '').toLowerCase().includes('fiend')),
    'a type finds cards of that type',
    `${fiends.length} fiends`
  );
  const dark = searchCards(everything, 'dark');
  check(dark.length > 0, 'an attribute finds cards too', `${dark.length} for "dark"`);
  const imp = searchCards(everything, 'feral');
  check(imp.includes('feral-imp'), 'and a name finds the card');
  check(searchCards(everything, 'zzzznothing').length === 0, 'a query that matches nothing returns nothing');
}

console.log('\nevery duelist deck sorts without throwing');
{
  let worst = '';
  for (const d of Object.values(DUELIST_BY_ID)) {
    const slugs = d.deck.flatMap(([slug, n]) => Array.from({ length: n }, () => slug));
    const out = deckOrder(slugs);
    if (out.length !== slugs.length) worst = d.id;
  }
  check(!worst, 'including the ones with duplicates', worst);
}

console.log(
  failures === 0 ? '\nEvery ordering rule holds. ✅\n' : `\n${failures} ordering rule(s) broken. ❌\n`
);
process.exit(failures === 0 ? 0 : 1);
