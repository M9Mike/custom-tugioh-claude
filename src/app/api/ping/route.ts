import { backend, durable } from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Health check that also reports whether durable room storage is configured. */
export async function GET() {
  return Response.json({ ok: true, durableRooms: durable, backend, t: Date.now() });
}
