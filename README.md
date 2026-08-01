# Shadow Duel — Duelist Kingdom

A private, two-player online duel game built around the original season 1 cast of
Yu-Gi-Oh!. Ten hand-built 25-card decks, real card artwork, and **every single card
rewritten with an overpowered, anime-flavoured effect**.

Start a duel, send the link or the four-letter room code to your opponent, both pick a
duelist, and play. Or play alone: a single duel against the computer, or the
**tournament** — eight duelists, single elimination, three wins for the crown.

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

## The computer opponent

Not a scripted bot. A turn here is a *sequence* of decisions — summon, equip, flip a
trap, swing three times, pass — so the AI runs a beam search over whole-turn sequences,
scores the position each line arrives at, and plays the best one it found. It answers
trap windows by simulating both branches. It gets no special access: face-down cards on
your side of the field are scored as an average body, never their real stats.

**There is no difficulty setting.** It always plays at full strength — ten lines kept,
twenty-six moves considered at each step, three turns of lookahead, and it never settles
for second best. Weaker configurations exist in the code because the arena below needs
something to measure against, but nothing in the game ever selects one.

The depth is affordable because searching a single turn costs about a fifth of a second —
a twelfth of the time it is allowed: it plays out the turns that follow each of its dozen
best lines and scores where they actually lead, rather than where the board happens to
sit the instant it stops moving.

How much each extra turn is worth, at identical search width:

| Same width, different depth | |
|---|---|
| 3 turns vs no lookahead at all | **64.9% ± 8.8** over 240 games |
| 3 turns vs 1 turn | 53.9% ± 4.6 over 500 games |

The first is decisive: looking ahead at all is what matters. The second is
**not** — its interval is [49.3%, 58.5%], which still contains 50% (p ≈ 0.10).
The third turn is probably worth a few points, and the estimate came out
positive in two separate runs, but it has not been *proven* better than one
turn and is not presented as though it had. It stays because it costs
essentially nothing and has never measured worse.

**What makes it play well is the evaluation, not the search.** With 4000 Life Points and
3000 ATK monsters, a duel is decided in two or three connected attacks, so the position
is really a *race*: how many turns do I need to finish you, versus how many do you need
to finish me. The evaluation computes both clocks directly and scores the difference;
material is priced low on top of that, because a monster's worth is mostly already
expressed by the clock it puts you on.

That distinction is measurable. Over 320 mirrored games per matchup — every seed and
deck pair played from both seats:

| Matchup | |
|---|---|
| race evaluation vs the old material one, equal search width | 57.4% ± 8.2 |
| full-width search vs a one-ply greedy pick, same evaluation | 64.9% ± 7.5 |
| full strength vs 4 lines and one turn of lookahead | 68.2% ± 7.4 |
| full strength vs 1 line and none | 76.8% ± 6.6 |
| full strength vs random legal moves | 96.9% ± 2.7 |

Against the earlier evaluation, which added up ATK the way you would in a long game,
widening the search bought nothing outside the noise, and the widest configuration
actually *lost* to the middle one — the classic sign of searching hard over a badly
calibrated score. Both are fixed by the evaluation change alone.

```bash
npm run ai-arena -- --games 400   # forks one worker per core; prints 95% intervals
npx tsx scripts/ai-bench.ts       # fast tactical positions with one right answer
```

Confidence intervals are printed because they matter here: at 30 games a matchup is
±18%, which is wide enough to hide any real difference between two configurations, and
early tuning against numbers that noisy sent this AI down a blind alley.

## Tournament

Pick your duelist and seven rivals are drawn against you in a bracket of eight.
Quarter-final, semi-final, final; lose once and the run is over.

The other matches in your round are not decided by a dice roll — they are real duels,
played out headlessly by the same AI at the same full strength. One is simulated per
request, because a full-strength duel between two computers is about five seconds of
CPU and a whole round would never fit in a single call. The client nudges through the
same endpoint that steps the AI's own moves, so the bracket fills in while you watch.

Your own match is the one you play. Between rounds the bracket is the screen you are on,
and the 🏆 button in a duel takes you back to it mid-turn — nothing is conceded by
looking, the duel lives on the server.

```bash
npm run e2e-tournament -- http://localhost:3000 10 yugi --skilled
```

drives whole brackets over HTTP with the AI playing your seat too, which is the only way
the later rounds get exercised at all. It is also how the position-change loop was found:
a monster could be turned between Attack and Defence without limit, so a turn of legal
moves could go on for ever.

## How it is built

- **Next.js (App Router) + TypeScript + Tailwind**, deployed on Vercel.
- **`src/game/`** — the rules engine. Pure, deterministic, and shared by client and
  server: the same code that resolves a duel on the server also tells the interface
  which buttons should be enabled.
  - `types.ts` — the effect DSL (triggers, selectors, ~45 operations).
  - `effects/monsters.ts`, `effects/spells.ts` — the custom effect for every card.
  - `engine.ts` — summons, battle, triggers, trap windows, win conditions.
  - `autoplay.ts` — legal-move enumeration, used by the tests.
  - `ai.ts` — the computer opponent: evaluation, move generation, beam search.
- **`src/server/rooms.ts`** — duel rooms. A room may seat the computer instead of a
  second player; the client nudges `/api/room/[code]/ai` on a timer and the server plays
  one action per call, which is what paces the board so a human can follow it. The turn
  is searched once and cached on the room, so only the first action of a turn is slow.
- **`src/server/tournament.ts`** — the bracket that turns a solo room into a run of three
  duels. It rides on the same nudge endpoint: one simulated side match per call, so a
  round resolves across several requests instead of timing one out.
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
  layout and all rules text are drawn by us. The illustration fills the whole frame
  and the name and stats ride on tinted bands over it, rather than sitting in a window
  with the frame colour filling the rest: the crop is then set by the card's own 59:86
  shape alone, so it is identical on every card at every size — and a board of nine
  cards is nine illustrations rather than nine coloured rectangles.
- **Sound** — synthesised at runtime with the Web Audio API; no audio files.

## Working on it

```bash
npm install
npm run art      # download card artwork into public/art (also runs before build)
npm run dev

npm run sim 800  # play 800 random duels offline; reports rule errors + win rates
npm run rules    # targeted regressions for rules that were wrong once and must stay right
npm run audit    # resolve every card's effect in a built position and check what it did
npm run e2e      # drive two HTTP clients through full duels against a running server
npm run e2e-ai   # same, but one seat is the computer — exercises the whole vs-AI loop
npm run e2e-tournament -- http://localhost:3000 10 yugi --skilled   # whole brackets
npm run shots    # drive two desktop browsers and screenshot the whole flow
npm run iphone   # play a duel and a tournament on WebKit at both iPhone sizes, by tapping
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
