/**
 * Where duel rooms actually live.
 *
 * Serverless instances do not share memory, and Vercel spreads bursts of
 * requests across several of them — so a room held only in one instance's heap
 * disappears the moment a request lands somewhere else. Anything that must
 * survive between requests goes through this store instead.
 *
 * If Redis credentials are present (Upstash, however it was attached — Vercel's
 * marketplace integration sets KV_* or UPSTASH_*), rooms are stored there and
 * every instance sees the same duel. Without credentials it falls back to
 * process memory, which is fine for `next dev` and the test scripts but is not
 * safe across instances in production.
 */

const REDIS_URL =
  process.env.KV_REST_API_URL ??
  process.env.UPSTASH_REDIS_REST_URL ??
  process.env.REDIS_REST_URL ??
  '';
const REDIS_TOKEN =
  process.env.KV_REST_API_TOKEN ??
  process.env.UPSTASH_REDIS_REST_TOKEN ??
  process.env.REDIS_REST_TOKEN ??
  '';

export const usingRedis = Boolean(REDIS_URL && REDIS_TOKEN);

/** Rooms expire after 90 minutes of inactivity; every write refreshes it. */
export const ROOM_TTL_SECONDS = 90 * 60;

/* ------------------------------------------------------------------ */
/* Upstash REST                                                        */
/* ------------------------------------------------------------------ */

async function command<T>(cmd: (string | number)[]): Promise<T> {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmd),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`redis ${cmd[0]} failed: ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: string };
  if (json.error) throw new Error(`redis ${cmd[0]}: ${json.error}`);
  return json.result as T;
}

/* ------------------------------------------------------------------ */
/* Memory fallback                                                     */
/* ------------------------------------------------------------------ */

interface MemEntry {
  value: string;
  expiresAt: number;
}
const g = globalThis as unknown as { __duelMem?: Map<string, MemEntry> };
const mem: Map<string, MemEntry> = (g.__duelMem ??= new Map());

function memSweep() {
  const now = Date.now();
  for (const [k, v] of mem) if (v.expiresAt <= now) mem.delete(k);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export async function readRaw(key: string): Promise<string | null> {
  if (usingRedis) return (await command<string | null>(['GET', key])) ?? null;
  memSweep();
  return mem.get(key)?.value ?? null;
}

export async function writeRaw(key: string, value: string, ttlSeconds = ROOM_TTL_SECONDS): Promise<void> {
  if (usingRedis) {
    await command(['SET', key, value, 'EX', ttlSeconds]);
    return;
  }
  mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function deleteKey(key: string): Promise<void> {
  if (usingRedis) {
    await command(['DEL', key]);
    return;
  }
  mem.delete(key);
}

/** Claims a key only if it is currently unset — used to allocate room codes. */
export async function claim(key: string, value: string, ttlSeconds = ROOM_TTL_SECONDS): Promise<boolean> {
  if (usingRedis) {
    const res = await command<string | null>(['SET', key, value, 'EX', ttlSeconds, 'NX']);
    return res === 'OK';
  }
  memSweep();
  if (mem.has(key)) return false;
  mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  return true;
}

export async function readJson<T>(key: string): Promise<T | null> {
  const raw = await readRaw(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown, ttlSeconds = ROOM_TTL_SECONDS): Promise<void> {
  await writeRaw(key, JSON.stringify(value), ttlSeconds);
}
