import { describe, it, expect } from 'vitest';
import { FALLBACK_THEME, luminance, type ThemeColors } from '../lib/theme-colors.js';
import { bloomParamsFor } from './wiki-graph-bloom.js';

const withS1 = (s1: string): ThemeColors => ({ ...FALLBACK_THEME, '--s1': s1 });

// --s1 values straight out of index.css
const BLACK = withS1('#0a0a0a');
const CURIE = withS1('#14100c');
const NORD = withS1('#242933');
const WHITE = withS1('#f1f1f1');

describe('bloomParamsFor', () => {
  it('gives dark themes a visible glow', () => {
    expect(bloomParamsFor(BLACK).strength).toBeGreaterThan(0.5);
    expect(bloomParamsFor(NORD).strength).toBeGreaterThan(0.5);
  });

  it('effectively switches bloom off on the light theme', () => {
    // Bloom adds light; at dark-theme strength the white theme washes out.
    const white = bloomParamsFor(WHITE);
    expect(white.strength).toBeLessThan(0.2);
    expect(white.threshold).toBeGreaterThan(0.6);
  });

  it('holds a threshold floor on every theme', () => {
    // The floor is what stops a dense link field and the brighter palette hues
    // from blowing out; 0.4 was settled by eye on a real 79-node/344-link wiki
    // (see the note in wiki-graph-bloom.ts). A floor, not a value derived from
    // palette luminance: the shader gates *lit* pixels, and Lambert shading puts
    // most of a sphere well below its base hue.
    for (const theme of [BLACK, CURIE, NORD, WHITE]) {
      expect(bloomParamsFor(theme).threshold).toBeGreaterThan(0.4);
    }
  });

  it('enables bloom on dark themes and disables it on light ones', () => {
    for (const theme of [BLACK, CURIE, NORD]) {
      expect(bloomParamsFor(theme).enabled).toBe(true);
    }
    // Not merely weakened: a background brighter than the threshold blooms
    // itself and veils the graph.
    expect(bloomParamsFor(WHITE).enabled).toBe(false);
  });

  it('only stays enabled while the background sits below its own threshold', () => {
    for (const theme of [BLACK, CURIE, NORD, WHITE]) {
      const { enabled, threshold } = bloomParamsFor(theme);
      const backdrop = luminance(theme['--s1']);
      expect(enabled).toBe(backdrop < threshold);
    }
  });

  it('decreases strength monotonically as the background gets lighter', () => {
    const ordered = [BLACK, CURIE, NORD, WHITE].map(c => bloomParamsFor(c).strength);
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]!).toBeLessThan(ordered[i - 1]!);
    }
  });

  it('raises the threshold as the background gets lighter', () => {
    expect(bloomParamsFor(WHITE).threshold).toBeGreaterThan(bloomParamsFor(BLACK).threshold);
  });

  it('keeps every parameter in a range UnrealBloomPass accepts', () => {
    for (const theme of [BLACK, CURIE, NORD, WHITE]) {
      const { strength, radius, threshold } = bloomParamsFor(theme);
      expect(strength).toBeGreaterThan(0);
      expect(strength).toBeLessThanOrEqual(2.5);
      expect(radius).toBeGreaterThan(0);
      expect(radius).toBeLessThanOrEqual(1);
      expect(threshold).toBeGreaterThanOrEqual(0);
      expect(threshold).toBeLessThanOrEqual(1);
    }
  });

  it('tolerates an unparseable surface colour without producing NaN', () => {
    const params = bloomParamsFor(withS1('garbage'));
    expect(Number.isFinite(params.strength)).toBe(true);
    expect(Number.isFinite(params.radius)).toBe(true);
    expect(Number.isFinite(params.threshold)).toBe(true);
  });
});
