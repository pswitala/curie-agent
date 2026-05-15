import { describe, it, expect } from 'vitest';
import { parseSlashCommand, handleSlashCommand, SLASH_COMMANDS } from './slash-commands.js';
import type { SlashCommandContext } from './slash-commands.js';

describe('parseSlashCommand', () => {
  it('returns null for non-slash input', async () => {
    expect(parseSlashCommand('hello')).toBeNull();
    expect(parseSlashCommand('   hello')).toBeNull();
  });

  it('parses command without args', async () => {
    const result = parseSlashCommand('/help');
    expect(result).toEqual({ command: 'help', args: '' });
  });

  it('parses command with args', async () => {
    const result = parseSlashCommand('/model claude-opus-4-7');
    expect(result).toEqual({ command: 'model', args: 'claude-opus-4-7' });
  });

  it('parses command with multiple word args', async () => {
    const result = parseSlashCommand('/theme tokyo-night');
    expect(result).toEqual({ command: 'theme', args: 'tokyo-night' });
  });

  it('lowercases command name', async () => {
    const result = parseSlashCommand('/MODEL Opus');
    expect(result).toEqual({ command: 'model', args: 'Opus' });
  });

  it('handles extra whitespace', async () => {
    const result = parseSlashCommand('  /help  ');
    expect(result).toEqual({ command: 'help', args: '' });
  });
});

const mockContext: SlashCommandContext = {
  settings: {
    model: 'claude-sonnet-4-6',
    effort: 'auto',
    mode: 'auto',
    theme: 'tokyo-night',
    statusline: true,
    debug: false,
    current_provider: 'anthropic',
    providers: {
      anthropic: { model: 'claude-sonnet-4-6', model_cost: '', model_context_window: 200000 },
    },
    heartbeat: { schedule: 'off', intraday: '', daily: '6:00', weekly: 'monday@6:00', monthly: '1@6:00', dreaming: '2:00' },
    channels: { bot_token: '', user_id: '', chat_id: '', allow_groups: false, tab_active: 'main' },
    safety: { path_guard: 'on', path_allowlist: '', command_guard: 'on', snapshots: 'on' },
    tools_per_call: 10,
    websearch_per_call: 5,
  },
  version: '0.1.0',
  model: 'claude-sonnet-4-6',
  provider: 'anthropic',
  approvalMode: 'auto',
  cwd: '/test',
};

