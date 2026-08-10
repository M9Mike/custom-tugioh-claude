/**
 * Can this browser draw at all?
 *
 * Asked before either 3D screen builds anything, so a device that cannot run
 * them is told so rather than shown an empty black rectangle and left to guess.
 * A throwaway canvas is the only reliable test — the failures worth catching
 * are a disabled hardware-acceleration setting, a browser with WebGL switched
 * off in flags, and an old device that has simply run out of contexts, and none
 * of those show up in a feature check on `window`.
 */
export function canDraw3d(): boolean {
  if (typeof document === 'undefined') return true; // SSR: decide on the client
  try {
    const canvas = document.createElement('canvas');
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl') ??
      canvas.getContext('experimental-webgl');
    if (!gl) return false;
    /* Handed back immediately. A browser allows only a handful of live contexts
       and the probe must not be holding one when the real renderer asks. */
    (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}
