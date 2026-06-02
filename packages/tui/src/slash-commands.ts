import type { CurieSettings } from '../../core/src/settings.js';
import { SettingsManager } from '../../core/src/settings.js';
import type { Message } from '../../core/src/turn-loop.js';
import type { TabId } from './tab-bar.js';
import { TaskManager, pickNextSchedule, scheduleLabel } from '@curie-agent/core';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Resolve the unified task file path for a scope. */
function resolveTaskPath(scope: 'personal' | 'project', cwd: string): string {
  if (scope === 'personal') return join(homedir(), '.curie-agent', 'tasks.json');
  return join(cwd, 'tasks.json');
}

/** Read tasks file; falls back to legacy todo.json. Returns null if neither exists. */
function readTaskJson(path: string): { $schema?: string; version?: number; tasks: Array<Record<string, unknown>> } | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(data.tasks)) return data as any;
    // Legacy format — check for plain array at root? No, legacy is {tasks: []} with no version/schema.
    return null;
  } catch { return null; }
}

/** Normalize a legacy task record (missing mode/scope) to UnifiedTask fields. */
function normalizeTaskRecord(t: Record<string, unknown>): Record<string, unknown> {
  if (!t.mode) t.mode = 'human';
  if (!t.scope) t.scope = 'personal';
  return t;
}

export interface SlashCommandContext {
  settings: CurieSettings;
  settingsMgr?: SettingsManager;
  version: string;
  model: string;
  provider: string;
  approvalMode: string;
  cwd: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Current context window token usage (after compaction). Falls back to inputTokens if not set. */
  contextWindowInputTokens?: number;
  contextWindowOutputTokens?: number;
  /** Message history for the current session (user, assistant, tool messages). */
  messages?: Message[];
  /** Channel message display data from the TUI (broader role set, includes tool-group and system). */
  channelMessages?: Array<{ role: string; content: string; title?: string }>;
 /** Unified task manager for task CRUD and scheduling. */
  taskManager?: TaskManager;
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
  /** List discovered skills (provided by CLI for /skill). */
  listSkills?: (cwd: string) => Array<{ name: string; description: string; source: string; filePath: string }>;
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
    key: 'heartbeat.intraday' | 'heartbeat.daily' | 'heartbeat.weekly' | 'heartbeat.monthly' | 'heartbeat.dreaming';
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
  category: string;
}


const THINKING_BUDGET_MAP: Record<string, number> = {
  low: 2_000,
  medium: 6_000,
  high: 16_000,
  max: 32_000,
  auto: 0,
};

export const SLASH_COMMANDS: SlashCommandDef[] = [
  // General
  { name: 'status', description: 'Show version, model, and account info', usage: '/status', category: 'General' },
  { name: 'help', description: 'Show all available commands', usage: '/help', category: 'General' },
  { name: 'init', description: 'Run the setup wizard', usage: '/init', category: 'General' },
  { name: 'exit', description: 'Exit curie-agent', usage: '/exit', category: 'General' },
  // Model & Provider
  { name: 'provider', description: 'Switch AI provider', usage: '/provider <anthropic|openai|google|local|ollama|openrouter>', category: 'Model & Provider' },
  { name: 'model', description: 'Switch AI model, set pricing or context window', usage: '/model <model|pricing in;out|window tokens>', category: 'Model & Provider' },
  { name: 'effort', description: 'Set reasoning effort level', usage: '/effort <low|medium|high|max|auto>', category: 'Model & Provider' },
  { name: 'mode', description: 'Set approval mode', usage: '/mode <plan|edit|auto|yolo>', category: 'Model & Provider' },
  // Display
  { name: 'theme', description: 'Change color theme', usage: '/theme <name>', category: 'Display' },
  { name: 'debug', description: 'Toggle debug logging', usage: '/debug [on|off]', category: 'Display' },
  { name: 'statusline', description: 'Toggle status line display', usage: '/statusline [on|off]', category: 'Display' },
  // Knowledge
  { name: 'memory', description: 'View memory file sizes or capture a memory', usage: '/memory [status|add]', category: 'Knowledge' },
  { name: 'todo', description: 'Manage tasks in todo.json', usage: '/todo <list|add|complete|remove>', category: 'Knowledge' },
  { name: 'stats', description: 'Daily usage, sessions, streaks', usage: '/stats', category: 'Knowledge' },
  { name: 'context', description: 'Visual grid showing context window usage, compaction, autocompaction', usage: '/context [auto|messages|compact [detailed|brief]]', category: 'Knowledge' },
  { name: 'wiki', description: 'Open the wiki tab or run a wiki operation', usage: '/wiki [list|search <query>|lint|status]', category: 'Knowledge' },
  // Automation
  { name: 'remind', description: 'Create a reminder', usage: '/remind <message at time>', category: 'Automation' },
  { name: 'cron', description: 'Manage reminders', usage: '/cron <list|delete|clear>', category: 'Automation' },
  { name: 'task', description: 'Schedule an agent task', usage: '/task <create|list|delete>', category: 'Automation' },
  { name: 'heartbeat', description: 'Manage heartbeat cycle', usage: '/heartbeat <status|enable|disable|intraday|daily|weekly|monthly|dreaming|now>', category: 'Automation' },
  // Tools
  { name: 'agent', description: 'Launch external AI agent', usage: '/agent <prompt>', category: 'Tools' },
  { name: 'tools', description: 'View/set tool call limits per turn', usage: '/tools [tools_per_call [websearch_per_call]]', category: 'Tools' },
  { name: 'websearch', description: 'View/set web search+fetch limit per turn', usage: '/websearch [count]', category: 'Tools' },
  { name: 'mcp', description: 'Manage MCP server connections', usage: '/mcp <list|add|remove|reload>', category: 'Tools' },
  { name: 'skill', description: 'List or show available skills', usage: '/skill [name]', category: 'Tools' },
  // Communication
  { name: 'channels', description: 'Manage Telegram channel config', usage: '/channels <list|set-bot-token|set-user-id|set-chat-id|disconnect>', category: 'Communication' },
  // Safety
  { name: 'snapshots', description: 'List recent git snapshots for recovery', usage: '/snapshots', category: 'Safety' },
  { name: 'revert', description: 'Revert to a git snapshot (index, default: most recent)', usage: '/revert [index]', category: 'Safety' },
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

    case 'todo':
      return handleTodo(args, ctx);

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

    case 'task':
      return handleTask(args, ctx);

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

    case 'skill':
      return handleSkill(args, ctx);

    default:
      return {
        type: 'message',
        message: `Unknown command: /${cmd}. Type /help for available commands.`,
      };
  }
}

