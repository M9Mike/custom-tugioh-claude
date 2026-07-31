export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Cheap keepalive so the instance holding the live rooms stays warm. */
export async function GET() {
  return Response.json({ ok: true, t: Date.now() });
}
