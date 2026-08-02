import { z } from 'zod';
import type { CurieSettings } from '@curie-agent/core';
import { createTool, type ToolContext } from './tool.js';

/** Telegram's hard per-message limit. */
const TELEGRAM_MAX = 4096;

/** Trim a settings string, collapsing blank/absent values to undefined. */
function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === '' ? undefined : trimmed;
}

const SEND_MESSAGE_DESCRIPTION = `Sends a message to the user on their personal Telegram, delivered immediately to their phone. Use this whenever the user asks to be notified, messaged, pinged, texted, or told something "when done" / "when you finish" / "if X happens" — especially from a background, scheduled, or subagent session whose final answer the user will not be sitting there reading.

This is the ONLY supported way to reach the user outside the current session. Do NOT attempt to send messages with Bash, curl, the Telegram HTTP API, or by writing files — the bot token and chat routing are handled internally by this tool. Do not read config files looking for credentials.

Plain text only (no markdown rendering). Messages over 4096 characters are truncated, so send a short summary rather than a full report. Do not use this to reply inside the conversation you are already having — your normal response is delivered there.`;

const SendMessageSchema = z.object({
  text: z
    .string()
    .min(1)
    .describe('The message body to send. Plain text, no markdown. Keep it under 4096 characters.'),
});

export const sendMessageTool = createTool(
  'SendMessage',
  SEND_MESSAGE_DESCRIPTION,
  SendMessageSchema,
  async (input, ctx: ToolContext) => {
    // Typed as partial: callers (tests, older settings files) may hand us a
    // settings object with `channels` absent or half-populated.
    const ch = ctx.settings.channels as Partial<CurieSettings['channels']> | undefined;
    const token = nonEmpty(ch?.bot_token);
    // chat_id wins (it may point at a group); user_id is the correct fallback
    // for a 1:1 DM, where chat id == user id.
    const chatId = nonEmpty(ch?.chat_id) ?? nonEmpty(ch?.user_id);

    if (!token || !chatId) {
      return {
        output: null,
        error:
          'Telegram is not configured (channels.bot_token and channels.chat_id/user_id are ' +
          'empty in settings). Tell the user to configure Telegram in Channels settings. ' +
          'Do not try to send the message another way.',
      };
    }

    const text =
      input.text.length > TELEGRAM_MAX ? input.text.slice(0, TELEGRAM_MAX - 1) + '…' : input.text;

    try {
      // No parse_mode — matches TelegramGateway.sendMessage and avoids the
      // "unescaped _ breaks the send" class of failures.
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return {
          output: null,
          error: `Telegram API error ${String(res.status)}: ${body.slice(0, 300)}`,
        };
      }
    } catch (err) {
      // Never throw: a throw out of a tool kills the turn loop.
      return {
        output: null,
        error: `Telegram send failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    return { output: { delivered: true, channel: 'telegram', chars: text.length } };
  },
  undefined,
  { aliases: { message: 'text', body: 'text' } },
);
