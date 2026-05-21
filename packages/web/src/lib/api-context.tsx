import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { JsonRpcClient } from './jsonrpc-client.js';
import { WsClient } from './ws-client.js';

type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

interface ApiContext {
  rpc: JsonRpcClient | null;
  ws: WsClient | null;
  connected: boolean;
  connectionStatus: ConnectionStatus;
  token: string | null;
  setToken: (token: string) => void;
}

const ApiContext = createContext<ApiContext>({
  rpc: null,
  ws: null,
  connected: false,
  connectionStatus: 'disconnected',
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
    connectionStatus: ConnectionStatus;
  }>({ rpc: null, ws: null, connected: false, connectionStatus: 'disconnected' });

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
      setContextState({ rpc: null, ws: null, connected: false, connectionStatus: 'disconnected' });
      return;
    }

    const baseUrl = window.location.origin;
    const rpc = new JsonRpcClient(baseUrl, token);
    const ws = new WsClient(baseUrl, token);

    setContextState({ rpc, ws, connected: false, connectionStatus: 'reconnecting' });

    ws.connect();

  const unsubscribe = ws.on('connection-status', (evt) => {
    const connected = !!(evt as any).connected;
    let status: ConnectionStatus;
    if (connected) {
      status = 'connected';
    } else if (ws.isReconnecting()) {
      status = 'reconnecting';
    } else {
      status = 'disconnected';
    }
    setContextState(prev => ({ ...prev, connected, connectionStatus: status }));
  });

    const checkInterval = setInterval(() => {
      const isConnected = ws.isConnected();
      setContextState(prev => ({
        ...prev,
        connected: isConnected,
        connectionStatus: isConnected ? 'connected' : prev.connectionStatus === 'reconnecting' ? 'reconnecting' : 'disconnected',
      }));
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
    connectionStatus: contextState.connectionStatus,
    token,
    setToken,
  };

  return (
    <ApiContext.Provider value={value}>
      {children}
    </ApiContext.Provider>
  );
}
