import type { CurieSettings } from '../../core/src/settings.js';
import type { Message } from '../../core/src/turn-loop.js';
import type { TabId } from './tab-bar.js';
import { CronManager, pickNextSchedule, scheduleLabel } from '@curie-agent/core';

export interface SlashCommandContext {
  settings: CurieSettings;
  version: string;
  model: string;
  provider: string;
  approvalMode: string;
  cwd: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Message history for the current session (user, assistant, tool messages). */
  messages?: Message[];
  /** Channel message display data from the TUI (broader role set, includes tool-group and system). */
  channelMessages?: Array<{ role: string; content: string; title?: string }>;
  cronManager?: CronManager;
  /** MCP client instances for connection status display. */
  mcpClients?: Array<{ serverId: string; isConnected: boolean; tools: ReadonlyArray<{ name: string }> }>;
  /** Server IDs that failed to connect during createMcpTools. */
  mcpFailed?: string[];
  /** Current model's context window size in tokens. */
  contextWindowSize?: number;
  /** Extended thinking token budget (0 if disabled). */
  thinkingBudget?: number;
  /** List snapshots for a cwd (provided by CLI for /snapshots). */
  listSnapshots?: (cwd: string) => Array<{ sha: string; timestamp: string; cwd: string; label: string; changedFiles: number }>;
  /** Revert to a snapshot SHA (provided by CLI for /revert). */
  revertTo?: (cwd: string, sha: string) => Promise<{ success: boolean; error?: string }>;
}

export interface SlashCommandResult {
  type: 'message' | 'update_model' | 'update_model_cost' | 'update_context_window' | 'update_theme' | 'update_mode' | 'update_effort' | 'update_debug' | 'update_statusline' | 'update_tools_per_call' | 'update_websearch_per_call' | 'update_mcp' | 'start_agent' | 'notification' | 'external' | 'exit' | 'update_memory' | 'switch_tab' | 'update_provider' | 'update_init' | 'compact';
  message?: string;
  model?: string;
  modelCost?: string;
  contextWindow?: number;
  theme?: string;
  mode?: 'plan' | 'edit' | 'auto' | 'yolo';
  effort?: 'low' | 'medium' | 'high' | 'max' | 'auto';
  debug?: boolean;
  statusline?: boolean;
  toolsPerCall?: number;
  websearchPerCall?: number;
  mcpServerId?: string;
  mcpServers?: string;
  agentId?: string;
  agentMode?: 'plan' | 'edit' | 'auto' | 'yolo';
  agentEffort?: 'low' | 'medium' | 'high' | 'max' | 'auto';
  notification?: {
    type: 'reminder';
    id: string;
    message: string;
    scheduledAt: string;
  } | {
    type: 'heartbeat';
    enabled?: boolean;
  } | {
    type: 'heartbeat-set';
    key: 'HEARTBEAT_INTRADAY' | 'HEARTBEAT_DAILY' | 'HEARTBEAT_WEEKLY' | 'HEARTBEAT_MONTHLY' | 'HEARTBEAT_DREAMING';
    value: string;
  } | {
    type: 'heartbeat-now';
  };
  external?: string;
  tab?: TabId;
  memory?: { content: string; operation: 'add' | 'status' };
  provider?: string;
  providerApiKey?: string;
  providerBaseUrl?: string;
  apiKey?: string;
  /** Wizard phase for interactive setup: 'provider' | 'apiKey' | 'url' | 'model' */
  wizardStep?: string;
  wizardProvider?: string;
  /** Key names for provider config (apiKey key + url key) */
  apiKeyKeys?: string[];
  /** Key-value pairs for provider config */
  keys?: Record<string, string>;
  /** Conversation compaction result — CLI will call provider to summarize */
  compact?: {
    messages: Message[];
    depth: 'detailed' | 'brief';
  };
}

export interface SlashCommandDef {
  name: string;
  description: string;
  usage: string;
}


const THINKING_BUDGET_MAP: Record<string, number> = {
  low: 2_000,
  medium: 6_000,
  high: 16_000,
  max: 32_000,
  auto: 0,
};

export const SLASH_COMMANDS: SlashCommandDef[] = [
  { name: 'status', description: 'Show version, model, and account info', usage: '/status' },
  { name: 'help', description: 'Show all available commands', usage: '/help' },
  { name: 'debug', description: 'Toggle debug logging', usage: '/debug [on|off]' },
  { name: 'statusline', description: 'Toggle status line display', usage: '/statusline [on|off]' },
  { name: 'theme', description: 'Change color theme', usage: '/theme <name>' },
  { name: 'memory', description: 'View memory file sizes or capture a memory', usage: '/memory [status|add]' },
  { name: 'stats', description: 'Daily usage, sessions, streaks', usage: '/stats' },
  { name: 'context', description: 'Visual grid showing context window usage', usage: '/context [messages|compact [detailed|brief]]' },
  { name: 'model', description: 'Switch AI model, set pricing or context window', usage: '/model <model|pricing in;out|window tokens>' },
  { name: 'effort', description: 'Set reasoning effort level', usage: '/effort <low|medium|high|max|auto>' },
  { name: 'mode', description: 'Set approval mode', usage: '/mode <manual|plan|auto-edit|full-auto|yolo>' },
  { name: 'agent', description: 'Launch external AI agent', usage: '/agent <prompt>' },
  { name: 'remind', description: 'Create a reminder', usage: '/remind <message at time>' },
  { name: 'cron', description: 'Manage reminders', usage: '/cron <list|delete|clear>' },
  { name: 'channels', description: 'Manage Telegram channel config', usage: '/channels <list|set-bot-token|set-user-id|set-chat-id|disconnect>' },
  { name: 'tools', description: 'View/set tool call limits per turn', usage: '/tools [tools_per_call [websearch_per_call]]' },
  { name: 'websearch', description: 'View/set web search+fetch limit per turn', usage: '/websearch [count]' },
  { name: 'mcp', description: 'Manage MCP server connections', usage: '/mcp <list|add|remove|reload>' },
  { name: 'exit', description: 'Exit curie-agent', usage: '/exit' },
  { name: 'provider', description: 'Switch AI provider', usage: '/provider <anthropic|openai|google|local|ollama|openrouter>' },
  { name: 'heartbeat', description: 'Manage heartbeat cycle', usage: '/heartbeat <status|enable|disable|intraday|daily|weekly|monthly|dreaming|now>' },
  { name: 'init', description: 'Run the setup wizard', usage: '/init' },
  { name: 'snapshots', description: 'List recent git snapshots for recovery', usage: '/snapshots' },
  { name: 'revert', description: 'Revert to a git snapshot (index, default: most recent)', usage: '/revert [index]' },
];