function handleSkill(args: string, ctx: SlashCommandContext): SlashCommandResult {
  const listSkillsFn = ctx.listSkills;
  if (!listSkillsFn) {
    return { type: 'message', message: 'Skills discovery is not available in this context.' };
  }

  const skills = listSkillsFn(ctx.cwd);

  if (!args.trim()) {
    if (skills.length === 0) {
      return {
        type: 'message',
        message: [
          'No skills found.',
          '',
          'Skills are SKILL.md files in:',
          '  ~/.curie-agent/skills/         (global)',
          '  <cwd>/.curie-agent/skills/  (project)',
          '',
          'Directory format: skill-name/SKILL.md',
          'Flat format:      skill-name-SKILL.md',
        ].join('\n'),
      };
    }
    const lines = [`Available Skills (${skills.length}):`];
    for (const s of skills) {
      const source = s.source === 'project' ? '[project]' : '[global]';
      const desc = s.description.length > 80 ? s.description.slice(0, 77) + '...' : s.description;
      lines.push(`  ${s.name} ${source}`);
      lines.push(`    ${desc}`);
    }
    lines.push('');
    lines.push('Use /skill <name> to see full details.');
    return { type: 'message', message: lines.join('\n') };
  }

  const name = args.trim().toLowerCase();
  const skill = skills.find(s => s.name.toLowerCase() === name);
  if (!skill) {
    const available = skills.map(s => s.name).join(', ');
    return { type: 'message', message: `Skill "${name}" not found. Available: ${available}` };
  }

  try {
    const content = readFileSync(skill.filePath, 'utf-8');
    const bodyStart = content.indexOf('---', 3);
    const body = bodyStart > 0 ? content.slice(bodyStart + 3).trim() : content;
    return {
      type: 'message',
      message: [
        `## ${skill.name} (${skill.source})`,
        `Description: ${skill.description}`,
        `Source: ${skill.filePath}`,
        '',
        '---',
        body,
      ].join('\n'),
    };
  } catch {
    return { type: 'message', message: `Could not read skill file: ${skill.filePath}` };
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
  const toolsPerCall = ctx.settings.tools_per_call ?? 10;
  const websearchPerCall = ctx.settings.websearch_per_call ?? 5;
  const modelCost = ctx.settings.providers?.[ctx.settings.current_provider as keyof typeof ctx.settings.providers]?.model_cost;
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
    modelCost
      ? formatPricingDisplay(modelCost)
      : null,
  ].filter(Boolean);
  return { type: 'message', message: lines.join('\n') };
}

