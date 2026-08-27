/**
 * Photographs Story Mode being *used*.
 *
 * `story-check` asserts that the controls work: it taps a thing and checks the
 * screen changed. That is a different question from whether they feel right,
 * and it is blind to everything this is for — a slider that jumps rather than
 * follows, a drag that turns the wrong way, a pinch that runs away, a stick
 * that walks the duelist towards the camera, a menu sitting where a thumb goes.
 * None of that fails an assertion. All of it is obvious in a strip of frames.
 *
 * So this drives each control the way a player would, through real touch events
 * rather than synthetic ones, and writes a numbered sequence per interaction
 * that can be flipped through.
 *
 * Touch goes through CDP on purpose. Dispatching `PointerEvent`s from
 * `page.evaluate` looks equivalent and is not: `setPointerCapture` throws for a
 * pointer id the browser never issued, which kills the very handler under test.
 * `Input.dispatchTouchEvent` produces pointers the browser owns, which is also
 * the only way to get two of them at once for a pinch.
 *
 *   npm run handling
 *   npm run handling -- --base http://localhost:3000 --out /tmp/handling
 *   npm run handling -- --only iphone14
 */

import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const BASE = flag('base', 'http://localhost:3000');
const OUT = flag('out', '/tmp/handling');
const ONLY = flag('only', '');
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined /* let Playwright find its own:
  the hard-coded container path does not exist on a developer's machine */;

const PHONES = {
  iphone14: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  iphone17promax: { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
};

/* A name that matches nothing would filter every phone out, and the run would
   then finish with a cheerful line about frames in a directory that has none.
   A tool whose whole job is to photograph things must not report success for
   having photographed nothing. */
if (ONLY && !(ONLY in PHONES)) {
  console.error(`handling: no phone called "${ONLY}". Try: ${Object.keys(PHONES).join(', ')}`);
  process.exit(2);
}

await fs.mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: EXEC });
/** Anything that should make this run fail: a page error, or a missing control. */
let faults = 0;

