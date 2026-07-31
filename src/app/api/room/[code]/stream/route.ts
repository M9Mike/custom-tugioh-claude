import { getRoom, seatFor, subscribe, touch, viewOf } from '@/server/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Closed a little before the platform's function timeout so the client can
 *  reconnect cleanly instead of seeing a hard network error. */
const STREAM_MS = 45_000;
const KEEPALIVE_MS = 10_000;

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const room = getRoom(code);
  if (!room) return Response.json({ ok: false, reason: 'not-found' }, { status: 404 });
  const pid = seatFor(room, token);
  if (!pid) return Response.json({ ok: false, reason: 'bad-token' }, { status: 403 });

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let endTimer: ReturnType<typeof setTimeout> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        clearTimeout(endTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      write(`retry: 1000\n\n`);
      write(`data: ${JSON.stringify(viewOf(room, pid))}\n\n`);

      unsubscribe = subscribe(
        room,
        pid,
        (payload) => write(`data: ${payload}\n\n`),
        finish
      );

      keepalive = setInterval(() => {
        touch(room, pid);
        write(`: keepalive\n\n`);
      }, KEEPALIVE_MS);

      endTimer = setTimeout(finish, STREAM_MS);
      req.signal.addEventListener('abort', finish);
    },
    cancel() {
      clearInterval(keepalive);
      clearTimeout(endTimer);
      unsubscribe();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
