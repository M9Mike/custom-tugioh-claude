/**
 * Does the second duel narrate?
 *
 *   node scripts/rematch-check.mjs [baseUrl]
 *
 * A rematch is a brand-new duel delivered into the same mounted board, and
 * every piece of animation bookkeeping survived into it. The new duel's beat
 * ids restart from `a1_0` — colliding with the old duel's earliest ids, which
 * were still in the seen and played sets — so the whole of every second duel
 * played out silently: no declarations, no card animations, the board just
 * snapping from state to state. The win screen's `forceWin` backstop also
 * survived as `true`, so the next ending fired its modal and fanfare over the
 * killing blow.
 *
 * This plays a vs-computer duel to the death in a real browser (passing every
 * turn — the computer does the killing), collects the declarations the board
 * shows, presses Rematch, and insists the second duel announces itself too.
 * The check needs both numbers: a probe that only watched duel 2 would pass
 * on a board that never narrates at all.
 *
 * The declarations are sampled from the Node side, one read per loop pass.
 * Two in-page samplers failed first: a 50ms `setInterval` starved whenever
 * Playwright's accessibility queries held the main thread, and a
 * MutationObserver went quiet after the rematch — both reported a silent
 * board while the client's own render log showed every declaration mounting.
 * Reading the DOM from outside on each pass is coarser, but every sighting is
 * real, and a beat is held for over a second — plenty for a ~400ms cadence
 * across a whole duel.
 */
import { webkit, devices } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:3100').replace(/\/$/, '');

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

const { code, token } = await post('/api/room', { name: 'Mihail', vsAi: true });
await post(`/api/room/${code}/act`, { kind: 'chooseDuelist', token, duelistId: 'yugi' });

const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 11'] });
await ctx.addInitScript(
  ([k, id]) => {
    try {
      localStorage.setItem(k, JSON.stringify(id));
    } catch {
      /* reported as proving nothing below */
    }
  },
  [`duel-identity:${code.toUpperCase()}`, { code, token }]
);
const page = await ctx.newPage();
/* Surfacing page errors costs nothing and has already caught a probe bug. */
page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 300)));
await page.goto(`${BASE}/duel/${code}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

/** Reads whatever the declaration band says right now, from outside the page. */
async function sample(bag) {
  let t;
  try {
    t = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="declaration"]');
      return el ? el.innerText : null;
    });
  } catch {
    return;
  }
  if (t) bag.add(t.replace(/\s+/g, ' ').trim());
}

/* The exact modal heading, nothing looser: an /i match on "draw" also matched
   "Yugi Muto draws a card" in the declaration band, and the probe called the
   duel over the first time anybody drew. */
const duelOver = () =>
  page
    .getByText(/^(Victory|Defeat|Draw)$/)
    .first()
    .isVisible({ timeout: 400 })
    .catch(() => false);

/**
 * Passes turns until the computer ends the duel, sampling as it goes.
 *
 * The turn ceiling is patience, not a rule: a probe that passes every turn is
 * waiting for the AI to kill it, and how long that takes depends on the deck
 * across the table. It went inconclusive on production the day Yami Marik's
 * walls landed — 3000 DEF tokens, battle-immune Bowganians and two
 * Nightmare's Steelcages make a genuinely longer duel, and 40 turns of
 * passing was no longer enough to reach the end of one. Widened rather than
 * loosened: a duel that truly never ends still reports "this proves nothing"
 * instead of passing quietly.
 */
async function playToTheDeath(tag, bag) {
  for (let turn = 0; turn < 80; turn++) {
    if (await duelOver()) return true;
    const btn = page.getByRole('button', { name: /^end turn$/i }).first();
    let mine = false;
    for (let i = 0; i < 90 && !mine; i++) {
      await sample(bag);
      if (await duelOver()) return true;
      /* The computer's attack can open a response window for this seat —
         Yugi holds Kuriboh, whose window fires from the hand — and a probe
         that never answers it waits out the whole duel right here. Decline,
         which is also what a player passing every turn would do. */
      const decline = page.getByRole('button', { name: /^do nothing$/i }).first();
      if (await decline.isVisible({ timeout: 150 }).catch(() => false)) {
        await decline.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(300);
        continue;
      }
      await sample(bag);
      mine = await btn.isEnabled({ timeout: 400 }).catch(() => false);
      if (!mine) {
        await page.waitForTimeout(250);
        await sample(bag);
      }
    }
    if (!mine) break;
    await btn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  // The win modal can arrive during the wait above.
  for (let i = 0; i < 30; i++) {
    await sample(bag);
    if (await duelOver()) return true;
    await page.waitForTimeout(400);
  }
  console.log(`⚠️  ${tag}: the duel never ended — this proves nothing`);
  return false;
}

const first = new Set();
if (!(await playToTheDeath('duel 1', first))) {
  await browser.close();
  process.exit(1);
}
console.log(`duel 1: ${first.size} distinct declarations`);

/* Into the second duel. Against the computer the rematch is immediate. */
await page.getByRole('button', { name: /rematch/i }).first().click({ timeout: 5000 });
await page.waitForTimeout(2000);

const second = new Set();
if (!(await playToTheDeath('duel 2', second))) {
  await browser.close();
  process.exit(1);
}
console.log(`duel 2: ${second.size} distinct declarations`);
if (process.env.REMATCH_DEBUG) {
  console.log('duel 2 saw:', JSON.stringify([...second]));
}
await browser.close();

if (first.size < 3) {
  console.log('\n⚠️  the first duel barely narrated — this proves nothing about the second');
  process.exitCode = 1;
} else if (second.size < 3) {
  console.log("\n❌ the rematch played out in silence — the new duel inherited the old one's bookkeeping");
  process.exitCode = 1;
} else {
  console.log('\n✅ both duels narrate: the rematch starts clean.');
}
