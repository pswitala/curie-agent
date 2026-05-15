import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChannelRegistry } from './channel-registry.js';
import { ChannelRouter } from './channel-router.js';
import type { CurieSettings } from './settings.js';

describe('ChannelRouter', () => {
  let registry: ChannelRegistry;
  let settings: CurieSettings;
  let router: ChannelRouter;
  let sentMessages: Array<{ chatId: string; text: string }>;

  beforeEach(() => {
    // Clean up channels file before each test
    const fs = require('node:fs');
    const path = require('node:path');
    const channelsFile = path.join(require('node:os').homedir(), '.curie-agent', 'channels.json');
    if (fs.existsSync(channelsFile)) {
      fs.unlinkSync(channelsFile);
    }

    registry = new ChannelRegistry();
    settings = {
      model: 'claude-sonnet-4-6',
      effort: 'auto',
      mode: 'auto',
      theme: 'tokyo-night',
      statusline: true,
      debug: false,
      channels: { bot_token: '', user_id: '', chat_id: '', allow_groups: false, tab_active: 'main' },
    };
    sentMessages = [];
    router = new ChannelRouter(
      registry,
      async (chatId, text) => {
        sentMessages.push({ chatId, text });
      },
      {
        get: () => settings,
        update: () => settings,
        load: () => settings,
        save: () => {},
      },
    );
  });

  it('should route a DM message to a new telegram channel', () => {
    const result = router.onTelegramMessage({
      text: 'Hello',
      chatId: '12345',
      userId: '67890',
      isGroup: false,
    });

    expect(result).toBeDefined();
    expect(result?.channelId).toBe('telegram:12345');
    expect(result?.sessionId).toMatch(/^sess_/);

    const channel = registry.get('telegram:12345');
    expect(channel).toBeDefined();
    expect(channel?.type).toBe('telegram');
    expect(channel?.identifier).toBe('12345');
  });

  it('should reuse an existing telegram channel for the same chat', () => {
    const first = router.onTelegramMessage({
      text: 'Hello',
      chatId: '12345',
      userId: '67890',
      isGroup: false,
    });
    const second = router.onTelegramMessage({
      text: 'Again',
      chatId: '12345',
      userId: '67890',
      isGroup: false,
    });

    expect(first?.sessionId).toBe(second?.sessionId);
  });

  it('should reject group messages when TELEGRAM_ALLOW_GROUPS is false', () => {
    const result = router.onTelegramMessage({
      text: 'Hello group',
      chatId: '99999',
      userId: '67890',
      isGroup: true,
      chatTitle: 'Test Group',
    });

    expect(result).toBeNull();
    // No channel should be created
    const found = registry.findTelegramChannel('99999');
    expect(found).toBeUndefined();
  });

  it('should accept group messages when channels.allow_groups is true', () => {
    settings.channels.allow_groups = true;
    const result = router.onTelegramMessage({
      text: 'Hello group',
      chatId: '99999',
      userId: '67890',
      isGroup: true,
      chatTitle: 'Test Group',
    });

    expect(result).toBeDefined();
    expect(result?.channelId).toBe('telegram:99999');
  });

  it('should send telegram responses to the correct chat', async () => {
    await router.sendTelegramResponse('12345', 'Hello back!');
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].chatId).toBe('12345');
    expect(sentMessages[0].text).toBe('Hello back!');
  });

  it('should get telegram chat ID for a channel', () => {
    registry.getOrCreate('telegram', '12345', 'session-1');
    const chatId = router.getTelegramChatId('telegram:12345');
    expect(chatId).toBe('12345');
  });

  it('should return undefined for non-telegram channel', () => {
    registry.getOrCreate('cli', 'main', 'session-1');
    const chatId = router.getTelegramChatId('main');
    expect(chatId).toBeUndefined();
  });

  it('should use chat title for group display name', () => {
    settings.channels.allow_groups = true;
    const result = router.onTelegramMessage({
      text: 'Hello',
      chatId: '99999',
      userId: '67890',
      isGroup: true,
      chatTitle: 'My Cool Group',
    });

    const channel = registry.get('telegram:99999');
    expect(channel?.displayName).toBe('My Cool Group');
  });

  it('should send telegram approval requests when wired', async () => {
    const approvalMessages: Array<{ chatId: string; toolName: string; toolCallId: string }> = [];
    const approvalRouter = new ChannelRouter(
      registry,
      async (chatId, text) => {
        sentMessages.push({ chatId, text });
      },
      {
        get: () => settings,
        update: () => settings,
        load: () => settings,
        save: () => {},
      },
      async (chatId, toolName, _input, toolCallId) => {
        approvalMessages.push({ chatId, toolName, toolCallId });
      },
    );

    await approvalRouter.sendTelegramApproval('12345', 'Bash', { command: 'ls -la' }, 'tc_abc123');
    expect(approvalMessages).toHaveLength(1);
    expect(approvalMessages[0].chatId).toBe('12345');
    expect(approvalMessages[0].toolName).toBe('Bash');
    expect(approvalMessages[0].toolCallId).toBe('tc_abc123');
  });

  it('should warn when no approval function is wired', async () => {
    const consoleSpy = vi.spyOn(console, 'warn');
    const noApprovalRouter = new ChannelRouter(
      registry,
      async (chatId, text) => {
        sentMessages.push({ chatId, text });
      },
      {
        get: () => settings,
        update: () => settings,
        load: () => settings,
        save: () => {},
      },
    );

    await noApprovalRouter.sendTelegramApproval('12345', 'Bash', { command: 'ls' }, 'tc_xyz');
    expect(consoleSpy).toHaveBeenCalledWith(
      '[channel-router] sendTelegramApproval called but no approval function wired',
    );
    consoleSpy.mockRestore();
  });
});
