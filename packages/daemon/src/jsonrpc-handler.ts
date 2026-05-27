import os, { homedir } from 'node:os';
import path, { join, isAbsolute, resolve as pathResolve } from 'node:path';
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { Method } from '@curie-agent/protocol';
import { TurnLoop, parseReminderTime, listSnapshots, revertTo, createIdentityFilesAuto, SubagentExecutor, isPathAllowed, parseAllowlist, createSnapshot, type SessionInfo } from '@curie-agent/core';
import { EventBus } from '@curie-agent/core';
import type { SessionStore, SettingsManager, Event, ProviderStream, Tool, CurieSettings } from '@curie-agent/core';
import { listSkills, discoverAllSkills } from '@curie-agent/tools';
import { executeCd } from './slash-cd.js';
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
    private sharedEventBus?: EventBus,
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

        case Method.SESSION_STATS: {
          const sessions = this.sessionStore.list();
          const todayStr = new Date().toDateString();
          const todaySessions = sessions.filter(s => new Date(s.createdAt).toDateString() === todayStr);

          const hourly = Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            inputTokens: 0,
            outputTokens: 0,
            toolCalls: 0,
            messages: 0,
          }));

          const entrypoints: Record<string, number> = {
            webui: 0,
            tui: 0,
            telegram: 0,
            heartbeat: 0,
          };

          const toolCallsCount: Record<string, number> = {};

          let totalTokens = 0;
          let totalInputTokens = 0;
          let totalOutputTokens = 0;
          let totalToolCalls = 0;
          let totalMessages = 0;
          let totalCost = 0;

          // Estimate cost using the pricing model
          const estimateCost = (model: string, inputTokens: number, outputTokens: number, customCost?: string): number => {
            if (customCost) {
              if (!customCost.includes('|')) {
                const [inStr = '', outStr = ''] = customCost.split(';');
                const inC = parseFloat(inStr);
                const outC = parseFloat(outStr);
                if (!isNaN(inC) && !isNaN(outC)) {
                  return (inputTokens * inC + outputTokens * outC) / 1_000_000;
                }
              } else {
                const rawTiers = customCost.split('|').map(s => s.trim());
                const tiers: Array<{ threshold?: number; in: number; out: number }> = [];
                const [inStr = '', outStr = ''] = rawTiers[0]?.split(';') ?? ['', ''];
                const baseIn = parseFloat(inStr);
                const baseOut = parseFloat(outStr);
                if (!isNaN(baseIn) && !isNaN(baseOut)) {
                  tiers.push({ in: baseIn, out: baseOut });
                  for (let i = 1; i < rawTiers.length; i++) {
                    const tier = rawTiers[i]!;
                    const pipeIdx = tier.indexOf('<');
                    if (pipeIdx !== -1) {
                      const threshold = parseInt(tier.substring(0, pipeIdx).trim(), 10);
                      const rest = tier.substring(pipeIdx + 1).trim();
                      const [tierInStr = '', tierOutStr = ''] = rest.split(';');
                      const tierIn = parseFloat(tierInStr);
                      const tierOut = parseFloat(tierOutStr);
                      if (!isNaN(threshold) && !isNaN(tierIn) && !isNaN(tierOut)) {
                        tiers.push({ threshold, in: tierIn, out: tierOut });
                      }
                    }
                  }
                }
                if (tiers.length > 0) {
                  let rate = [tiers[0]!.in, tiers[0]!.out];
                  const total = inputTokens + outputTokens;
                  for (const t of tiers) {
                    if (t.threshold !== undefined && total >= t.threshold) {
                      rate = [t.in, t.out];
                    }
                  }
                  return (inputTokens * rate[0]! + outputTokens * rate[1]!) / 1_000_000;
                }
              }
            }
            const pricing: Record<string, { in: number; out: number }> = {
              'opus': { in: 15, out: 75 },
              'sonnet': { in: 3, out: 15 },
              'haiku': { in: 0.8, out: 4 },
              'gpt-4o': { in: 2.5, out: 10 },
              'gpt-4': { in: 5, out: 15 },
              'qwen': { in: 0.112, out: 0.224 },
            };
            const key = Object.keys(pricing).find(k => model.toLowerCase().includes(k)) || 'sonnet';
            const p = pricing[key]!;
            return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
          };

          const providersConfig = this.settingsManager.get().providers;

          for (const s of todaySessions) {
            const typeKey = s.type || 'webui';
            entrypoints[typeKey] = (entrypoints[typeKey] || 0) + 1;

            const events = this.sessionStore.loadEvents(s.id);
            const providerCfg = providersConfig[s.provider as keyof typeof providersConfig];
            const customCost = providerCfg?.model_cost || undefined;

            for (const e of events) {
              const eventDate = new Date(e.timestamp);
              if (eventDate.toDateString() !== todayStr) continue;

              const hour = eventDate.getHours();
              if (hour < 0 || hour > 23) continue;

              const bucket = hourly[hour];
              if (bucket) {
                if (e.type === 'usage' && 'inputTokens' in e && 'outputTokens' in e) {
                  const inT = Number(e.inputTokens) || 0;
                  const outT = Number(e.outputTokens) || 0;
                  bucket.inputTokens += inT;
                  bucket.outputTokens += outT;
                  totalInputTokens += inT;
                  totalOutputTokens += outT;
                  totalTokens += inT + outT;

                  const eventCost = estimateCost(s.model, inT, outT, customCost);
                  totalCost += eventCost;
                } else if (e.type === 'tool-call') {
                  bucket.toolCalls += 1;
                  totalToolCalls += 1;

                  if ('name' in e && typeof e.name === 'string') {
                    toolCallsCount[e.name] = (toolCallsCount[e.name] || 0) + 1;
                  }
                } else if (e.type === 'user-prompt') {
                  bucket.messages += 1;
                  totalMessages += 1;
                }
              }
            }
          }

          const topTools = Object.entries(toolCallsCount)
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

          result = {
            summary: {
              totalSessionsToday: todaySessions.length,
              totalSessions: sessions.length,
              totalTokens,
              totalInputTokens,
              totalOutputTokens,
              totalToolCalls,
              totalMessages,
              totalCost,
            },
            hourly,
            entrypoints,
            topTools,
          };
          break;
        }

        case Method.SESSION_SEND: {
          const sessionId = this.getStringParam(params, 'id');
          const text = this.getStringParam(params, 'text');
          const type = this.getStringParam(params, 'type');
          if (!text) return this.paramError('text');

          if (!this.createProvider) {
            result = { status: 'error: no provider configured' };
            break;
          }

          if (text.startsWith('/')) {
            const targetSessionId = sessionId || this.sessionStore.create(
              process.cwd(),
              this.settingsManager.getActiveModel(),
              this.settingsManager.get().current_provider || 'unknown',
              type || 'webui',
            ).id;

            // Wait 150ms to guarantee that the client has completed the HTTP roundtrip,
            // received the sessionId, and successfully subscribed to WebSocket events
            // before any synchronous slash command output is emitted.
            setTimeout(() => {
              this.executeSlashCommand(targetSessionId, text).catch(err => {
                console.error(`[jsonrpc] error executing slash command ${text}:`, err);
              });
            }, 150);

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
              settings.providers[settings.current_provider]?.model || settings.model,
              settings.current_provider || 'unknown',
              type || 'webui',
            );
            // Start turn loop in background — events stream via WS
            if (this.daemonApp) {
              this.daemonApp.channelManager.send(session.id, text, undefined, type || 'webui').then(res => {
                console.log(`[jsonrpc] session.send completed sessionId=${session.id} status=${res.status}`);
              }).catch(err => {
                console.error(`[jsonrpc] session.send error sessionId=${session.id}:`, err);
              });
            } else {
              this.handleSend(session.id, text, type || 'webui').then(res => {
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
            this.daemonApp.channelManager.send(sessionId, text, undefined, type || 'webui').then(res => {
              console.log(`[jsonrpc] session.send completed id=${sessionId} status=${res.status}`);
            }).catch(err => {
              console.error(`[jsonrpc] session.send error id=${sessionId}:`, err);
            });
          } else {
            this.handleSend(sessionId, text, type || 'webui').then(res => {
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

          const settings = this.settingsManager.get();
          if (key.includes('.')) {
            const parts = key.split('.');
            let current: any = settings;
            for (let i = 0; i < parts.length - 1; i++) {
              const part = parts[i];
              if (part) {
                if (current[part] === undefined || typeof current[part] !== 'object') {
                  current[part] = {};
                }
                current = current[part];
              }
            }
            const lastPart = parts[parts.length - 1];
            if (lastPart) {
              current[lastPart] = value;
            }
            this.settingsManager.update(settings);
          } else {
            this.settingsManager.update({ [key]: value } as never);
          }
          this.settingsManager.save();
          this.sharedEventBus?.emit({
            type: 'config-changed',
            id: Math.random().toString(36).substring(7),
            timestamp: Date.now(),
            key,
            value,
          } as any);

          if (key.startsWith('heartbeat') && this.daemonApp) {
            const updatedSettings = this.settingsManager.get();
            if (updatedSettings.heartbeat?.schedule === 'on') {
              this.daemonApp.taskManager.rescheduleFromSettings({
                HEARTBEAT_INTRADAY: updatedSettings.heartbeat.intraday,
                HEARTBEAT_DAILY: updatedSettings.heartbeat.daily,
                HEARTBEAT_WEEKLY: updatedSettings.heartbeat.weekly,
                HEARTBEAT_MONTHLY: updatedSettings.heartbeat.monthly,
                HEARTBEAT_DREAMING: updatedSettings.heartbeat.dreaming,
              });
            } else if (updatedSettings.heartbeat?.schedule === 'off') {
              this.daemonApp.taskManager.cancelAllHeartbeats();
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
            model_cost: cfg.model_cost || '',
            model_context_window: cfg.model_context_window || 131072,
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

        // Cron management (redirected to unified TaskManager)
        case Method.CRON_LIST: {
          const mode = this.getStringParam(params, 'mode');
          if (this.daemonApp) {
            this.daemonApp.taskManager.load();
            const tasks = mode ? this.daemonApp.taskManager.list({ mode: mode as 'notify' | 'agent' }) : this.daemonApp.taskManager.list({ mode: 'notify' });
            result = tasks;
          } else {
            result = [];
          }
          break;
        }

        case Method.CRON_CREATE: {
          const type = this.getStringParam(params, 'type');
          const message = this.getStringParam(params, 'message');
          const scheduledAt = params?.scheduledAt as number | undefined;
          if (!message || !scheduledAt) return this.paramError('message, scheduledAt');
          if (this.daemonApp) {
            const mode = type === 'task' ? 'agent' : 'notify';
            const task = this.daemonApp.taskManager.create({ title: message, mode, scope: 'personal', scheduled_at: scheduledAt });
            result = task;
          }
          break;
        }

        case Method.CRON_CANCEL: {
          const taskId = this.getStringParam(params, 'id');
          if (!taskId) return this.paramError('id');
          if (this.daemonApp) {
            result = { cancelled: this.daemonApp.taskManager.cancelTask(taskId) };
          }
          break;
        }

        case Method.CRON_CLEAR:
          if (this.daemonApp) {
            result = { removed: this.daemonApp.taskManager.clearCompleted() };
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

        // Identity setup
        case Method.IDENTITY_SETUP: {
          const p = params as Record<string, unknown>;
          const provider = this.getStringParam(p, 'provider') || 'anthropic';
          const apiKey = (p?.apiKey as string) || '';
          const model = this.getStringParam(p, 'model') || 'custom';
          const soulName = this.getStringParam(p, 'soulName') || 'Curie';
          const soulVibe = this.getStringParam(p, 'soulVibe') || 'AI coding assistant';
          const userName = this.getStringParam(p, 'userName') || 'User';
          const userTimezone = this.getStringParam(p, 'userTimezone') || 'UTC';
          const userLanguages = this.getStringParam(p, 'userLanguages') || 'TypeScript, Python';

          createIdentityFilesAuto({
            provider: provider as any,
            apiKey,
            model,
            soul: { name: soulName, vibe: soulVibe },
            user: { name: userName, timezone: userTimezone, languages: userLanguages },
            agentsAccepted: true,
          });

          const settings = this.settingsManager.get();
          if (!settings.providers) settings.providers = {} as never;
          if (!(provider in (settings.providers as Record<string, unknown>))) {
            (settings.providers as Record<string, unknown>)[provider] = {};
          }
          const providerConfig = (settings.providers as Record<string, Record<string, unknown>>)[provider]!;
          if (apiKey) providerConfig.api_key = apiKey;
          providerConfig.model = model;
          settings.current_provider = provider;
          settings.model = model;
          this.settingsManager.update(settings);

          this.sharedEventBus?.emit({
            type: 'config-changed',
            id: Math.random().toString(36).substring(7),
            timestamp: Date.now(),
            key: 'init',
            value: true,
          } as any);

          result = { status: 'complete', files: ['SOUL.md', 'USER.md', 'AGENTS.md', 'MEMORY.md', 'TOOLS.md', 'HEARTBEAT.md'], skills: ['deep-research', 'planning'] };
          break;
        }

        // Not yet implemented
        case Method.ORCHESTRA_PANES:
        case Method.ORCHESTRA_BROADCAST:
        case Method.WIKI_QUERY:
        case Method.WIKI_PAGE_GET:
          result = { status: 'not-implemented', method };
          break;

        // Subagent management
        case Method.SUBAGENT_SPAWN: {
          const p = params as Record<string, unknown>;
          const sessionId = this.getStringParam(p, 'sessionId');
          const prompt = this.getStringParam(p, 'prompt');
          if (!sessionId || !prompt) return this.paramError('sessionId, prompt');

          const providerName = p?.provider as string | undefined;
          const mode = p?.mode as 'plan' | 'edit' | 'auto' | 'yolo' | undefined;
          const effort = p?.effort as 'low' | 'medium' | 'high' | 'max' | 'auto' | undefined;
          const model = p?.model as string | undefined;
          const tools = p?.tools as string[] | undefined;

          if (!this.daemonApp || !this.createProvider) {
            return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Daemon not fully initialized' } };
          }

          const settings = this.settingsManager.get();
          // If a specific provider is requested, override current_provider in settings
          const spawnSettings = providerName
            ? { ...settings, current_provider: providerName } as typeof settings
            : settings;
          const providerInstance = this.createProvider(spawnSettings);

          // Resolve model for the subagent.
          // - Explicit 'model' param from UI always wins.
          // - Otherwise use the target provider's configured model.
          const effectiveModel = (() => {
            if (model) return model;
            const targetProvider = spawnSettings.providers?.[providerName || spawnSettings.current_provider];
            return targetProvider?.model || spawnSettings.model;
          })();

          const handle = await this.daemonApp.subagentExecutor.spawn({
            provider: providerInstance,
            model: effectiveModel,
            tools: this.tools,
            cwd: join(homedir(), '.curie-agent'),
            settings,
            prompt,
            system: this.systemPrompt,
            providerName: providerName || undefined,
            mode: mode || settings.mode || 'auto',
            effort,
            allowedTools: tools,
            type: 'subagent',
          });

          result = {
            agentId: handle.agentId,
            sessionId: handle.sessionId,
            prompt: handle.prompt,
            provider: handle.provider,
            status: handle.status,
            startedAt: handle.startedAt,
          };
          break;
        }

        case Method.SUBAGENT_LIST: {
          const p = params as Record<string, unknown>;
          const statusFilter = p?.status as string | undefined;

          if (!this.daemonApp) {
            return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Daemon not initialized' } };
          }

          const agents = this.daemonApp.subagentExecutor.list(statusFilter);
          result = agents.map((a) => ({
            agentId: a.agentId,
            sessionId: a.sessionId,
            prompt: a.prompt,
            provider: a.provider,
            status: a.status,
            text: a.text.slice(0, 200),
            toolCalls: a.toolCalls,
            inputTokens: a.inputTokens,
            outputTokens: a.outputTokens,
            startedAt: a.startedAt,
            doneAt: a.doneAt,
          }));
          break;
        }

        case Method.SUBAGENT_CANCEL: {
          const p = params as Record<string, unknown>;
          const agentId = this.getStringParam(p, 'agentId');
          if (!agentId) return this.paramError('agentId');

          if (!this.daemonApp) {
            return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Daemon not initialized' } };
          }

          // Look up the linked task before cancelling (maps are private)
          const handle = this.daemonApp.subagentExecutor.stats(agentId);
          const taskId = handle?.taskId;

          const cancelled = this.daemonApp.subagentExecutor.cancel(agentId);

          // Cancel linked auto-mode task if present
          if (taskId && this.daemonApp.taskManager) {
            this.daemonApp.taskManager.load();
            this.daemonApp.taskManager.updateTaskStatus(taskId, 'canceled');
          }

          result = { cancelled };
          break;
        }

        case Method.SUBAGENT_STATS: {
          const p = params as Record<string, unknown>;
          const agentId = this.getStringParam(p, 'agentId');
          if (!agentId) return this.paramError('agentId');

          if (!this.daemonApp) {
            return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Daemon not initialized' } };
          }

          const handle = this.daemonApp.subagentExecutor.stats(agentId);
          result = handle ? {
            agentId: handle.agentId,
            sessionId: handle.sessionId,
            prompt: handle.prompt,
            status: handle.status,
            text: handle.text.slice(0, 2000),
            toolCalls: handle.toolCalls,
            errors: handle.errors,
            inputTokens: handle.inputTokens,
            outputTokens: handle.outputTokens,
            startedAt: handle.startedAt,
            doneAt: handle.doneAt,
          } : null;
          break;
        }

         case Method.SUBAGENT_SEND: {
          const p = params as Record<string, unknown>;
          const agentId = this.getStringParam(p, 'agentId');
          const message = this.getStringParam(p, 'message');
          if (!agentId || !message) return this.paramError('agentId, message');

          if (!this.daemonApp) {
            return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Daemon not initialized' } };
          }

          const sent = this.daemonApp.subagentExecutor.sendMessage(agentId, message);
          result = { sent };
          break;
        }

        case Method.TASK_SCHEDULE: {
          const p = params as Record<string, unknown>;
          const instruction = this.getStringParam(p, 'instruction');
          const scheduledAt = this.getStringParam(p, 'scheduled_at');
          if (!instruction || !scheduledAt) return this.paramError('instruction, scheduled_at');

          if (!this.daemonApp) {
            return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Daemon not initialized' } };
          }

          const scheduledAtMs = new Date(scheduledAt).getTime();
          if (isNaN(scheduledAtMs)) return this.paramError('scheduled_at must be a valid ISO datetime');

          // Build metadata with optional overrides
          const provider = p.provider as string | undefined;
          const model = p.model as string | undefined;
          const effort = p.effort as string | undefined;
          const metadata: Record<string, unknown> = {};
          if (provider) metadata.provider = provider;
          if (model) metadata.model = model;
          if (effort) metadata.effort = effort;

          this.daemonApp.taskManager.load();
          const task = this.daemonApp.taskManager.create({
            title: instruction,
            mode: 'agent',
            scope: 'personal',
            scheduled_at: scheduledAtMs,
            description: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : '',
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          });

          const timeStr = new Date(task.scheduled_at!).toLocaleString();
          result = {
            taskId: task.id,
            scheduledAt: timeStr,
            instruction: task.title,
          };
          break;
        }

        // ---- Unified task (todo) management for Kanban board ----

        case Method.TODO_LIST: {
          if (!this.daemonApp) {
            return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Daemon not initialized' } };
          }
          this.daemonApp.taskManager.load();
          const p = (params || {}) as Record<string, unknown>;
          const filters: Record<string, string> = {};
          if (typeof p.status === 'string') filters.status = p.status;
          if (typeof p.mode === 'string') filters.mode = p.mode;
          if (typeof p.scope === 'string') filters.scope = p.scope;
          if (typeof p.priority === 'string') filters.priority = p.priority;
          result = this.daemonApp.taskManager.list(Object.keys(filters).length ? filters : undefined);
          break;
        }

        case Method.TODO_CREATE: {
          if (!this.daemonApp) {
            return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Daemon not initialized' } };
          }
          this.daemonApp.taskManager.load();
          const p = params as Record<string, unknown>;
          const title = this.getStringParam(p, 'title') || '';
          if (!title) return this.paramError('title');
          const task = this.daemonApp.taskManager.create({
            title,
            description: this.getStringParam(p, 'description'),
            mode: typeof p.mode === 'string' ? (p.mode as 'human' | 'agent' | 'notify') : 'human',
            scope: typeof p.scope === 'string' ? (p.scope as 'personal' | 'project') : 'personal',
            priority: typeof p.priority === 'string' ? (p.priority as 'low' | 'medium' | 'high' | 'critical') : 'medium',
            tags: Array.isArray(p.tags) ? p.tags : [],
            scheduled_at: typeof p.scheduled_at === 'number' ? p.scheduled_at : undefined,
          });
          // Override status if specified (create() sets default based on mode)
          if (typeof p.status === 'string') {
            this.daemonApp.taskManager.updateTaskStatus(task.id, p.status as any);
          }
          this.sharedEventBus?.emit({ type: 'todo-changed', id: crypto.randomUUID(), timestamp: Date.now(), action: 'created', taskId: task.id } as any);
          result = this.daemonApp.taskManager.findTask(task.id);
          break;
        }

        case Method.TODO_UPDATE: {
          if (!this.daemonApp) {
            return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Daemon not initialized' } };
          }
          this.daemonApp.taskManager.load();
          const p = params as Record<string, unknown>;
          const taskId = this.getStringParam(p, 'id');
          if (!taskId) return this.paramError('id');
          const task = this.daemonApp.taskManager.findTask(taskId);
          if (!task) return { jsonrpc: '2.0', id, error: { code: -32602, message: `Task ${taskId} not found` } };

          if (typeof p.status === 'string') {
            this.daemonApp.taskManager.updateTaskStatus(taskId, p.status as any);
          }
          if (typeof p.priority === 'string') task.priority = p.priority as any;
          if (typeof p.title === 'string') task.title = p.title;
          if (typeof p.description === 'string') task.description = p.description;
          if (Array.isArray(p.tags)) task.tags = p.tags;
          if (typeof p.mode === 'string') task.mode = p.mode as any;
          if (typeof p.scope === 'string') task.scope = p.scope as any;
          if (typeof p.scheduled_at === 'number') task.scheduled_at = p.scheduled_at;
          this.daemonApp.taskManager.save();
          this.sharedEventBus?.emit({ type: 'todo-changed', id: crypto.randomUUID(), timestamp: Date.now(), action: 'updated', taskId } as any);
          result = { ok: true, task: this.daemonApp.taskManager.findTask(taskId) };
          break;
        }

        case Method.TODO_REMOVE: {
          if (!this.daemonApp) {
            return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Daemon not initialized' } };
          }
          this.daemonApp.taskManager.load();
          const p = params as Record<string, unknown>;
          const taskId = this.getStringParam(p, 'id');
          if (!taskId) return this.paramError('id');
          const removed = this.daemonApp.taskManager.removeTask(taskId);
          this.sharedEventBus?.emit({ type: 'todo-changed', id: crypto.randomUUID(), timestamp: Date.now(), action: 'removed', taskId } as any);
          result = { removed };
          break;
        }

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

  private async handleSend(sessionId: string, text: string, type?: string): Promise<Record<string, unknown>> {
    if (!this.createProvider) {
      return { status: 'error: no provider configured' };
    }

    const settings = this.settingsManager.get();
    const provider = this.createProvider(settings);
    const sessionInfo = this.sessionStore.load(sessionId);

    // Build the turn loop config
    const loop = new TurnLoop({
      provider,
      model: settings.providers[settings.current_provider]?.model || settings.model,
      tools: this.tools,
      cwd: sessionInfo?.cwd || join(homedir(), '.curie-agent'),
      settings,
      approvalMode: settings.mode || 'auto',
      effort: settings.effort,
      sessionId: sessionId,
      resume: !!sessionId,
      system: this.systemPrompt,
      type,
    }, this.sessionStore);

    // Store the loop for potential cancellation
    this.turnLoops.set(sessionId, loop);

    // Bridge the turn loop's event bus to the shared daemon event bus.
    // Note: 'approval-request' is NOT bridged — ApprovalTracker.register()
    // emits it directly. In direct mode (no daemonApp), approval events
    // are not tracked externally anyway.
    const eventTypes: Event['type'][] = [
      'user-prompt', 'assistant-delta', 'assistant-stop', 'tool-call',
      'tool-result', 'approval-decision', 'usage',
      'error', 'session-start', 'session-stop', 'hook', 'status',
      'session-resumed', 'context-warning', 'thinking-delta',
      // Subagent events
      'agent-start', 'agent-text-delta', 'agent-thinking-delta',
      'agent-tool-call', 'agent-tool-result', 'agent-usage',
      'agent-done', 'agent-error',
    ];
    const unsubscribes: Array<() => void> = [];
    for (const type of eventTypes) {
      unsubscribes.push(loop.eventBus.subscribe(type, (event: Event) => {
        this.sharedEventBus?.emit({ ...event, sessionId } as Event & { sessionId?: string });
      }));
    }

    try {
      const result = await loop.run(text);
      await this.checkContextThresholds(sessionId);
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

  /** Get the current working directory from session metadata, falling back to process.cwd(). */
  private getSessionCwd(sessionId: string): string | undefined {
    const metaPath = this.sessionStore.metadataPath(sessionId);
    if (!existsSync(metaPath)) return undefined;
    try {
      const info = JSON.parse(readFileSync(metaPath, 'utf-8')) as SessionInfo;
      return info.cwd;
    } catch {
      return undefined;
    }
  }

  private async executeSlashCommand(sessionId: string, text: string): Promise<void> {
    // 1. Emit user-prompt event so it appears in UI
    const promptEvent: Event = {
      type: 'user-prompt',
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      text,
    } as any;
    this.sharedEventBus?.emit({ ...promptEvent, sessionId } as any);
    this.sessionStore.appendEvent(sessionId, { ...promptEvent, sessionId } as any);

    // Helpers to emit response
    const emitDelta = (chunk: string) => {
      const deltaEvent: Event = {
        type: 'assistant-delta',
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        text: chunk,
      } as any;
      this.sharedEventBus?.emit({ ...deltaEvent, sessionId } as any);
      this.sessionStore.appendEvent(sessionId, { ...deltaEvent, sessionId } as any);
    };

    const emitStop = () => {
      const stopEvent: Event = {
        type: 'assistant-stop',
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      } as any;
      this.sharedEventBus?.emit({ ...stopEvent, sessionId } as any);
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
* \`/mode <plan|edit|auto|yolo>\` — Set agent approval mode.
* \`/tools <max_tools> [max_websearch]\` — Configure dynamic tool limit per turn.
* \`/websearch <limit>\` — Configure maximum web search limits per turn.

**Skills & MCP**
* \`/skill [name]\` — List all globally and project-registered skills or view a specific skill's instructions.
* \`/mcp [list|reload]\` — List connected Model Context Protocol (MCP) servers and their tools, or reload configuration.

**Memory & Context**
* \`/memory [status|add <text>]\` — View active memory files or add new memories to be organized on next turn.

**System Info**
* \`/system\` — Show OS, platform, Node version, home dir, CWD, and PathGuard status.
* \`/context [auto [on|off|threshold N|warn N|pricing on/off]]\` — View visual token capacity fill percentage bar or configure auto-compaction.

**Automation & Scheduling**
* \`/remind <message at time>\` — Create a scheduled reminder (e.g., \`/remind review current pull request in 30 mins\`).
* \`/cron [list|delete <id>|clear]\` — View list of active reminders or manage completed ones.
* \`/heartbeat [status|enable|disable|now|daily <H:MM>|weekly <day@H:MM>...]\` — Control scheduled heartbeat cycles or run immediately.
* \`/task [create <instruction at time>|list [status]|delete <id>]\` — Schedule background autonomous agent tasks.

**Workspace Safety**
* \`/snapshots\` — List Git-backed state snapshots.
* \`/revert <index>\` — Revert workspace to a specific snapshot index.
* \`/cd <path>\` — Change working directory with safety checks.`;
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
* **Approval Mode:** \`${settings.mode || 'auto'}\`
* **Reasoning Effort:** \`${settings.effort || 'auto'}\`
* **Workspace CWD:** \`${this.getSessionCwd(sessionId) || process.cwd()}\`
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
              this.settingsManager.update(settings);
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
                this.settingsManager.update(settings);
                emitDelta(`Model context window capacity set to **${val.toLocaleString()}** tokens.`);
              }
            }
          } else {
            pConfig.model = args;
            settings.model = args;
            this.settingsManager.update(settings);
            this.sharedEventBus?.emit({
              type: 'config-changed',
              id: Math.random().toString(36).substring(7),
              timestamp: Date.now(),
              key: 'model',
              value: args,
            } as any);
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
              this.settingsManager.setCurrentProvider(provider);
              this.sharedEventBus?.emit({
                type: 'config-changed',
                id: Math.random().toString(36).substring(7),
                timestamp: Date.now(),
                key: 'current_provider',
                value: provider,
              } as any);
              emitDelta(`Successfully switched provider to: **${provider}**`);
            }
          }
          break;
        }

        case 'theme': {
          const settings = this.settingsManager.get();
          const validThemes = ['tokyo-night', 'nord', 'dracula', 'solarized', 'gruvbox', 'black', 'white', 'grey'];
          const theme = args.toLowerCase().trim();
          if (!args) {
            emitDelta(`Current theme is: \`${settings.theme || 'nord'}\`. Use \`/theme <name>\` to switch.
* Valid themes: \`tokyo-night | nord | dracula | solarized | gruvbox | black | white | grey\``);
          } else if (!validThemes.includes(theme)) {
            emitDelta(`Unknown theme: "${args}". Valid options are: ${validThemes.join(', ')}`);
          } else {
            settings.theme = theme;
            this.settingsManager.update(settings);
            this.sharedEventBus?.emit({
              type: 'config-changed',
              id: Math.random().toString(36).substring(7),
              timestamp: Date.now(),
              key: 'theme',
              value: theme,
            } as any);
            emitDelta(`Successfully switched theme to: **${theme}**`);
          }
          break;
        }

        case 'mode': {
          const settings = this.settingsManager.get();
          const valid = ['plan', 'edit', 'auto', 'yolo'];
          if (!args) {
            emitDelta(`Current approval mode is: \`${settings.mode || 'auto'}\`. Use \`/mode <plan|edit|auto|yolo>\` to switch.`);
          } else if (!valid.includes(args.toLowerCase())) {
            emitDelta(`Invalid mode: \`${args}\`. Supported modes: plan, edit, auto, yolo.`);
          } else {
            settings.mode = args.toLowerCase() as any;
            this.settingsManager.update(settings);
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
            this.settingsManager.update(settings);
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
          } else if (sub === 'compact') {
            emitDelta(`### ⚡ Manual Compaction Triggered\n\nAnalyzing conversation history and building summary...`);
            try {
              const summary = await this.runAutomaticCompaction(sessionId, 'detailed');
              emitDelta(`\n\n⚡ **Manual Compaction Executed Successfully!**\n\nConversation history has been summarized, reducing the active context usage to just ~500 tokens. The agent will continue seamlessly!\n\n**Restored Context Summary:**\n\n${summary}`);
            } catch (err) {
              emitDelta(`\n\n❌ **Compaction Failed**: ${err instanceof Error ? err.message : String(err)}`);
            }
 } else {
            const activeLoop = this.turnLoops.get(sessionId);
            const history = activeLoop
              ? activeLoop.eventBus.history()
              : (this.sessionStore.loadEvents(sessionId) || []);
            const usageEvents = history.filter((e: any) => e.type === 'usage');
            const latestUsage = usageEvents[usageEvents.length - 1];
            const input = latestUsage ? ((latestUsage as any).inputTokens || 0) : 0;
            const output = latestUsage ? ((latestUsage as any).outputTokens || 0) : 0;
            const model = settings.model || 'unknown';
            const windowSize = settings.providers?.[settings.current_provider as any]?.model_context_window ?? 200000;
            const pct = input > 0 ? Math.min(100, Math.round((input / windowSize) * 100)) : 0;

            const fmt = (n: number) => {
              if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
              if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
              return String(n);
            };

            if (input === 0 && output === 0) {
              emitDelta(`No token data yet. Start a conversation to see context window usage.\n\nActive model: \`${model}\` (Max Context: \`${fmt(windowSize)}\` tokens).`);
            } else {
              const barColor = pct > 80 ? 'var(--red)' : pct > 50 ? 'var(--yellow)' : 'var(--green)';
              const barGradient = pct > 80
                ? 'linear-gradient(90deg, var(--red), #e08070)'
                : pct > 50
                  ? 'linear-gradient(90deg, var(--yellow), #f0d090)'
                  : 'linear-gradient(90deg, var(--green), #c0d8a8)';
              emitDelta(`<div style="background:var(--s3);border-radius:8px;padding:12px;margin:8px 0">` +
                `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">` +
                `<span style="font-family:monospace;font-size:12px;color:var(--text)">Context Window (${model})</span>` +
                `<span style="font-family:monospace;font-size:13px;font-weight:bold;color:${barColor}">${pct}%</span>` +
                `</div>` +
                `<div style="background:var(--s2);border-radius:4px;height:8px;overflow:hidden">` +
                `<div style="width:${pct}%;height:100%;background:${barGradient};border-radius:4px"></div>` +
                `</div>` +
                `<div style="display:flex;justify-content:space-between;margin-top:8px;font-family:monospace;font-size:11px;color:var(--muted)">` +
                `<span>In: ${fmt(input)}</span><span>Out: ${fmt(output)}</span><span>Max: ${fmt(windowSize)}</span>` +
                `</div></div>`);
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
          const task = this.daemonApp.taskManager.create({ title: parsed.message, mode: 'notify', scope: 'personal', scheduled_at: parsed.scheduledAt });
          emitDelta(`Reminder scheduled! **"${parsed.message}"** at ${new Date(parsed.scheduledAt).toLocaleString()}`);
          break;
        }

        case 'cron': {
          if (!this.daemonApp) {
            emitDelta(`Task service is not active on this daemon.`);
            break;
          }
          this.daemonApp.taskManager.load();
          const parts = args.split(/\s+/);
          const sub = parts[0]?.toLowerCase() || '';
          const rest = parts.slice(1).join(' ').trim();

          if (sub === 'list' || !sub) {
            const list = this.daemonApp.taskManager.list({ mode: 'notify' });
            if (list.length === 0) {
              emitDelta(`No reminders scheduled.`);
            } else {
              const items = list.map((t, i) => {
                const timeStr = t.scheduled_at ? new Date(t.scheduled_at).toLocaleString() : '—';
                return `${i + 1}. ${t.status} ${t.title} (Scheduled: ${timeStr}, ID: \`${t.id.slice(0, 8)}\`)`;
              }).join('\n');
              emitDelta(`### Active Reminders:\n${items}`);
            }
          } else if (sub === 'delete') {
            if (!rest) {
              emitDelta(`Usage: \`/cron delete <id>\``);
            } else {
              const result = this.daemonApp.taskManager.cancelTask(rest);
              if (result) {
                emitDelta(`Reminder \`${rest}\` cancelled.`);
              } else {
                emitDelta(`No reminder found with ID: \`${rest}\``);
              }
            }
          } else if (sub === 'clear') {
            const removed = this.daemonApp.taskManager.clearCompleted();
            emitDelta(`Successfully cleared ${removed} completed task(s).`);
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
            settings.heartbeat = { schedule: 'off', mode: 'yolo', daily: '6:00', weekly: 'monday@6:00', monthly: '1@6:00', dreaming: '2:00', intraday: '' };
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
                this.daemonApp.taskManager.rescheduleFromSettings({
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
                this.daemonApp.taskManager.cancelAllHeartbeats();
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
                    this.daemonApp.taskManager.rescheduleFromSettings({
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
                    this.daemonApp.taskManager.rescheduleFromSettings({
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
                    this.daemonApp.taskManager.rescheduleFromSettings({
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
                    this.daemonApp.taskManager.rescheduleFromSettings({
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
                    this.daemonApp.taskManager.rescheduleFromSettings({
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
          this.daemonApp.taskManager.load();
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
                  const task = this.daemonApp.taskManager.create({ title: parsed.message, mode: 'agent', scope: 'personal', scheduled_at: parsed.scheduledAt });
                  const timeStr = new Date(task.scheduled_at!).toLocaleString();
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
              const tasks = this.daemonApp.taskManager.list({ mode: 'agent' });
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
                  const timeStr = t.scheduled_at ? new Date(t.scheduled_at).toLocaleString() : '—';
                  lines.push(`* **[${statusEmoji}]** "${t.title}"`);
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
                const res = this.daemonApp.taskManager.cancelTask(rest);
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

        case 'system': {
          const settings = this.settingsManager.get();
          const safety = settings.safety;
          const osName = os.platform() === 'win32' ? 'Windows' : os.platform() === 'darwin' ? 'macOS' : 'Linux';
          const curieDir = path.join(os.homedir(), '.curie-agent');

          let lines: string[] = [];
          lines.push(`**OS:** ${osName} (${os.arch()}, ${os.hostname()})`);
          lines.push(`**Platform:** \`${os.platform()}\``);
          lines.push(`**Node:** \`${process.version}\``);
          lines.push(`**Home:** \`${os.homedir()}\``);
          lines.push(`**Curie Agent Dir:** \`${curieDir}\``);
          lines.push(`**CWD:** \`${this.getSessionCwd(sessionId) || process.cwd()}\``);
          lines.push('');
          lines.push(`### PathGuard`);
          lines.push(`* **Status:** \`${safety?.path_guard || 'on'}\``);
          const raw = safety?.path_allowlist;
          const hasAllowlist = raw && (Array.isArray(raw) ? raw.length > 0 : typeof raw === 'string' && raw.trim().length > 0);
          const display = Array.isArray(raw) ? raw.join(', ') : raw;
          lines.push(`* **Allowlist:** ${hasAllowlist ? `\`${display}\`` : '(empty)'}`);
          lines.push(`**Blocked:** \`~/.curie-settings.json\` (API keys)`);

          emitDelta(lines.join('\n'));
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

       case 'cd': {
          if (!args) {
            emitDelta('Usage: `/cd <path>` — Change working directory.\n* `/cd add <path>` — Add path to PathGuard allowlist.');
            break;
          }

          const cdParts = args.trim().split(/\s+/);
          const subCmd = cdParts[0]?.toLowerCase();
          const pathArg = cdParts.slice(1).join(' ').trim();

          // /cd add <path> — add a directory to the PathGuard allowlist
          if (subCmd === 'add') {
            if (!pathArg) {
              emitDelta('Usage: `/cd add <path>` — Add a directory to the PathGuard allowlist.');
              break;
            }

            const settings = this.settingsManager.get();
            const safety = settings.safety || {};
            const rawAllowlist = safety.path_allowlist;
            const current = Array.isArray(rawAllowlist) ? [...rawAllowlist as string[]] : [];
            const existingStrings = current.map(s => s.trim()).filter(Boolean);

            // Normalize the requested path
            let normalized: string;
            try {
              const statResult = statSync(pathArg);
              if (!statResult.isDirectory()) {
                emitDelta(`"${pathArg}" is not a directory.`);
                break;
              }
              normalized = realpathSync(pathArg);
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'unknown';
              emitDelta(`Cannot access "${pathArg}": ${msg}`);
              break;
            }

            if (existingStrings.includes(normalized)) {
              emitDelta(`"${normalized}" is already in the PathGuard allowlist.`);
              break;
            }

            const updated = [...current, normalized];
            safety.path_allowlist = updated;
            await this.settingsManager.update({ ...settings, safety });
            emitDelta(`Added "${normalized}" to PathGuard allowlist (${updated.length} path${updated.length === 1 ? '' : 's'} total).`);
            break;
          }

          if (!args || cdParts[0]?.startsWith('-')) {
            emitDelta('Usage: `/cd <path>` — Change working directory.\nExamples:\n* `/cd ../other-project` — relative to current\n* `/cd /home/user/docs` — absolute path\n* `/cd ~` — home directory');
            break;
          }
          const sessionInfo = this.sessionStore.load(sessionId);
          if (!sessionInfo) {
            emitDelta('No session found for the given session ID.');
            break;
          }

          const settings = this.settingsManager.get();
          const safety = settings.safety;
          const safetyPathAllowlist = safety?.path_allowlist;
          const snapshotsEnabled = safety?.snapshots !== 'off';

          const result = await executeCd(
            args,
            sessionInfo.cwd,
            safetyPathAllowlist,
            snapshotsEnabled,
            this.sessionStore.metadataPath(sessionId),
          );

          // Emit config-changed event on success (notify clients of CWD change)
          if (result.kind === 'success') {
            const normalized = result.message.split('\n')[1]?.replace(/\*\*/g, '').trim() || '';
            this.sharedEventBus?.emit({
              type: 'config-changed',
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              key: 'cwd',
              value: normalized,
            } as any);
          }

          emitDelta(result.message);
          break;
        }

        case 'agent': {
          if (!this.daemonApp || !this.createProvider) {
            emitDelta(`Agent system is not active on this daemon.`);
            break;
          }
          if (!args) {
            emitDelta(`Usage: \`/agent <prompt>\` to spawn a subagent. The subagent runs in parallel and streams output back.`);
            break;
          }
          try {
            const settings = this.settingsManager.get();
            const provider = this.createProvider(settings);
            const handle = await this.daemonApp.subagentExecutor.spawn({
              provider,
              model: settings.providers[settings.current_provider]?.model || settings.model,
              tools: this.tools,
              cwd: join(homedir(), '.curie-agent'),
              settings,
              prompt: args,
              system: this.systemPrompt,
              mode: settings.mode || 'auto',
              type: 'subagent',
            });
            emitDelta(`**Agent started**: "${args}" (ID: \`${handle.agentId.slice(0, 8)}...\`). Monitor in the Agents tab.`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            emitDelta(`Failed to start agent: ${msg}`);
          }
          break;
        }

        case 'todo': {
          if (!this.daemonApp) {
            emitDelta(`Task system is not active on this daemon.`);
            break;
          }
          this.daemonApp.taskManager.load();
          const parts = args.trim().split(/\s+/);
          const sub = parts[0]?.toLowerCase() || '';
          const rest = parts.slice(1).join(' ').trim();

          // Detect mode keyword (agent/notify) from full args
          const fullArgsLower = args.toLowerCase();
          let mode: 'human' | 'agent' | 'notify' = 'human';
          if (/^agent\s/.test(fullArgsLower) || /^\bat\b/.test(fullArgsLower)) {
            mode = 'agent';
          } else if (/^notify\s/.test(fullArgsLower) || /remind\s/.test(fullArgsLower)) {
            mode = 'notify';
          }

          const scope = 'personal'; // Default to personal tasks for now

          switch (sub) {
            case 'list': {
              const allTasks = this.daemonApp.taskManager.list({ scope });
              if (allTasks.length === 0) {
                emitDelta(`No tasks in ${scope} scope.`);
              } else {
                const active = allTasks.filter((t) => !['done', 'canceled'].includes(t.status));
                const doneCount = allTasks.filter((t) => t.status === 'done').length;
                const lines = [`### Tasks (${scope}) — ${active.length} active, ${doneCount} done:`];
                for (const t of active.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))) {
                  const icon = String(t.status) === 'in_progress' ? '[*]' : '-';
                  const prio = (t.priority && t.priority !== 'medium') ? ` [${t.priority}]` : '';
                  const modeCol = t.mode ? `[${String(t.mode).toUpperCase()}]` : '[MANUAL]';
                  const timeStr = t.scheduled_at ? ` (at ${new Date(t.scheduled_at).toLocaleString()})` : '';
                  lines.push(`  ${icon} ${String(t.id).slice(0, 8)} ${modeCol}${prio} ${t.title}${timeStr}`);
                }
                emitDelta(lines.join('\n'));
              }
              break;
            }

            case 'add': {
              if (!rest) {
                emitDelta(`Usage: \`/todo add <title>\` or \`/todo auto add "X at Y"\` for scheduled tasks\n  /todo notify add "remind about X" — notification only`);
                break;
              }

              // Detect and strip mode keyword
              let instruction = rest.replace(/^(auto|notify)\s+/, '').trim();
              if (!instruction) {
                emitDelta(`Usage: \`/todo add <title>\` or \`/todo auto add "X at Y"\``);
                break;
              }

              // Check for natural language time (at/in/tomorrow etc.)
              const hasTimeRef = /\b(at|in|tomorrow|tonight)\b/i.test(instruction) || /remind/.test(instruction);
              if (hasTimeRef) {
                const parsed = parseReminderTime(instruction);
                if (parsed) {
                  instruction = parsed.message;
                  if (mode === 'agent') {
                    const task = this.daemonApp.taskManager.create({
                      title: instruction,
                      mode: 'agent', scope, scheduled_at: parsed.scheduledAt,
                    });
                    emitDelta(`**Task scheduled**: "${instruction}" at ${new Date(parsed.scheduledAt).toLocaleString()} (ID: \`${task.id.slice(0, 8)}...\`)`);
                  } else if (mode === 'notify') {
                    const task = this.daemonApp.taskManager.create({
                      title: instruction,
                      mode: 'notify', scope, scheduled_at: parsed.scheduledAt,
                    });
                    emitDelta(`**Reminder set**: "${instruction}" at ${new Date(parsed.scheduledAt).toLocaleString()} (ID: \`${task.id.slice(0, 8)}...\`)`);
                  } else {
                    // manual with time — auto-escalate to notify
                    const task = this.daemonApp.taskManager.create({
                      title: instruction,
                      mode: 'notify', scope, scheduled_at: parsed.scheduledAt,
                    });
                    emitDelta(`**Reminder set**: "${instruction}" at ${new Date(parsed.scheduledAt).toLocaleString()} (ID: \`${task.id.slice(0, 8)}...\`)`);
                  }
                } else {
                  // No time found — fall through to manual add
                }
              }

              if (!hasTimeRef) {
                const task = this.daemonApp.taskManager.create({
                  title: instruction,
                  mode, scope,
                });
                emitDelta(`**Task added**: "${instruction}" (ID: \`${task.id.slice(0, 8)}...\`)`);
              } else if (!parseReminderTime(instruction)) {
                // Parse failed — add as manual task
                const task = this.daemonApp.taskManager.create({
                  title: instruction, mode, scope,
                });
                emitDelta(`**Task added**: "${instruction}" (ID: \`${task.id.slice(0, 8)}...\`)`);
              }
              break;
            }

            case 'complete': {
              if (!rest) {
                emitDelta(`Usage: \`/todo complete <id>\``);
                break;
              }
              const task = this.daemonApp.taskManager.findTask(rest);
              if (!task) {
                emitDelta(`Task not found: \`${rest}\`.`);
              } else {
                this.daemonApp.taskManager.updateTaskStatus(task.id, 'done');
                emitDelta(`Completed: **${task.title}**`);
              }
              break;
            }

            case 'cancel': {
              if (!rest) {
                emitDelta(`Usage: \`/todo cancel <id>\``);
                break;
              }
              const task = this.daemonApp.taskManager.findTask(rest);
              if (!task) {
                emitDelta(`Task not found: \`${rest}\`.`);
              } else {
                this.daemonApp.taskManager.updateTaskStatus(task.id, 'canceled');
                emitDelta(`Canceled: **${task.title}**`);
              }
              break;
            }

            case 'start': {
              if (!rest) {
                emitDelta(`Usage: \`/todo start <id>\``);
                break;
              }
              const task = this.daemonApp.taskManager.findTask(rest);
              if (!task) {
                emitDelta(`Task not found: \`${rest}\`.`);
              } else {
                this.daemonApp.taskManager.updateTaskStatus(task.id, 'in_progress');
                emitDelta(`Started: **${task.title}**`);
              }
              break;
            }

            case 'remove': {
              if (!rest) {
                emitDelta(`Usage: \`/todo remove <id>\``);
                break;
              }
              const task = this.daemonApp.taskManager.findTask(rest);
              if (!task) {
                emitDelta(`Task not found: \`${rest}\`.`);
              } else {
                this.daemonApp.taskManager.removeTask(task.id);
                emitDelta(`Removed: \`${task.id.slice(0, 8)}\``);
              }
              break;
            }

            default: {
              emitDelta(`### Task Commands (Unified Todo System)

**Manual tasks:** \`/todo add "finish report"\` — add to task list
**Auto tasks:** \`/todo auto add "build at 3pm"\` — agent executes it
**Notify:** \`/todo notify add "remind about X at 5pm"\` — notification only

* \`/todo list [personal|project]\` — List tasks
* \`/todo complete <id>\` — Mark done
* \`/todo cancel <id>\` — Cancel task
* \`/todo start <id>\` — Start working on it
* \`/todo remove <id>\` — Delete permanently`);
              break;
            }
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

  private async runAutomaticCompaction(sessionId: string, depth: 'detailed' | 'brief'): Promise<string> {
    if (!this.createProvider) {
      throw new Error('No provider configured');
    }

    const settings = this.settingsManager.get();
    const provider = this.createProvider(settings);
    const model = settings.providers[settings.current_provider]?.model || settings.model;

    const events = this.sessionStore.loadEvents(sessionId) || [];
    if (events.length === 0) {
      throw new Error('No events to compact');
    }

    // Build human-readable transcript
    let transcriptParts: string[] = [];
    for (const e of events) {
      if (e.type === 'user-prompt' && (e as any).text) {
        transcriptParts.push(`User: ${(e as any).text}`);
      } else if (e.type === 'assistant-delta' && (e as any).text) {
        const lastIdx = transcriptParts.length - 1;
        if (lastIdx >= 0 && transcriptParts[lastIdx]?.startsWith('Assistant:')) {
          transcriptParts[lastIdx] += (e as any).text;
        } else {
          transcriptParts.push(`Assistant: ${(e as any).text}`);
        }
      }
    }
    const transcript = transcriptParts.join('\n\n');
    if (!transcript.trim()) {
      throw new Error('No conversational history found to compact');
    }

    const systemPrompt = `You are a conversation summarizer. Summarize the provided dialogue in a dense, detailed, high-fidelity paragraph or two. Focus on capturing the original goals, what was accomplished, any modified files or configurations, current settings, and what the pending next steps are. Ensure all key technical details (like file paths, specific code adjustments, command names) are preserved. Do not add any conversational intros or outros; output ONLY the raw summary text.`;
    const prompt = `Please summarize this conversation history:\n\n${transcript}`;

    const summary = await provider.check(prompt, { model, system: systemPrompt });
    const cleanSummary = summary.trim();

    // Overwrite events log
    const eventsPath = this.sessionStore.eventsPath(sessionId);
    const newEvents = [
      {
        type: 'session-start',
        id: crypto.randomUUID(),
        model,
        provider: settings.current_provider || 'unknown',
        cwd: process.cwd(),
        timestamp: Date.now(),
      },
      {
        type: 'user-prompt',
        id: crypto.randomUUID(),
        text: `This is a continuation of a compacted conversation. Here is the high-fidelity summary of our session so far:\n\n${cleanSummary}\n\nLet's continue!`,
        cwd: process.cwd(),
        timestamp: Date.now() + 1,
      },
      {
        type: 'assistant-delta',
        id: crypto.randomUUID(),
        text: `Got it! I have fully restored our conversation summary and details. Let let me know what you would like to do next!`,
        timestamp: Date.now() + 2,
      },
      {
        type: 'assistant-stop',
        id: crypto.randomUUID(),
        timestamp: Date.now() + 3,
      }
    ];

    const data = newEvents.map((e) => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(eventsPath, data, 'utf-8');

    return cleanSummary;
  }

  private async checkContextThresholds(sessionId: string): Promise<void> {
    const settings = this.settingsManager.get();
    const history = this.sessionStore.loadEvents(sessionId) || [];
    const usageEvents = history.filter((e: any) => e.type === 'usage');
    let input = 0;
    let output = 0;
    for (const e of usageEvents) {
      input += (e as any).inputTokens || 0;
      output += (e as any).outputTokens || 0;
    }

    if (input === 0) return; // No token data yet

    const windowSize = settings.providers?.[settings.current_provider as any]?.model_context_window ?? 200000;
    const pct = Math.min(100, Math.round((input / windowSize) * 100));

    const autoCompact = settings.auto_compact || { enabled: 'on', threshold: 80, warn_threshold: 60, forced_threshold: 85 };
    const warnThresh = autoCompact.warn_threshold ?? 60;
    const compactThresh = autoCompact.threshold ?? 80;
    const forcedThresh = autoCompact.forced_threshold ?? 85;
    const enabled = autoCompact.enabled ?? 'on';

    if (pct >= forcedThresh && enabled === 'on') {
      try {
        const summary = await this.runAutomaticCompaction(sessionId, 'detailed');
        const successMessage = `⚡ **Auto-Compaction Executed Successfully!**\n\nContext usage was at **${pct}%** (forced threshold: **${forcedThresh}%**).\nWe have summarized the conversation, reducing the history size down to just ~500 tokens. The agent will continue seamlessly!\n\n**Restored Context Summary:**\n\n${summary}`;
        
        const warningEvent = {
          type: 'context-warning',
          id: crypto.randomUUID(),
          message: successMessage,
          timestamp: Date.now(),
        };
        this.sharedEventBus?.emit({ ...warningEvent, sessionId } as any);
        this.sessionStore.appendEvent(sessionId, { ...warningEvent, sessionId } as any);
      } catch (err) {
        console.error('[compaction] Auto-compaction failed:', err);
      }
    } else if (pct >= compactThresh) {
      const suggestMessage = `⚠️ **Context Fill High (${pct}%)**\n\nYour context fill is at **${pct}%** (Threshold: **${compactThresh}%**). Suggesting conversation compaction.\n\nType \`/context compact\` to run compaction, summarize history, and free memory immediately!`;
      
      const warningEvent = {
        type: 'context-warning',
        id: crypto.randomUUID(),
        message: suggestMessage,
        timestamp: Date.now(),
      };
      this.sharedEventBus?.emit({ ...warningEvent, sessionId } as any);
      this.sessionStore.appendEvent(sessionId, { ...warningEvent, sessionId } as any);
    } else if (pct >= warnThresh) {
      const warnMessage = `⚠️ **Context Warning (${pct}%)**\n\nContext window is **${pct}%** full (Warning threshold: **${warnThresh}%**).`;
      
      const warningEvent = {
        type: 'context-warning',
        id: crypto.randomUUID(),
        message: warnMessage,
        timestamp: Date.now(),
      };
      this.sharedEventBus?.emit({ ...warningEvent, sessionId } as any);
      this.sessionStore.appendEvent(sessionId, { ...warningEvent, sessionId } as any);
    }
  }
}
