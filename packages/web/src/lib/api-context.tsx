import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { JsonRpcClient } from './jsonrpc-client.js';
import { WsClient } from './ws-client.js';

interface ApiContext {
  rpc: JsonRpcClient | null;
  ws: WsClient | null;
  connected: boolean;
  token: string | null;
  setToken: (token: string) => void;
}

const ApiContext = createContext<ApiContext>({
  rpc: null,
  ws: null,
  connected: false,
  token: null,
  setToken: () => {},
});

export function useApi(): ApiContext {
  return useContext(ApiContext);
}

export interface ApiProviderProps {
  children: ReactNode;
}

export function ApiProvider({ children }: ApiProviderProps) {
  const [token, setTokenState] = useState<string | null>(null);
  const [contextState, setContextState] = useState<{
    rpc: JsonRpcClient | null;
    ws: WsClient | null;
    connected: boolean;
  }>({ rpc: null, ws: null, connected: false });

  // Initial load: parse URL or fallback to localStorage
  useEffect(() => {
    const initialToken = new URLSearchParams(window.location.search).get('token')
      || localStorage.getItem('daemon-token')
      || '';
    if (initialToken) {
      localStorage.setItem('daemon-token', initialToken);
      setTokenState(initialToken);
    }
  }, []);

  const setToken = (newToken: string) => {
    localStorage.setItem('daemon-token', newToken);
    setTokenState(newToken);
  };

  useEffect(() => {
    if (!token) {
      setContextState({ rpc: null, ws: null, connected: false });
      return;
    }

    const baseUrl = window.location.origin;
    const rpc = new JsonRpcClient(baseUrl, token);
    const ws = new WsClient(baseUrl, token);

    setContextState({ rpc, ws, connected: false });

    ws.connect();

    const unsubscribe = ws.on('connection-status', (evt) => {
      setContextState(prev => ({ ...prev, connected: !!(evt as any).connected }));
    });

    const checkInterval = setInterval(() => {
      setContextState(prev => ({ ...prev, connected: ws.isConnected() }));
    }, 2000);

    return () => {
      unsubscribe();
      clearInterval(checkInterval);
      ws.disconnect();
    };
  }, [token]);

  const value: ApiContext = {
    rpc: contextState.rpc,
    ws: contextState.ws,
    connected: contextState.connected,
    token,
    setToken,
  };

  return (
    <ApiContext.Provider value={value}>
      {children}
    </ApiContext.Provider>
  );
}
