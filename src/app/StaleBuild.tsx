'use client';

/**
 * Catches a page whose build has been deployed out from under it, and reloads.
 *
 * Mounted once in the root layout, renders nothing, and listens for the two
 * ways a missing chunk surfaces: a thrown `error` and a rejected dynamic
 * `import` that nobody caught. Either one, if it looks like a build that went
 * away, gets one reload — which fetches the current build and puts the player
 * back where they were, because the world position lives on the server.
 *
 * ## One reload, not a loop
 *
 * The attempt is stamped into `sessionStorage`, and a second failure inside the
 * cooldown is left alone. That matters more than the rescue does: a page that
 * reloads itself forever is worse than any error, and "the build is missing" and
 * "the build is broken" produce the same symptoms from in here. So it tries
 * once, and if the reload did not help it stops trying and lets the failure be
 * visible.
 *
 * Per tab rather than per browser, because a stale tab is a property of the tab.
 * Another window on the current build should not be told it has already tried.
 *
 * ## Why this exists at all when skew protection is on
 *
 * `deploymentId` in `next.config.ts` pins a running page to the deployment it
 * loaded from, which is the real fix and stops almost all of this. It is not the
 * whole of it: Vercel keeps a skew window rather than every build forever, a tab
 * left open past it is on its own, and a chunk can simply fail to arrive on a
 * bad connection. This is the floor under that — cheap, silent when nothing is
 * wrong, and the difference between a confusing bounce to the sign-in screen and
 * a page that quietly fixes itself.
 */

import { useEffect } from 'react';
import { COOLDOWN_MS, RESUME_KEY, STALE_KEY, isStaleBuild, shouldReload } from '@/lib/staleBuild';

export default function StaleBuild() {
  useEffect(() => {
    /*
     * Take the cache-buster back out of the address bar.
     *
     * It exists to make the rescue's request miss the browser cache and has no
     * meaning after that, so it should not survive into a bookmark, a share, or
     * the next reload — where it would quietly defeat caching for good.
     */
    try {
      const here = new URL(window.location.href);
      if (here.searchParams.has('rebuilt')) {
        here.searchParams.delete('rebuilt');
        window.history.replaceState(null, '', here.pathname + here.search + here.hash);
      }
    } catch {
      /* No history API worth the name; the parameter is harmless either way. */
    }

    const recover = (message: unknown, name?: unknown) => {
      if (!isStaleBuild(message, name)) return;
      let last: string | null = null;
      try {
        last = window.sessionStorage.getItem(STALE_KEY);
      } catch {
        /* Private browsing. Without somewhere to remember the attempt the loop
           guard cannot hold, so it does not try at all — an error the player can
           see beats a page that reloads for ever. */
        return;
      }
      if (!shouldReload(Date.now(), last)) return;
      try {
        window.sessionStorage.setItem(STALE_KEY, String(Date.now()));
        /* So the screen that comes back can carry on rather than ask the player
           to sign in to the session they were already in. */
        window.sessionStorage.setItem(RESUME_KEY, '1');
      } catch {
        return;
      }
      console.warn(
        'stale build: a chunk from this build is gone, reloading once ' +
        `(and not again for ${COOLDOWN_MS / 1000}s)`
      );
      /*
       * A fresh URL, not `location.reload()`.
       *
       * A reload revalidates the document but the browser is free to answer
       * from its cache, and for a prerendered page it often does — so the
       * rescue can fetch back exactly the stale HTML that named the missing
       * chunk, and the player lands on a build just as dead as the one they
       * were on. That is what "it asked me to sign in and then opened the old
       * world" was: the reload worked and changed nothing.
       *
       * A query nobody reads cannot be served from cache. `replace` rather than
       * `assign` so the broken page does not sit in the back history.
       */
      try {
        const fresh = new URL(window.location.href);
        fresh.searchParams.set('rebuilt', String(Date.now()));
        window.location.replace(fresh.toString());
      } catch {
        window.location.reload();
      }
    };

    const onError = (e: ErrorEvent) => recover(e.message, (e.error as Error | undefined)?.name);
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as { message?: unknown; name?: unknown } | string | undefined;
      if (typeof reason === 'string') recover(reason);
      else recover(reason?.message, reason?.name);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
