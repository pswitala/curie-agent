import { useState } from 'react';
import type { ChartSpec } from './spec.js';
import { niceTicks, formatValue, stackedMax, bandScale } from './scales.js';
import { seriesColor } from './colors.js';
import { ChartTooltip, type TooltipData } from './ChartTooltip.js';

interface Props {
  spec: ChartSpec;
  width: number;
  height: number;
}

/** Covers `bar` and `stacked-bar`. Stacked scales to the SUMMED max per index
 *  (via stackedMax), not the per-series max — scaling to the per-series max
 *  (as StatsView.tsx does today) makes tall stacks overflow the plot. */
export default function BarChart({ spec, width, height }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const isStacked = spec.type === 'stacked-bar';

  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const chartW = Math.max(10, width - padL - padR);
  const chartH = Math.max(10, height - padT - padB);

  const points0 = spec.series[0]?.points ?? [];
  const n = points0.length;

  const maxY = isStacked ? stackedMax(spec.series) : Math.max(...spec.series.flatMap((s) => s.points.map((p) => p.y)), 1);
  const ticks = niceTicks(0, maxY, 5);
  const domainMax = ticks[ticks.length - 1]!;
  const yAt = (v: number) => padT + chartH - (v / (domainMax || 1)) * chartH;

  const groups = bandScale(n, [padL, padL + chartW], 0.3);
  const gapPx = 2;
  const seriesCount = spec.series.length;
  const barWidth = isStacked ? groups.bandWidth : Math.max(2, (groups.bandWidth - gapPx * (seriesCount - 1)) / seriesCount);

  const tooltip: TooltipData | null =
    hoverIdx !== null && points0[hoverIdx]
      ? {
          x: groups.center(hoverIdx),
          y: padT,
          label: String(points0[hoverIdx]!.x),
          rows: spec.series.map((s, si) => ({
            name: s.name,
            value: formatValue(s.points[hoverIdx]?.y ?? 0, spec.y_format),
            color: seriesColor(si),
          })),
        }
      : null;

  const midLabelIdx = Math.floor((n - 1) / 2);

  return (
    <div className="relative" style={{ width: '100%', height }}>
      <svg width={width} height={height} className="overflow-visible">
        {ticks.map((t, i) => {
          const y = yAt(t);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" style={{ fill: 'var(--chart-ink-muted)', fontSize: 9.5, fontFamily: 'monospace' }}>
                {formatValue(t, spec.y_format)}
              </text>
            </g>
          );
        })}

        <line x1={padL} y1={padT + chartH} x2={width - padR} y2={padT + chartH} stroke="var(--chart-axis)" strokeWidth="1" />

        {points0.map((p, i) => {
          const showLabel = n <= 1 || i === 0 || i === n - 1 || i === midLabelIdx;
          if (!showLabel) return null;
          return (
            <text
              key={`label-${i}`}
              x={groups.center(i)}
              y={height - 6}
              textAnchor="middle"
              style={{ fill: 'var(--chart-ink-muted)', fontSize: 9.5, fontFamily: 'monospace', opacity: 0.7 }}
            >
              {String(p.x)}
            </text>
          );
        })}

        {points0.map((_, i) => {
          const bandStart = groups.start(i);
          let cursorY = padT + chartH;
          return (
            <g key={`group-${i}`} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)}>
              <rect x={groups.center(i) - groups.step / 2} y={padT} width={groups.step} height={chartH} fill="transparent" />
              {spec.series.map((s, si) => {
                const v = s.points[i]?.y ?? 0;
                if (v <= 0) return null;
                const barH = (v / (domainMax || 1)) * chartH;
                let x: number;
                let y: number;
                if (isStacked) {
                  x = bandStart;
                  y = cursorY - barH - (si > 0 ? gapPx : 0);
                  cursorY = y;
                } else {
                  x = bandStart + si * (barWidth + gapPx);
                  y = padT + chartH - barH;
                }
                return <rect key={si} x={x} y={y} width={barWidth} height={barH} rx="2" fill={seriesColor(si)} />;
              })}
            </g>
          );
        })}

        {tooltip && <line x1={tooltip.x} y1={padT} x2={tooltip.x} y2={padT + chartH} stroke="var(--chart-axis)" strokeWidth="1" strokeOpacity="0.4" />}
      </svg>
      <ChartTooltip data={tooltip} chartWidth={width} />
    </div>
  );
}
