import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../lib/api-context.js';
import type { SessionInfo } from './useSession.js';

export function useWebSessions() {
  const { rpc, ws } = useApi();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  const fetchSessions = useCallback(() => {
    if (!rpc) return;
    rpc.sessionList()
      .then((list: any) => {
        if (Array.isArray(list)) {
          setSessions(list as SessionInfo[]);
        }
      })
      .catch(() => {});
  }, [rpc]);

  // Initial fetch
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Refresh on WebSocket session events
  useEffect(() => {
    if (!ws) return;

    const refreshEvents = ['user-prompt', 'assistant-stop', 'error', 'session-start', 'session-resumed'] as const;
    const unsubscribes: Array<() => void> = [];
    for (const eventType of refreshEvents) {
      unsubscribes.push(ws.on(eventType, fetchSessions));
    }

    return () => {
      for (const unsub of unsubscribes) unsub();
    };
  }, [ws, fetchSessions]);

  return { sessions, refetch: fetchSessions };
}
