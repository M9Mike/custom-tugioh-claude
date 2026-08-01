/**
 * Checks the signature card's flourish actually goes anywhere.
 *
 *   node scripts/anim-check.mjs [baseUrl] [outDir]
 *
 * Screenshotting a live duel lands on whichever frame it lands on, and the
 * flourish looked fine that way while being badly broken: with a single ease-out
 * over the whole run the card covered all 600px of its depth in the first 200ms,
 * while it was still fading in, so it arrived already at full size and then sat
 * there. Nothing about a still frame says so.
 *
 * This pauses the real keyframes and steps them with the Web Animations API,
 * reading the projected width at each point — the number a player would
 * perceive as "it came at me". A holiday from that is what the assertions guard.
 */
import { webkit } from 'playwright';
import fs from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = process.argv[3] ?? '';
const DURATION = 1400; // must match SIG_MS in Duel.tsx and the sig-* keyframes

/** The stage, with a stand-in for the card — the geometry is what is under test. */
const MARKUP = `
  <div class="sig-stage" id="stage">
    <div class="sig-card" id="card" style="position:relative">
      <div class="card-shell" style="aspect-ratio:59/86;background:#241a0e;border:2px solid #b98a2e"></div>
      <div class="sig-glint" id="glint"></div>
    </div>
  </div>`;

const main = async () => {
  if (OUT) await fs.mkdir(OUT, { recursive: true });
  const browser = await webkit.launch();
  const errors = [];

  for (const [label, width, height] of [['iphone11', 414, 896], ['iphone17promax', 440, 956]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    // A real page from the running build, so the shipped CSS is what is measured.
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await page.evaluate((markup) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0b0d12';
      host.innerHTML = markup;
      document.body.appendChild(host);
    }, MARKUP);

    const running = await page.evaluate(() => document.getAnimations().map((a) => a.animationName ?? '?'));
    for (const name of ['sig-dim', 'sig-rush', 'sig-glint']) {
      if (!running.includes(name)) errors.push(`[${label}] ${name} never started — the flourish is not wired up`);
    }
    if (errors.length) break;

    const frames = await page.evaluate((duration) => {
      const card = document.getElementById('card');
      /* The laid-out width, not `getBoundingClientRect()` — that one is already
         through the transform, so every scale below would have been measured
         against whichever frame the animation happened to be sitting on. */
      const base = parseFloat(getComputedStyle(card).width);
      const out = [];
      for (let pct = 0; pct <= 100; pct += 2) {
        for (const a of document.getAnimations()) { a.pause(); a.currentTime = (duration * pct) / 100; }
        const r = card.getBoundingClientRect();
        out.push({ pct, scale: r.width / base, opacity: +getComputedStyle(card).opacity });
      }
      return { base, out };
    }, DURATION);

    const seen = frames.out.filter((f) => f.opacity > 0.35);
    const first = seen[0];
    const settle = frames.out.find((f) => f.pct === 60);
    const last = seen[seen.length - 1];
    const peak = frames.out[frames.out.length - 1];

    // …it has to come from somewhere far enough away to be seen travelling…
    if (!first || first.scale > 0.8) {
      errors.push(`[${label}] the card is already ${(first?.scale ?? 0).toFixed(2)}× when it becomes visible — nothing to watch it arrive from`);
    }
    // …grow appreciably on the way in…
    if (first && settle && settle.scale / first.scale < 1.35) {
      errors.push(`[${label}] it only grows ${(settle.scale / first.scale).toFixed(2)}× on the way in; it should read as coming forward`);
    }
    // …hold still long enough to read the card…
    const hold = frames.out.filter((f) => f.pct >= 52 && f.pct <= 78);
    const spread = Math.max(...hold.map((f) => f.scale)) / Math.min(...hold.map((f) => f.scale));
    if (spread > 1.12) errors.push(`[${label}] no hold — it changes ${spread.toFixed(2)}× across the middle of the run`);
    if (hold.some((f) => f.opacity < 0.9)) errors.push(`[${label}] it fades during the hold, so the card cannot be read`);
    // …and rush past rather than shrink away.
    if (peak.scale < 3) errors.push(`[${label}] it only reaches ${peak.scale.toFixed(2)}× — that reads as a shrink, not a rush past`);
    if (last && last.scale < 1.15) errors.push(`[${label}] it has faded out by ${last.scale.toFixed(2)}×, so the rush is never seen`);
    // Both ends must be invisible, or the card is left sitting on the board.
    if (frames.out[0].opacity > 0.01) errors.push(`[${label}] it is already visible at 0%`);
    if (peak.opacity > 0.01) errors.push(`[${label}] it never fades out — the card would be left on the board`);

    console.log(
      `  ${label}: enters at ${first ? first.scale.toFixed(2) : '—'}×, holds ~${settle?.scale.toFixed(2)}×, ` +
        `leaves at ${peak.scale.toFixed(2)}× (card ${Math.round(frames.base)}px wide)`
    );

    if (OUT) {
      for (const pct of [10, 30, 52, 66, 80, 92]) {
        await page.evaluate(
          ([pct, duration]) => {
            for (const a of document.getAnimations()) { a.pause(); a.currentTime = (duration * pct) / 100; }
          },
          [pct, DURATION]
        );
        await page.waitForTimeout(60);
        await page.screenshot({ path: `${OUT}/sig-${label}-${String(pct).padStart(3, '0')}.png` });
      }
    }
    await ctx.close();
  }

  await lifeBarSurvivesARender(browser, errors);

  await browser.close();
  if (errors.length) {
    console.error('\nThe animation does not read:');
    for (const e of errors) console.error(`  ❌ ${e}`);
    process.exit(1);
  }
  console.log('\nThe signature flourish arrives, holds and rushes past, and the Life Point bar glides. ✅');
};

