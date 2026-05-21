import { homedir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { TelegramGateway } from './telegram-gateway.js';

const TELEGRAM_MAX_LENGTH = 4096;

export interface HeartbeatDeliveryConfig {
  /** Telegram chatId to send to. */
  chatId: string;
  /** TelegramGateway instance for sending messages. */
  telegramGateway: TelegramGateway;
  /** Path to write output file. Default: ~/.curie-agent/heartbeat-brief-{date}.md */
  filePath?: string;
}

/**
 * Routes HeartbeatExecutor output to Telegram.
 */
export class HeartbeatDelivery {
  constructor(
    private config: HeartbeatDeliveryConfig,
  ) {}

  async deliver(text: string): Promise<void> {
    // Truncate to Telegram's 4096 char limit
    const truncated = text.length > TELEGRAM_MAX_LENGTH
      ? text.slice(0, TELEGRAM_MAX_LENGTH - 3) + '...'
      : text;

    await this.config.telegramGateway.sendMessage(
      this.config.chatId,
      truncated,
    );
  }

  /**
   * Format a Heartbeat Brief into a markdown-ready string.
   */
  static formatBrief(result: {
    text: string;
    toolCalls: number;
    maxTurns?: number;
    reason: string;
    errors: string[];
    sessionId: string;
  }): string {
    let body = result.text.trim();
    if (!body || body.includes('HEARTBEAT_OK')) {
      body = 'All checks completed. No urgent notifications or priority actions require attention at this time.';
    }

    const lines = [
      `*Heartbeat Brief*`,
      '',
      body,
    ];

    // Surface completion reason when not a normal stop
    if (result.reason !== 'stop') {
      switch (result.reason) {
        case 'max-turns':
          lines.push('', `*Stopped: reached maximum turns (${result.maxTurns ?? 30}). Task may be incomplete.*`);
          break;
        case 'error':
          lines.push('', '*Stopped: provider error. See warnings below for details.*');
          break;
        case 'cancelled':
          lines.push('', '*Stopped: heartbeat was cancelled mid-execution.*');
          break;
      }
    }

    lines.push(
      '',
      `_Tool calls: ${result.toolCalls} | Session: ${result.sessionId.slice(0, 8)}_`,
    );

    if (result.errors.length > 0) {
      lines.push('', '*Warnings:*');
      for (const err of result.errors) {
        lines.push(`- ${err}`);
      }
    }

    return lines.join('\n');
  }
}
