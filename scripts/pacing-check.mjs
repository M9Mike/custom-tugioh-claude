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
const MIN_READABLE = 500; // generous floor; the code aims for 800

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

/* Watch the declaration line and time every distinct thing it says. Reading the
   DOM rather than the state is the point — this is what a person sees. */
await page.evaluate(() => {
  window.__said = [];
  let current = null;
  let since = performance.now();
  const read = () => {
    const el = document.querySelector('[data-testid="declaration"]');
    const txt = el && el.offsetParent !== null ? el.innerText.replace(/\s+/g, ' ').trim() : null;
    if (txt !== current) {
      if (current) window.__said.push({ text: current, ms: Math.round(performance.now() - since) });
      current = txt;
      since = performance.now();
    }
  };
  window.__stop = () => {
    if (current) window.__said.push({ text: current, ms: Math.round(performance.now() - since) });
  };
  setInterval(read, 40);
});

/* Play several turns, waiting for the computer between them rather than
   clicking on a fixed timer. Pacing is the thing under test, so a loop that
   outruns the board would report the improvement as a regression — which is
   exactly what an earlier version of this check did. */
const myTurnVisible = async () => {
  const btn = page.getByRole('button', { name: /^end turn$/i }).first();
  return btn.isEnabled({ timeout: 800 }).catch(() => false);
};

for (let turn = 0; turn < 6; turn++) {
  // Wait for my turn (up to 30s — a full AI turn now narrates itself).
  let mine = false;
  for (let i = 0; i < 60 && !mine; i++) {
    mine = await myTurnVisible();
    if (!mine) await page.waitForTimeout(500);
  }
  if (!mine) break;
  await page
    .getByRole('button', { name: /^end turn$/i })
    .first()
    .click({ timeout: 4000 })
    .catch(() => {});
  await page.waitForTimeout(600);
}
await page.waitForTimeout(4000);

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
