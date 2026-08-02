import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendMessageTool } from './send-message';
import { DEFAULT_SETTINGS } from '@curie-agent/core';
import type { CurieSettings } from '@curie-agent/core';

const TOKEN = '123456:AAtest-bot-token';

function settingsWith(channels: Partial<CurieSettings['channels']>): CurieSettings {
  return {
    ...DEFAULT_SETTINGS,
    channels: { ...DEFAULT_SETTINGS.channels, ...channels },
  };
}

function mockOk() {
  return vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"ok":true}' });
}

/** Parse the JSON body of the Nth fetch call. */
function bodyOf(mock: ReturnType<typeof vi.fn>, n = 0): { chat_id: string; text: string } {
  const init = mock.mock.calls[n]?.[1] as { body: string };
  return JSON.parse(init.body) as { chat_id: string; text: string };
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

describe('sendMessageTool', () => {
  it('has the expected definition and anti-flailing description', () => {
    expect(sendMessageTool.definition.name).toBe('SendMessage');
    const desc = sendMessageTool.definition.description;
    expect(desc).toContain('Telegram');
    // Guards the clause that stops the agent from reaching for the shell.
    expect(desc).toMatch(/Do NOT attempt to send messages with Bash, curl/);
  });

  it('returns a soft error and does not call fetch when unconfigured', async () => {
    const mockFetch = mockOk();
    global.fetch = mockFetch as never;

    const result = await sendMessageTool.execute({ text: 'hi' }, DEFAULT_SETTINGS);

    expect(result.output).toBeNull();
    expect(result.error).toMatch(/not configured/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('posts to the Telegram API using chat_id', async () => {
    const mockFetch = mockOk();
    global.fetch = mockFetch as never;

    const result = await sendMessageTool.execute(
      { text: 'research done' },
      settingsWith({ bot_token: TOKEN, chat_id: '4242' }),
    );

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ delivered: true, channel: 'telegram', chars: 13 });
    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      `https://api.telegram.org/bot${TOKEN}/sendMessage`,
    );
    expect(bodyOf(mockFetch)).toEqual({ chat_id: '4242', text: 'research done' });
  });

  it('falls back to user_id when chat_id is empty', async () => {
    const mockFetch = mockOk();
    global.fetch = mockFetch as never;

    await sendMessageTool.execute(
      { text: 'hi' },
      settingsWith({ bot_token: TOKEN, chat_id: '', user_id: '99' }),
    );

    expect(bodyOf(mockFetch).chat_id).toBe('99');
  });

  it('prefers chat_id over user_id when both are set', async () => {
    const mockFetch = mockOk();
    global.fetch = mockFetch as never;

    await sendMessageTool.execute(
      { text: 'hi' },
      settingsWith({ bot_token: TOKEN, chat_id: '4242', user_id: '99' }),
    );

    expect(bodyOf(mockFetch).chat_id).toBe('4242');
  });

  it('truncates messages over the 4096-char Telegram limit', async () => {
    const mockFetch = mockOk();
    global.fetch = mockFetch as never;

    const result = await sendMessageTool.execute(
      { text: 'x'.repeat(5000) },
      settingsWith({ bot_token: TOKEN, chat_id: '4242' }),
    );

    const sent = bodyOf(mockFetch).text;
    expect(sent).toHaveLength(4096);
    expect(sent.endsWith('…')).toBe(true);
    expect(result.output).toEqual({ delivered: true, channel: 'telegram', chars: 4096 });
  });

  it('returns a soft error (never throws) on a non-OK response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"description":"bot was blocked by the user"}',
    }) as never;

    const result = await sendMessageTool.execute(
      { text: 'hi' },
      settingsWith({ bot_token: TOKEN, chat_id: '4242' }),
    );

    expect(result.output).toBeNull();
    expect(result.error).toContain('403');
  });

  it('returns a soft error (never throws) on a network failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND api.telegram.org')) as never;

    const result = await sendMessageTool.execute(
      { text: 'hi' },
      settingsWith({ bot_token: TOKEN, chat_id: '4242' }),
    );

    expect(result.output).toBeNull();
    expect(result.error).toContain('ENOTFOUND');
  });

  it('never leaks the bot token in an error message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }) as never;

    const result = await sendMessageTool.execute(
      { text: 'hi' },
      settingsWith({ bot_token: TOKEN, chat_id: '4242' }),
    );

    expect(result.error).toBeDefined();
    expect(result.error).not.toContain(TOKEN);
  });

  it('accepts the "message" alias for "text"', async () => {
    const mockFetch = mockOk();
    global.fetch = mockFetch as never;

    const result = await sendMessageTool.execute(
      { message: 'via alias' },
      settingsWith({ bot_token: TOKEN, chat_id: '4242' }),
    );

    expect(result.error).toBeUndefined();
    expect(bodyOf(mockFetch).text).toBe('via alias');
  });

  it('returns a validation error naming "text" when the body is missing', async () => {
    const result = await sendMessageTool.execute(
      {},
      settingsWith({ bot_token: TOKEN, chat_id: '4242' }),
    );

    expect(result.output).toBeNull();
    expect(result.error).toContain('text');
  });
});
