/**
 * Mirrors the Chart tool's Zod schema (app/packages/tools/src/chart.ts) as a
 * plain TS interface. Deliberately not shared via @curie-agent/protocol: the
 * web package depends on neither `protocol` nor `zod` today, and this guard
 * exists purely so a malformed or legacy event renders an error card instead
 * of crashing the pane — the tool has already validated everything else.
 */

export type ChartType = 'line' | 'area' | 'bar' | 'stacked-bar' | 'scatter';
export type YFormat = 'number' | 'compact' | 'currency' | 'percent' | 'bytes';

export interface ChartPoint {
  x: string | number;
  y: number;
}

export interface ChartSeries {
  name: string;
  points: ChartPoint[];
}

export interface ChartSpec {
  type: ChartType;
  title: string;
  subtitle?: string;
  x_label?: string;
  y_label?: string;
  y_format?: YFormat;
  /** Line/area only. Rebases each series to 100 at its own first point so
   *  differently-scaled series (e.g. BTC vs ETH price) plot together as %
   *  change from start on one shared axis. */
  normalize?: boolean;
  series: ChartSeries[];
  note?: string;
}

const CHART_TYPES: ChartType[] = ['line', 'area', 'bar', 'stacked-bar', 'scatter'];

export function isChartSpec(value: unknown): value is ChartSpec {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;

  if (typeof v.type !== 'string' || !CHART_TYPES.includes(v.type as ChartType)) return false;
  if (typeof v.title !== 'string' || v.title.length === 0) return false;
  if (v.normalize !== undefined && typeof v.normalize !== 'boolean') return false;
  if (!Array.isArray(v.series) || v.series.length === 0) return false;

  for (const s of v.series) {
    if (!s || typeof s !== 'object') return false;
    const series = s as Record<string, unknown>;
    if (typeof series.name !== 'string') return false;
    if (!Array.isArray(series.points) || series.points.length === 0) return false;

    for (const p of series.points) {
      if (!p || typeof p !== 'object') return false;
      const point = p as Record<string, unknown>;
      if (typeof point.x !== 'string' && typeof point.x !== 'number') return false;
      if (typeof point.y !== 'number' || !Number.isFinite(point.y)) return false;
    }
  }

  return true;
}
