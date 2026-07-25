/**
 * Chart tool — lets the model draw an inline chart in the web UI chat pane.
 * The web client reads the spec straight off this tool's `tool-call` event
 * (see ChatView.tsx); `execute` only validates and acks, it never echoes the
 * spec back (that would duplicate the whole dataset into message history).
 */

import { z } from 'zod';
import { createTool, type ToolContext } from './tool.js';

export type ChartType = 'line' | 'area' | 'bar' | 'stacked-bar' | 'scatter';

const TYPE_ALIASES: Record<string, ChartType> = {
  line: 'line',
  linechart: 'line',
  area: 'area',
  areachart: 'area',
  bar: 'bar',
  barchart: 'bar',
  column: 'bar',
  columnchart: 'bar',
  stackedbar: 'stacked-bar',
  stackedbarchart: 'stacked-bar',
  stacked: 'stacked-bar',
  scatter: 'scatter',
  scatterchart: 'scatter',
  scatterplot: 'scatter',
};

function normalizeType(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const key = raw.toLowerCase().replace(/[\s_-]/g, '');
  return TYPE_ALIASES[key] ?? raw;
}

const ChartTypeSchema = z.preprocess(
  normalizeType,
  z.enum(['line', 'area', 'bar', 'stacked-bar', 'scatter']),
);

/** Strip currency/thousands decoration ("$61,240" -> 61240) only when the
 *  string plainly contains a number; otherwise leave it for zod to reject
 *  with a clear message rather than silently coercing garbage to 0. */
