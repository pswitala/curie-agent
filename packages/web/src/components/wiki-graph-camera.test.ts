import { describe, it, expect } from 'vitest';
import { cameraFitFor, viewDirection, type Bbox } from './wiki-graph-camera.js';

// Roughly the bbox this wiki's 79-node graph settles into.
const REAL: Bbox = { x: [-204, 329], y: [-185, 107], z: [-98, 151] };

describe('cameraFitFor', () => {
  it('centres on the middle of the box', () => {
    const { center } = cameraFitFor({ x: [-100, 300], y: [0, 50], z: [-20, 20] }, 50, 1.6);
    expect(center).toEqual({ x: 100, y: 25, z: 0 });
  });

  it('frames the observed graph at a distance that fills a 1440x803 viewport', () => {
    // Calibrated against the real thing: ~480 units looked right, and the
    // library's own default of 1055 left the graph tiny.
    const { distance } = cameraFitFor(REAL, 50, 1440 / 803);
    expect(distance).toBeGreaterThan(380);
    expect(distance).toBeLessThan(600);
  });

  it('scales the distance with the size of the graph', () => {
    const small = cameraFitFor({ x: [-10, 10], y: [-10, 10], z: [-10, 10] }, 50, 1.6).distance;
    const large = cameraFitFor({ x: [-100, 100], y: [-100, 100], z: [-100, 100] }, 50, 1.6).distance;
    expect(large).toBeGreaterThan(small * 5);
  });

  it('pulls back further for a narrower field of view', () => {
    const wide = cameraFitFor(REAL, 80, 1.6).distance;
    const narrow = cameraFitFor(REAL, 25, 1.6).distance;
    expect(narrow).toBeGreaterThan(wide);
  });

  it('accounts for aspect ratio on a wide graph', () => {
    const wideBox: Bbox = { x: [-400, 400], y: [-20, 20], z: [0, 0] };
    // A narrow viewport must pull back further to fit the same wide graph.
    expect(cameraFitFor(wideBox, 50, 0.6).distance)
      .toBeGreaterThan(cameraFitFor(wideBox, 50, 2.5).distance);
  });

  it('never returns a degenerate distance, even for a single node', () => {
    const { distance } = cameraFitFor({ x: [5, 5], y: [5, 5], z: [5, 5] }, 50, 1.6);
    expect(distance).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(distance)).toBe(true);
  });

  it('falls back to sane optics for a nonsense fov or aspect', () => {
    for (const [fov, aspect] of [[0, 1.6], [200, 1.6], [50, 0], [50, NaN]] as const) {
      const { distance } = cameraFitFor(REAL, fov, aspect);
      expect(Number.isFinite(distance)).toBe(true);
      expect(distance).toBeGreaterThan(0);
    }
  });

  it('tolerates inverted bounds', () => {
    const { distance } = cameraFitFor({ x: [329, -204], y: [107, -185], z: [151, -98] }, 50, 1.8);
    expect(distance).toBeCloseTo(cameraFitFor(REAL, 50, 1.8).distance, 0);
  });
});

describe('viewDirection', () => {
  it('returns a unit vector pointing from the centre to the camera', () => {
    const dir = viewDirection({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 0 });
    expect(dir).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('normalises an arbitrary offset', () => {
    const dir = viewDirection({ x: 3, y: 4, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(Math.hypot(dir.x, dir.y, dir.z)).toBeCloseTo(1, 6);
    expect(dir.x).toBeCloseTo(0.6, 6);
  });

  it('defaults to +z when the camera sits on the centre', () => {
    expect(viewDirection({ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 })).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('preserves the orbit direction so a refit does not snap the camera around', () => {
    const dir = viewDirection({ x: -50, y: 80, z: -30 }, { x: 0, y: 0, z: 0 });
    expect(dir.x).toBeLessThan(0);
    expect(dir.y).toBeGreaterThan(0);
    expect(dir.z).toBeLessThan(0);
  });
});
