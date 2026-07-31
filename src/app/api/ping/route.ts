import { backend, checkStore, durable, inspectMongoUri } from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Health check. `?deep=1` also round-trips a probe value through the room store,
 * so a misconfigured database shows up here rather than as a failed duel.
 */
export async function GET(req: Request) {
  const deep = new URL(req.url).searchParams.get('deep') === '1';
  const store = deep ? await checkStore() : undefined;
  // Only when the probe actually failed, and never including the password.
  const uri = deep && store && !store.ok ? inspectMongoUri() : undefined;
  return Response.json({
    ok: deep ? store!.ok : true,
    durableRooms: durable,
    backend,
    ...(store ? { store } : {}),
    ...(uri ? { uri } : {}),
    t: Date.now(),
  });
}
