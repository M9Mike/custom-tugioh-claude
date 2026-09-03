import { RESUME_KEY, STALE_KEY, shouldReload } from './staleBuild';

/**
 * Is this page a build behind?
 *
 * A game that stays open on a phone keeps running the build it loaded: the
 * chunks are cached, and Skew Protection answers every request it makes from
 * that same old deployment — that is its job. So after a deploy, Mike's
 * installed app could finish a duel, walk back into Story Mode, and do it all
 * in code from before the road back was fixed, while a fresh launch showed
 * the fix working. Nothing on the page can tell, unless it asks with its
 * cookies left at home: a request without them is answered by the current
 * deployment, and if that is not the build this page was made from, the page
 * is stale.
 *
 * `NEXT_PUBLIC_BUILD_ID` is inlined at build time (`next.config.ts`); both
 * are empty outside Vercel, and empty is never stale.
 */
export async function staleBuild(): Promise<boolean> {
  const mine = process.env.NEXT_PUBLIC_BUILD_ID ?? '';
  if (!mine) return false;
  try {
    const res = await fetch(`/api/build?at=${Date.now()}`, { credentials: 'omit', cache: 'no-store' });
    if (!res.ok) return false;
    const data = (await res.json()) as { id?: string };
    return typeof data.id === 'string' && data.id !== '' && data.id !== mine;
  } catch {
    return false;
  }
}

/**
 * Reload into the current build, once, and pick the session back up.
 *
 * The Skew Protection cookie is what would route the reload back to the old
 * build, so it goes first. The resume flag is the one `StaleBuild` sets for a
 * rescue reload: Story Mode sees it on arrival and signs back in without
 * asking. Guarded by the same cooldown, so a page that cannot get fresh does
 * not reload for ever.
 */
export function reloadIntoFresh(path: string): boolean {
  try {
    const last = window.sessionStorage.getItem(STALE_KEY);
    if (!shouldReload(Date.now(), last)) return false;
    window.sessionStorage.setItem(STALE_KEY, String(Date.now()));
    window.sessionStorage.setItem(RESUME_KEY, '1');
  } catch {
    return false;
  }
  try { document.cookie = '__vdpl=; Max-Age=0; path=/'; } catch { /* nothing to clear */ }
  const fresh = new URL(path, window.location.origin);
  fresh.searchParams.set('rebuilt', String(Date.now()));
  window.location.replace(fresh.toString());
  return true;
}