describe('handleSlashCommand', () => {
  it('returns help message with all commands', async () => {
    const result = await handleSlashCommand('help', '', mockContext);
    expect(result.type).toBe('message');
    expect(result.message).toContain('General');
    expect(result.message).toContain('/model');
    expect(result.message).toContain('/theme');
  });

  it('returns status info', async () => {
    const result = await handleSlashCommand('status', '', mockContext);
    expect(result.type).toBe('message');
    expect(result.message).toContain('curie-agent v0.1.0');
    expect(result.message).toContain('Model: claude-sonnet-4-6');
  });

  it('handles /model with full name', async () => {
    const result = await handleSlashCommand('model', 'claude-opus-4-7', mockContext);
    expect(result.type).toBe('update_model');
    expect(result.model).toBe('claude-opus-4-7');
  });

  it('handles /model with alias', async () => {
    const result = await handleSlashCommand('model', 'opus', mockContext);
    expect(result.type).toBe('update_model');
    expect(result.model).toBe('claude-opus-4-7');
  });

  it('handles /model with no args', async () => {
    const result = await handleSlashCommand('model', '', mockContext);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Usage:');
  });

  it('handles /theme with valid theme', async () => {
    const result = await handleSlashCommand('theme', 'dracula', mockContext);
    expect(result.type).toBe('update_theme');
    expect(result.theme).toBe('dracula');
  });

  it('handles /theme with invalid theme', async () => {
    const result = await handleSlashCommand('theme', 'nonexistent', mockContext);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Unknown theme');
  });

  it('handles /effort with valid level', async () => {
    const result = await handleSlashCommand('effort', 'high', mockContext);
    expect(result.type).toBe('update_effort');
    expect(result.effort).toBe('high');
  });

  it('handles /effort with invalid level', async () => {
    const result = await handleSlashCommand('effort', 'extreme', mockContext);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Invalid effort level');
  });

  it('handles /mode with valid mode', async () => {
    const result = await handleSlashCommand('mode', 'yolo', mockContext);
    expect(result.type).toBe('update_mode');
    expect(result.mode).toBe('yolo');
  });

  it('handles /mode with invalid mode', async () => {
    const result = await handleSlashCommand('mode', 'unknown', mockContext);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Invalid mode');
  });

  it('handles /agents with prompt', async () => {
    const result = await handleSlashCommand('agent', 'check codebase', mockContext);
    expect(result.type).toBe('start_agent');
    expect(result.agentId).toBeTruthy();
    expect(result.message).toContain('Agent started: "check codebase"');
  });

  it('handles /agents with no args', async () => {
    const result = await handleSlashCommand('agent', '', mockContext);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Usage');
  });

  it('handles /agent with --mode flag', async () => {
    const result = await handleSlashCommand('agent', '--mode auto check codebase', mockContext);
    expect(result.type).toBe('start_agent');
    expect(result.agentMode).toBe('auto');
    expect(result.message).toContain('check codebase');
  });

  it('handles /agent with --effort flag', async () => {
    const result = await handleSlashCommand('agent', '--effort medium review the code', mockContext);
    expect(result.type).toBe('start_agent');
    expect(result.agentEffort).toBe('medium');
    expect(result.message).toContain('review the code');
  });

  it('handles /agent with both --mode and --effort flags', async () => {
    const result = await handleSlashCommand('agent', '--mode auto --effort medium check codebase', mockContext);
    expect(result.type).toBe('start_agent');
    expect(result.agentMode).toBe('auto');
    expect(result.agentEffort).toBe('medium');
    expect(result.message).toContain('check codebase');
  });

  it('handles /agent with --effort before --mode', async () => {
    const result = await handleSlashCommand('agent', '--effort high --mode yolo fix everything', mockContext);
    expect(result.type).toBe('start_agent');
    expect(result.agentEffort).toBe('high');
    expect(result.agentMode).toBe('yolo');
    expect(result.message).toContain('fix everything');
  });

  it('ignores invalid --mode value and stops parsing', async () => {
    const result = await handleSlashCommand('agent', '--mode invalid check this', mockContext);
    // Invalid mode → stops parsing, rest becomes prompt
    expect(result.type).toBe('start_agent');
    expect(result.agentMode).toBeUndefined();
  });

  it('ignores invalid --effort value and stops parsing', async () => {
    const result = await handleSlashCommand('agent', '--effort extreme go do stuff', mockContext);
    expect(result.type).toBe('start_agent');
    expect(result.agentEffort).toBeUndefined();
  });

  it('handles /agent with no flags (plain prompt)', async () => {
    const result = await handleSlashCommand('agent', 'just do it', mockContext);
    expect(result.type).toBe('start_agent');
    expect(result.agentMode).toBeUndefined();
    expect(result.agentEffort).toBeUndefined();
    expect(result.message).toContain('just do it');
  });

  it('toggles /debug', async () => {
    const result = await handleSlashCommand('debug', '', mockContext);
    expect(result.type).toBe('update_debug');
    expect(result.debug).toBe(true);
  });

  it('sets /debug on', async () => {
    const ctx = { ...mockContext, settings: { ...mockContext.settings, debug: false } };
    const result = await handleSlashCommand('debug', 'on', ctx);
    expect(result.debug).toBe(true);
  });

  it('sets /debug off', async () => {
    const ctx = { ...mockContext, settings: { ...mockContext.settings, debug: true } };
    const result = await handleSlashCommand('debug', 'off', ctx);
    expect(result.debug).toBe(false);
  });

  it('toggles /statusline', async () => {
    const result = await handleSlashCommand('statusline', '', mockContext);
    expect(result.type).toBe('update_statusline');
    expect(result.statusline).toBe(false);
  });

  it('handles unknown command', async () => {
    const result = await handleSlashCommand('foo', '', mockContext);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Unknown command');
  });

  it('returns help for bare /memory', async () => {
    const result = await handleSlashCommand('memory', '', mockContext);
    expect(result.type).toBe('message');
    expect(result.message).toContain('/memory status');
  });

  it('returns status operation for /memory status', async () => {
    const result = await handleSlashCommand('memory', 'status', mockContext);
    expect(result.type).toBe('update_memory');
    expect(result.memory!.operation).toBe('status');
  });

  it('appends entry for /memory add', async () => {
    const result = await handleSlashCommand('memory', 'add user prefers TypeScript', mockContext);
    expect(result.type).toBe('update_memory');
    expect(result.memory!.operation).toBe('add');
    expect(result.memory!.content).toContain('user prefers TypeScript');
    expect(result.memory!.content).toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('returns usage for /memory add with no text', async () => {
    const result = await handleSlashCommand('memory', 'add', mockContext);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Usage');
  });

  it('returns switch_tab for /stats', async () => {
    const result = await handleSlashCommand('stats', '', mockContext);
    expect(result.type).toBe('switch_tab');
    expect(result.tab).toBe('stats');
  });

  it('returns message for /context with tokens', async () => {
    const result = await handleSlashCommand('context', '', {
      ...mockContext,
      model: 'claude-sonnet-4-6',
      inputTokens: 108000,
      outputTokens: 38000,
    });
    expect(result.type).toBe('message');
    expect(result.message).toContain('claude-sonnet-4-6');
    expect(result.message).toContain('54%');
    expect(result.message).toContain('108k/200k');
    expect(result.message).toContain('108k in / 38k out');
    expect(result.message).toContain('█');
    expect(result.message).toContain('░');
  });

  it('returns message for /context with no tokens', async () => {
    const result = await handleSlashCommand('context', '', mockContext);
    expect(result.type).toBe('message');
    expect(result.message).toContain('No token data yet');
  });

  it('returns message for /context with output but no input', async () => {
    const result = await handleSlashCommand('context', '', {
      ...mockContext,
      inputTokens: 0,
      outputTokens: 5000,
    });
    expect(result.type).toBe('message');
    expect(result.message).toContain('0%');
    expect(result.message).not.toContain(' in /');
  });

  it('shows 100% when input equals context window size', async () => {
    const result = await handleSlashCommand('context', '', {
      ...mockContext,
      inputTokens: 200_000,
      outputTokens: 1000,
    });
    expect(result.type).toBe('message');
    expect(result.message).toContain('100%');
    expect(result.message).toContain('200k/200k');
  });

  it('/context messages with no messages returns empty', async () => {
    const result = await handleSlashCommand('context', 'messages', mockContext);
    expect(result.type).toBe('message');
    expect(result.message).toContain('No messages yet');
  });

  it('/context messages prefers TurnLoop messages over channelMessages', async () => {
    const result = await handleSlashCommand('context', 'messages', {
      ...mockContext,
      messages: [
        { role: 'user', content: 'TurnLoop msg' },
      ],
      channelMessages: [
        { role: 'assistant', content: '█  █ ███ ████' },
        { role: 'user', content: 'Channel msg' },
      ],
    });
    expect(result.type).toBe('message');
    // Should show TurnLoop data, not channelMessages
    expect(result.message).toContain('TurnLoop msg');
    expect(result.message).not.toContain('Channel msg');
  });

  it('/context messages uses channelMessages as fallback when no TurnLoop messages', async () => {
    const result = await handleSlashCommand('context', 'messages', {
      ...mockContext,
      channelMessages: [
        { role: 'assistant', content: '█  █ ███ ████' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ],
    });
    expect(result.type).toBe('message');
    expect(result.message).toContain('Conversation Messages (2)');
    expect(result.message).toContain('User: Hello');
    expect(result.message).toContain('Assistant: Hi there!');
  });

  it('/context messages filters cold-start banner from channelMessages', async () => {
    const result = await handleSlashCommand('context', 'messages', {
      ...mockContext,
      channelMessages: [
        { role: 'assistant', content: '█  █ ███ ████' },
        { role: 'user', content: 'test' },
      ],
    });
    expect(result.type).toBe('message');
    expect(result.message).toContain('Conversation Messages (1)');
    expect(result.message).not.toContain('█');
  });

  it('/context messages uses TurnLoop messages as primary source', async () => {
    const result = await handleSlashCommand('context', 'messages', {
      ...mockContext,
      messages: [
        { role: 'user', content: 'Hello, can you help me?' },
      ],
    });
    expect(result.type).toBe('message');
    expect(result.message).toContain('Conversation Messages (1)');
    expect(result.message).toContain('User: Hello, can you help me?');
  });

  it('/context messages shows assistant text and tool calls (TurnLoop)', async () => {
    const result = await handleSlashCommand('context', 'messages', {
      ...mockContext,
      messages: [
        { role: 'user', content: 'Read my file' },
        {
          role: 'assistant',
          content: [
            { type: 'text' as const, text: 'I will read the file for you.' },
            { type: 'tool-use' as const, id: 'tu_1', name: 'Read', input: { path: 'src/main.py' } },
          ],
        },
        { role: 'tool', toolUseId: 'tu_1', content: 'file contents here' },
      ],
    });
    expect(result.type).toBe('message');
    expect(result.message).toContain('Conversation Messages (3)');
    expect(result.message).toContain('User: Read my file');
    expect(result.message).toContain('I will read the file for you.');
    expect(result.message).toContain('→ Read(');
    expect(result.message).toContain('src/main.py');
    expect(result.message).toContain('Tool Result');
  });

  it('/context messages shows thinking blocks (TurnLoop)', async () => {
    const result = await handleSlashCommand('context', 'messages', {
      ...mockContext,
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'thinking' as const, thinking: 'Let me think about this problem carefully...', signature: 'sig1' },
            { type: 'text' as const, text: 'Here is my answer.' },
          ],
        },
      ],
    });
    expect(result.type).toBe('message');
    expect(result.message).toContain('[thinking');
    expect(result.message).toContain('chars]');
    expect(result.message).toContain('Here is my answer.');
  });

  it('/context messages with channelMessages (fallback) shows all role types', async () => {
    const result = await handleSlashCommand('context', 'messages', {
      ...mockContext,
      channelMessages: [
        { role: 'user', content: 'Run the tests' },
        { role: 'assistant', content: 'Running tests now...' },
        { role: 'tool', content: '✓ 42 tests passed' },
        { role: 'system', content: 'Reminder: backup complete' },
      ],
    });
    expect(result.type).toBe('message');
    expect(result.message).toContain('Conversation Messages (4)');
    expect(result.message).toContain('User: Run the tests');
    expect(result.message).toContain('Assistant: Running tests now...');
    expect(result.message).toContain('Tool: ✓ 42 tests passed');
    expect(result.message).toContain('System: Reminder: backup complete');
  });
});