export function parseSlashCommand(input: string): { command: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return { command: trimmed.slice(1).toLowerCase(), args: '' };
  }
  return {
    command: trimmed.slice(1, spaceIdx).toLowerCase(),
    args: trimmed.slice(spaceIdx + 1).trim(),
  };
}

export async function handleSlashCommand(
  cmd: string,
  args: string,
  ctx: SlashCommandContext,
): Promise<SlashCommandResult> {
  switch (cmd) {
    case 'status':
      return handleStatus(ctx);

    case 'help':
      return handleHelp();

    case 'debug':
      return handleDebug(args, ctx.settings.debug);

    case 'statusline':
      return handleStatusline(args, ctx.settings.statusline);

    case 'theme':
      return handleTheme(args);

    case 'memory':
      return handleMemory(args, ctx);

    case 'stats':
      return { type: 'switch_tab', tab: 'stats', message: 'Switched to Stats tab' };

    case 'context':
      return handleContext(ctx, args);

    case 'model':
      return handleModel(args, ctx.settings);

    case 'effort':
      return handleEffort(args);

    case 'mode':
      return handleMode(args);

    case 'exit':
    case 'quit':
      return { type: 'exit', message: 'Exiting curie-agent.' };

    case 'agent':
      return handleAgent(args);

    case 'remind':
      return handleRemind(args, ctx);

    case 'cron':
      return handleCron(args, ctx);

    case 'channels':
      return handleChannels(args, ctx);

    case 'mcp':
      return handleMcp(args, ctx);

    case 'tools':
      return handleTools(args, ctx.settings);

    case 'websearch':
      return handleWebsearch(args, ctx.settings);

    case 'provider':
      return handleProvider(args);

    case 'heartbeat':
      return handleHeartbeat(args, ctx);

    case 'init': {
      // Wizard is interactive — provider, key, URL, model are handled via onSubmit.
      // /init triggers the initial prompt; subsequent user input flows through onSubmit.
      if (!args) {
        return { type: 'message', message: 'init_wizard' };
      }
      // Treat as direct API key (legacy behavior)
      return { type: 'update_init', message: `API key configured: ${args.trim()}`, apiKey: args.trim() };
    }

    case 'snapshots':
      return handleSnapshots(ctx);

    case 'revert':
      return handleRevert(args, ctx);

    default:
      return {
        type: 'message',
        message: `Unknown command: /${cmd}. Type /help for available commands.`,
      };
  }
}

function validatePricingString(cost: string | undefined): boolean {
  if (!cost) return false;
  if (!cost.includes('|')) {
    const [inStr = '', outStr = ''] = cost.split(';');
    const inC = parseFloat(inStr);
    const outC = parseFloat(outStr);
    return !isNaN(inC) && !isNaN(outC) && inC >= 0 && outC >= 0;
  }
  const tiers = cost.split('|').map(s => s.trim());
  const firstPair = (tiers[0] ?? '').split(';');
  const inStr = firstPair[0] ?? '';
  const outStr = firstPair[1] ?? '';
  if (isNaN(parseFloat(inStr)) || isNaN(parseFloat(outStr))) return false;
  for (let i = 1; i < tiers.length; i++) {
    const tier = tiers[i]!;
    const idx = tier.indexOf('<');
    if (idx === -1) return false;
    const threshold = parseInt(tier.substring(0, idx).trim(), 10);
    const rest = tier.substring(idx + 1).trim();
    const [inStr2 = '', outStr2 = ''] = rest.split(';');
    const tierIn = parseFloat(inStr2);
    const tierOut = parseFloat(outStr2);
    if (isNaN(threshold) || isNaN(tierIn) || isNaN(tierOut) || threshold < 0 || tierIn < 0 || tierOut < 0) return false;
  }
  return true;
}

function formatPricingDisplay(cost: string | undefined): string {
  if (!cost) return '';
  if (!cost.includes('|')) {
    const [inStr = '', outStr = ''] = cost.split(';');
    return `Pricing: $${inStr} in / $${outStr} out per 1M`;
  }
  const tiers = cost.split('|').map(s => s.trim());
  const firstPair = (tiers[0] ?? '').split(';');
  const inStr = firstPair[0] ?? '?';
  const outStr = firstPair[1] ?? '?';
  return `Pricing: $${inStr} in / $${outStr} out per 1M (${tiers.length} tier${tiers.length > 1 ? 's' : ''})`;
}

function handleStatus(ctx: SlashCommandContext): SlashCommandResult {
  const toolsPerCall = ctx.settings.TOOLS_PER_CALL ?? 10;
  const websearchPerCall = ctx.settings.WEBSEARCH_PER_CALL ?? 5;
  const lines = [
    `curie-agent v${ctx.version}`,
    `Model: ${ctx.model}`,
    `Provider: ${ctx.provider}`,
    `Mode: ${ctx.approvalMode}`,
    `CWD: ${ctx.cwd}`,
    ctx.inputTokens !== undefined
      ? `Tokens: ${ctx.inputTokens} in / ${ctx.outputTokens} out`
      : null,
    `Tools per turn: ${toolsPerCall}`,
    `WebSearch per turn: ${websearchPerCall}`,
    ctx.settings.MODEL_COST
      ? formatPricingDisplay(ctx.settings.MODEL_COST)
      : null,
  ].filter(Boolean);
  return { type: 'message', message: lines.join('\n') };
}

function handleHelp(): SlashCommandResult {
  const lines = ['Slash commands:'];
  for (const cmd of SLASH_COMMANDS) {
    lines.push(`  ${cmd.usage.padEnd(24)} ${cmd.description}`);
  }
  return { type: 'message', message: lines.join('\n') };
}

function handleDebug(args: string, current: boolean): SlashCommandResult {
  const next = args === 'on' ? true : args === 'off' ? false : !current;
  return {
    type: 'update_debug',
    debug: next,
    message: `Debug logging: ${next ? 'enabled' : 'disabled'}`,
  };
}

function handleStatusline(args: string, current: boolean): SlashCommandResult {
  const next = args === 'on' ? true : args === 'off' ? false : !current;
  return {
    type: 'update_statusline',
    statusline: next,
    message: `Status line: ${next ? 'visible' : 'hidden'}`,
  };
}

function handleTheme(args: string): SlashCommandResult {
  const validThemes = ['tokyo-night', 'nord', 'dracula', 'solarized', 'gruvbox', 'black', 'white', 'grey'];
  const theme = args.toLowerCase();
  if (!theme) {
    return {
      type: 'message',
      message: `Available themes: ${validThemes.join(', ')}\nUsage: /theme <name>`,
    };
  }
  if (!validThemes.includes(theme)) {
    return {
      type: 'message',
      message: `Unknown theme: "${theme}". Available: ${validThemes.join(', ')}`,
    };
  }
  return { type: 'update_theme', theme, message: `Theme changed to: ${theme}` };
}

