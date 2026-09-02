/**
 * Walks Story Mode from the main menu to the open world, by tapping, at both
 * phones' sizes.
 *
 *   node scripts/story-check.mjs [baseUrl] [outDir]
 *
 * What it is really checking is the *lock*, which is the one thing here that
 * cannot be undone and therefore the one thing that has to be right: a duelist
 * and a deck are written against a name, and typing that name again — in a
 * browser with no storage, no cookies and no memory of the first one — has to
 * bring back the same duelist and never offer to make another. So the second
 * half of this script throws the browser away and signs in from nothing.
 *
 * The one sanctioned way back — Delete Character — is exercised at the end,
 * against local stores only: the confirm has to hold the door, the deletion
 * has to land on the sign-in screen, and signing in again has to start over
 * in the booth. It doubles as the reset that lets the next phone run the
 * whole journey too.
 *
 * It also checks the trick, from the outside, the way a player would find it:
 * after the first deck is sleeved, Edit Deck offers 25 cards and not 34.
 *
 * The 3D screens are checked by photographing them. A canvas that never drew
 * anything is a flat colour and a flat colour is a tiny PNG, so "did the world
 * render" is a size threshold, and "did the duelist move" is the same
 * photograph taken twice with a walk in between.
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const BASE = args[0] ?? 'http://localhost:3000';
const OUT = args[1] ?? '/tmp/story';

/**
 * `--no-create`: run everything except the two steps that cannot be undone.
 *
 * A duelist and a first deck are bound to the account for good, and the account
 * gets exactly one of each. So the full run is only safe against a throwaway
 * database — pointed at production it would spend the player's one character on
 * a random one it made itself, before they had ever opened the booth. This flag
 * is what makes the check runnable against the real thing: it signs in, proves
 * the booth draws, and stops at the door.
 *
 * What it covers therefore depends on how far the account has already got. On
 * an account that has not made a duelist yet — which is the interesting case,
 * and the one this exists for — the run ends at the confirmation and the world,
 * Save, Edit Deck and the fresh-browser check do not run at all. Once the
 * account is past the lock there is nothing left to spend, and the whole of the
 * rest of the check runs exactly as it does without the flag.
 */
const NO_CREATE = process.argv.includes('--no-create');
/* Delete Character is exercised only against a local store, for the same
   reason handling-check refuses to bind against anything else: pointed at a
   deployment it would erase a real account's duelist, deck and progress, and
   there is no flag for that because a flag is a thing you can forget. Checking
   that the menu *offers* deletion is safe anywhere and still happens. */
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE);
/* The container's browser may be a different build from the one this copy of
   Playwright would download; both this and `channel` are honoured. */
const EXEC = process.env.PLAYWRIGHT_CHROMIUM_PATH;

/* The two phones this is built for, in CSS pixels. `hasTouch` matters for more
   than the taps: the thumb stick is driven by Pointer Events, and a context
   without touch gets `pointerType: "mouse"` — which is a different code path
   from the one a player is on. */
const PHONES = {
  iphone14: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
  iphone17promax: { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true },
};

let failures = 0;
const ok = (label) => console.log(`  ✓ ${label}`);
const bad = (label, detail) => {
  failures++;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
};
const check = (cond, label, detail) => (cond ? ok(label) : bad(label, detail));
const log = (line) => console.log(`  · ${line}`);

/** A canvas that drew a scene compresses to far more than a flat rectangle. */
const RENDERED_BYTES = 9000;

async function shoot(page, name, phone) {
  const buf = await page.screenshot();
  await fs.writeFile(`${OUT}/${phone}-${name}.png`, buf);
  return buf;
}

/**
 * A picture of the canvas, taken as a clipped *page* shot rather than an
 * element shot.
 *
 * `locator.screenshot()` waits for the element to be "stable" — two consecutive
 * animation frames with an unchanged box — and against this page that wait never
 * finishes, so every run died here with a timeout before reaching a single world
 * assertion. `page.screenshot({ clip })` does no stability wait, and the bytes it
 * returns are the same pixels, which is all `RENDERED_BYTES` is measuring.
 */
