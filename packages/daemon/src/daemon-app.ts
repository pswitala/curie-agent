import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import type {
  EventBus, Event, SessionStore, SettingsManager,
  CurieSettings, ProviderStream, Tool,
} from '@curie-agent/core';
import { TaskManager, TelegramGateway, HeartbeatExecutor, HeartbeatDelivery, SubagentExecutor, migrateTasks } from '@curie-agent/core';
import type { ScheduleType, UnifiedTask, SubagentHandle } from '@curie-agent/core';
import type { ProviderFactory } from './server.js';
import { ApprovalTracker } from './approval-tracker.js';
import { ChannelManager } from './channel-manager.js';

/** MCP server configuration. */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConnectionStatus {
  serverId: string;
  connected: boolean;
  tools: string[];
}

/** Callback type for Telegram message delivery. */
export type SendMessageFn = (chatId: string, text: string) => Promise<void>;

/**
 * Central orchestrator for the daemon. Wires together:
 * - ChannelManager (per-channel TurnLoop)
 * - ApprovalTracker (cross-client approval resolution)
 * - TaskManager (heartbeats, reminders, scheduled tasks)
 * - TelegramGateway (Telegram bot)
 * - MCP tool management
 */
export class DaemonApp {
  public channelManager: ChannelManager;
  public approvalTracker: ApprovalTracker;
  /** Unified task manager — primary store for all tasks (manual, auto, notify). */
  public taskManager: TaskManager;
  public subagentExecutor: SubagentExecutor;
  public telegramGateway: TelegramGateway | null = null;
  public mcpStatus: McpConnectionStatus[] = [];

  private checkerTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribes: Array<() => void> = [];
  /** Maps task ID → subagent agentId for auto-mode tasks. */
  private taskIdAgentMap = new Map<string, string>();
  /** Reverse map: subagent agentId → task ID. */
  private agentIdTaskMap = new Map<string, string>();

  constructor(
    private eventBus: EventBus,
    private sessionStore: SessionStore,
    private settingsManager: SettingsManager,
    private createProvider?: ProviderFactory,
    private tools: Tool[] = [],
    private mcpServers?: Record<string, McpServerConfig>,
    private sendMessage?: SendMessageFn,
    private systemPrompt?: string,
  ) {
    this.approvalTracker = new ApprovalTracker(eventBus);
    this.channelManager = new ChannelManager(
      eventBus, sessionStore, settingsManager,
      createProvider, tools, this.approvalTracker, this.systemPrompt,
    );
 this.taskManager = new TaskManager();
    this.subagentExecutor = new SubagentExecutor(eventBus, sessionStore);
  }

