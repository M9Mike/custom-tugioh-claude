/**
 * Where Story Mode saves live.
 *
 * Rooms are ephemeral — a duel is over in twenty minutes and the store expires
 * them after ninety. A Story Mode profile is the opposite: it is the promise
 * that typing your name on a different phone brings back the duelist you made,
 * so it is written with a ten-year deadline and never touched again by the TTL
 * sweeper.
 *
 * The rest of this file is the login gate, which is temporary by design: one
 * account, no password, so the game can be walked end to end without waiting on
 * anybody to type a secret. Accounts, passwords and registration come later;
 * everything below `AUTHORISED` is written as though they already existed, so
 * adding them is a change to this one function.
 */

import { deleteKey, durable, readJson, writeJsonIf } from './store';
import { newProfile, type StoryProfile } from '@/story/profile';

/** Ten years. Long enough that "permanent" is a fair description. */
const FOREVER_SECONDS = 10 * 365 * 24 * 60 * 60;

const key = (username: string) => `story:profile:${fold(username)}`;

/** Names are matched case- and space-insensitively; `MIKE ` is Mike. */
export function fold(username: string): string {
  return username.trim().toLowerCase();
}

/**
 * The accounts that may enter Story Mode, and how their name is printed back.
 *
 * Development stand-in for a user table. Typing anything else is refused
 * outright rather than quietly creating an account — there is no registration
 * yet, and silently minting a profile for a typo would strand a character
 * against a username nobody meant to use.
 */
const AUTHORISED: Record<string, string> = {
  mike: 'Mike',
};

/**
 * The account a request is acting as — **on the request's word alone.**
 *
 * Say it plainly, because every Story Mode route funnels through this line and
 * none of them can tell who is calling: there is no password, no session, no
 * token and no signature anywhere in Story Mode yet. A caller states a username
 * and is believed. Anyone who can reach the API can write any admitted account's
 * character, deck and position.
 *
 * That is the state the mode is deliberately being built in, and the reason it
 * is not a live hole is the roster above: exactly one hardcoded development name
 * is admitted, so there is nobody to impersonate. It stops being true the moment
 * a second account exists.
 *
 * So this function is the gate for what comes next, and it is the *only* one:
 * accounts, passwords and registration all land here, as a credential checked
 * against a real user record before a name is handed back. Until then, no route
 * should treat the name it gets as proof of anything, and nothing that matters
 * outside one player's own save should be reachable through them.
 */
export function canonicalUsername(username: string): string | null {
  return AUTHORISED[fold(username)] ?? null;
}

/* ------------------------------------------------------------------ */
/* A local file, only when there is no database                        */
/*                                                                     */
/* `store.ts` falls back to process memory when neither MONGODB_URI nor */
/* the Redis pair is set, which is fine for a duel and useless for a    */
/* save: `next dev` restarts on every edit, and a character that cannot */
/* survive one is a character you cannot test against. Production is    */
/* never in this branch — `durable` is true there — and the write is    */
/* wrapped because a read-only filesystem must not break the game.      */
/* ------------------------------------------------------------------ */

const DEV_FILE = '.cache/story-profiles.json';

async function devRead(): Promise<Record<string, StoryProfile>> {
  try {
    const fs = await import('node:fs/promises');
    return JSON.parse(await fs.readFile(DEV_FILE, 'utf8')) as Record<string, StoryProfile>;
  } catch (err) {
    /* No file is the ordinary case — nobody has played yet. Anything else is a
       corrupt or unreadable save, which still falls back to "no profiles" so
       Story Mode opens, but says so first: a character that has silently
       stopped coming back is otherwise indistinguishable from one that was
       never made. */
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.error(`story: could not read ${DEV_FILE}, continuing without it`, err);
    }
    return {};
  }
}

async function devWrite(profile: StoryProfile): Promise<void> {
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const all = await devRead();
    all[fold(profile.username)] = profile;
    await fs.mkdir(path.dirname(DEV_FILE), { recursive: true });
    await fs.writeFile(DEV_FILE, JSON.stringify(all, null, 2));
  } catch {
    /* Read-only filesystem, or no filesystem at all. The in-memory copy still
       serves this process, which is all the fallback ever promised. */
  }
}

