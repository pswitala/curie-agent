import { isChartSpec, type ChartSpec } from './spec.js';
import ChartFrame from './ChartFrame.js';
import LineChart from './LineChart.js';
import BarChart from './BarChart.js';
import ScatterChart from './ScatterChart.js';
import TableView from './TableView.js';

interface Props {
  /** Raw `tool-call` input for a Chart call — not yet known to be valid. */
  spec: unknown;
  /** Set when the matching tool-result carried an error (e.g. a semantic
   *  guard rejected the spec after the model already emitted the call). */
  error?: string;
}

function ChartErrorCard({ message, raw }: { message: string; raw: unknown }) {
  return (
    <div className="px-3 py-1 animate-fadeIn">
      <div
        className="rounded-xl p-4"
        style={{ background: 'color-mix(in srgb, var(--red) 6%, var(--s2))', border: '1px solid color-mix(in srgb, var(--red) 25%, var(--b1))' }}
      >
        <div className="text-[12px] font-semibold mb-1.5" style={{ color: 'var(--red)' }}>
          Chart could not be rendered
        </div>
        <div className="text-[11.5px] mb-2" style={{ color: 'var(--text)' }}>
          {message}
        </div>
        <pre className="text-[10.5px] font-mono overflow-x-auto whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>
          {typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function ValidChartBlock({ spec }: { spec: ChartSpec }) {
  const renderChart = (width: number, height: number) => {
    switch (spec.type) {
      case 'line':
      case 'area':
        return <LineChart spec={spec} width={width} height={height} />;
      case 'bar':
      case 'stacked-bar':
        return <BarChart spec={spec} width={width} height={height} />;
      case 'scatter':
        return <ScatterChart spec={spec} width={width} height={height} />;
      default:
        return null;
    }
  };

  return <ChartFrame spec={spec} renderChart={renderChart} renderTable={() => <TableView spec={spec} />} />;
}

export default function ChartBlock({ spec, error }: Props) {
  if (error) {
    return <ChartErrorCard message={error} raw={spec} />;
  }
  if (!isChartSpec(spec)) {
    return <ChartErrorCard message="The chart data did not match the expected format." raw={spec} />;
  }
  return <ValidChartBlock spec={spec} />;
}
