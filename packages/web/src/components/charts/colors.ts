/**
 * Series colour slots. Order is the colourblind-safety mechanism — assign in
 * sequence, never cycle past 8 (the Chart tool already rejects a 9th series).
 * Values live in index.css as --chart-1..8, validated per-theme with the
 * dataviz skill's validate_palette.js (see plans/create-plan-to-present-snazzy-feigenbaum.md).
 */
const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
  'var(--chart-6)',
  'var(--chart-7)',
  'var(--chart-8)',
];

export function seriesColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length]!;
}
