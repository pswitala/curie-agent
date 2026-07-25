import { describe, it, expect } from 'vitest';
import { chartTool } from './chart.js';

const settings = {} as any;

describe('Chart tool', () => {
  it('accepts a valid line chart', async () => {
    const result = await chartTool.execute(
      {
        type: 'line',
        title: 'BTC/USD',
        series: [
          {
            name: 'BTC',
            points: [
              { x: '2026-07-19', y: 61240 },
              { x: '2026-07-20', y: 60880 },
              { x: '2026-07-21', y: 59900 },
              { x: '2026-07-22', y: 60500 },
            ],
          },
        ],
      },
      settings,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ rendered: 'line', series: 1, points: 4 });
  });

  it('accepts each chart type', async () => {
    for (const type of ['line', 'area', 'bar', 'stacked-bar', 'scatter']) {
      const result = await chartTool.execute(
        {
          type,
          title: `A ${type} chart`,
          series: [
            { name: 'A', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
          ],
        },
        settings,
      );
      expect(result.error, `type=${type}`).toBeUndefined();
    }
  });

  it('rejects a 9th series', async () => {
    const series = Array.from({ length: 9 }, (_, i) => ({
      name: `S${i}`,
      points: [{ x: 'a', y: i }, { x: 'b', y: i + 1 }],
    }));
    const result = await chartTool.execute({ type: 'bar', title: 'Too many', series }, settings);
    expect(result.error).toMatch(/Validation error/);
  });

  it('rejects a 4-series scatter (cap is 3)', async () => {
    const series = Array.from({ length: 4 }, (_, i) => ({
      name: `S${i}`,
      points: [{ x: 1, y: i }],
    }));
    const result = await chartTool.execute({ type: 'scatter', title: 'Too many series', series }, settings);
    expect(result.error).toMatch(/at most 3 series/);
    expect(result.output).toBeNull();
  });

  it('rejects series with mismatched x values', async () => {
    const result = await chartTool.execute(
      {
        type: 'line',
        title: 'Mismatched',
        series: [
          { name: 'A', points: [{ x: 'mon', y: 1 }, { x: 'tue', y: 2 }] },
          { name: 'B', points: [{ x: 'mon', y: 1 }, { x: 'wed', y: 2 }] },
        ],
      },
      settings,
    );
    expect(result.error).toMatch(/different x values/);
  });

  it('rejects more than 2000 total points', async () => {
    const points = Array.from({ length: 2001 }, (_, i) => ({ x: i, y: i }));
    const result = await chartTool.execute({ type: 'line', title: 'Huge', series: [{ name: 'A', points }] }, settings);
    expect(result.error).toMatch(/Too many data points/);
  });

  it('rejects a single-series single-point chart', async () => {
    const result = await chartTool.execute(
      { type: 'bar', title: 'One number', series: [{ name: 'A', points: [{ x: 'x', y: 1 }] }] },
      settings,
    );
    expect(result.error).toMatch(/not a chart/);
  });

  it('coerces a decorated numeric string y value', async () => {
    const result = await chartTool.execute(
      {
        type: 'bar',
        title: 'Currency',
        series: [{ name: 'A', points: [{ x: 'a', y: '$61,240' }, { x: 'b', y: '59900' }] }],
      },
      settings,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ rendered: 'bar', series: 1, points: 2 });
  });

  it('resolves the data alias for series', async () => {
    const result = await chartTool.execute(
      {
        type: 'bar',
        title: 'Aliased',
        data: [{ name: 'A', points: [{ x: 'a', y: 1 }, { x: 'b', y: 2 }] }],
      },
      settings,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ rendered: 'bar', series: 1, points: 2 });
  });

  it('resolves a bare-number points array using the array index as x, not value lookup', async () => {
    // Two series with duplicate values at different positions. Deriving x from
    // indexOf(value) would collide on duplicates (both 5's mapping to x=0),
    // producing different x sequences per series and a spurious mismatch error.
    // Deriving x from the array index keeps both at x=[0,1,2] and passes.
    const result = await chartTool.execute(
      {
        type: 'bar',
        title: 'Bare arrays with duplicates',
        series: [
          { name: 'A', points: [5, 5, 10] },
          { name: 'B', points: [5, 10, 10] },
        ],
      },
      settings,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ rendered: 'bar', series: 2, points: 6 });
  });

  it('resolves label/value point aliases', async () => {
    const result = await chartTool.execute(
      {
        type: 'bar',
        title: 'Aliased points',
        series: [{ name: 'A', points: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] }],
      },
      settings,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ rendered: 'bar', series: 1, points: 2 });
  });

  it('resolves type aliases like "line_chart"', async () => {
    const result = await chartTool.execute(
      { type: 'line_chart', title: 'Alias type', series: [{ name: 'A', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] },
      settings,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ rendered: 'line', series: 1, points: 2 });
  });

  describe('normalize (BTC/ETH index-to-100 mode)', () => {
    const btcEth = {
      series: [
        { name: 'BTC', points: [{ x: 'day1', y: 60000 }, { x: 'day2', y: 61200 }] },
        { name: 'ETH', points: [{ x: 'day1', y: 3000 }, { x: 'day2', y: 3150 }] },
      ],
    };

    it('accepts normalize on a line chart', async () => {
      const result = await chartTool.execute({ type: 'line', title: 'BTC vs ETH', normalize: true, ...btcEth }, settings);
      expect(result.error).toBeUndefined();
      expect(result.output).toEqual({ rendered: 'line', series: 2, points: 4 });
    });

    it('accepts normalize on an area chart', async () => {
      const result = await chartTool.execute({ type: 'area', title: 'BTC vs ETH', normalize: true, ...btcEth }, settings);
      expect(result.error).toBeUndefined();
    });

    it('coerces the string "true"/"false" for normalize', async () => {
      const result = await chartTool.execute({ type: 'line', title: 'Stringy', normalize: 'true', ...btcEth }, settings);
      expect(result.error).toBeUndefined();
    });

    it('rejects normalize on a bar chart', async () => {
      const result = await chartTool.execute({ type: 'bar', title: 'BTC vs ETH', normalize: true, ...btcEth }, settings);
      expect(result.error).toMatch(/only meaningful for line\/area/);
    });

    it('rejects normalize on a stacked-bar chart', async () => {
      const result = await chartTool.execute({ type: 'stacked-bar', title: 'BTC vs ETH', normalize: true, ...btcEth }, settings);
      expect(result.error).toMatch(/only meaningful for line\/area/);
    });

    it('rejects normalize on a scatter chart', async () => {
      const result = await chartTool.execute({ type: 'scatter', title: 'BTC vs ETH', normalize: true, ...btcEth }, settings);
      expect(result.error).toMatch(/only meaningful for line\/area/);
    });

    it('rejects normalize when a series starts at 0', async () => {
      const result = await chartTool.execute(
        {
          type: 'line',
          title: 'Zero base',
          normalize: true,
          series: [
            { name: 'A', points: [{ x: 1, y: 0 }, { x: 2, y: 5 }] },
            { name: 'B', points: [{ x: 1, y: 10 }, { x: 2, y: 20 }] },
          ],
        },
        settings,
      );
      expect(result.error).toMatch(/cannot be normalized.*first value is 0/);
    });

    it('does not require normalize for a plain multi-series chart', async () => {
      const result = await chartTool.execute({ type: 'line', title: 'BTC vs ETH raw', ...btcEth }, settings);
      expect(result.error).toBeUndefined();
    });
  });

  it('returns a terse ack that does not echo the spec back', async () => {
    const result = await chartTool.execute(
      {
        type: 'line',
        title: 'Terse',
        series: [{ name: 'A', points: [{ x: 1, y: 111111 }, { x: 2, y: 222222 }] }],
      },
      settings,
    );
    const serialized = JSON.stringify(result.output);
    expect(serialized).not.toContain('111111');
    expect(serialized).not.toContain('222222');
    expect(Object.keys(result.output as object).sort()).toEqual(['points', 'rendered', 'series']);
  });

  it('returns the fully coerced spec as clientOutput, for the UI only', async () => {
    const result = await chartTool.execute(
      {
        type: 'linechart',
        title: 'Aliased for UI',
        normalize: 'true',
        data: [{ label: 'A', points: [{ label: 'a', value: '$1,234' }, { label: 'b', value: 2 }] }],
      },
      settings,
    );
    expect(result.error).toBeUndefined();
    expect(result.clientOutput).toEqual({
      type: 'line',
      title: 'Aliased for UI',
      normalize: true,
      series: [{ name: 'A', points: [{ x: 'a', y: 1234 }, { x: 'b', y: 2 }] }],
    });
  });

  it('does not set clientOutput on an error branch', async () => {
    const series = Array.from({ length: 4 }, (_, i) => ({
      name: `S${i}`,
      points: [{ x: 1, y: i }],
    }));
    const result = await chartTool.execute({ type: 'scatter', title: 'Too many series', series }, settings);
    expect(result.error).toBeDefined();
    expect(result.clientOutput).toBeUndefined();
  });
});