  /** Start all subsystems. */
  async start(): Promise<void> {
    const settings = this.settingsManager.get();

    // Start Telegram gateway if configured
    if (settings.channels?.bot_token && settings.channels?.user_id) {
      this.telegramGateway = new TelegramGateway({
        botToken: settings.channels.bot_token,
        allowedUserId: settings.channels.user_id,
        onUserMessage: (ctx) => this.handleTelegramMessage(ctx),
        onApprovalDecision: (toolCallId, approved) => {
          this.approvalTracker.decide(toolCallId, approved ? 'allow' : 'deny');
        },
        onError: (err) => {
          console.error('[telegram] Error:', err.message);
        },
      });

      this.telegramGateway.start();
    }

    // Run migration: merge legacy todo.json + cron.json → tasks.json (runs once)
    try { migrateTasks(); } catch (err) { console.error('[daemon] Migration error:', err); }

    // Ensure heartbeat is correctly scheduled if enabled
    this.taskManager.load();
    if (settings.heartbeat?.schedule === 'on') {
      const hb = settings.heartbeat;
      this.taskManager.rescheduleFromSettings({
        HEARTBEAT_INTRADAY: hb.intraday,
        HEARTBEAT_DAILY: hb.daily,
        HEARTBEAT_WEEKLY: hb.weekly,
        HEARTBEAT_MONTHLY: hb.monthly,
        HEARTBEAT_DREAMING: hb.dreaming,
      });
    }

    // Subscribe to configuration changes to auto-reschedule cron
    this.unsubscribes.push(
      this.eventBus.subscribe('config-changed' as any, () => {
        this.taskManager.load();
        const freshSettings = this.settingsManager.get();
        if (freshSettings.heartbeat?.schedule === 'on') {
          const hb = freshSettings.heartbeat;
          this.taskManager.rescheduleFromSettings({
            HEARTBEAT_INTRADAY: hb.intraday,
            HEARTBEAT_DAILY: hb.daily,
            HEARTBEAT_WEEKLY: hb.weekly,
            HEARTBEAT_MONTHLY: hb.monthly,
            HEARTBEAT_DREAMING: hb.dreaming,
          });
        } else {
          // Cancel all pending heartbeat tasks
          this.taskManager.cancelAllHeartbeats();
        }
      })
    );

    // Start cron checker
    this.startCronChecker();

    // Subscribe to subagent lifecycle events for auto-mode task status updates
    this.unsubscribes.push(
      this.eventBus.subscribe('agent-done' as any, (event: Event) => {
        const meta = (event as any).metadata as Record<string, unknown> | undefined;
        if (meta?.taskId && meta?.taskType === 'auto') {
          const taskId = meta.taskId as string;
          this.taskManager.load();
          const task = this.taskManager.findTask(taskId);
          if (task) {
            // Clear the map entries
            this.taskIdAgentMap.delete(taskId);
            const agentId = this.agentIdTaskMap.get(taskId);
            if (agentId) this.agentIdTaskMap.delete(agentId);
            // Update task status; store result text if available
            const text = (event as any).text as string | undefined;
            this.taskManager.updateTaskStatus(taskId, 'completed');
            if (task.metadata) {
              (task.metadata as Record<string, unknown>).resultText = text;
              this.taskManager.save();
            }
          }
        }
      }),
    );

    this.unsubscribes.push(
      this.eventBus.subscribe('agent-error' as any, (event: Event) => {
        const meta = (event as any).metadata as Record<string, unknown> | undefined;
        if (meta?.taskId && meta?.taskType === 'auto') {
          const taskId = meta.taskId as string;
          this.taskManager.load();
          this.taskManager.updateTaskStatus(taskId, 'failed');
          this.taskIdAgentMap.delete(taskId);
          const agentId = this.agentIdTaskMap.get(taskId);
          if (agentId) this.agentIdTaskMap.delete(agentId);
        }
      }),
    );

    // Emit daemon-ready event
    this.eventBus.emit({
      type: 'daemon-ready',
      id: crypto.randomUUID(),
      version: '0.2.4',
      timestamp: Date.now(),
    } as unknown as Event);
  }

  /** Stop all subsystems. */
  async stop(): Promise<void> {
    this.stopCronChecker();
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
    this.telegramGateway?.stop();
    this.channelManager.cleanup();
    this.approvalTracker.clear();
    this.subagentExecutor.shutdown();
  }

  /**
   * Handle incoming Telegram message. Routes to the appropriate
   * channel, then calls back to the sender.
   */
  private handleTelegramMessage(ctx: {
    text: string;
    chatId: string;
    userId: string;
    isGroup: boolean;
    chatTitle?: string;
  }): void {
    const route = this.channelManager.routeTelegramMessage({
      chatId: ctx.chatId,
      userId: ctx.userId,
      isGroup: ctx.isGroup,
      chatTitle: ctx.chatTitle,
    });

    if (!route) {
      console.log('[telegram] Message rejected (group not allowed)');
      return;
    }

    // Emit the message as a user-prompt event so clients can see it
    this.eventBus.emit({
      type: 'user-prompt',
      id: crypto.randomUUID(),
      text: ctx.text,
      cwd: join(homedir(), '.curie-agent'),
      timestamp: Date.now(),
    } as Event);

    // Process the message asynchronously — response will be sent
    // back via TelegramGateway when the turn completes
    this.processTelegramTurn(route.channelId, route.sessionId, ctx.text, ctx.chatId);
  }

