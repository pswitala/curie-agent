import type { ChannelRegistry } from './channel-registry.js';
import type { SettingsManager } from './settings.js';

export interface TelegramMessage {
  text: string;
  chatId: string;
  userId: string;
  isGroup: boolean;
  chatTitle?: string;
}

export interface RouteResult {
  channelId: string;
  sessionId: string;
}

export type SendMessageFn = (chatId: string, text: string) => Promise<void>;
export type SendApprovalFn = (
  chatId: string,
  toolName: string,
  input: Record<string, unknown>,
  toolCallId: string,
) => Promise<void>;

export class ChannelRouter {
  private sendApproval?: SendApprovalFn;

  constructor(
    private registry: ChannelRegistry,
    private sendMessage: SendMessageFn,
    private settingsManager: SettingsManager,
    sendApproval?: SendApprovalFn,
  ) {
    this.sendApproval = sendApproval;
  }

  onTelegramMessage(msg: TelegramMessage): RouteResult | null {
    const settings = this.settingsManager.get();

    if (msg.isGroup && !settings.TELEGRAM_ALLOW_GROUPS) {
      return null;
    }

    const existing = this.registry.findTelegramChannel(msg.chatId);
    if (existing) {
      return { channelId: existing.id, sessionId: existing.sessionId };
    }

    const sessionId = this.generateSessionId();
    const displayName = msg.isGroup
      ? (msg.chatTitle || `Group ${msg.chatId}`)
      : `User ${msg.userId}`;

    const channel = this.registry.getOrCreate('telegram', msg.chatId, sessionId, displayName);
    return { channelId: channel.id, sessionId: channel.sessionId };
  }

  async sendTelegramResponse(chatId: string, text: string): Promise<void> {
    await this.sendMessage(chatId, text);
  }

  async sendTelegramApproval(
    chatId: string,
    toolName: string,
    input: Record<string, unknown>,
    toolCallId: string,
  ): Promise<void> {
    if (!this.sendApproval) {
      console.warn('[channel-router] sendTelegramApproval called but no approval function wired');
      return;
    }
    try {
      await this.sendApproval(chatId, toolName, input, toolCallId);
    } catch (err) {
      console.error('[channel-router] sendTelegramApproval failed:', err);
    }
  }

  getTelegramChatId(channelId: string): string | undefined {
    return this.registry.getTelegramChatId(channelId);
  }

  private generateSessionId(): string {
    const now = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `sess_${now}_${random}`;
  }
}
