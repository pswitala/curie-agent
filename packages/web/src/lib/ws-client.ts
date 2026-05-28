export interface WsEvent {
  type: string;
  id: string;
  timestamp: number;
  [key: string]: unknown;
}

export type EventHandler = (event: WsEvent) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private _reconnecting = false;
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private connected = false;

  constructor(
    private url: string,
    private token: string,
  ) {}

  connect(): void {
    if (this.ws) return;

    const wsUrl = `${this.url.replace('http', 'ws')}/ws?token=${this.token}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      this._reconnecting = false;
      this.reconnectDelay = 1000;
      this.dispatch({ type: 'connection-status', id: 'status', timestamp: Date.now(), connected: true });
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as WsEvent;
        this.dispatch(data);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.connected = false;
      this.ws = null;
      if (event.code === 4001 || event.code === 4003) {
        this._reconnecting = false;
        this.dispatch({ type: 'auth-error', id: 'auth', timestamp: Date.now(), code: event.code });
        return;
      }
      this._reconnecting = true;
      this.dispatch({ type: 'connection-status', id: 'status', timestamp: Date.now(), connected: false });
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.connected = false;
      this.dispatch({ type: 'connection-status', id: 'status', timestamp: Date.now(), connected: false });
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
    this._reconnecting = false;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  isReconnecting(): boolean {
    return this._reconnecting;
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

  /** Send a subscribe message to filter events. */
  subscribe(session?: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', session }));
    }
  }

  private dispatch(event: WsEvent): void {
    // Dispatch to type-specific handlers
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

    // Dispatch to wildcard handlers
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