describe('SLASH_COMMANDS', () => {
  it('lists all commands', async () => {
    const names = SLASH_COMMANDS.map(c => c.name);
    expect(names).toContain('status');
    expect(names).toContain('help');
    expect(names).toContain('model');
    expect(names).toContain('effort');
    expect(names).toContain('mode');
    expect(names).toContain('theme');
    expect(names).toContain('debug');
    expect(names).toContain('statusline');
    expect(names).toContain('memory');
    expect(names).toContain('stats');
    expect(names).toContain('context');
    expect(names).toContain('agent');
    expect(names).toContain('heartbeat');
  });

  it('each command has a description and usage', async () => {
    for (const cmd of SLASH_COMMANDS) {
      expect(cmd.name).toBeTruthy();
      expect(cmd.description).toBeTruthy();
      expect(cmd.usage).toBeTruthy();
    }
  });
});

describe('/channels', () => {
  const baseCtx = {
    version: '0.1.0',
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    approvalMode: 'auto',
    cwd: '/tmp',
    settings: {
      model: 'claude-sonnet-4-6',
      effort: 'auto',
      mode: 'auto',
      theme: 'tokyo-night',
      statusline: true,
      debug: false,
    },
  } as unknown as SlashCommandContext;

  it('list with no config shows not set', async () => {
    const result = await handleSlashCommand('channels', 'list', baseCtx);
    expect(result.type).toBe('message');
    expect(result.message).toContain('(not set)');
  });

  it('list with config shows masked token', async () => {
    const ctx = {
      ...baseCtx,
      settings: {
        ...baseCtx.settings,
        channels: { ...baseCtx.settings.channels, bot_token: '123456:ABC-DEF', user_id: '42' },
      },
    } as unknown as SlashCommandContext;
    const result = await handleSlashCommand('channels', 'list', ctx);
    expect(result.type).toBe('message');
    expect(result.message).toContain('123456:A...');
    expect(result.message).toContain('42');
  });

  it('set-bot-token with no arg returns usage', async () => {
    const result = await handleSlashCommand('channels', 'set-bot-token', baseCtx);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Usage');
  });

  it('set-bot-token returns external type', async () => {
    const result = await handleSlashCommand('channels', 'set-bot-token abc-123', baseCtx);
    expect(result.type).toBe('external');
    expect(result.external).toBe('channels.set-bot-token');
    expect(result.message).toBe('abc-123');
  });

  it('set-user-id with no arg returns usage', async () => {
    const result = await handleSlashCommand('channels', 'set-user-id', baseCtx);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Usage');
  });

  it('set-user-id returns external type', async () => {
    const result = await handleSlashCommand('channels', 'set-user-id 42', baseCtx);
    expect(result.type).toBe('external');
    expect(result.external).toBe('channels.set-user-id');
    expect(result.message).toBe('42');
  });

  it('disconnect returns external type', async () => {
    const result = await handleSlashCommand('channels', 'disconnect', baseCtx);
    expect(result.type).toBe('external');
    expect(result.external).toBe('channels.disconnect');
  });

  it('unknown subcommand returns error', async () => {
    const result = await handleSlashCommand('channels', 'foobar', baseCtx);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Unknown channel action');
  });
});