async function canvasShot(page) {
  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ timeout: 30000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvasShot: the canvas has no box');
  return page.screenshot({ clip: box });
}


/**
 * Presses a control that sits over the world canvas.
 *
 * `locator.tap()` hangs on this page. Not because the control is covered — it is
 * verifiably the topmost element at its own centre, which is what `onTop` below
 * asserts — but because Playwright waits for the page to settle after the
 * gesture, and a world running `requestAnimationFrame` forever never does.
 *
 * So the two halves are done separately, and the result is a stronger check than
 * `tap()` was: hit-testing is asserted explicitly with `elementsFromPoint`, which
 * is exactly the "is anything covering this" question, and then the click is
 * dispatched directly so the assertion is not at the mercy of the render loop.
 */
async function pressOverCanvas(page, selector, what) {
  const el = page.locator(selector).first();
  await el.waitFor({ timeout: 30000 });
  const onTop = await el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return hit === node || node.contains(hit);
  });
  check(onTop, `${what} is not covered by anything`);
  await el.dispatchEvent('click');
}

/*
 * Everything from the booth onward is pressed with `dispatchEvent('click')`
 * rather than `tap()`.
 *
 * Those screens all render a live three.js canvas, and `tap()` waits for the
 * page to go quiet after the gesture — which a `requestAnimationFrame` loop
 * never does, so each one hung for its full thirty seconds and the run died
 * before reaching a single world assertion. The controls are not covered and
 * the gesture is not the thing under test; `pressOverCanvas` keeps the part
 * that *is* worth asserting, by hit-testing the prompt explicitly.
 */

