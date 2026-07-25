import type { ChartSeries, YFormat } from './spec.js';

export function linearScale(domain: [number, number], range: [number, number]): (value: number) => number {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

export interface BandScale {
  step: number;
  bandWidth: number;
  center: (i: number) => number;
  start: (i: number) => number;
}

export function bandScale(count: number, range: [number, number], paddingRatio = 0.3): BandScale {
  const [r0, r1] = range;
  const totalWidth = r1 - r0;
  const step = count > 0 ? totalWidth / count : totalWidth;
  const bandWidth = Math.max(1, step * (1 - paddingRatio));
  return {
    step,
    bandWidth,
    center: (i: number) => r0 + step * i + step / 2,
    start: (i: number) => r0 + step * i + (step - bandWidth) / 2,
  };
}

function niceNum(range: number, round: boolean): number {
  const safeRange = range || 1;
  const exponent = Math.floor(Math.log10(safeRange));
  const fraction = safeRange / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

/** Rounded axis ticks spanning [min, max], roughly `count` of them. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  let lo = min;
  let hi = max;
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
  }
  const range = niceNum(hi - lo, false);
  const step = niceNum(range / Math.max(1, count - 1), true);
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step * 0.5; v += step) {
    ticks.push(Math.round(v * 1e10) / 1e10);
  }
  return ticks;
}

/** The max of the SUMMED series at each index — what a stacked chart must
 *  scale to. Using the per-series max instead (as StatsView.tsx does) makes
 *  tall stacks overflow the plot area. */
export function stackedMax(series: Array<{ points: Array<{ y: number }> }>): number {
  if (series.length === 0) return 1;
  const len = Math.max(...series.map((s) => s.points.length));
  let max = 0;
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (const s of series) {
      sum += s.points[i]?.y ?? 0;
    }
    if (sum > max) max = sum;
  }
  return max || 1;
}

/** Rebases each series to 100 at its own first point — the "=100 at t0"
 *  technique for comparing series of very different absolute scale on one
 *  shared axis (e.g. BTC price vs ETH price). The zero-base guard is
 *  defensive only — the Chart tool already rejects a zero first value. */
export function rebaseTo100(series: ChartSeries[]): ChartSeries[] {
  return series.map((s) => {
    const base = s.points[0]?.y;
    if (!base) return s;
    return { ...s, points: s.points.map((p) => ({ x: p.x, y: (p.y / base) * 100 })) };
  });
}

function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1000) return Number.isInteger(n) ? String(n) : n.toFixed(2);
  if (abs < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  if (abs < 1_000_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

function formatCurrency(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return `$${compactNumber(n)}`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatBytes(n: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.abs(n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const sign = n < 0 ? '-' : '';
  return `${sign}${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatValue(value: number, format?: YFormat): string {
  switch (format) {
    case 'compact':
      return compactNumber(value);
    case 'currency':
      return formatCurrency(value);
    case 'percent':
      return `${(value * 100).toFixed(1)}%`;
    case 'bytes':
      return formatBytes(value);
    case 'number':
    default:
      return value.toLocaleString();
  }
}
