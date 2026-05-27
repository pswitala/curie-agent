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

  async identitySetup(params: {
    provider: string;
    apiKey: string;
    model: string;
    soulName: string;
    soulVibe: string;
    userName: string;
    userTimezone: string;
    userLanguages: string;
  }): Promise<unknown> {
    return this.request('identity.setup', params);
  }

  // Subagent management
  async subagentSpawn(params: {
    sessionId: string;
    prompt: string;
    provider?: string;
    mode?: string;
    effort?: string;
    model?: string;
    tools?: string[];
  }): Promise<unknown> {
    return this.request('subagent.spawn', params);
  }

  async subagentList(params?: { sessionId?: string; status?: string }): Promise<unknown> {
    return this.request('subagent.list', params);
  }

  async subagentCancel(agentId: string): Promise<unknown> {
    return this.request('subagent.cancel', { agentId });
  }

  async subagentStats(agentId: string): Promise<unknown> {
    return this.request('subagent.stats', { agentId });
  }

  async subagentSend(agentId: string, message: string): Promise<unknown> {
    return this.request('subagent.send', { agentId, message });
  }

  // Task scheduling (from WebUI)
  async taskSchedule(params: {
    instruction: string;
    scheduled_at: string;
    provider?: string;
    model?: string;
    effort?: 'low' | 'medium' | 'high' | 'max' | 'auto';
  }): Promise<{ taskId: string; scheduledAt: string; instruction: string }> {
    return this.request('task.schedule', params) as Promise<{ taskId: string; scheduledAt: string; instruction: string }>;
  }

  // Unified task (todo) management for Kanban board
  async todoList(params?: {
    status?: string;
    mode?: string;
    scope?: string;
    priority?: string;
  }): Promise<unknown> {
    return this.request('todo.list', params);
  }

  async todoCreate(params: {
    title: string;
    description?: string;
    mode?: 'human' | 'agent' | 'notify';
    scope?: 'personal' | 'project';
    priority?: 'low' | 'medium' | 'high' | 'critical';
    status?: string;
    tags?: string[];
    scheduled_at?: number;
  }): Promise<unknown> {
    return this.request('todo.create', params);
  }

  async todoUpdate(params: {
    id: string;
    status?: string;
    priority?: string;
    title?: string;
    description?: string;
    tags?: string[];
    mode?: 'human' | 'agent' | 'notify';
    scheduled_at?: number;
  }): Promise<unknown> {
    return this.request('todo.update', params);
  }

  async todoRemove(id: string): Promise<unknown> {
    return this.request('todo.remove', { id });
  }
}
