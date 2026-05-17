/// JSON-RPC + WebSocket client for connecting the TUI to the daemon.

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface WsEvent {
  type: string;
  id: string;
  timestamp: number;
  [key: string]: unknown;
}

export type EventHandler = (event: WsEvent) => void;

export class DaemonRpcClient {
  private id = 0;

  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = ++this.id;
    const res = await fetch(`${this.baseUrl}/api/json-rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params } satisfies JsonRpcRequest),
    });

    const data = await res.json();
    if ('error' in data) {
      throw new Error(data.error?.message ?? 'RPC error');
    }
    return data.result;
  }

  // Session
  async sessionList(): Promise<unknown> {
    return this.request('session.list');
  }

  async sessionGet(id: string): Promise<unknown> {
    return this.request('session.get', { id });
  }

  async sessionSend(id: string, text: string): Promise<unknown> {
    return this.request('session.send', { id, text });
  }

  async sessionCancel(id: string): Promise<unknown> {
    return this.request('session.cancel', { id });
  }

  async sessionResume(id?: string): Promise<unknown> {
    return this.request('session.resume', id ? { id } : undefined);
  }

  // Config
  async configGet(key: string): Promise<unknown> {
    return this.request('config.get', { key });
  }

  async configSet(key: string, value: unknown): Promise<unknown> {
    return this.request('config.set', { key, value });
  }

  // Daemon
  async daemonStatus(): Promise<unknown> {
    return this.request('daemon.status');
  }

  // Channels
  async channelList(): Promise<unknown> {
    return this.request('channel.list');
  }

  async channelGet(channelId: string): Promise<unknown> {
    return this.request('channel.get', { channelId });
  }

  // Heartbeat
  async heartbeatRun(scheduleType?: string): Promise<unknown> {
    return this.request('heartbeat.run', scheduleType ? { scheduleType } : undefined);
  }

  async heartbeatStatus(): Promise<unknown> {
    return this.request('heartbeat.status');
  }

  // Cron
  async cronList(type?: string, status?: string): Promise<unknown> {
    return this.request('cron.list', { type, status });
  }

  async cronClear(): Promise<unknown> {
    return this.request('cron.clear');
  }

  // Approvals
  async approvalList(sessionId?: string): Promise<unknown> {
    return this.request('approval.pending', sessionId ? { sessionId } : undefined);
  }

  async approvalDecide(toolCallId: string, decision: 'allow' | 'deny'): Promise<unknown> {
    return this.request('approval.decide', { toolCallId, decision });
  }

  // MCP
  async mcpList(): Promise<unknown> {
    return this.request('mcp.list');
  }

  // Tools
  async toolRegistry(): Promise<unknown> {
    return this.request('tool.registry');
  }

  // Providers
  async providerList(): Promise<unknown> {
    return this.request('provider.list');
  }
}

/// WebSocket client for receiving daemon events.
export class DaemonWsClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private handlers = new Map<string, Set<EventHandler>>();
  private connected = false;

  constructor(
    private url: string,
    private token: string,
  ) {}

  connect(): void {
    if (this.ws) return;

    const wsUrl = `${this.url.replace('http', 'ws')}/ws?token=${this.token}&client=tui`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as WsEvent;
        this.dispatch(data);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.connected = false;
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  on(eventType: string, handler: EventHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  private dispatch(event: WsEvent): void {
    const typeHandlers = this.handlers.get(event.type);
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event);
        } catch {
          // Ignore handler errors
        }
      }
    }

    // Wildcard handlers
    const allHandlers = this.handlers.get('*');
    if (allHandlers) {
      for (const handler of allHandlers) {
        try {
          handler(event);
        } catch {
          // Ignore handler errors
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
      this.connect();
    }, this.reconnectDelay);
  }
}
