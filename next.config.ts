import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Pins a running page to the build it was served.
   *
   * Every asset the client asks for goes out tagged with the deployment that
   * produced it, so a tab loaded before a deploy keeps being answered by the
   * build it knows — instead of asking the new one for a chunk it hashed
   * differently and getting a 404 back.
   *
   * Without it, a tab open across a deploy fails on the next thing it lazily
   * loads. That is not theoretical: pressing Save in the deck builder threw the
   * player back to the sign-in screen and brought back a version of the world
   * that had not existed for weeks, because the page reloaded into a bundle
   * still sitting in the browser cache.
   *
   * `VERCEL_DEPLOYMENT_ID` is set by Vercel at build time and is undefined
   * everywhere else, which leaves local development untouched.
   *
   * **This half needs the other half.** Skew Protection has to be switched on
   * for the project in Vercel (Settings → Advanced), or the tagged requests have
   * no older deployment left to be routed to. `src/app/StaleBuild.tsx` is the
   * floor under both — it catches what gets through and reloads once.
   */
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID,
  /* And the same id, inlined into the client, so a running page can ask
     whether it is still the current build — see `src/lib/freshBuild.ts`. */
  env: {
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_DEPLOYMENT_ID ?? (process.env.NODE_ENV === 'development' ? 'dev' : ''),
  },
};

export default nextConfig;
