export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Which build is answering.
 *
 * Asked by a running page with its cookies left at home, so the answer comes
 * from whatever deployment is current rather than from the one the page was
 * pinned to when it loaded — see `freshBuild.ts`.
 */
export function GET() {
  return Response.json(
    /* 'dev' on a dev server, on both sides, so the stale road can be walked
       by `npm run duelreturn` with the answer mocked; empty in a local
       production build, which is never stale. */
    { id: process.env.VERCEL_DEPLOYMENT_ID ?? (process.env.NODE_ENV === 'development' ? 'dev' : '') },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
