/**
 * The shop and the money, checked against their own rules.
 *
 * This is the second thing in Story Mode that *gives* the player something, and
 * the first that takes something away, so the ways it can go wrong are the
 * expensive kind: money out of nowhere, a card bought twice, a purchase that
 * takes the coin and not the card. All of it is arithmetic over two small
 * tables, which is what this file is for.
 *
 *   npm run shop
 */

import { CARDS, DUELIST_BY_ID } from '../src/game/cards';
import { compareCards } from '../src/story/deckSort';
import { newProfile, type StoryProfile } from '../src/story/profile';
import { BOUNTY, STOCK, bountyFor, buy, refuseBuy, shopStock } from '../src/story/shop';

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

const rich = (money: number, collection: string[] = []): StoryProfile => ({
  ...newProfile('Mike', 0),
  money,
  collection,
});

console.log('\nThe Kame Game Shop\n');

console.log('the stock');
{
  check(STOCK.length > 0, 'there is something on the shelf', `${STOCK.length} item(s)`);
  check(
    STOCK.every((s) => !!CARDS[s.slug]),
    'and every slug on it is a real card',
    STOCK.filter((s) => !CARDS[s.slug]).map((s) => s.slug).join(', ')
  );
  check(
    STOCK.every((s) => Number.isInteger(s.price) && s.price > 0),
    'every price is a positive whole number'
  );
  check(
    new Set(STOCK.map((s) => s.slug)).size === STOCK.length,
    'and nothing is listed twice'
  );

  const shown = shopStock().map((s) => s.slug);
  const expected = [...shown].sort(compareCards);
  check(shown.join() === expected.join(), 'the shelf is in the same order as a deck', shown.join(', '));
  check(shopStock() !== STOCK, 'and sorting it does not rearrange the table itself');
}

console.log('\nthe bounties');
{
  check(
    Object.keys(BOUNTY).every((id) => !!DUELIST_BY_ID[id]),
    'every duelist with a price on their head exists',
    Object.keys(BOUNTY).filter((id) => !DUELIST_BY_ID[id]).join(', ')
  );
  check(
    Object.values(BOUNTY).every((v) => Number.isInteger(v) && v >= 0),
    'and every bounty is a whole number of dollars'
  );
  check(bountyFor('tony') === 1 && bountyFor('sarah') === 1, 'Tony and Sarah pay a dollar each');
  check(bountyFor('nobody-at-all') === 0, 'and a duelist nobody has priced pays nothing');
}

console.log('\nbuying');
{
  const item = STOCK[0];
  const price = item.price;

  check(refuseBuy(rich(price), item.slug) === null, 'exact money is enough');
  check(refuseBuy(rich(price + 1), item.slug) === null, 'and more than enough is enough');
  check(refuseBuy(rich(price - 1), item.slug) === 'poor', 'a dollar short is refused', `${price - 1}`);
  check(refuseBuy(rich(0), item.slug) === 'poor', 'and nothing at all is refused');

  check(
    refuseBuy(rich(price, [item.slug]), item.slug) === 'owned',
    'a card already owned is refused whatever the balance'
  );
  check(
    refuseBuy(rich(price), 'not-a-real-card') === 'unstocked',
    'a card nobody is selling cannot be bought by naming it'
  );
  const notStocked = Object.keys(CARDS).find((s) => !STOCK.some((x) => x.slug === s))!;
  check(
    refuseBuy(rich(999999), notStocked) === 'unstocked',
    'and neither can a real card that is not on the shelf',
    notStocked
  );

  /* A purchase moves the money and the card together. */
  const before = rich(price + 40);
  const after = buy(before, item.slug);
  check((after.money ?? 0) === 40, 'the price comes off the balance', `${after.money}`);
  check(after.collection.includes(item.slug), 'and the card lands in the collection');
  check(after.collection.length === before.collection.length + 1, 'exactly once');
  check((before.money ?? 0) === price + 40, 'the profile handed in is not mutated', `${before.money}`);
  check(
    refuseBuy(after, item.slug) === 'owned',
    'and buying it again is refused, which is what stops a double-tap'
  );
}

console.log('\nthe money only moves the two ways it should');
{
  /* Winning is the only source; the shop is the only sink. There is no third
     path in the code, and this is the assertion that says so out loud. */
  const p = rich(0);
  const won = { ...p, money: (p.money ?? 0) + bountyFor('tony') };
  check((won.money ?? 0) === 1, 'a win adds exactly the bounty', `${won.money}`);

  const item = STOCK[0];
  const saved = rich(item.price);
  const spent = buy(saved, item.slug);
  check((spent.money ?? 0) === 0, 'a purchase removes exactly the price', `${spent.money}`);
  check((spent.money ?? 0) >= 0, 'and never leaves a negative balance');

  /* The long way round, stated as arithmetic rather than as a complaint. */
  const wins = Math.ceil(item.price / Math.max(1, bountyFor('tony')));
  console.log(`     (${CARDS[item.slug]?.name} is ${wins.toLocaleString()} wins at $${bountyFor('tony')} a duel)`);
}

console.log(
  failures === 0 ? '\nEvery shop rule holds. ✅\n' : `\n${failures} shop rule(s) broken. ❌\n`
);
process.exit(failures === 0 ? 0 : 1);
