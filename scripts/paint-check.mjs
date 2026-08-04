/**
 * The screens must survive being looked at.
 *
 * `npm run rejoin` could not finish a single run against production — four
 * attempts, four different deaths, all classified "this proves nothing". The
 * cause was not the seat logic it tests: sitting on the duelist-choice screen
 * killed the WebKit renderer outright, 8 times out of 8. Every other probe in
 * the battery clicks through that screen in well under a second, so nothing
 * ever noticed.
 *
 * The mechanism was one declaration. `.btn` transitioned `filter`, and
 * `.btn:hover` set `brightness(1.22)` — so a cursor left resting on a button
 * (which is exactly where a click leaves it) promoted that button to a
 * composited layer re-rasterised through a filter every frame, inside a
 * `.panel.grain` whose `::after` paints an SVG `feTurbulence` with
 * `mix-blend-mode: overlay`. A filtered layer compositing through a blended
 * one is pathological in WebKit, and the lobby stacks fifteen of them.
 *
 * So there are two checks here, and they are deliberately different in kind:
 *
 *   1. The mechanism. Nothing may transition `filter`. Cheap, deterministic,
 *      and it names the actual defect rather than its symptom.
 *   2. The symptom. Park the cursor on a button, sit on the screen, and
 *      insist the renderer is still alive afterwards. Slower and coarser, but
 *      it is blind to *how* a future regression makes the page too expensive,
 *      which is the whole point of keeping it.
 *
 * A screen that cannot be reached reports "this proves nothing" and fails,
 * rather than passing by never having looked.
 */
import { webkit } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:3100').replace(/\/$/, '');
/** Long enough for the compositor to dig its own grave; it took ~600ms. */
const DWELL_MS = 8000;

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

let failures = 0;
const ok = (pass, label, detail = '') => {
  if (!pass) failures++;
  console.log(`  ${pass ? '✅' : '❌'} ${label}${!pass && detail ? ` — ${detail}` : ''}`);
};

/** Every element whose computed transition mentions `filter`. */
const filterTransitions = (page) =>
  page.evaluate(() => {
    const hits = [];
    for (const el of document.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      // `backdrop-filter` counts too: same layer promotion, same cost.
      if (!/\bfilter\b/.test(cs.transitionProperty)) continue;
      // `transition-property: all` is not proof of a filter, but it is proof
      // that one would be transitioned the moment somebody adds it.
      hits.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} :: ${cs.transitionProperty}`);
    }
    return [...new Set(hits)];
  });

const browser = await webkit.launch();

/** Land on a screen, returning a page or null if it could not be reached. */
async function reach(name, drive) {
  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 } });
  const page = await ctx.newPage();
  let dead = false;
  page.on('crash', () => { dead = true; });
  try {
    await drive(page);
    return { page, ctx, crashed: () => dead };
  } catch (err) {
    ok(false, `${name}: could not be reached — this proves nothing`, String(err).split('\n')[0]);
    await ctx.close().catch(() => {});
    return null;
  }
}

async function home(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const start = page.getByRole('button', { name: /start a new duel/i });
  await start.waitFor({ timeout: 25000 });
  for (let i = 0; i < 60 && (await start.isDisabled()); i++) await page.waitForTimeout(250);
}

async function lobby(page) {
  await home(page);
  await page.getByPlaceholder('Enter your name').fill('Mihail');
  await page.getByRole('button', { name: /start a new duel/i }).click();
  await page.waitForURL(/\/duel\/[A-Z0-9]{4,5}/, { timeout: 30000 });
  await page.getByText(/choose your duelist/i).waitFor({ timeout: 25000 });
}

/* Against the computer, because one seat alone never starts a duel — choosing
   a duelist in an empty room leaves you waiting on the lobby, which is the
   screen above. The room is made over HTTP and the seat seeded into
   `localStorage`, the same way `npm run rematch` does it. */
async function board(page) {
  const { code, token } = await post('/api/room', { name: 'Mihail', vsAi: true });
  await post(`/api/room/${code}/act`, { kind: 'chooseDuelist', token, duelistId: 'yugi' });
  await page.context().addInitScript(
    ([k, id]) => {
      try {
        localStorage.setItem(k, JSON.stringify(id));
      } catch {
        /* the duel simply will not load, and the reach() guard reports it */
      }
    },
    [`duel-identity:${code.toUpperCase()}`, { code, token }]
  );
  await page.goto(`${BASE}/duel/${code}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('[data-testid="hand-strip"]').waitFor({ timeout: 30000 });
}

const SCREENS = [
  ['the home page', home],
  ['the duelist-choice screen', lobby],
  ['the duel board', board],
];

console.log(`The screens must survive being looked at — ${BASE}\n`);

for (const [name, drive] of SCREENS) {
  console.log(`• ${name}`);
  const landed = await reach(name, drive);
  if (!landed) continue;
  const { page, ctx, crashed } = landed;

  const hits = await filterTransitions(page).catch(() => null);
  if (hits === null) ok(false, 'the stylesheet could be read — this proves nothing');
  else ok(hits.length === 0, 'nothing transitions `filter`', hits.slice(0, 3).join(' | '));

  /* Park the cursor on a button and leave it there. That is where a click
     leaves it, and it is what made the difference between a screen that
     crashed 8/8 and one that never did. */
  const btn = page.locator('.btn:not(:disabled)').first();
  const parked = await btn.hover({ timeout: 5000 }).then(() => true).catch(() => false);
  ok(parked, 'the cursor can be parked on a button', 'no enabled .btn on this screen');

  const t0 = Date.now();
  while (Date.now() - t0 < DWELL_MS && !crashed()) await new Promise((r) => setTimeout(r, 400));
  const alive = !crashed() && (await page.evaluate(() => document.body.childElementCount).catch(() => null)) !== null;
  ok(alive, `the renderer survives ${DWELL_MS / 1000}s with the cursor resting there`, 'the page crashed');

  await ctx.close().catch(() => {});
}

await browser.close().catch(() => {});

console.log(
  failures
    ? `\n${failures} problem(s) — a screen is too expensive to look at`
    : '\nEvery screen survives being looked at. ✅'
);
process.exitCode = failures ? 1 : 0;
