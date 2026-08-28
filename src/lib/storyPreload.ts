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
 * just the browser's copy of the file. Parsing eight megabytes of Sarah is not
 * free either, and doing it here means it is not done at the door.
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
    const [rig, premade] = await Promise.all([
      import('@/components/story/premadeRig'),
      import('@/story/premade'),
      import('@/components/story/OpenWorld').catch(() => null),
      import('@/components/story/CharacterCreator').catch(() => null),
    ]).catch(() => [null, null] as const);

    if (!live) return;
    if (!rig || !premade) return finish();

    const models = premade.DUELIST_MODELS;
    /*
     * Progress by bytes, not by files.
     *
     * The catalogue runs from a 550 kB Joey to an 8.6 MB Sarah, so counting
     * files off would race to eighty per cent and then sit still — which reads
     * as a hang, and is the specific thing a number is there to prevent.
     *
     * A file's total is only known once its first progress event arrives, so
     * the denominator grows as the downloads get going. It is seeded with the
     * bytes already accounted for so the fraction never runs backwards past
     * what has genuinely been read.
     */
    const loaded = new Map<string, number>();
    const totals = new Map<string, number>();
    const tick = () => {
      if (!live) return;
      const got = [...loaded.values()].reduce((a, b) => a + b, 0);
      const all = models.reduce((sum, m) => sum + (totals.get(m.id) ?? loaded.get(m.id) ?? 0), 0);
      report({ phase: 'cast', pct: all > 0 ? Math.min(1, got / all) : 0 });
    };
    tick();

    await Promise.all(
      models.map((m) =>
        rig
          .loadDuelistTemplate(m.id, (got, total) => {
            loaded.set(m.id, got);
            /* `total` is 0 when the response carried no length — a proxy that
               re-encodes, mostly. Leaving it out of the denominator is better
               than putting a zero in it. */
            if (total > 0) totals.set(m.id, total);
            tick();
          })
          /* One bad file must not hold the other nine, or the door. */
          .catch(() => null)
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
