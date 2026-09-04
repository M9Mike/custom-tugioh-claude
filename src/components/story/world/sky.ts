/**
 * One area's share of the sky, and everything in it that answers to the hour.
 *
 * Every builder used to hand-roll three lights — a directional, a hemisphere
 * and an ambient — with its own colours and its own shadow camera, and then a
 * handful of `PointLight`s for the lamps. That was right when there was one
 * hour in the day. With a cycle it is nineteen lights across six areas that all
 * have to agree about what time it is, which is a thing to own in one place.
 *
 * So a builder says where its key light stands and how far its shadows have to
 * reach, registers its lamps, and stops thinking about it. `apply` is called
 * once a frame from `OpenWorld` with the hour, and everything follows.
 *
 * ## What the key light is
 *
 * One directional light, not two. The sun and the moon are never both up in
 * this city, and a second rig that is off for two thirds of the day is a shadow
 * map's worth of memory doing nothing — so it is one light whose colour,
 * intensity and direction are whatever `skyAt` says. It swings from east at
 * dawn through south at noon to west at dusk, and at night it is a cool
 * north-easterly moon, which is where this world's shadows have always come
 * from.
 *
 * ## What the lamps do
 *
 * They go out. A street lamp burning at noon is the single most obvious way to
 * say "this is a night scene with the brightness turned up", so a registered
 * lamp keeps its authored intensity as a maximum and is scaled by the hour —
 * and the glowing box that stands for its glass is dimmed with it, because an
 * unlit material ignores every light in the scene and would otherwise stay lit
 * on its own.
 */

import * as THREE from 'three';
import { skyAt, type SkyProfile } from '@/story/sky';
import type { Owned } from './kit';

export interface SkyOptions {
  /** How far out to stand the key light. Big areas want it further. */
  reach: number;
  /** What the shadow camera has to cover, in metres either side. */
  half: number;
  deep: number;
  /** Where the light points. Defaults to the area's origin. */
  target?: [number, number, number];
  /**
   * `normalBias`, which is one shadow texel — see `market.ts` for why it must
   * be one and not two, and `shrine.ts` for what it costs when it is.
   */
  normalBias: number;
  /**
   * How much of the sky reaches this place.
   *
   * A shōtengai under a roof takes a quarter of what an open shrine precinct
   * does, and the difference is a fact about the area rather than about the
   * hour — so it is a gain here and not four more keyframes. `gain` is the key
   * light, `fill` the hemisphere and ambient with it; the two move separately
   * because a covered street loses its sun long before it loses its skylight.
   */
  gain?: number;
  fill?: number;
  /**
   * What is over your head, when it is not the sky.
   *
   * Market Row is a shōtengai under a painted metal canopy a metre and a half
   * above its lamps: the light coming down in there is the pendants' own,
   * returned warm, and giving it a blue sky term is what makes an interior look
   * like an exterior with the lights off. So those areas name their own
   * hemisphere and only the *level* follows the hour.
   */
  hemi?: { sky: string; ground: string };
  /**
   * A key light that does not swing.
   *
   * Indoors the light does not come from where the sun is, it comes from where
   * the window is — so the shop names a position and only the colour and the
   * level follow the hour. Which is the whole effect: the same room, blue at
   * dawn, warm at four, and lit by its own pendants after dark.
   */
  fixedKey?: [number, number, number];
  /**
   * Inside.
   *
   * Two things follow from it: the sky reaches almost nothing and the room's own
   * fill does the work, and the lamps *stay on*. A shop with its lights off at
   * noon is a shut shop, and the pendants over the counter are not street
   * lighting.
   */
  indoor?: boolean;
}

export class Sky {
  readonly key: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly amb: THREE.AmbientLight;
  private readonly reach: number;
  private readonly indoor: boolean;
  private readonly gain: number;
  private readonly fill: number;
  private readonly hemiOverride?: { sky: string; ground: string };
  private readonly fixedKey?: [number, number, number];
  private readonly root: THREE.Group;
  private readonly own: Owned;
  private readonly lamps: { light: THREE.PointLight; full: number }[] = [];
  private readonly kept = new Set<THREE.Object3D>();
  private readonly glows: { at: THREE.Color; was: THREE.Color }[] = [];

  constructor(own: Owned, root: THREE.Group, o: SkyOptions) {
    LIVE.add(this);
    this.own = own;
    this.reach = o.reach;
    this.indoor = o.indoor ?? false;
    this.gain = o.gain ?? 1;
    this.fill = o.fill ?? 1;
    this.hemiOverride = o.hemi;
    this.fixedKey = o.fixedKey;
    this.root = root;

    this.key = new THREE.DirectionalLight('#ffffff', 1);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.camera.left = -o.half;
    this.key.shadow.camera.right = o.half;
    this.key.shadow.camera.top = o.deep;
    this.key.shadow.camera.bottom = -o.deep;
    this.key.shadow.camera.near = 1;
    this.key.shadow.camera.far = o.reach * 2.6;
    this.key.shadow.bias = -0.0009;
    this.key.shadow.normalBias = o.normalBias;
    const t = o.target ?? [0, 0, 0];
    this.key.target.position.set(t[0], t[1], t[2]);
    root.add(this.key);
    root.add(this.key.target);

    this.hemi = new THREE.HemisphereLight('#ffffff', '#ffffff', 1);
    this.amb = new THREE.AmbientLight('#ffffff', 1);
    root.add(this.hemi);
    root.add(this.amb);
  }

