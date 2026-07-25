import { describe, it, expect } from 'vitest';
import { niceTicks, stackedMax, formatValue, linearScale, bandScale, rebaseTo100 } from './scales.js';

describe('niceTicks', () => {
  it('spans at least [min, max]', () => {
    const ticks = niceTicks(3, 97, 5);
    expect(ticks[0]!).toBeLessThanOrEqual(3);
    expect(ticks[ticks.length - 1]!).toBeGreaterThanOrEqual(97);
  });

  it('handles a flat series (min === max) without collapsing to one tick', () => {
    const ticks = niceTicks(50, 50, 5);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[0]!).toBeLessThan(50);
    expect(ticks[ticks.length - 1]!).toBeGreaterThan(50);
  });

  it('produces evenly-spaced steps', () => {
    const ticks = niceTicks(0, 100, 5);
    const step = ticks[1]! - ticks[0]!;
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]! - ticks[i - 1]!).toBeCloseTo(step, 10);
    }
  });
});

describe('stackedMax', () => {
  it('sums series at each index, not the per-series max', () => {
    const series = [
      { points: [{ y: 10 }, { y: 5 }] },
      { points: [{ y: 3 }, { y: 40 }] },
    ];
    // index 0: 10+3=13, index 1: 5+40=45 -> stacked max is 45, not max(10,40)=40
    expect(stackedMax(series)).toBe(45);
  });

  it('returns 1 for an empty series list (avoids division by zero downstream)', () => {
    expect(stackedMax([])).toBe(1);
  });

  it('treats missing points in a shorter series as 0', () => {
    const series = [
      { points: [{ y: 10 }, { y: 5 }, { y: 1 }] },
      { points: [{ y: 3 }] },
    ];
    expect(stackedMax(series)).toBe(13);
  });
});

describe('formatValue', () => {
  it('formats plain numbers with locale separators', () => {
    expect(formatValue(1234, 'number')).toBe((1234).toLocaleString());
  });

  it('compacts large numbers', () => {
    expect(formatValue(1500, 'compact')).toBe('1.5k');
    expect(formatValue(2_500_000, 'compact')).toBe('2.50M');
  });

  it('formats currency with a dollar sign', () => {
    expect(formatValue(61240, 'currency')).toBe('$61.2k');
    expect(formatValue(42, 'currency')).toBe('$42');
  });

  it('formats percent from a 0-1 fraction', () => {
    expect(formatValue(0.256, 'percent')).toBe('25.6%');
  });

  it('formats bytes with binary units', () => {
    expect(formatValue(1024, 'bytes')).toBe('1.0 KB');
    expect(formatValue(500, 'bytes')).toBe('500 B');
  });
});

describe('rebaseTo100', () => {
  it('sets the first point of every series to exactly 100', () => {
    const [btc, eth] = rebaseTo100([
      { name: 'BTC', points: [{ x: 'd1', y: 60000 }, { x: 'd2', y: 61200 }] },
      { name: 'ETH', points: [{ x: 'd1', y: 3000 }, { x: 'd2', y: 3300 }] },
    ]);
    expect(btc!.points[0]!.y).toBe(100);
    expect(eth!.points[0]!.y).toBe(100);
  });

  it('doubling the raw value doubles the index to 200', () => {
    const [s] = rebaseTo100([{ name: 'A', points: [{ x: 1, y: 50 }, { x: 2, y: 100 }] }]);
    expect(s!.points[1]!.y).toBe(200);
  });

  it('rebases differently-scaled series independently — equal % change gives equal index', () => {
    // BTC +2% and ETH +2% from very different absolute bases should land at
    // the same indexed value — that's the whole point of the transform.
    const [btc, eth] = rebaseTo100([
      { name: 'BTC', points: [{ x: 'd1', y: 60000 }, { x: 'd2', y: 61200 }] },
      { name: 'ETH', points: [{ x: 'd1', y: 3000 }, { x: 'd2', y: 3060 }] },
    ]);
    expect(btc!.points[1]!.y).toBeCloseTo(102, 5);
    expect(eth!.points[1]!.y).toBeCloseTo(102, 5);
  });

  it('preserves series name and x values, only transforming y', () => {
    const [s] = rebaseTo100([{ name: 'A', points: [{ x: 'day1', y: 10 }, { x: 'day2', y: 15 }] }]);
    expect(s!.name).toBe('A');
    expect(s!.points.map((p) => p.x)).toEqual(['day1', 'day2']);
  });

  it('leaves a series unchanged if its first value is 0 (defensive; the tool already rejects this)', () => {
    const [s] = rebaseTo100([{ name: 'A', points: [{ x: 1, y: 0 }, { x: 2, y: 5 }] }]);
    expect(s!.points[1]!.y).toBe(5);
  });
});

describe('linearScale', () => {
  it('maps domain to range linearly', () => {
    const scale = linearScale([0, 100], [0, 200]);
    expect(scale(0)).toBe(0);
    expect(scale(50)).toBe(100);
    expect(scale(100)).toBe(200);
  });
});

describe('bandScale', () => {
  it('divides the range into equal steps and centers bands within them', () => {
    const scale = bandScale(4, [0, 400], 0);
    expect(scale.step).toBe(100);
    expect(scale.center(0)).toBe(50);
    expect(scale.center(3)).toBe(350);
  });

  it('shrinks bandWidth by the padding ratio', () => {
    const scale = bandScale(2, [0, 200], 0.5);
    expect(scale.step).toBe(100);
    expect(scale.bandWidth).toBe(50);
  });
});