function handleHelp(): SlashCommandResult {
  const lines: string[] = [];

  // Group by category
  const groups: Record<string, SlashCommandDef[]> = {};
  for (const cmd of SLASH_COMMANDS) {
    if (!groups[cmd.category]) groups[cmd.category] = [];
    groups[cmd.category]!.push(cmd);
  }

  // Calculate column width per group
  const colWidth: Record<string, number> = {};
  for (const [cat, cmds] of Object.entries(groups)) {
    colWidth[cat] = Math.min(
      Math.max(...cmds.map((c) => c.usage.length)) + 4,
      40,
    );
  }

  for (const [cat, cmds] of Object.entries(groups)) {
    if (lines.length > 0) lines.push('');
    lines.push(cat);
    const w = colWidth[cat]!;
    for (const cmd of cmds) {
      lines.push(`  ${cmd.usage.padEnd(w)} ${cmd.description}`);
    }
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
  const WINDOW_DEFAULT = 200_000;
  const getModelCost = (s?: CurieSettings) => s?.providers?.[s.current_provider as keyof typeof s.providers]?.model_cost;
  const getWindow = (s?: CurieSettings) => s?.providers?.[s.current_provider as keyof typeof s.providers]?.model_context_window;

  if (!args) {
    const cost = getModelCost(settings) ?? '(not set)';
    const window = getWindow(settings) ?? WINDOW_DEFAULT;
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
        const cost = getModelCost(settings) ?? '(not set)';
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
        const window = getWindow(settings) ?? WINDOW_DEFAULT;
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
      message: 'Usage: /remind <message at time>\nExample: /remind "tomorrow at 7am make breakfast"\nOr use /todo notify add "..." for the unified format.',
    };
  }

  const { parseReminderTime }: { parseReminderTime?: (input: string) => { message: string; scheduledAt: number } | null } = {} as any;
  try {
    Object.assign(require('../../core/src/reminder-parser.js'), { parseReminderTime });
  } catch { /* module not available */ }

  if (!parseReminderTime) {
    return { type: 'message', message: `Could not parse time from: "${args}".\nUse /todo notify add "tomorrow at 7am make breakfast"` };
  }

  const parsed = parseReminderTime(args);
  if (!parsed) {
    return { type: 'message', message: `Could not parse time from: "${args}".\nUse /todo notify add "tomorrow at 7am make breakfast"` };
  }

  if (ctx.taskManager) {
    ctx.taskManager.load();
    const task = ctx.taskManager.create({ title: parsed.message, mode: 'notify', scope: 'personal', scheduled_at: parsed.scheduledAt });
    return { type: 'message', message: `Reminder set:\nTime: ${new Date(task.scheduled_at!).toLocaleString()}\nMessage: ${task.title}\nID: ${task.id}` };
  }

  return { type: 'message', message: 'Reminder service not available. Please restart the application.' };
}

function handleCron(args: string, ctx: SlashCommandContext): SlashCommandResult {
  // /cron is an alias for viewing notify-mode tasks in the unified store.

  const parts = args.trim().split(/\s+/);
  const action = parts[0]?.toLowerCase();
  const rest = parts.slice(1).join(' ').trim();

  if (!ctx.taskManager) {
    return { type: 'message', message: 'Task service not available. Please restart the application.' };
  }

  ctx.taskManager.load();

  switch (action) {
    case 'list': {
      const allTasks = ctx.taskManager.list({ mode: 'notify' });
      if (allTasks.length === 0) return { type: 'message', message: 'No scheduled reminders.\nUse /todo notify add "..." to create one.' };
      const lines = [`Reminders (${allTasks.length}):`];
      for (const t of allTasks.sort((a, b) => Number(a.scheduled_at ?? 0) - Number(b.scheduled_at ?? 0))) {
        const timeStr = t.scheduled_at ? new Date(t.scheduled_at).toLocaleString() : '—';
        lines.push(`  ${t.status} ${t.title}\n    Time: ${timeStr}\n    ID: ${t.id.slice(0, 8)}`);
      }
      return { type: 'message', message: lines.join('\n') };
    }

    case 'delete': {
      if (!rest) return { type: 'message', message: 'Usage: /cron delete <id>\nExample: /cron delete abc-123' };
      const result = ctx.taskManager.cancelTask(rest);
      if (result) return { type: 'message', message: 'Reminder cancelled.' };
      return { type: 'message', message: `No reminder found with ID: ${rest}` };
    }

    case 'clear': {
      const removed = ctx.taskManager.clearCompleted();
      return { type: 'message', message: `Cleared ${removed} completed task(s).` };
    }

    default:
      return handleTodo('list personal', ctx);
  }
}

