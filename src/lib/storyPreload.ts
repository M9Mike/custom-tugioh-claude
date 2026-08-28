/**
 * Everything Story Mode needs, fetched before the door opens.
 *
 * ## Why the home page pays for this
 *
 * Story Mode is the only part of this game with a WebGL renderer in it, and
 * `StoryMode.tsx` deliberately pulls the 3D screens in with `next/dynamic` so
 * that renderer stays off the home page and out of the duel board. That is the
 * right shape for the bundle and the wrong shape for the moment you press the
 * button: the chunk starts downloading *then*, three.js and every world builder
 * arrive after the route has already changed, and the first thing the player
 * sees of the story is a card that says "Walking out into the field…" while
 * forty megabytes of duelists come down the wire behind it.
 *
 * So the download happens while they are still looking at the menu, and the way
 * in is closed until it is finished. Nothing about the split changes — the home
 * page still does not *import* any of it, it only asks for it early.
 *
 * ## What "everything" is
 *
 * Two things, and they are very different sizes.
 *
 * The code: the character booth and the open world, which between them drag in
 * three.js, the rig, and every area in the city. A couple of megabytes.
 *
 * The cast: every `.glb` in the catalogue, which is nearly forty. These are the
 * real wait, so they are the ones with a number on them. They are loaded
 * through `loadDuelistTemplate`, not merely fetched, so what is warm afterwards
 * is the *parsed* model — the geometry, the skeleton and the clips — and not
 * just the browser's copy of the file.
 *
 * ## Why the sizes are asked for first
 *
 * Because progress has to be in bytes, and bytes are not known until somebody
 * says so.
 *
 * The catalogue runs from a 183 kB Joey to a 6.8 MB Sarah. Counted off by file
 * the bar would reach forty per cent on four duelists worth three per cent of
 * the download. Counted in bytes but with only the files that have *reported* a
 * length in the denominator, it does something worse: the four small ones
 * finish, they are the whole of what is known, and the bar reads 100% — and
 * then stands there for seven seconds while the real thirty-nine megabytes
 * arrive behind a number that says there is nothing left to do. Which is the
 * one thing a number is there to prevent, and is exactly what it did on the
 * first deploy of this file.
 *
 * So: a HEAD apiece before anything starts, one round trip, all ten in
 * parallel. After that the denominator is the truth from the first frame.
 *
 * ## And the second of silence at the end
 *
 * The bytes are not the whole wait. Ten models still have to be *parsed* into
 * geometry and skeletons and clips, which on this machine is another second or
 * so after the last byte — and there is no progress event for it, so a byte
 * bar can only sit at 100% through it. That gets its own phase and its own
 * words rather than a full bar that is not finished.
 *
 * ## What happens when it does not work
 *
 * The button opens anyway. A preload is an optimisation, and an optimisation
 * that can permanently lock a player out of the game is a fault however well it
 * usually works — a dropped connection, a blocked request, a file that 404s
 * after a bad deploy. Every failure here resolves rather than rejects, and
 * there is a ceiling on the whole thing regardless (`GIVE_UP_AFTER`), because
 * the alternative is a menu that never lets anybody in.
 */

/** Where the preload has got to. */
export type StoryPreload =
  | { phase: 'code' }
  | { phase: 'cast'; pct: number }
  | { phase: 'parse' }
  | { phase: 'ready' };

/**
 * The longest the door stays shut.
 *
 * Generous, because on a phone connection forty megabytes genuinely takes about
 * this long and giving up early wastes the wait rather than saving it. But not
 * unbounded: past this the player gets in and loads what they need on the way,
 * which is exactly what the game did before any of this existed.
 */
const GIVE_UP_AFTER = 90_000;

/**
 * How big a file says it is, or null if it will not say.
 *
 * Two ways of asking, because one of them stops working the moment anything
 * compresses the response: a browser hides `content-length` from script when
 * `content-encoding` is set, since the number is the encoded length and the
 * body handed to JS is not. The Next dev server gzips these, so locally the
 * header is simply not there — while production serves them raw, `.glb` being
 * compressed already, and the header is exact.
 *
 * So if the header is missing, ask for one byte and read the total off
 * `content-range`. That works wherever ranges do, and costs a byte. It is only
 * used on a 206: a server that ignores `Range` answers 200 with the entire
 * file, and downloading everything twice to find out how big it is would be a
 * poor trade.
 */
async function askSize(url: string): Promise<number | null> {
  const ok = (n: number | null) => (n !== null && Number.isFinite(n) && n > 0 ? n : null);
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const len = ok(Number(head.headers.get('content-length')));
    if (len !== null) return len;
  } catch {
    /* fall through to the range */
  }
  try {
    const part = await fetch(url, { headers: { Range: 'bytes=0-0' } });
    if (part.status !== 206) return null;
    const range = part.headers.get('content-range');
    return ok(range ? Number(range.split('/')[1]) : null);
  } catch {
    return null;
  }
}

export function preloadStory(report: (p: StoryPreload) => void): () => void {
  let live = true;
  const finish = () => {
    if (!live) return;
    live = false;
    report({ phase: 'ready' });
  };

  const timer = setTimeout(finish, GIVE_UP_AFTER);

  void (async () => {
    report({ phase: 'code' });

    /*
     * The code first, and on its own.
     *
     * Not because it is bigger — it is a twentieth of the size — but because
     * `loadDuelistTemplate` lives inside it. Asking for the models means having
     * the loader, so this is a dependency and not a preference.
     */
    const loaders = await Promise.all([
      import('@/components/story/premadeRig'),
      import('@/story/premade'),
      import('@/components/story/OpenWorld').catch(() => null),
      import('@/components/story/CharacterCreator').catch(() => null),
    ]).catch(() => null);

    if (!live) return;
    if (!loaders) return finish();
    const [rig, premade] = loaders;

    const models = premade.DUELIST_MODELS;
    report({ phase: 'cast', pct: 0 });

    /*
     * Every size before any download. A file that will not give one is carried
     * at the average of those that did, so it still occupies about its share of
     * the bar instead of nothing at all.
     */
    const sizes = await Promise.all(models.map((m) => askSize(m.file)));
    if (!live) return;
    const known = sizes.filter((n): n is number => n !== null);
    const guess = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
    const size = models.map((_, i) => sizes[i] ?? guess);
    const all = size.reduce((a, b) => a + b, 0);

    const loaded = new Map<string, number>();
    /* Counted from the progress events rather than from the promises, because
       a promise resolves after its model is *parsed* — which is the very wait
       the parse phase exists to cover. */
    const arrived = new Set<string>();
    const tick = () => {
      if (!live) return;
      if (arrived.size >= models.length) return report({ phase: 'parse' });
      const got = [...loaded.values()].reduce((a, b) => a + b, 0);
      report({ phase: 'cast', pct: Math.min(1, got / all) });
    };

    await Promise.all(
      models.map((m, i) =>
        rig
          .loadDuelistTemplate(m.id, (got, total) => {
            /* `total` is 0 when the response carried no length. The HEAD above
               is the number that matters; this one is only used to notice that
               a file has finished arriving. */
            loaded.set(m.id, Math.min(got, size[i]));
            if (got >= (total || size[i])) arrived.add(m.id);
            tick();
          })
          /* One bad file must not hold the other nine, or the door. */
          .catch(() => null)
          .then(() => {
            /* A model served from cache may emit no progress at all. */
            arrived.add(m.id);
            loaded.set(m.id, size[i]);
            tick();
          })
      )
    );

    clearTimeout(timer);
    finish();
  })();

  return () => {
    live = false;
    clearTimeout(timer);
  };
}
