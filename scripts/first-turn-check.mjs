/**
 * Does the computer wait for an audience?
 *
 *   node scripts/first-turn-check.mjs [baseUrl]
 *
 * Reported as "the duel can not start with the ai just ending its turn (no
 * matter if it played summoned set whatever, it must take place for the human
 * to see)".
 *
 * The computer plays one action per nudge, and the nudge loop lives in the
 * *room* hook rather than in the board — so it kept asking for the computer's
 * next move while the player was on a screen that is not the board. In a
 * tournament that is guaranteed: every round opens on the bracket and you walk
 * into your duel by tapping through, so a computer with the first turn played
 * the whole thing behind the standings. Walking in afterwards, the board primes
 * on a view where all of it has already happened and correctly treats it as
 * history — the same swallow that stops a re-join re-enacting the last dozen
 * beats. The player arrives at a board built while they were somewhere else.
 *
 * So this watches the one thing that separates the two: the duel's own
 * `version`, read from the API on the Node side rather than from the page.
 * Sampling through Playwright would starve the page's nudge loop and slow the
 * duel by itself — that trap is written down in CLAUDE.md and was walked into
 * while chasing this very bug.
 *
 *   1. Sit on the bracket. The version must not move: nobody is watching.
 *   2. Walk into the duel. The version must move, and the board must narrate.
 *
 * A duel where the *player* has the first turn proves nothing either way, so
 * the probe opens rooms until the computer has it, and says so rather than
 * passing quietly if it never gets one.
 */
import { webkit, devices } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:3100').replace(/\/$/, '');

let failures = 0;
const ok = (pass, label, detail = '') => {
  console.log(`  ${pass ? '✅' : '❌'} ${label}${!pass && detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

const readState = async (code, token) => {
  const r = await fetch(`${BASE}/api/room/${code}/state?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.view ?? null;
};

/* Open tournament rooms until one deals the computer the first turn. The
   player always holds a seat in their own bracket match, so "not you" is the
   computer. */
let room = null;
for (let attempt = 0; attempt < 8 && !room; attempt++) {
  const r = await post('/api/room', { name: 'Mihail', tournament: true });
  await post(`/api/room/${r.code}/act`, { kind: 'chooseDuelist', token: r.token, duelistId: 'yugi' });
  let view = null;
  for (let i = 0; i < 30 && !view?.state; i++) {
    view = await readState(r.code, r.token);
    if (!view?.state) await new Promise((res) => setTimeout(res, 400));
  }
  if (!view?.state) continue;
  if (view.state.active !== view.you) room = { ...r, first: view.state.active, you: view.you };
}

if (!room) {
  console.log('⚠️  never drew a bracket match where the computer moves first — this proves nothing');
  process.exit(1);
}

console.log(`• bracket room ${room.code} — the computer has the first turn`);

const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 11'] });
await ctx.addInitScript(
  ([k, id]) => {
    try {
      localStorage.setItem(k, JSON.stringify(id));
    } catch {
      /* reported below as never reaching the bracket */
    }
  },
  [`duel-identity:${room.code.toUpperCase()}`, { code: room.code, token: room.token }]
);
const page = await ctx.newPage();
/* 60s and not Playwright's default 30: Paris plus a cold serverless start has
   outrun the default three times now. */
await page.goto(`${BASE}/duel/${room.code}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

const toDuel = page.getByRole('button', { name: /to the duel/i }).first();
let onBracket = false;
for (let i = 0; i < 60 && !onBracket; i++) {
  onBracket = await toDuel.isVisible({ timeout: 500 }).catch(() => false);
  if (!onBracket) await page.waitForTimeout(500);
}
if (!onBracket) {
  const seen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200)).catch(() => '?');
  console.log(`⚠️  never reached the bracket screen — this proves nothing. On screen: ${seen}`);
  await browser.close();
  process.exit(1);
}

/* ---- 1. nobody is watching ---- */
const before = (await readState(room.code, room.token))?.state?.version ?? -1;
/* Fifteen seconds is a dozen nudges at 750ms plus room for a serverless cold
   start — far more than the one action it takes to make the point. */
await page.waitForTimeout(15000);
const idled = (await readState(room.code, room.token))?.state?.version ?? -1;
ok(idled === before, 'sitting on the bracket, the computer does not play its turn', `version ${before} → ${idled}`);

/* ---- 2. now somebody is ---- */
await toDuel.click({ timeout: 20000 }).catch(() => {});
await page.waitForSelector('[data-testid="hand-strip"]', { timeout: 40000 }).catch(async () => {
  const seen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200));
  throw new Error(`never reached the board after walking in. On screen: ${seen}`);
});

const said = new Set();
let moved = before;
for (let i = 0; i < 90 && (said.size < 2 || moved === before); i++) {
  const t = await page
    .evaluate(() => document.querySelector('[data-testid="declaration"]')?.innerText ?? null)
    .catch(() => null);
  if (t) said.add(t.replace(/\s+/g, ' ').trim());
  moved = (await readState(room.code, room.token))?.state?.version ?? moved;
  await page.waitForTimeout(500);
}
ok(moved > before, 'walking in, the computer starts playing', `version ${before} → ${moved}`);
ok(said.size >= 2, 'and the board narrates its turn to the player who walked in', `${said.size} declarations`);

await browser.close();
console.log(
  failures ? `\n❌ ${failures} first-turn check(s) failed` : '\n✅ the computer plays its first turn for somebody to see.'
);
if (failures) process.exitCode = 1;
