import { describe, it, expect } from 'vitest';
import { isChartSpec } from './spec.js';

const validLine = {
  type: 'line',
  title: 'BTC/USD',
  series: [{ name: 'BTC', points: [{ x: '2026-07-19', y: 61240 }, { x: '2026-07-20', y: 60880 }] }],
};

describe('isChartSpec', () => {
  it('accepts a well-formed spec', () => {
    expect(isChartSpec(validLine)).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isChartSpec(null)).toBe(false);
    expect(isChartSpec(undefined)).toBe(false);
    expect(isChartSpec('a string')).toBe(false);
    expect(isChartSpec(42)).toBe(false);
  });

  it('rejects an unknown chart type', () => {
    expect(isChartSpec({ ...validLine, type: 'pie' })).toBe(false);
  });

  it('rejects a missing or empty title', () => {
    expect(isChartSpec({ ...validLine, title: undefined })).toBe(false);
    expect(isChartSpec({ ...validLine, title: '' })).toBe(false);
  });

  it('rejects an empty series array', () => {
    expect(isChartSpec({ ...validLine, series: [] })).toBe(false);
  });

  it('rejects a series with no points', () => {
    expect(isChartSpec({ ...validLine, series: [{ name: 'A', points: [] }] })).toBe(false);
  });

  it('rejects a point with a non-finite y', () => {
    expect(
      isChartSpec({ ...validLine, series: [{ name: 'A', points: [{ x: 1, y: NaN }] }] }),
    ).toBe(false);
    expect(
      isChartSpec({ ...validLine, series: [{ name: 'A', points: [{ x: 1, y: '5' }] }] }),
    ).toBe(false);
  });

  it('accepts numeric x values', () => {
    expect(
      isChartSpec({ ...validLine, series: [{ name: 'A', points: [{ x: 1, y: 2 }] }] }),
    ).toBe(true);
  });

  it('accepts normalize true/false/absent', () => {
    expect(isChartSpec({ ...validLine, normalize: true })).toBe(true);
    expect(isChartSpec({ ...validLine, normalize: false })).toBe(true);
    expect(isChartSpec(validLine)).toBe(true);
  });

  it('rejects a non-boolean normalize value', () => {
    expect(isChartSpec({ ...validLine, normalize: 'true' })).toBe(false);
    expect(isChartSpec({ ...validLine, normalize: 1 })).toBe(false);
  });
});
