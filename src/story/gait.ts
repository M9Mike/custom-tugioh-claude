/**
 * How fast anybody moves, and what their legs do about it.
 *
 * Three numbers and one function, in a file with no dependencies, because
 * every one of them is read from more than one place and the last time two of
 * those places disagreed Tina sprinted the length of Market Row at walking
 * pace. The renderer moves bodies, the rig picks their clips and `npm run
 * roam` judges a route — and all three have to mean the same thing by "fast".
 */

/**
 * Top speed, in metres a second — what a full stick gets you.
 *
 * It is the Run clip's own ground coverage, near enough: the roster's runs are
 * rated 3.24 to 3.30, so at a full stick the feet land where the clip says
 * they land and the playback rate sits on 1 instead of being dragged under it.
 * Half a stick is 1.65, which is a brisk walk.
 *
 * It is one number rather than each model's own `runSpeed` because the field
 * has to feel the same whoever you picked; the 0.06 spread across the roster is
 * well inside what a cross-fade hides.
 */
export const TOP_SPEED = 3.3;

/**
 * Where the rig crosses from Walk to Run, as a fraction of `TOP_SPEED`.
 *
 * `premadeRig` eases the Run clip in across this band, so anything under
 * `RUN_BLEND_FROM` is a walk with no Run in it at all — 2.05 m/s on the ground.
 * A route faster than that is a character who runs everywhere, which is the
 * fault these two numbers exist to make checkable.
 */
export const RUN_BLEND_FROM = 0.62;
export const RUN_BLEND_TO = 0.92;

/** The ground speed at which a body starts to run. */
export const RUN_FROM = TOP_SPEED * RUN_BLEND_FROM;

/**
 * The stride an NPC's legs are given for a ground speed.
 *
 * The same scale the player's legs are read on — `stride` means "fraction of
 * `TOP_SPEED`" and the Run blend above was tuned against it. Dividing an NPC's
 * speed by "a nominal walk" instead put a 1.15 m/s amble three quarters into
 * the Run clip, with the ground going past at half the speed her feet were
 * selling.
 *
 * The floor is the other half of it. A drift of 0.6 m/s is 0.18 of top speed
 * and the rig eases *moving* in across 0.03–0.3, so a spirit gliding down an
 * avenue would get a half-weight walk over a half-weight idle: legs at half
 * amplitude and feet that slide. Anybody actually walking reads as walking, and
 * how fast they are walking is the clip's own playback rate, off the real
 * ground speed.
 */
export function npcGait(speed: number): number {
  if (speed <= 0.01) return 0;
  return Math.max(0.32, Math.min(1, speed / TOP_SPEED));
}
