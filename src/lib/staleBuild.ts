/**
 * Telling "this build is gone" apart from every other kind of error.
 *
 * ## What happens without this
 *
 * A tab is open on Story Mode. A deploy goes out. The player presses Save, the
 * app reaches for a JavaScript chunk that belonged to the build they loaded, and
 * that file no longer exists — the new deployment hashed it differently. The
 * import rejects, React unmounts the tree, and the page reloads itself into
 * whatever is still in the browser's cache.
 *
 * From the player's side: they pressed Save, got thrown back to the sign-in
 * screen with their name still in the box, and the world that came back was one
 * that had not existed for weeks. Nothing in the game did any of that. Every
 * piece of it is a build that went away underneath a running page.
 *
 * ## Why it is a list of strings
 *
 * There is no error type for this. Chromium throws `ChunkLoadError`, Safari says
 * "Importing a module script failed", a failed dynamic import says "Failed to
 * fetch dynamically imported module", and a stylesheet says something else
 * again. All of them mean the same thing and none of them share an interface, so
 * the only honest test is the text — which is exactly the sort of thing that
 * rots silently when a browser rewords a message, and exactly why `npm run
 * stale` asserts every one of these against the real wording.
 *
 * Nothing here touches the DOM, so it can be checked as arithmetic.
 */

/**
 * The wordings, from the browsers that produce them.
 *
 * Deliberately specific. A looser net — "Unexpected token '<'", which is what
 * you get when a missing chunk is answered with an HTML 404 page — would also
 * catch real syntax errors in our own code and reload the page in a circle over
 * a bug that a reload cannot fix.
 */
const SIGNATURES: RegExp[] = [
  /ChunkLoadError/i,
  /Loading chunk [^ ]+ failed/i,
  /Loading CSS chunk/i,
  /failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /importing a module script failed/i,
];

/** Whether this error means the build the page is running was replaced. */
export function isStaleBuild(message: unknown, name?: unknown): boolean {
  const text = `${typeof name === 'string' ? name : ''} ${typeof message === 'string' ? message : ''}`;
  return SIGNATURES.some((re) => re.test(text));
}

/** Where the last recovery attempt is remembered. Per tab, on purpose. */
export const STALE_KEY = 'stale-build-reloaded';

/**
 * Set just before a rescue reload, and consumed by the first screen that can
 * use it.
 *
 * Without it the rescue is only half a rescue. The reload fetches the right
 * build, which is the part that matters — but a full page load has no state, so
 * Story Mode comes back on its sign-in card with the name already in the box,
 * waiting to be told to do the thing it was already doing. The player pressed
 * Save and got asked who they are.
 *
 * One flag, consumed once, and only ever written by the reload that a missing
 * chunk caused. A normal visit never sees it, so nothing about signing in
 * changes for anybody who did not just get rescued.
 */
export const RESUME_KEY = 'stale-build-resume';

/**
 * How long a reload counts for.
 *
 * Long enough that a build which is broken for some *other* reason cannot spin
 * the page in a loop — one reload, then it stops trying and lets the error
 * surface. Short enough that a player who leaves the tab open all day and hits
 * this twice, hours apart, gets rescued both times.
 */
export const COOLDOWN_MS = 30_000;

/**
 * Whether to reload, given when the last attempt was.
 *
 * Split out from the listener so the decision can be checked without a browser.
 * `last` is whatever was stored — a number, a string from `sessionStorage`, or
 * nothing at all on the first run.
 */
export function shouldReload(now: number, last: unknown): boolean {
  const when = typeof last === 'string' ? Number(last) : typeof last === 'number' ? last : NaN;
  if (!Number.isFinite(when)) return true;
  return now - when > COOLDOWN_MS;
}