try {
  for (const [phone, profile] of Object.entries(PHONES)) {
    if (ONLY && phone !== ONLY) continue;
    console.log(`\n── ${phone} ──`);
    const ctx = await browser.newContext(profile);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => {
      console.log(`  ! page error: ${e.message}`);
      faults++;
    });
    /* A control with no box is a control that is not on the screen. Say which
       one and carry on to the rest — but the run has failed, because the
       alternative is a directory of frames with a gesture quietly missing from
       it and nothing to say so. */
    const boxOf = async (locator, what) => {
      const box = await locator.boundingBox().catch(() => null);
      if (!box) {
        console.log(`  ! no ${what} to drive`);
        faults++;
      }
      return box;
    };
    const cdp = await ctx.newCDPSession(page);
    /* The dev overlay parks itself over the bottom-left corner, which is where
       Back lives — it would read as the button being obscured. */
    await ctx.addInitScript(() => {
      const strip = () => document.querySelectorAll('nextjs-portal').forEach((el) => el.remove());
      new MutationObserver(strip).observe(document, { childList: true, subtree: true });
      strip();
    });

    /* Real touch, owned by the browser. `touchPoints` carries as many as the
       gesture needs, which is what makes a pinch possible at all. */
    const touch = (type, points) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i })),
      });

    let n = 0;
    const shot = async (label) => {
      const name = `${phone}-${String(++n).padStart(3, '0')}-${label}`;
      await fs.writeFile(`${OUT}/${name}.png`, await page.screenshot());
      return name;
    };

    /** A drag, captured every step, so the *motion* is the record. */
    const dragCapture = async (from, to, steps, label) => {
      await touch('touchStart', [from]);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        await touch('touchMove', [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }]);
        await page.waitForTimeout(70);
        await shot(`${label}-${i}`);
      }
      await touch('touchEnd', []);
    };

    /* ---------------- into the booth ---------------- */

    await page.goto(`${BASE}/story`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    await page.locator('input[placeholder="Enter your name"]').fill('Mike');
    await page.locator('button:has-text("Enter Story Mode")').tap();
    await page.waitForTimeout(2500);

    const inBooth = await page.locator('h1:has-text("Make your duelist")').isVisible().catch(() => false);
    const box = inBooth ? await boxOf(page.locator('canvas').first(), 'booth canvas') : null;
    if (!inBooth) {
      console.log('  (already past the booth — world only)');
    } else if (!box) {
      console.log('  (skipping the booth gestures — there is nothing to drive)');
    } else {
      /* The first duelist is a fetch away; the booth stamps `data-ready` when
         one is standing, and frames of an empty plinth photograph nothing —
         so a booth that never becomes ready is a fault, not a shrug: the run
         carries on (the empty frames are themselves evidence) but must not
         end by reporting success. */
      await page.locator('[data-ready="yes"]').waitFor({ timeout: 30000 }).catch(() => {
        console.log('  ! the booth never reported a model ready — photographing it anyway');
        faults++;
      });
      await shot('booth-open');
      const mid = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

      /* ---- drag to turn ---- */
      await dragCapture({ x: mid.x - 90, y: mid.y }, { x: mid.x + 90, y: mid.y }, 6, 'booth-turn');
      await page.waitForTimeout(500);
      await shot('booth-turn-settled');

      /* ---- drag up and down, which moves the camera's pitch ---- */
      await dragCapture({ x: mid.x, y: mid.y - 60 }, { x: mid.x, y: mid.y + 60 }, 4, 'booth-pitch');

      /* ---- pinch: two fingers apart, then together ---- */
      const spread = [
        { x: mid.x - 40, y: mid.y },
        { x: mid.x + 40, y: mid.y },
      ];
      await touch('touchStart', spread);
      for (let i = 1; i <= 5; i++) {
        const g = 40 + i * 22;
        await touch('touchMove', [
          { x: mid.x - g, y: mid.y },
          { x: mid.x + g, y: mid.y },
        ]);
        await page.waitForTimeout(80);
        await shot(`booth-pinch-out-${i}`);
      }
      for (let i = 1; i <= 5; i++) {
        const g = 150 - i * 26;
        await touch('touchMove', [
          { x: mid.x - g, y: mid.y },
          { x: mid.x + g, y: mid.y },
        ]);
        await page.waitForTimeout(80);
        await shot(`booth-pinch-in-${i}`);
      }
      await touch('touchEnd', []);
      await page.waitForTimeout(600);
      await shot('booth-pinch-settled');

      /* The Body / Face framing toggle used to be driven here. It is gone:
         it existed to inspect a face the booth could edit, and the imported
         bodies come with faces nobody can change. Turning and pinching, both
         exercised above, still reach everything it framed. */

      /* ---- every duelist, applied and photographed ---- */
      /* Long enough for the fetch as well as the camera: picking a duelist
         swaps a whole model in, and a shot of an empty plinth says nothing
         about the model that was coming. Read off the page rather than
         restated here, so a model added to the catalog is photographed
         without anyone remembering this file. */
      const picks = await page.$$eval('[data-pick]', (els) => els.map((e) => e.dataset.pick));
      for (const p of picks) {
        await page.locator(`[data-pick="${p}"]`).tap();
        await page.waitForTimeout(2200);
        await shot(`booth-pick-${p.replace(/[^a-z0-9]+/gi, '-')}`);
      }
      /* The tints are swatches per garment, read off the page the same way.
         One mid-palette swatch per garment shows the repaint landing on
         whatever duelist the loop left selected; the first garment's as-made
         chip then has to bring the original paint back. */
      const tints = await page.$$eval('[data-tint]', (els) => els.map((e) => e.dataset.tint));
      const slots = [...new Set(tints.map((t) => t.split(':')[0]))];
      for (const slot of slots) {
        const mine = tints.filter((t) => t.startsWith(`${slot}:`) && !t.endsWith(':-1'));
        const swatch = mine[Math.floor(mine.length / 2)];
        await page.locator(`[data-tint="${swatch}"]`).tap();
        await page.waitForTimeout(1400);
        await shot(`booth-tint-${swatch.replace(/[^a-z0-9]+/gi, '-')}`);
      }
      if (slots.length) {
        await page.locator(`[data-tint="${slots[0]}:-1"]`).tap();
        await page.waitForTimeout(1400);
        await shot('booth-tint-as-made');
      }

      /* ---- the stature slider, dragged: does the model follow or jump? ---- */
      const sliders = page.locator('input[type="range"]');
      if (await sliders.count()) {
        await sliders.first().scrollIntoViewIfNeeded();
        const sb = await sliders.first().boundingBox();
        if (sb) {
          await dragCapture(
            { x: sb.x + sb.width * 0.15, y: sb.y + sb.height / 2 },
            { x: sb.x + sb.width * 0.95, y: sb.y + sb.height / 2 },
            6,
            'booth-stature'
          );
        }
      }

      /* ---- surprise me, three times ---- */
      for (let i = 1; i <= 3; i++) {
        await page.locator('button:has-text("Surprise me")').tap();
        await page.waitForTimeout(900);
        await shot(`booth-surprise-${i}`);
      }

      /* ---- the confirmation, opened and dismissed ---- */
      const bind = page.locator('button:has-text("This is my duelist")').first();
      if (await bind.isVisible().catch(() => false)) {
        await bind.tap();
        await page.waitForTimeout(600);
        await shot('booth-confirm');
        const cancel = page.locator('button:has-text("Keep editing")').first();
        if (await cancel.isVisible().catch(() => false)) {
          await cancel.tap();
          await page.waitForTimeout(500);
          await shot('booth-confirm-dismissed');
        }
        /* Then go through for real, because the world is the other half of
           what this is for — and only ever against a local store.
           Binding is permanent: the appearance a duelist is bound with cannot
           be changed afterwards, by anything. Pointed at a deployment this
           script would spend the real account's one chance on whatever the
           booth happened to be showing. There is no flag for that, because a
           flag is a thing you can forget. */
        if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
          console.log(`  (stopping at the booth — ${BASE} is not local, and binding cannot be undone)`);
          await ctx.close();
          continue;
        }
        await bind.tap();
        await page.waitForTimeout(600);
        await page.locator('button:has-text("Bind")').last().tap();
        await page.waitForTimeout(2500);
        await shot('deck-open');
        const cards = page.locator('main button[aria-pressed]');
        for (let i = 0; i < 25; i++) {
          await cards.nth(i).scrollIntoViewIfNeeded();
          await cards.nth(i).tap();
        }
        await page.waitForTimeout(300);
        await shot('deck-chosen');
        await page.locator('button:has-text("This is my deck")').first().tap();
        await page.waitForTimeout(400);
        await page.locator('button:has-text("Sleeve it")').first().tap();
        await page.waitForTimeout(3500);
      }
      console.log('  booth captured');
    }

    /* ---------------- into the world ---------------- */

    await page
      .locator('[aria-label="Move"]')
      .waitFor({ state: 'visible', timeout: 20000 })
      .catch(() => {});
    const world = await page.locator('[aria-label="Move"]').isVisible().catch(() => false);
    if (!world) {
      console.log('  (not in the world — the account has not bound a duelist)');
      await ctx.close();
      continue;
    }

    await page.waitForTimeout(1200);
    await shot('world-open');

    /* ---- the stick, pushed to each quarter ---- */
    const sb = await boxOf(page.locator('[aria-label="Move"]'), 'thumb stick');
    if (!sb) {
      await ctx.close();
      continue;
    }
    const c = { x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 };
    const R = 44;
    const dirs = [
      ['up', 0, -1],
      ['upright', 0.7, -0.7],
      ['right', 1, 0],
      ['down', 0, 1],
      ['left', -1, 0],
    ];
    for (const [name, dx, dy] of dirs) {
      await touch('touchStart', [c]);
      await touch('touchMove', [{ x: c.x + dx * R, y: c.y + dy * R }]);
      for (let i = 1; i <= 4; i++) {
        await page.waitForTimeout(230);
        await shot(`world-stick-${name}-${i}`);
      }
      await touch('touchEnd', []);
      await page.waitForTimeout(400);
    }

    /* ---- drag to look, away from the stick ---- */
    const vp = page.viewportSize();
    const look = { x: vp.width * 0.6, y: vp.height * 0.35 };
    await dragCapture(look, { x: look.x - 150, y: look.y }, 5, 'world-look');
    await page.waitForTimeout(400);
    await shot('world-look-settled');

    /* ---- the keyboard, which the desktop player uses ---- */
    await page.keyboard.down('w');
    for (let i = 1; i <= 4; i++) {
      await page.waitForTimeout(240);
      await shot(`world-key-w-${i}`);
    }
    await page.keyboard.up('w');
    await page.waitForTimeout(500);
    await shot('world-key-released');

    /* ---- the corner menu ---- */
    await page.locator('[aria-label="Menu"]').tap();
    await page.waitForTimeout(500);
    await shot('world-menu-open');

    /* ---- the delete sheet, opened and backed out of ----
       Photographed for its weight — this is the heaviest door in the mode and
       it should look like one. Backed out of, never confirmed: handling only
       binds against a local store (see the guard in the booth), but the frames
       should show the door holding, not the save going. */
    const del = page.locator('button:has-text("Delete Character")').first();
    let declined = false;
    if (await del.isVisible().catch(() => false)) {
      await del.tap();
      await page.waitForTimeout(500);
      await shot('world-delete-asked');
      await page.locator('button:has-text("Keep playing")').first().tap();
      await page.waitForTimeout(500);
      await shot('world-delete-declined');
      declined = true;
    } else {
      console.log('  ! no Delete Character in the menu');
      faults++;
    }

    /* Opening the sheet closed the menu, so the ✕ needs the menu back first
       before it has anything to prove — but only down that path. On the fault
       path the menu never closed, and a blind reopen here would photograph an
       open menu under the name "closed". */
    if (declined) {
      await page.locator('[aria-label="Menu"]').tap();
      await page.waitForTimeout(400);
    }
    await page.locator('[aria-label="Menu"]').tap();
    await page.waitForTimeout(500);
    await shot('world-menu-closed');

    console.log('  world captured');
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(`\nhandling: frames in ${OUT}${faults ? ` — ${faults} fault(s), see above` : ''}`);
if (faults) process.exit(1);
