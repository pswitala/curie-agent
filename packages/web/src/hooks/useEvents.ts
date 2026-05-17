import { useCallback } from 'react';
import { useApi } from '../lib/api-context.js';
import type { WsEvent } from '../lib/ws-client.js';

export function useEvents() {
  const { ws, connected } = useApi();

  const on = useCallback((eventType: string, handler: (event: WsEvent) => void) => {
    if (!ws) return () => {};
    return ws.on(eventType, handler);
  }, [ws]);

  const subscribe = useCallback((session?: string) => {
    ws?.subscribe(session);
  }, [ws]);

  return { connected, on, subscribe, client: ws };
}