function handleModel(args: string, settings?: CurieSettings): SlashCommandResult {
  const MODEL_COST_DEFAULT = '(not set)';
  const WINDOW_DEFAULT = 200_000;

  if (!args) {
    const cost = settings?.MODEL_COST ?? MODEL_COST_DEFAULT;
    const window = settings?.MODEL_CONTEXT_WINDOW ?? WINDOW_DEFAULT;
    return {
      type: 'message',
      message: `Usage: /model <model>\n  /model pricing [in;out]        — set custom per-million pricing (e.g. "0.5;2.0" or "0.5;2.0|200000<1.0;4.0")\n  /model window <tokens>       — set max context window\n\nCurrent: pricing=${cost}  window=${window} tokens`,
    };
  }

  const parts = args.trim().split(/\s+/);
  const sub = parts[0]!.toLowerCase();
  const rest = parts.slice(1).join(' ').trim();

  switch (sub) {
    case 'pricing': {
      if (!rest) {
        const cost = settings?.MODEL_COST ?? MODEL_COST_DEFAULT;
        return { type: 'message', message: `Usage: /model pricing <in;out>\n  /model pricing <in;out|threshold<input;out>...\nExample: /model pricing 0.5;2.0\n  /model pricing 0.5;2.0|200000<1.0;4.0\nCurrent: ${cost}` };
      }
      const isValidPricing = validatePricingString(rest);
      if (!isValidPricing) {
        return { type: 'message', message: `Invalid pricing: "${rest}". Use format: <in;out> or <in;out|threshold<input;out> (per million tokens, e.g. "0.5;2.0" or "0.5;2.0|200000<1.0;4.0").` };
      }
      const [inStr = ''] = rest.split(';');
      const inCost = parseFloat(inStr);
      const firstTier = rest.split('|')[0]?.split(';');
      const outCost = firstTier ? parseFloat(firstTier[1] ?? '') : NaN;
      const tierCount = rest.includes('|') ? rest.split('|').length : 1;
      return {
        type: 'update_model_cost',
        modelCost: rest,
        message: tierCount === 1
          ? `Model pricing set to: $${inCost} in / $${outCost} out per 1M tokens`
          : `Model pricing set to: ${tierCount} tiers, base $${inCost} in / $${outCost} out per 1M tokens`,
      };
    }

    case 'window': {
      if (!rest) {
        const window = settings?.MODEL_CONTEXT_WINDOW ?? WINDOW_DEFAULT;
        return { type: 'message', message: `Usage: /model window <tokens>\nExample: /model window 1000000\nCurrent: ${window}` };
      }
      const windowSize = parseInt(rest, 10);
      if (isNaN(windowSize) || windowSize < 1024) {
        return { type: 'message', message: `Invalid context window: "${rest}". Must be a positive integer (min 1024).` };
      }
      return { type: 'update_context_window', contextWindow: windowSize, message: `Context window set to: ${windowSize.toLocaleString()} tokens` };
    }

    default: {
      const aliasMap: Record<string, string> = {
        opus: 'claude-opus-4-7',
        sonnet: 'claude-sonnet-4-6',
        haiku: 'claude-haiku-4-5-20251001',
        gpt4o: 'gpt-4o',
        gpt4turbo: 'gpt-4-turbo',
        o1: 'o1',
        'o3-mini': 'o3-mini',
      };
      const resolved = aliasMap[sub] || args;
      return { type: 'update_model', model: resolved, message: `Model changed to: ${resolved}` };
    }
  }
}

function handleEffort(args: string): SlashCommandResult {
  const valid = ['low', 'medium', 'high', 'max', 'auto'];
  if (!args) {
    return {
      type: 'message',
      message: `Usage: /effort <level>\nLevels: ${valid.join(', ')}`,
    };
  }
  const level = args.toLowerCase();
  if (!valid.includes(level)) {
    return {
      type: 'message',
      message: `Invalid effort level: "${args}". Valid: ${valid.join(', ')}`,
    };
  }
  return { type: 'update_effort', effort: level as 'low' | 'medium' | 'high' | 'max' | 'auto', message: `Effort set to: ${level}` };
}

function handleMode(args: string): SlashCommandResult {
  const valid = ['plan', 'edit', 'auto', 'yolo'];
  if (!args) {
    return {
      type: 'message',
      message: `Usage: /mode <mode>\nModes: ${valid.join(', ')}`,
    };
  }
  const mode = args.toLowerCase();
  if (!valid.includes(mode)) {
    return {
      type: 'message',
      message: `Invalid mode: "${args}". Valid: ${valid.join(', ')}`,
    };
  }
  return { type: 'update_mode', mode: mode as 'plan' | 'edit' | 'auto' | 'yolo', message: `Mode changed to: ${mode}` };
}

function handleAgent(args: string): SlashCommandResult {
  if (!args) {
    return {
      type: 'message',
      message: 'Usage: /agent [--mode plan|edit|auto|yolo] [--effort low|medium|high|max|auto] <prompt>\nExample: /agent --mode auto --effort medium check codebase',
    };
  }

  let agentMode: 'plan' | 'edit' | 'auto' | 'yolo' | undefined;
  let agentEffort: 'low' | 'medium' | 'high' | 'max' | 'auto' | undefined;
  let remaining = args;

  const validModes = ['plan', 'edit', 'auto', 'yolo'];
  const validEfforts = ['low', 'medium', 'high', 'max', 'auto'];

  // Match --mode <word> or --effort <word> with optional trailing text
  const flagRegex = /^--(mode|effort)\s+(\S+?)(?:\s+(.+))?$/;
  let found = true;
  while (found) {
    found = false;
    const match = remaining.match(flagRegex);
    if (match) {
      const flag = match[1];
      const value = (match[2] ?? '').trim();
      if (flag === 'mode' && validModes.includes(value)) {
        agentMode = value as typeof agentMode;
      } else if (flag === 'effort' && validEfforts.includes(value)) {
        agentEffort = value as typeof agentEffort;
      } else {
        break; // unknown flag or invalid value → stop parsing
      }
      // match[3] is the remaining text after the flag value
      remaining = (match[3] ?? '').trim();
      found = true;
    }
  }

  const prompt = remaining.trim();
  if (!prompt) {
    return {
      type: 'message',
      message: 'Usage: /agent [--mode plan|edit|auto|yolo] [--effort low|medium|high|max|auto] <prompt>\nExample: /agent --mode auto --effort medium check codebase',
    };
  }

  const agentId = crypto.randomUUID();
  return {
    type: 'start_agent',
    agentId,
    message: `Agent started: "${prompt}"`,
    agentMode,
    agentEffort,
  };
}

