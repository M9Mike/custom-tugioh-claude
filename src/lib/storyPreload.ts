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
 * ## Why the sizes come from the catalogue and not from the server
 *
 * Progress has to be in bytes. The catalogue runs from a 564 kB Joey to a
 * 9.0 MB Sarah, so counted off by file the bar reaches forty per cent on four
 * duelists worth six per cent of the download.
 *
 * The first version of this asked the server and built the denominator out of
 * whatever had answered so far — which meant the four small ones finishing were
 * briefly the whole of what was known, the fraction came out at one, and the
 * bar read 100% for seven seconds while thirty-nine megabytes arrived behind a
 * number saying there was nothing left to do.
 *
 * Asking up front does not fix it, because the server will not say. These are
 * served Brotli-encoded, and a browser hides `content-length` from script
 * whenever `content-encoding` is set: the header is the encoded length and the
 * body handed to JS is not. A range request gives the encoded length too. And
 * the encoded length is not a usable substitute, because progress events count
 * *decoded* bytes and the ratio is nothing like constant — Sarah compresses to
 * 77%, Joey to 33%, so the same denominator is wrong by a different amount for
 * every file.
 *
 * So each model's size is written down beside it in `premade.ts`, which is a
 * fact about the file that is perfectly well known at build time and only
 * unavailable at runtime. `npm run models` fails if one drifts, and this widens
 * a file's share on its own if the bytes overrun what was declared.
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
/*
 * The cast phases are still in the type and the button still knows how to
 * draw them, because a model *is* still loaded before a screen that needs it —
 * it just is not this screen's job any more. Nothing reports them today.
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
     * The code, and only the code.
     *
     * Two megabytes of three.js, the rig, the world builders and the booth —
     * which is what makes pressing the button walk you in rather than hand you
     * a spinner while a route change waits on a dynamic import.
     */
    const loaders = await Promise.all([
      import('@/components/story/premadeRig'),
      import('@/story/premade'),
      import('@/components/story/OpenWorld').catch(() => null),
      import('@/components/story/CharacterCreator').catch(() => null),
    ]).catch(() => null);

    if (!live) return;
    if (!loaders) return finish();

    /*
     * And the cast is *not* fetched here. That is the whole of this change.
     *
     * It used to be: every `.glb` in the catalogue, downloaded and parsed,
     * before the door would open. The reasoning was sound when there were
     * twelve of them and the world was drawn out of a canvas — the wait moved
     * to the menu, where somebody is reading, instead of into the first field.
     *
     * Then the cast grew to seventeen and every one of them carries a 4096²
     * texture, which decodes to about sixty-seven megabytes whatever the ten
     * megabyte file suggests. Sitting on the main menu with nothing open, this
     * page held all seventeen: measured on the phone-sized viewport against
     * production, the heap went 112 MB → 230 MB and kept everything, because a
     * parsed template is cached for the life of the page. On a desktop that is
     * invisible. On Mike's phone iOS killed the tab, Safari reloaded it, it was
     * killed again, and he got "A problem repeatedly occurred" before he had
     * pressed anything.
     *
     * So the menu warms the *code* — three.js, the rig, the builders, a couple
     * of megabytes, which is what makes the button open into the booth or the
     * field rather than into a spinner — and every model is loaded by whoever
     * actually needs it: the booth as it shows a face, the world as it builds
     * an area, and both of them behind a screen that already says it is
     * waiting. A phone then holds one room's worth of people instead of a city.
     *
     * The catalogue is still imported above: it is kilobytes of JSON, it is
     * what the world reads a model's height and speeds out of, and having it
     * warm costs nothing.
     */
    clearTimeout(timer);
    finish();
  })();

  return () => {
    live = false;
    clearTimeout(timer);
  };
}
