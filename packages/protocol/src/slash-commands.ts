/**
 * Shared slash-command registry.
 *
 * This is the single source of truth for which slash commands exist, what they
 * do, and — critically — *which surface executes them*. It lives in `protocol`
 * (a no-deps package) so both the TUI client (`@curie-agent/cli`) and the
 * daemon (`@curie-agent/daemon`) can import it. Previously each maintained its
 * own list and they drifted: 12 commands printed "Unknown command" in the TUI
 * despite being implemented in the daemon.
 */

/**
 * Where a command runs.
 *
 * - `daemon` — forwarded verbatim to `executeSlashCommand`; output streams back
 *   as `assistant-delta` events. The default for anything touching settings,
 *   the filesystem, or scheduling.
 * - `client` — needs terminal/React state that only the UI process has (theme
 *   repaint, tab switching, process exit, interactive wizards).
 */
export type SlashCommandHandler = 'client' | 'daemon';

export interface SlashCommandDef {
  name: string;
  description: string;
  usage: string;
  category: string;
  handler: SlashCommandHandler;
  /** Alternate names that dispatch to this same command. */
  aliases?: string[];
}

export const SLASH_COMMANDS: SlashCommandDef[] = [
  // General
  { name: 'status', description: 'Show version, model, and account info', usage: '/status', category: 'General', handler: 'daemon' },
  { name: 'help', description: 'Show all available commands', usage: '/help', category: 'General', handler: 'daemon' },
  { name: 'system', description: 'Show OS, platform, Node version, and PathGuard status', usage: '/system', category: 'General', handler: 'daemon' },
  { name: 'init', description: 'Run the setup wizard', usage: '/init', category: 'General', handler: 'client' },
  { name: 'exit', description: 'Exit curie-agent', usage: '/exit', category: 'General', handler: 'client', aliases: ['quit'] },
  // Model & Provider
  { name: 'provider', description: 'Switch AI provider', usage: '/provider <anthropic|openai|google|local|ollama|openrouter>', category: 'Model & Provider', handler: 'daemon' },
  { name: 'model', description: 'Switch AI model, set pricing or context window', usage: '/model <model|pricing in;out|window tokens>', category: 'Model & Provider', handler: 'daemon' },
  { name: 'effort', description: 'Set reasoning effort level', usage: '/effort <low|medium|high|max|auto>', category: 'Model & Provider', handler: 'daemon' },
  { name: 'mode', description: 'Set approval mode', usage: '/mode <plan|edit|auto|yolo>', category: 'Model & Provider', handler: 'daemon' },
  // Display
  { name: 'theme', description: 'Change color theme', usage: '/theme <name>', category: 'Display', handler: 'client' },
  { name: 'debug', description: 'Toggle debug logging', usage: '/debug [on|off]', category: 'Display', handler: 'client' },
  { name: 'statusline', description: 'Toggle status line display', usage: '/statusline [on|off]', category: 'Display', handler: 'client' },
  // Knowledge
  { name: 'memory', description: 'View memory file sizes or capture a memory', usage: '/memory [status|add <text>]', category: 'Knowledge', handler: 'daemon' },
  { name: 'todo', description: 'Manage tasks in tasks.json', usage: '/todo <list|add|complete|remove>', category: 'Knowledge', handler: 'daemon' },
  { name: 'stats', description: 'Daily usage, sessions, streaks', usage: '/stats', category: 'Knowledge', handler: 'client' },
  { name: 'context', description: 'Visual grid showing context window usage, compaction, autocompaction', usage: '/context [auto|messages|compact [detailed|brief]]', category: 'Knowledge', handler: 'daemon' },
  { name: 'wiki', description: 'Open the wiki tab or run a wiki operation', usage: '/wiki [list|search <query>|lint|status]', category: 'Knowledge', handler: 'client' },
  // Automation
  { name: 'remind', description: 'Create a reminder', usage: '/remind <message at time>', category: 'Automation', handler: 'daemon' },
  { name: 'cron', description: 'Manage reminders', usage: '/cron <list|delete <id>|clear>', category: 'Automation', handler: 'daemon' },
  { name: 'task', description: 'Schedule an agent task', usage: '/task <create|list|delete>', category: 'Automation', handler: 'daemon' },
  { name: 'heartbeat', description: 'Manage heartbeat cycle', usage: '/heartbeat <status|enable|disable|intraday|daily|weekly|monthly|dreaming|now>', category: 'Automation', handler: 'daemon' },
  // Tools
  { name: 'agent', description: 'Launch external AI agent', usage: '/agent <prompt>', category: 'Tools', handler: 'daemon' },
  { name: 'tools', description: 'View/set tool call limits per turn', usage: '/tools [tools_per_call [websearch_per_call]]', category: 'Tools', handler: 'daemon' },
  { name: 'websearch', description: 'View/set web search+fetch limit per turn', usage: '/websearch [count]', category: 'Tools', handler: 'daemon' },
  { name: 'mcp', description: 'Manage MCP server connections', usage: '/mcp <list|reload>', category: 'Tools', handler: 'daemon' },
  { name: 'skill', description: 'List or show available skills', usage: '/skill [name]', category: 'Tools', handler: 'daemon' },
  // Communication
  { name: 'channels', description: 'Manage Telegram channel config', usage: '/channels <list|switch <id>|set-bot-token <t>|set-user-id <id>|set-chat-id <id>|disconnect>', category: 'Communication', handler: 'client' },
  // Workspace & Safety
  { name: 'cd', description: 'Change working directory with safety checks', usage: '/cd <path>', category: 'Safety', handler: 'daemon' },
  { name: 'snapshots', description: 'List recent git snapshots for recovery', usage: '/snapshots', category: 'Safety', handler: 'daemon' },
  { name: 'revert', description: 'Revert to a git snapshot (index, default: most recent)', usage: '/revert [index]', category: 'Safety', handler: 'daemon' },
];

/** Canonical command order for grouped display, so /help is stable. */
export const SLASH_COMMAND_CATEGORIES: string[] = [
  'General',
  'Model & Provider',
  'Display',
  'Knowledge',
  'Automation',
  'Tools',
  'Communication',
  'Safety',
];

/**
 * Resolve a typed command name (or alias) to its registry entry.
 * Returns undefined for unknown commands.
 */
export function findSlashCommand(name: string): SlashCommandDef | undefined {
  const lower = name.toLowerCase();
  return SLASH_COMMANDS.find(
    c => c.name === lower || c.aliases?.includes(lower) === true,
  );
}

/** Every accepted command token, including aliases. */
export function allSlashCommandNames(): string[] {
  return SLASH_COMMANDS.flatMap(c => [c.name, ...(c.aliases ?? [])]);
}

/**
 * Render the registry as markdown. Used by the daemon's `/help` so the help
 * text can never drift from the registry again.
 */
export function renderSlashCommandHelp(): string {
  const lines: string[] = ['### Available Slash Commands'];
  for (const category of SLASH_COMMAND_CATEGORIES) {
    const cmds = SLASH_COMMANDS.filter(c => c.category === category);
    if (cmds.length === 0) continue;
    lines.push('', `**${category}**`);
    for (const c of cmds) {
      const alias = c.aliases?.length ? ` (alias: ${c.aliases.map(a => `\`/${a}\``).join(', ')})` : '';
      lines.push(`* \`${c.usage}\` — ${c.description}${alias}`);
    }
  }
  return lines.join('\n');
}
