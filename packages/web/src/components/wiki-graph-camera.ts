export interface Bbox {
  x: [number, number];
  y: [number, number];
  z: [number, number];
}

export interface CameraFit {
  center: { x: number; y: number; z: number };
  distance: number;
}

/**
 * Where to put the camera so a bounding box fills the viewport.
 *
 * Exists because `zoomToFit()` is a no-op in react-force-graph-3d 1.29.1 — called
 * directly with a zero duration it leaves the camera untouched, so the graph
 * renders at whatever default distance the library picked. `cameraPosition()`
 * does work, so the fit is computed here and applied through that instead.
 *
 * Fits the box's *projected* extents in the current orientation rather than its
 * bounding sphere: the sphere is far more conservative for an elongated graph
 * (this wiki is ~2:1) and leaves it small in frame. The cost is that orbiting
 * can clip slightly — which the Reset view button fixes.
 */
export function cameraFitFor(
  bbox: Bbox,
  fovDegrees: number,
  aspect: number,
  padding = 1.06,
): CameraFit {
  const center = {
    x: (bbox.x[0] + bbox.x[1]) / 2,
    y: (bbox.y[0] + bbox.y[1]) / 2,
    z: (bbox.z[0] + bbox.z[1]) / 2,
  };

  const hx = Math.abs(bbox.x[1] - bbox.x[0]) / 2;
  const hy = Math.abs(bbox.y[1] - bbox.y[0]) / 2;
  const hz = Math.abs(bbox.z[1] - bbox.z[0]) / 2;

  const safeFov = fovDegrees > 0 && fovDegrees < 180 ? fovDegrees : 50;
  const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1.6;

  const vHalf = (safeFov / 2) * (Math.PI / 180);
  const hHalf = Math.atan(Math.tan(vHalf) * safeAspect);

  // Add the half-depth so the near face of the box clears the frustum too.
  const forVertical = hy / Math.tan(vHalf) + hz;
  const forHorizontal = hx / Math.tan(hHalf) + hz;

  return {
    center,
    distance: Math.max(1, Math.max(forVertical, forHorizontal) * padding),
  };
}

/** Unit vector from `center` toward `from`, defaulting to straight down +z. */
export function viewDirection(
  from: { x: number; y: number; z: number },
  center: { x: number; y: number; z: number },
): { x: number; y: number; z: number } {
  const dx = from.x - center.x;
  const dy = from.y - center.y;
  const dz = from.z - center.z;
  const length = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(length) || length < 1e-6) return { x: 0, y: 0, z: 1 };
  return { x: dx / length, y: dy / length, z: dz / length };
}
