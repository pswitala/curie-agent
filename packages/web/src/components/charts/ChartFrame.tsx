import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ChartSpec } from './spec.js';
import { seriesColor } from './colors.js';

interface Props {
  spec: ChartSpec;
  renderChart: (width: number, height: number) => ReactNode;
  renderTable: () => ReactNode;
  height?: number;
}

/** Shared card chrome: title/subtitle, legend, the chart/table toggle, and a
 *  ResizeObserver-driven width so the SVG never stretches via
 *  preserveAspectRatio="none" (the distortion bug in StatsView.tsx). */
export default function ChartFrame({ spec, renderChart, renderTable, height = 220 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(Math.max(240, Math.floor(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A single series is named by the title — no legend box (dataviz rule).
  const showLegend = spec.series.length > 1;

  return (
    <div className="px-3 py-1 animate-fadeIn">
      <div
        className="rounded-xl p-4 select-none"
        style={{ background: 'linear-gradient(135deg, var(--s2) 0%, var(--s1) 100%)', border: '1px solid var(--b1)', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
      >
        <div className="flex items-start justify-between gap-3 mb-1.5">
          <div className="min-w-0">
            <div className="text-[13px] font-display font-semibold truncate" style={{ color: 'var(--chart-ink)' }}>
              {spec.title}
            </div>
            {spec.subtitle && (
              <div className="text-[11px] mt-0.5" style={{ color: 'var(--chart-ink-muted)' }}>
                {spec.subtitle}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {spec.normalize && (
              <span
                className="text-[10px] font-mono px-2 py-1 rounded-[4px]"
                style={{ background: 'var(--s3)', border: '1px solid var(--b1)', color: 'var(--chart-ink-muted)' }}
                title="Each series is rebased to 100 at its first point, so differently-scaled series can be compared on one shared axis."
              >
                Indexed
              </span>
            )}
            <button
              onClick={() => setShowTable((v) => !v)}
              className="text-[10px] font-mono px-2 py-1 rounded-[4px] cursor-pointer transition-colors"
              style={{ background: 'var(--s3)', border: '1px solid var(--b1)', color: 'var(--chart-ink-muted)' }}
            >
              {showTable ? 'Chart' : 'Table'}
            </button>
          </div>
        </div>

        {showLegend && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
            {spec.series.map((s, i) => (
              <div key={s.name} className="flex items-center gap-1.5 text-[10.5px]" style={{ color: 'var(--chart-ink-muted)' }}>
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: seriesColor(i) }} />
                {s.name}
              </div>
            ))}
          </div>
        )}

        <div ref={containerRef} className="w-full" style={{ minHeight: height }}>
          {showTable ? renderTable() : width > 0 ? renderChart(width, height) : null}
        </div>

        {spec.note && (
          <div className="mt-2 text-[10.5px] italic" style={{ color: 'var(--chart-ink-muted)' }}>
            {spec.note}
          </div>
        )}
      </div>
    </div>
  );
}
