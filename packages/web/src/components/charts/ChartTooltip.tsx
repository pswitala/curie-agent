export interface TooltipRow {
  name: string;
  value: string;
  color: string;
}

export interface TooltipData {
  /** Pixel x position within the chart's SVG, used to place the tooltip and any crosshair. */
  x: number;
  /** Pixel y position within the chart's SVG. */
  y: number;
  label: string;
  rows: TooltipRow[];
}

interface Props {
  data: TooltipData | null;
  chartWidth: number;
}

/** Floating HTML tooltip positioned over the SVG. Enhances, never gates — every
 *  value it shows is also reachable via the legend + table view. */
export function ChartTooltip({ data, chartWidth }: Props) {
  if (!data) return null;
  const flipLeft = data.x > chartWidth * 0.6;

  return (
    <div
      className="absolute pointer-events-none z-10 rounded-lg px-2.5 py-1.5 text-[10.5px] font-mono shadow-lg"
      style={{
        left: flipLeft ? undefined : Math.max(0, data.x + 10),
        right: flipLeft ? Math.max(0, chartWidth - data.x + 10) : undefined,
        top: Math.max(0, data.y - 10),
        background: 'var(--s3)',
        border: '1px solid var(--b1)',
        color: 'var(--chart-ink)',
        minWidth: 96,
        whiteSpace: 'nowrap',
      }}
    >
      <div className="font-semibold mb-1" style={{ color: 'var(--chart-ink-muted)' }}>
        {data.label}
      </div>
      {data.rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: r.color }} />
          <span>{r.name}:</span>
          <span className="font-semibold ml-auto pl-2" style={{ color: 'var(--chart-ink)' }}>
            {r.value}
          </span>
        </div>
      ))}
    </div>
  );
}