/**
 * The Life Point bar has a 500ms width transition, which only runs if the same
 * DOM node survives from one render to the next.
 *
 * `PlayerBar` was declared inside `Duel`, making it a fresh function identity
 * every render — React reads that as a different component type and remounts
 * the subtree, and a node that mounts already at its final width has nothing to
 * transition *from*. So the bar snapped while everything else about pacing
 * damage was being carefully held back. Nothing in a screenshot says so, and no
 * rules test can see it; the tell is whether the element is still the same one.
 */
async function lifeBarSurvivesARender(browser, errors) {
  const post = async (path, body) => {
    const r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.json();
  };

  const { code, token } = await post('/api/room', { name: 'Mihail', vsAi: true });
  await post(`/api/room/${code}/act`, { kind: 'chooseDuelist', token, duelistId: 'yugi' });

  const ctx = await browser.newContext({ viewport: { width: 414, height: 896 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(
    ([k, id]) => {
      try {
        localStorage.setItem(k, JSON.stringify(id));
      } catch {
        /* the check just lands on the "duel is full" screen and says so */
      }
    },
    [`duel-identity:${code.toUpperCase()}`, { code, token }]
  );
  const page = await ctx.newPage();
  await page.goto(`${BASE}/duel/${code}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const SEL = '.duel-root .transition-\\[width\\]';
  const before = await page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)];
    els.forEach((el, i) => el.setAttribute('data-probe', String(i)));
    return els.length;
  }, SEL);

  if (!before) {
    // Reaching neither state proves nothing, so say that rather than pass.
    errors.push('could not find a Life Point bar to test — this check proved nothing');
    await ctx.close();
    return;
  }

  // Any state change re-renders the board; the sound toggle changes nothing else.
  await page
    .locator('.duel-root button')
    .first()
    .click({ timeout: 5000 })
    .catch(() => {});
  await page.waitForTimeout(500);

  const after = await page.locator('[data-probe]').count();
  console.log(`\n  life point bars: ${before} tagged, ${after} survived a re-render`);
  if (after < before) {
    errors.push(
      `the Life Point bar is rebuilt every render (${after}/${before} survived), so its 500ms transition never runs`
    );
  }
  await ctx.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
