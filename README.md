# Shadow Duel — Duelist Kingdom

A private, two-player online duel game built around the original season 1 cast of
Yu-Gi-Oh!. Ten hand-built 25-card decks, real card artwork, and **every single card
rewritten with an overpowered, anime-flavoured effect**.

Start a duel, send the link or the four-letter room code to your opponent, both pick a
duelist, and play.

**Built for two iPhones.** The board is laid out phone-first and tested on the real
Safari engine at both 414×896 and 440×956: safe-area insets for the notch and home
indicator, `svh` units so nothing jumps when Safari's toolbars move, Web Audio unlocked
on first touch (iOS refuses to start audio otherwise), a screen wake lock so the phone
doesn't sleep mid-turn, and a web manifest so *Add to Home Screen* gives a fullscreen
app.

## House rules

Deliberately different from the real trading card game:

| | |
|---|---|
| Life Points | 4000 |
| Deck size | exactly 25 cards (plus a small Extra Deck for some duelists) |
| Opening hand | 5 cards |
| Monster Zones | 3 |
| Spell/Trap Zone | 1 (plus a separate Field Zone) |
| Turn structure | Draw → **one** Main Phase → Battle → End |
| First turn | no attacks |

Tribute rules are standard (Level 5–6 need one tribute, Level 7+ need two), with one
twist: **Toon monsters need no tribute while their controller has Toon World face-up** —
which is what makes Pegasus's deck function.

Winning: reduce your opponent to 0 Life Points, make them run out of cards to draw, or
assemble all five pieces of Exodia in your hand.

## The duelists

Yugi Muto · Seto Kaiba · Joey Wheeler · Mai Valentine · Maximillion Pegasus ·
Bakura Ryou · Mako Tsunami · Weevil Underwood · Rex Raptor · Bandit Keith

Each has a 25-card deck drawn from what they actually played in the anime, and a
signature card used as their emblem.

## How it is built

- **Next.js (App Router) + TypeScript + Tailwind**, deployed on Vercel.
- **`src/game/`** — the rules engine. Pure, deterministic, and shared by client and
  server: the same code that resolves a duel on the server also tells the interface
  which buttons should be enabled.
  - `types.ts` — the effect DSL (triggers, selectors, ~45 operations).
  - `effects/monsters.ts`, `effects/spells.ts` — the custom effect for every card.
  - `engine.ts` — summons, battle, triggers, trap windows, win conditions.
  - `autoplay.ts` — legal-move enumeration, used by the tests.
- **`src/server/rooms.ts`** — in-memory duel rooms.
- **Regions** — functions are pinned to `cdg1` (Paris) in `vercel.json` to sit beside
  the MongoDB cluster. The database is read and written on every move, so co-locating
  compute and storage matters more than shaving the player's own hop.
- **Realtime** — server-authoritative, with clients polling for changes (~1s while
  waiting on the opponent, backing off otherwise) and re-joining automatically with a
  saved seat token. Deliberately not a held-open stream: that pins a player to one
  serverless instance, and the platform scales out mid-duel.
- **Room storage** (`src/server/store.ts`) — rooms live in shared storage so any
  instance can serve any request. Set `MONGODB_URI` for MongoDB, or the `KV_*` /
  `UPSTASH_*` pair for Redis. With neither, rooms fall back to process memory, which
  works locally but loses duels in production. `/api/ping` reports which backend is
  live.
- **Artwork** — the official cropped card art, downloaded and re-encoded to WebP at
  build time by `scripts/prepare-art.mjs` (never hot-linked at runtime). Card frames,
  layout and all rules text are drawn by us.
- **Sound** — synthesised at runtime with the Web Audio API; no audio files.

## Working on it

```bash
npm install
npm run art      # download card artwork into public/art (also runs before build)
npm run dev

npm run sim 800  # play 800 random duels offline; reports rule errors + win rates
npm run e2e      # drive two HTTP clients through full duels against a running server
npm run shots    # drive two desktop browsers and screenshot the whole flow
npm run iphone   # play a full duel on WebKit at both iPhone sizes, by tapping
npm run cards    # re-resolve decklists against the card database (authoring only)

# Exercising the durable-storage paths locally, without provisioning anything:
node scripts/mongo-boot.mjs   # throwaway MongoDB on :27099, then MONGODB_URI=...
node scripts/fake-redis.mjs   # Upstash REST stand-in on :6390, then KV_REST_API_*
```

`data/decklists.json` is the source of truth for the decks. `npm run cards` resolves the
card names, pulls real stats, and writes `src/game/generated/`.

## Legal

A private, non-commercial fan project made for two people to play together. Yu-Gi-Oh!,
the cards and the artwork are the property of Kazuki Takahashi, Shueisha and Konami.
Card data and images come from the community [YGOPRODeck](https://ygoprodeck.com) API.
The card effects in this game are original and do not match the official game.