  /**
   * Process a Telegram turn. Sends the message to the TurnLoop,
   * collects the response, and delivers it back via Telegram.
   */
  private async processTelegramTurn(
    channelId: string,
    sessionId: string,
    text: string,
    chatId: string,
  ): Promise<void> {
    try {
      if (!this.createProvider) {
        await this.sendTelegram(chatId, 'Error: no provider configured');
        return;
      }

      const settings = this.settingsManager.get();
      const provider = this.createProvider(settings);

      // Collect assistant text
      let assistantText = '';
      const { TurnLoop } = await import('@curie-agent/core');

      const loop = new TurnLoop({
        provider,
        model: settings.providers[settings.current_provider]?.model || settings.model,
        tools: this.tools,
        cwd: join(homedir(), '.curie-agent'),
        settings,
        approvalMode: settings.mode || 'auto',
        effort: settings.effort,
        sessionId,
        resume: !!sessionId,
        system: this.systemPrompt,
        onApprovalAsk: async (req: { toolCallId?: string; name: string; input: Record<string, unknown>; reason: string }) => {
          const toolCallId = req.toolCallId || crypto.randomUUID();
          // Send approval request to Telegram
          if (this.telegramGateway) {
            this.telegramGateway.sendApprovalRequest(
              chatId, toolCallId, req.name,
              JSON.stringify(req.input).slice(0, 200),
            );
          }
          return this.approvalTracker.register({
            toolCallId, name: req.name, input: req.input,
            sessionId, channelId,
          });
        },
        type: 'telegram',
      }, this.sessionStore);

      // Bridge events to shared bus
      const eventTypes: Event['type'][] = [
        'assistant-delta', 'tool-call', 'tool-result',
        'error', 'session-start', 'session-stop',
      ];
      const unsubs = eventTypes.map(type =>
        loop.eventBus.subscribe(type, (event: Event) => this.eventBus.emit(event))
      );

      // Also collect assistant text for Telegram delivery
      unsubs.push(loop.eventBus.subscribe('assistant-delta', (e: Event) => {
        if (e.type === 'assistant-delta') assistantText += e.text;
      }));

      try {
        await loop.run(text);
      } finally {
        unsubs.forEach(u => u());
      }

      // Send response back (truncate to Telegram limit)
      const response = assistantText.slice(0, 4096);
      if (response) {
        await this.sendTelegram(chatId, response);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.sendTelegram(chatId, `Error: ${msg}`);
    }
  }

  /** Send a message to Telegram chat. */
  private async sendTelegram(chatId: string, text: string): Promise<void> {
    if (this.telegramGateway) {
      await this.telegramGateway.sendMessage(chatId, text);
    } else if (this.sendMessage) {
      await this.sendMessage(chatId, text);
    }
  }

  /** Start the cron checker (heartbeat + scheduled tasks + reminders). */
  private startCronChecker(intervalMs = 60_000): void {
    this.checkerTimer = setInterval(async () => {
      this.taskManager.load();

      const now = Date.now();
      const pendingTasks = this.taskManager.list({ status: 'pending' });

      for (const task of pendingTasks) {
        if (!task.scheduled_at || task.scheduled_at > now) continue;

        if (this.taskManager.isHeartbeat(task)) {
          const oldScheduledAt = task.scheduled_at;
          const firedScheduleType = task.frequency?.type;

          await this.executeHeartbeatUnified(task, oldScheduledAt, firedScheduleType as ScheduleType).catch(err => {
            console.error('[DaemonApp] heartbeat run error:', err);
          });
        } else if (task.mode === 'agent') {
          // One-shot scheduled task (LLM executes)
          await this.executeTaskUnified(task);
        } else if (task.mode === 'notify') {
          // Reminder notification — mark done and emit event
          this.taskManager.updateTaskStatus(task.id, 'done');

          const event = {
            type: 'cron-task-fired',
            id: crypto.randomUUID(),
            taskId: task.id,
            taskType: 'notify',
            message: task.title,
            timestamp: Date.now(),
          } as unknown as Event;

          this.eventBus.emit(event);

          // 1. Notify Web UI
          const targetSessionId = this.sessionStore.list().sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id;
          if (targetSessionId) {
            try {
              this.sessionStore.appendEvent(targetSessionId, { ...event, sessionId: targetSessionId } as any);
            } catch { /* ignore */ }
          }

          // 2. Notify Telegram
          const settings = this.settingsManager.get();
          if (settings.channels?.user_id) {
            this.sendTelegram(settings.channels.user_id, `🔔 **Reminder:** ${task.title}`).catch(err => {
              console.error('[DaemonApp] failed to send reminder to telegram:', err);
            });
          }
        }
      }
    }, intervalMs);
  }

  /** Stop the cron checker. */
  private stopCronChecker(): void {
    if (this.checkerTimer) {
      clearInterval(this.checkerTimer);
      this.checkerTimer = null;
    }
  }

  /** Execute a scheduled task from unified TaskManager (auto mode). */
  private async executeTaskUnified(task: UnifiedTask): Promise<void> {
    if (!this.createProvider) return;
    try {
      const settings = this.settingsManager.get();
      const provider = this.createProvider(settings);

      const autoSystem = this.buildAutoSystemPrompt(task.title);
      const fullSystem = this.systemPrompt
        ? `${this.systemPrompt}\n\n${autoSystem}`
        : autoSystem;
      const userPrompt = this.buildAutoUserPrompt(task.title);

      this.taskManager.updateTaskStatus(task.id, 'executing');

      const metadata = { taskId: task.id, taskType: 'agent' };

      // Parse optional spawn overrides from task metadata (set via WebUI schedule form)
      const spawnOverrides = task.metadata as Record<string, unknown> | undefined;
      const effectiveModel = (spawnOverrides?.model as string) || settings.providers[settings.current_provider]?.model || settings.model;
      const effectiveEffort = (spawnOverrides?.effort as 'low' | 'medium' | 'high' | 'max' | 'auto') || settings.effort;

      const handle: SubagentHandle = await this.subagentExecutor.spawn({
        provider,
        model: effectiveModel,
        tools: this.tools,
        cwd: join(homedir(), '.curie-agent'),
        settings,
        prompt: userPrompt,
        system: fullSystem,
        mode: 'auto', 
        effort: effectiveEffort,
        type: 'subagent',
        metadata,
      } as any);

      // Track linkage for completion/cancel sync
      this.taskIdAgentMap.set(task.id, handle.agentId);
      this.agentIdTaskMap.set(handle.agentId, task.id);
    } catch (err) {
      this.taskManager.updateTaskStatus(task.id, 'canceled');
      console.error('[auto task] spawn failed:', err);
    }
  }

   /** Build system prompt for an auto-mode subagent — persistent identity + operational context. */
  private buildAutoSystemPrompt(taskTitle: string): string {
    const curieDir = join(homedir(), '.curie-agent');

    // Read active tasks from unified format or legacy todo.json
    let tasksSection = '';
    const taskPath = join(curieDir, 'tasks.json');
    if (existsSync(taskPath)) {
      const raw = readFileSync(taskPath, 'utf-8');
      try {
        const parsed = JSON.parse(raw) as { tasks?: Array<{ id: string; title: string; status: string; priority?: string }> };
        if (parsed.tasks?.length) {
          tasksSection = `\n=== ACTIVE TASKS ===\n` + parsed.tasks.filter(t => t.status !== 'done').map(t => `  [${t.status}] ${t.title}`).join('\n');
        }
      } catch { /* skip */ }
    } else {
      const todoPath = join(curieDir, 'todo.json');
      if (existsSync(todoPath)) {
        const raw = readFileSync(todoPath, 'utf-8');
        try {
          const parsed = JSON.parse(raw) as { tasks?: Array<{ id: string; title: string; status: string; priority?: string }> };
          if (parsed.tasks?.length) {
            tasksSection = `\n=== ACTIVE TASKS ===\n` + parsed.tasks.filter(t => t.status !== 'done').map(t => `  [${t.status}] ${t.title}`).join('\n');
          }
        } catch { /* skip */ }
      }
    }

    const sections: string[] = [];

    // Persistent user profile
    const userMd = join(curieDir, 'USER.md');
    if (existsSync(userMd)) {
      sections.push(`=== USER PROFILE ===\n${readFileSync(userMd, 'utf-8')}`);
    }

    // Persistent agent memory
    const memoryMd = join(curieDir, 'MEMORY.md');
    if (existsSync(memoryMd)) {
      sections.push(`=== AGENT MEMORY ===\n${readFileSync(memoryMd, 'utf-8')}`);
    }

    // Active tasks
    if (tasksSection) {
      sections.push(tasksSection.trimStart());
    }

    // Available tools listing
    if (this.tools.length > 0) {
      const toolList = this.tools.map(t => `- ${t.definition.name}: ${t.definition.description}`).join('\n');
      sections.push(`=== AVAILABLE TOOLS ===\n${toolList}`);
    }

    // Subagent communication protocol
    sections.push('=== COMMUNICATION PROTOCOL ===\nWhen you need a tool, call it through the tool-use interface.\nWhen done, respond with a clear summary of your results.');

    return sections.join('\n\n');
  }

   /** Build user message for an auto-mode subagent — task instruction only. */
  private buildAutoUserPrompt(taskTitle: string): string {
    return `${taskTitle}\n\nExecute this task using available tools. Deliver a clear summary of your results.`;
  }

  /** Execute a heartbeat from unified TaskManager (auto mode + frequency). */
  private async executeHeartbeatUnified(task: UnifiedTask, oldScheduledAt?: number, firedScheduleType?: ScheduleType): Promise<void> {
    if (!this.createProvider) return;

    this.taskManager.markExecuting(task.id);

    try {
      const settings = this.settingsManager.get();
      const provider = this.createProvider(settings);
      const scheduleType = (firedScheduleType ?? task.frequency?.type) as ScheduleType;

      const executor = new HeartbeatExecutor({
        provider,
        model: settings.providers[settings.current_provider]?.model || settings.model,
        tools: this.tools,
        cwd: join(homedir(), '.curie-agent'),
        settings,
        scheduleType,
        system: this.systemPrompt,
      });

      const result = await executor.execute();
      const formatted = HeartbeatDelivery.formatBrief(result);

      this.eventBus.emit({
        type: 'heartbeat-brief',
        id: crypto.randomUUID(),
        scheduleType: scheduleType || 'daily',
        formattedText: formatted,
        toolCalls: result.toolCalls,
        maxTurns: result.maxTurns,
        reason: result.reason,
        errors: result.errors,
        timestamp: Date.now(),
      } as unknown as Event);

      if (this.telegramGateway && settings.channels?.chat_id) {
        await this.telegramGateway.sendMessage(settings.channels.chat_id, formatted);
      }
    } catch (err) {
      console.error('[unified heartbeat] Execution failed:', err);
    } finally {
      // Remove the fired task and schedule the next one.
      // Runs even on error so the heartbeat cycle is never permanently stuck.
      this.taskManager.clearExecuting(task.id);
      this.taskManager.removeTask(task.id);
      const freshSettings = this.settingsManager.get();
      const hb = freshSettings.heartbeat;
      if (freshSettings.heartbeat?.schedule === 'on' && hb) {
        this.taskManager.rescheduleFromSettings({
          HEARTBEAT_INTRADAY: hb.intraday ?? '',
          HEARTBEAT_DAILY: hb.daily ?? '',
          HEARTBEAT_WEEKLY: hb.weekly ?? '',
          HEARTBEAT_MONTHLY: hb.monthly ?? '',
          HEARTBEAT_DREAMING: hb.dreaming ?? '',
        });
      }
    }
  }

 /** Run an immediate heartbeat (triggered via RPC). */
  async runHeartbeat(scheduleType?: ScheduleType): Promise<{
    text: string;
    toolCalls: number;
    maxTurns?: number;
    reason: string;
    errors: string[];
  }> {
    if (!this.createProvider) {
      throw new Error('no provider configured');
    }

    const settings = this.settingsManager.get();
    const provider = this.createProvider(settings);

   const executor = new HeartbeatExecutor({
      provider,
      model: settings.providers[settings.current_provider]?.model || settings.model,
      tools: this.tools,
      cwd: join(homedir(), '.curie-agent'),
      settings,
      scheduleType,
      system: this.systemPrompt,
    });

    const result = await executor.execute();
    const formatted = HeartbeatDelivery.formatBrief(result);

    this.eventBus.emit({
      type: 'heartbeat-brief',
      id: crypto.randomUUID(),
      scheduleType: scheduleType || 'daily',
      formattedText: formatted,
      toolCalls: result.toolCalls,
      maxTurns: result.maxTurns,
      reason: result.reason,
      errors: result.errors,
      timestamp: Date.now(),
    } as unknown as Event);

    return { text: formatted, toolCalls: result.toolCalls, maxTurns: result.maxTurns, reason: result.reason, errors: result.errors };
  }
}
