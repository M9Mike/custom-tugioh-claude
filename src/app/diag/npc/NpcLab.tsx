'use client';

/**
 * The bench for authoring somebody's face.
 *
 * `story-check` proves a conversation works and `handling` photographs the
 * controls; neither can tell you that a character does not look like himself.
 * That question is answered by staring at a head from four sides, and doing it
 * by walking the whole game — log in, build a duelist, cross the field — costs
 * a minute an iteration and shows the head at the size of a thumbnail.
 *
 * So this puts every NPC in `WORLD_NPCS` on a turntable at face height, lit the
 * way the field lights them, and draws four angles at once. One screenshot per
 * change, and the change is legible.
 *
 * Four views because three is not enough: the front sells the character, the
 * three-quarter is what you actually see while talking to him, the profile is
 * where a beard either has depth or does not, and the back is where generated
 * hair falls apart if it was only ever authored from the front.
 *
 *   /diag/npc          — heads
 *   /diag/npc?body=1   — the whole duelist, for silhouette and dress
 */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { WORLD_NPCS } from '@/story/npcs';
import { buildPremadeRig, type PremadeRig } from '@/components/story/premadeRig';

/** Angle round the head, in radians, and what it is for. */
const VIEWS: { label: string; yaw: number; top?: boolean }[] = [
  { label: 'front', yaw: 0 },
  { label: 'three-quarter', yaw: -0.7 },
  { label: 'profile', yaw: Math.PI / 2 },
  { label: 'back', yaw: Math.PI },
  /* Straight down. A head is not a circle — this one is half again deeper than
     it is wide — so anything built round it as a circle pokes out at the ears
     and buries itself in the forehead. The footprint is the only view that
     shows that, and it is the view that fixed it. */
  { label: 'above', yaw: 0, top: true },
];

const CELL = { w: 320, h: 420 };
/* Views wrap onto rows rather than running off to the right. A single row of
   five at pixel-ratio 2 asks for a 3200px drawing buffer, and the software
   rasteriser this runs on quietly stops drawing part way across — the fifth
   view came back black with no error anywhere. Three across is well inside it. */
const COLS = 3;

/** What the bench can tell you about a head, in the units accessories use. */
interface Measurement {
  id: string;
  /** Bone units per metre. */
  scale: number;
  height: number;
  boneY: number;
  topY: number;
  /** Skull height above the `Head` bone, in bone units. */
  skullBone: number;
  /** Model width in bone units — a sanity check on the scale. */
  widthBone: number;
  /** Per-material extents in `Head` bone space. The authoring numbers. */
  head: Map<string, THREE.Box3>;
}

