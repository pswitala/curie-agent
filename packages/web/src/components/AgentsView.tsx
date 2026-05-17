import { useState, useEffect } from 'react';
import { useApi } from '../lib/api-context.js';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';
import type { WsEvent } from '../lib/ws-client.js';

interface Props {
  rpc: JsonRpcClient | null;
  className?: string;
}

export default function AgentsView({ rpc, className }: Props) {
  const { ws } = useApi();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [recentEvents, setRecentEvents] = useState<WsEvent[]>([]);

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

  // Listen for session start/stop events
  useEffect(() => {
    if (!ws) return;
    ws.on('session-start', (event: WsEvent) => {
      setRecentEvents(prev => [event, ...prev].slice(0, 50));
    });
    ws.on('session-stop', (event: WsEvent) => {
      setRecentEvents(prev => [event, ...prev].slice(0, 50));
    });
    ws.on('status', (event: WsEvent) => {
      setRecentEvents(prev => [event, ...prev].slice(0, 50));
    });
  }, [ws]);

  return (
    <div className={`flex-1 overflow-y-auto p-7 scrollbar-thin ${className || ''}`}>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-base font-semibold text-fg tracking-tight">Agents</h2>
        <span className="text-xs text-muted font-mono">{sessions.length} total sessions</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted">Loading...</div>
      ) : sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted">
          <div className="text-sm">No sessions yet</div>
        </div>
      ) : (
        <>
          {/* Active sessions */}
          <div className="text-[11.5px] font-medium text-muted mb-2.5">Sessions</div>
          {sessions.slice(-10).reverse().map((s) => (
            <AgentCard key={s.id} session={s} />
          ))}

          {/* Live events */}
          {recentEvents.length > 0 && (
            <>
              <div className="h-px bg-b1 my-5" />
              <div className="text-[11.5px] font-medium text-muted mb-2.5">Live Events</div>
              {recentEvents.slice(0, 20).map((event, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-1.5 rounded-lg mb-0.5 hover:bg-s2">
                  <div className={`w-[6px] h-[6px] rounded-full shrink-0 ${
                    event.type === 'session-start' ? 'bg-green' :
                    event.type === 'session-stop' ? 'bg-muted2' :
                    'bg-yellow'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-text font-mono">{event.type}</div>
                    <div className="text-xs text-muted truncate">
                      {(event as any).message || (event as any).model || ''}
                    </div>
                  </div>
                  <span className="text-[10px] text-muted font-mono">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </div>
  );
}

function AgentCard({ session }: { session: { id: string; model: string; provider: string; cwd: string; createdAt: number; updatedAt: number } }) {
  const name = session.cwd.split('/').pop() || session.cwd;
  return (
    <div className="bg-s1 border border-b1 rounded-[10px] px-4 py-3.5 mb-2 cursor-pointer hover:border-b2 transition-colors duration-150">
      <div className="flex items-center gap-2.5 mb-1">
        <div className="w-[6px] h-[6px] rounded-full shrink-0 bg-muted2" />
        <span className="text-[13px] font-medium text-fg">{name}</span>
        <span className="text-xs text-muted font-mono ml-auto">{session.model} · {session.provider}</span>
      </div>
      <div className="flex items-center gap-2.5 text-[11.5px] text-muted">
        <span>Created: {new Date(session.createdAt).toLocaleString()}</span>
        <span>Updated: {new Date(session.updatedAt).toLocaleString()}</span>
      </div>
    </div>
  );
}
