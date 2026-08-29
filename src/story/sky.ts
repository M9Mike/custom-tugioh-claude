/**
 * What the light is doing, at any hour of the day.
 *
 * No three.js in here, exactly like `areas.ts`: this file says what a moment in
 * Domino City *is* — how high the sun is, what colour it is, whether the lamps
 * are burning, how far you can see. What that looks like is
 * `components/story/world/sky.ts`, and the two are kept apart so that moving
 * dawn half an hour earlier is editing a number.
 *
 * ## Why the whole city was stuck at dusk
 *
 * Because it was authored there. Every area's light rig was a cool moon, a
 * warm lamp or two and a hemisphere, and every material in the world was picked
 * "a stop lighter than daylight would have it" — which is right at night, when
 * a material's colour is nearly all of what you see of it, and wrong at noon,
 * when the sun is.
 *
 * That does not mean the materials have to change. The renderer runs ACES
 * filmic tone mapping, so a brighter key does not clip — it rolls off — and the
 * exposure trim below is what keeps a palette chosen for lamplight from going
 * chalky under a sun. One number, applied globally, instead of two colours per
 * material across six areas.
 *
 * ## The shape of a day
 *
 * A long day and a short night, which is what a game wants rather than what a
 * planet does: you are here to look at the city, and half of a real cycle spent
 * unable to see it is half of it wasted. Dawn and dusk are given real width
 * because they are the best-looking part and the part this world was already
 * built for.
 */

/** How long a whole day takes, in real minutes. */
export const DAY_MINUTES = 18;

/** The hour the world starts at when nothing says otherwise: mid-morning. */
export const DEFAULT_HOUR = 9.5;

export interface SkyProfile {
  /** 0 at midnight, 12 at noon. */
  hour: number;
  /**
   * Which way the key light comes from, as a direction out from the area.
   *
   * A direction and not a position: an area sets how far away to put it, since
   * a shadow camera that covers ninety metres wants its light further out than
   * one covering eleven.
   */
  key: [number, number, number];
  keyColour: string;
  keyIntensity: number;
  /** How dark a shadow gets. Full sun casts hard shadows; an overcast dusk does not. */
  shadowOpacity: number;
  skyColour: string;
  groundColour: string;
  hemiIntensity: number;
  ambientColour: string;
  ambientIntensity: number;
  /**
   * What is beyond the edge of an area: the background, and what the fog fades
   * into. Black at night, which is the whole reason the fog exists; a real sky
   * by day, which is better than black and costs nothing.
   */
  voidColour: string;
  fogNear: number;
  fogFar: number;
  /** 0 = every lamp out, 1 = every lamp at full. */
  lamps: number;
  /** The global exposure trim. See the note above on why this exists. */
  exposure: number;
}

/** Linear blend between two `#rrggbb`. */
function mix(a: string, b: string, t: number): string {
  const p = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  const c = (i: number) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t);
  return '#' + [0, 1, 2].map((i) => c(i).toString(16).padStart(2, '0')).join('');
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The four moments a day is built out of, and the hour each is centred on.
 *
 * Everything between them is a straight blend. Four is enough because the two
 * that matter — dawn and dusk — are the transitions themselves, and a curve
 * through more points would be an accuracy nobody can see.
 */
