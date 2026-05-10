import { Bot, Context } from 'grammy';

export interface TelegramMessageContext {
  text: string;
  chatId: string;
  userId: string;
  isGroup: boolean;
  chatTitle?: string;
}

export interface TelegramGatewayConfig {
  botToken: string;
  allowedUserId: string;
  onUserMessage: (ctx: TelegramMessageContext) => void;
  /** Called when user taps Approve/Deny on an approval inline keyboard. */
  onApprovalDecision?: (toolCallId: string, approved: boolean) => void;
  onError?: (error: Error) => void;
}

export class TelegramGateway {
  private bot: Bot<Context>;
  private isRunning = false;
  private config: TelegramGatewayConfig;
  private typingTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: TelegramGatewayConfig) {
    this.config = config;
    this.bot = new Bot(config.botToken);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Only process text messages
    this.bot.on('message:text', async (ctx) => {
      const msg = ctx.message.text;
      const userId = String(ctx.from?.id ?? '');
      const chatId = String(ctx.chat.id);
      const chatType = ctx.chat.type;
      const chatTitle = ctx.chat.title;

      // User ID filtering — gatekeeper logic
      if (userId !== this.config.allowedUserId) {
        return;
      }

      this.config.onUserMessage({
        text: msg,
        chatId,
        userId,
        isGroup: chatType === 'group' || chatType === 'supergroup',
        chatTitle,
      });
      // Show typing indicator — Telegram's indicator expires after ~5s,
      // so we keep resending every 4s until stopTyping is called.
      this.startTyping(chatId);
    });

    // Handle inline keyboard button taps for approval decisions
    this.bot.on('callback_query', async (ctx) => {
      const data = ctx.callbackQuery.data;
      if (!data) {
        await ctx.answerCallbackQuery();
        return;
      }
      const pipeIndex = data.indexOf('|');
      if (pipeIndex === -1) {
        await ctx.answerCallbackQuery();
        return;
      }
      const action = data.slice(0, pipeIndex);
      const toolCallId = data.slice(pipeIndex + 1);
      const approved = action === 'approve';
      this.config.onApprovalDecision?.(toolCallId, approved);
      await ctx.answerCallbackQuery(); // dismiss the loading spinner
    });

    // Catch-all error handler
    this.bot.catch((err) => {
      console.error('[telegram-gateway] Error:', err.error);
      this.config.onError?.(err.error as Error);
    });
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    try {
      await this.bot.api.sendMessage(chatId, text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[telegram-gateway] sendMessage failed for chat ${chatId}: ${msg}`);
      throw err;
    }
  }

  /**
   * Send an inline keyboard approval request to a Telegram chat.
   */
  async sendApprovalRequest(
    chatId: string,
    toolCallId: string,
    toolName: string,
    inputSummary: string,
  ): Promise<void> {
    // Strip non-printable chars and escape HTML to avoid Telegram parse failures
    const safe = (s: string) => s.replace(/[^\x20-\x7E]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const cleanSummary = safe(inputSummary).replace(/[\r\n]/g, ' ').slice(0, 200);
    const text = '[Tool approval needed]\n\n<b>' + safe(toolName) + '</b>\n' + cleanSummary;

    try {
      await this.bot.api.sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'Allow', callback_data: 'approve|' + toolCallId },
              { text: 'Deny', callback_data: 'deny|' + toolCallId },
            ],
          ],
        },
        parse_mode: 'HTML',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[telegram-gateway] sendApprovalRequest failed for chat ' + chatId + ': ' + msg);
      throw err;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    await this.bot.start();
    console.log('[telegram-gateway] Bot started (polling)');
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    // Clear all typing timers
    for (const timer of this.typingTimers.values()) {
      clearInterval(timer);
    }
    this.typingTimers.clear();
    await this.bot.stop();
    console.log('[telegram-gateway] Bot stopped');
  }

  setOnApprovalDecision(fn: (toolCallId: string, approved: boolean) => void): void {
    this.config.onApprovalDecision = fn;
  }

  get isAlive(): boolean {
    return this.isRunning;
  }

  startTyping(chatId: string): void {
    // If already typing, don't start another timer
    if (this.typingTimers.has(chatId)) return;

    console.error(`[telegram-gateway] startTyping for ${chatId}, isRunning=${this.isRunning}`);

    const send = () => {
      if (this.isRunning) {
        this.bot.api.sendChatAction(chatId, 'typing').catch((err) => {
          console.error(`[telegram-gateway] sendChatAction failed for ${chatId}:`, err?.message || err);
        });
      }
    };

    send(); // Send immediately
    const interval = setInterval(send, 4000);
    this.typingTimers.set(chatId, interval);
  }

  stopTyping(chatId: string): void {
    const timer = this.typingTimers.get(chatId);
    if (timer) {
      clearInterval(timer);
      this.typingTimers.delete(chatId);
    }
  }
}