function handleChannels(args: string, ctx: SlashCommandContext): SlashCommandResult {
  const parts = args.trim().split(/\s+/);
  const sub = parts[0]?.toLowerCase();
  const rest = parts.slice(1).join(' ').trim();

  switch (sub) {
    case 'list': {
      const token = ctx.settings.channels?.bot_token;
      const userId = ctx.settings.channels?.user_id;
      const chatId = ctx.settings.channels?.chat_id;
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
    const raw = ctx.settings.mcp_servers as string | Record<string, unknown> | undefined;
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
      ctx.settings.mcp_servers = configs;

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
          ctx.settings.mcp_servers = configs;
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
  const toolsPerCall = settings.tools_per_call ?? 10;
  const websearchPerCall = settings.websearch_per_call ?? 5;

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
  const websearchPerCall = settings.websearch_per_call ?? 5;

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

/**
 * Parse /todo args: "/todo [scope:]add|list|complete|cancel|start|remove [title|id]"
 * Optionally with mode keywords: "auto/add", "notify/add"
 */
function parseTodoArgs(args: string): { scope: 'personal' | 'project'; action: string; titleOrId: string } {
  const parts = args.trim().split(/\s+/);
  if (!parts.length) return { scope: 'project', action: '', titleOrId: '' };

  let scope: 'personal' | 'project' = 'project';
  let action = '';
  let idx = 0;

  // First token: scope, mode keyword, or action
  const first = parts[0]!.toLowerCase();
  if (first === 'personal' || first === 'project') {
    scope = first;
    idx = 1;
  } else if (first === 'auto' || first === 'notify') {
    // mode keyword: /todo auto add ..., /todo notify list ...
    idx = 1;
  }

  // Second token: action or scope fallback
  const second = parts[idx]?.toLowerCase() ?? '';
  const actions = ['list', 'add', 'complete', 'cancel', 'start', 'remove'];
  if (actions.includes(second)) {
    action = second;
    idx++;
  } else if (first === 'personal' || first === 'project') {
    // no scope given — second token is the action, third is the content
    if (actions.includes(second)) action = second;
    idx += actions.includes(second) ? 1 : 0;
  }

  const titleOrId = parts.slice(idx).join(' ').trim();
  return { scope, action, titleOrId };
}

/** Result shape from reading a tasks file. */
interface TasksData {
  $schema?: string;
  version?: number;
  tasks: Array<Record<string, unknown>>;
}

/** Helper to read a tasks file (unified format), falls back to legacy todo.json. */
function readTasksAtPath(path: string): TasksData | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (Array.isArray(parsed.tasks)) return { tasks: parsed.tasks as Array<Record<string, unknown>> };
    return null;
  } catch { return null; }
}

/** Write a task record to file (unified format). */
function writeTaskToFile(filePath: string, taskRecord: Record<string, unknown>): void {
  let data = readTasksAtPath(filePath);
  if (!data) {
    data = { tasks: [] };
  }

  // Update/insert the task
  const idx = data.tasks.findIndex((t: Record<string, unknown>) => t.id === taskRecord.id);
  if (idx >= 0) {
    data.tasks[idx] = taskRecord;
  } else {
    data.tasks.push(taskRecord);
  }

  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/** Remove a task from file by ID. */
function removeTaskFromFile(filePath: string, id: string): boolean {
  if (!existsSync(filePath)) return false;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const tasks = parsed.tasks as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(tasks)) return false;
    for (const t of tasks) normalizeTaskRecord(t);
    const idx = tasks.findIndex((t: Record<string, unknown>) => t.id === id);
    if (idx === -1) return false;
    tasks.splice(idx, 1);
    tasks.forEach((t, i) => { t.order = i; });
    parsed.tasks = tasks;
    writeFileSync(filePath, JSON.stringify(parsed, null, 2), 'utf-8');
    return true;
  } catch { return false; }
}

/** Normalize and return the active+done task counts from a TasksData. */
function getTaskCounts(tasks: Array<Record<string, unknown>>): { active: number; done: number } {
  const active = tasks.filter((t) => !['done', 'canceled'].includes(String(t.status ?? '')));
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  return { active: active.length, done: doneCount };
}