const KEYFRAMES: { at: number; p: Omit<SkyProfile, 'hour'> }[] = [
  {
    /* Deep night. The world as it has been until now. */
    at: 1,
    p: {
      key: [0.45, 0.82, 0.35],
      keyColour: '#93a7c4',
      /*
       * The gains each area passes are about *enclosure* — how much sky a
       * street between terraces sees against an open precinct — and not about
       * how bright night was. Read the other way round they scale the day down
       * with the night, which is how Turtle Lane came out at noon looking like
       * Turtle Lane at nine. So the gains went up to what they describe and the
       * moon came down to keep the night where it was.
       */
      keyIntensity: 0.95,
      shadowOpacity: 0.55,
      skyColour: '#5a6f92',
      groundColour: '#4a4136',
      hemiIntensity: 1.2,
      ambientColour: '#48536b',
      ambientIntensity: 0.5,
      voidColour: '#000000',
      fogNear: 34,
      fogFar: 78,
      lamps: 1,
      exposure: 1.0,
    },
  },
  {
    /* Dawn: the sun on the horizon in the east, lamps going out. */
    at: 6,
    p: {
      key: [0.94, 0.2, 0.28],
      keyColour: '#ffb073',
      keyIntensity: 1.5,
      shadowOpacity: 0.7,
      skyColour: '#8f9dc0',
      groundColour: '#6b5c48',
      hemiIntensity: 1.5,
      ambientColour: '#7e7f96',
      ambientIntensity: 0.55,
      voidColour: '#5c5566',
      fogNear: 40,
      fogFar: 110,
      lamps: 0.45,
      exposure: 0.9,
    },
  },
  {
    /* Noon. The only time anything here is lit from overhead. */
    at: 12.5,
    p: {
      key: [0.16, 1, 0.42],
      keyColour: '#fff2dc',
      /*
       * Two point one, not two point five.
       *
       * Every material in this world was picked "a stop lighter than daylight
       * would have it" because at night the colour is nearly all of what you
       * see. Put a full sun on a palette chosen that way and the shrine's pale
       * gravel goes to paper — which is exactly what 2.5 with an exposure of
       * 0.8 did. The pair below is what keeps a lamplight palette readable at
       * noon without re-tinting six areas' worth of it.
       */
      keyIntensity: 2.1,
      shadowOpacity: 1,
      skyColour: '#a6c4e6',
      groundColour: '#8d8574',
      hemiIntensity: 1.55,
      ambientColour: '#b4c4d8',
      ambientIntensity: 0.5,
      voidColour: '#93aecb',
      fogNear: 55,
      fogFar: 150,
      lamps: 0,
      exposure: 0.74,
    },
  },
  {
    /* Dusk in the west, which is the hour this city was designed at. */
    at: 18.5,
    p: {
      key: [-0.9, 0.24, 0.34],
      keyColour: '#ffa462',
      keyIntensity: 1.45,
      shadowOpacity: 0.75,
      skyColour: '#7d86ab',
      groundColour: '#6a5a45',
      hemiIntensity: 1.4,
      ambientColour: '#6e7189',
      ambientIntensity: 0.55,
      voidColour: '#3b3547',
      fogNear: 38,
      fogFar: 96,
      lamps: 0.6,
      exposure: 0.98,
    },
  },
];

/**
 * The light at a given hour.
 *
 * Wraps, so 23.5 blends into the 1 o'clock keyframe the short way round rather
 * than running backwards through the whole day.
 */
export function skyAt(hour: number): SkyProfile {
  const h = ((hour % 24) + 24) % 24;
  let lo = KEYFRAMES[KEYFRAMES.length - 1];
  let hi = KEYFRAMES[0];
  for (let i = 0; i < KEYFRAMES.length; i++) {
    const a = KEYFRAMES[i];
    const b = KEYFRAMES[(i + 1) % KEYFRAMES.length];
    const span = (b.at - a.at + 24) % 24;
    const into = (h - a.at + 24) % 24;
    if (into <= span) {
      lo = a;
      hi = b;
      break;
    }
  }
  const span = (hi.at - lo.at + 24) % 24 || 24;
  const t = ((h - lo.at + 24) % 24) / span;
  const a = lo.p;
  const b = hi.p;
  return {
    hour: h,
    key: [0, 1, 2].map((i) => lerp(a.key[i], b.key[i], t)) as [number, number, number],
    keyColour: mix(a.keyColour, b.keyColour, t),
    keyIntensity: lerp(a.keyIntensity, b.keyIntensity, t),
    shadowOpacity: lerp(a.shadowOpacity, b.shadowOpacity, t),
    skyColour: mix(a.skyColour, b.skyColour, t),
    groundColour: mix(a.groundColour, b.groundColour, t),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, t),
    ambientColour: mix(a.ambientColour, b.ambientColour, t),
    ambientIntensity: lerp(a.ambientIntensity, b.ambientIntensity, t),
    voidColour: mix(a.voidColour, b.voidColour, t),
    fogNear: lerp(a.fogNear, b.fogNear, t),
    fogFar: lerp(a.fogFar, b.fogFar, t),
    lamps: lerp(a.lamps, b.lamps, t),
    exposure: lerp(a.exposure, b.exposure, t),
  };
}

/**
 * What time it is, from a wall clock.
 *
 * Derived rather than stored, so that the hour is the same in every area and
 * survives walking through a door, a reload, and the world being rebuilt —
 * without a single byte of save state. `pinned` is for the checks: a sweep that
 * compares two frames a millimetre apart cannot have the sun move between them.
 */
export function hourFrom(nowMs: number, pinned?: number | null): number {
  if (pinned !== null && pinned !== undefined && Number.isFinite(pinned)) return pinned;
  const day = DAY_MINUTES * 60_000;
  return (DEFAULT_HOUR + ((nowMs % day) / day) * 24) % 24;
}
