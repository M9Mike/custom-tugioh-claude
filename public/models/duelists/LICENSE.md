# Duelist models — provenance and license

The twelve characters in this directory are the "Individual Characters"
(glTF) from two packs by **Quaternius**, retrieved 2026-08-11 from the packs'
official download folders:

- **Ultimate Modular Men Pack** (`m_*.glb`) —
  https://quaternius.com/packs/ultimatemodularcharacters.html
  (Drive folder 1USAAquX2JJWuA2m6zol0KUkFe3UkZ8zX)
- **Ultimate Modular Women Pack** (`w_*.glb`) —
  https://quaternius.com/packs/ultimatemodularwomen.html
  (Drive folder 1720N9IGyQHXYvtvZJzazhxtTTlz-y2Vf)

License, as stated by each pack's own `License.txt` (identical in both):

> Ultimate Modular Males by @Quaternius
> Consider supporting me on Patreon, even $1 helps me a lot!
>
> https://www.patreon.com/quaternius
>
> License:
> CC0 1.0 Universal (CC0 1.0)
> Public Domain Dedication
> https://creativecommons.org/publicdomain/zero/1.0/

CC0 means no attribution is required; this file exists so the *next* person
knows exactly where these came from, under what terms, and what was changed.

What was changed:

1. The packs' `Individual Characters/glTF/*.gltf` files (JSON with one
   embedded base64 buffer each) were repacked into binary `.glb` containers.
2. Animation clips the game has no path to were removed to keep the download
   light (gltf-transform: drop clip, prune orphaned accessors). The clips
   kept aboard every file are: Idle, Idle_Neutral, Walk, Run, Wave, Interact,
   Sword_Slash, Punch_Left, Punch_Right, HitRecieve, HitRecieve_2, Roll,
   Death. Dropped: the Gun_* family, Idle_Sword, Idle_Gun*, Kick_*, and the
   directional Run_* variants. Geometry, rig, materials and the kept clips
   are byte-equivalent in content to the originals.

`scripts/premade-audit.ts` reads these files and is the place to look when a
question about their contents comes up.
