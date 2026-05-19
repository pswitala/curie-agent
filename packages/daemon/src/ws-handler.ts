import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { EventBus, Event } from '@curie-agent/core';
import { validateTokenWs } from './auth.js';

export interface WsClientInfo {
  ws: WebSocket;
  id: string;
  type: 'tui' | 'web' | 'unknown';
  sessionFilter?: string;
}

export class WsHandler {
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, WsClientInfo>();

  constructor(private eventBus: EventBus) {}

  setup(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req: import('node:http').IncomingMessage) => {
      const url = new URL(req.url ?? '/', `http://localhost`);
      const token = url.searchParams.get('token');
      const clientType = url.searchParams.get('client') as 'tui' | 'web' | null;
      const origin = req.headers.origin ?? '(none)';

      console.log(`[ws] connection from origin=${origin} token=${token ? 'present' : 'missing'}`);

      if (!token) {
        ws.close(4001, 'Missing token');
        return;
      }

      if (!validateTokenWs(url)) {
        console.log(`[ws] connection rejected: token mismatch`);
        ws.close(4003, 'Invalid token');
        return;
      }

      const clientId = crypto.randomUUID();
      this.clients.set(ws, {
        ws,
        id: clientId,
        type: clientType === 'tui' || clientType === 'web' ? clientType : 'unknown',
      });

      // Subscribe to all event types
      const handlers: Array<() => void> = [];
      const eventTypes: Array<Event['type']> = [
        'user-prompt', 'assistant-delta', 'assistant-stop', 'tool-call',
        'tool-result', 'approval-request', 'approval-decision', 'usage',
        'error', 'session-start', 'session-stop', 'hook', 'status',
        'session-resumed', 'context-warning', 'thinking-delta',
      ];
      // New event types not yet in core Event type — subscribe as unknown
      const newEventTypes: Array<string> = [
        'cron-task-fired', 'heartbeat-brief', 'channel-updated',
        'mcp-status', 'daemon-ready', 'config-changed',
      ];

      for (const type of eventTypes) {
        handlers.push(this.eventBus.subscribe(type, (event: Event) => {
          if (ws.readyState === WebSocket.OPEN) {
            console.log(`[ws] broadcast type=${event.type} id=${event.id}`);
            ws.send(JSON.stringify(event));
          }
        }));
      }

      // Subscribe to new event types (cast needed — not yet in core Event type)
      for (const type of newEventTypes) {
        handlers.push(this.eventBus.subscribe(
          type as any,
          (event: Event) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(event));
            }
          }
        ));
      }

      // Handle client messages (subscribe filter, RPC commands)
      ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString()) as {
            type?: string;
            session?: string;
            method?: string;
            params?: Record<string, unknown>;
            id?: string | number;
          };

          if (msg.type === 'subscribe') {
            // Store session filter for future filtering
            const info = this.clients.get(ws);
            if (info && msg.session) {
              info.sessionFilter = msg.session;
            }
          }
          // Future: JSON-RPC over WebSocket (for commands, not just events)
        } catch {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        for (const unsubscribe of handlers) {
          unsubscribe();
        }
      });

      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });
  }

  getServer(): WebSocketServer | null {
    return this.wss;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  /** Send a message to a specific client. */
  sendTo(ws: WebSocket, data: unknown): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }
}
