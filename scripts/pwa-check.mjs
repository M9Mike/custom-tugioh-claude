/**
 * Proves the standalone detection and safe-area plumbing without a real iPhone.
 *
 * The chrome has run under the notch twice now. The first fix keyed the insets
 * off `@media (display-mode: standalone)`, which an iOS home-screen app does not
 * reliably match, so it silently did nothing — and nothing here could catch it,
 * because a desktop WebKit build reports every inset as 0 and is never
 * standalone. So this fakes the one signal iOS really does expose,
 * `navigator.standalone`, and checks the floor lands only then.
 *
 * It then forces a notch-sized inset and plays far enough into a duel to open
 * the attack prompt, because the second bug here was subtler than a missing
 * value: every overlay is absolutely positioned inside `.duel-root`, which is
 * both the positioning context *and* the element carrying the safe-area
 * padding. An absolutely positioned child resolves against the padding box, so
 * `top: 0` is the physical top of the screen — and the Direct Attack prompt sat
 * under the Dynamic Island even with the inset reported correctly.
 *
 * The top inset itself is now iOS's job: the status bar is `black` rather than
 * `black-translucent`, so the web view starts below the clock. `/diag` reads
 * the real numbers off the device if that ever needs confirming.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=... node scripts/pwa-check.mjs [baseUrl]
 */
import { webkit } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3100';

/**
 * `page.goto` with production's patience.
 *
 * Every assertion in this file had already passed and the run still exited
 * non-zero, on a 30-second navigation timeout against Vercel — the probe ran
 * out of patience after proving the thing it exists to prove. Paris latency
 * plus a cold serverless start is genuinely slower than the Playwright
 * default, so the wait is longer and a single retry absorbs one bad hop.
 * Widened, not loosened: a page that truly never loads still throws.
 */
async function goHome(page) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return;
    } catch (err) {
      if (attempt >= 1) throw err;
      await page.waitForTimeout(2000);
    }
  }
}

const read = (page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;padding-top:var(--safe-top);padding-bottom:var(--safe-bottom)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const out = {
      dataStandalone: document.documentElement.dataset.standalone ?? '(unset)',
      safeTopVar: root.getPropertyValue('--safe-top').trim(),
      safeBottomVar: root.getPropertyValue('--safe-bottom').trim(),
      resolvedTop: cs.paddingTop,
      resolvedBottom: cs.paddingBottom,
    };
    probe.remove();
    const main = document.querySelector('main.safe-page');
    if (main) {
      const m = getComputedStyle(main);
      out.mainPadTop = m.paddingTop;
      out.mainPadBottom = m.paddingBottom;
    }
    return out;
  });

