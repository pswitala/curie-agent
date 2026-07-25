import { useState } from 'react';
import type { MouseEvent } from 'react';
import type { ChartSpec } from './spec.js';
import { niceTicks, formatValue, rebaseTo100 } from './scales.js';
import { seriesColor } from './colors.js';
import { ChartTooltip, type TooltipData } from './ChartTooltip.js';

interface Props {
  spec: ChartSpec;
  width: number;
  height: number;
}

/** Covers `line` and `area`. X positions are ordinal (evenly spaced) — the
 *  spec's x can be a date string, a category label, or a number, and the
 *  Chart tool already guarantees every series shares the same x values in
 *  the same order, so index-based spacing is exact for all three. */
export default function LineChart({ spec, width, height }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const isArea = spec.type === 'area';

  const padL = 44;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const chartW = Math.max(10, width - padL - padR);
  const chartH = Math.max(10, height - padT - padB);

  // When normalized, all geometry is driven by the rebased-to-100 series;
  // spec.series (raw values) still feeds tooltip/legend/endpoint text.
  const displaySeries = spec.normalize ? rebaseTo100(spec.series) : spec.series;

  const points0 = displaySeries[0]?.points ?? [];
  const n = points0.length;

  const allValues = displaySeries.flatMap((s) => s.points.map((p) => p.y));
  const ticks = niceTicks(Math.min(0, ...allValues), Math.max(...allValues, 1), 5);
  const domainMin = ticks[0]!;
  const domainMax = ticks[ticks.length - 1]!;
  const domainSpan = domainMax - domainMin || 1;

  const xAt = (i: number) => (n > 1 ? padL + (i / (n - 1)) * chartW : padL + chartW / 2);
  const yAt = (v: number) => padT + chartH - ((v - domainMin) / domainSpan) * chartH;

  const linePaths = displaySeries.map((s) => s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.y)}`).join(' '));

  const areaPaths = isArea
    ? displaySeries.map((s, si) => {
        const line = linePaths[si];
        const lastX = xAt(s.points.length - 1);
        const firstX = xAt(0);
        return `${line} L ${lastX} ${padT + chartH} L ${firstX} ${padT + chartH} Z`;
      })
    : [];

  const showEndpointLabels = spec.series.length > 1 && spec.series.length <= 4;

  const handleMove = (evt: MouseEvent<SVGRectElement>) => {
    const rect = evt.currentTarget.getBoundingClientRect();
    const px = evt.clientX - rect.left;
    const idx = n > 1 ? Math.round(((px - padL) / chartW) * (n - 1)) : 0;
    setHoverIdx(Math.min(n - 1, Math.max(0, idx)));
  };

  const tooltip: TooltipData | null =
    hoverIdx !== null && points0[hoverIdx]
      ? {
          x: xAt(hoverIdx),
          y: yAt(Math.max(...displaySeries.map((s) => s.points[hoverIdx]?.y ?? domainMin))),
          label: String(points0[hoverIdx]!.x),
          rows: spec.series.map((s, i) => {
            const rawY = s.points[hoverIdx]?.y;
            if (rawY === undefined) return { name: s.name, value: '—', color: seriesColor(i) };
            if (!spec.normalize) return { name: s.name, value: formatValue(rawY, spec.y_format), color: seriesColor(i) };
            // Raw value first (what the user actually asked about), indexed number as the secondary detail.
            const indexedY = displaySeries[i]?.points[hoverIdx]?.y ?? 0;
            return { name: s.name, value: `${formatValue(rawY, spec.y_format)} (${indexedY.toFixed(1)})`, color: seriesColor(i) };
          }),
        }
      : null;

  const midLabelIdx = Math.floor((n - 1) / 2);
  const xLabelIndices = n > 0 ? Array.from(new Set([0, midLabelIdx, n - 1])) : [];

  return (
    <div className="relative" style={{ width: '100%', height }}>
      <svg width={width} height={height} className="overflow-visible">
        <defs>
          {spec.series.map((_, i) => (
            <linearGradient key={i} id={`chart-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={seriesColor(i)} stopOpacity="0.22" />
              <stop offset="100%" stopColor={seriesColor(i)} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((t, i) => {
          const y = yAt(t);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="var(--chart-grid)" strokeWidth="1" />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" style={{ fill: 'var(--chart-ink-muted)', fontSize: 9.5, fontFamily: 'monospace' }}>
                {spec.normalize ? t.toFixed(0) : formatValue(t, spec.y_format)}
              </text>
            </g>
          );
        })}

        <line x1={padL} y1={padT + chartH} x2={width - padR} y2={padT + chartH} stroke="var(--chart-axis)" strokeWidth="1" />

        {xLabelIndices.map((i) => (
          <text
            key={i}
            x={xAt(i)}
            y={height - 6}
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
            style={{ fill: 'var(--chart-ink-muted)', fontSize: 9.5, fontFamily: 'monospace', opacity: 0.7 }}
          >
            {String(points0[i]?.x ?? '')}
          </text>
        ))}

        {isArea && areaPaths.map((d, i) => <path key={`area-${i}`} d={d} fill={`url(#chart-grad-${i})`} />)}

        {linePaths.map((d, i) => (
          <path key={`line-${i}`} d={d} fill="none" stroke={seriesColor(i)} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        ))}

        {displaySeries.map((s, i) => {
          const last = s.points[s.points.length - 1];
          if (!last) return null;
          const ex = xAt(s.points.length - 1);
          const ey = yAt(last.y);
          const labelX = Math.min(ex + 6, width - padR - 4);
          const nearEdge = labelX > width - padR - 34;
          return (
            <g key={`endpoint-${i}`}>
              <circle cx={ex} cy={ey} r="3" fill={seriesColor(i)} stroke="var(--s1)" strokeWidth="1.5" />
              {showEndpointLabels && (
                <text
                  x={nearEdge ? width - padR : labelX}
                  y={ey + 3}
                  textAnchor={nearEdge ? 'end' : 'start'}
                  style={{ fill: 'var(--chart-ink)', fontSize: 9.5, fontWeight: 600, fontFamily: 'inherit' }}
                >
                  {s.name}
                </text>
              )}
            </g>
          );
        })}

        {tooltip && <line x1={tooltip.x} y1={padT} x2={tooltip.x} y2={padT + chartH} stroke="var(--chart-axis)" strokeWidth="1" strokeOpacity="0.6" />}

        <rect x={padL} y={padT} width={chartW} height={chartH} fill="transparent" onMouseMove={handleMove} onMouseLeave={() => setHoverIdx(null)} style={{ cursor: 'crosshair' }} />
      </svg>
      <ChartTooltip data={tooltip} chartWidth={width} />
    </div>
  );
}
