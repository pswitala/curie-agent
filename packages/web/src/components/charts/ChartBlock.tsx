import { isChartSpec, type ChartSpec } from './spec.js';
import ChartFrame from './ChartFrame.js';
import LineChart from './LineChart.js';
import BarChart from './BarChart.js';
import ScatterChart from './ScatterChart.js';
import TableView from './TableView.js';

interface Props {
  /** Normalized spec from the matching `tool-result` event's output. */
  spec: unknown;
  /** Set when the matching tool-result carried an error (e.g. a semantic
   *  guard rejected the spec after the model already emitted the call). */
  error?: string;
  /** True until the matching tool-result event has arrived. */
  pending?: boolean;
  /** Raw (pre-coercion) `tool-call` input, kept only for the error card's debug dump. */
  rawInput?: unknown;
}

function ChartPendingCard() {
  return (
    <div className="px-3 py-1 animate-fadeIn">
      <div
        className="rounded-xl p-4 flex items-center gap-2"
        style={{ background: 'var(--s2)', border: '1px solid var(--b1)' }}
      >
        <div className="w-[6px] h-[6px] rounded-full shrink-0 animate-pulse" style={{ background: 'var(--muted)' }} />
        <div className="text-[11.5px]" style={{ color: 'var(--muted)' }}>Rendering chart…</div>
      </div>
    </div>
  );
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

export default function ChartBlock({ spec, error, pending, rawInput }: Props) {
  if (error) {
    return <ChartErrorCard message={error} raw={rawInput ?? spec} />;
  }
  if (pending) {
    return <ChartPendingCard />;
  }
  if (!isChartSpec(spec)) {
    return <ChartErrorCard message="The chart data did not match the expected format." raw={rawInput ?? spec} />;
  }
  return <ValidChartBlock spec={spec} />;
}
