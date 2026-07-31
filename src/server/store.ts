/**
 * Where duel rooms actually live.
 *
 * Serverless instances do not share memory, and Vercel spreads bursts of
 * requests across several of them — so a room held only in one instance's heap
 * disappears the moment a request lands somewhere else. Anything that must
 * survive between requests goes through this store instead.
 *
 * Three backends, chosen by whichever environment variables are set:
 *   MONGODB_URI                     -> MongoDB (e.g. Atlas)
 *   KV_REST_API_* / UPSTASH_*       -> Redis over Upstash's REST API
 *   neither                         -> process memory
 *
 * Memory is fine for `next dev` and the test scripts, but is NOT safe in
 * production: each instance would hold its own copy of the duel.
 */

import type { Collection, MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGODB_URI ?? process.env.MONGO_URL ?? '';

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

export const usingMongo = Boolean(MONGO_URI);
export const usingRedis = !usingMongo && Boolean(REDIS_URL && REDIS_TOKEN);
export const durable = usingMongo || usingRedis;
export const backend: 'mongodb' | 'redis' | 'memory' = usingMongo ? 'mongodb' : usingRedis ? 'redis' : 'memory';

/** Rooms expire after 90 minutes of inactivity; every write refreshes it. */
export const ROOM_TTL_SECONDS = 90 * 60;

/* ------------------------------------------------------------------ */
/* MongoDB                                                             */
/* ------------------------------------------------------------------ */

interface RoomDoc {
  _id: string;
  value: string;
  expiresAt: Date;
}

/* The client is cached on globalThis so warm serverless invocations reuse one
   pool instead of dialling Atlas on every request. */
const gm = globalThis as unknown as { __duelMongo?: Promise<Collection<RoomDoc>> };

async function collection(): Promise<Collection<RoomDoc>> {
  gm.__duelMongo ??= (async () => {
    const { MongoClient } = await import('mongodb');
    const client: MongoClient = new MongoClient(MONGO_URI, {
      maxPoolSize: 8,
      serverSelectionTimeoutMS: 8000,
    });
    await client.connect();
    const col = client.db('shadowduel').collection<RoomDoc>('rooms');
    // A TTL index lets Mongo expire abandoned rooms on its own.
    await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
    return col;
  })();
  return gm.__duelMongo;
}

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
  if (usingMongo) {
    const col = await collection();
    const doc = await col.findOne({ _id: key });
    // The TTL monitor only sweeps every ~60s, so honour the deadline ourselves.
    if (!doc || doc.expiresAt.getTime() <= Date.now()) return null;
    return doc.value;
  }
  if (usingRedis) return (await command<string | null>(['GET', key])) ?? null;
  memSweep();
  return mem.get(key)?.value ?? null;
}

export async function writeRaw(key: string, value: string, ttlSeconds = ROOM_TTL_SECONDS): Promise<void> {
  if (usingMongo) {
    const col = await collection();
    await col.updateOne(
      { _id: key },
      { $set: { value, expiresAt: new Date(Date.now() + ttlSeconds * 1000) } },
      { upsert: true }
    );
    return;
  }
  if (usingRedis) {
    await command(['SET', key, value, 'EX', ttlSeconds]);
    return;
  }
  mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function deleteKey(key: string): Promise<void> {
  if (usingMongo) {
    const col = await collection();
    await col.deleteOne({ _id: key });
    return;
  }
  if (usingRedis) {
    await command(['DEL', key]);
    return;
  }
  mem.delete(key);
}

/** Claims a key only if it is currently unset — used to allocate room codes. */
export async function claim(key: string, value: string, ttlSeconds = ROOM_TTL_SECONDS): Promise<boolean> {
  if (usingMongo) {
    const col = await collection();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    try {
      // The _id uniqueness constraint is what makes this atomic: two callers
      // racing for the same room code cannot both succeed.
      await col.insertOne({ _id: key, value, expiresAt });
      return true;
    } catch {
      // Already taken — unless the holder has expired, in which case reclaim it.
      const res = await col.updateOne(
        { _id: key, expiresAt: { $lte: new Date() } },
        { $set: { value, expiresAt } }
      );
      return res.modifiedCount === 1;
    }
  }
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