function coerceY(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const trimmed = raw.trim();
  if (!/\d/.test(trimmed)) return raw;
  const cleaned = trimmed.replace(/[^0-9.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : raw;
}

function coerceBool(raw: unknown): unknown {
  if (typeof raw === 'string') {
    if (raw.toLowerCase() === 'true') return true;
    if (raw.toLowerCase() === 'false') return false;
  }
  return raw;
}

/** Accept common aliases for a point's x/y keys. */
function normalizePoint(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const r = raw as Record<string, unknown>;
  const x = r.x ?? r.label ?? r.name ?? r.date ?? r.category;
  const y = r.y ?? r.value ?? r.count;
  if (x === undefined && y === undefined) return raw;
  return { x, y };
}

const PointSchema = z.preprocess(
  normalizePoint,
  z.object({
    x: z.union([z.string(), z.number()]).describe('Category label, ISO date string, or number.'),
    y: z.preprocess(coerceY, z.number()).describe('Numeric value. Decorated numeric strings like "$61,240" are coerced.'),
  }),
);

/** Accept a bare array of numbers/strings as `points` (index becomes x), and
 *  `data`/`values`/`label` as aliases for `points`/`points`/`name`. */
function normalizeSeriesEntry(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const r = { ...(raw as Record<string, unknown>) };
  const rawPoints = r.points ?? r.data ?? r.values;
  if (Array.isArray(rawPoints)) {
    const points = rawPoints as unknown[];
    r.points = points.map((p, i) => (typeof p === 'number' || typeof p === 'string' ? { x: i, y: p } : p));
  }
  if (r.name === undefined && typeof r.label === 'string') r.name = r.label;
  delete r.data;
  delete r.values;
  delete r.label;
  return r;
}

const SeriesSchema = z.preprocess(
  normalizeSeriesEntry,
  z.object({
    name: z.string().describe('Series name, shown in the legend (or in the title, for a single series).'),
    points: z.array(PointSchema).min(1).describe('Data points for this series, in x order.'),
  }),
);

const ChartSchema = z.object({
  type: ChartTypeSchema,
  title: z
    .string()
    .min(1)
    .describe('Required. For a single-series chart this also names the series — no legend is drawn for one series.'),
  subtitle: z.string().optional(),
  x_label: z.string().optional().describe('X-axis label.'),
  y_label: z.string().optional().describe('Y-axis label.'),
  y_format: z
    .enum(['number', 'compact', 'currency', 'percent', 'bytes'])
    .optional()
    .describe('How to format y-axis ticks and tooltip values.'),
  normalize: z
    .preprocess(coerceBool, z.boolean())
    .optional()
    .describe(
      'Line/area only. When true, each series is rebased to 100 at its own first point, so series with very ' +
        'different absolute scales (e.g. BTC price vs ETH price) can be compared on one shared axis as % change from start.',
    ),
  series: z
    .array(SeriesSchema)
    .min(1)
    .max(8)
    .describe('1 to 8 series (scatter charts: max 3). Every series must share the same x values, in the same order.'),
  note: z.string().optional().describe('One-sentence caption shown under the chart.'),
});

const CHART_DESCRIPTION = [
  'Renders a chart inline in the chat. Call this when the data has a real shape to show: at',
  'least 4 points over time, or at least 3 categories being compared. Do NOT call it for a',
  'single number (just state it in your reply), for 2-3 values (use prose), or for unordered',
  'labels with no magnitude story (use a markdown table instead) — those are not charts.',
  '',
  'Choose `type` by what the data represents:',
  '- line — a value over time (e.g. a price history)',
  '- area — a cumulative total or volume over time',
  '- bar — comparing values across categories',
  '- stacked-bar — parts of a total, per category',
  '- scatter — correlation between two measures (max 3 series)',
  '',
  'Rules: up to 8 series (3 for scatter, so colours stay distinguishable); every series must',
  'share the same x values in the same order; there is only ever one y-axis — never invent a',
  'second one. If series differ greatly in scale (e.g. BTC price in the tens of thousands vs',
  'ETH price in the thousands), set `normalize: true` (line/area only) so each is rebased to',
  '100 at its first point and both plot together as % change from the start on one shared axis.',
  'Only fall back to two separate Chart calls if the user specifically wants absolute values',
  'shown side by side. For a series longer than ~200 points, aggregate or sample it down rather',
  'than sending every point.',
  '',
  'After calling this tool, always follow it with one sentence of prose summarizing what the',
  'chart shows — some clients (terminal, Telegram) do not render the chart and only see your text.',
].join('\n');

export const chartTool = createTool(
  'Chart',
  CHART_DESCRIPTION,
  ChartSchema,
  async (input, _ctx: ToolContext) => {
    const { type, series, normalize } = input;

    if (type === 'scatter' && series.length > 3) {
      return {
        output: null,
        error: `Scatter charts support at most 3 series so colours stay colourblind-distinguishable (got ${series.length}). Reduce the series count or use a different chart type.`,
      };
    }

    if (normalize && type !== 'line' && type !== 'area') {
      return {
        output: null,
        error: 'normalize is only meaningful for line/area charts (rebasing to a first-point baseline doesn\'t apply to bar/stacked-bar/scatter). Drop normalize or change type.',
      };
    }

    if (normalize) {
      const zeroBaseIdx = series.findIndex((s) => s.points[0]!.y === 0);
      if (zeroBaseIdx !== -1) {
        return {
          output: null,
          error: `series[${zeroBaseIdx}] ("${series[zeroBaseIdx]!.name}") cannot be normalized — its first value is 0. Remove normalize or start the series from its first nonzero point.`,
        };
      }
    }

    const totalPoints = series.reduce((sum, s) => sum + s.points.length, 0);
    if (totalPoints > 2000) {
      return {
        output: null,
        error: `Too many data points (${totalPoints}, max 2000). Aggregate or downsample the series before charting.`,
      };
    }

    if (series.length === 1 && series[0]!.points.length === 1) {
      return {
        output: null,
        error: 'A single data point is not a chart — state the number in your reply instead of calling Chart.',
      };
    }

    if (series.length > 1) {
      const xKeys = series.map((s) => s.points.map((p) => String(p.x)).join('|'));
      const first = xKeys[0];
      const mismatchIdx = xKeys.findIndex((k) => k !== first);
      if (mismatchIdx !== -1) {
        return {
          output: null,
          error: `series[${mismatchIdx}] ("${series[mismatchIdx]!.name}") has different x values than series[0] ("${series[0]!.name}"). Every series must share the same x values, in the same order.`,
        };
      }
    }

    return { output: { rendered: type, series: series.length, points: totalPoints } };
  },
  undefined,
  { aliases: { data: 'series', values: 'series' } },
);
