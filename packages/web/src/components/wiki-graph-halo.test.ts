import { describe, it, expect } from 'vitest';
import { nodeRadiusFor, haloSizeFor, HALO_SCALE, DEFAULT_NODE_REL_SIZE } from './wiki-graph-halo.js';

describe('nodeRadiusFor', () => {
  it('matches 3d-force-graph: cbrt(val) * nodeRelSize', () => {
    expect(nodeRadiusFor(8, 4)).toBeCloseTo(8, 6);   // cbrt(8)=2 -> 2*4
    expect(nodeRadiusFor(1, 4)).toBeCloseTo(4, 6);
    expect(nodeRadiusFor(27, 3)).toBeCloseTo(9, 6);
  });

  it('grows with val but sublinearly, since val is a volume', () => {
    const small = nodeRadiusFor(1);
    const big = nodeRadiusFor(27);
    expect(big).toBeGreaterThan(small);
    // 27x the volume is only 3x the radius.
    expect(big / small).toBeCloseTo(3, 6);
  });

  it('falls back to a unit node for junk input', () => {
    for (const bad of [0, -5, NaN, Infinity]) {
      expect(nodeRadiusFor(bad)).toBeCloseTo(DEFAULT_NODE_REL_SIZE, 6);
    }
  });
});

describe('haloSizeFor', () => {
  it('extends past the sphere by the halo scale', () => {
    expect(haloSizeFor(1, 4)).toBeCloseTo(4 * HALO_SCALE, 6);
  });

  it('stays proportional to node radius, so hubs get a bigger aura', () => {
    expect(haloSizeFor(27) / haloSizeFor(1)).toBeCloseTo(3, 6);
  });

  it('is always larger than the sphere it surrounds', () => {
    for (const val of [1, 2, 8, 33, 100]) {
      expect(haloSizeFor(val)).toBeGreaterThan(nodeRadiusFor(val));
    }
  });

  it('is finite for junk input', () => {
    expect(Number.isFinite(haloSizeFor(NaN))).toBe(true);
  });
});