function handleRemind(args: string, ctx: SlashCommandContext): SlashCommandResult {
  if (!args) {
    return {
      type: 'message',
      message: 'Usage: /remind <message at time>\nExamples: /remind "tomorrow at 7am make breakfast", /remind "in 30 minutes call mom"',
    };
  }

  const cronManager = ctx.cronManager;
  if (!cronManager) {
    return {
      type: 'message',
      message: 'Reminder service not available. Please restart the application.',
    };
  }

  const { parseReminderTime } = require('../../core/src/reminder-parser.js');
  const parsed = parseReminderTime(args);
  if (!parsed) {
    return {
      type: 'message',
      message: `Could not parse time from: "${args}".\nTry: /remind "tomorrow at 7am make breakfast"`,
    };
  }

 const task = cronManager.createReminder(parsed.message, parsed.scheduledAt);
  const timeStr = new Date(task.scheduledAt).toLocaleString();
  return {
    type: 'message',
    message: `Curie reminder:\nDate: ${timeStr}\n${parsed.message}\nID: ${task.id}`,
  };
}

function handleCron(args: string, ctx: SlashCommandContext): SlashCommandResult {
  const cronManager = ctx.cronManager;
  if (!cronManager) {
    return {
      type: 'message',
      message: 'Reminder service not available. Please restart the application.',
    };
  }

  // Reload from disk before each command so tool-created reminders
  // are visible even if the tool used a separate CronManager instance.
  cronManager.load();

  const parts = args.trim().split(/\s+/);
  const action = parts[0]?.toLowerCase();
  const rest = parts.slice(1).join(' ').trim();

  switch (action) {
    case 'list': {
      const statusFilter = ['pending', 'fired', 'cancelled'].includes(rest) ? (rest as 'pending' | 'fired' | 'cancelled') : undefined;
      const tasks = cronManager.listReminders(statusFilter);
      if (tasks.length === 0) {
        return {
          type: 'message',
          message: statusFilter
            ? `No ${statusFilter} reminders.`
            : 'No reminders yet.\nUse /remind to create one.',
        };
      }
  const lines = [`Reminders (${tasks.length}${statusFilter ? ` — ${statusFilter}` : ''}):`];
      for (const t of tasks) {
        const timeStr = new Date(t.scheduledAt).toLocaleString();
        const statusEmoji = t.status === 'pending' ? '⏳' : t.status === 'fired' ? '✅' : '❌';
        const label = t.schedule ? `[${scheduleLabel(t.schedule.type)}] ` : '';
        lines.push(`  ${statusEmoji} ${label}${t.message}\n    Date: ${timeStr}\n    ID: ${t.id}`);
      }
      return { type: 'message', message: lines.join('\n') };
    }
    case 'delete': {
      if (!rest) {
        return {
          type: 'message',
          message: 'Usage: /cron delete <id>\nExample: /cron delete abc-123',
        };
      }
      const result = cronManager.cancelReminder(rest);
      if (!result) {
        return { type: 'message', message: `No reminder found with ID: ${rest}` };
      }
      return { type: 'message', message: `Reminder cancelled.` };
    }
    case 'clear': {
      const removed = cronManager.clearCompleted();
      return { type: 'message', message: `Cleared ${removed} completed reminder(s).` };
    }
    default:
      return {
        type: 'message',
        message: `Unknown cron action: "${action}". Use: list, delete, clear`,
      };
  }
}

function handleChannels(args: string, ctx: SlashCommandContext): SlashCommandResult {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const rest = parts.slice(1).join(' ').trim();

  switch (sub) {
    case 'list': {
      const token = ctx.settings.TELEGRAM_BOT_TOKEN;
      const userId = ctx.settings.TELEGRAM_USER_ID;
      const chatId = ctx.settings.TELEGRAM_CHAT_ID;
      const tokenMask = token && token.length > 8
        ? token.slice(0, 8) + '...'
        : token || '(not set)';
      return {
        type: 'message',
        message: `Telegram Configuration:\n  Bot Token: ${tokenMask}\n  Allowed User ID: ${userId || '(not set)'}\n  Chat ID: ${chatId || '(not set)'}`,
      };
    }

    case 'set-bot-token': {
      if (!rest) {
        return {
          type: 'message',
          message: 'Usage: /channels set-bot-token <token>\nExample: /channels set-bot-token 123456:ABC-DEF...',
        };
      }
      return { type: 'external', external: 'channels.set-bot-token', message: rest };
    }

    case 'set-user-id': {
      if (!rest) {
        return {
          type: 'message',
          message: 'Usage: /channels set-user-id <id>\nExample: /channels set-user-id 123456789',
        };
      }
      return { type: 'external', external: 'channels.set-user-id', message: rest };
    }

    case 'set-chat-id': {
      if (!rest) {
        return {
          type: 'message',
          message: 'Usage: /channels set-chat-id <chatId>\nExample: /channels set-chat-id -1001234567890',
        };
      }
      return { type: 'external', external: 'channels.set-chat-id', message: rest };
    }

    case 'disconnect': {
      return { type: 'external', external: 'channels.disconnect' };
    }

    case 'switch': {
      if (!rest) {
        return {
          type: 'message',
          message: 'Usage: /channels switch <channelId>\nExamples: /channels switch main, /channels switch telegram:12345',
        };
      }
      return { type: 'external', external: 'channels.switch', message: rest };
    }

    default:
      return {
        type: 'message',
        message: `Unknown channel action: "${sub}". Use: list, switch, set-bot-token, set-user-id, set-chat-id, disconnect`,
      };
  }
}

