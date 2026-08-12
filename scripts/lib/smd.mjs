/**
 * Valve SMD, read.
 *
 * Shared because two tools need it and they must agree: the importer builds a
 * `.glb` out of it, and the palette tool needs the same mesh to work out which
 * part of the body a colour belongs to. A second, subtly different parser would
 * put a jacket on the legs.
 *
 * The format is line-oriented, in three optional blocks:
 *
 *   nodes      `<index> "<name>" <parentIndex>`
 *   skeleton   `time <n>` then `<index> <px> <py> <pz> <rx> <ry> <rz>` — local
 *              to the parent, rotations as XYZ Euler in radians
 *   triangles  a material name, then three vertex lines:
 *              `<parent> <pos×3> <normal×3> <u> <v> <links> [<bone> <weight>]…`
 *
 * Bones and dummy nodes share one index space — the mesh nodes are in the list
 * too — so every node is kept rather than filtered out. The vertices index into
 * that space and filtering would silently shift them.
 */

export function readSmd(text) {
  const nodes = [];
  const frames = new Map();
  const groups = [];
  let section = null;
  let time = -1;
  let pending = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (line === 'nodes' || line === 'skeleton' || line === 'triangles') {
      section = line;
      continue;
    }
    if (line === 'end') {
      section = null;
      continue;
    }
    if (!section) continue;

    if (section === 'nodes') {
      const m = line.match(/^(\d+)\s+"([^"]*)"\s+(-?\d+)/);
      if (m) nodes[+m[1]] = { name: m[2], parent: +m[3] };
      continue;
    }

    if (section === 'skeleton') {
      if (line.startsWith('time')) {
        time = +line.split(/\s+/)[1];
        frames.set(time, []);
        continue;
      }
      const p = line.split(/\s+/).map(Number);
      if (p.length >= 7 && frames.has(time)) {
        frames.get(time)[p[0]] = { px: p[1], py: p[2], pz: p[3], rx: p[4], ry: p[5], rz: p[6] };
      }
      continue;
    }

    /* triangles: a material line, then exactly three vertex lines under it. */
    if (!/^-?\d/.test(line)) {
      pending = { material: line, verts: [] };
      groups.push(pending);
      continue;
    }
    if (!pending) continue;
    const p = line.split(/\s+/).map(Number);
    const links = [];
    const n = p[9] || 0;
    for (let i = 0; i < n; i++) links.push({ bone: p[10 + i * 2], weight: p[11 + i * 2] });
    /* No link list means the vertex rides its `parent` bone outright. */
    if (!links.length) links.push({ bone: p[0], weight: 1 });
    pending.verts.push({
      pos: [p[1], p[2], p[3]],
      normal: [p[4], p[5], p[6]],
      uv: [p[7], p[8]],
      links,
    });
  }

  return { nodes, frames, groups };
}

/** Frames in order, as arrays of per-bone local transforms. */
export function clipFrames(smd) {
  return [...smd.frames.keys()].sort((a, b) => a - b).map((t) => smd.frames.get(t));
}