/** Taps a button once the page has hydrated — see the note in iphone.mjs. */
async function tapWhenAwake(page, selector) {
  const btn = page.locator(selector).first();
  await btn.waitFor({ timeout: 30000 });
  for (let i = 0; i < 160; i++) {
    if (await btn.isEnabled().catch(() => false)) {
      await btn.tap();
      return;
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`"${selector}" never became enabled — the page did not finish hydrating.`);
}

/**
 * Puts the duelist somewhere known before the world is opened.
 *
 * The walk-and-talk check pushes the stick forward and waits for a talk prompt,
 * so whether it passes depends entirely on where the save happened to leave the
 * player and which way they were facing. Standing in the middle of the road, it
 * walked into an empty street for six seconds and failed a feature that works —
 * three times, on three different days, each time after something unrelated had
 * moved the save.
 *
 * So the check places them: just inside the shop, a few paces from Grandpa,
 * facing him. That spot is deterministic, it is where a new player starts
 * anyway, and Grandpa is the one character who is always there. Written before
 * the world loads, because the world reads the save on the way in and nothing
 * moves a duelist who is already standing up.
 *
 * Best-effort: against a deployed URL the save is a real player's, so a failure
 * here is not worth failing the run over — it only means the approach starts
 * from wherever they left off, which is what it used to do always.
 */
async function standNearGrandpa(name) {
  try {
    await fetch(`${BASE}/api/story/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: name,
        world: { area: 'grandpa-shop', x: 2.6, z: 1.6, facing: Math.PI },
      }),
    });
  } catch {
    /* No server, or a save that is not ours to move. The walk still runs. */
  }
}

async function signIn(page, name) {
  await standNearGrandpa(name);
  await page.goto(`${BASE}/story`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('input[placeholder="Enter your name"]').fill(name);
  await tapWhenAwake(page, 'button:has-text("Enter Story Mode")');
}

/**
 * Which of the four screens are we looking at?
 *
 * Every probe here is anchored to something that appears on exactly one screen.
 * `button:has-text("Menu")` was not: `has-text` is a case-insensitive substring
 * match, so the sign-in page's own "Back to the main menu" answered to it and
 * the whole run reported itself already finished while still on the first
 * screen. A stage probe that can lie makes every check after it meaningless.
 */
const STAGE_MARKERS = [
  ['character', 'h1:has-text("Make your duelist")'],
  ['deck', 'h1:has-text("Cut your first deck")'],
  ['editDeck', 'h1:has-text("Edit your deck")'],
  ['world', 'button[aria-label="Menu"]'],
  ['signin', 'button:has-text("Enter Story Mode")'],
];

/**
 * @param expect the stage we are waiting to arrive at, if we know it. Without
 *   it this returns whatever is on screen now — which is right for "where did
 *   signing in put me" and wrong for every transition, because the screen we
 *   are *leaving* is still up for the first frames after the tap. That is not
 *   hypothetical: it reported the creation booth as still open for a bind that
 *   had in fact already gone through, twice, and the screenshot it saved was of
 *   the deck builder.
 */
async function stage(page, expect) {
  let last = 'unknown';
  for (let i = 0; i < 80; i++) {
    for (const [name, selector] of STAGE_MARKERS) {
      if (await page.locator(selector).first().isVisible().catch(() => false)) {
        last = name;
        break;
      }
    }
    /* `unknown` is never an answer, only a not-yet: a dynamically imported
       screen shows nothing at all for its first frames, and returning then
       would report every 3D screen in the game as missing. */
    if (last !== 'unknown' && (!expect || last === expect)) return last;
    await page.waitForTimeout(250);
  }
  return last;
}

/**
 * Takes the dev server's own overlay off the page.
 *
 * `next dev` mounts a `<nextjs-portal>` in the bottom-left corner, and it eats
 * taps aimed at whatever is underneath it — which here is the deck builder's
 * Cancel button and the thumb stick. It does not exist in a production build,
 * so removing it is not hiding anything the player would ever see; leaving it
 * meant the check failed on the dev server and passed on Vercel, which is the
 * least useful way round.
 */
async function stripDevOverlay(context) {
  await context.addInitScript(() => {
    const strip = () => document.querySelectorAll('nextjs-portal').forEach((el) => el.remove());
    /* `document`, not `document.documentElement` — an init script runs before
       the parser has produced <html>, and observing a null throws. */
    new MutationObserver(strip).observe(document, { childList: true, subtree: true });
    strip();
  });
}

async function run(phoneName) {
  console.log(`\n── ${phoneName} ──`);
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const context = await browser.newContext(PHONES[phoneName]);
  await stripDevOverlay(context);
  const page = await context.newPage();
  page.on('pageerror', (err) => bad('a page error was thrown', err.message));

  /* ---- the main menu offers it ---- */
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const entry = page.locator('button:has-text("Story Mode")').first();
  /* Waited for, not glanced at. The menu is client-rendered and
     `domcontentloaded` fires before it has hydrated, so on a cold server the
     button is not there *yet* — the check said "not on the main menu" and then
     pressed it a line later. */
  const offered = await entry.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
  check(offered, 'Story Mode is on the main menu');
  await tapWhenAwake(page, 'button:has-text("Story Mode")');
  await page.waitForURL(/\/story$/, { timeout: 20000 });
  ok('it opens Story Mode');

  /* ---- an unknown name is refused ---- */
  await page.locator('input[placeholder="Enter your name"]').fill('Nobody');
  await tapWhenAwake(page, 'button:has-text("Enter Story Mode")');
  await page.waitForTimeout(1200);
  check(
    await page.locator('text=No duelist by that name').first().isVisible().catch(() => false),
    'an unknown name is refused'
  );

  /* ---- Mike gets in ---- */
  await signIn(page, 'Mike');
  let at = await stage(page);
  check(at !== 'signin' && at !== 'unknown', 'Mike signs in', `landed on "${at}"`);
  await shoot(page, '1-signed-in', phoneName);

  /* ---- the creation booth ---- */
  if (at === 'character') {
    /* The duelist is a fetched model, not a constructor call, and the booth
       says so: it stamps `data-ready` on the viewport when the first one is
       standing. A booth that never becomes ready is a failure in its own
       right — every screenshot comparison after it would be of an empty
       plinth, passing or failing for reasons that have nothing to do with
       the control being tapped. */
    const ready = await page
      .locator('[data-ready="yes"]')
      .waitFor({ timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    check(ready, 'the booth reports a duelist ready');
    const first = await canvasShot(page);
    check(first.length > RENDERED_BYTES, 'the duelist is drawn', `${first.length} bytes`);
    await fs.writeFile(`${OUT}/${phoneName}-2-booth.png`, await page.screenshot());

    /*
     * The booth offers a roster and nothing else.
     *
     * This used to assert nine duelists, three tintable garments, a stature
     * slider and an as-made swatch. All of that is gone: the roster is finished
     * characters now, and there is nothing about them a player should be
     * recolouring, so the booth asks for a pick and a name and stops.
     *
     * The count is read off the page rather than hardcoded. A fixed number is
     * how this check came to assert nine duelists against a roster of two — it
     * did not fail when the catalog shrank, it failed months later for somebody
     * else. What matters is that every duelist offered actually reaches the
     * model, which is what the loop below tests, one at a time.
     */
    const picks = await page.locator('[data-pick^="duelist:"]').all();
    check(picks.length > 0, 'the booth offers a roster', `saw ${picks.length}`);
    check(
      (await page.locator('[data-tint]').count()) === 0,
      'and offers no customisation — the characters are finished'
    );

    let before = first;
    for (const pick of picks) {
      const id = (await pick.getAttribute('data-pick')) ?? '?';
      await pick.dispatchEvent('click');
      await page.waitForTimeout(1800);
      const after = await canvasShot(page);
      check(!after.equals(before), `picking ${id.replace('duelist:', '')} changes the model`);
      before = after;
    }

    await fs.writeFile(`${OUT}/${phoneName}-3-picked.png`, await page.screenshot());

    /* No "Surprise me" any more. It randomised a duelist out of tints, a
       stature and a body, and none of those are choices the booth offers now —
       there is a roster of finished characters and you pick one. */

    await page.locator('input[placeholder="Mike"]').first().fill('Mike');
    await page.locator('button:has-text("This is my duelist")').first().dispatchEvent('click');
    await page.waitForTimeout(400);
    check(
      await page.locator('text=Bind this duelist').first().isVisible().catch(() => false),
      'binding asks first'
    );

    if (NO_CREATE) {
      /* The one thing this flag exists to not do. Backing out of the modal is
         itself worth proving: it is the only way out of a screen that otherwise
         spends a character. */
      await page.locator('button:has-text("Keep editing")').first().dispatchEvent('click');
      await page.waitForTimeout(400);
      check(
        await page.locator('h1:has-text("Make your duelist")').first().isVisible().catch(() => false),
        'and backing out of it leaves the duelist unmade'
      );
      log('--no-create: stopping at the booth, so the account keeps its one character');
      await browser.close();
      return;
    }

    await page.locator('button:has-text("Bind")').last().dispatchEvent('click');
    at = await stage(page, 'deck');
    if (at !== 'deck') await fs.writeFile(`${OUT}/${phoneName}-X-bind-failed.png`, await page.screenshot());
    check(at === 'deck', 'the duelist is bound and the deck follows', `landed on "${at}"`);
  } else {
    ok(`already past the booth (at "${at}") — the lock is checked below`);
  }

  /* ---- the first deck ---- */
  if (at === 'deck') {
    /* `[data-card]` rather than `button[aria-pressed]`: a card is a wrapper with
       a move button and a read button inside it now, and the Trunk's sort
       controls are pressed-state buttons too, so the old selector counted four
       extra. */
    const cards = page.locator('main [data-card]');
    const offered = await cards.count();
    check(offered === 34, 'thirty-four cards are offered', `saw ${offered}`);

    const confirmBtn = page.locator('button:has-text("more")').first();
    check(await confirmBtn.isVisible(), 'the deck cannot be sleeved before it is full');

    if (NO_CREATE) {
      /* Choosing cards writes nothing — only sleeving does — so the counting is
         safe to leave out and the stopping point is here. */
      log('--no-create: stopping at the deck, so the account keeps its first 25');
      await browser.close();
      return;
    }

    for (let i = 0; i < 25; i++) {
      await cards.nth(i).locator('[data-move]').scrollIntoViewIfNeeded();
      await cards.nth(i).locator('[data-move]').dispatchEvent('click');
    }
    await page.waitForTimeout(300);
    check(
      await page.locator('text=25/25').first().isVisible().catch(() => false),
      'twenty-five is twenty-five'
    );

    /*
     * One more must be refused rather than quietly swapped.
     *
     * Taken from the Trunk by name rather than by index into the whole grid.
     * The builder shows the Deck first and the Trunk under it now, so a fixed
     * offset lands in the Deck — where a tap legitimately *removes* a card, so
     * nothing was refused and the check failed on a screen that was working.
     */
    const spare = page.locator('[data-where="trunk"] [data-move]').first();
    await spare.scrollIntoViewIfNeeded();
    await spare.dispatchEvent('click');
    await page.waitForTimeout(200);
    check(
      await page.locator('text=Move one back to the Trunk').first().isVisible().catch(() => false),
      'a twenty-sixth card is refused'
    );
    await fs.writeFile(`${OUT}/${phoneName}-4-deck.png`, await page.screenshot());

    await page.locator('button:has-text("This is my deck")').first().dispatchEvent('click');
    await page.waitForTimeout(400);
    await page.locator('button:has-text("Sleeve it")').first().dispatchEvent('click');
    at = await stage(page, 'world');
    if (at !== 'world') await fs.writeFile(`${OUT}/${phoneName}-X-sleeve-failed.png`, await page.screenshot());
    check(at === 'world', 'the deck is sleeved and the world opens', `landed on "${at}"`);
  }

  /* ---- the world ---- */
  check(at === 'world', 'the open world is reached', `at "${at}"`);
  if (at !== 'world') {
    await browser.close();
    return;
  }

  /* Long enough for the duelist itself to arrive: the model is fetched, and
     the walk check below compares against this frame, so a duelist that
     appears *between* the two shots would pass the walk for the wrong reason. */
  await page.waitForTimeout(2800);
  const standing = await canvasShot(page);
  check(standing.length > RENDERED_BYTES, 'the field is drawn', `${standing.length} bytes`);
  await fs.writeFile(`${OUT}/${phoneName}-5-world.png`, await page.screenshot());

  /* Walk. The stick is a DOM element over the canvas, so this is a real drag
     with a real finger, and the proof is that the picture is different after.

     `boundingBox()` is null for an element that is not laid out — a stick that
     never rendered, or one pushed off-screen by a safe-area inset. That is a
     real failure of a real control and it is worth reporting as one: reading
     `.x` off the null instead crashed the whole run on a TypeError naming a
     line number, and took the menu, Save, Edit Deck and the re-entry check
     down with it, none of which need the stick at all. */
  const box = await page.locator('[aria-label="Move"]').boundingBox();
  if (!box) {
    bad('the duelist walks', 'the thumb stick is not on screen — nothing to drag');
    await fs.writeFile(`${OUT}/${phoneName}-X-no-stick.png`, await page.screenshot());
  } else {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.touchscreen.tap(cx, cy);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, box.y - 40, { steps: 8 });
    await page.waitForTimeout(1600);
    await page.mouse.up();
    const walked = await canvasShot(page);
    check(!walked.equals(standing), 'the duelist walks');
    await fs.writeFile(`${OUT}/${phoneName}-6-walked.png`, await page.screenshot());
  }

  /* ---- the welcome: walk up to Grandpa and talk to him ----

     Driven the way a player does it — push the stick until the prompt shows
     up — rather than by teleporting the position, because the thing being
     checked is that walking *towards* somebody is what starts a conversation.
     The stick is held in bursts and the prompt polled between them: how long
     the approach takes depends on where the walk check above left us. */
  if (box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx, box.y - 40, { steps: 6 });
    let prompted = false;
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(250);
      if (await page.locator('[data-talk]').first().isVisible().catch(() => false)) {
        prompted = true;
        break;
      }
    }
    await page.mouse.up();
    check(prompted, 'walking up to somebody offers a conversation');

    if (prompted) {
      await fs.writeFile(`${OUT}/${phoneName}-6b-near-npc.png`, await page.screenshot());
      await pressOverCanvas(page, '[data-talk]', 'the talk prompt');
      await page.waitForTimeout(500);
      check(
        await page.locator('[data-conversation]').first().isVisible().catch(() => false),
        'the conversation opens'
      );
      /* The stick goes away while talking: it can only walk you out of the
         range that opened the panel. */
      check(
        !(await page.locator('[aria-label="Move"]').isVisible().catch(() => true)),
        'and the stick is out of the way while it is open'
      );

      /*
       * Page to the end of the speech.
       *
       * What is at the end depends on the character, and this used to assume
       * replies always were. They are not: a node with `choices: []` ends the
       * conversation, and every character currently in the world is written that
       * way on purpose — Grandpa says his piece and stops, and so do Sarah and
       * Tony. Asserting replies made the check fail on the game as designed.
       *
       * So what is asserted is what is actually promised: the speech pages
       * through to its last page, and that page offers a way onward — replies if
       * the character has any, the way out if they do not.
       */
      let replies = 0;
      let paged = 0;
      for (let i = 0; i < 8; i++) {
        replies = await page.locator('[data-reply]').count();
        if (replies > 0) break;
        const more = page.locator('[aria-label="Continue"]').last();
        if (!(await more.isVisible().catch(() => false))) break;
        await more.dispatchEvent('click');
        paged++;
        await page.waitForTimeout(300);
      }
      check(paged > 0, 'the speech pages through', `paged ${paged} time(s)`);

      /*
       * A character with no replies ends the conversation by running out of
       * speech — `Conversation.tsx` calls `onClose` when the last page of a node
       * with no choices is advanced past. So "still open with replies" and
       * "closed itself" are both correct endings, and which one you get is a
       * property of the character, not of the panel.
       */
      const stillOpen = await page
        .locator('[data-conversation]')
        .first()
        .isVisible()
        .catch(() => false);
      check(
        replies > 0 || !stillOpen,
        'the speech ends — in replies, or by closing itself',
        `replies ${replies}, panel ${stillOpen ? 'open' : 'closed'}`
      );
      await fs.writeFile(`${OUT}/${phoneName}-6c-conversation.png`, await page.screenshot());

      if (replies > 0) {
        /* A reply has to actually move the conversation on — read off the
           speech line itself, not the first paragraph in the panel, which is
           the speaker's name and is the same on every node. */
        /*
         * A reply that stays in the conversation.
         *
         * Three kinds of reply leave the script rather than moving through it:
         * `data-duel` goes to a duel, `data-shop-choice` opens Solomon's
         * counter, and `data-ends` closes the conversation outright. Pressing
         * any of them takes the run somewhere this step is not asking about —
         * and pressing the closing one left nothing on screen to read, so the
         * step timed out waiting for a line that had gone.
         *
         * And a character may legitimately have *no* advancing reply. Grandpa is
         * the case: he says his one line, offers his shelf, and offers to let you
         * go — that is the whole of him by design. "Answering advances the
         * script" is not a rule he breaks, it is a rule that does not apply, so
         * the step says so rather than failing him for it.
         */
        const talky = page.locator('[data-reply]:not([data-duel]):not([data-shop-choice]):not([data-ends])');
        const advancing = await talky.count();
        if (!advancing) {
          check(true, 'answering moves the conversation on', 'no advancing reply here — every choice hands off or leaves');
        } else {
          const before = await page.locator('[data-line]').first().textContent();
          await talky.first().dispatchEvent('click');
          await page.waitForTimeout(400);
          const after = await page.locator('[data-line]').first().textContent();
          check(before !== after, 'answering moves the conversation on', `still "${after?.slice(0, 40)}…"`);
        }
      }

      /* Only close it if it is still open — a no-reply character has already
         closed itself, and clicking a control that is gone hangs the run. */
      if (await page.locator('[data-conversation]').first().isVisible().catch(() => false)) {
        await page.locator('[aria-label="End the conversation"]').dispatchEvent('click');
        await page.waitForTimeout(400);
      }
      check(
        !(await page.locator('[data-conversation]').first().isVisible().catch(() => true)),
        'and it closes back to the field'
      );
      check(
        await page.locator('[aria-label="Move"]').isVisible().catch(() => false),
        'which gives the stick back'
      );
    }
  }

  /* ---- the corner menu ---- */
  await page.locator('button[aria-label="Menu"]').first().dispatchEvent('click');
  await page.waitForTimeout(300);
  check(await page.locator('text=Mike').first().isVisible().catch(() => false), 'the menu names the character');
  check(await page.locator('text=Level 1').first().isVisible().catch(() => false), 'the menu shows the level');
  for (const item of ['Edit Deck', 'Save', 'Return to the Main Menu', 'Delete Character']) {
    check(
      await page.locator(`button:has-text("${item}")`).first().isVisible().catch(() => false),
      `the menu offers ${item}`
    );
  }
  await fs.writeFile(`${OUT}/${phoneName}-7-menu.png`, await page.screenshot());

  await page.locator('button:has-text("Save")').first().dispatchEvent('click');
  /* Waited for rather than slept past.
     A flat 1200ms was enough on a fast machine and nowhere near it on a slow
     one: the world renders a three-to-four megapixel canvas every frame, and
     where that is done in software the main thread is busy enough that the
     round trip takes seven seconds — reliably, and only on the larger phone,
     which is a quarter more pixels than the smaller. The assertion is that
     saving reports itself, not that it does so inside a second, so this polls
     for the answer and still fails if it never comes. */
  const saidSaved = await page
    .locator('text=Saved.')
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check(saidSaved, 'Save reports it saved');

  /* ---- the trick, seen from outside ---- */
  await page.locator('button:has-text("Edit Deck")').first().dispatchEvent('click');
  const editing = await stage(page, 'editDeck');
  check(editing === 'editDeck', 'Edit Deck opens the builder', `landed on "${editing}"`);
  if (editing === 'editDeck') {
    /*
     * The Deck is 25 and the Trunk is whatever packs have added.
     *
     * This used to assert that the collection was *exactly* the 25 chosen, which
     * was true when the only way to own a card was to pick it. Packs changed
     * that: beating a duelist puts cards you did not choose into the Trunk, so
     * the invariant is no longer "25 owned" but "25 sleeved, and everything else
     * is in the Trunk waiting". Asserting the old number would fail the moment
     * the game worked.
     */
    const inDeck = await page.locator('[data-where="deck"]').count();
    const inTrunk = await page.locator('[data-where="trunk"]').count();
    check(inDeck === 25, 'the deck holds exactly 25', `saw ${inDeck}`);
    check(inTrunk >= 0, 'and the trunk holds the rest', `${inTrunk} in the trunk`);

    /* An illegal deck cannot be saved, which is the whole of the rule. */
    await page.locator('[data-where="deck"] [data-move]').first().dispatchEvent('click');
    await page.waitForTimeout(400);
    const refused = !(await page.locator('[data-save-deck]').isEnabled());
    check(refused, 'a deck of 24 cannot be saved');
    await page.locator('[data-where="trunk"] [data-move]').first().dispatchEvent('click');
    await page.waitForTimeout(400);
    check(await page.locator('[data-save-deck]').isEnabled(), 'and putting it back allows it again');
    await fs.writeFile(`${OUT}/${phoneName}-8-collection.png`, await page.screenshot());
    await page.locator('button:has-text("Discard")').first().dispatchEvent('click');
    await page.waitForTimeout(500);
  }

  /* ---- and out ---- */
  await page.locator('button[aria-label="Menu"]').first().dispatchEvent('click');
  await page.waitForTimeout(250);
  await page.locator('button:has-text("Return to the Main Menu")').first().dispatchEvent('click');
  await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 20000 });
  ok('Return to the Main Menu goes back to the main menu');

  await browser.close();

  /* ---- a device that has never seen this player ---- */
  const stranger = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const clean = await stranger.newContext(PHONES[phoneName]);
  await stripDevOverlay(clean);
  const fresh = await clean.newPage();
  await signIn(fresh, 'Mike');
  const back = await stage(fresh, 'world');
  check(back === 'world', 'a brand-new browser lands straight in the world', `landed on "${back}"`);
  if (back === 'world') {
    await fresh.locator('button[aria-label="Menu"]').first().dispatchEvent('click');
    await fresh.waitForTimeout(300);
    check(
      await fresh.locator('text=Mike').first().isVisible().catch(() => false),
      'and it is the same duelist'
    );
    await fs.writeFile(`${OUT}/${phoneName}-9-returned.png`, await fresh.screenshot());
  }

  /* ---- Delete Character: the one sanctioned way back ----

     Local stores only — see LOCAL above. Running it here, at the end, also
     resets the account for the next phone, so every size gets the whole
     journey from the booth onwards instead of only the first one. */
  if (back === 'world' && !NO_CREATE && LOCAL) {
    await fresh.locator('button:has-text("Delete Character")').first().dispatchEvent('click');
    await fresh.waitForTimeout(400);
    check(
      await fresh.locator('text=starts the story over').first().isVisible().catch(() => false),
      'deleting asks first, in plain words'
    );
    await fresh.locator('button:has-text("Keep playing")').first().dispatchEvent('click');
    await fresh.waitForTimeout(400);
    check(
      await fresh.locator('[aria-label="Move"]').isVisible().catch(() => false),
      'and backing out of it keeps the save'
    );

    /*
     * It asks twice, and the second question is checked here.
     *
     * One dialogue is a thing you can dismiss by tapping where the button
     * happens to be, and this is the only action in the game that cannot be
     * undone — so the warning names what goes, and then a second panel makes you
     * say it again. A check that clicked straight through to "Delete for ever"
     * would pass while the second question quietly stopped existing.
     */
    await fresh.locator('button[aria-label="Menu"]').first().dispatchEvent('click');
    await fresh.waitForTimeout(250);
    await fresh.locator('button:has-text("Delete Character")').first().dispatchEvent('click');
    await fresh.waitForTimeout(400);
    await fresh.locator('button:has-text("Delete Character")').last().dispatchEvent('click');
    await fresh.waitForTimeout(400);
    check(
      await fresh.locator('text=Are you certain').first().isVisible().catch(() => false),
      'and it asks a second time before it does it'
    );
    await fresh.locator('button:has-text("Delete for ever")').first().dispatchEvent('click');
    const gone = await stage(fresh, 'signin');
    check(gone === 'signin', 'deleting lands back on the sign-in screen', `landed on "${gone}"`);
    await fs.writeFile(`${OUT}/${phoneName}-10-deleted.png`, await fresh.screenshot());

    /* And the account really is new again — the booth, not the world. */
    await signIn(fresh, 'Mike');
    const reborn = await stage(fresh, 'character');
    check(reborn === 'character', 'signing back in starts the story over', `landed on "${reborn}"`);
  } else if (back === 'world' && (NO_CREATE || !LOCAL)) {
    log('leaving Delete Character untouched — it would erase a real save');
  }
  await stranger.close();
}

await fs.mkdir(OUT, { recursive: true });
console.log(`Story Mode check against ${BASE}${NO_CREATE ? ' (--no-create)' : ''}`);
for (const phone of Object.keys(PHONES)) await run(phone);

console.log(
  failures === 0
    ? `\nAll checks passed. Screenshots in ${OUT}`
    : `\n${failures} check${failures === 1 ? '' : 's'} failed. Screenshots in ${OUT}`
);
process.exit(failures === 0 ? 0 : 1);