describe('/heartbeat', () => {
  const baseCtx: SlashCommandContext = {
    version: '0.1.0',
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    approvalMode: 'auto',
    cwd: '/tmp',
    settings: {
      model: 'claude-sonnet-4-6',
      effort: 'auto',
      mode: 'auto',
      theme: 'tokyo-night',
      statusline: true,
      debug: false,
      HEARTBEAT: 'off',
    },
  };

  it('shows status when no subcommand', async () => {
    const result = await handleSlashCommand('heartbeat', '', baseCtx);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Heartbeat cycle');
    expect(result.message).toContain(': no');
    expect(result.message).toContain('Intraday');
    expect(result.message).toContain('Daily');
  });

  it('enable returns notification type', async () => {
    const result = await handleSlashCommand('heartbeat', 'enable', baseCtx);
    expect(result.type).toBe('notification');
    expect(result.notification!.type).toBe('heartbeat');
    expect(result.notification!.enabled).toBe(true);
  });

  it('disable returns notification type', async () => {
    const result = await handleSlashCommand('heartbeat', 'disable', baseCtx);
    expect(result.type).toBe('notification');
    expect(result.notification!.type).toBe('heartbeat');
    expect(result.notification!.enabled).toBe(false);
  });

it('status with enabled settings shows yes and active schedule', async () => {
    const ctx = {
      ...baseCtx,
      settings: {
        ...baseCtx.settings,
        heartbeat: { ...baseCtx.settings.heartbeat, schedule: 'on', intraday: '8:00,14:00', daily: '6:00' },
      },
    } as SlashCommandContext;
    const result = await handleSlashCommand('heartbeat', 'status', ctx);
    expect(result.type).toBe('message');
    expect(result.message).toContain(': yes');
    expect(result.message).toContain('Active schedule');
    expect(result.message).toContain('Daily');
  });

  it('intraday with no arg returns usage', async () => {
    const result = await handleSlashCommand('heartbeat', 'intraday', baseCtx);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Usage');
  });

  it('intraday with valid times returns notification', async () => {
    const result = await handleSlashCommand('heartbeat', 'intraday 8:10,10:10,14:20', baseCtx);
    expect(result.type).toBe('notification');
    expect(result.notification!.type).toBe('heartbeat-set');
    const hb = result.notification as { type: 'heartbeat-set'; key: string };
    expect(hb.key).toBe('heartbeat.intraday');
    expect(hb.value).toBe('8:10,10:10,14:20');
  });

  it('intraday with invalid time returns error', async () => {
    const result = await handleSlashCommand('heartbeat', 'intraday 25:99', baseCtx);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Invalid time');
  });

  it('daily with no arg returns usage', async () => {
    const result = await handleSlashCommand('heartbeat', 'daily', baseCtx);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Usage');
  });

  it('daily with valid time returns notification', async () => {
    const result = await handleSlashCommand('heartbeat', 'daily 7:30', baseCtx);
    expect(result.type).toBe('notification');
    expect(result.notification!.type).toBe('heartbeat-set');
    const hbDaily = result.notification as { type: 'heartbeat-set'; key: string };
    expect(hbDaily.key).toBe('heartbeat.daily');
    expect(hbDaily.value).toBe('7:30');
  });

  it('daily with invalid time returns error', async () => {
    const result = await handleSlashCommand('heartbeat', 'daily 25:00', baseCtx);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Invalid time');
  });

  it('weekly with valid day@time returns notification', async () => {
    const result = await handleSlashCommand('heartbeat', 'weekly monday@9:00', baseCtx);
    expect(result.type).toBe('notification');
    expect(result.notification!.type).toBe('heartbeat-set');
    const hbWeekly = result.notification as { type: 'heartbeat-set'; key: string };
    expect(hbWeekly.key).toBe('heartbeat.weekly');
    expect(hbWeekly.value).toBe('monday@9:00');
  });

  it('weekly with invalid day returns error', async () => {
    const result = await handleSlashCommand('heartbeat', 'weekly funday@9:00', baseCtx);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Invalid day');
  });

  it('monthly with valid day@time returns notification', async () => {
    const result = await handleSlashCommand('heartbeat', 'monthly 15@6:00', baseCtx);
    expect(result.type).toBe('notification');
    expect(result.notification!.type).toBe('heartbeat-set');
    const hbMonthly = result.notification as { type: 'heartbeat-set'; key: string };
    expect(hbMonthly.key).toBe('heartbeat.monthly');
    expect(hbMonthly.value).toBe('15@6:00');
  });

  it('monthly with invalid day returns error', async () => {
    const result = await handleSlashCommand('heartbeat', 'monthly 32@6:00', baseCtx);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Invalid day');
  });

  it('now returns heartbeat-now notification', async () => {
    const result = await handleSlashCommand('heartbeat', 'now', baseCtx);
    expect(result.type).toBe('notification');
    expect(result.notification!.type).toBe('heartbeat-now');
  });

  it('unknown subcommand returns error', async () => {
    const result = await handleSlashCommand('heartbeat', 'foobar', baseCtx);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Unknown heartbeat action');
  });
});

