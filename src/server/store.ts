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

/**
 * Cleans up the two ways a pasted connection string routinely arrives broken:
 * wrapped in quotes, or with a stray space picked up while copying the password.
 * The password is only trimmed when it contains nothing that would need
 * percent-encoding — otherwise it is left exactly as given, since a space could
 * conceivably be deliberate.
 */
export function normaliseMongoUri(raw: string): { uri: string; trimmedPassword: boolean } {
  const cleaned = raw.trim().replace(/^["']|["']$/g, '');
  const m = /^(mongodb(?:\+srv)?:\/\/)([^@]*)@([\s\S]*)$/.exec(cleaned);
  if (!m) return { uri: cleaned, trimmedPassword: false };
  const [, scheme, userinfo, hostAndRest] = m;
  const colon = userinfo.indexOf(':');
  if (colon < 0) return { uri: cleaned, trimmedPassword: false };
  const user = userinfo.slice(0, colon);
  const pass = userinfo.slice(colon + 1);
  const trimmed = pass.trim();
  if (trimmed === pass || /[@:/?#[\]%]/.test(trimmed)) return { uri: cleaned, trimmedPassword: false };
  return { uri: `${scheme}${user}:${trimmed}@${hostAndRest}`, trimmedPassword: true };
}

const RAW_MONGO_URI = process.env.MONGODB_URI ?? process.env.MONGO_URL ?? '';
const { uri: MONGO_URI, trimmedPassword: MONGO_PASSWORD_TRIMMED } = normaliseMongoUri(RAW_MONGO_URI);

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

export const usingMongo = Boolean(RAW_MONGO_URI);
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
  /**
   * The room's own `revision` at the time of writing, used for compare-and-set.
   * Absent on documents written before this existed, which the guard treats as
   * "matches anything" so a duel in flight is not stranded by a deploy.
   */
  rev?: number;
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
  })().catch((err) => {
    // Never cache a failed connection: a rejected promise left in place would
    // keep failing for the life of the instance, so a fixed password would
    // appear not to have worked until the instance recycled.
    gm.__duelMongo = undefined;
    throw err;
  });
  return gm.__duelMongo;
}

/** Classifies a storage failure without leaking connection details. */
export function describeStoreError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/bad auth|Authentication failed/i.test(msg)) return 'authentication-failed';
  if (/ENOTFOUND|getaddrinfo|querySrv/i.test(msg)) return 'host-not-found';
  if (/ServerSelection|timed out|ETIMEDOUT|ECONNREFUSED/i.test(msg)) return 'unreachable';
  return 'error';
}

/**
 * Describes the shape of MONGODB_URI without revealing the password, so a
 * credential problem can be pinned down from the health check alone.
 */
export function inspectMongoUri(): Record<string, unknown> | undefined {
  if (!usingMongo) return undefined;
  const raw = RAW_MONGO_URI;
  const out: Record<string, unknown> = {
    passwordWhitespaceTrimmed: MONGO_PASSWORD_TRIMMED,
    length: raw.length,
    scheme: raw.startsWith('mongodb+srv://') ? 'mongodb+srv' : raw.startsWith('mongodb://') ? 'mongodb' : 'UNRECOGNISED',
    surroundingWhitespace: raw !== raw.trim(),
    wrappedInQuotes: /^["'].*["']$/.test(raw.trim()),
    stillHasPlaceholder: /<[^>]+>/.test(raw),
  };

  const afterScheme = raw.trim().replace(/^mongodb(\+srv)?:\/\//, '');
  const at = afterScheme.lastIndexOf('@');
  if (at < 0) {
    out.credentials = 'MISSING — no user:password@ section';
    return out;
  }
  const userinfo = afterScheme.slice(0, at);
  const hostPart = afterScheme.slice(at + 1);
  const colon = userinfo.indexOf(':');
  const user = colon < 0 ? userinfo : userinfo.slice(0, colon);
  const pass = colon < 0 ? '' : userinfo.slice(colon + 1);

  out.user = user;
  out.host = hostPart.split('/')[0];
  out.passwordLength = pass.length;
  out.passwordHasWhitespace = /\s/.test(pass);
  // These are the characters that must be percent-encoded inside a URI.
  out.passwordNeedsEncoding = /[@:/?#[\]]/.test(pass);
  out.passwordAlreadyEncoded = /%[0-9A-Fa-f]{2}/.test(pass);
  return out;
}

/** Round-trips a probe value so a misconfiguration is visible without playing. */
export async function checkStore(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const probe = `duel:health:${Math.random().toString(36).slice(2)}`;
    await writeRaw(probe, 'ok', 60);
    const back = await readRaw(probe);
    await deleteKey(probe);
    return back === 'ok' ? { ok: true } : { ok: false, reason: 'round-trip-mismatch' };
  } catch (err) {
    return { ok: false, reason: describeStoreError(err) };
  }
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
  rev?: number;
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

/**
 * Writes only if the stored revision is still the one we read.
 *
 * Every mutation here is load -> change -> save, which without this is a plain
 * lost update: two requests read the same room, both write, and the second
 * silently erases the first. It was not a theoretical race — the poll endpoint
 * wrote the whole room back on a timer, so a summon could be undone by a
 * *read* that had started before it, and the board rewound in front of the
 * player.
 *
 * Returns false when the room moved underneath, so the caller can reload and
 * try again rather than clobber. `expected < 0` means "this room is new".
 */
export async function writeRawIf(
  key: string,
  value: string,
  expected: number,
  next: number,
  ttlSeconds = ROOM_TTL_SECONDS
): Promise<boolean> {
  const expiresAt = Date.now() + ttlSeconds * 1000;
  if (usingMongo) {
    const col = await collection();
    if (expected < 0) {
      await col.updateOne(
        { _id: key },
        { $set: { value, rev: next, expiresAt: new Date(expiresAt) } },
        { upsert: true }
      );
      return true;
    }
    const res = await col.updateOne(
      // `rev` missing means the document predates this guard: let it through
      // once, and it carries a revision from then on.
      { _id: key, $or: [{ rev: expected }, { rev: { $exists: false } }] },
      { $set: { value, rev: next, expiresAt: new Date(expiresAt) } }
    );
    return res.matchedCount === 1;
  }
  if (usingRedis) {
    /* Upstash's REST API has no compare-and-set without a Lua round trip, and
       Redis is only ever the fallback when MongoDB is not configured — never
       production here. Documented rather than silently unguarded. */
    await command(['SET', key, value, 'EX', ttlSeconds]);
    return true;
  }
  memSweep();
  const cur = mem.get(key);
  if (expected >= 0 && cur && cur.rev !== undefined && cur.rev !== expected) return false;
  mem.set(key, { value, expiresAt, rev: next });
  return true;
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

/** `writeJson` under the compare-and-set guard — see `writeRawIf`. */
export async function writeJsonIf(
  key: string,
  value: unknown,
  expected: number,
  next: number,
  ttlSeconds = ROOM_TTL_SECONDS
): Promise<boolean> {
  return writeRawIf(key, JSON.stringify(value), expected, next, ttlSeconds);
}