  /**
   * A lamp that goes out in daylight.
   *
   * `glow` is the material of whatever stands for its lit glass. Those are
   * `MeshBasicMaterial`, which is unlit by definition — so nothing about the
   * sky touches them and they have to be dimmed by hand or the city keeps a
   * hundred little windows burning at noon.
   */
  lamp(light: THREE.PointLight): THREE.PointLight {
    this.lamps.push({ light, full: light.intensity });
    return light;
  }

  /**
   * A lamp that does not go out.
   *
   * Every lamp in this world so far has been street lighting, and street
   * lighting is off at noon — that rule is what stops a night scene being a day
   * scene with the brightness turned up. A covered building breaks it: the
   * gallery under Domino Station's roof is in the shade of eleven thousand
   * square metres of sheet at every hour there is, and the four brackets along
   * its wall burn all day for exactly the reason the ticket office's does.
   *
   * `claim` skips these, so they keep whatever the builder gave them.
   */
  burning(light: THREE.PointLight): THREE.PointLight {
    this.kept.add(light);
    return light;
  }

  /**
   * Every lamp in the area, found rather than registered.
   *
   * Called once at the end of a builder. An area has between four and thirty
   * `PointLight`s written in ones and twos across a thousand lines — a pendant
   * here, a window spill there, a votive in a grove — and asking each one to
   * remember to sign up is asking for the one that does not, which burns at
   * noon and is the whole tell. They are all in the group by then, so walking
   * it is both complete and impossible to forget.
   */
  claim(): void {
    this.lamps.length = 0;
    this.root.traverse((o) => {
      if ((o as THREE.PointLight).isPointLight && !this.kept.has(o)) {
        const l = o as THREE.PointLight;
        this.lamps.push({ light: l, full: l.intensity });
      }
    });
  }

  /** Everything, at an hour. */
  apply(hour: number): SkyProfile {
    const p = skyAt(hour);
    if (this.fixedKey) {
      this.key.position.set(this.fixedKey[0], this.fixedKey[1], this.fixedKey[2]);
    } else {
      const [kx, ky, kz] = p.key;
      const len = Math.hypot(kx, ky, kz) || 1;
      this.key.position.set(
        (kx / len) * this.reach,
        (ky / len) * this.reach,
        (kz / len) * this.reach
      );
    }
    this.key.color.set(p.keyColour);
    /* Indoors the sky is what comes through the windows, which is a fraction of
       what falls on a street — and the room's own lamps do the rest. */
    this.key.intensity = p.keyIntensity * this.gain * (this.indoor ? 0.4 : 1);
    this.hemi.color.set(this.hemiOverride?.sky ?? p.skyColour);
    this.hemi.groundColor.set(this.hemiOverride?.ground ?? p.groundColour);
    this.hemi.intensity = p.hemiIntensity * this.fill * (this.indoor ? 0.7 : 1);
    this.amb.color.set(p.ambientColour);
    this.amb.intensity = p.ambientIntensity * this.fill * (this.indoor ? 1.6 : 1);

    /* Indoors nothing goes out: see `indoor` above. */
    if (this.indoor) return p;

    for (const l of this.lamps) l.light.intensity = l.full * p.lamps;

    /*
     * And every unlit material in the area with it.
     *
     * Picked up from `Owned` rather than registered one at a time, because they
     * are written in ones and twos across hundreds of lines and an area that
     * misses one keeps a window burning at noon. Down to a fifth rather than to
     * nothing: lit glass in daylight is a pale panel, not a black one.
     */
    if (this.glows.length !== this.own.glows.length) {
      this.glows.length = 0;
      for (const m of this.own.glows) this.glows.push({ at: m.color, was: m.color.clone() });
    }
    const k = 0.2 + 0.8 * p.lamps;
    for (const g of this.glows) g.at.copy(g.was).multiplyScalar(k);
    return p;
  }

  dispose() {
    LIVE.delete(this);
    this.key.shadow?.map?.dispose();
    for (const l of this.lamps) l.light.shadow?.map?.dispose();
  }

  /** The key's shadow map, re-made at another size on the next frame. */
  shadowSize(size: number) {
    if (this.key.shadow.mapSize.x === size) return;
    this.key.shadow.mapSize.set(size, size);
    this.key.shadow.map?.dispose();
    this.key.shadow.map = null;
  }

}

/** Every sky standing, so the renderer's governor can reach the shadow maps. */
const LIVE = new Set<Sky>();

/**
 * Smooth beats sharp.
 *
 * Levels 0 and 1 keep the 2048 shadow map and give up pixels; 2 and 3 halve
 * the map as well. Called by the world's governor when frames run long — on a
 * phone that has been walking the city for five minutes and is warm — and
 * again on the way back up when they run short.
 */
export function setShadowQuality(level: number) {
  const size = level >= 2 ? 1024 : 2048;
  for (const sky of LIVE) sky.shadowSize(size);
}

/** Kept so `Owned` stays the one place that knows how to let go of things. */
export function ownSky(own: Owned, sky: Sky): Sky {
  own.keep({ dispose: () => sky.dispose() });
  return sky;
}
