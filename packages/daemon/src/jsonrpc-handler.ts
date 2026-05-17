import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { Method } from '@curie-agent/protocol';
import { TurnLoop, parseReminderTime, listSnapshots, revertTo } from '@curie-agent/core';
import { EventBus } from '@curie-agent/core';
import type { SessionStore, SettingsManager, Event, ProviderStream, Tool, CurieSettings } from '@curie-agent/core';
import { listSkills, discoverAllSkills } from '@curie-agent/tools';
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

          if (!this.createProvider) {
            result = { status: 'error: no provider configured' };
            break;
          }

          if (text.startsWith('/')) {
            const targetSessionId = sessionId || this.sessionStore.create(
              process.cwd(),
              this.settingsManager.get().model_override || this.settingsManager.get().model,
              this.settingsManager.get().current_provider || 'unknown',
            ).id;

            this.executeSlashCommand(targetSessionId, text).catch(err => {
              console.error(`[jsonrpc] error executing slash command ${text}:`, err);
            });

            result = { sessionId: targetSessionId, status: 'started' };
            break;
          }

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

          if (key.startsWith('heartbeat') && this.daemonApp) {
            const settings = this.settingsManager.get();
            if (settings.heartbeat?.schedule === 'on') {
              this.daemonApp.cronManager.rescheduleFromSettings({
                HEARTBEAT_INTRADAY: settings.heartbeat.intraday,
                HEARTBEAT_DAILY: settings.heartbeat.daily,
                HEARTBEAT_WEEKLY: settings.heartbeat.weekly,
                HEARTBEAT_MONTHLY: settings.heartbeat.monthly,
                HEARTBEAT_DREAMING: settings.heartbeat.dreaming,
              });
            } else if (settings.heartbeat?.schedule === 'off') {
              const pendingHbs = this.daemonApp.cronManager.listReminders('pending').filter(t => t.type === 'heartbeat');
              for (const t of pendingHbs) {
                this.daemonApp.cronManager.cancelReminder(t.id);
              }
            }
          }

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

  private async executeSlashCommand(sessionId: string, text: string): Promise<void> {
    // 1. Emit user-prompt event so it appears in UI
    const promptEvent: Event = {
      type: 'user-prompt',
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      text,
    } as any;
    this.sharedEventBus.emit({ ...promptEvent, sessionId } as any);
    this.sessionStore.appendEvent(sessionId, { ...promptEvent, sessionId } as any);

    // Helpers to emit response
    const emitDelta = (chunk: string) => {
      const deltaEvent: Event = {
        type: 'assistant-delta',
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        text: chunk,
      } as any;
      this.sharedEventBus.emit({ ...deltaEvent, sessionId } as any);
      this.sessionStore.appendEvent(sessionId, { ...deltaEvent, sessionId } as any);
    };

    const emitStop = () => {
      const stopEvent: Event = {
        type: 'assistant-stop',
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      } as any;
      this.sharedEventBus.emit({ ...stopEvent, sessionId } as any);
      this.sessionStore.appendEvent(sessionId, { ...stopEvent, sessionId } as any);
    };

    try {
      const parts = text.slice(1).split(' ');
      const command = parts[0]?.toLowerCase() || '';
      const args = parts.slice(1).join(' ').trim();
      switch (command) {
        case 'help': {
          const helpText = `### Available Slash Commands

**General & Status**
* \`/status\` — Show version, active model, provider, approval mode, CWD, active settings, and pricing.
* \`/help\` — List all available commands with usage details.

**Model & Config**
* \`/provider <name>\` — Switch AI provider (\`anthropic | openai | google | local | openrouter | ollama\`).
* \`/model <name>\` — Switch active model. Or use subcommands:
  * \`/model pricing <in;out>\` — Customize pricing format per million tokens.
  * \`/model window <tokens>\` — Adjust model context window capacity.
* \`/effort <low|medium|high|max|auto>\` — Set reasoning effort level.
* \`/mode <manual|plan|auto-edit|yolo>\` — Set agent approval mode.
* \`/tools <max_tools> [max_websearch]\` — Configure dynamic tool limit per turn.
* \`/websearch <limit>\` — Configure maximum web search limits per turn.

**Skills & MCP**
* \`/skill [name]\` — List all globally and project-registered skills or view a specific skill's instructions.
* \`/mcp [list|reload]\` — List connected Model Context Protocol (MCP) servers and their tools, or reload configuration.

**Memory & Context**
* \`/memory [status|add <text>]\` — View active memory files or add new memories to be organized on next turn.
* \`/context [auto [on|off|threshold N|warn N|pricing on/off]]\` — View visual token capacity fill percentage bar or configure auto-compaction.

**Automation & Scheduling**
* \`/remind <message at time>\` — Create a scheduled reminder (e.g., \`/remind review current pull request in 30 mins\`).
* \`/cron [list|delete <id>|clear]\` — View list of active reminders or manage completed ones.
* \`/heartbeat [status|enable|disable|now|daily <H:MM>|weekly <day@H:MM>...]\` — Control scheduled heartbeat cycles or run immediately.
* \`/task [create <instruction at time>|list [status]|delete <id>]\` — Schedule background autonomous agent tasks.

**Workspace Safety**
* \`/snapshots\` — List Git-backed state snapshots.
* \`/revert <index>\` — Revert workspace to a specific snapshot index.`;
          emitDelta(helpText);
          break;
        }

        case 'status': {
          const settings = this.settingsManager.get();
          const provider = settings.current_provider || 'anthropic';
          const pConfig = settings.providers?.[provider as any];
          const pricing = pConfig?.model_cost
            ? `\`${pConfig.model_cost}\` (per million)`
            : 'Not configured';

          const statusText = `### Curie Agent Status
* **Version:** \`0.2.4\`
* **Active Model:** \`${settings.model}\`
* **Active Provider:** \`${provider}\`
* **Approval Mode:** \`${settings.mode || 'auto-edit'}\`
* **Reasoning Effort:** \`${settings.effort || 'auto'}\`
* **Workspace CWD:** \`${process.cwd()}\`
* **Tools per Turn Limit:** \`${settings.tools_per_call || 10}\`
* **Web Search per Turn Limit:** \`${settings.websearch_per_call || 5}\`
* **Model Context Window:** \`${(pConfig?.model_context_window || 200000).toLocaleString()} tokens\`
* **Model Pricing:** ${pricing}
* **Auto-Compaction:** \`${settings.auto_compact?.enabled || 'on'}\` (Threshold: \`${settings.auto_compact?.threshold ?? 80}%\`)`;
          emitDelta(statusText);
          break;
        }

        case 'model': {
          const settings = this.settingsManager.get();
          const provider = settings.current_provider || 'anthropic';
          if (!settings.providers) settings.providers = {} as any;
          if (!settings.providers[provider as any]) settings.providers[provider as any] = {} as any;
          const pConfig = settings.providers[provider as any]!;

          const parts = args.trim().split(/\s+/);
          const sub = parts[0]?.toLowerCase();
          const rest = parts.slice(1).join(' ').trim();

          if (!args) {
            emitDelta(`Current model is: \`${settings.model}\`. Use \`/model <name>\` to switch models.
* Use \`/model pricing <in;out>\` to set custom token costs (e.g. \`/model pricing 3.0;15.0\`).
* Use \`/model window <tokens>\` to adjust the context capacity limit.`);
          } else if (sub === 'pricing') {
            if (!rest) {
              const currentPricing = pConfig.model_cost || 'none';
              emitDelta(`Current model pricing for provider \`${provider}\`: \`${currentPricing}\` (per million tokens).
Usage: \`/model pricing <in;out>\` (e.g., \`/model pricing 2.50;10.00\`).`);
            } else if (!this.validatePricingString(rest)) {
              emitDelta(`Invalid pricing format: "${rest}". Must be in the format: \`input_cost;output_cost\` (e.g., \`3.00;15.00\`).`);
            } else {
              pConfig.model_cost = rest;
              this.settingsManager.save();
              emitDelta(`Pricing updated for provider \`${provider}\`! Cost: **${rest}**`);
            }
          } else if (sub === 'window') {
            if (!rest) {
              emitDelta(`Current context window size for provider \`${provider}\`: \`${(pConfig.model_context_window || 200000).toLocaleString()}\` tokens.
Usage: \`/model window <tokens>\` (e.g., \`/model window 120000\`).`);
            } else {
              const val = parseInt(rest, 10);
              if (isNaN(val) || val < 1000) {
                emitDelta(`Invalid window value: "${rest}". Must be at least 1,000.`);
              } else {
                pConfig.model_context_window = val;
                this.settingsManager.save();
                emitDelta(`Model context window capacity set to **${val.toLocaleString()}** tokens.`);
              }
            }
          } else {
            settings.model = args;
            this.settingsManager.save();
            emitDelta(`Successfully switched model to: **${args}**`);
          }
          break;
        }

        case 'provider': {
          const settings = this.settingsManager.get();
          const valid = ['anthropic', 'openai', 'google', 'local', 'ollama', 'openrouter'];
          if (!args) {
            emitDelta(`Current provider is: \`${settings.current_provider || 'anthropic'}\`. Use \`/provider <name>\` to switch.
* Valid providers: \`anthropic | openai | google | local | ollama | openrouter\``);
          } else {
            const provider = args.toLowerCase().trim();
            if (!valid.includes(provider)) {
              emitDelta(`Unknown provider: "${args}". Valid options are: ${valid.join(', ')}`);
            } else {
              settings.current_provider = provider;
              this.settingsManager.save();
              emitDelta(`Successfully switched provider to: **${provider}**`);
            }
          }
          break;
        }

        case 'mode': {
          const settings = this.settingsManager.get();
          const valid = ['manual', 'plan', 'auto-edit', 'yolo'];
          if (!args) {
            emitDelta(`Current approval mode is: \`${settings.mode || 'auto-edit'}\`. Use \`/mode <manual|plan|auto-edit|yolo>\` to switch.`);
          } else if (!valid.includes(args.toLowerCase())) {
            emitDelta(`Invalid mode: \`${args}\`. Supported modes: manual, plan, auto-edit, yolo.`);
          } else {
            settings.mode = args.toLowerCase() as any;
            this.settingsManager.save();
            emitDelta(`Successfully switched approval mode to: **${args.toLowerCase()}**`);
          }
          break;
        }

        case 'effort': {
          const settings = this.settingsManager.get();
          const valid = ['low', 'medium', 'high', 'max', 'auto'];
          if (!args) {
            emitDelta(`Current reasoning effort is: \`${settings.effort || 'auto'}\`. Use \`/effort <low|medium|high|max|auto>\` to switch.`);
          } else if (!valid.includes(args.toLowerCase())) {
            emitDelta(`Invalid effort: \`${args}\`. Supported effort levels: low, medium, high, max, auto.`);
          } else {
            settings.effort = args.toLowerCase() as any;
            this.settingsManager.save();
            emitDelta(`Successfully switched reasoning effort to: **${args.toLowerCase()}**`);
          }
          break;
        }

        case 'tools': {
          const settings = this.settingsManager.get();
          const parts = args.trim().split(/\s+/);
          if (!args.trim()) {
            emitDelta(`### Tool Limits (per turn):
* **Max Tool Calls**: \`${settings.tools_per_call ?? 10}\`
* **Max WebSearch/WebFetch**: \`${settings.websearch_per_call ?? 5}\`

**Usage**: \`/tools <max_tools> [max_websearch]\``);
          } else {
            const val = parseInt(parts[0]!, 10);
            if (isNaN(val) || val < 1) {
              emitDelta(`Invalid value: "${parts[0]}". Must be a positive integer.`);
            } else {
              settings.tools_per_call = val;
              if (parts[1]) {
                const wsVal = parseInt(parts[1]!, 10);
                if (!isNaN(wsVal) && wsVal >= 1) {
                  settings.websearch_per_call = wsVal;
                }
              }
              this.settingsManager.save();
              emitDelta(`Tool limits updated! Tools per turn: **${settings.tools_per_call}**, WebSearch per turn: **${settings.websearch_per_call ?? 5}**`);
            }
          }
          break;
        }

        case 'websearch': {
          const settings = this.settingsManager.get();
          if (!args.trim()) {
            emitDelta(`### WebSearch+WebFetch Limit (per turn):
* **Limit**: \`${settings.websearch_per_call ?? 5}\`

**Usage**: \`/websearch <limit>\``);
          } else {
            const val = parseInt(args.trim(), 10);
            if (isNaN(val) || val < 1) {
              emitDelta(`Invalid value: "${args}". Must be a positive integer.`);
            } else {
              settings.websearch_per_call = val;
              this.settingsManager.save();
              emitDelta(`WebSearch/WebFetch limit per turn set to: **${val}**`);
            }
          }
          break;
        }

        case 'mcp': {
          const settings = this.settingsManager.get();
          const sub = args.split(/\s+/)[0]?.toLowerCase();
          if (sub === 'list' || !sub) {
            const servers = settings.mcp_servers || {};
            const keys = Object.keys(servers);
            if (keys.length === 0) {
              emitDelta(`No Model Context Protocol (MCP) servers configured.`);
            } else {
              const lines = [`### Configured MCP Servers (${keys.length}):`];
              keys.forEach(k => {
                const cfg = servers[k] as any;
                const status = this.daemonApp?.mcpStatus?.find(s => s.serverId === k);
                const connectedLabel = status?.connected ? '✅ Connected' : '❌ Disconnected';
                const toolsList = status?.tools?.join(', ') || 'none';
                lines.push(`* **${k}**: \`${cfg?.command}\` ${cfg?.args?.join(' ') ?? ''}`);
                lines.push(`  └─ Status: ${connectedLabel}`);
                lines.push(`  └─ Tools: _${toolsList}_`);
              });
              lines.push(`\nUse \`/mcp reload\` to apply configuration changes.`);
              emitDelta(lines.join('\n'));
            }
          } else if (sub === 'reload') {
            emitDelta(`Reloading MCP servers...`);
            emitDelta(`To fully apply changes to MCP configurations, please restart the daemon process: \`curie-agent daemon stop && curie-agent daemon start\``);
          } else {
            emitDelta(`Usage: \`/mcp [list|reload]\``);
          }
          break;
        }

        case 'skill': {
          const workspaceDir = process.cwd();
          const parts = args.trim().split(/\s+/);
          const sub = parts[0]?.toLowerCase();

          if (!args.trim()) {
            const skills = listSkills(workspaceDir);
            if (skills.length === 0) {
              emitDelta(`No global or project-level skills discovered. Global path: \`~/.curie-agent/skills\`, project path: \`.curie-agent/skills\`.`);
            } else {
              const lines = [`### Discovered Skills (${skills.length}):`];
              skills.forEach(s => {
                const sourceLabel = s.source === 'project' ? '📁 Project' : '🌐 Global';
                lines.push(`* **${s.name}** [${sourceLabel}] — ${s.description || '_No description_'}`);
              });
              lines.push(`\nUse \`/skill <name>\` to read a skill's full instructions.`);
              emitDelta(lines.join('\n'));
            }
          } else {
            const all = discoverAllSkills(workspaceDir);
            const target = args.trim().toLowerCase();
            const skill = all.find(s => s.name.toLowerCase() === target);
            if (!skill) {
              emitDelta(`Skill **"${args}"** not found. Run \`/skill\` without arguments to list available skills.`);
            } else {
              const fileContent = readFileSync(skill.filePath, 'utf-8');
              emitDelta(`### Skill: ${skill.name}\n**Source**: \`${skill.filePath}\`\n\n\`\`\`markdown\n${fileContent}\n\`\`\``);
            }
          }
          break;
        }

        case 'memory': {
          const memoryDir = join(homedir(), '.curie-agent', 'memory');
          const parts = args.trim().split(/\s+/);
          const sub = parts[0]?.toLowerCase();
          const rest = parts.slice(1).join(' ').trim();

          if (sub === 'status' || !args.trim()) {
            if (!existsSync(memoryDir)) {
              emitDelta(`Memory directory does not exist yet at \`${memoryDir}\`. Captured memories will create it automatically.`);
            } else {
              const files = readdirSync(memoryDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
              if (files.length === 0) {
                emitDelta(`Memory directory \`${memoryDir}\` is empty.`);
              } else {
                const lines = [`### Memory Directory Files (\`${memoryDir}\`):`];
                files.forEach(f => {
                  const stat = statSync(join(memoryDir, f));
                  lines.push(`* **${f}** — \`${stat.size} bytes\``);
                });
                lines.push(`\nUse \`/memory add <text>\` to add a new memory entry.`);
                emitDelta(lines.join('\n'));
              }
            }
          } else if (sub === 'add') {
            if (!rest) {
              emitDelta(`Usage: \`/memory add <text>\` (e.g., \`/memory add User prefers TypeScript over JavaScript\`)`);
            } else {
              if (!existsSync(memoryDir)) {
                mkdirSync(memoryDir, { recursive: true });
              }
              const capturedFile = join(memoryDir, 'captured.md');
              const entry = `- [${new Date().toISOString()}] ${rest}\n`;
              let existing = '';
              if (existsSync(capturedFile)) {
                existing = readFileSync(capturedFile, 'utf-8');
              }
              writeFileSync(capturedFile, existing + entry, 'utf-8');
              emitDelta(`Captured memory: **"${rest}"** successfully saved in \`captured.md\`!`);
            }
          } else {
            emitDelta(`Usage:\n* \`/memory status\` — Show files in the memory directory.\n* \`/memory add <text>\` — Log a specific memory.`);
          }
          break;
        }

        case 'context': {
          const settings = this.settingsManager.get();
          const parts = args.trim().split(/\s+/);
          const sub = parts[0]?.toLowerCase();
          const arg1 = parts[1]?.toLowerCase();
          const arg2 = parts[2]?.toLowerCase();

          if (sub === 'auto') {
            const s = settings;
            if (!s.auto_compact) {
              s.auto_compact = { enabled: 'on', threshold: 80, warn_threshold: 15, forced_threshold: 85 };
            }

            if (!arg1) {
              emitDelta(`### Auto-Compaction Settings:
* **Auto-compact**: \`${s.auto_compact.enabled}\`
* **Threshold**: \`${s.auto_compact.threshold ?? 80}%\`
* **Warning Threshold**: \`${s.auto_compact.warn_threshold ?? 15}%\`
* **Pricing Warn**: \`${s.pricing_tier_warn ?? 'off'}\`

**Usage**: \`/context auto [on|off|threshold N|warn N|pricing on/off]\``);
            } else if (arg1 === 'on') {
              s.auto_compact.enabled = 'on';
              this.settingsManager.save();
              emitDelta(`Autocompaction enabled.`);
            } else if (arg1 === 'off') {
              s.auto_compact.enabled = 'off';
              this.settingsManager.save();
              emitDelta(`Autocompaction disabled.`);
            } else if (arg1 === 'threshold' && arg2) {
              const pct = parseInt(arg2, 10);
              if (isNaN(pct) || pct < 10 || pct > 99) {
                emitDelta(`Invalid threshold. Use a value between 10 and 99.`);
              } else {
                s.auto_compact.threshold = pct;
                this.settingsManager.save();
                emitDelta(`Compaction threshold set to ${pct}%.`);
              }
            } else if (arg1 === 'warn' && arg2) {
              const pct = parseInt(arg2, 10);
              if (isNaN(pct) || pct < 5 || pct > 95) {
                emitDelta(`Invalid warning threshold. Use a value between 5 and 95.`);
              } else {
                s.auto_compact.warn_threshold = pct;
                this.settingsManager.save();
                emitDelta(`Warning threshold set to ${pct}%.`);
              }
            } else if (arg1 === 'pricing') {
              if (arg2 === 'on') {
                s.pricing_tier_warn = 'on';
                this.settingsManager.save();
                emitDelta(`Pricing tier warnings enabled.`);
              } else if (arg2 === 'off') {
                s.pricing_tier_warn = 'off';
                this.settingsManager.save();
                emitDelta(`Pricing tier warnings disabled.`);
              } else {
                emitDelta(`Usage: \`/context auto pricing on/off\``);
              }
            } else {
              emitDelta(`Usage: \`/context auto [on|off|threshold N|warn N|pricing on/off]\``);
            }
          } else {
            const activeLoop = [...this.turnLoops.values()][0];
            const history = activeLoop?.eventBus.history() || [];
            const usageEvents = history.filter((e: any) => e.type === 'usage');
            let input = 0;
            let output = 0;
            for (const e of usageEvents) {
              input += (e as any).inputTokens || 0;
              output += (e as any).outputTokens || 0;
            }
            const model = settings.model || 'unknown';
            const windowSize = settings.providers?.[settings.current_provider as any]?.model_context_window ?? 200000;
            const pct = input > 0 ? Math.min(100, Math.round((input / windowSize) * 100)) : 0;
            
            const filled = Math.round((pct / 100) * 24);
            const bar = '█'.repeat(filled) + '░'.repeat(24 - filled);
            const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

            if (input === 0 && output === 0) {
              emitDelta(`No token data yet. Start a conversation to see context window usage.\n\nActive model: \`${model}\` (Max Context: \`${fmt(windowSize)}\` tokens).`);
            } else {
              const lines = [
                `### Context Window Usage (\`${model}\`):`,
                `\`${bar}\` **${pct}%** (${fmt(input)}/${fmt(windowSize)})`,
                `* **Tokens in**: \`${input.toLocaleString()}\``,
                `* **Tokens out**: \`${output.toLocaleString()}\``,
              ];
              emitDelta(lines.join('\n'));
            }
          }
          break;
        }

        case 'remind': {
          if (!this.daemonApp) {
            emitDelta(`Cron reminder system is not active on this daemon instance.`);
            break;
          }
          if (!args) {
            emitDelta(`Usage: \`/remind <message at time>\` (e.g. \`in 30 mins submit report\`)`);
            break;
          }
          const parsed = parseReminderTime(args);
          if (!parsed) {
            emitDelta(`Failed to parse reminder time. Please format like: \`in 2 hours call developer\` or \`tomorrow at 9:00 am meeting\`.`);
            break;
          }
          this.daemonApp.cronManager.createReminder(parsed.message, parsed.scheduledAt);
          emitDelta(`Reminder scheduled! **"${parsed.message}"** at ${new Date(parsed.scheduledAt).toLocaleString()}`);
          break;
        }

        case 'cron': {
          if (!this.daemonApp) {
            emitDelta(`Cron reminder system is not active on this daemon.`);
            break;
          }
          this.daemonApp.cronManager.load();
          const parts = args.split(/\s+/);
          const sub = parts[0]?.toLowerCase() || '';
          const rest = parts.slice(1).join(' ').trim();

          if (sub === 'list' || !sub) {
            const list = this.daemonApp.cronManager.listReminders();
            if (list.length === 0) {
              emitDelta(`No reminders scheduled.`);
            } else {
              const items = list.map((t, i) => {
                const timeStr = new Date(t.scheduledAt).toLocaleString();
                const statusEmoji = t.status === 'pending' ? '⏳'
                  : t.status === 'fired' ? '🔔'
                  : t.status === 'executing' ? '⚙️'
                  : t.status === 'completed' ? '✅'
                  : t.status === 'failed' ? '❌'
                  : '❌';
                const typeLabel = t.type === 'heartbeat'
                  ? `Heartbeat: ${t.schedule ? `[${t.schedule.type.toUpperCase()}] ` : ''}`
                  : t.type === 'task'
                    ? 'Task: '
                    : 'Reminder: ';
                return `${i + 1}. ${statusEmoji} ${typeLabel}${t.message} (Scheduled: ${timeStr}, ID: \`${t.id}\`)`;
              }).join('\n');
              emitDelta(`### Active Reminders:\n${items}`);
            }
          } else if (sub === 'delete') {
            if (!rest) {
              emitDelta(`Usage: \`/cron delete <id>\``);
            } else {
              const result = this.daemonApp.cronManager.cancelReminder(rest);
              if (result) {
                emitDelta(`Reminder \`${rest}\` cancelled.`);
              } else {
                emitDelta(`No reminder found with ID: \`${rest}\``);
              }
            }
          } else if (sub === 'clear') {
            const removed = this.daemonApp.cronManager.clearCompleted();
            emitDelta(`Successfully cleared ${removed} completed reminder(s).`);
          } else {
            emitDelta(`Unknown cron subcommand. Supported: \`/cron list\`, \`/cron delete <id>\`, \`/cron clear\`.`);
          }
          break;
        }

        case 'heartbeat': {
          if (!this.daemonApp) {
            emitDelta(`Heartbeat system is not active on this daemon.`);
            break;
          }
          const settings = this.settingsManager.get();
          if (!settings.heartbeat) {
            settings.heartbeat = { schedule: 'off', daily: '6:00', weekly: 'monday@6:00', monthly: '1@6:00', dreaming: '2:00', intraday: '' };
          }

          const parts = args.trim().split(/\s+/);
          const sub = parts[0]?.toLowerCase();
          const rest = parts.slice(1).join(' ').trim();

          switch (sub) {
            case 'status':
            case '': {
              const active = settings.heartbeat.schedule === 'on';
              const intradayDisplay = settings.heartbeat.intraday || '(not set)';
              emitDelta(`### Heartbeat Cycle Status:
* **Enabled**: \`${active ? 'yes' : 'no'}\`
* **Intraday**: \`${intradayDisplay}\`
* **Daily**: \`${settings.heartbeat.daily}\`
* **Weekly**: \`${settings.heartbeat.weekly}\`
* **Monthly**: \`${settings.heartbeat.monthly}\`
* **Dreaming**: \`${settings.heartbeat.dreaming}\`

**Usage**:
* \`/heartbeat enable\` / \`/heartbeat disable\`
* \`/heartbeat daily <H:MM>\` (24h)
* \`/heartbeat weekly <day@H:MM>\`
* \`/heartbeat monthly <D@H:MM>\`
* \`/heartbeat dreaming <H:MM>\`
* \`/heartbeat intraday <H:MM,...>\` (e.g. \`8:10,14:20\`)
* \`/heartbeat now\` — run a heartbeat immediately.`);
              break;
            }

            case 'enable': {
              settings.heartbeat.schedule = 'on';
              this.settingsManager.save();
              if (this.daemonApp) {
                this.daemonApp.cronManager.rescheduleFromSettings({
                  HEARTBEAT_INTRADAY: settings.heartbeat.intraday,
                  HEARTBEAT_DAILY: settings.heartbeat.daily,
                  HEARTBEAT_WEEKLY: settings.heartbeat.weekly,
                  HEARTBEAT_MONTHLY: settings.heartbeat.monthly,
                  HEARTBEAT_DREAMING: settings.heartbeat.dreaming,
                });
              }
              emitDelta(`Heartbeat cycle enabled.`);
              break;
            }

            case 'disable': {
              settings.heartbeat.schedule = 'off';
              this.settingsManager.save();
              if (this.daemonApp) {
                const pendingHbs = this.daemonApp.cronManager.listReminders('pending').filter(t => t.type === 'heartbeat');
                for (const t of pendingHbs) {
                  this.daemonApp.cronManager.cancelReminder(t.id);
                }
              }
              emitDelta(`Heartbeat cycle disabled.`);
              break;
            }

            case 'intraday': {
              if (!rest) {
                emitDelta(`Usage: \`/heartbeat intraday <H:MM,...>\` (e.g., \`8:10,14:20\`)`);
              } else {
                const tokens = rest.split(',').map(s => s.trim()).filter(Boolean);
                const invalid = tokens.filter(t => {
                  if (!/^\d{1,2}:\d{2}$/.test(t)) return true;
                  const parts = t.split(':').map(Number);
                  const h = parts[0];
                  const m = parts[1];
                  if (h === undefined || m === undefined) return true;
                  return h < 0 || h > 23 || m < 0 || m > 59;
                });
                if (invalid.length > 0) {
                  emitDelta(`Invalid times: ${invalid.join(', ')}. Hour 0-23, minute 0-59.`);
                } else {
                  settings.heartbeat.intraday = tokens.join(',');
                  this.settingsManager.save();
                  if (this.daemonApp && settings.heartbeat.schedule === 'on') {
                    this.daemonApp.cronManager.rescheduleFromSettings({
                      HEARTBEAT_INTRADAY: settings.heartbeat.intraday,
                      HEARTBEAT_DAILY: settings.heartbeat.daily,
                      HEARTBEAT_WEEKLY: settings.heartbeat.weekly,
                      HEARTBEAT_MONTHLY: settings.heartbeat.monthly,
                      HEARTBEAT_DREAMING: settings.heartbeat.dreaming,
                    });
                  }
                  emitDelta(`Intraday heartbeat times set to: \`${settings.heartbeat.intraday}\``);
                }
              }
              break;
            }

            case 'daily': {
              if (!rest || !/^\d{1,2}:\d{2}$/.test(rest)) {
                emitDelta(`Usage: \`/heartbeat daily <H:MM>\` (24h, e.g. \`6:00\`)`);
              } else {
                const parts = rest.split(':').map(Number);
                const h = parts[0];
                const m = parts[1];
                if (h === undefined || m === undefined || h < 0 || h > 23 || m < 0 || m > 59) {
                  emitDelta(`Invalid time hour/minute limits.`);
                } else {
                  settings.heartbeat.daily = rest;
                  this.settingsManager.save();
                  if (this.daemonApp && settings.heartbeat.schedule === 'on') {
                    this.daemonApp.cronManager.rescheduleFromSettings({
                      HEARTBEAT_INTRADAY: settings.heartbeat.intraday,
                      HEARTBEAT_DAILY: settings.heartbeat.daily,
                      HEARTBEAT_WEEKLY: settings.heartbeat.weekly,
                      HEARTBEAT_MONTHLY: settings.heartbeat.monthly,
                      HEARTBEAT_DREAMING: settings.heartbeat.dreaming,
                    });
                  }
                  emitDelta(`Daily heartbeat time set to: \`${rest}\``);
                }
              }
              break;
            }

            case 'weekly': {
              const atIdx = rest.indexOf('@');
              if (atIdx < 0) {
                emitDelta(`Usage: \`/heartbeat weekly <day@H:MM>\` (e.g. \`monday@6:00\`)`);
              } else {
                const day = rest.slice(0, atIdx).toLowerCase();
                const time = rest.slice(atIdx + 1);
                const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
                if (!validDays.includes(day) || !/^\d{1,2}:\d{2}$/.test(time)) {
                  emitDelta(`Invalid day or time format.`);
                } else {
                  settings.heartbeat.weekly = rest;
                  this.settingsManager.save();
                  if (this.daemonApp && settings.heartbeat.schedule === 'on') {
                    this.daemonApp.cronManager.rescheduleFromSettings({
                      HEARTBEAT_INTRADAY: settings.heartbeat.intraday,
                      HEARTBEAT_DAILY: settings.heartbeat.daily,
                      HEARTBEAT_WEEKLY: settings.heartbeat.weekly,
                      HEARTBEAT_MONTHLY: settings.heartbeat.monthly,
                      HEARTBEAT_DREAMING: settings.heartbeat.dreaming,
                    });
                  }
                  emitDelta(`Weekly heartbeat schedule set to: \`${rest}\``);
                }
              }
              break;
            }

            case 'monthly': {
              const atIdx = rest.indexOf('@');
              if (atIdx < 0) {
                emitDelta(`Usage: \`/heartbeat monthly <D@H:MM>\` (e.g. \`1@6:00\`)`);
              } else {
                const day = parseInt(rest.slice(0, atIdx), 10);
                const time = rest.slice(atIdx + 1);
                if (isNaN(day) || day < 1 || day > 31 || !/^\d{1,2}:\d{2}$/.test(time)) {
                  emitDelta(`Invalid day of month (1-31) or time format.`);
                } else {
                  settings.heartbeat.monthly = rest;
                  this.settingsManager.save();
                  if (this.daemonApp && settings.heartbeat.schedule === 'on') {
                    this.daemonApp.cronManager.rescheduleFromSettings({
                      HEARTBEAT_INTRADAY: settings.heartbeat.intraday,
                      HEARTBEAT_DAILY: settings.heartbeat.daily,
                      HEARTBEAT_WEEKLY: settings.heartbeat.weekly,
                      HEARTBEAT_MONTHLY: settings.heartbeat.monthly,
                      HEARTBEAT_DREAMING: settings.heartbeat.dreaming,
                    });
                  }
                  emitDelta(`Monthly heartbeat schedule set to: \`${rest}\``);
                }
              }
              break;
            }

            case 'dreaming': {
              if (!rest || !/^\d{1,2}:\d{2}$/.test(rest)) {
                emitDelta(`Usage: \`/heartbeat dreaming <H:MM>\` (e.g. \`2:00\`)`);
              } else {
                const parts = rest.split(':').map(Number);
                const h = parts[0];
                const m = parts[1];
                if (h === undefined || m === undefined || h < 0 || h > 23 || m < 0 || m > 59) {
                  emitDelta(`Invalid dreaming time hour/minute limits.`);
                } else {
                  settings.heartbeat.dreaming = rest;
                  this.settingsManager.save();
                  if (this.daemonApp && settings.heartbeat.schedule === 'on') {
                    this.daemonApp.cronManager.rescheduleFromSettings({
                      HEARTBEAT_INTRADAY: settings.heartbeat.intraday,
                      HEARTBEAT_DAILY: settings.heartbeat.daily,
                      HEARTBEAT_WEEKLY: settings.heartbeat.weekly,
                      HEARTBEAT_MONTHLY: settings.heartbeat.monthly,
                      HEARTBEAT_DREAMING: settings.heartbeat.dreaming,
                    });
                  }
                  emitDelta(`Dreaming heartbeat time set to: \`${rest}\``);
                }
              }
              break;
            }

            case 'now': {
              emitDelta(`Executing immediate heartbeat cycle...`);
              const res = await this.daemonApp.runHeartbeat();
              emitDelta(`### Heartbeat Finished!\n${res.text}\n* Tool calls: ${res.toolCalls}\n* Errors: ${res.errors.length > 0 ? res.errors.join(', ') : 'none'}`);
              break;
            }

            default:
              emitDelta(`Unknown heartbeat command. Supported subcommands: \`status\`, \`enable\`, \`disable\`, \`daily\`, \`weekly\`, \`monthly\`, \`dreaming\`, \`intraday\`, \`now\`.`);
              break;
          }
          break;
        }

        case 'task': {
          if (!this.daemonApp) {
            emitDelta(`Task system is not active on this daemon.`);
            break;
          }
          this.daemonApp.cronManager.load();
          const parts = args.trim().split(/\s+/);
          const sub = parts[0]?.toLowerCase();
          const rest = parts.slice(1).join(' ').trim();

          switch (sub) {
            case 'create': {
              if (!rest) {
                emitDelta(`Usage: \`/task create <instruction at time>\` (e.g., \`/task create at 7:55 make a report about AI models\`)`);
              } else {
                const parsed = parseReminderTime(rest);
                if (!parsed) {
                  emitDelta(`Could not parse scheduled time from: "${rest}". Try: \`at 7:55 do something\` or \`tomorrow at 9am do something\`.`);
                } else {
                  const task = this.daemonApp.cronManager.createTask(parsed.message, parsed.scheduledAt);
                  const timeStr = new Date(task.scheduledAt).toLocaleString();
                  emitDelta(`### Task Scheduled Successfully!
* **Task ID**: \`${task.id}\`
* **Scheduled Time**: \`${timeStr}\`
* **Instruction**: "${parsed.message}"`);
                }
              }
              break;
            }

            case 'list': {
              const filter = ['pending', 'executing', 'completed', 'failed', 'cancelled'].includes(rest.toLowerCase())
                ? rest.toLowerCase() as any
                : undefined;
              const tasks = this.daemonApp.cronManager.listTasks(filter);
              if (tasks.length === 0) {
                emitDelta(filter ? `No tasks found with status **${filter}**.` : `No tasks scheduled yet. Use \`/task create\` to schedule a task.`);
              } else {
                const lines = [`### Scheduled Tasks (${tasks.length}${filter ? ` — ${filter}` : ''}):`];
                tasks.forEach(t => {
                  const statusEmoji = t.status === 'pending' ? '⏳ PENDING'
                    : t.status === 'executing' ? '⚙️ RUNNING'
                    : t.status === 'completed' ? '✅ COMPLETED'
                    : t.status === 'failed' ? '❌ FAILED'
                    : '🚫 CANCELLED';
                  const timeStr = new Date(t.scheduledAt).toLocaleString();
                  lines.push(`* **[${statusEmoji}]** "${t.message}"`);
                  lines.push(`  └─ Scheduled: \`${timeStr}\``);
                  lines.push(`  └─ ID: \`${t.id}\``);
                });
                emitDelta(lines.join('\n'));
              }
              break;
            }

            case 'delete': {
              if (!rest) {
                emitDelta(`Usage: \`/task delete <id>\``);
              } else {
                const res = this.daemonApp.cronManager.cancelReminder(rest);
                if (res) {
                  emitDelta(`Task \`${rest}\` cancelled successfully.`);
                } else {
                  emitDelta(`No task found with ID \`${rest}\`.`);
                }
              }
              break;
            }

            default:
              emitDelta(`Usage:\n* \`/task create <instruction at time>\`\n* \`/task list [status]\`\n* \`/task delete <id>\``);
              break;
          }
          break;
        }

        case 'snapshots': {
          const snaps = listSnapshots(process.cwd());
          if (snaps.length === 0) {
            emitDelta(`No Git snapshots found for the current directory. Snapshots are created automatically in yolo mode.`);
          } else {
            const items = snaps.map((s, i) => {
              return `${i}) **${s.sha.slice(0, 7)}** — ${new Date(s.timestamp).toLocaleString()} (${s.changedFiles} files changed: _"${s.label}"_)`;
            }).join('\n');
            emitDelta(`### Recent Git Snapshots:\n${items}\n\nUse \`/revert <index>\` to restore files.`);
          }
          break;
        }

        case 'revert': {
          if (!args) {
            emitDelta(`Usage: \`/revert <index>\`. Run \`/snapshots\` first to view available indices.`);
            break;
          }
          const idx = parseInt(args, 10);
          const snaps = listSnapshots(process.cwd());
          if (isNaN(idx) || idx < 0 || idx >= snaps.length) {
            emitDelta(`Invalid index: **${args}**. Please choose between 0 and ${snaps.length - 1}.`);
            break;
          }
          const snap = snaps[idx];
          if (!snap) {
            emitDelta(`Snapshot at index ${idx} not found.`);
            break;
          }
          const res = await revertTo(process.cwd(), snap.sha);
          if (res.success) {
            emitDelta(`Successfully reverted current workspace files to snapshot **${snap.sha.slice(0, 7)}** (_"${snap.label}"_)!`);
          } else {
            emitDelta(`Failed to revert: ${res.error}`);
          }
          break;
        }

        default: {
          emitDelta(`Unknown slash command: **${text}**. Type \`/help\` to see all available commands.`);
          break;
        }
      }
    } catch (err) {
      emitDelta(`Error executing command: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      emitStop();
    }
  }

  private validatePricingString(cost: string | undefined): boolean {
    if (!cost) return false;
    if (!cost.includes('|')) {
      const [inStr = '', outStr = ''] = cost.split(';');
      const inC = parseFloat(inStr);
      const outC = parseFloat(outStr);
      return !isNaN(inC) && !isNaN(outC) && inC >= 0 && outC >= 0;
    }
    const tiers = cost.split('|').map(s => s.trim());
    const firstPair = (tiers[0] ?? '').split(';');
    const inStr = firstPair[0] ?? '';
    const outStr = firstPair[1] ?? '';
    if (isNaN(parseFloat(inStr)) || isNaN(parseFloat(outStr))) return false;
    for (let i = 1; i < tiers.length; i++) {
      const tier = tiers[i]!;
      const idx = tier.indexOf('<');
      if (idx === -1) return false;
      const threshold = parseInt(tier.substring(0, idx).trim(), 10);
      const rest = tier.substring(idx + 1).trim();
      const [inStr2 = '', outStr2 = ''] = rest.split(';');
      const tierIn = parseFloat(inStr2);
      const tierOut = parseFloat(outStr2);
      if (isNaN(threshold) || isNaN(tierIn) || isNaN(tierOut) || threshold < 0 || tierIn < 0 || tierOut < 0) return false;
    }
    return true;
  }
}
