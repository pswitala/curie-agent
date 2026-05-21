import { useState, useCallback } from 'react';
import { useApi } from '../lib/api-context.js';
import { useSubagents } from '../hooks/useSubagents.js';
import type { JsonRpcClient } from '../lib/jsonrpc-client.js';

interface Props {
  rpc: JsonRpcClient | null;
  sessionId?: string;
  className?: string;
}

export default function SubagentsView({ rpc, sessionId, className }: Props) {
  const { ws } = useApi();
  const { agents, running, completed, failed, spawn, cancel, send } = useSubagents();
  const [spawnOpen, setSpawnOpen] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [spawnPrompt, setSpawnPrompt] = useState('');
  const [spawnMode, setSpawnMode] = useState<string>('auto');
  const [spawnEffort, setSpawnEffort] = useState<string>('auto');
  const [spawnProvider, setSpawnProvider] = useState<string>('');
  const [spawnModel, setSpawnModel] = useState('');
  // Schedule form state
  const [schedPrompt, setSchedPrompt] = useState('');
  const [schedDate, setSchedDate] = useState('');
  const [schedTime, setSchedTime] = useState('');
  const [schedProvider, setSchedProvider] = useState('');
  const [schedModel, setSchedModel] = useState('');
  const [schedEffort, setSchedEffort] = useState<'low' | 'medium' | 'high' | 'max' | 'auto'>('auto');
  const [schedError, setSchedError] = useState<string>('');
  const [messageAgentId, setMessageAgentId] = useState('');
  const [messageText, setMessageText] = useState('');
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(0);

  const handleSpawn = useCallback(async () => {
    if (!spawnPrompt.trim() || !rpc) return;
    let targetSession = sessionId;
    if (!targetSession) {
      try {
        const list = await rpc.sessionList();
        if (Array.isArray(list) && list.length > 0) {
          targetSession = (list[0] as any).id;
        }
      } catch { /* ignore */ }
    }

    await spawn({
      sessionId: targetSession || '',
      prompt: spawnPrompt.trim(),
      provider: spawnProvider || undefined,
      mode: spawnMode !== 'auto' ? spawnMode : undefined,
      effort: spawnEffort !== 'auto' ? spawnEffort : undefined,
      model: spawnModel || undefined,
    });
    setSpawnPrompt('');
    setSpawnOpen(false);
    setSpawnProvider('');
  }, [spawnPrompt, spawnMode, spawnEffort, spawnProvider, spawnModel, sessionId, rpc, spawn]);

  const handleSchedule = useCallback(async () => {
    if (!rpc || !schedPrompt.trim() || !schedDate || !schedTime) {
      setSchedError('Please fill in prompt and date/time');
      return;
    }
    setSchedError('');
    const scheduledAt = `${schedDate}T${schedTime}:00`;
    try {
      await rpc.taskSchedule({
        instruction: schedPrompt.trim(),
        scheduled_at: scheduledAt,
        provider: schedProvider || undefined,
        model: schedModel || undefined,
        effort: schedEffort !== 'auto' ? schedEffort : undefined,
      });
      setSchedPrompt('');
      setSchedDate('');
      setSchedTime('');
      setShowSchedule(false);
    } catch (err) {
      setSchedError(err instanceof Error ? err.message : 'Failed to schedule task');
    }
  }, [schedPrompt, schedDate, schedTime, schedProvider, schedModel, schedEffort, rpc]);

  const handleSend = useCallback(async () => {
    if (!messageAgentId || !messageText.trim()) return;
    await send(messageAgentId, messageText.trim());
    setMessageText('');
  }, [messageAgentId, messageText, send]);

  const allAgents = Array.from(agents.values()).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  const historyAgents = allAgents.filter(a => a.status === 'done' || a.status === 'error' || a.status === 'cancelled');
  const historySlice = historyAgents.slice(historyPage * 10, (historyPage + 1) * 10);

  const formatDuration = (ms: number) => {
    const secs = Math.floor(ms / 1000);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m${secs % 60}s`;
  };

  return (
    <div className={`flex-1 overflow-y-auto p-4 md:p-7 scrollbar-thin ${className || ''}`}>
      {/* Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-base font-semibold text-fg tracking-tight">Agents</h2>
          <p className="text-[11.5px] text-muted mt-0.5">Parallel subagent orchestration and monitoring.</p>
        </div>
        <div className="flex gap-2 self-start sm:self-auto">
          <button
            onClick={() => setShowSchedule(!showSchedule)}
            className={`text-xs font-medium border rounded-[8px] px-4 py-2 transition-colors select-none ${showSchedule ? 'bg-blue/15 text-blue border-blue/30' : 'bg-s2 text-muted border-b1 hover:text-fg'}`}
          >
            Schedule
          </button>
          <button
            onClick={() => setSpawnOpen(!spawnOpen)}
            className="text-xs font-medium bg-green/10 text-green border border-green/20 rounded-[8px] px-4 py-2 hover:bg-green/20 transition-colors duration-150 select-none"
          >
            {spawnOpen ? 'Cancel' : '+ Spawn Agent'}
          </button>
        </div>
      </div>

      {/* Spawn Panel */}
      {spawnOpen && (
        <div className="bg-s1 border border-b1 rounded-[10px] p-5 mb-6 animate-in">
          <div className="flex flex-col gap-3">
            <textarea
              className="bg-s2 border border-b1 rounded-[8px] p-3 text-[13px] text-fg font-mino resize-y min-h-[60px] focus:border-fg/30 outline-none transition-colors duration-150"
              placeholder="What should the subagent do?"
              value={spawnPrompt}
              onChange={(e) => setSpawnPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSpawn(); } }}
            />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <select
                className="bg-s2 border border-b1 rounded-[8px] px-3 py-2 text-xs text-fg outline-none"
                value={spawnMode}
                onChange={(e) => setSpawnMode(e.target.value)}
              >
                <option value="auto">Mode: inherit</option>
                <option value="plan">Mode: plan</option>
                <option value="edit">Mode: edit</option>
                <option value="auto">Mode: auto</option>
                <option value="yolo">Mode: yolo</option>
              </select>
              <select
                className="bg-s2 border border-b1 rounded-[8px] px-3 py-2 text-xs text-fg outline-none"
                value={spawnEffort}
                onChange={(e) => setSpawnEffort(e.target.value)}
              >
                <option value="auto">Effort: inherit</option>
                <option value="low">Effort: low</option>
                <option value="medium">Effort: medium</option>
                <option value="high">Effort: high</option>
                <option value="max">Effort: max</option>
              </select>
              <select
                className="bg-s2 border border-b1 rounded-[8px] px-3 py-2 text-xs text-fg outline-none"
                value={spawnProvider}
                onChange={(e) => setSpawnProvider(e.target.value)}
              >
                <option value="">Provider: inherit</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
                <option value="ollama">Ollama</option>
                <option value="openrouter">OpenRouter</option>
              </select>
              <input
                className="bg-s2 border border-b1 rounded-[8px] px-3 py-2 text-xs text-fg outline-none font-mono"
                placeholder="Model override (optional)"
                value={spawnModel}
                onChange={(e) => setSpawnModel(e.target.value)}
              />
              <button
                onClick={handleSpawn}
                disabled={!spawnPrompt.trim()}
                className="bg-green/20 text-green border border-green/30 rounded-[8px] px-4 py-2 text-xs font-medium hover:bg-green/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Spawn
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Panel */}
      {showSchedule && (
        <div className="bg-s1 border border-b1 rounded-[10px] p-5 mb-6 animate-in">
          <div className="flex flex-col gap-3">
            <textarea
              className="bg-s2 border border-b1 rounded-[8px] p-3 text-[13px] text-fg font-mino resize-y min-h-[60px] focus:border-fg/30 outline-none transition-colors duration-150"
              placeholder="What should the scheduled agent do?"
              value={schedPrompt}
              onChange={(e) => setSchedPrompt(e.target.value)}
            />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <input
                type="date"
                className="bg-s2 border border-b1 rounded-[8px] px-3 py-2 text-xs text-fg outline-none"
                value={schedDate}
                onChange={(e) => setSchedDate(e.target.value)}
              />
              <input
                type="time"
                className="bg-s2 border border-b1 rounded-[8px] px-3 py-2 text-xs text-fg outline-none"
                value={schedTime}
                onChange={(e) => setSchedTime(e.target.value)}
              />
              <select
                className="bg-s2 border border-b1 rounded-[8px] px-3 py-2 text-xs text-fg outline-none"
                value={schedEffort}
                onChange={(e) => setSchedEffort(e.target.value as typeof schedEffort)}
              >
                <option value="auto">Effort: auto</option>
                <option value="low">Effort: low</option>
                <option value="medium">Effort: medium</option>
                <option value="high">Effort: high</option>
                <option value="max">Effort: max</option>
              </select>
              <select
                className="bg-s2 border border-b1 rounded-[8px] px-3 py-2 text-xs text-fg outline-none"
                value={schedProvider}
                onChange={(e) => setSchedProvider(e.target.value)}
              >
                <option value="">Provider: inherit</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
                <option value="google">Google</option>
                <option value="ollama">Ollama</option>
                <option value="openrouter">OpenRouter</option>
              </select>
              <input
                className="bg-s2 border border-b1 rounded-[8px] px-3 py-2 text-xs text-fg outline-none font-mono col-span-2 md:col-span-4"
                placeholder="Model override (optional)"
                value={schedModel}
                onChange={(e) => setSchedModel(e.target.value)}
              />
            </div>
            {schedError && <div className="text-[11px] text-red bg-red/5 rounded-[6px] p-2">{schedError}</div>}
            <button
              onClick={handleSchedule}
              disabled={!schedPrompt.trim() || !schedDate || !schedTime}
              className="bg-blue/20 text-blue border border-blue/30 rounded-[8px] px-4 py-2 text-xs font-medium hover:bg-blue/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-start"
            >
              Schedule Agent
            </button>
          </div>
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Running" value={String(running.length)} color="text-yellow" />
        <KpiCard label="Completed" value={String(completed.length)} color="text-green" />
        <KpiCard label="Failed" value={String(failed.length)} color="text-red" />
        <KpiCard label="Total Tokens" value={formatTokenCount(allAgents.reduce((s, a) => s + a.inputTokens + a.outputTokens, 0))} color="text-fg" />
      </div>

      {/* Live Running Agents */}
      {running.length > 0 && (
        <div className="mb-6">
          <h3 className="text-[11px] font-semibold text-text2 uppercase tracking-wider mb-3">Live Agents</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {running.map((agent) => (
              <AgentCard
                key={agent.agentId}
                agent={agent}
                onCancel={() => cancel(agent.agentId)}
                onExpand={() => setExpandedAgent(expandedAgent === agent.agentId ? null : agent.agentId)}
               />
            ))}
          </div>
        </div>
      )}

      {/* History Table */}
      {historyAgents.length > 0 && (
        <div className="mb-6">
          <h3 className="text-[11px] font-semibold text-text2 uppercase tracking-wider mb-3">History</h3>
          <div className="bg-s1 border border-b1 rounded-[10px] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-b1 font-mono text-[10px]">
                    <th className="px-4 py-2 font-medium">STATUS</th>
                    <th className="px-4 py-2 font-medium">PROVIDER</th>
                    <th className="px-4 py-2 font-medium">PROMPT</th>
                    <th className="px-4 py-2 font-medium">DURATION</th>
                    <th className="px-4 py-2 font-medium">TOOLS</th>
                    <th className="px-4 py-2 font-medium text-right">TOKENS</th>
                  </tr>
                </thead>
                <tbody>
                  {historySlice.map((agent) => {
                    const statusColor = agent.status === 'done' ? 'text-green' : agent.status === 'cancelled' ? 'text-muted2' : 'text-red';
                    const duration = agent.doneAt ? formatDuration(agent.doneAt - agent.startedAt) : '-';
                    const tokenTotal = agent.inputTokens + agent.outputTokens;
                    return (
                      <tr key={agent.agentId} className="hover:bg-s2/30 transition-colors cursor-pointer border-b border-b1/40" onClick={() => setExpandedAgent(expandedAgent === agent.agentId ? null : agent.agentId)}>
                        <td className="px-4 py-2.5">
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-[4px] ${statusColor === 'text-green' ? 'bg-green/10' : statusColor === 'text-red' ? 'bg-red/10' : 'bg-muted/10'}`}>
                            {agent.status}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted font-mono text-[11.5px]">{agent.provider || '-'}</td>
                        <td className="px-4 py-2.5 text-fg truncate max-w-[200px]" title={agent.prompt}>{agent.prompt}</td>
                        <td className="px-4 py-2.5 text-muted font-mono">{duration}</td>
                        <td className="px-4 py-2.5 text-muted font-mono">{agent.toolCalls}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-muted">{tokenTotal > 0 ? formatTokenCount(tokenTotal) : '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {historyAgents.length > 10 && (
              <div className="flex items-center justify-center gap-4 py-2 border-t border-b1">
                <button
                  className="text-xs text-muted hover:text-fg transition-colors disabled:opacity-30"
                  disabled={historyPage === 0}
                  onClick={() => setHistoryPage(p => p - 1)}
                >
                  Prev
                </button>
                <span className="text-[10px] text-muted font-mono">{historyPage + 1} / {Math.ceil(historyAgents.length / 10)}</span>
                <button
                  className="text-xs text-muted hover:text-fg transition-colors disabled:opacity-30"
                  disabled={(historyPage + 1) * 10 >= historyAgents.length}
                  onClick={() => setHistoryPage(p => p + 1)}
                >
                  Next
                </button>
              </div>
            )}
          </div>

          {/* Expanded agent detail */}
          {expandedAgent && (() => {
            const agent = agents.get(expandedAgent);
            if (!agent) return null;
            return (
              <div className="bg-s1 border border-b1 rounded-[10px] p-4 mt-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-mono text-muted">Agent: {agent.agentId.slice(0, 12)}...</span>
                  <span className="text-[10px] text-muted">{new Date(agent.startedAt).toLocaleString()}</span>
                </div>
                <pre className="text-[12px] text-fg bg-s2 rounded-[8px] p-3 overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap font-mono">{agent.text || '(no output)'}</pre>
                {agent.errors.length > 0 && (
                  <div className="mt-2 text-[11px] text-red bg-red/5 rounded-[6px] p-2">
                    {agent.errors.map((e, i) => <div key={i}>Error: {e}</div>)}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Send Message to Running Agent */}
      {running.length > 0 && (
        <div className="bg-s1 border border-b1 rounded-[10px] p-4 mb-6">
          <h3 className="text-[11px] font-semibold text-text2 uppercase tracking-wider mb-3">Send Message to Agent</h3>
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              className="bg-s2 border border-b1 rounded-[8px] px-3 py-2 text-xs text-fg outline-none flex-[0.5]"
              value={messageAgentId}
              onChange={(e) => setMessageAgentId(e.target.value)}
            >
              <option value="">Select agent...</option>
              {running.map((a) => (
                <option key={a.agentId} value={a.agentId}>{a.prompt.slice(0, 40)}{a.prompt.length > 40 ? '...' : ''}</option>
              ))}
            </select>
            <input
              className="flex-1 bg-s2 border border-b1 rounded-[8px] px-3 py-2 text-xs text-fg outline-none"
              placeholder="Type a message to inject into the agent..."
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
            />
            <button
              onClick={handleSend}
              disabled={!messageAgentId || !messageText.trim()}
              className="bg-fg/10 text-fg border border-fg/20 rounded-[8px] px-4 py-2 text-xs font-medium hover:bg-fg/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Live Events Feed */}
      <EventsFeed ws={ws} />
    </div>
  );
}

function KpiCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-s1 border border-b1 rounded-[10px] px-5 py-4 flex flex-col justify-between select-none">
      <span className="text-[10px] font-semibold text-muted uppercase tracking-wider">{label}</span>
      <div className={`text-2xl font-bold tracking-tight leading-none mt-1 ${color}`}>{value}</div>
    </div>
  );
}

function AgentCard({ agent, onCancel, onExpand }: {
  agent: { agentId: string; prompt: string; text: string; provider: string; toolCalls: number; inputTokens: number; outputTokens: number; startedAt: number; status: string };
  onCancel: () => void;
  onExpand: () => void;
}) {
  const elapsed = Date.now() - agent.startedAt;
  const tokenTotal = agent.inputTokens + agent.outputTokens;
  const statusColor = agent.status === 'running' ? 'text-yellow' : 'text-green';

  return (
    <div className="bg-s1 border border-b1 rounded-[10px] p-4 hover:border-b2 transition-colors cursor-pointer select-none" onClick={onExpand}>
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-[6px] h-[6px] rounded-full shrink-0 ${agent.status === 'running' ? 'bg-yellow animate-pulse' : 'bg-green'}`} />
        <span className="text-[12.5px] font-medium text-fg truncate flex-1">{agent.prompt}</span>
        <span className="text-[9px] font-mono bg-s3 px-1.5 py-0.5 rounded-[3px] text-muted shrink-0">{agent.provider}</span>
        <span className={`text-[10px] font-mono ${statusColor}`}>{agent.status}</span>
        {agent.status === 'running' && (
          <button
            className="text-[10px] text-red/70 hover:text-red font-mono shrink-0"
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
          >
            Cancel
          </button>
        )}
      </div>
      <div className="text-[10.5px] text-muted font-mono mb-2">
        {formatDuration(elapsed)} · {agent.toolCalls} tools · {formatTokenCount(tokenTotal)} tok
      </div>
      {agent.text && (
        <div className="text-[11px] text-text2 line-clamp-2 font-mono leading-relaxed">{agent.text.slice(-200)}</div>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m${secs % 60}s`;
}

function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function EventsFeed({ ws }: { ws: any }) {
  const [events, setEvents] = useState<any[]>([]);

  if (!ws) return null;

  // Subscribe to agent events
  const eventTypes = ['agent-start', 'agent-text-delta', 'agent-done', 'agent-error', 'agent-tool-call'];
  eventTypes.forEach(type => {
    ws.on(type, (event: any) => {
      setEvents(prev => [{ ...event, _type: type }, ...prev].slice(0, 30));
    });
  });

  if (events.length === 0) return null;

  return (
    <div>
      <div className="h-px bg-b1 my-5" />
      <div className="text-[11.5px] font-medium text-muted mb-2.5">Live Agent Events</div>
      {events.slice(0, 15).map((event, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-1.5 rounded-lg mb-0.5 hover:bg-s2">
          <div className={`w-[6px] h-[6px] rounded-full shrink-0 ${
            event._type === 'agent-start' ? 'bg-yellow' :
            event._type === 'agent-done' ? 'bg-green' :
            event._type === 'agent-error' ? 'bg-red' :
            event._type === 'agent-tool-call' ? 'bg-fg' :
            'bg-muted2'
          }`} />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] text-text font-mono">{event._type}</div>
            <div className="text-xs text-muted truncate">
              {event.prompt || event.message || ''}
            </div>
          </div>
          <span className="text-[10px] text-muted font-mono">
            {new Date(event.timestamp).toLocaleTimeString()}
          </span>
        </div>
      ))}
    </div>
  );
}