function handleMcp(args: string, ctx: SlashCommandContext): SlashCommandResult {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const rest = parts.slice(1).join(' ').trim();

  if (!sub) {
    return {
      type: 'message',
      message: 'Usage: /mcp <list|add|remove|reload>\n  list          — Show configured MCP servers\n  add <id> <transport> ... — Add an MCP server\n  remove <id>   — Remove an MCP server by ID\n  reload        — Reconnect all MCP servers',
    };
  }

  // Parse current MCP servers from settings
  let configs: Record<string, unknown> = {};
  try {
    const raw = ctx.settings.MCP_SERVERS as string | Record<string, unknown> | undefined;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      configs = JSON.parse(raw) as Record<string, unknown>;
    } else if (raw && typeof raw === 'object') {
      configs = raw;
    }
  } catch {
    /* ignore */
  }

  switch (sub) {
    case 'list': {
      const entries = Object.entries(configs);
      if (entries.length === 0) {
        return {
          type: 'message',
          message: 'No MCP servers configured.\nUse /mcp add to add one.\n\nExample:\n  /mcp add filesystem stdio npx -y @modelcontextprotocol/server-filesystem /workspace',
        };
      }
      const lines = [`MCP Servers (${entries.length}):`];
      for (const [id, cfg] of entries) {
        const c = cfg as Record<string, unknown>;
        const transport = (c.transport as string) || 'unknown';
        const name = (c.name as string) || id;
        let detail = '';
        if (transport === 'stdio') {
          detail = `${(c.command as string) || '?'} ${(c.args as string[])?.join(' ') || ''}`;
        } else {
          detail = `url: ${(c.url as string) || '?'}`;
        }
        const client = ctx.mcpClients?.find((cl) => cl.serverId === id);
        const wasFailed = ctx.mcpFailed?.includes(id);
        if (!client) {
          const status = wasFailed ? 'connection failed' : 'not running';
          lines.push(`  ⚠️  ${id} (${name}) — ${transport}: ${detail} [${status}]`);
        } else if (client.isConnected) {
          lines.push(`  ✅ ${id} (${name}) — ${transport}: ${detail}`);
        } else {
          lines.push(`  ⚠️  ${id} (${name}) — ${transport}: ${detail} [disconnected]`);
        }
      }
      return { type: 'message', message: lines.join('\n') };
    }

    case 'add': {
      // /mcp add <id> <transport> [--env key=value ...] [command] [arg ...]
      if (!rest) {
        return {
          type: 'message',
          message: 'Usage: /mcp add <id> <transport> [--env key=value ...] [command] [arg ...]\n\nExamples:\n  /mcp add filesystem stdio npx -y @modelcontextprotocol/server-filesystem /workspace\n  /mcp add github stdio npx -y @modelcontextprotocol/server-github --env GITHUB_TOKEN=ghp_xxx\n  /mcp add my-api sse https://api.example.com/mcp',
        };
      }
      const addParts = rest.split(/\s+/);
      const id = addParts[0];
      const transport = addParts[1]?.toLowerCase() as 'stdio' | 'sse' | 'streamable-http' | undefined;
      if (!id || !transport) {
        return {
          type: 'message',
          message: 'Usage: /mcp add <id> <stdio|sse|streamable-http> [flags] [command] [args...]\nExample: /mcp add filesystem stdio npx -y @modelcontextprotocol/server-filesystem /workspace',
        };
      }
      if (!['stdio', 'sse', 'streamable-http'].includes(transport)) {
        return { type: 'message', message: `Invalid transport: "${transport}". Use: stdio, sse, streamable-http` };
      }
      if (configs[id]) {
        return { type: 'message', message: `Server "${id}" already exists. Use /mcp reload to reconnect.` };
      }

      const cfg: Record<string, unknown> = { id, name: id, transport };
      let i = 2;
      // Parse --env key=value flags
      const env: Record<string, string> = {};
      while (i < addParts.length && addParts[i]?.startsWith('--')) {
        if (addParts[i] === '--env' && i + 1 < addParts.length) {
          i++;
          const kv = addParts[i];
          if (!kv) break;
          const eqIdx = kv.indexOf('=');
          if (eqIdx > 0) {
            env[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1);
          }
          i++;
        } else {
          break;
        }
      }
      if (transport === 'stdio' && i < addParts.length) {
        cfg.command = addParts[i];
        const cmdArgs = addParts.slice(i + 1);
        if (cmdArgs.length > 0) cfg.args = cmdArgs;
      } else if (transport === 'sse' || transport === 'streamable-http') {
        cfg.url = addParts[i] || undefined;
      }
      if (Object.keys(env).length > 0) cfg.env = env;

      configs[id] = cfg;
      ctx.settings.MCP_SERVERS = configs;

      return { type: 'update_mcp', mcpServerId: id, mcpServers: JSON.stringify(configs, null, 2), message: `Added MCP server "${id}":\n\n${JSON.stringify(configs, null, 2)}\n\nRun /mcp reload to connect.` };
    }

    case 'remove': {
      if (!rest) {
        return {
          type: 'message',
          message: 'Usage: /mcp remove <id>\nExample: /mcp remove filesystem',
        };
      }
      if (!configs[rest]) {
        return { type: 'message', message: `No MCP server found with ID: ${rest}` };
      }
      delete configs[rest];
          ctx.settings.MCP_SERVERS = configs;
      return { type: 'update_mcp', mcpServerId: rest, message: `Removed MCP server "${rest}". Run /mcp reload to apply.` };
    }

    case 'reload': {
      return { type: 'update_mcp', message: 'MCP servers reloaded. Reconnecting...' };
    }

    default:
      return {
        type: 'message',
        message: `Unknown MCP action: "${sub}". Use: list, add, remove, reload`,
      };
  }
}

function handleTools(args: string, settings: CurieSettings): SlashCommandResult {
  const toolsPerCall = settings.TOOLS_PER_CALL ?? 10;
  const websearchPerCall = settings.WEBSEARCH_PER_CALL ?? 5;

  if (!args.trim()) {
    return {
      type: 'message',
      message: `Tool call limits (per turn):\n  Tools: ${toolsPerCall}\n  WebSearch+WebFetch: ${websearchPerCall}\n\nUsage:\n  /tools 15          — set tools per call\n  /tools 15 8        — set both limits`,
    };
  }

  const parts = args.trim().split(/\s+/);
  const val = parseInt(parts[0]!, 10);
  if (isNaN(val) || val < 1) {
    return { type: 'message', message: `Invalid value: "${parts[0]}". Must be a positive integer.` };
  }

  const result: SlashCommandResult = {
    type: 'update_tools_per_call',
    toolsPerCall: val,
    message: `Tools per call set to: ${val}`,
  };

  if (parts[1]) {
    const wsVal = parseInt(parts[1]!, 10);
    if (isNaN(wsVal) || wsVal < 1) {
      return { type: 'message', message: `Invalid websearch value: "${parts[1]}". Must be a positive integer.` };
    }
    result.websearchPerCall = wsVal;
  }

  return result;
}

