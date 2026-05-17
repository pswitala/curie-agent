import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { JsonRpcClient } from './jsonrpc-client.js';
import { WsClient } from './ws-client.js';

interface ApiContext {
  rpc: JsonRpcClient | null;
  ws: WsClient | null;
  connected: boolean;
}

const ApiContext = createContext<ApiContext>({ rpc: null, ws: null, connected: false });

export function useApi(): ApiContext {
  return useContext(ApiContext);
}

export interface ApiProviderProps {
  children: ReactNode;
}

export function ApiProvider({ children }: ApiProviderProps) {
  const [context, setContext] = useState<ApiContext>({ rpc: null, ws: null, connected: false });

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token')
      || localStorage.getItem('daemon-token')
      || '';
    if (!token) return;

    // Save token for subsequent visits
    localStorage.setItem('daemon-token', token);

    const baseUrl = window.location.origin;
    const rpc = new JsonRpcClient(baseUrl, token);
    const ws = new WsClient(baseUrl, token);

    setContext({ rpc, ws, connected: false });

    ws.connect();

    const unsubscribe = ws.on('connection-status', (evt) => {
      setContext(prev => ({ ...prev, connected: !!(evt as any).connected }));
    });

    const checkInterval = setInterval(() => {
      setContext(prev => ({ ...prev, connected: ws.isConnected() }));
    }, 2000);

    return () => {
      unsubscribe();
      clearInterval(checkInterval);
      ws.disconnect();
    };
  }, []);

  return (
    <ApiContext.Provider value={context}>
      {children}
    </ApiContext.Provider>
  );
}