async function devDelete(username: string): Promise<void> {
  const all = await devRead();
  /* Nothing stored, nothing to resurrect: a file that never held this profile
     needs no rewrite, and failing here would 503 a deletion that has in fact
     fully happened. */
  if (!(fold(username) in all)) return;
  delete all[fold(username)];
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    await fs.mkdir(path.dirname(DEV_FILE), { recursive: true });
    await fs.writeFile(DEV_FILE, JSON.stringify(all, null, 2));
  } catch (err) {
    /* NOT devWrite's shrug. A save that fails to persist is progress lost on
       restart, which the fallback accepts — but a deletion that fails to
       persist is the profile coming back, which breaks the one promise the
       confirm sheet makes. Thrown so the route answers 503 and the player
       gets to try again, rather than being told a save is gone while the file
       still holds it. */
    console.error(`story: could not delete from ${DEV_FILE}`, err);
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function loadProfile(username: string): Promise<StoryProfile | null> {
  const stored = await readJson<StoryProfile>(key(username));
  if (stored) return stored;
  if (durable) return null;
  return (await devRead())[fold(username)] ?? null;
}

/**
 * Writes a profile, but only if nobody has written one since we read it.
 *
 * `isNew` skips the guard, which is what creating a profile for a name seen for
 * the first time needs — there is no revision to match against yet.
 */
async function commit(profile: StoryProfile, isNew: boolean): Promise<boolean> {
  const rev = profile.rev ?? 0;
  const next: StoryProfile = { ...profile, rev: rev + 1, updatedAt: Date.now() };
  const won = await writeJsonIf(key(next.username), next, isNew ? -1 : rev, rev + 1, FOREVER_SECONDS);
  if (won && !durable) await devWrite(next);
  return won;
}

/**
 * The profile for a signed-in player, created empty on first sight.
 *
 * An empty profile is not a character: `character` stays null until the
 * creation booth is finished, so a player who opens Story Mode and backs out
 * has claimed nothing and can still make their duelist later.
 */
export async function loadOrCreateProfile(canonical: string): Promise<StoryProfile> {
  const existing = await loadProfile(canonical);
  if (existing) return existing;
  const fresh = newProfile(canonical, Date.now());
  /* `commit` stores revision one, so handing `fresh` back with its revision
     zero would give the caller a profile that is already out of date — every
     first write against a new account would then lose its compare-and-set and
     have to go round again. And if another request created the account first,
     `fresh` was never stored at all: re-reading is the only way to find out
     what actually landed. */
  const won = await commit(fresh, true);
  if (won) return { ...fresh, rev: (fresh.rev ?? 0) + 1 };
  return (await loadProfile(canonical)) ?? fresh;
}

/** What a route decided to do with the profile it was handed. */
export type Update =
  | { ok: true; profile: StoryProfile }
  | { ok: false; status: number; error: string };

/**
 * Load, change, save — and if somebody got there first, do it all again.
 *
 * This is the only way anything in Story Mode is written, and the *whole*
 * profile going back on every write is why it has to be. Saving your position
 * in the world rewrites the character and the deck along with it, so a position
 * save that began before a deck was sleeved would have put the old deck back on
 * top of the new one. Retrying against a fresh read is what makes that a
 * non-event rather than a lost deck: `apply` is handed whatever is stored *now*
 * and gets to make its decision again, so the lock checks are re-run too and
 * two racing attempts to create a character cannot both pass.
 *
 * Four attempts, because each one only loses to a write that actually landed in
 * the gap, and a fifth consecutive loss is a bug rather than contention.
 */
export async function updateProfile(
  canonical: string,
  apply: (current: StoryProfile) => Update
): Promise<Update> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await loadOrCreateProfile(canonical);
    const decided = apply(current);
    if (!decided.ok) return decided;
    if (await commit(decided.profile, false)) {
      return { ok: true, profile: { ...decided.profile, rev: (decided.profile.rev ?? 0) + 1 } };
    }
  }
  return { ok: false, status: 409, error: 'Your save is busy elsewhere. Try again in a moment.' };
}

/**
 * Erases the whole save: character, deck, collection, progress, position.
 *
 * This is the one sanctioned way back from a bound duelist. Appearance is
 * never editable — that promise is what makes binding mean something — so
 * starting over is the entire profile going at once, not any part of it being
 * rewritten in place. The next login finds nothing and walks into the creation
 * booth exactly as on day one.
 *
 * No compare-and-set here, deliberately. Deletion is not a lost-update hazard:
 * whatever a racing write was doing to this profile, the player has just said
 * the profile should not exist. On MongoDB a stale write cannot resurrect the
 * old save either — its revision guard matches nothing once the document is
 * gone, so the writer re-reads and finds only the fresh empty profile. The
 * memory fallback's guard treats a missing key as new and *can* lose that
 * race, which `next dev` accepts: the window is one in-flight request wide.
 */
export async function deleteProfile(canonical: string): Promise<void> {
  await deleteKey(key(canonical));
  if (!durable) await devDelete(canonical);
}
