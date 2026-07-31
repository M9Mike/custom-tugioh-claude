// Resolves every card name in data/decklists.json against the YGOPRODeck database,
// writes real stats to src/game/generated/cards.json, and downloads + compresses the
// official cropped artwork into public/art/.
//
// Run with: node scripts/fetch-cards.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const ALL_CARDS = path.join(CACHE, 'ygo-all.json');
const ART_DIR = path.join(ROOT, 'public', 'art');
const OUT = path.join(ROOT, 'src', 'game', 'generated', 'cards.json');

const slug = (name) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const norm = (name) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

async function loadAllCards() {
  await fs.mkdir(CACHE, { recursive: true });
  try {
    const cached = await fs.readFile(ALL_CARDS, 'utf8');
    const parsed = JSON.parse(cached);
    if (parsed?.data?.length) {
      console.log(`• using cached card database (${parsed.data.length} cards)`);
      return parsed.data;
    }
  } catch {
    /* no cache yet */
  }
  console.log('• downloading full card database from YGOPRODeck…');
  const res = await fetch('https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes');
  if (!res.ok) throw new Error(`card database download failed: ${res.status}`);
  const json = await res.json();
  await fs.writeFile(ALL_CARDS, JSON.stringify(json));
  console.log(`• downloaded ${json.data.length} cards`);
  return json.data;
}

function buildIndex(cards) {
  const byNorm = new Map();
  for (const card of cards) {
    const key = norm(card.name);
    // Prefer the lowest id for a name collision (the original printing).
    if (!byNorm.has(key) || card.id < byNorm.get(key).id) byNorm.set(key, card);
  }
  return byNorm;
}

function resolve(name, index, cards) {
  const exact = index.get(norm(name));
  if (exact) return exact;
  // Fall back to a forgiving contains-match so small spelling drifts still land.
  const target = norm(name);
  const near = cards.filter((c) => norm(c.name).includes(target) || target.includes(norm(c.name)));
  near.sort((a, b) => Math.abs(norm(a.name).length - target.length) - Math.abs(norm(b.name).length - target.length));
  return near[0] ?? null;
}

async function downloadArt(card) {
  const dest = path.join(ART_DIR, `${card.id}.webp`);
  try {
    await fs.access(dest);
    return; // already have it
  } catch {
    /* need to fetch */
  }
  const url =
    card.card_images?.[0]?.image_url_cropped ??
    `https://images.ygoprodeck.com/images/cards_cropped/${card.id}.jpg`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`art download failed for ${card.name}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await sharp(buf).resize(420, 420, { fit: 'cover', position: 'attention' }).webp({ quality: 82 }).toFile(dest);
}

const main = async () => {
  const cards = await loadAllCards();
  const index = buildIndex(cards);
  const decklists = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'decklists.json'), 'utf8'));

  await fs.mkdir(ART_DIR, { recursive: true });
  await fs.mkdir(path.dirname(OUT), { recursive: true });

  const wanted = new Map(); // requested name -> resolved card
  const misses = [];
  const renames = [];

  for (const duelist of decklists.duelists) {
    const names = [...duelist.deck.map(([n]) => n), ...(duelist.extra ?? []), duelist.emblem];
    for (const name of names) {
      if (wanted.has(name)) continue;
      const found = resolve(name, index, cards);
      if (!found) {
        misses.push(`${duelist.id}: ${name}`);
        continue;
      }
      if (norm(found.name) !== norm(name)) renames.push(`${name}  ->  ${found.name}`);
      wanted.set(name, found);
    }
  }

  if (renames.length) {
    console.log('\n• fuzzy-matched names:');
    for (const r of renames) console.log(`   ${r}`);
  }
  if (misses.length) {
    console.log('\n! UNRESOLVED CARD NAMES:');
    for (const m of misses) console.log(`   ${m}`);
  }

  console.log(`\n• downloading artwork for ${wanted.size} unique cards…`);
  const entries = [...wanted.entries()];
  let done = 0;
  const CONCURRENCY = 12;
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    await Promise.all(
      entries.slice(i, i + CONCURRENCY).map(async ([name, card]) => {
        try {
          await downloadArt(card);
        } catch (err) {
          console.log(`   ! art failed: ${name} (${err.message})`);
        }
        done += 1;
      })
    );
    process.stdout.write(`\r   ${done}/${entries.length}`);
  }
  console.log('');

  const out = {};
  for (const [requested, card] of wanted) {
    const isMonster = card.type.includes('Monster');
    out[slug(requested)] = {
      slug: slug(requested),
      name: card.name,
      kind: card.type.includes('Spell') ? 'spell' : card.type.includes('Trap') ? 'trap' : 'monster',
      // race is "Continuous"/"Normal"/"Quick-Play"/"Equip"/"Field"/"Ritual" for spells & traps
      subKind: isMonster ? null : card.race,
      type: isMonster ? card.race : null,
      attribute: isMonster ? card.attribute : null,
      level: isMonster ? (card.level ?? 0) : null,
      atk: isMonster ? (card.atk ?? 0) : null,
      def: isMonster ? (card.def ?? 0) : null,
      frameType: card.frameType,
      isFusion: card.frameType === 'fusion',
      isRitual: card.frameType === 'ritual',
      isEffect: card.type.includes('Effect') || card.frameType === 'effect',
      artId: card.id,
    };
  }

  await fs.writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(`\n• wrote ${Object.keys(out).length} cards to ${path.relative(ROOT, OUT)}`);

  // Mirror the decklists into src/ (with slugs resolved) so the app never
  // imports from outside the TypeScript project root.
  const resolved = {
    duelists: decklists.duelists.map((d) => ({
      ...d,
      emblem: slug(d.emblem),
      deck: d.deck.map(([n, c]) => [slug(n), c]),
      extra: (d.extra ?? []).map(slug),
    })),
  };
  const deckOut = path.join(path.dirname(OUT), 'decklists.json');
  await fs.writeFile(deckOut, JSON.stringify(resolved, null, 2));
  console.log(`• wrote decklists to ${path.relative(ROOT, deckOut)}`);

  const artFiles = await fs.readdir(ART_DIR);
  let bytes = 0;
  for (const f of artFiles) bytes += (await fs.stat(path.join(ART_DIR, f))).size;
  console.log(`• artwork: ${artFiles.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);

  if (misses.length) process.exitCode = 1;
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
