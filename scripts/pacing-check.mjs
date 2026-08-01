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
/* Legible time, not time on screen. The code aims for 1100ms of beat, of which
   ~86% is at full opacity; anything under this is not a sentence a player can
   read while a duel is happening around them. */
const MIN_READABLE = 700;

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

/* Watch the declaration line and time how long each thing it says is actually
   *legible*.
 *
 * Opacity, not presence. The band fades out over the tail of its own animation,
 * so an earlier version of this check timed the element sitting in the DOM at
 * `opacity: 0` and cheerfully reported a full second of reading time for text
 * nobody could see. That is the trap CLAUDE.md already warns about, walked into
 * from the inside. */
await page.evaluate(() => {
  window.__said = [];
  let current = null;
  let legible = 0;
  let last = performance.now();
  const flush = () => {
    if (current && legible > 0) window.__said.push({ text: current, ms: Math.round(legible) });
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
    const visible = el && el.offsetParent !== null && +getComputedStyle(el).opacity > 0.5;
    const txt = visible ? el.innerText.replace(/\s+/g, ' ').trim() : null;
    if (txt !== current) {
      flush();
      current = txt;
      legible = 0;
    }
    if (txt) legible += dt;
  };
  window.__stop = flush;
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
for (const l of lines.slice(0, 12)) console.log(`  ${String(l.ms).padStart(5)}ms  ${l.text.slice(0, 68)}`);

const tooFast = lines.filter((l) => l.ms < MIN_READABLE);

if (!lines.length) {
  console.log('\n⚠️  the board never announced anything — this proves nothing');
  process.exitCode = 1;
} else if (lines.length < 3) {
  console.log(`\n❌ only ${lines.length} declaration(s) in a whole duel — beats are being dropped`);
  process.exitCode = 1;
} else if (tooFast.length) {
  console.log(`\n❌ ${tooFast.length} declaration(s) flashed past under ${MIN_READABLE}ms:`);
  for (const l of tooFast.slice(0, 5)) console.log(`     ${l.ms}ms — ${l.text.slice(0, 60)}`);
  process.exitCode = 1;
} else {
  console.log(`\n✅ every one of the ${lines.length} declarations stayed long enough to read.`);
}
