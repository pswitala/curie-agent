import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../lib/api-context.js';
import type { WsEvent } from '../lib/ws-client.js';

export interface SessionInfo {
  id: string;
  cwd: string;
  model: string;
  provider: string;
  createdAt: number;
  updatedAt: number;
}

export function useSession(sessionId: string | null) {
  const { rpc, ws } = useApi();
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [events, setEvents] = useState<WsEvent[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch session and load history
  useEffect(() => {
    if (!rpc || !sessionId) {
      setInfo(null);
      setEvents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    rpc.sessionGet(sessionId)
      .then((data: any) => {
        if (data?.info) {
          setInfo(data.info as SessionInfo);
        }
        if (data?.events) {
          setEvents(data.events as WsEvent[]);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [rpc, sessionId]);

  // Subscribe to live events via WebSocket
  useEffect(() => {
    if (!ws || !sessionId) return;

    const handleEvent = (event: WsEvent) => {
      // Filter: only process events for this session
      const evtSessionId = (event as any).sessionId || event.id;
      if (evtSessionId && evtSessionId !== sessionId) return;

      setEvents(prev => {
        // Avoid duplicates from WebSocket + history load overlap
        // Only ignore if the exact same event is already in the recent history
        const isDuplicate = prev.slice(-10).some(e => 
          e.timestamp === event.timestamp && 
          e.type === event.type && 
          JSON.stringify(e) === JSON.stringify(event)
        );
        if (isDuplicate) return prev;
        return [...prev, event];
      });
    };

    const unsubscribes: Array<() => void> = [];
    const eventTypes = ['user-prompt', 'assistant-delta', 'assistant-stop', 'tool-call', 'tool-result', 'error', 'status', 'usage', 'thinking-delta'] as const;
    for (const eventType of eventTypes) {
      unsubscribes.push(ws.on(eventType, handleEvent));
    }

    return () => {
      for (const unsub of unsubscribes) unsub();
    };
  }, [ws, sessionId]);

  const addLiveEvent = useCallback((event: WsEvent) => {
    setEvents(prev => [...prev, event]);
  }, []);

  return { info, events, loading, addLiveEvent };
}
