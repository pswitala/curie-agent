import { describe, it, expect } from 'vitest';
import { estimateCost, parseTieredPricing, selectTier } from './pricing.js';

describe('parseTieredPricing', () => {
  it('parses flat pricing', () => {
    expect(parseTieredPricing('0.25;1.50')).toEqual([{ in: 0.25, out: 1.50 }]);
  });

  it('parses two-tier pricing', () => {
    expect(parseTieredPricing('0.25;1.50|200000<1.0;4.0')).toEqual([
      { in: 0.25, out: 1.50 },
      { threshold: 200000, in: 1.0, out: 4.0 },
    ]);
  });

  it('parses three-tier pricing', () => {
    expect(parseTieredPricing('0.25;1.50|200000<1.0;4.0|500000<2.0;8.0')).toEqual([
      { in: 0.25, out: 1.50 },
      { threshold: 200000, in: 1.0, out: 4.0 },
      { threshold: 500000, in: 2.0, out: 8.0 },
    ]);
  });

  it('returns empty array for malformed input', () => {
    expect(parseTieredPricing('abc;def')).toEqual([]);
    expect(parseTieredPricing('0.25;abc')).toEqual([]);
  });

  it('ignores whitespace around tier segments', () => {
    expect(parseTieredPricing('0.25;1.50 | 200000<1.0;4.0')).toEqual([
      { in: 0.25, out: 1.50 },
      { threshold: 200000, in: 1.0, out: 4.0 },
    ]);
  });

  it('stops parsing at malformed tier segment', () => {
    // "0.25;1.50|200000<abc;4.0" — tier 1 has invalid input, stops after base tier
    expect(parseTieredPricing('0.25;1.50|200000<abc;4.0')).toEqual([
      { in: 0.25, out: 1.50 },
    ]);
  });
});

describe('selectTier', () => {
  it('returns base tier when below all thresholds', () => {
    const tiers = parseTieredPricing('0.25;1.50|200000<1.0;4.0');
    expect(selectTier(tiers, 100000)).toEqual([0.25, 1.50]);
  });

  it('returns base tier for flat pricing at any token count', () => {
    const tiers = parseTieredPricing('0.25;1.50');
    expect(selectTier(tiers, 100000)).toEqual([0.25, 1.50]);
    expect(selectTier(tiers, 10_000_000)).toEqual([0.25, 1.50]);
  });

  it('returns tiered pricing when above threshold', () => {
    const tiers = parseTieredPricing('0.25;1.50|200000<1.0;4.0');
    expect(selectTier(tiers, 200000)).toEqual([1.0, 4.0]);
    expect(selectTier(tiers, 500000)).toEqual([1.0, 4.0]);
  });

  it('selects highest applicable tier in multi-tier config', () => {
    const tiers = parseTieredPricing('0.25;1.50|200000<1.0;4.0|500000<2.0;8.0');
    expect(selectTier(tiers, 100000)).toEqual([0.25, 1.50]);
    expect(selectTier(tiers, 200000)).toEqual([1.0, 4.0]);
    expect(selectTier(tiers, 500000)).toEqual([2.0, 8.0]);
  });

  it('handles empty tiers array', () => {
    expect(selectTier([], 0)).toEqual([0, 0]);
  });
});

describe('estimateCost', () => {
  it('applies flat custom pricing', () => {
    const cost = estimateCost('custom-model', 1_000_000, 500_000, '0.5;2.0');
    expect(cost).toBe((1_000_000 * 0.5 + 500_000 * 2.0) / 1_000_000);
  });

  it('applies base tier for low token counts', () => {
    const cost = estimateCost('custom-model', 100_000, 50_000, '0.25;1.50|200000<1.0;4.0');
    // Total 150k < 200k threshold → base tier
    expect(cost).toBe((100000 * 0.25 + 50000 * 1.50) / 1_000_000);
  });

  it('applies tiered pricing when above threshold', () => {
    const cost = estimateCost('custom-model', 150_000, 100_000, '0.25;1.50|200000<1.0;4.0');
    // Total 250k >= 200k threshold → tier 2
    expect(cost).toBe((150000 * 1.0 + 100000 * 4.0) / 1_000_000);
  });

  it('falls back to hardcoded rates when no custom pricing', () => {
    const cost = estimateCost('claude-opus-4-7', 1_000_000, 1_000_000, undefined);
    expect(cost).toBe((1_000_000 * 15 + 1_000_000 * 75) / 1_000_000);
  });

  it('falls back to sonnet for unknown model', () => {
    const cost = estimateCost('unknown-model', 1_000_000, 1_000_000, undefined);
    expect(cost).toBe((1_000_000 * 3 + 1_000_000 * 15) / 1_000_000);
  });

  it('returns zero cost for zero tokens', () => {
    expect(estimateCost('sonnet', 0, 0, '0.5;2.0')).toBe(0);
  });
});