describe('/context compact', () => {
  const ctx: SlashCommandContext = {
    settings: {
      model: 'claude-sonnet-4-6',
      effort: 'auto',
      mode: 'auto',
      theme: 'tokyo-night',
      statusline: true,
      debug: false,
      current_provider: 'anthropic',
      providers: {
        anthropic: { model: 'claude-sonnet-4-6', model_cost: '', model_context_window: 200000 },
      },
      heartbeat: { schedule: 'off', intraday: '', daily: '6:00', weekly: 'monday@6:00', monthly: '1@6:00', dreaming: '2:00' },
      channels: { bot_token: '', user_id: '', chat_id: '', allow_groups: false, tab_active: 'main' },
      safety: { path_guard: 'on', path_allowlist: '', command_guard: 'on', snapshots: 'on' },
      tools_per_call: 10,
      websearch_per_call: 5,
    },
    version: '0.1.0',
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    approvalMode: 'auto',
    cwd: '/test',
  };

  it('returns message when no messages available', async () => {
    const result = await handleSlashCommand('context', 'compact', ctx);
    expect(result.type).toBe('message');
    expect(result.message).toContain('Not enough messages');
  });

  it('returns compact result with detailed depth by default', async () => {
    const result = await handleSlashCommand('context', 'compact', {
      ...ctx,
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] },
      ],
    });
    expect(result.type).toBe('compact');
    expect(result.compact!.depth).toBe('detailed');
    expect(result.compact!.messages).toHaveLength(2);
  });

  it('returns compact result with brief depth when specified', async () => {
    const result = await handleSlashCommand('context', 'compact brief', {
      ...ctx,
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: [{ type: 'text', text: 'Hi!' }] },
      ],
    });
    expect(result.type).toBe('compact');
    expect(result.compact!.depth).toBe('brief');
  });

  it('returns error for unknown depth', async () => {
    const result = await handleSlashCommand('context', 'compact invalid', {
      ...ctx,
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(result.type).toBe('message');
    expect(result.message).toContain('Unknown compact depth');
  });

  it('returns error for strict depth (not supported)', async () => {
    const result = await handleSlashCommand('context', 'compact strict', {
      ...ctx,
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(result.type).toBe('message');
    expect(result.message).toContain('Unknown compact depth');
  });

  it('requires at least 2 messages', async () => {
    const result = await handleSlashCommand('context', 'compact', {
      ...ctx,
      messages: [{ role: 'user', content: 'only one message' }],
    });
    expect(result.type).toBe('message');
    expect(result.message).toContain('Not enough messages');
  });
});