export default function NpcLab({
  body,
  calib,
  bare,
  models,
  only,
}: {
  body: boolean;
  calib: boolean;
  bare: boolean;
  /** Model ids to cast each NPC on, for choosing a body. Empty = as written. */
  models: string[];
  /** One NPC id, when the whole field is too much to look at. */
  only: string;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [measure, setMeasure] = useState<Measurement[]>([]);

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    let disposed = false;
    const rigs: PremadeRig[] = [];
    /* Calibration meshes own their geometry and material; collected so the
       lab does not leak one set per hot reload. */
    const rings: THREE.Mesh[] = [];

    /* One subject per row-group: normally the NPCs as written, but when a cast
       list is given, the same NPC re-seated on each model in turn. Choosing a
       body is a comparison, and a comparison wants them side by side. */
    const people = only ? WORLD_NPCS.filter((n) => n.id === only) : WORLD_NPCS;
    const cast = models.length
      ? people.flatMap((npc) =>
          models.map((m) => ({ npc, character: { ...npc.character, model: m }, label: m }))
        )
      : people.map((npc) => ({ npc, character: npc.character, label: `${npc.id} · ${npc.character.model}` }));

    const viewRows = Math.ceil(VIEWS.length / COLS);
    const width = CELL.w * Math.min(COLS, VIEWS.length);
    const height = CELL.h * viewRows * cast.length;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(2);
    renderer.setSize(width, height, false);
    renderer.setScissorTest(true);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = `${width}px`;
    renderer.domElement.style.height = `${height}px`;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#6f7f96');

    /* The field's own lights, so a colour judged here is the colour that turns
       up in the grass. Copied deliberately rather than imported: OpenWorld
       builds them inside its mount effect, and a lab that reaches into a
       renderer to borrow them is a lab that breaks when the renderer changes. */
    const sun = new THREE.DirectionalLight('#fff2d8', 2.05);
    sun.position.set(4, 8, 5);
    sun.castShadow = true;
    scene.add(sun);
    scene.add(new THREE.HemisphereLight('#cfe0f2', '#3f5227', 0.95));
    /* A fill the field does not have, and this bench cannot do without.
       The sun sits front-right, which leaves the profile and the back of the
       head in shadow — the two views that exist precisely to check the shapes
       nobody sees from the front. Judge *colour* from the front view; the fill
       is here so the others show a silhouette at all. */
    const fill = new THREE.DirectionalLight('#dfe8f5', 0.75);
    fill.position.set(-5, 3, -4);
    scene.add(fill);

    const camera = new THREE.PerspectiveCamera(28, CELL.w / CELL.h, 0.05, 60);

    (async () => {
      for (const { npc, character } of cast) {
        const rig = await buildPremadeRig(character, {
          overrides: npc.overrides,
          /* `bare` is what the model actually gives you, before anybody
             dresses it: the honest starting point for fitting a head, and the
             only view in which the ruler is not hidden behind the thing being
             measured. */
          accessories: bare ? [] : npc.accessories,
        });
        if (disposed) {
          rig.dispose();
          return;
        }
        rigs.push(rig);
        scene.add(rig.root);
        rig.root.visible = false;

        /* The ruler.
           Accessories are authored in the `Head` bone's units, and nothing on
           screen says how big one of those is. These are rings of known radius
           and ticks of known height, parented to the same bone the accessories
           hang off, so a photograph of them *is* the measurement — read the
           skull against the rings and the constant is the answer. */
        if (calib) {
          let head: THREE.Object3D | null = null;
          rig.root.traverse((o) => {
            if ((o as THREE.Bone).isBone && o.name === 'Head') head = o;
          });
          if (head) {
            const marks = new THREE.Group();
            const dot = (x: number, y: number, z: number, colour: string, size = 0.006) => {
              const m = new THREE.Mesh(
                new THREE.SphereGeometry(size, 8, 6),
                new THREE.MeshBasicMaterial({ color: colour })
              );
              m.position.set(x, y, z);
              marks.add(m);
              rings.push(m);
            };
            /* A ladder up the front of the face in the accessories' *own*
               space, which is the only space that matters when placing one.
               Red every 0.10, white every 0.05. Read the eyes and the chin off
               this and the constants write themselves. */
            for (let i = -4; i <= 6; i++) {
              const y = i * 0.05;
              dot(0, y, 0.14, i % 2 === 0 ? '#ff3b3b' : '#ffffff', i % 2 === 0 ? 0.008 : 0.005);
            }
            /* Width and depth at the bone's own height: ±0.10 on each axis. */
            for (const d of [-0.1, -0.05, 0.05, 0.1]) {
              dot(d, 0, 0, '#4dff88', 0.006);
              dot(0, 0, d, '#4db4ff', 0.006);
            }
            (head as THREE.Object3D).add(marks);
          }
        }

        setReady((n) => n + 1);
      }
      if (disposed) return;

      /* One idle frame so the rig is in its rest pose rather than the T-pose
         the clips have not been applied to yet. */
      for (const rig of rigs) rig.update(0.016, 0, 0);

      /*
       * The head's real extent, in the units accessories are authored in.
       *
       * Reading it off a photograph against the calibration rings was tried
       * first and was wrong twice — a horizontal ring seen in perspective is a
       * poor ruler, and both the band and the beard ended up built *inside* the
       * skull because of it. This asks the geometry instead: skin every vertex,
       * keep the ones the `Head` bone actually drives, and express them in that
       * bone's own space. The answer is exact and takes a few milliseconds.
       */
      const headBox = (rig: PremadeRig): Map<string, THREE.Box3> => {
        /* Per material, because "the head" is several things wearing one bone:
           the skin an accessory must clear, and the hair it is replacing. A
           single box round both answers neither question. */
        const boxes = new Map<string, THREE.Box3>();
        rig.root.updateWorldMatrix(true, true);
        let head: THREE.Bone | null = null;
        rig.root.traverse((o) => {
          if ((o as THREE.Bone).isBone && o.name === 'Head') head = o as THREE.Bone;
        });
        if (!head) return boxes;
        const toBone = (head as THREE.Bone).matrixWorld.clone().invert();
        const v = new THREE.Vector3();
        rig.root.traverse((o) => {
          const mesh = o as THREE.SkinnedMesh;
          if (!mesh.isSkinnedMesh) return;
          const headIndex = mesh.skeleton.bones.indexOf(head as THREE.Bone);
          if (headIndex < 0) return;
          const name = Array.isArray(mesh.material)
            ? mesh.material[0]?.name
            : mesh.material?.name;
          if (!name) return;
          let box = boxes.get(name);
          if (!box) {
            box = new THREE.Box3();
            boxes.set(name, box);
          }
          const pos = mesh.geometry.getAttribute('position');
          const idx = mesh.geometry.getAttribute('skinIndex');
          const wgt = mesh.geometry.getAttribute('skinWeight');
          if (!idx || !wgt) return;
          for (let i = 0; i < pos.count; i++) {
            /* Only vertices this bone dominates: an accessory on the head must
               clear the head, not the shoulders the same mesh also contains. */
            let best = -1;
            let bestW = 0;
            for (let k = 0; k < 4; k++) {
              const w = wgt.getComponent(i, k);
              if (w > bestW) {
                bestW = w;
                best = idx.getComponent(i, k);
              }
            }
            if (best !== headIndex) continue;
            v.fromBufferAttribute(pos, i);
            mesh.applyBoneTransform(i, v);
            v.applyMatrix4(mesh.matrixWorld).applyMatrix4(toBone);
            box.expandByPoint(v);
          }
        });
        return boxes;
      };

      /* Measure the head rather than guessing at it.
         Accessories are authored in the `Head` bone's own units, and the only
         way to know what a metre is there is to ask: take the bone's world
         position, the top of the model above it, and the scale the rig applied.
         Every fitted constant in `accessories.ts` came off this readout. */
      setMeasure(
        rigs.map((rig, i) => {
          rig.root.updateWorldMatrix(true, true);
          let head: THREE.Bone | null = null;
          rig.root.traverse((o) => {
            if ((o as THREE.Bone).isBone && o.name === 'Head') head = o as THREE.Bone;
          });
          const box = new THREE.Box3().setFromObject(rig.root);
          const bone = head as THREE.Bone | null;
          const bonePos = bone ? bone.getWorldPosition(new THREE.Vector3()) : null;
          /* Bone-space units per metre: the uniform scale on the model group. */
          const k = rig.root.children[0]?.scale.x ?? 1;
          return {
            id: cast[i].label,
            scale: k,
            height: rig.height,
            boneY: bonePos ? bonePos.y : NaN,
            topY: box.max.y,
            /* How far the skull rises above the bone, in bone units — the
               number every offset in `accessories.ts` is a fraction of. */
            skullBone: bonePos ? (box.max.y - bonePos.y) / k : NaN,
            widthBone: (box.max.x - box.min.x) / k,
            head: headBox(rig),
          };
        })
      );

      renderer.setViewport(0, 0, width, height);
      renderer.setScissor(0, 0, width, height);
      renderer.clear();

      rigs.forEach((rig, row) => {
        for (const other of rigs) other.root.visible = false;
        rig.root.visible = true;

        /* Frame on the `Head` bone, never on the model's height.
           Height is the top of the *bounding box*, so an accessory that is too
           big pushes the camera up and off the face — which is exactly the
           moment you most need to see it. The bone does not move. */
        rig.root.updateWorldMatrix(true, true);
        let bone: THREE.Object3D | null = null;
        rig.root.traverse((o) => {
          if ((o as THREE.Bone).isBone && o.name === 'Head') bone = o;
        });
        const box = new THREE.Box3().setFromObject(rig.root);
        const boneY = bone
          ? (bone as THREE.Object3D).getWorldPosition(new THREE.Vector3()).y
          : rig.height * 0.85;
        /* Back off by the size of the head, not by a fixed distance.
           The vendored roster is realistically proportioned and 0.85m framed it
           well; the imported characters are game-chibi, with a head half again
           bigger on a shorter body, and the same distance put the camera inside
           an eyeball. What is above the neck is what wants framing. */
        const headRise = Math.max(0.12, box.max.y - boneY);
        const focusY = body ? rig.height * 0.5 : boneY + headRise * 0.42;
        const dist = body ? rig.height * 2.15 : headRise * 3.1;

        VIEWS.forEach((view, i) => {
          const x = (i % COLS) * CELL.w;
          /* WebGL's origin is bottom-left and the rows read top-down. */
          const cellRow = row * viewRows + Math.floor(i / COLS);
          const y = height - (cellRow + 1) * CELL.h;
          renderer.setViewport(x, y, CELL.w, CELL.h);
          renderer.setScissor(x, y, CELL.w, CELL.h);
          if (view.top) {
            /* Looking straight down, the default up vector is parallel to the
               view direction and `lookAt` degenerates to a black frame. Point
               up at the model's back so the render reads nose-up. */
            camera.up.set(0, 0, -1);
            camera.position.set(0, focusY + dist, 0);
          } else {
            camera.up.set(0, 1, 0);
            camera.position.set(Math.sin(view.yaw) * dist, focusY, Math.cos(view.yaw) * dist);
          }
          camera.lookAt(0, focusY, 0);
          renderer.render(scene, camera);
        });
      });

      mount.dataset.npcLab = 'drawn';
    })().catch((e: unknown) => {
      if (!disposed) setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      disposed = true;
      for (const rig of rigs) {
        scene.remove(rig.root);
        rig.dispose();
      }
      for (const r of rings) {
        r.geometry.dispose();
        (r.material as THREE.Material).dispose();
      }
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [body, calib, bare, models, only]);

  return (
    <main className="min-h-[100dvh] bg-[#141821] p-4 text-parchment">
      <h1 className="font-display text-lg text-brassbright">
        NPC faces {body ? '— whole duelist' : ''}
      </h1>
      <p className="mt-1 text-[11px] text-ptextdim">
        {VIEWS.map((v) => v.label).join(' · ')} — {ready} built
        {body ? '' : ' · ?body=1 for the silhouette'}
        {calib ? ' · ladder: red every 0.10, white every 0.05; green = ±x, blue = ±z' : ' · ?calib=1 for the ruler'}
        {bare ? ' · accessories off' : ' · ?bare=1 for the undressed head'}
        {models.length ? ` · cast on ${models.join(', ')}` : ' · ?models=hoodie,punk to compare bodies'}
        {only ? ` · only ${only}` : ' · ?only=yugi for one of them'}
      </p>
      {error && <p className="mt-2 text-xs text-red-300">failed: {error}</p>}
      <div ref={host} className="mt-3 overflow-auto" />
      <ul className="mt-2 text-[11px] text-ptextdim" data-measures>
        {measure.map((m, i) => (
          <li key={`${m.id}-${i}`}>
            {m.id} — height {m.height.toFixed(3)}m · bone/m {m.scale.toFixed(4)}
            {[...m.head.entries()]
              .filter(([, b]) => Number.isFinite(b.min.y))
              .map(([name, b]) => (
                <span key={name} className="ml-2 font-mono text-[10px] text-brass">
                  [{name} x±{Math.max(-b.min.x, b.max.x).toFixed(4)} y {b.min.y.toFixed(4)}…
                  {b.max.y.toFixed(4)} z {b.min.z.toFixed(4)}…{b.max.z.toFixed(4)}]
                </span>
              ))}
          </li>
        ))}
      </ul>
    </main>
  );
}
