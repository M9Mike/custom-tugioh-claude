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

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = process.argv[3] ?? '/tmp/story';
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

/** A canvas that drew a scene compresses to far more than a flat rectangle. */
const RENDERED_BYTES = 9000;

async function shoot(page, name, phone) {
  const buf = await page.screenshot();
  await fs.writeFile(`${OUT}/${phone}-${name}.png`, buf);
  return buf;
}

async function canvasShot(page) {
  const canvas = page.locator('canvas').first();
  await canvas.waitFor({ timeout: 30000 });
  return canvas.screenshot();
}

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

async function signIn(page, name) {
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
  check(await entry.isVisible(), 'Story Mode is on the main menu');
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
    const first = await canvasShot(page);
    check(first.length > RENDERED_BYTES, 'the duelist is drawn', `${first.length} bytes`);
    await fs.writeFile(`${OUT}/${phoneName}-2-booth.png`, await page.screenshot());

    /* Every tab opens, which is the cheapest way to catch a control that throws
       on a value the default character never has.

       Selected by `data-tab` rather than by text: the viewport's own framing
       buttons also read "Body" and "Face", they come first in the document, and
       `.first()` duly tapped those instead — so this check passed for a while
       without ever opening a tab. */
    for (const tab of ['face', 'hair', 'style', 'body']) {
      await page.locator(`button[data-tab="${tab}"]`).tap();
      await page.waitForTimeout(200);
    }
    ok('every panel of the booth opens');

    /* A change to the character has to reach the model, or the booth is a
       picture of a default duelist with sliders next to it. */
    await page.locator('button:has-text("Surprise me")').first().tap();
    await page.waitForTimeout(900);
    const changed = await canvasShot(page);
    check(!changed.equals(first), 'changing the character changes the model');
    await fs.writeFile(`${OUT}/${phoneName}-3-surprise.png`, await page.screenshot());

    await page.locator('input[placeholder="Mike"]').first().fill('Mike');
    await page.locator('button:has-text("This is my duelist")').first().tap();
    await page.waitForTimeout(400);
    check(
      await page.locator('text=Bind this duelist').first().isVisible().catch(() => false),
      'binding asks first'
    );
    await page.locator('button:has-text("Bind")').last().tap();
    at = await stage(page, 'deck');
    if (at !== 'deck') await fs.writeFile(`${OUT}/${phoneName}-X-bind-failed.png`, await page.screenshot());
    check(at === 'deck', 'the duelist is bound and the deck follows', `landed on "${at}"`);
  } else {
    ok(`already past the booth (at "${at}") — the lock is checked below`);
  }

  /* ---- the first deck ---- */
  if (at === 'deck') {
    const cards = page.locator('main button[aria-pressed]');
    const offered = await cards.count();
    check(offered === 34, 'thirty-four cards are offered', `saw ${offered}`);

    const confirmBtn = page.locator('button:has-text("more")').first();
    check(await confirmBtn.isVisible(), 'the deck cannot be sleeved before it is full');

    for (let i = 0; i < 25; i++) {
      await cards.nth(i).scrollIntoViewIfNeeded();
      await cards.nth(i).tap();
    }
    await page.waitForTimeout(300);
    check(
      await page.locator('text=25/25').first().isVisible().catch(() => false),
      'twenty-five is twenty-five'
    );

    /* One more must be refused rather than quietly swapped. */
    await cards.nth(30).scrollIntoViewIfNeeded();
    await cards.nth(30).tap();
    await page.waitForTimeout(200);
    check(
      await page.locator('text=Take one out').first().isVisible().catch(() => false),
      'a twenty-sixth card is refused'
    );
    await fs.writeFile(`${OUT}/${phoneName}-4-deck.png`, await page.screenshot());

    await page.locator('button:has-text("This is my deck")').first().tap();
    await page.waitForTimeout(400);
    await page.locator('button:has-text("Sleeve it")').first().tap();
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

  await page.waitForTimeout(1400);
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

  /* ---- the corner menu ---- */
  await page.locator('button[aria-label="Menu"]').first().tap();
  await page.waitForTimeout(300);
  check(await page.locator('text=Mike').first().isVisible().catch(() => false), 'the menu names the character');
  check(await page.locator('text=Level 1').first().isVisible().catch(() => false), 'the menu shows the level');
  for (const item of ['Edit Deck', 'Save', 'Return to the Main Menu']) {
    check(
      await page.locator(`button:has-text("${item}")`).first().isVisible().catch(() => false),
      `the menu offers ${item}`
    );
  }
  await fs.writeFile(`${OUT}/${phoneName}-7-menu.png`, await page.screenshot());

  await page.locator('button:has-text("Save")').first().tap();
  await page.waitForTimeout(1200);
  check(await page.locator('text=Saved.').first().isVisible().catch(() => false), 'Save reports it saved');

  /* ---- the trick, seen from outside ---- */
  await page.locator('button:has-text("Edit Deck")').first().tap();
  const editing = await stage(page, 'editDeck');
  check(editing === 'editDeck', 'Edit Deck opens the builder', `landed on "${editing}"`);
  if (editing === 'editDeck') {
    const owned = await page.locator('main button[aria-pressed]').count();
    check(owned === 25, 'only the 25 that were chosen are still owned', `saw ${owned}`);
    await fs.writeFile(`${OUT}/${phoneName}-8-collection.png`, await page.screenshot());
    await page.locator('button:has-text("Cancel")').first().tap();
    await page.waitForTimeout(500);
  }

  /* ---- and out ---- */
  await page.locator('button[aria-label="Menu"]').first().tap();
  await page.waitForTimeout(250);
  await page.locator('button:has-text("Return to the Main Menu")').first().tap();
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
    await fresh.locator('button[aria-label="Menu"]').first().tap();
    await fresh.waitForTimeout(300);
    check(
      await fresh.locator('text=Mike').first().isVisible().catch(() => false),
      'and it is the same duelist'
    );
    await fs.writeFile(`${OUT}/${phoneName}-9-returned.png`, await fresh.screenshot());
  }
  await stranger.close();
}

await fs.mkdir(OUT, { recursive: true });
console.log(`Story Mode check against ${BASE}`);
for (const phone of Object.keys(PHONES)) await run(phone);

console.log(
  failures === 0
    ? `\nAll checks passed. Screenshots in ${OUT}`
    : `\n${failures} check${failures === 1 ? '' : 's'} failed. Screenshots in ${OUT}`
);
process.exit(failures === 0 ? 0 : 1);
