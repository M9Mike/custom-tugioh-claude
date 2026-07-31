/**
 * A tiny stand-in for an Upstash Redis REST endpoint, so the durable-storage
 * path can be exercised locally without provisioning anything.
 *
 * Speaks the same contract the real service does: POST a JSON array command,
 * get back `{ "result": ... }`. Supports only what src/server/store.ts uses.
 *
 *   node scripts/fake-redis.mjs [port]
 */
import http from 'node:http';

const PORT = Number(process.argv[2] ?? 6390);
const db = new Map(); // key -> { value, expiresAt }

function sweep() {
  const now = Date.now();
  for (const [k, v] of db) if (v.expiresAt && v.expiresAt <= now) db.delete(k);
}

function run(cmd) {
  sweep();
  const op = String(cmd[0]).toUpperCase();
  const key = cmd[1];

  if (op === 'GET') return db.get(key)?.value ?? null;

  if (op === 'SET') {
    const value = cmd[2];
    const rest = cmd.slice(3).map((x) => String(x).toUpperCase());
    const nx = rest.includes('NX');
    if (nx && db.has(key)) return null;
    const exIdx = rest.indexOf('EX');
    const ttl = exIdx >= 0 ? Number(cmd[3 + exIdx + 1]) : 0;
    db.set(key, { value, expiresAt: ttl ? Date.now() + ttl * 1000 : 0 });
    return 'OK';
  }

  if (op === 'DEL') {
    const had = db.delete(key);
    return had ? 1 : 0;
  }

  throw new Error(`unsupported command: ${op}`);
}

http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const cmd = JSON.parse(body || '[]');
        res.end(JSON.stringify({ result: run(cmd) }));
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  })
  .listen(PORT, () => console.log(`fake redis listening on http://localhost:${PORT} (${db.size} keys)`));
