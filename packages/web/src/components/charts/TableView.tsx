import type { ChartSpec } from './spec.js';
import { formatValue } from './scales.js';

interface Props {
  spec: ChartSpec;
}

/** The accessible twin every chart must have — every value reachable without
 *  hovering. `tabular-nums` here (a real column) is the intended use of that
 *  rule; it's never applied to a large standalone number elsewhere. */
export default function TableView({ spec }: Props) {
  const xValues = spec.series[0]?.points.map((p) => p.x) ?? [];

  return (
    <div>
      <div className="overflow-x-auto overflow-y-auto max-h-[260px] scrollbar-thin">
        <table className="w-full text-[11.5px] font-mono">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--b1)' }}>
              <th className="text-left py-1.5 pr-3 font-medium" style={{ color: 'var(--chart-ink-muted)' }}>
                {spec.x_label || 'x'}
              </th>
              {spec.series.map((s) => (
                <th key={s.name} className="text-right py-1.5 pl-3 font-medium" style={{ color: 'var(--chart-ink-muted)' }}>
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {xValues.map((x, i) => (
              <tr key={i} style={{ borderBottom: '1px solid color-mix(in srgb, var(--b1) 40%, transparent)' }}>
                <td className="py-1 pr-3" style={{ color: 'var(--chart-ink)', fontVariantNumeric: 'tabular-nums' }}>
                  {String(x)}
                </td>
                {spec.series.map((s) => (
                  <td key={s.name} className="text-right py-1 pl-3" style={{ color: 'var(--chart-ink)', fontVariantNumeric: 'tabular-nums' }}>
                    {formatValue(s.points[i]?.y ?? 0, spec.y_format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {spec.normalize && (
        <div className="mt-2 text-[10.5px] italic" style={{ color: 'var(--chart-ink-muted)' }}>
          Chart is indexed to 100 at the first point; this table shows raw values.
        </div>
      )}
    </div>
  );
}
