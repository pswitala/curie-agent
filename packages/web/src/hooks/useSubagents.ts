import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../lib/api-context.js';

export interface SubagentState {
  agentId: string;
  sessionId: string;
  prompt: string;
  provider: string;
  status: 'starting' | 'running' | 'waiting_tool' | 'done' | 'error' | 'cancelled';
  text: string;
  toolCalls: number;
  errors: string[];
  inputTokens: number;
  outputTokens: number;
  startedAt: number;
  doneAt?: number;
}

export function useSubagents() {
  const { rpc, ws } = useApi();
  const [agents, setAgents] = useState<Map<string, SubagentState>>(new Map());

  // Load historical subagents via RPC
  useEffect(() => {
    if (!rpc) return;
    rpc.subagentList()
      .then((data: unknown) => {
        if (!Array.isArray(data)) return;
        const map = new Map<string, SubagentState>();
        for (const row of data as Partial<SubagentState>[]) {
          if (!row.agentId) continue;
          // `subagent.list` omits `errors` entirely and may omit counters — default
          // them so consumers can rely on the declared SubagentState shape.
          map.set(row.agentId, {
            ...row,
            agentId: row.agentId,
            sessionId: row.sessionId ?? '',
            prompt: row.prompt ?? '',
            provider: row.provider ?? 'unknown',
            status: row.status ?? 'done',
            text: row.text ?? '',
            toolCalls: row.toolCalls ?? 0,
            errors: row.errors ?? [],
            inputTokens: row.inputTokens ?? 0,
            outputTokens: row.outputTokens ?? 0,
            startedAt: row.startedAt ?? 0,
          });
        }
        setAgents(map);
      })
      .catch(() => {});
  }, [rpc]);

  // Subscribe to live agent events via WebSocket
  useEffect(() => {
    if (!ws) return;

    const handleAgentStart = (event: any) => {
      setAgents(prev => {
        const next = new Map(prev);
        next.set(event.agentId, {
          agentId: event.agentId,
          sessionId: event.sessionId || '',
          prompt: event.prompt || '',
          provider: event.provider || 'unknown',
          status: 'starting',
          text: '',
          toolCalls: 0,
          errors: [],
          inputTokens: 0,
          outputTokens: 0,
          startedAt: event.timestamp,
        });
        return next;
      });
    };

    const handleTextDelta = (event: any) => {
      setAgents(prev => {
        const next = new Map(prev);
        const agent = next.get(event.agentId);
        if (agent) {
          next.set(event.agentId, { ...agent, text: agent.text + event.text });
        }
        return next;
      });
    };

    const handleToolCall = (event: any) => {
      setAgents(prev => {
        const next = new Map(prev);
        const agent = next.get(event.agentId);
        if (agent) {
          next.set(event.agentId, { ...agent, toolCalls: agent.toolCalls + 1 });
        }
        return next;
      });
    };

    const handleUsage = (event: any) => {
      setAgents(prev => {
        const next = new Map(prev);
        const agent = next.get(event.agentId);
        if (agent) {
          next.set(event.agentId, {
            ...agent,
            inputTokens: agent.inputTokens + (event.inputTokens || 0),
            outputTokens: agent.outputTokens + (event.outputTokens || 0),
          });
        }
        return next;
      });
    };

    const handleDone = (event: any) => {
      setAgents(prev => {
        const next = new Map(prev);
        const agent = next.get(event.agentId);
        if (agent) {
          next.set(event.agentId, {
            ...agent,
            status: 'done',
            text: event.text || agent.text,
            toolCalls: event.toolCalls ?? agent.toolCalls,
            errors: event.errors || [],
            doneAt: event.timestamp,
          });
        }
        return next;
      });
    };

    const handleError = (event: any) => {
      setAgents(prev => {
        const next = new Map(prev);
        const agent = next.get(event.agentId);
        if (agent) {
          next.set(event.agentId, {
            ...agent,
            status: 'error',
            errors: [...(agent.errors || []), event.message],
            doneAt: event.timestamp,
          });
        }
        return next;
      });
    };

    const unsubs = [
      ws.on('agent-start', handleAgentStart),
      ws.on('agent-text-delta', handleTextDelta),
      ws.on('agent-tool-call', handleToolCall),
      ws.on('agent-usage', handleUsage),
      ws.on('agent-done', handleDone),
      ws.on('agent-error', handleError),
    ];

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [ws]);

  const spawn = useCallback(async (params: {
    sessionId: string;
    prompt: string;
    provider?: string;
    mode?: string;
    effort?: string;
    model?: string;
    tools?: string[];
  }) => {
    if (!rpc) return null;
    try {
      return await rpc.subagentSpawn(params);
    } catch (err) {
      console.error('[useSubagents] Spawn failed:', err);
      return null;
    }
  }, [rpc]);

  const cancel = useCallback(async (agentId: string) => {
    if (!rpc) return false;
    try {
      await rpc.subagentCancel(agentId);
      setAgents(prev => {
        const next = new Map(prev);
        const agent = next.get(agentId);
        if (agent) {
          next.set(agentId, { ...agent, status: 'cancelled', doneAt: Date.now() });
        }
        return next;
      });
      return true;
    } catch {
      return false;
    }
  }, [rpc]);

  const send = useCallback(async (agentId: string, message: string) => {
    if (!rpc) return false;
    try {
      await rpc.subagentSend(agentId, message);
      return true;
    } catch {
      return false;
    }
  }, [rpc]);

  const running = Array.from(agents.values()).filter(a => a.status === 'running' || a.status === 'starting');
  const completed = Array.from(agents.values()).filter(a => a.status === 'done');
  const failed = Array.from(agents.values()).filter(a => a.status === 'error');

  return { agents, running, completed, failed, spawn, cancel, send };
}
