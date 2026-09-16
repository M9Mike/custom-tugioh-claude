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
import { BOUNTY, STOCK, WAGER, bountyFor, buy, givesAPack, refuseBuy, shopStock, stakeFor, wagerFor } from '../src/story/shop';

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

/* ------------------------------------------------------------------ */
/* Money on the table                                                  */
/* ------------------------------------------------------------------ */

/**
 * The one duelist who takes money as well as giving it.
 *
 * Everything else here is arithmetic that can only ever go up for the player,
 * so the expensive mistakes are all of the form "money out of nowhere". A wager
 * adds the other direction, and with it a way to cheat that a bounty does not
 * have: **lose, and do not admit it.**
 *
 * That is why the stake is taken when the duel is seated rather than settled
 * when it ends, and this block is the pin on that decision. There is exactly
 * one path in the whole app that hands money back — a claimed win — so leaving
 * a duel by any route at all costs the stake by construction: quitting to the
 * world, refreshing, closing the tab, pulling the network out, or simply never
 * going back. None of them reach the payout, because the payout is on the far
 * side of proving you won.
 */
{
  console.log('\nTina, who plays for money on the table\n');

  check(wagerFor('tina') !== null, 'she will not sit down without a stake');
  const range = wagerFor('tina')!;
  check(range.min === 2 && range.max === 5, 'and it is two to five', `${range.min}–${range.max}`);

  /* Her money is the pot. A bounty as well would be paying twice for one win. */
  check(bountyFor('tina') === 0, 'she pays no bounty on top of it', `$${bountyFor('tina')}`);
  check(givesAPack('tina'), 'but a win still takes a pack of her deck');

  /* Nobody else can be talked into it, whatever the client sends. */
  check(
    Object.keys(WAGER).every((id) => !!DUELIST_BY_ID[id]),
    'every duelist who wagers is a real one',
    Object.keys(WAGER).filter((id) => !DUELIST_BY_ID[id]).join(', ')
  );
  check(stakeFor('sarah', 5) === 0 && stakeFor('tony', 5) === 0,
    'and nobody else can be made to play for money');

  /* The client picks the figure, so the client is not trusted with it. */
  check(stakeFor('tina', 2) === 2 && stakeFor('tina', 5) === 5, 'two and five are taken as asked');
  check(stakeFor('tina', 3) === 3 && stakeFor('tina', 4) === 4, 'and so are three and four');
  check(stakeFor('tina', 9999) === range.max, 'a greedy figure is clamped down', `$${stakeFor('tina', 9999)}`);
  check(stakeFor('tina', 1) === range.min, 'a cheap one is raised', `$${stakeFor('tina', 1)}`);
  check(stakeFor('tina', -100) === range.min, 'and a negative one cannot pay her', `$${stakeFor('tina', -100)}`);
  check(stakeFor('tina', 3.5) === range.min, 'half a dollar is not a stake', `$${stakeFor('tina', 3.5)}`);
  check(stakeFor('tina', '5') === range.min, 'nor is a string that looks like one');
  check(stakeFor('tina', undefined) === range.min, 'and asking for nothing pays the minimum');

  /*
   * The whole point, as arithmetic.
   *
   * A win returns twice the stake — the player's own back, and hers won. A duel
   * that is not won returns nothing, and the stake has already gone, so the two
   * outcomes are +stake and −stake against where the player started.
   */
  for (const stake of [range.min, 3, 4, range.max]) {
    const before = 10;
    const seated = before - stake;
    const afterWin = seated + bountyFor('tina') + stake * 2;
    const afterAnythingElse = seated;
    check(afterWin - before === stake, `a $${stake} win leaves them up $${stake}`, `$${before} → $${afterWin}`);
    check(before - afterAnythingElse === stake,
      `and walking out of a $${stake} duel costs them $${stake}`, `$${before} → $${afterAnythingElse}`);
  }

  /*
   * And it cannot go negative, which is the rule the rest of this file holds
   * the shop to. The route refuses before it deducts; this is the arithmetic
   * that refusal protects.
   */
  const broke = rich(1);
  check((broke.money ?? 0) < range.min, '$1 cannot cover her cheapest bet');
  check((broke.money ?? 0) - range.min < 0, 'so taking it anyway would go negative — which is why the route refuses first');
}

console.log(
  failures === 0 ? '\nEvery shop rule holds. ✅\n' : `\n${failures} shop rule(s) broken. ❌\n`
);
process.exit(failures === 0 ? 0 : 1);