function handleWebsearch(args: string, settings: CurieSettings): SlashCommandResult {
  const websearchPerCall = settings.WEBSEARCH_PER_CALL ?? 5;

  if (!args.trim()) {
    return {
      type: 'message',
      message: `WebSearch/WebFetch limit per turn: ${websearchPerCall}\n\nUsage:\n  /websearch 3       — set websearch+fetch limit`,
    };
  }

  const val = parseInt(args.trim(), 10);
  if (isNaN(val) || val < 1) {
    return { type: 'message', message: `Invalid value: "${args}". Must be a positive integer.` };
  }

  return {
    type: 'update_websearch_per_call',
    websearchPerCall: val,
    message: `WebSearch+WebFetch per turn set to: ${val}`,
  };
}

function handleMemory(args: string, ctx: SlashCommandContext): SlashCommandResult {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const rest = parts.slice(1).join(' ').trim();

  switch (sub) {
    case 'status':
      return {
        type: 'update_memory',
        message: 'Retrieving memory file sizes...',
        memory: { content: '', operation: 'status' },
      };

    case 'add': {
      if (!rest) {
        return {
          type: 'message',
          message: 'Usage: /memory add <text>\nExample: /memory add user prefers TypeScript over JavaScript',
        };
      }
      const entry = `- [${new Date().toISOString()}] ${rest}`;
      return {
        type: 'update_memory',
        message: `Memory captured: "${rest}"\nThe agent will organize it into memory files on the next turn.`,
        memory: { content: entry, operation: 'add' },
      };
    }

    default: {
      return {
        type: 'message',
        message: 'Memory commands:\n  /memory status  — Show memory file sizes\n  /memory add <text>  — Capture a memory for the agent to organize',
      };
    }
  }
}

function formatChannelMessages(messages: Array<{ role: string; content: string; title?: string }>): SlashCommandResult {
  const lines = [`Conversation Messages (${messages.length}):`];
  const maxOutput = 8000;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const idx = String(i + 1).padStart(2, ' ');
    const roleLabel = msg.role === 'user' ? 'User'
      : msg.role === 'assistant' ? 'Assistant'
      : msg.role === 'tool' ? 'Tool'
      : msg.role === 'tool-group' ? 'Tools'
      : msg.role === 'system' ? 'System'
      : msg.role === 'decision' ? 'Decision'
      : msg.role === 'heartbeat' ? 'Heartbeat'
      : msg.role;
    const titlePrefix = msg.title ? `[${msg.title}] ` : '';
    const truncated = msg.content.length > 300
      ? msg.content.slice(0, 300) + '...'
      : msg.content;
    lines.push(`[${idx}] ${roleLabel}: ${titlePrefix}${truncated}`);
  }

  const fullOutput = lines.join('\n');
  if (fullOutput.length > maxOutput) {
    const cut = fullOutput.slice(0, maxOutput);
    lines.length = 0;
    lines.push(cut);
    lines.push(`\n[Output truncated at ${maxOutput} characters. Total messages: ${messages.length}]`);
  }
  return { type: 'message', message: lines.join('\n') };
}

function formatTurnLoopMessages(messages: Message[]): SlashCommandResult {
  const lines = [`Conversation Messages (${messages.length}):`];
  const maxOutput = 8000;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    const idx = String(i + 1).padStart(2, ' ');

    if (msg.role === 'user') {
      const truncated = msg.content.length > 200
        ? msg.content.slice(0, 200) + '...'
        : msg.content;
      lines.push(`[${idx}] User: ${truncated}`);
    } else if (msg.role === 'assistant') {
      const textParts: string[] = [];
      const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
      for (const block of msg.content) {
        if (block.type === 'text') {
          textParts.push(block.text);
        } else if (block.type === 'thinking') {
          const short = block.thinking.length > 150
            ? block.thinking.slice(0, 150) + '...'
            : block.thinking;
          textParts.push(`[thinking ${short.length} chars]`);
        } else if (block.type === 'tool-use') {
          toolCalls.push({ name: block.name, input: block.input });
        }
      }
      lines.push(`[${idx}] Assistant:`);
      for (const text of textParts) {
        const textTruncated = text.length > 200 ? text.slice(0, 200) + '...' : text;
        lines.push(`      ${textTruncated}`);
      }
      for (const tc of toolCalls) {
        const inputStr = JSON.stringify(tc.input).slice(0, 200);
        const inputTruncated = inputStr.length >= 200 ? inputStr + '...' : inputStr;
        lines.push(`      → ${tc.name}(${inputTruncated})`);
      }
    } else if (msg.role === 'tool') {
      const truncated = msg.content.length > 300
        ? msg.content.slice(0, 300) + '...\n[truncated, ' + msg.content.length + ' bytes total]'
        : msg.content;
      lines.push(`[${idx}] Tool Result (${msg.toolUseId}):`);
      for (const line of truncated.split('\n').slice(0, 5)) {
        lines.push(`      ${line}`);
      }
    }
  }

  const fullOutput = lines.join('\n');
  if (fullOutput.length > maxOutput) {
    const cut = fullOutput.slice(0, maxOutput);
    lines.length = 0;
    lines.push(cut);
    lines.push(`\n[Output truncated at ${maxOutput} characters. Total messages: ${messages.length}]`);
  }
  return { type: 'message', message: lines.join('\n') };
}

function handleContext(ctx: SlashCommandContext, args?: string): SlashCommandResult {
  const sub = args?.trim().toLowerCase();

  if (sub === 'messages') {
    // TurnLoop messages are the source of truth — they contain full tool output,
    // thinking blocks, and structured assistant responses. channelMessages is a
    // display-only layer that collapses tool results into summaries.
    const loopMsgs = ctx.messages;

    if (loopMsgs && loopMsgs.length > 0) {
      return formatTurnLoopMessages(loopMsgs);
    }

    // Fallback: channelMessages from TUI state (always available, but lossy).
    const channelMsgs = ctx.channelMessages;
    if (channelMsgs && channelMsgs.length > 0) {
      const filtered = channelMsgs.filter(
        (m) => !(m.role === 'assistant' && typeof m.content === 'string' && m.content.startsWith('█  ')),
      );
      if (filtered.length === 0) {
        return { type: 'message', message: 'No messages yet. Start a conversation to see message history.' };
      }
      return formatChannelMessages(filtered);
    }

    return { type: 'message', message: 'No messages yet. Start a conversation to see message history.' };
  }

  // /context compact [detailed|brief] — summarize conversation to free context
  if (sub && sub.startsWith('compact')) {
    const parts = sub.split(/\s+/);
    const depth = (parts[1] ?? 'detailed').toLowerCase() as 'detailed' | 'brief';
    if (!['detailed', 'brief'].includes(depth)) {
      return {
        type: 'message',
        message: `Unknown compact depth: "${depth}". Use: /context compact [detailed|brief]`,
      };
    }
    const loopMsgs = ctx.messages;
    if (!loopMsgs || loopMsgs.length < 2) {
      return {
        type: 'message',
        message: 'Not enough messages to compact. Need at least 2 messages (user + assistant turn).',
      };
    }
    return {
      type: 'compact',
      compact: {
        messages: loopMsgs,
        depth,
      },
      message: `Compacting conversation (${depth} summary)...\nThe agent will process the summary and continue with a condensed context.`,
    };
  }

  // Default: context window visual (unchanged behavior)
  const input = ctx.inputTokens ?? 0;
  const output = ctx.outputTokens ?? 0;
  const model = ctx.model || 'unknown';
  const windowSize = ctx.settings.MODEL_CONTEXT_WINDOW ?? ctx.contextWindowSize ?? 200_000;
  const pct = input > 0 ? Math.min(100, Math.round((input / windowSize) * 100)) : 0;
  const filled = Math.round((pct / 100) * 24);
  const bar = '█'.repeat(filled) + '░'.repeat(24 - filled);
  const fmt = (n: number) => (n >= 1_000 ? `${Math.round(n / 1_000)}k` : String(n));

  if (input === 0 && output === 0) {
    return { type: 'message', message: 'No token data yet. Start a conversation to see context window usage.' };
  }

  const lines = [`Context Window (${model}): ${bar} ${pct}% (${fmt(input)}/${fmt(windowSize)})`];
  if (input > 0 && output > 0) {
    lines.push(`  └─ ${fmt(input)} in / ${fmt(output)} out`);
  }
  return { type: 'message', message: lines.join('\n') };
}

