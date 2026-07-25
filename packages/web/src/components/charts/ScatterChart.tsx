import { useState } from 'react';
import type { ChartSpec } from './spec.js';
import { niceTicks, formatValue } from './scales.js';
import { seriesColor } from './colors.js';
import { ChartTooltip, type TooltipData } from './ChartTooltip.js';

interface Props {
  spec: ChartSpec;
  width: number;
  height: number;
}

function toNum(x: string | number, fallback: number): number {
  if (typeof x === 'number') return x;
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/** Scatter is capped at 3 series by the Chart tool — with any two marks able
 *  to sit adjacent, only the first 3 palette slots clear the all-pairs
 *  colourblind gate (see the palette validation in the plan). */
export default function ScatterChart({ spec, width, height }: Props) {
  const [hover, setHover] = useState<{ si: number; pi: number } | null>(null);

  const padL = 48;
  const padR = 16;
  const padT = 14;
  const padB = 26;
  const chartW = Math.max(10, width - padL - padR);
  const chartH = Math.max(10, height - padT - padB);

  const allX = spec.series.flatMap((s) => s.points.map((p, pi) => toNum(p.x, pi)));
  const allY = spec.series.flatMap((s) => s.points.map((p) => p.y));

  const xTicks = niceTicks(Math.min(...allX), Math.max(...allX), 4);
  const yTicks = niceTicks(Math.min(0, ...allY), Math.max(...allY, 1), 5);
  const xMin = xTicks[0]!;
  const xMax = xTicks[xTicks.length - 1]!;
  const yMin = yTicks[0]!;
  const yMax = yTicks[yTicks.length - 1]!;

  const xAt = (v: number) => padL + ((v - xMin) / (xMax - xMin || 1)) * chartW;
  const yAt = (v: number) => padT + chartH - ((v - yMin) / (yMax - yMin || 1)) * chartH;

  const hoverPoint = hover ? spec.series[hover.si]?.points[hover.pi] : undefined;
  const tooltip: TooltipData | null =
    hover && hoverPoint
      ? {
          x: xAt(toNum(hoverPoint.x, hover.pi)),
          y: yAt(hoverPoint.y),
          label: spec.series[hover.si]?.name ?? '',
          rows: [
            { name: spec.x_label || 'x', value: String(hoverPoint.x), color: seriesColor(hover.si) },
            { name: spec.y_label || 'y', value: formatValue(hoverPoint.y, spec.y_format), color: seriesColor(hover.si) },
          ],
        }
      : null;

  return (
    <div className="relative" style={{ width: '100%', height }}>
      <svg width={width} height={height} className="overflow-visible">
        {yTicks.map((t, i) => {
          const y = yAt(t);
          return (
            <g key={`y-${i}`}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" style={{ fill: 'var(--chart-ink-muted)', fontSize: 9.5, fontFamily: 'monospace' }}>
                {formatValue(t, spec.y_format)}
              </text>
            </g>
          );
        })}

        {xTicks.map((t, i) => (
          <text key={`x-${i}`} x={xAt(t)} y={height - 6} textAnchor="middle" style={{ fill: 'var(--chart-ink-muted)', fontSize: 9.5, fontFamily: 'monospace', opacity: 0.7 }}>
            {formatValue(t)}
          </text>
        ))}

        <line x1={padL} y1={padT + chartH} x2={width - padR} y2={padT + chartH} stroke="var(--chart-axis)" strokeWidth="1" />
        <line x1={padL} y1={padT} x2={padL} y2={padT + chartH} stroke="var(--chart-axis)" strokeWidth="1" />

        {spec.series.map((s, si) =>
          s.points.map((p, pi) => {
            const cx = xAt(toNum(p.x, pi));
            const cy = yAt(p.y);
            return (
              <g key={`${si}-${pi}`}>
                {/* Invisible >=24px hit target — a bare 8px marker is too small to land on reliably. */}
                <circle
                  cx={cx}
                  cy={cy}
                  r="12"
                  fill="transparent"
                  onMouseEnter={() => setHover({ si, pi })}
                  onMouseLeave={() => setHover(null)}
                  style={{ cursor: 'pointer' }}
                />
                <circle cx={cx} cy={cy} r="4" fill={seriesColor(si)} stroke="var(--s1)" strokeWidth="1.5" />
              </g>
            );
          }),
        )}

        {tooltip && hover && <circle cx={tooltip.x} cy={tooltip.y} r="7" fill="none" stroke={seriesColor(hover.si)} strokeWidth="1.5" />}
      </svg>
      <ChartTooltip data={tooltip} chartWidth={width} />
    </div>
  );
}
