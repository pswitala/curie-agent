export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for browsers without crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class JsonRpcClient {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = generateId();
    const response = await fetch(`${this.baseUrl}/api/json-rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params } as JsonRpcRequest),
    });

    const data = await response.json();
    if ('error' in data) {
      throw new Error(data.error.message);
    }
    return data.result;
  }

  async sessionList(): Promise<unknown> {
    return this.request('session.list');
  }

  async sessionGet(id: string): Promise<unknown> {
    return this.request('session.get', { id });
  }

  async sessionStats(): Promise<unknown> {
    return this.request('session.stats');
  }

  async sessionSend(id: string, text: string, type?: string): Promise<unknown> {
    return this.request('session.send', { id, text, type });
  }

  async sessionCancel(id: string): Promise<unknown> {
    return this.request('session.cancel', { id });
  }

  async sessionResume(id?: string): Promise<unknown> {
    return this.request('session.resume', id ? { id } : undefined);
  }

  async configGet(key: string): Promise<unknown> {
    return this.request('config.get', { key });
  }

  async configSet(key: string, value: unknown): Promise<unknown> {
    return this.request('config.set', { key, value });
  }

  async providerList(): Promise<unknown> {
    return this.request('provider.list');
  }

  async daemonStatus(): Promise<unknown> {
    return this.request('daemon.status');
  }

  async daemonShutdown(): Promise<unknown> {
    return this.request('daemon.shutdown');
  }

  async cronList(type?: string, status?: string): Promise<unknown> {
    return this.request('cron.list', { type, status });
  }

  async cronCreate(type: 'reminder' | 'task', message: string, scheduledAt: number): Promise<unknown> {
    return this.request('cron.create', { type, message, scheduledAt });
  }

  async cronCancel(id: string): Promise<unknown> {
    return this.request('cron.cancel', { id });
  }

  async cronClear(): Promise<unknown> {
    return this.request('cron.clear');
  }

  async heartbeatRun(scheduleType?: string): Promise<unknown> {
    return this.request('heartbeat.run', scheduleType ? { scheduleType } : undefined);
  }

  async heartbeatStatus(): Promise<unknown> {
    return this.request('heartbeat.status');
  }

  async channelList(): Promise<unknown> {
    return this.request('channel.list');
  }

  async channelGet(channelId: string): Promise<unknown> {
    return this.request('channel.get', { channelId });
  }

  async approvalList(sessionId?: string): Promise<unknown> {
    return this.request('approval.pending', sessionId ? { sessionId } : undefined);
  }

  async approvalDecide(toolCallId: string, decision: 'allow' | 'deny'): Promise<unknown> {
    return this.request('approval.decide', { toolCallId, decision });
  }

  async mcpList(): Promise<unknown> {
    return this.request('mcp.list');
  }
}
