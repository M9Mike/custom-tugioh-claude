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

import { durable, readJson, writeJson } from './store';
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
  } catch {
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

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function loadProfile(username: string): Promise<StoryProfile | null> {
  const stored = await readJson<StoryProfile>(key(username));
  if (stored) return stored;
  if (durable) return null;
  return (await devRead())[fold(username)] ?? null;
}

export async function saveProfile(profile: StoryProfile): Promise<void> {
  const next = { ...profile, updatedAt: Date.now() };
  await writeJson(key(next.username), next, FOREVER_SECONDS);
  if (!durable) await devWrite(next);
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
  await saveProfile(fresh);
  return fresh;
}
