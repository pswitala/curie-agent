import { homedir } from 'node:os';
import { join } from 'node:path';
import { Method } from '@curie-agent/protocol';
import { TurnLoop } from '@curie-agent/core';
import { EventBus } from '@curie-agent/core';
import type { SessionStore, SettingsManager, Event, ProviderStream, Tool, CurieSettings } from '@curie-agent/core';
import type { ProviderFactory } from './server.js';
import type { DaemonApp } from './daemon-app.js';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result: unknown;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: string | number;
  error: { code: number; message: string };
}

export class JsonRpcHandler {
  private turnLoops: Map<string, TurnLoop> = new Map();

  constructor(
    private sessionStore: SessionStore,
    private settingsManager: SettingsManager,
    private sharedEventBus: EventBus,
    private createProvider?: ProviderFactory,
    private tools: Tool[] = [],
    private daemonApp?: DaemonApp,
    private systemPrompt?: string,
  ) {
    // Load settings on init
    this.settingsManager.load();
  }

  async handle(request: JsonRpcRequest): Promise<JsonRpcResponse | JsonRpcError> {
    const { id, method, params } = request;

    try {
      let result: unknown;

      switch (method) {
        case Method.SESSION_LIST:
          result = this.sessionStore.list();
          break;

        case Method.SESSION_GET: {
          const idParam = this.getStringParam(params, 'id');
          if (!idParam) return this.paramError('id');
          const info = this.sessionStore.load(idParam);
          if (!info) return { jsonrpc: '2.0', id, error: { code: -32602, message: `Session ${idParam} not found` } };
          const events = this.sessionStore.loadEvents(idParam);
          result = { info, events };
          break;
        }

        case Method.SESSION_SEND: {
          const sessionId = this.getStringParam(params, 'id');
          const text = this.getStringParam(params, 'text');
          if (!text) return this.paramError('text');
          // If no sessionId provided, create a new session and return it
          // immediately so the client can subscribe before events start.
          // The turn loop runs asynchronously in the background.
          if (!sessionId) {
            const settings = this.settingsManager.get();
            const session = this.sessionStore.create(
              process.cwd(),
              settings.model_override || settings.model,
              settings.current_provider || 'unknown',
            );
            // Start turn loop in background — events stream via WS
            if (this.daemonApp) {
              this.daemonApp.channelManager.send(session.id, text).then(res => {
                console.log(`[jsonrpc] session.send completed sessionId=${session.id} status=${res.status}`);
              }).catch(err => {
                console.error(`[jsonrpc] session.send error sessionId=${session.id}:`, err);
              });
            } else {
              this.handleSend(session.id, text).then(res => {
                console.log(`[jsonrpc] session.send completed sessionId=${session.id} status=${res.status}`);
              }).catch(err => {
                console.error(`[jsonrpc] session.send error sessionId=${session.id}:`, err);
              });
            }
            result = { sessionId: session.id, status: 'started' };
            break;
          }
          console.log(`[jsonrpc] session.send id=${sessionId} text="${text.slice(0, 50)}"`);
          // Start turn loop in background — events stream via WS
          if (this.daemonApp) {
            this.daemonApp.channelManager.send(sessionId, text).then(res => {
              console.log(`[jsonrpc] session.send completed id=${sessionId} status=${res.status}`);
            }).catch(err => {
              console.error(`[jsonrpc] session.send error id=${sessionId}:`, err);
            });
          } else {
            this.handleSend(sessionId, text).then(res => {
              console.log(`[jsonrpc] session.send completed id=${sessionId} status=${res.status}`);
            }).catch(err => {
              console.error(`[jsonrpc] session.send error id=${sessionId}:`, err);
            });
          }
          result = { sessionId, status: 'started' };
          break;
        }

           case Method.SESSION_CANCEL: {
          const sessionId = this.getStringParam(params, 'id');
          if (!sessionId) return this.paramError('id');
          if (this.daemonApp) {
            this.daemonApp.channelManager.cancel(sessionId);
          } else {
            const loop = this.turnLoops.get(sessionId);
            if (loop) {
              (loop as any).abort = true;
              (loop as any).abortController?.abort();
            }
          }
          result = { status: 'cancelled' };
          break;
        }

        case Method.SESSION_RESUME: {
          const resumeId = this.getStringParam(params, 'id');
          // Resume session: if no ID, get the latest session
          const targetId = resumeId || this.sessionStore.list().pop()?.id;
          if (!targetId) return this.paramError('id');
          result = { status: 'resumed', sessionId: targetId };
          break;
        }

        case Method.CONFIG_GET: {
          const key = this.getStringParam(params, 'key');
          if (!key) return this.paramError('key');
          const settings = this.settingsManager.get();
          result = this.getNestedValue(settings, key);
          break;
        }

        case Method.CONFIG_SET: {
          const key = this.getStringParam(params, 'key');
          const value = params?.value;
          if (!key) return this.paramError('key');
          if (value === undefined) return this.paramError('value');
          this.settingsManager.update({ [key]: value } as never);
          this.settingsManager.save();
          result = { status: 'ok', key, value };
          break;
        }

        case Method.TOOL_REGISTRY:
          result = { tools: this.tools.map((t: Tool) => t.definition) };
          break;

        case Method.PROVIDER_LIST: {
          const providers = this.settingsManager.get().providers;
          result = Object.entries(providers).map(([name, cfg]) => ({
            name,
            model: cfg.model,
            url: cfg.url,
            configured: !!cfg.api_key,
          }));
          break;
        }

        case Method.APPROVAL_PENDING: {
          // Alias for approval.list — return real pending approvals
          const sessionId = this.getStringParam(params, 'sessionId');
          result = this.daemonApp?.approvalTracker.list(sessionId) ?? [];
          break;
        }

        case Method.APPROVAL_DECIDE: {
          const toolCallId = this.getStringParam(params, 'toolCallId');
          const decision = this.getStringParam(params, 'decision') as 'allow' | 'deny';
          if (!toolCallId) return this.paramError('toolCallId');
          if (!decision || !['allow', 'deny'].includes(decision)) return this.paramError('decision');
          if (this.daemonApp) {
            const res = this.daemonApp.approvalTracker.decide(toolCallId, decision);
            result = res;
          } else {
            result = { status: 'decided' };
          }
          break;
        }

        // Daemon lifecycle
        case Method.DAEMON_STATUS:
          result = {
            status: 'ok',
            version: '0.2.4',
            clients: 0, // will be set by server
          };
          break;

        case Method.DAEMON_SHUTDOWN:
          result = { status: 'shutting-down' };
          // Server will handle shutdown after response
          break;

        // Cron management
        case Method.CRON_LIST: {
          const type = this.getStringParam(params, 'type');
          const status = this.getStringParam(params, 'status');
          if (this.daemonApp) {
            const tasks = this.daemonApp.cronManager.listReminders(
              status as 'pending' | 'fired' | 'executing' | 'completed' | 'failed' | 'cancelled' | undefined
            );
            result = type ? tasks.filter(t => t.type === type) : tasks;
          } else {
            result = [];
          }
          break;
        }

        case Method.CRON_CREATE: {
          const type = this.getStringParam(params, 'type');
          const message = this.getStringParam(params, 'message');
          const scheduledAt = params?.scheduledAt as number | undefined;
          if (!type || !message || !scheduledAt) return this.paramError('type, message, scheduledAt');
          if (this.daemonApp) {
            if (type === 'reminder') {
              const task = this.daemonApp.cronManager.createReminder(message, scheduledAt);
              result = task;
            } else if (type === 'task') {
              const task = this.daemonApp.cronManager.createTask(message, scheduledAt);
              result = task;
            }
          }
          break;
        }

        case Method.CRON_CANCEL: {
          const taskId = this.getStringParam(params, 'id');
          if (!taskId) return this.paramError('id');
          if (this.daemonApp) {
            result = { cancelled: this.daemonApp.cronManager.cancelReminder(taskId) };
          }
          break;
        }

        case Method.CRON_CLEAR:
          if (this.daemonApp) {
            result = { removed: this.daemonApp.cronManager.clearCompleted() };
          }
          break;

        // Heartbeat
        case Method.HEARTBEAT_RUN: {
          const scheduleType = this.getStringParam(params, 'scheduleType');
          if (this.daemonApp) {
            result = await this.daemonApp.runHeartbeat(
              scheduleType as 'intraday' | 'daily' | 'weekly' | 'monthly' | 'dreaming' | undefined
            );
          }
          break;
        }

        case Method.HEARTBEAT_STATUS: {
          const settings = this.settingsManager.get();
          result = {
            schedule: settings.heartbeat?.schedule || 'off',
            intraday: settings.heartbeat?.intraday,
            daily: settings.heartbeat?.daily,
            weekly: settings.heartbeat?.weekly,
            monthly: settings.heartbeat?.monthly,
            dreaming: settings.heartbeat?.dreaming,
          };
          break;
        }

        // Channels
        case Method.CHANNEL_LIST:
          if (this.daemonApp) {
            result = this.daemonApp.channelManager.listChannels();
          } else {
            result = [];
          }
          break;

        case Method.CHANNEL_GET: {
          const channelId = this.getStringParam(params, 'channelId');
          if (!channelId) return this.paramError('channelId');
          if (this.daemonApp) {
            const channel = this.daemonApp.channelManager.getChannel(channelId);
            if (!channel) return { jsonrpc: '2.0', id, error: { code: -32602, message: `Channel ${channelId} not found` } };
            result = channel;
          }
          break;
        }

        // MCP
        case Method.MCP_LIST:
          result = { servers: this.daemonApp?.mcpStatus ?? [] };
          break;

        // Not yet implemented
        case Method.ORCHESTRA_PANES:
        case Method.ORCHESTRA_BROADCAST:
        case Method.WIKI_QUERY:
        case Method.WIKI_PAGE_GET:
          result = { status: 'not-implemented', method };
          break;

        default:
          return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
      }

      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Internal error',
        },
      };
    }
  }

  private async handleSend(sessionId: string, text: string): Promise<Record<string, unknown>> {
    if (!this.createProvider) {
      return { status: 'error: no provider configured' };
    }

    const settings = this.settingsManager.get();
    const provider = this.createProvider(settings);
    const sessionInfo = this.sessionStore.load(sessionId);

    // Build the turn loop config
    const loop = new TurnLoop({
      provider,
      model: settings.model_override || settings.model,
      tools: this.tools,
      cwd: sessionInfo?.cwd || join(homedir(), '.curie-agent'),
      settings,
      approvalMode: settings.mode || 'auto',
      effort: settings.effort,
      sessionId: sessionId,
      resume: !!sessionId,
      system: this.systemPrompt,
    }, this.sessionStore);

    // Store the loop for potential cancellation
    this.turnLoops.set(sessionId, loop);

    // Bridge the turn loop's event bus to the shared daemon event bus
    // so that WS clients receive real-time events.
    const eventTypes: Event['type'][] = [
      'user-prompt', 'assistant-delta', 'assistant-stop', 'tool-call',
      'tool-result', 'approval-request', 'approval-decision', 'usage',
      'error', 'session-start', 'session-stop', 'hook', 'status',
      'session-resumed', 'context-warning', 'thinking-delta',
    ];
    const unsubscribes: Array<() => void> = [];
    for (const type of eventTypes) {
      unsubscribes.push(loop.eventBus.subscribe(type, (event: Event) => {
        this.sharedEventBus.emit({ ...event, sessionId } as Event & { sessionId?: string });
      }));
    }

    try {
      const result = await loop.run(text);
      return { status: 'completed', sessionId: result.sessionId, events: result.events.length };
    } catch (err) {
      return { status: 'error', error: err instanceof Error ? err.message : 'unknown' };
    } finally {
      this.turnLoops.delete(sessionId);
      for (const unsub of unsubscribes) unsub();
    }
  }

  private getStringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
    return params?.[key] as string | undefined;
  }

  private paramError(key: string): JsonRpcError {
    return { jsonrpc: '2.0', id: 0, error: { code: -32602, message: `Missing required parameter: ${key}` } };
  }

  /** Get a nested value from an object using dot notation (e.g. "providers.anthropic.model"). */
  private getNestedValue(obj: unknown, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current == null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
}