const PROVIDER_MODEL_ALIASES: Record<string, string> = {
  opus: 'claude-opus-4-7',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
  gpt4o: 'gpt-4o',
  gpt4turbo: 'gpt-4-turbo',
  o1: 'o1',
  'o3-mini': 'o3-mini',
};

function handleProvider(args: string): SlashCommandResult {
  const validProviders = ['anthropic', 'openai', 'google', 'local', 'ollama', 'openrouter'];
  if (!args) {
    return {
      type: 'message',
      message: `Usage: /provider <name>\nProviders: ${validProviders.join(', ')}\n\nCurrent settings:\n  anthropic: MODEL_API_KEY, MODEL_URL\n  openai: OPENAI_API_KEY, OPENAI_URL\n  google: GOOGLE_API_KEY, GOOGLE_URL\n  local: MODEL_URL, MODEL_API_KEY\n  ollama: MODEL_URL, MODEL_API_KEY\n  openrouter: OPENROUTER_URL, OPENROUTER_API_KEY`,
    };
  }
  const provider = args.toLowerCase();
  if (!validProviders.includes(provider)) {
    return {
      type: 'message',
      message: `Unknown provider: "${args}". Valid: ${validProviders.join(', ')}`,
    };
  }
  return { type: 'update_provider', provider, message: `Provider switched to: ${provider}` };
}

