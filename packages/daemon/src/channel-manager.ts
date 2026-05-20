import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  EventBus, Event, SessionStore, SettingsManager,
  CurieSettings, ProviderStream, Tool, ReasoningEffort,
} from '@curie-agent/core';
import { TurnLoop, ChannelRegistry, ChannelRouter } from '@curie-agent/core';
import type { ChannelEntry, ChannelType } from '@curie-agent/core';
import type { ProviderFactory } from './server.js';
import { ApprovalTracker } from './approval-tracker.js';

/** Maintains per-channel TurnLoop instances and session mapping. */
export class ChannelManager {
  private registry: ChannelRegistry;
  private router: ChannelRouter;
  private turnLoops = new Map<string, TurnLoop>();

  constructor(
    private eventBus: EventBus,
    private sessionStore: SessionStore,
    private settingsManager: SettingsManager,
    private createProvider?: ProviderFactory,
    private tools: Tool[] = [],
    private approvalTracker?: ApprovalTracker,
    private systemPrompt?: string,
  ) {
    this.registry = new ChannelRegistry();
    this.router = new ChannelRouter(
      this.registry,
      // sendMessage: routed back via TelegramGateway
      async () => {},
      this.settingsManager,
      // sendApproval: routed via TelegramGateway
      async () => {},
    );

    // Ensure main CLI channel exists
    this.registry.getOrCreate('cli', 'main', 'main', 'Main');
  }

  /**
   * Send a message on a channel. Creates or reuses the channel's TurnLoop.
   * Bridges turn loop events to the shared daemon EventBus.
   */
  async send(channelId: string, text: string, cwd?: string, type?: string): Promise<{
    status: string;
    sessionId: string;
    events: number;
  }> {
    console.log(`[channelManager] send channelId=${channelId} text="${text.slice(0, 50)}"`);
    if (!this.createProvider) {
      console.log(`[channelManager] error: no provider configured`);
      return { status: 'error: no provider configured', sessionId: '', events: 0 };
    }

    const settings = this.settingsManager.get();
    const provider = this.createProvider(settings);
    const channelCwd = cwd || join(homedir(), '.curie-agent');

    // Get or create TurnLoop for this channel
    let loop = this.turnLoops.get(channelId);
    let sessionId = loop ? (loop as any).sessionId : undefined;
    if (!loop) {
      const entry = this.registry.get(channelId);
      sessionId = entry?.sessionId || channelId;

      // Build approval callback
      let onApprovalAsk: ((req: { toolCallId?: string; name: string; input: Record<string, unknown>; reason: string }) => Promise<boolean>) | undefined;
      if (this.approvalTracker) {
        onApprovalAsk = async (req: { toolCallId?: string; name: string; input: Record<string, unknown>; reason: string }) => {
          const toolCallId = req.toolCallId || crypto.randomUUID();
          return this.approvalTracker!.register({
            toolCallId,
            name: req.name,
            input: req.input,
            sessionId,
            channelId,
          });
        };
      }

     loop = new TurnLoop({
        provider,
        model: settings.model_override || settings.model,
        tools: this.tools,
        cwd: channelCwd,
        settings,
        approvalMode: settings.mode || 'auto',
        effort: settings.effort,
        sessionId,
        resume: !!sessionId,
        onApprovalAsk,
        system: this.systemPrompt,
        type: type || 'webui',
      }, this.sessionStore);

      this.turnLoops.set(channelId, loop);
    }

    // Bridge events to shared event bus
    const eventTypes: Event['type'][] = [
      'user-prompt', 'assistant-delta', 'assistant-stop', 'tool-call',
      'tool-result', 'approval-request', 'approval-decision', 'usage',
      'error', 'session-start', 'session-stop', 'hook', 'status',
      'session-resumed', 'context-warning', 'thinking-delta',
    ];
    const unsubscribes: Array<() => void> = [];
    for (const type of eventTypes) {
      unsubscribes.push(loop.eventBus.subscribe(type, (event: Event) => {
        this.eventBus.emit(event);
      }));
    }

    try {
      const result = await loop.run(text);
      const sessionId = result.sessionId;

      // Update channel session ID
      this.registry.updateSession(channelId, sessionId);

      // Emit channel-updated event
      this.eventBus.emit({
        type: 'channel-updated',
        id: crypto.randomUUID(),
        channelId,
        channelType: this.registry.get(channelId)?.type || 'cli',
        displayName: this.registry.get(channelId)?.displayName || channelId,
        sessionId,
        timestamp: Date.now(),
      } as unknown as Event);

      return { status: 'completed', sessionId, events: result.events.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[channelManager] TurnLoop error for channelId=${channelId}:`, msg);
      return {
        status: 'error',
        sessionId: '',
        events: 0,
      };
    } finally {
      // Clean up event subscriptions, keep the loop alive for follow-ups
      for (const unsub of unsubscribes) unsub();
    }
  }

  /** Cancel a running turn for a channel. */
  cancel(channelId: string): void {
    const loop = this.turnLoops.get(channelId);
    if (loop) {
      (loop as any).abort = true;
      (loop as any).abortController?.abort();
      this.turnLoops.delete(channelId);
    }
  }

  /** Get or create the main CLI channel. */
  getOrCreateMain(): ChannelEntry {
    return this.registry.getOrCreate('cli', 'main', 'main', 'Main');
  }

  /** Handle incoming Telegram message — resolve channel. */
  routeTelegramMessage(params: {
    chatId: string;
    userId: string;
    isGroup: boolean;
    chatTitle?: string;
  }): { channelId: string; sessionId: string } | null {
    const settings = this.settingsManager.get();
    const allowGroups = settings.channels?.allow_groups ?? false;

    if (params.isGroup && !allowGroups) return null;

    let entry = this.registry.findTelegramChannel(params.chatId);
    if (!entry) {
      const sessionId = `telegram_${params.chatId}_${Date.now()}`;
      const displayName = params.chatTitle || `User ${params.userId}`;
      entry = this.registry.getOrCreate('telegram', params.chatId, sessionId, displayName);

      this.eventBus.emit({
        type: 'channel-updated',
        id: crypto.randomUUID(),
        channelId: entry.id,
        channelType: 'telegram',
        displayName,
        sessionId,
        timestamp: Date.now(),
      } as unknown as Event);
    }

    return { channelId: entry.id, sessionId: entry.sessionId };
  }

  /** Get the Telegram chat ID for a channel. */
  getTelegramChatId(channelId: string): string | undefined {
    return this.registry.getTelegramChatId(channelId);
  }

  /** List all channels. */
  listChannels(): ChannelEntry[] {
    return this.registry.list();
  }

  /** Get a channel by ID. */
  getChannel(channelId: string): ChannelEntry | undefined {
    return this.registry.get(channelId);
  }

  /** Clean up all turn loops (on shutdown). */
  cleanup() {
    for (const [channelId, loop] of this.turnLoops) {
      (loop as any).abort = true;
      (loop as any).abortController?.abort();
    }
    this.turnLoops.clear();
  }
}
