/**
 * Does the computer's turn read as one thing after another?
 *
 *   node scripts/pacing-check.mjs [baseUrl]
 *
 * Two things used to go wrong at once, and both were invisible from a
 * screenshot:
 *
 * 1. `applyAction` emptied `state.anims` on every action. The computer plays
 *    one action per nudge while the poll loop runs on its own timer, so a poll
 *    landing after two AI actions jumped a version — and the skipped action's
 *    events had already been destroyed. A whole turn arrived as its final beat.
 *
 * 2. The nudge fired every 750ms regardless of what was on screen, so the board
 *    raced ahead of its own narration and the declarations blurred past.
 *
 * So this plays a real vs-AI duel in a browser, records every declaration the
 * board puts up and how long each stayed, and insists the computer announced
 * more than one thing and that each line was readable.
 */
import { webkit, devices } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:3100').replace(/\/$/, '');

/* Two numbers per beat, because one of them cannot be trusted on its own.
 *
 * `mounted` is how long the queue held the beat — that is the thing under test,
 * and it is measured from real elapsed time, so a busy frame delays the sample
 * without losing any of it.
 *
 * `legible` is how much of that was above half opacity. It can only ever be
 * *under*counted: when a frame is busy the tick lands late, and if it lands
 * after the fade the whole interval is credited to `mounted` and none of it to
 * `legible`. An earlier version of this check asserted a per-beat floor on that
 * number and duly failed at 691ms against a 700ms bar — on a beat the queue had
 * held for the full 1100ms. It was measuring its own jitter.
 *
 * So: the hold is asserted per beat, where the measurement is sound, and the
 * visible fraction is asserted across the run, where the jitter averages out.
 *
 * The share bar is deliberately loose. It is here to catch a beat that is held
 * and not shown at all — a broken animation, a band left at zero opacity — not
 * to police the last hundred milliseconds. Sampled directly with
 * `getAnimations()`, a 1100ms beat reads 81–86% and a 1000ms one 71–76%, which
 * is too close to separate reliably; what keeps those two numbers in step is
 * the comment on `.declare` pinning its duration to `MIN_SPOKEN_MS`. */
const MIN_HOLD = 950;
const MIN_VISIBLE_SHARE = 0.7;

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
      /* the probe reports "proved nothing" if it lands on the wrong screen */
    }
  },
  [`duel-identity:${code.toUpperCase()}`, { code, token }]
);
const page = await ctx.newPage();
await page.goto(`${BASE}/duel/${code}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

/* Watch the declaration line: how long the queue holds each thing it says, and
   how much of that hold the text is actually legible for.
 *
 * A beat is only recorded once the *next* one replaces it, because that is what
 * bounds it. The last declaration of a finished duel simply stays in the DOM at
 * `opacity: 0` — its animation has run and there is nothing after it to push it
 * out — so counting the in-flight beat reported a twenty-second hold that was
 * 19% legible and failed the run. Opacity, not presence, for the same family of
 * reason on the other axis: an earlier version timed that same parked element
 * as a full second of reading time for text nobody could see. */
await page.evaluate(() => {
  window.__said = [];
  let current = null;
  let last = performance.now();
  const flush = () => {
    if (current && current.mounted > 0) window.__said.push(current);
  };
  const read = () => {
    const now = performance.now();
    /* Real elapsed time between ticks, not a fixed step. A busy frame delays
       the interval, and counting a constant per tick undercounted exactly the
       beats with the most animation behind them — which then read as the game
       rushing when it was the probe blinking. */
    const dt = now - last;
    last = now;
    const el = document.querySelector('[data-testid="declaration"]');
    const shown = el && el.offsetParent !== null;
    const txt = shown ? el.innerText.replace(/\s+/g, ' ').trim() : null;
    if (txt !== current?.text) {
      flush();
      current = txt ? { text: txt, mounted: 0, legible: 0 } : null;
    }
    if (current && shown) {
      current.mounted += dt;
      if (+getComputedStyle(el).opacity > 0.5) current.legible += dt;
    }
  };
  /* Deliberately *not* `flush` — the beat still on screen when the run ends has
     nothing after it to bound its hold, so it is dropped rather than counted. */
  window.__stop = () => {
    current = null;
  };
  setInterval(read, 16);
});

/* Play several turns, waiting for the computer between them rather than
   clicking on a fixed timer. Pacing is the thing under test, so a loop that
   outruns the board would report the improvement as a regression — which is
   exactly what an earlier version of this check did. */
const myTurnVisible = async () => {
  const btn = page.getByRole('button', { name: /^end turn$/i }).first();
  return btn.isEnabled({ timeout: 800 }).catch(() => false);
};

/* Played to the death on purpose. The report that prompted this check was
   "until I lost I didn't understand anything" — the rush is at the *end* of a
   duel, where a losing turn arrives as one long chain, so a run that stops
   after a few polite turns never sees it. */
const duelOver = async () =>
  page
    .getByText(/victory|defeat|wins the duel|you win|you lose/i)
    .first()
    .isVisible({ timeout: 400 })
    .catch(() => false);

for (let turn = 0; turn < 30; turn++) {
  if (await duelOver()) break;
  let mine = false;
  for (let i = 0; i < 80 && !mine; i++) {
    if (await duelOver()) break;
    mine = await myTurnVisible();
    if (!mine) await page.waitForTimeout(400);
  }
  if (!mine) break;
  await page
    .getByRole('button', { name: /^end turn$/i })
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(500);
}
await page.waitForTimeout(5000);

await page.evaluate(() => window.__stop());
const said = await page.evaluate(() => window.__said);
await browser.close();

const lines = said.filter((s) => s.text && s.text.length > 3);
console.log(`declarations shown: ${lines.length}`);
console.log('   held  legible  text');
for (const l of lines.slice(0, 12)) {
  console.log(`  ${String(Math.round(l.mounted)).padStart(5)}  ${String(Math.round(l.legible)).padStart(7)}  ${l.text.slice(0, 60)}`);
}

const rushed = lines.filter((l) => l.mounted < MIN_HOLD);
const heldMs = lines.reduce((sum, l) => sum + l.mounted, 0);
const seenMs = lines.reduce((sum, l) => sum + l.legible, 0);
const share = heldMs ? seenMs / heldMs : 0;

if (!lines.length) {
  console.log('\n⚠️  the board never announced anything — this proves nothing');
  process.exitCode = 1;
} else if (lines.length < 3) {
  console.log(`\n❌ only ${lines.length} declaration(s) in a whole duel — beats are being dropped`);
  process.exitCode = 1;
} else if (rushed.length) {
  console.log(`\n❌ ${rushed.length} declaration(s) held for less than ${MIN_HOLD}ms:`);
  for (const l of rushed.slice(0, 5)) console.log(`     ${Math.round(l.mounted)}ms — ${l.text.slice(0, 60)}`);
  process.exitCode = 1;
} else if (share < MIN_VISIBLE_SHARE) {
  console.log(
    `\n❌ the band was only visible for ${(share * 100).toFixed(0)}% of the time it was held ` +
      `(want ${(MIN_VISIBLE_SHARE * 100).toFixed(0)}%) — the beat is being paid for and not shown`
  );
  process.exitCode = 1;
} else {
  console.log(
    `\n✅ all ${lines.length} declarations held past ${MIN_HOLD}ms, ` +
      `and were visible for ${(share * 100).toFixed(0)}% of it.`
  );
}
