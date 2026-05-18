import { useState, useEffect } from 'react';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';

interface Props {
  rpc: JsonRpcClient | null;
  className?: string;
}

interface StatsData {
  summary: {
    totalSessionsToday: number;
    totalSessions: number;
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalToolCalls: number;
    totalMessages: number;
    totalCost: number;
  };
  hourly: Array<{
    hour: number;
    inputTokens: number;
    outputTokens: number;
    toolCalls: number;
    messages: number;
  }>;
  entrypoints: {
    webui: number;
    tui: number;
    telegram: number;
    heartbeat: number;
  };
  topTools: Array<{ name: string; count: number }>;
}

export default function StatsView({ rpc, className }: Props) {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [recentSessions, setRecentSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [hoveredBarHour, setHoveredBarHour] = useState<number | null>(null);

  useEffect(() => {
    if (!rpc) return;
    setLoading(true);

    // Load aggregate statistics and recent sessions list
    Promise.all([
      rpc.sessionStats(),
      rpc.sessionList()
    ])
      .then(([statsRes, listRes]: any) => {
        if (statsRes) setStats(statsRes);
        if (Array.isArray(listRes)) setRecentSessions(listRes);
      })
      .catch((err) => {
        console.error('[StatsView] Failed to load statistics:', err);
      })
      .finally(() => setLoading(false));
  }, [rpc]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted py-20 select-none animate-pulse">
        <svg className="animate-spin h-6 w-6 text-muted mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-[13px] font-mono">Compiling operations telemetry...</span>
      </div>
    );
  }

  if (!stats || stats.summary.totalSessions === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted py-20 select-none">
        <div className="w-12 h-12 rounded-[10px] bg-s2 border border-b1 flex items-center justify-center mb-4 text-muted2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M21 12H3M12 3v18" />
          </svg>
        </div>
        <div className="text-[13.5px] font-medium text-fg">No operational data found</div>
        <div className="text-[11.5px] text-muted mt-1">Start a conversation to generate metrics.</div>
      </div>
    );
  }

  const { summary, hourly, entrypoints, topTools } = stats;

  // Formatting helpers
  const formatTokenCount = (n: number): string => {
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1_000_000).toFixed(2)}M`;
  };

  // SVG dimensions for Area Chart
  const svgW = 600;
  const svgH = 140;
  const padL = 45;
  const padR = 15;
  const padT = 15;
  const padB = 25;

  const maxTokens = Math.max(...hourly.map(h => h.inputTokens + h.outputTokens), 1);
  const chartW = svgW - padL - padR;
  const chartH = svgH - padT - padB;

  // Calculate coordinates for token usage area chart
  const points = hourly.map((h, i) => {
    const total = h.inputTokens + h.outputTokens;
    const x = padL + (i / 23) * chartW;
    const y = padT + chartH - (total / maxTokens) * chartH;
    return { x, y, ...h };
  });

  const areaPath = points.length > 0
    ? `${points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')} L ${points[points.length - 1]!.x} ${padT + chartH} L ${points[0]!.x} ${padT + chartH} Z`
    : '';

  const linePath = points.length > 0
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    : '';

  // SVG dimensions for Bar Chart
  const barSvgW = 600;
  const barSvgH = 140;
  const barMaxVal = Math.max(...hourly.map(h => Math.max(h.toolCalls, h.messages)), 1);
  const barChartW = barSvgW - padL - padR;
  const barChartH = barSvgH - padT - padB;
  const barWidth = (barChartW / 24) * 0.75;
  const barSpacing = (barChartW / 24) * 0.25;

  // Total Client sessions count
  const clientTotals = entrypoints.webui + entrypoints.tui + entrypoints.telegram + entrypoints.heartbeat || 1;

  return (
    <div className={`flex-1 overflow-y-auto p-4 md:p-7 scrollbar-thin ${className || ''}`}>
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-base font-semibold text-fg tracking-tight">System Telemetry</h2>
          <p className="text-[11.5px] text-muted mt-0.5">Real-time daily operations telemetry and interface execution load.</p>
        </div>
        <span className="self-start sm:self-auto text-[11px] font-mono bg-s2 border border-b1 rounded-full px-3 py-1 text-muted select-none">
          Today: {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
        </span>
      </div>

      {/* Primary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Today's Sessions" value={String(summary.totalSessionsToday)} subtitle="conversations today" />
        <MetricCard label="Operational Cost" value={`$${summary.totalCost.toFixed(4)}`} subtitle="estimated total" isGreen />
        <MetricCard label="Volume Consumed" value={formatTokenCount(summary.totalTokens)} subtitle="total system tokens" />
        <MetricCard label="Agent Executions" value={String(summary.totalToolCalls)} subtitle="integrated tool calls" />
      </div>

      {/* Grid of Hourly Telemetry Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
        <div className="bg-s1 border border-b1 rounded-[10px] p-5 flex flex-col relative select-none">
          <div className="flex items-center justify-between h-6 mb-4">
            <span className="text-xs font-semibold text-text2 uppercase tracking-wider">Hourly Token Consumption</span>
            <span className={`text-[11px] font-mono text-fg bg-s3 px-2 py-0.5 rounded-[4px] transition-opacity duration-150 ${
              hoveredHour !== null ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}>
              {hoveredHour !== null
                ? `${String(hoveredHour).padStart(2, '0')}:00 · ${formatTokenCount(hourly[hoveredHour]!.inputTokens + hourly[hoveredHour]!.outputTokens)} tok`
                : '00:00 · 0 tok'}
            </span>
          </div>

          <div className="relative flex-1 h-[140px]">
            <svg width="100%" height="100%" viewBox={`0 0 ${svgW} ${svgH}`} preserveAspectRatio="none" className="overflow-visible">
              <defs>
                <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--green)" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="var(--green)" stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Grid Lines */}
              {Array.from({ length: 5 }).map((_, idx) => {
                const y = padT + (idx / 4) * chartH;
                const value = Math.round(maxTokens - (idx / 4) * maxTokens);
                return (
                  <g key={idx} className="opacity-25">
                    <line x1={padL} y1={y} x2={svgW - padR} y2={y} stroke="var(--b2)" strokeWidth="0.75" strokeDasharray="3 3" />
                    <text x={padL - 8} y={y + 3.5} textAnchor="end" className="fill-muted font-mono text-[9.5px]">
                      {formatTokenCount(value)}
                    </text>
                  </g>
                );
              })}

              {/* X Axis Time Lables */}
              {Array.from({ length: 7 }).map((_, idx) => {
                const hour = Math.round((idx / 6) * 23);
                const x = padL + (hour / 23) * chartW;
                return (
                  <text key={idx} x={x} y={svgH - 6} textAnchor="middle" className="fill-muted font-mono text-[9.5px] opacity-60">
                    {String(hour).padStart(2, '0')}:00
                  </text>
                );
              })}

              {/* Smooth Area */}
              {areaPath && <path d={areaPath} fill="url(#tokenGrad)" />}

              {/* Highlight Stroke */}
              {linePath && <path d={linePath} fill="none" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" />}

              {/* Hover Interactive Circles */}
              {points.map((p, i) => (
                <g key={i} onMouseEnter={() => setHoveredHour(i)} onMouseLeave={() => setHoveredHour(null)}>
                  {/* Invisible wide capture rect */}
                  <rect
                    x={p.x - chartW / 48}
                    y={padT}
                    width={chartW / 24}
                    height={chartH}
                    fill="transparent"
                    className="cursor-pointer"
                  />
                  {hoveredHour === i && (
                    <>
                      <line x1={p.x} y1={padT} x2={p.x} y2={padT + chartH} stroke="var(--b2)" strokeWidth="0.75" />
                      <circle cx={p.x} cy={p.y} r="4" fill="var(--green)" stroke="var(--s1)" strokeWidth="1.5" />
                    </>
                  )}
                </g>
              ))}
            </svg>
          </div>
        </div>

        <div className="bg-s1 border border-b1 rounded-[10px] p-5 flex flex-col relative select-none">
          <div className="flex items-center justify-between h-6 mb-4">
            <span className="text-xs font-semibold text-text2 uppercase tracking-wider">Hourly Tool & Prompt Load</span>
            <span className={`text-[11px] font-mono text-fg bg-s3 px-2 py-0.5 rounded-[4px] transition-opacity duration-150 ${
              hoveredBarHour !== null ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}>
              {hoveredBarHour !== null
                ? `${String(hoveredBarHour).padStart(2, '0')}:00 · 🛠️ ${hourly[hoveredBarHour]!.toolCalls} calls · 💬 ${hourly[hoveredBarHour]!.messages} msg`
                : '00:00 · 0 calls · 0 msg'}
            </span>
          </div>

          <div className="relative flex-1 h-[140px]">
            <svg width="100%" height="100%" viewBox={`0 0 ${barSvgW} ${barSvgH}`} preserveAspectRatio="none" className="overflow-visible">
              {/* Grid Lines */}
              {Array.from({ length: 5 }).map((_, idx) => {
                const y = padT + (idx / 4) * barChartH;
                const value = Math.round(barMaxVal - (idx / 4) * barMaxVal);
                return (
                  <g key={idx} className="opacity-25">
                    <line x1={padL} y1={y} x2={barSvgW - padR} y2={y} stroke="var(--b2)" strokeWidth="0.75" strokeDasharray="3 3" />
                    <text x={padL - 8} y={y + 3.5} textAnchor="end" className="fill-muted font-mono text-[9.5px]">
                      {value}
                    </text>
                  </g>
                );
              })}

              {/* X Axis Time Lables */}
              {Array.from({ length: 7 }).map((_, idx) => {
                const hour = Math.round((idx / 6) * 23);
                const x = padL + (hour / 23) * barChartW;
                return (
                  <text key={idx} x={x} y={barSvgH - 6} textAnchor="middle" className="fill-muted font-mono text-[9.5px] opacity-60">
                    {String(hour).padStart(2, '0')}:00
                  </text>
                );
              })}

              {/* Stacked Bars */}
              {hourly.map((h, i) => {
                const x = padL + i * (barWidth + barSpacing);

                // Height calculations
                const promptHeight = (h.messages / barMaxVal) * barChartH;
                const toolHeight = (h.toolCalls / barMaxVal) * barChartH;

                const promptY = padT + barChartH - promptHeight;
                const toolY = promptY - toolHeight;

                return (
                  <g
                    key={i}
                    onMouseEnter={() => setHoveredBarHour(i)}
                    onMouseLeave={() => setHoveredBarHour(null)}
                    className="cursor-pointer"
                  >
                    {/* User Prompt volume bar (Yellow) */}
                    {h.messages > 0 && (
                      <rect
                        x={x}
                        y={promptY}
                        width={barWidth}
                        height={promptHeight}
                        fill="var(--yellow)"
                        rx="1"
                        className="transition-all duration-100 hover:opacity-80"
                      />
                    )}
                    {/* Tool Call execution volume bar (FG / Blue Accent) */}
                    {h.toolCalls > 0 && (
                      <rect
                        x={x}
                        y={toolY}
                        width={barWidth}
                        height={toolHeight}
                        fill="var(--fg)"
                        rx="1"
                        className="transition-all duration-100 hover:opacity-80"
                      />
                    )}

                    {/* Full height capture trigger overlay */}
                    <rect
                      x={x - barSpacing / 2}
                      y={padT}
                      width={barWidth + barSpacing}
                      height={barChartH}
                      fill="transparent"
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>

      {/* Telemetry breakdowns grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
        {/* Entrypoint distribution */}
        <div className="bg-s1 border border-b1 rounded-[10px] p-5 flex flex-col select-none">
          <span className="text-xs font-semibold text-text2 uppercase tracking-wider mb-4 block">Telemetry Channels</span>

          <div className="space-y-3.5 flex-1 flex flex-col justify-center">
            <ShareRow
              label="Web UI Console"
              count={entrypoints.webui}
              percent={Math.round((entrypoints.webui / clientTotals) * 100)}
              color="bg-green"
            />
            <ShareRow
              label="CLI TUI Terminal"
              count={entrypoints.tui}
              percent={Math.round((entrypoints.tui / clientTotals) * 100)}
              color="bg-yellow"
            />
            <ShareRow
              label="Telegram Bot"
              count={entrypoints.telegram}
              percent={Math.round((entrypoints.telegram / clientTotals) * 100)}
              color="bg-fg"
            />
            <ShareRow
              label="Heartbeat Scheduler"
              count={entrypoints.heartbeat}
              percent={Math.round((entrypoints.heartbeat / clientTotals) * 100)}
              color="bg-red"
            />
          </div>
        </div>

        {/* Top Tools execution stats */}
        <div className="col-span-1 md:col-span-2 bg-s1 border border-b1 rounded-[10px] p-5">
          <span className="text-xs font-semibold text-text2 uppercase tracking-wider mb-3 block">Top Executed Tools Today</span>

          {topTools.length === 0 ? (
            <div className="flex items-center justify-center h-28 text-xs text-muted">
              No tool executions tracked today
            </div>
          ) : (
            <div className="overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-muted border-b-b1-40 font-mono text-[10px]">
                    <th className="pb-1.5 font-medium">TOOL DEFINITION</th>
                    <th className="pb-1.5 font-medium text-right">CALLS</th>
                  </tr>
                </thead>
                <tbody>
                  {topTools.map((t, idx) => (
                    <tr key={idx} className="hover:bg-s2/30 transition-colors duration-100 border-b-b1-40">
                      <td className="py-2 font-mono text-fg font-medium">{t.name}</td>
                      <td className="py-2 text-right font-mono font-semibold text-green">{t.count} executions</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Historical Operations List */}
      {recentSessions.length > 0 && (
        <div className="bg-s1 border border-b1 rounded-[10px] overflow-hidden">
          <div className="text-xs font-semibold text-text2 uppercase tracking-wider px-4 py-3.5 border-b border-b1">
            Telemetry Operations Stream
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-xs text-muted border-b-b1-40 font-mono text-[10px]">
                  <th className="px-4 py-2 font-medium">SESSION ID</th>
                  <th className="px-4 py-2 font-medium">CHANNEL</th>
                  <th className="px-4 py-2 font-medium">MODEL MODEL</th>
                  <th className="px-4 py-2 font-medium">TELEMETRY TIMESTAMP</th>
                  <th className="px-4 py-2 font-medium">ACTIVE DIRECTORY</th>
                </tr>
              </thead>
              <tbody>
                {recentSessions.slice(0, 15).map((s: any) => (
                  <tr key={s.id} className="hover:bg-s2/40 transition-colors duration-75 border-b-b1-40">
                    <td className="px-4 py-2.5 font-mono text-[11.5px] text-fg">{s.id}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-[4px] text-[10px] font-mono select-none ${s.type === 'telegram' ? 'bg-fg/10 text-fg' :
                        s.type === 'tui' ? 'bg-yellow/10 text-yellow' :
                          s.type === 'heartbeat' ? 'bg-red/10 text-red' :
                            'bg-green/10 text-green'
                        }`}>
                        {s.type || 'webui'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-text font-mono text-[11.5px]">{s.model}</td>
                    <td className="px-4 py-2.5 text-muted text-xs">{new Date(s.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-muted text-xs truncate max-w-[220px]" title={s.cwd}>{s.cwd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, subtitle, isGreen }: { label: string; value: string; subtitle: string; isGreen?: boolean }) {
  return (
    <div className="bg-s1 border border-b1 rounded-[10px] px-6 py-5 flex flex-col justify-between select-none">
      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">{label}</span>
      <div className={`text-2xl font-bold tracking-tight leading-none ${isGreen ? 'text-green' : 'text-fg'}`}>{value}</div>
      <span className="text-[10px] text-muted mt-2 font-mono">{subtitle}</span>
    </div>
  );
}

function ShareRow({ label, count, percent, color }: { label: string; count: number; percent: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs font-medium text-text2">
        <span>{label}</span>
        <span className="font-mono text-muted">{count} sessions ({percent || 0}%)</span>
      </div>
      <div className="w-full h-1.5 bg-s2 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${percent || 0}%` }} />
      </div>
    </div>
  );
}
