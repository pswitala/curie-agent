import { useState, useEffect } from 'react';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';

interface Props {
  rpc: JsonRpcClient | null;
  className?: string;
}

export default function StatsView({ rpc, className }: Props) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!rpc) return;
    setLoading(true);
    rpc.sessionList()
      .then((list: any) => {
        if (Array.isArray(list)) setSessions(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [rpc]);

  // Calculate stats from sessions
  const todaySessions = sessions.filter(s => {
    const day = new Date().toDateString();
    return new Date(s.createdAt).toDateString() === day;
  });

  const totalSessions = sessions.length;

  return (
    <div className={`flex-1 overflow-y-auto p-7 scrollbar-thin ${className || ''}`}>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-fg tracking-tight">Stats</h2>
        <span className="text-xs text-muted font-mono">{totalSessions} total sessions</span>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-4 gap-2.5 mb-5">
        <MetricCard label="Sessions today" value={String(todaySessions.length)} />
        <MetricCard label="Total sessions" value={String(totalSessions)} />
        <MetricCard label="Providers" value={new Set(sessions.map(s => s.provider)).size.toString()} />
        <MetricCard label="Models" value={new Set(sessions.map(s => s.model)).size.toString()} />
      </div>

      {/* Recent sessions */}
      {sessions.length > 0 && (
        <div className="bg-s1 border border-b1 rounded-[10px] overflow-hidden">
          <div className="text-[12px] font-medium text-text2 px-4 py-3 border-b border-b1">
            Recent Sessions
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-b1">
                  <th className="px-4 py-2 font-medium">ID</th>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Provider</th>
                  <th className="px-4 py-2 font-medium">Created</th>
                  <th className="px-4 py-2 font-medium">CWD</th>
                </tr>
              </thead>
              <tbody>
                {sessions.slice(-20).reverse().map((s: any) => (
                  <tr key={s.id} className="border-b border-b1/50 hover:bg-s2">
                    <td className="px-4 py-2 font-mono text-xs text-muted">{s.id.slice(0, 12)}</td>
                    <td className="px-4 py-2 text-text">{s.model}</td>
                    <td className="px-4 py-2 text-text">{s.provider}</td>
                    <td className="px-4 py-2 text-muted text-xs">{new Date(s.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2 text-muted text-xs truncate max-w-[200px]">{s.cwd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-10 text-muted">
          Loading...
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-muted">
          <div className="text-sm">No sessions yet</div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-s1 border border-b1 rounded-[10px] px-4 py-3.5">
      <div className="text-xs text-muted mb-2 font-medium">{label}</div>
      <div className="text-2xl font-semibold tracking-tight leading-none text-fg">{value}</div>
    </div>
  );
}