function handleHeartbeat(args: string, ctx: SlashCommandContext): SlashCommandResult {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const rest = parts.slice(1).join(' ').trim();

  switch (sub) {
    case 'status':
    case '': {
      const active = ctx.settings.HEARTBEAT === 'on';
      const intraday = ctx.settings.HEARTBEAT_INTRADAY ?? '';
      const daily = ctx.settings.HEARTBEAT_DAILY ?? '6:00';
      const weekly = ctx.settings.HEARTBEAT_WEEKLY ?? 'monday@6:00';
      const monthly = ctx.settings.HEARTBEAT_MONTHLY ?? '1@6:00';
      const dreaming = ctx.settings.HEARTBEAT_DREAMING ?? '2:00';
      const intradayDisplay = intraday ? intraday.split(',').map((s) => s.trim()).join(', ') : '(not set)';
      const picked = pickNextSchedule({ HEARTBEAT_INTRADAY: intraday, HEARTBEAT_DAILY: daily, HEARTBEAT_WEEKLY: weekly, HEARTBEAT_MONTHLY: monthly, HEARTBEAT_DREAMING: dreaming });
      const activeSchedule = picked ? `${picked.type} (${picked.value})` : '(none configured)';
      return {
        type: 'message',
        message: `Heartbeat cycle:\n  Enabled        : ${active ? 'yes' : 'no'}\n  Active schedule: ${activeSchedule}\n\n  Intraday: ${intradayDisplay}\n  Daily   : ${daily}\n  Weekly  : ${weekly}\n  Monthly : ${monthly}\n  Dreaming: ${dreaming}\n\nUsage:\n  /heartbeat                        — show status\n  /heartbeat enable                 — turn on\n  /heartbeat disable                — turn off\n  /heartbeat intraday <H:MM,...>    — set intra-day times (e.g. 8:10,10:10,14:20)\n  /heartbeat daily <H:MM>           — set daily time (24h)\n  /heartbeat weekly <day@H:MM>\n  /heartbeat monthly <D@H:MM>\n  /heartbeat dreaming <H:MM>        — set dreaming time (24h)\n  /heartbeat now                    — run immediately`,
      };
    }

    case 'enable': {
      return { type: 'notification', notification: { type: 'heartbeat', enabled: true } };
    }

    case 'disable': {
      return { type: 'notification', notification: { type: 'heartbeat', enabled: false } };
    }

    case 'intraday': {
      if (!rest) {
        const current = ctx.settings.HEARTBEAT_INTRADAY ?? '';
        return {
          type: 'message',
          message: `Usage: /heartbeat intraday <H:MM,...>\nExample: /heartbeat intraday 8:10,10:10,14:20,16:20\nCurrent: ${current || '(not set)'}`,
        };
      }
      const tokens = rest.split(',').map((s) => s.trim()).filter(Boolean);
      const invalid = tokens.filter((t) => {
        if (!/^\d{1,2}:\d{2}$/.test(t)) return true;
        const colonIdx = t.indexOf(':');
        const h = parseInt(t.slice(0, colonIdx), 10);
        const m = parseInt(t.slice(colonIdx + 1), 10);
        return h < 0 || h > 23 || m < 0 || m > 59;
      });
      if (invalid.length > 0) {
        return { type: 'message', message: `Invalid time(s): ${invalid.join(', ')}. Use H:MM in 24h format (e.g., 8:10,14:20).` };
      }
      const value = tokens.join(',');
      return {
        type: 'notification',
        notification: { type: 'heartbeat-set', key: 'HEARTBEAT_INTRADAY', value },
      };
    }

    case 'daily': {
      if (!rest) {
        return {
          type: 'message',
          message: `Usage: /heartbeat daily <H:MM>\nExample: /heartbeat daily 6:00\nCurrent: ${ctx.settings.HEARTBEAT_DAILY ?? '6:00'}`,
        };
      }
      if (!/^\d{1,2}:\d{2}$/.test(rest)) {
        return { type: 'message', message: `Invalid time: "${rest}". Use H:MM (e.g., 6:00, 14:30).` };
      }
      const [hStr, mStr] = rest.split(':');
      const h = parseInt(hStr ?? '0', 10);
      const m = parseInt(mStr ?? '0', 10);
      if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
        return { type: 'message', message: `Invalid time: "${rest}". Hour 0-23, minute 0-59.` };
      }
      return {
        type: 'notification',
        notification: { type: 'heartbeat-set', key: 'HEARTBEAT_DAILY', value: rest },
      };
    }

    case 'weekly': {
      if (!rest) {
        return {
          type: 'message',
          message: `Usage: /heartbeat weekly <day@H:MM>\nExample: /heartbeat weekly monday@6:00\nCurrent: ${ctx.settings.HEARTBEAT_WEEKLY ?? 'monday@6:00'}`,
        };
      }
      const atIdx = rest.indexOf('@');
      if (atIdx < 0) {
        return { type: 'message', message: `Invalid weekly schedule: "${rest}". Use day@H:MM (e.g., monday@6:00).` };
      }
      const day = rest.slice(0, atIdx).toLowerCase();
      const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      if (!validDays.includes(day)) {
        return { type: 'message', message: `Invalid day: "${day}". Use: ${validDays.join(', ')}.` };
      }
      if (!/^\d{1,2}:\d{2}$/.test(rest.slice(atIdx + 1))) {
        return { type: 'message', message: `Invalid time: "${rest}". Use day@H:MM (e.g., monday@6:00).` };
      }
      return {
        type: 'notification',
        notification: { type: 'heartbeat-set', key: 'HEARTBEAT_WEEKLY', value: rest },
      };
    }

    case 'monthly': {
      if (!rest) {
        return {
          type: 'message',
          message: `Usage: /heartbeat monthly <D@H:MM>\nExample: /heartbeat monthly 1@6:00\nCurrent: ${ctx.settings.HEARTBEAT_MONTHLY ?? '1@6:00'}`,
        };
      }
      const atIdx = rest.indexOf('@');
      if (atIdx < 0) {
        return { type: 'message', message: `Invalid monthly schedule: "${rest}". Use D@H:MM (e.g., 1@6:00).` };
      }
      const dayOfMonth = parseInt(rest.slice(0, atIdx), 10);
      if (isNaN(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
        return { type: 'message', message: `Invalid day: "${rest}". Day of month 1-31.` };
      }
      if (!/^\d{1,2}:\d{2}$/.test(rest.slice(atIdx + 1))) {
        return { type: 'message', message: `Invalid time: "${rest}". Use D@H:MM (e.g., 1@6:00).` };
      }
      return {
        type: 'notification',
        notification: { type: 'heartbeat-set', key: 'HEARTBEAT_MONTHLY', value: rest },
      };
    }

    case 'dreaming': {
      if (!rest) {
        return {
          type: 'message',
          message: `Usage: /heartbeat dreaming <H:MM>\nExample: /heartbeat dreaming 2:00\nCurrent: ${ctx.settings.HEARTBEAT_DREAMING ?? '2:00'}`,
        };
      }
      if (!/^\d{1,2}:\d{2}$/.test(rest)) {
        return { type: 'message', message: `Invalid time: "${rest}". Use H:MM (e.g., 2:00, 14:30).` };
      }
      const [hStr, mStr] = rest.split(':');
      const h = parseInt(hStr ?? '0', 10);
      const m = parseInt(mStr ?? '0', 10);
      if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
        return { type: 'message', message: `Invalid time: "${rest}". Hour 0-23, minute 0-59.` };
      }
      return {
        type: 'notification',
        notification: { type: 'heartbeat-set', key: 'HEARTBEAT_DREAMING', value: rest },
      };
    }

    case 'now': {
      return { type: 'notification', notification: { type: 'heartbeat-now' } };
    }

    default:
      return {
        type: 'message',
        message: `Unknown heartbeat action: "${sub}". Use: status, enable, disable, intraday, daily, weekly, monthly, dreaming, now`,
      };
  }
}

function handleSnapshots(ctx: SlashCommandContext): SlashCommandResult {
  const list = ctx.listSnapshots?.(ctx.cwd);
  if (!list || list.length === 0) {
    return { type: 'message', message: 'No snapshots found for this directory.' };
  }
  const lines = [`Git Snapshots (${list.length}):`];
  list.forEach((s, i) => {
    const dt = new Date(s.timestamp);
    const timeStr = dt.toLocaleString();
    lines.push(`  ${i})-${timeStr} — ${s.sha.slice(0, 7)} (${s.label}, ${s.changedFiles} file${s.changedFiles === 1 ? '' : 's'})`);
  });
  lines.push('\nUse /revert <index> to restore a snapshot.');
  return { type: 'message', message: lines.join('\n') };
}

async function handleRevert(args: string, ctx: SlashCommandContext): Promise<SlashCommandResult> {
  if (!ctx.revertTo) {
    return { type: 'message', message: 'Snapshot revert is not available in this context.' };
  }

  const snapshots = ctx.listSnapshots?.(ctx.cwd) ?? [];
  if (snapshots.length === 0) {
    return { type: 'message', message: 'No snapshots found. Snapshots are created automatically in yolo mode.' };
  }

  // Parse index from args (default: 0 = most recent)
  const idx = args ? parseInt(args.trim(), 10) : 0;
  if (isNaN(idx) || idx < 0 || idx >= snapshots.length) {
    return {
      type: 'message',
      message: `Invalid index: ${args || '0'}. Choose 0-${snapshots.length - 1} (0 = most recent).\n${snapshots.map((s, i) => `  ${i}) ${s.sha.slice(0, 7)} — ${new Date(s.timestamp).toLocaleString()}`).join('\n')}`,
    };
  }

  const target = snapshots[idx];
  if (!target) {
    return { type: 'message', message: 'Snapshot not found.' };
  }
  const result = await ctx.revertTo(ctx.cwd, target.sha);
  if (result.success) {
    const files = target.changedFiles != null ? `${target.changedFiles} file${target.changedFiles === 1 ? '' : 's'} restored` : '';
    return { type: 'message', message: files ? `Reverted to snapshot ${target.sha.slice(0, 7)} (${target.label}) — ${files}` : `Reverted to snapshot ${target.sha.slice(0, 7)} (${target.label}).` };
  }
  return { type: 'message', message: result.error ?? 'Revert failed.' };
}