const main = async () => {
  const browser = await webkit.launch();
  let bad = 0;

  for (const standalone of [false, true]) {
    const ctx = await browser.newContext({
      viewport: { width: 414, height: 896 },
      isMobile: true,
      hasTouch: true,
    });
    if (standalone) {
      // What an iOS home-screen app exposes and a browser tab does not.
      await ctx.addInitScript(() => {
        Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
      });
    }
    const page = await ctx.newPage();
    await goHome(page);
    await page.waitForTimeout(700);
    const r = await read(page);
    console.log(`\nnavigator.standalone = ${standalone}`);
    for (const [k, v] of Object.entries(r)) console.log(`  ${k}: ${v}`);

    const want = standalone ? '1' : '(unset)';
    if (r.dataStandalone !== want) {
      console.log(`  ❌ data-standalone should be ${want}`);
      bad += 1;
    }
    // WebKit off-device reports every inset as 0, so the floor is the only
    // thing that can move the bottom. That is exactly what is being checked.
    const bottom = parseFloat(r.mainPadBottom ?? r.resolvedBottom);
    if (standalone && bottom < 16) {
      console.log(`  ❌ standalone bottom inset is ${bottom}px, expected the 16px floor`);
      bad += 1;
    }
    if (!standalone && bottom !== 0) {
      console.log(`  ❌ a browser tab should get no floor, got ${bottom}px`);
      bad += 1;
    }
    await ctx.close();
  }

  /* Now the overlays, with a notch forced in.

     Two human seats rather than the computer: the attack prompt only exists
     during targeting, and reaching it has to be deterministic. Against the AI
     this run reached an attack sometimes and reported "unchecked" the rest of
     the time, which reads as a pass and is exactly the blind spot that let this
     bug through in the first place. Not reaching it is now a failure. */
  const NOTCH = 59; // an iPhone 17 Pro Max Dynamic Island, the worst case
  const HOME = 34;  // and its home indicator

  const phone = async () => {
    const ctx = await browser.newContext({
      viewport: { width: 414, height: 896 },
      isMobile: true,
      hasTouch: true,
    });
    await ctx.addInitScript((px) => {
      const css = `:root{--safe-top:${px.top}px!important;--safe-bottom:${px.bottom}px!important}`;
      const apply = () => {
        const el = document.createElement('style');
        el.textContent = css;
        document.head.appendChild(el);
      };
      if (document.head) apply();
      else document.addEventListener('DOMContentLoaded', apply);
    }, { top: NOTCH, bottom: HOME });
    return { ctx, page: await ctx.newPage() };
  };

  const a = await phone();
  const b = await phone();

  await goHome(a.page);
  await a.page.waitForTimeout(900);
  await a.page.tap('text=Start a new duel');
  await a.page.waitForURL(/\/duel\//, { timeout: 25000 });
  await a.page.waitForTimeout(1400);
  const code = a.page.url().split('/').pop();

  await goHome(b.page);
  await b.page.waitForTimeout(900);
  await b.page.fill('input[placeholder="CODE"]', code);
  await b.page.tap('button:has-text("Join")');
  await b.page.waitForURL(/\/duel\//, { timeout: 25000 });
  await b.page.waitForTimeout(1400);

  await a.page.tap('button:has-text("Seto Kaiba")');
  await a.page.waitForTimeout(500);
  await a.page.tap('button:has-text("Duel as Seto")');
  await a.page.waitForTimeout(700);
  await b.page.tap('button:has-text("Mai Valentine")');
  await b.page.waitForTimeout(500);
  await b.page.tap('button:has-text("Duel as Mai")');
  await a.page.waitForSelector('[data-testid="hand-card"]', { timeout: 25000 });
  await a.page.waitForTimeout(1800);

  console.log(`\noverlays, with a ${NOTCH}px notch and a ${HOME}px home indicator forced in`);

  const dismiss = async (page) => {
    const scrim = page.locator('[data-testid="inspector-scrim"]');
    if (await scrim.count()) { await scrim.tap({ position: { x: 5, y: 5 } }); await page.waitForTimeout(200); }
  };

  /** Nothing interactive may start above the notch. */
  const clearsTop = async (label, locator) => {
    const box = await locator.boundingBox();
    if (!box) { console.log(`  ❌ ${label}: not on screen`); bad += 1; return; }
    const ok = box.y >= NOTCH - 1;
    console.log(`  ${ok ? '✅' : '❌'} ${label}: starts at ${Math.round(box.y)}px, notch ends at ${NOTCH}`);
    if (!ok) bad += 1;
  };
  /** Nor may anything sit on the home indicator. */
  const clearsBottom = async (label, locator) => {
    const box = await locator.boundingBox();
    if (!box) { console.log(`  ❌ ${label}: not on screen`); bad += 1; return; }
    const gap = 896 - (box.y + box.height);
    const ok = gap >= HOME - 5;
    console.log(`  ${ok ? '✅' : '❌'} ${label}: ${Math.round(gap)}px above the edge, indicator is ${HOME}`);
    if (!ok) bad += 1;
  };

  /* The hand action sheet is pinned to the bottom on a phone.
   *
   * Scoped to the sheet by name, and that is the whole of a flake this file
   * chased for weeks. It used to read `button:has-text("Cancel")).last()` —
   * and there are *three* Cancels in the duel: the sheet's, the targeting
   * banner's, and the target picker's. The sheet's is the FIRST in DOM order,
   * so `.last()` could never pick it once any other was on screen. Worse, the
   * picker's Cancel sits underneath a `max-h-[70vh] overflow-y-auto` card
   * grid, so with a long list it is thousands of pixels down its own scroll
   * container — which is where the reported "-2587px above the edge" came
   * from. Whether it happened at all turned on which card the shuffle put
   * first in hand, which is why it read as one run in eight and never
   * reproduced locally. Latency had nothing to do with it.
   *
   * "Never trust the first match" is already written down here. It is just as
   * true of the last one. */
  await dismiss(a.page);
  await a.page.locator('[data-testid="hand-card"]').first().tap();
  await a.page.waitForTimeout(500);
  const sheet = a.page.locator('[data-testid="hand-sheet"]');
  const sheetCancel = sheet.locator('button:has-text("Cancel")');
  const cancels = await sheetCancel.count();
  if (cancels === 1) {
    await clearsBottom('hand action sheet', sheetCancel);
    await sheetCancel.tap();
    await a.page.waitForTimeout(300);
  } else if (cancels === 0) {
    console.log('  ❌ hand action sheet never opened'); bad += 1;
  } else {
    // Exactly one, or the measurement is ambiguous again — say which, rather
    // than picking one and reporting a number nobody can trace.
    console.log(`  ❌ hand action sheet has ${cancels} Cancel buttons — which one is the edge?`); bad += 1;
  }

  /* Then play until someone can attack. Both seats are driven, so this does not
     depend on either deck opening well. */

  /* The board now locks every control while it narrates — the fix this run
     exists to guard — so the driver has to wait for quiet the way a player
     does, or its taps land on a board that is still talking and open the card
     inspector instead of the action sheet. End Turn is the tell: rendered only
     on your turn, disabled exactly while the narration holds the board. */
  const quiet = async (who) => {
    const et = who.page.locator('button:has-text("End Turn")').first();
    try {
      await et.waitFor({ timeout: 12000 });
    } catch {
      return false;
    }
    for (let i = 0; i < 40; i += 1) {
      if (await et.isEnabled().catch(() => false)) return true;
      await who.page.waitForTimeout(300);
    }
    return false;
  };

  const summonAndPass = async (who) => {
    await dismiss(who.page);
    const hand = who.page.locator('[data-testid="hand-card"]');
    for (let h = 0; h < (await hand.count()); h += 1) {
      await hand.nth(h).tap();
      await who.page.waitForTimeout(260);
      const summon = who.page.locator('button:has-text("Normal Summon")');
      if ((await summon.count()) && (await summon.first().isEnabled())) {
        await summon.first().tap();
        await who.page.waitForTimeout(700);
        const pick = who.page.locator('[data-testid="foe-monster-zone"] .targetable');
        if (await pick.count()) { await pick.first().tap(); await who.page.waitForTimeout(600); }
        return true;
      }
      const cancel = who.page.locator('button:has-text("Cancel")').last();
      if (await cancel.count()) await cancel.tap();
      await who.page.waitForTimeout(120);
    }
    return false;
  };

  let promptChecked = false;
  for (let turn = 0; turn < 10 && !promptChecked; turn += 1) {
    for (const who of [a, b]) {
      if (promptChecked) break;
      /* Wait for the turn rather than testing for it: the clients poll about
         once a second, and a bare check spun through every iteration in
         milliseconds without either seat ever holding the turn. */
      try {
        await who.page.locator('button:has-text("End Turn")').first().waitFor({ timeout: 12000 });
      } catch {
        continue;
      }

      await quiet(who);
      await summonAndPass(who);
      await dismiss(who.page);
      /* The summon's own beat is still being spoken; Battle stays disabled
         until it lands. */
      await quiet(who);

      const battle = who.page.locator('button:has-text("Battle")');
      if ((await battle.count()) && (await battle.first().isEnabled())) {
        await battle.first().tap();
        await who.page.waitForTimeout(500);
        /* "…enters the Battle Phase" is itself a spoken beat. */
        await quiet(who);
        const mine = who.page.locator('[data-testid="my-monster-zone"] .selectable');
        if (await mine.count()) {
          await mine.first().tap();
          await who.page.waitForTimeout(400);
          const atk = who.page.locator('button:has-text("Attack with")');
          if (await atk.count()) { await atk.first().tap(); await who.page.waitForTimeout(400); }
          const prompt = who.page.locator('[data-testid="target-prompt"] > *');
          if (await prompt.count()) {
            await clearsTop('attack / targeting prompt', prompt.first());
            promptChecked = true;
            break;
          }
        }
      }

      await dismiss(who.page);
      const et = who.page.locator('button:has-text("End Turn")');
      if (await et.count()) { await et.first().tap(); await who.page.waitForTimeout(900); }
      for (const p2 of [a, b]) {
        const nothing = p2.page.locator('button:has-text("Do nothing")');
        if (await nothing.count()) { await nothing.first().tap(); await p2.page.waitForTimeout(400); }
      }
    }
  }

  /* Landscape. The board is a fixed, non-scrolling surface sized against the
     height; sideways a phone has ~414px of it and the field ends up under the
     hand. The notice replaces it rather than showing something unplayable. */
  const land = await browser.newContext({ viewport: { width: 896, height: 414 }, isMobile: true, hasTouch: true });
  const lp = await land.newPage();
  await goHome(lp);
  await lp.waitForTimeout(900);
  await lp.tap('button:has-text("Duel the computer")');
  await lp.waitForURL(/\/duel\//, { timeout: 25000 });
  await lp.waitForTimeout(1200);
  await lp.tap('button:has-text("Seto Kaiba")');
  await lp.waitForTimeout(500);
  await lp.tap('button:has-text("Duel as Seto")');
  await lp.waitForTimeout(2000);
  const notice = await lp.locator('.rotate-notice').isVisible();
  const boardShown = await lp.locator('[data-testid="hand-strip"]').isVisible().catch(() => false);
  console.log(`\nlandscape 896x414`);
  console.log(`  ${notice ? '✅' : '❌'} the turn-upright notice is shown`);
  console.log(`  ${boardShown ? '❌' : '✅'} the unplayable board is not`);
  if (!notice || boardShown) bad += 1;
  await land.close();

  if (!promptChecked) {
    console.log('  ❌ never opened the attack prompt — it went unchecked, which is not a pass');
    bad += 1;
  }

  await a.ctx.close();
  await b.ctx.close();
  await browser.close();
  console.log(bad ? `\n${bad} problem(s)` : '\nStandalone detection, insets and overlays behave. ✅');
  if (bad) process.exitCode = 1;
};

main().catch((e) => { console.error(e); process.exit(1); });