function handleTodo(args: string, ctx: SlashCommandContext): SlashCommandResult {
  const parsed = parseTodoArgs(args);
  const { scope, action, titleOrId } = parsed;
  const path = resolveTaskPath(scope, ctx.cwd);

  // Support both unified tasks.json and legacy todo.json
  const fullPath = existsSync(path) ? path : (scope === 'personal'
    ? join(homedir(), '.curie-agent', 'todo.json')
    : join(ctx.cwd, 'todo.json'));

  switch (action) {
    case 'list': {
      const data = readTasksAtPath(fullPath);
      if (!data || !data.tasks.length) {
        return { type: 'message', message: `No tasks in ${scope}.` };
      }

      // Normalize and filter
      const normalizedTasks = (data.tasks as unknown[]).map((t: unknown) => normalizeTaskRecord(t as Record<string, unknown>)) as Array<Record<string, unknown>>;
      let tasks = normalizedTasks;
      const active = tasks.filter((t) => !['done', 'canceled'].includes(String(t.status ?? '')));
      const done = tasks.filter((t) => t.status === 'done');

      // Auto-detect mode from title (for user convenience)
      const lower = args.toLowerCase();
      const hasModeKeyword = /auto/.test(lower) || /notify/.test(lower);

     const lines = [`Tasks (${scope}) — ${active.length} active, ${done.length} done:`];
      for (const t of active.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))) {
        const icon = String(t.status) === 'in_progress' ? '[*]' : '-';
        const prio = (t.priority !== 'medium' && t.priority) ? ` [${t.priority}]` : '';
        const modeCol = t.mode ? `[${String(t.mode).toUpperCase()}]` : '[MANUAL]';
        const scheduledAt = typeof t.scheduled_at === 'number' ? t.scheduled_at : undefined;
        const timeStr = scheduledAt ? ` (at ${new Date(scheduledAt).toLocaleString()})` : '';
        lines.push(`  ${icon} ${String(t.id).slice(0, 8)} ${modeCol}${prio} ${t.title}${timeStr}`);
      }
      return { type: 'message', message: lines.join('\n') };
    }

    case 'add': {
      if (!titleOrId) {
        return {
          type: 'message',
          message: `Usage: /todo add <title>\nExample: /todo add "Finish the report"\n  /todo agent add "build at 3pm"     — agent executes it\n  /todo notify add "remind about X" — notification only`,
        };
      }

      // Detect mode from keyword or natural language time parsing
      let mode: 'human' | 'agent' | 'notify' = 'human';
      const lower = titleOrId.toLowerCase();

      if (lower.startsWith('at ') || /\bat\b/.test(lower)) {
        // Has time reference — try to parse with TaskManager
        const taskMgr = ctx.taskManager;
        let instruction: string;

        // Check if "agent" was explicitly requested
        if (/^agent\s+add\s*/i.test(args) || /^agent\b/.test(args)) {
          mode = 'agent';
        } else if (/^notify\s+add\s*/i.test(args) || /notify\s+/i.test(args)) {
          mode = 'notify';
        }

        const timeKeywordPattern = /^(agent|notify)\s*add\s*/i;
        instruction = titleOrId.replace(timeKeywordPattern, '');

        if (!instruction) {
          return { type: 'message', message: 'Usage: /todo add <title>\n  /todo agent add "build at 3pm"\n  /todo notify add "remind about X"' };
        }

        // Try natural language time parsing
        let { parseReminderTime }: { parseReminderTime?: (input: string) => { message: string; scheduledAt: number } | null } = {} as any;
        try {
          parseReminderTime = require('../../core/src/reminder-parser.js').parseReminderTime;
        } catch { /* module not available */ }

        if (mode === 'human' && parseReminderTime) {
          const parsed = parseReminderTime(instruction);
          if (parsed) {
            instruction = parsed.message;
            if (taskMgr) {
              taskMgr.load();
              taskMgr.create({ title: instruction, mode: 'agent', scope: 'personal', scheduled_at: parsed.scheduledAt });
              const timeStr = new Date(parsed.scheduledAt).toLocaleString();
              return { type: 'message', message: `Task scheduled:\nTime: ${timeStr}\nInstruction: ${instruction}` };
            }
          }
        }

        if (mode === 'notify' && parseReminderTime) {
          const parsed = parseReminderTime(instruction);
          if (parsed && taskMgr) {
            taskMgr.load();
            const task = taskMgr.create({ title: parsed.message, mode: 'notify', scope: 'personal', scheduled_at: parsed.scheduledAt });
            const timeStr = new Date(task.scheduled_at!).toLocaleString();
            return { type: 'message', message: `Reminder scheduled:\nTime: ${timeStr}\nMessage: ${parsed.message}` };
          }
        }

        if (mode === 'agent' && parseReminderTime) {
          const parsed = parseReminderTime(instruction);
          if (parsed && taskMgr) {
            taskMgr.load();
            const task = taskMgr.create({ title: parsed.message, mode: 'agent', scope: 'personal', scheduled_at: parsed.scheduledAt });
            const timeStr = new Date(task.scheduled_at!).toLocaleString();
            return { type: 'message', message: `Scheduled task:\nTime: ${timeStr}\nInstruction: ${parsed.message}` };
          }
        }

        // No time could be parsed — fall through to manual mode
      } else if (/^agent\s+add\s*/i.test(args) || /^agent\b/.test(args)) {
        mode = 'agent';
      } else if (/^notify\s+add\s*/i.test(args) || /notify\s+/i.test(args)) {
        mode = 'notify';
      }

      const title = (mode === 'human' ? titleOrId : titleOrId.replace(/^(agent|notify)\s+add\s*/i, '').trim()) || titleOrId;
      if (!title) return { type: 'message', message: `Usage: /todo add <title>\nExample: /todo add "Finish the report"` };

      let data = readTasksAtPath(fullPath);
      if (!data) {
        data = { $schema: 'tasks.schema.json', version: 1, tasks: [] };
      }
      data.tasks = (data.tasks as unknown[]).map((t: unknown) => normalizeTaskRecord(t as Record<string, unknown>));

      const id = crypto.randomUUID();
      const task: Record<string, unknown> = {
        id,
        title,
        description: '',
        status: 'todo',
        priority: 'medium',
        tags: [],
        order: data.tasks.length,
        created_at: new Date().toISOString(),
        completed_at: null,
      };
      // Add mode and scope fields
      task.mode = mode;
      task.scope = scope;

      data.tasks.push(task);
      writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf-8');

      const modePrefix = mode === 'human' ? '' : `[${mode}] `;
      return { type: 'message', message: `${modePrefix}Added task: "${title}" (ID: ${id.slice(0, 8)})` };
    }

    case 'complete': {
      if (!titleOrId) return { type: 'message', message: 'Usage: /todo complete <id>' };
      let data = readTasksAtPath(fullPath);
      if (!data) return { type: 'message', message: 'No tasks found.' };
      data.tasks = (data.tasks as unknown[]).map((t: unknown) => normalizeTaskRecord(t as Record<string, unknown>));

      const idx = data.tasks.findIndex((t: Record<string, unknown>) => String(t.id) === titleOrId || String(t.id).startsWith(titleOrId));
      if (idx === -1) return { type: 'message', message: `Task not found: ${titleOrId}` };
      data.tasks[idx]!.status = 'done';
      data.tasks[idx]!.completed_at = new Date().toISOString();
      writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf-8');
      return { type: 'message', message: `Completed: "${data.tasks[idx]!.title}"` };
    }

    case 'cancel': {
      if (!titleOrId) return { type: 'message', message: 'Usage: /todo cancel <id>' };
      let data = readTasksAtPath(fullPath);
      if (!data) return { type: 'message', message: 'No tasks found.' };
      data.tasks = (data.tasks as unknown[]).map((t: unknown) => normalizeTaskRecord(t as Record<string, unknown>));

      const idx = data.tasks.findIndex((t: Record<string, unknown>) => String(t.id) === titleOrId || String(t.id).startsWith(titleOrId));
      if (idx === -1) return { type: 'message', message: `Task not found: ${titleOrId}` };
      data.tasks[idx]!.status = 'canceled';
      writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf-8');
      return { type: 'message', message: `Canceled: "${data.tasks[idx]!.title}"` };
    }

    case 'start': {
      if (!titleOrId) return { type: 'message', message: 'Usage: /todo start <id>' };
      let data = readTasksAtPath(fullPath);
      if (!data) return { type: 'message', message: 'No tasks found.' };
      data.tasks = (data.tasks as unknown[]).map((t: unknown) => normalizeTaskRecord(t as Record<string, unknown>));

      const idx = data.tasks.findIndex((t: Record<string, unknown>) => String(t.id) === titleOrId || String(t.id).startsWith(titleOrId));
      if (idx === -1) return { type: 'message', message: `Task not found: ${titleOrId}` };
      data.tasks[idx]!.status = 'in_progress';
      writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf-8');
      return { type: 'message', message: `Started: "${data.tasks[idx]!.title}"` };
    }

    case 'remove': {
      if (!titleOrId) return { type: 'message', message: 'Usage: /todo remove <id>' };
      if (removeTaskFromFile(fullPath, titleOrId)) {
        return { type: 'message', message: `Removed task: ${titleOrId.slice(0, 8)}` };
      }
      return { type: 'message', message: `Task not found: ${titleOrId}` };
    }

    default: {
      if (!action) {
        return {
          type: 'message',
          message: 'Task commands:\n  /todo list [personal|project]      — List tasks\n  /todo add <title>                   — Add a manual task\n  /todo auto add "X at Y"             — Agent executes X at Y\n  /todo notify add "remind about X"   — Notification only\n  /todo complete <id>                 — Mark done\n  /todo cancel <id>                   — Cancel a task\n  /todo start <id>                    — Start working on it\n  /todo remove <id>                   — Delete permanently',
        };
      }
      return { type: 'message', message: `Unknown todo action: "${action}". Use: list, add, complete, cancel, start, remove` };
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
      : msg.role === 'task' ? 'Task'
      : msg.role === 'debug' ? 'Debug'
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
      message: `Compacting conversation (${loopMsgs.length} messages)... This will use one AI turn to summarize your session. The agent will continue automatically.`,
    };
  }

  // /context auto — autocompaction settings and controls
  if (sub && (sub === 'auto' || sub.startsWith('auto '))) {
    const parts = sub.split(/\s+/);
    const action = parts[0]?.toLowerCase() ?? 'auto';
    const arg1 = parts[1]?.toLowerCase();
    const arg2 = parts[2];
    const s = ctx.settings;

    if (action === 'auto' && !arg1) {
      // Show current settings
      const lines = [
        'Autocompaction Settings:',
        `  Enabled: ${s.auto_compact?.enabled ?? 'on'}`,
        `  Context fill threshold: ${s.auto_compact?.threshold ?? 75}%`,
        `  Warning threshold: ${s.auto_compact?.warn_threshold ?? 60}%`,
        `  Forced compaction threshold: ${s.auto_compact?.forced_threshold ?? 85}%`,
        `  Pricing tier warning: ${s.pricing_tier_warn ?? 'on'}`,
        '',
        'Usage:',
        '  /context auto on/off         — enable or disable autocompaction',
        '  /context auto threshold <N>   — set compaction threshold (%)',
        '  /context auto warn <N>        — set warning threshold (%)',
        '  /context auto pricing on/off  — enable/disable pricing tier warnings',
      ];
      return { type: 'message', message: lines.join('\n') };
    }

    if (arg1 === 'on') {
      ctx.settingsMgr?.update({ auto_compact: { ...s.auto_compact, enabled: 'on' } });
      return { type: 'message', message: 'Autocompaction enabled.' };
    }

    if (arg1 === 'off') {
      ctx.settingsMgr?.update({ auto_compact: { ...s.auto_compact, enabled: 'off' } });
      return { type: 'message', message: 'Autocompaction disabled.' };
    }

    if (arg1 === 'threshold' && arg2) {
      const pct = parseInt(arg2, 10);
      if (isNaN(pct) || pct < 10 || pct > 99) {
        return { type: 'message', message: 'Invalid threshold. Use a value between 10 and 99.' };
      }
      ctx.settingsMgr?.update({ auto_compact: { ...s.auto_compact, threshold: pct } });
      return { type: 'message', message: `Compaction threshold set to ${pct}%.` };
    }

    if (arg1 === 'warn' && arg2) {
      const pct = parseInt(arg2, 10);
      if (isNaN(pct) || pct < 5 || pct > 95) {
        return { type: 'message', message: 'Invalid warning threshold. Use a value between 5 and 95.' };
      }
      ctx.settingsMgr?.update({ auto_compact: { ...s.auto_compact, warn_threshold: pct } });
      return { type: 'message', message: `Warning threshold set to ${pct}%.` };
    }

    if (arg1 === 'pricing') {
      if (arg2 === 'on') {
        ctx.settingsMgr?.update({ pricing_tier_warn: 'on' });
        return { type: 'message', message: 'Pricing tier warnings enabled.' };
      }
      if (arg2 === 'off') {
        ctx.settingsMgr?.update({ pricing_tier_warn: 'off' });
        return { type: 'message', message: 'Pricing tier warnings disabled.' };
      }
      return { type: 'message', message: 'Usage: /context auto pricing on/off' };
    }

    return { type: 'message', message: 'Usage: /context auto [on|off|threshold N|warn N|pricing on/off]\nRun "/context auto" without arguments to see current settings.' };
  }

  // Default: context window visual (unchanged behavior)
  const input = ctx.contextWindowInputTokens ?? ctx.inputTokens ?? 0;
  const output = ctx.contextWindowOutputTokens ?? ctx.outputTokens ?? 0;
  const model = ctx.model || 'unknown';
  const windowSize = ctx.settings.providers?.[ctx.settings.current_provider as keyof typeof ctx.settings.providers]?.model_context_window ?? ctx.contextWindowSize ?? 200_000;
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
      message: `Usage: /provider <name>\nProviders: ${validProviders.join(', ')}\n\nCurrent settings:\n  anthropic: providers.anthropic.api_key, providers.anthropic.url\n  openai: providers.openai.api_key, providers.openai.url\n  google: providers.google.api_key, providers.google.url\n  local: providers.local.url, providers.local.api_key\n  ollama: providers.ollama.url, providers.ollama.api_key\n  openrouter: providers.openrouter.api_key, providers.openrouter.url`,
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
      const active = ctx.settings.heartbeat?.schedule === 'on';
      const intraday = ctx.settings.heartbeat?.intraday ?? '';
      const daily = ctx.settings.heartbeat?.daily ?? '6:00';
      const weekly = ctx.settings.heartbeat?.weekly ?? 'monday@6:00';
      const monthly = ctx.settings.heartbeat?.monthly ?? '1@6:00';
      const dreaming = ctx.settings.heartbeat?.dreaming ?? '2:00';
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
        const current = ctx.settings.heartbeat?.intraday ?? '';
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
        notification: { type: 'heartbeat-set', key: 'heartbeat.intraday', value },
      };
    }

    case 'daily': {
      if (!rest) {
        return {
          type: 'message',
          message: `Usage: /heartbeat daily <H:MM>\nExample: /heartbeat daily 6:00\nCurrent: ${ctx.settings.heartbeat?.daily ?? '6:00'}`,
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
        notification: { type: 'heartbeat-set', key: 'heartbeat.daily', value: rest },
      };
    }

    case 'weekly': {
      if (!rest) {
        return {
          type: 'message',
          message: `Usage: /heartbeat weekly <day@H:MM>\nExample: /heartbeat weekly monday@6:00\nCurrent: ${ctx.settings.heartbeat?.weekly ?? 'monday@6:00'}`,
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
        notification: { type: 'heartbeat-set', key: 'heartbeat.weekly', value: rest },
      };
    }

    case 'monthly': {
      if (!rest) {
        return {
          type: 'message',
          message: `Usage: /heartbeat monthly <D@H:MM>\nExample: /heartbeat monthly 1@6:00\nCurrent: ${ctx.settings.heartbeat?.monthly ?? '1@6:00'}`,
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
        notification: { type: 'heartbeat-set', key: 'heartbeat.monthly', value: rest },
      };
    }

    case 'dreaming': {
      if (!rest) {
        return {
          type: 'message',
          message: `Usage: /heartbeat dreaming <H:MM>\nExample: /heartbeat dreaming 2:00\nCurrent: ${ctx.settings.heartbeat?.dreaming ?? '2:00'}`,
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
        notification: { type: 'heartbeat-set', key: 'heartbeat.dreaming', value: rest },
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

function handleTask(args: string, ctx: SlashCommandContext): SlashCommandResult {
  // /task creates auto-mode scheduled tasks (LLM executes at given time).
  // Uses unified TaskManager.

  const parts = args.trim().split(/\s+/);
  const action = parts[0]?.toLowerCase();
  const rest = parts.slice(1).join(' ').trim();

  if (!ctx.taskManager) {
    return { type: 'message', message: 'Task service not available. Please restart the application.' };
  }

  switch (action) {
    case 'create': {
      if (!rest) {
        return {
          type: 'message',
          message: 'Usage: /task create <instruction at time>\nExample:\n  /task create "at 7:55 make a report about AI models"\nOr use /todo agent add "..." for the new unified format.',
        };
      }

      let { parseReminderTime }: { parseReminderTime?: (input: string) => { message: string; scheduledAt: number } | null } = {} as any;
      try { Object.assign(require('../../core/src/reminder-parser.js'), { parseReminderTime }); } catch { /* not available */ }

      if (!parseReminderTime) {
        return { type: 'message', message: `Could not parse time from: "${rest}".\nTry: /todo agent add "at 7:55 do something"` };
      }

      const parsed = parseReminderTime(rest);
      if (!parsed) {
        return { type: 'message', message: `Could not parse time from: "${rest}".\nUse /todo agent add "instruction at time"` };
      }

      ctx.taskManager.load();
      const task = ctx.taskManager.create({ title: parsed.message, mode: 'agent', scope: 'personal', scheduled_at: parsed.scheduledAt });
      return { type: 'message', message: `Task scheduled:\nTime: ${new Date(task.scheduled_at!).toLocaleString()}\nInstruction: ${task.title}\nID: ${task.id}` };
    }

    case 'list': {
      ctx.taskManager.load();
      const tasks = ctx.taskManager.list({ mode: 'agent' });
      if (!tasks.length) return { type: 'message', message: 'No scheduled tasks.\nUse /todo agent add "..." to create one.' };
      const lines = [`Tasks (${tasks.length}):`];
      for (const t of tasks) {
        const timeStr = t.scheduled_at ? new Date(t.scheduled_at).toLocaleString() : '—';
        const statusLabel = t.status === 'pending' ? 'PENDING' : t.status === 'executing' ? 'RUNNING' : t.status.toUpperCase();
        lines.push(`  [${statusLabel}] ${t.title}\n    Time: ${timeStr}\n    ID: ${t.id.slice(0, 8)}`);
      }
      return { type: 'message', message: lines.join('\n') };
    }

    case 'delete': {
      if (!rest) return { type: 'message', message: 'Usage: /task delete <id>' };
      const result = ctx.taskManager.cancelTask(rest);
      if (result) return { type: 'message', message: 'Task cancelled.' };
      return { type: 'message', message: `No task found with ID: ${rest}` };
    }

    default:
      return {
        type: 'message',
        message: 'Usage: /task <create|list|delete>\n  create <instruction at time>  — Schedule a task\n  list                          — List scheduled tasks\n  delete <id>                   — Cancel a task\nOr use /todo auto add "..." for the new unified format.',
      };
  }
}
