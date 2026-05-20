import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  EventBus, Event, SessionStore, SettingsManager,
  CurieSettings, ProviderStream, Tool,
} from '@curie-agent/core';
import { CronManager, TelegramGateway, HeartbeatExecutor, HeartbeatDelivery, TaskExecutor, SubagentExecutor, computeNextFire } from '@curie-agent/core';
import type { ScheduleType, CronTask } from '@curie-agent/core';
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
 * - CronManager (heartbeat + reminders)
 * - TelegramGateway (Telegram bot)
 * - MCP tool management
 */
export class DaemonApp {
  public channelManager: ChannelManager;
  public approvalTracker: ApprovalTracker;
  public cronManager: CronManager;
  public subagentExecutor: SubagentExecutor;
  public telegramGateway: TelegramGateway | null = null;
  public mcpStatus: McpConnectionStatus[] = [];

  private checkerTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribes: Array<() => void> = [];

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
    this.cronManager = new CronManager();
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

    // Ensure heartbeat is correctly scheduled if enabled
    this.cronManager.load();
    if (settings.heartbeat?.schedule === 'on') {
      const hb = settings.heartbeat;
      this.cronManager.rescheduleFromSettings({
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
        this.cronManager.load();
        const freshSettings = this.settingsManager.get();
        if (freshSettings.heartbeat?.schedule === 'on') {
          const hb = freshSettings.heartbeat;
          this.cronManager.rescheduleFromSettings({
            HEARTBEAT_INTRADAY: hb.intraday,
            HEARTBEAT_DAILY: hb.daily,
            HEARTBEAT_WEEKLY: hb.weekly,
            HEARTBEAT_MONTHLY: hb.monthly,
            HEARTBEAT_DREAMING: hb.dreaming,
          });
        } else {
          // Cancel pending heartbeat task if heartbeat is disabled
          const pendingHb = this.cronManager.listReminders('pending').find(t => t.type === 'heartbeat');
          if (pendingHb) {
            this.cronManager.cancelReminder(pendingHb.id);
          }
        }
      })
    );

    // Start cron checker
    this.startCronChecker();

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
        model: settings.model_override || settings.model,
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

  /** Start the cron checker (heartbeat + reminders). */
  private startCronChecker(intervalMs = 60_000): void {
    this.checkerTimer = setInterval(async () => {
      this.cronManager.load();
      this.cronManager.pruneOld(Date.now() - (7 * 24 * 60 * 60 * 1000));
      const tasks = this.cronManager.listReminders('pending');
      const now = Date.now();

      for (const task of tasks) {
        if (!task.scheduledAt || task.scheduledAt > now) continue;

        if (task.type === 'heartbeat' && task.schedule) {
          // Update and persist scheduledAt before firing to prevent multiple runs.
          // Heartbeat tasks stay pending so they fire repeatedly.
          const oldScheduledAt = task.scheduledAt;
          task.scheduledAt = computeNextFire(task.schedule, now);
          this.cronManager.save();

          // Fire asynchronously in background
          this.executeHeartbeat(task, oldScheduledAt).catch(err => {
            console.error('[DaemonApp] heartbeat run error:', err);
          });
        } else if (task.type === 'task') {
          await this.executeTask(task);
        } else if (task.type === 'reminder') {
          task.status = 'fired';
          task.completedAt = Date.now();
          this.cronManager.save();

          const event = {
            type: 'cron-task-fired',
            id: crypto.randomUUID(),
            taskId: task.id,
            taskType: 'reminder',
            message: task.message,
            timestamp: Date.now(),
            sessionId: task.sessionId,
          } as unknown as Event;

          this.eventBus.emit(event);

          // 1. Notify Web UI (save event into session store history)
          const targetSessionId = task.sessionId || this.sessionStore.list().sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id;
          if (targetSessionId) {
            try {
              this.sessionStore.appendEvent(targetSessionId, {
                ...event,
                sessionId: targetSessionId,
              } as any);
            } catch (err) {
              console.error('[DaemonApp] failed to append reminder event to sessionStore:', err);
            }
          }

          // 2. Notify Telegram
          const settings = this.settingsManager.get();
          if (settings.channels?.user_id) {
            this.sendTelegram(settings.channels.user_id, `🔔 **Reminder:** ${task.message}`).catch(err => {
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

  /** Execute a heartbeat task. */
  private async executeHeartbeat(task: CronTask, oldScheduledAt?: number): Promise<void> {
    if (!this.createProvider) return;

    try {
      const settings = this.settingsManager.get();
      const provider = this.createProvider(settings);
      const scheduleType = task.schedule?.type as ScheduleType;

   const executor = new HeartbeatExecutor({
        provider,
        model: settings.model_override || settings.model,
        tools: this.tools,
        cwd: join(homedir(), '.curie-agent'),
        settings,
        scheduleType,
        system: this.systemPrompt,
      });

      const result = await executor.execute();
      const formatted = HeartbeatDelivery.formatBrief(result);

      // Emit heartbeat-brief event
      this.eventBus.emit({
        type: 'heartbeat-brief',
        id: crypto.randomUUID(),
        scheduleType: scheduleType || 'daily',
        formattedText: formatted,
        toolCalls: result.toolCalls,
        errors: result.errors,
        timestamp: Date.now(),
      } as unknown as Event);

      // Deliver to Telegram if configured
      if (this.telegramGateway && settings.channels?.chat_id) {
        await this.telegramGateway.sendMessage(settings.channels.chat_id, formatted);
      }
    } catch (err) {
      console.error('[heartbeat] Execution failed:', err);
    }
  }

  /** Execute a scheduled task. */
  private async executeTask(task: CronTask): Promise<void> {
    if (!this.createProvider) return;

    try {
      const settings = this.settingsManager.get();
      const provider = this.createProvider(settings);

      this.cronManager.updateTaskStatus(task.id, 'executing');

  const executor = new TaskExecutor({
        provider,
        model: settings.model_override || settings.model,
        tools: this.tools,
        cwd: join(homedir(), '.curie-agent'),
        settings,
        instruction: task.message,
        system: this.systemPrompt,
      });

      const result = await executor.execute();
      this.cronManager.updateTaskStatus(task.id, 'completed');

      this.eventBus.emit({
        type: 'cron-task-fired',
        id: crypto.randomUUID(),
        taskId: task.id,
        taskType: 'task',
        message: `Task completed: ${task.message} (${result.toolCalls} tool calls)`,
        timestamp: Date.now(),
      } as unknown as Event);
    } catch (err) {
      this.cronManager.updateTaskStatus(task.id, 'failed');
      console.error('[task] Execution failed:', err);
    }
  }

  /** Run an immediate heartbeat (triggered via RPC). */
  async runHeartbeat(scheduleType?: ScheduleType): Promise<{
    text: string;
    toolCalls: number;
    errors: string[];
  }> {
    if (!this.createProvider) {
      throw new Error('no provider configured');
    }

    const settings = this.settingsManager.get();
    const provider = this.createProvider(settings);

   const executor = new HeartbeatExecutor({
      provider,
      model: settings.model_override || settings.model,
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
      errors: result.errors,
      timestamp: Date.now(),
    } as unknown as Event);

    return { text: formatted, toolCalls: result.toolCalls, errors: result.errors };
  }
}
