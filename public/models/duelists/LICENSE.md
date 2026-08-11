# Duelist models — provenance and license

The six characters in this directory are from the **RPG Character Pack** by
**Quaternius** (https://quaternius.com/packs/rpgcharacters.html), retrieved
2026-08-11 from the pack's official download folder
(https://drive.google.com/drive/folders/1MIRQXLfTd21HMI5rwOb6Xy0rv0xv1m8b).

License, as stated by the pack's own `License.txt`:

> LowPoly Models by @Quaternius
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

What was changed: the pack's `glTF/*.gltf` files (JSON with one embedded
base64 buffer each) were repacked byte-for-byte into binary `.glb` containers
— same geometry, same rig, same animations, same embedded textures, roughly a
quarter smaller on disk. `scripts/premade-audit.ts` reads these files and is
the place to look when a question about their contents comes up.
