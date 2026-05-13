#!/usr/bin/env node

process.title = 'curie-agent';

import { render } from 'ink';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, basename, isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);

import { ChatSurface, handleSlashCommand, COLD_START_BANNER } from '@curie-agent/tui';
import { getTheme } from '@curie-agent/render';
import { TurnLoop, SettingsManager, DEFAULT_SETTINGS, CronManager, TelegramGateway, ChannelRegistry, ChannelRouter, HeartbeatExecutor, HeartbeatDelivery, pickNextSchedule, scheduleLabel, type CurieSettings, type ScheduleType, type Message } from '@curie-agent/core';
import { listSnapshots, revertTo } from '@curie-agent/core/safety/snapshot.js';
import { AnthropicProvider, OpenAIProvider, OllamaProvider, GoogleGeminiProvider, OpenRouterProvider } from '@curie-agent/providers';
import { allTools, setGlobalCwd } from '@curie-agent/tools';
import { createMcpTools, MCPClient, type MCPConfig } from '@curie-agent/mcp';
import type { Event, CronTask } from '@curie-agent/core';
import type { SlashCommandInput, SlashCommandResult, SlashCommandContext, ProjectEntry } from '@curie-agent/tui';
import type { ChannelTabEntry } from '@curie-agent/tui';

const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..' , 'package.json'), 'utf-8'));
const VERSION = pkg.version;

// Module-level user input history — survives App remounts by Ink.
// A single mutable object that's never recreated, so ALL closures see the same data.
const userInputHistory: string[] = [];
// Stable ref object — never recreated, so Ink sees the same ref and doesn't remount ChatSurface.
const userInputHistoryIndexObj = { current: -1 }; // -1 = not browsing; 0 = most recent
const setUserInputHistoryIndex = (idx: number) => { userInputHistoryIndexObj.current = idx; };

// Resolve templates directory — included in package via "files" in package.json
// Prod: packages/cli/dist/src/cli.js  → ../../templates
// Dev:  packages/cli/src/cli.tsx       → ../templates
const __dir = dirname(__filename);
const TEMPLATES_DIR = existsSync(join(__dir, '..', '..', 'templates'))
  ? join(__dir, '..', '..', 'templates')   // prod: dist/src/
  : join(__dir, '..', 'templates');         // dev: src/

type CurieMode = 'plan' | 'edit' | 'auto' | 'yolo';

interface AgentEntry {
  id: string;
  prompt: string;
  output: string;
  status: 'running' | 'completed' | 'error';
  child?: ReturnType<typeof spawn>;
}

interface Args {
  prompt?: string;
  headless?: boolean;
  model?: string;
  approvalMode?: string;
  session?: string;
  resume?: boolean;
  version?: boolean;
  outputFormat?: string;
  cwd?: string;
  help?: boolean;
}

function parseStreamJsonSummary(raw: string, prompt: string): string {
  // Parse Claude CLI stream-json output (JSONL format).
  // --verbose adds __meta lines we skip.
  // Actual format from real output:
  //   {"type":"assistant","message":{"content":[{"type":"thinking","thinking":"...","signature":""},{"type":"text","text":"Hello world!"}]}}
  //   {"type":"result","result":"Hello world!","..."}
  const lines = raw.split('\n');
  const texts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip __meta lines and non-JSON noise
    if (trimmed.startsWith('__meta')) continue;

    // Try to parse as JSON
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;

      // type: "assistant" — message.content is an array of blocks
      if (obj.type === 'assistant' && obj.message && typeof obj.message === 'object') {
        const msg = obj.message as Record<string, unknown>;
        const contentArr = msg.content;
        if (Array.isArray(contentArr)) {
          for (const block of contentArr) {
            if (typeof block !== 'object' || block === null) continue;
            const b = block as Record<string, unknown>;
            // Only text blocks — skip thinking blocks (internal reasoning)
            if (b.type === 'text' && typeof b.text === 'string') {
              texts.push(b.text);
            }
          }
        }
      }

      // type: "result" — final output has a flat "result" field
      if (obj.type === 'result' && typeof obj.result === 'string') {
        texts.push(obj.result);
      }
    } catch {
      // Not JSON — skip
    }
  }

  // Combine all text blocks
  const fullText = texts.join('\n').trim();

  if (fullText) {
    const summary = fullText.length > 2000
      ? fullText.slice(0, 2000) + '... (truncated)'
      : fullText;
    return `Agent done work on project: ${basename(process.cwd())}\n${'---'.repeat(10)}\n${summary}`;
  }

  // Fallback: non-JSON lines that look like assistant output
  const nonJsonLines = lines
    .filter(l => l.trim() && !l.trim().startsWith('{'))
    .filter(l => !l.trim().startsWith('['))
    .join('\n')
    .trim();

  if (nonJsonLines) {
    const summary = nonJsonLines.length > 2000
      ? nonJsonLines.slice(0, 2000) + '... (truncated)'
      : nonJsonLines;
    return `Agent done work on project: ${basename(process.cwd())}\n${'---'.repeat(10)}\n${summary}`;
  }

  return `Agent finished on project: ${basename(process.cwd())}`;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg === '--version' || arg === '-v') {
      args.version = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '-p') {
      args.headless = true;
    } else if (arg === '--output-format') {
      i++;
      args.outputFormat = argv[i]!;
    } else if (arg === '--model') {
      i++;
      args.model = argv[i]!;
    } else if (arg === '--approval-mode') {
      i++;
      args.approvalMode = argv[i]!;
    } else if (arg === '--session') {
      i++;
      args.session = argv[i]!;
    } else if (arg === '--cwd') {
      i++;
      args.cwd = argv[i]!;
    } else if (arg === 'resume' || arg === 'continue') {
      args.resume = true;
    } else if (!arg.startsWith('-')) {
      args.prompt = arg;
    }
    i++;
  }
  return args;
}

function printHelp() {
  console.log(`
curie-agent - Local-first, self learner - AI Agent.

Usage:
  curie-agent                              Interactive TUI
  curie-agent "<prompt>"                   One-shot prompt
  curie-agent -p "<prompt>"                Headless mode, stdout answer
  curie-agent resume                       Resume last session
  curie-agent resume <id>                  Resume specific session
  curie-agent sessions list|show|rm        Session management
  curie-agent --version                    Show version

Options:
  --model <model>                       Model to use
  --approval-mode <mode>                plan | edit | auto | yolo
  --cwd <dir>                           Working directory
  --output-format <format>              stream-json
  -v, --version                         Show version
  -h, --help                            Show help

Slash Commands (in TUI):
  /status                               Show version, model, and account info
  /help                                 Show all available commands
  /model <model>                        Switch AI model
  /effort <level>                       Set reasoning effort (low|medium|high|max|auto)
  /mode <mode>                          Set approval mode (plan|edit|auto|yolo)
  /theme <name>                         Change color theme
  /debug [on|off]                       Toggle debug logging
  /agent [--mode m] [--effort e] <prompt> Launch external agent
  /remind <message at time>             Create a reminder
  /cron <list|delete|clear>             Manage reminders
  /channels <list|set-bot-token|set-user-id|disconnect>  Manage Telegram channel
`.trim());
}

function buildModePreamble(mode: string, cwd: string): string {
  const plansDir = resolve(cwd, 'plans');
  switch (mode) {
    case 'plan':
      return [
        '',
        '',
        '# PLAN MODE (active)',
        'You MUST NOT edit files, write files, or run shell commands — only Read/Glob/Grep are permitted.',
        '',
        'Your job this turn:',
        `1. Think step by step about the request.`,
        `2. Pick a concise THREE-word kebab-case slug that summarises it (e.g. "refactor-login-flow").`,
        `3. Write the full plan to ${plansDir}/<three-word-slug>.md with sections: Context, Critical Files, Steps, Verification.`,
        `   (Use the Write tool — Write IS allowed in plan mode for files under ${plansDir}/ only, via the dedicated plan flow.)`,
        `4. Stop. The user will review and approve. On approval the app will switch to auto mode and execute the plan.`,
      ].join('\n');
    case 'edit':
      return [
        '',
        '',
        '# EDIT MODE (active)',
        'Every mutating tool call (Edit, Write, Bash) requires explicit user approval.',
        'Propose changes in small, easy-to-review steps. After each approval, continue.',
      ].join('\n');
    case 'auto':
      return [
        '',
        '',
        '# AUTO MODE (active)',
        'Think before you act. Non-destructive edits proceed automatically.',
        'Ask only when a step could be harmful (destructive shell, large rewrites, anything irreversible).',
      ].join('\n');
    case 'yolo':
      return [
        '',
        '',
        '# YOLO MODE (active)',
        'Proceed end-to-end without asking. No approvals. Only stop when the task is complete or you hit a blocker you cannot resolve.',
      ].join('\n');
    default:
      return '';
  }
}

interface MainFileRef { path: string; label: string; description: string }
interface MainManifest {
  agentsMd: string | null;
  identity: MainFileRef[];
  user: MainFileRef[];
  memory: MainFileRef[];
  dailyMemory: MainFileRef[];
  tools: MainFileRef[];
  other: MainFileRef[];
}

const FILE_DESCRIPTIONS: Record<string, { bucket: keyof Omit<MainManifest, 'agentsMd'>; description: string }> = {
  'SOUL.md':     { bucket: 'identity', description: 'who you are, your name, your persona , your behavioural principles and personality' },
  'USER.md':     { bucket: 'user',     description: 'Static profile of the human you help (name, timezone, skills, hardware)' },
  'MEMORY.md':   { bucket: 'memory',   description: 'Curated long-term memory. Read when the user references past context; write here when asked to remember something' },
  'TOOLS.md':    { bucket: 'tools',    description: 'Your local tool conventions and notes' },
  'HEARTBEAT.md':{ bucket: 'other',    description: 'Heartbeat / liveness state log' },
};

function listMainFiles(): MainManifest {
  const root = resolve(homedir(), '.curie-agent');
  const manifest: MainManifest = {
    agentsMd: null, identity: [], user: [], memory: [], dailyMemory: [], tools: [], other: [],
  };
  if (!existsSync(root) || !statSync(root).isDirectory()) return manifest;

  const agentsPath = resolve(root, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    try {
      const body = readFileSync(agentsPath, 'utf-8').trim();
      if (body) manifest.agentsMd = body;
    } catch { /* ignore */ }
  }

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name === 'AGENTS.md') continue; // loaded as the operating manual
    if (!/\.(md|markdown|txt)$/i.test(entry.name)) continue;
    const full = resolve(root, entry.name);
    const meta = FILE_DESCRIPTIONS[entry.name];
    const ref: MainFileRef = {
      path: full,
      label: `~/.curie-agent/${entry.name}`,
      description: meta?.description ?? entry.name.replace(/\.[^.]+$/, ''),
    };
    const bucket = meta?.bucket ?? 'other';
    manifest[bucket].push(ref);
  }

  // Daily memory: most recent 5 by mtime.
  const memoryDir = resolve(root, 'memory');
  if (existsSync(memoryDir) && statSync(memoryDir).isDirectory()) {
    const entries = readdirSync(memoryDir, { withFileTypes: true })
      .filter(e => e.isFile() && /\.(md|txt)$/i.test(e.name))
      .map(e => {
        const full = resolve(memoryDir, e.name);
        return { name: e.name, full, mtime: statSync(full).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 5);
    for (const e of entries) {
      manifest.dailyMemory.push({
        path: e.full,
        label: `~/.curie-agent/memory/${e.name}`,
        description: 'Dated session log',
      });
    }
  }

  return manifest;
}

function renderRefs(refs: MainFileRef[]): string {
  return refs.map(r => `- ${r.path} — ${r.description}`).join('\n');
}

function loadAgentPrompt(cwd: string) {
  const parts: string[] = [];
  const manifest = listMainFiles();
  const mainRoot = resolve(homedir(), '.curie-agent');
  const memoryDir = resolve(mainRoot, 'memory');
  const today = new Date().toISOString().slice(0, 10);

  // 1. Operating manual — AGENTS.md verbatim, or a built-in fallback.
  if (manifest.agentsMd) {
    parts.push(`# Your operating manual\n\n${manifest.agentsMd}`);
  } else {
    parts.push([
      '# Your operating manual',
      '',
      `Your persistent identity and memory live at: ${mainRoot}`,
      'Use the Read tool with absolute paths to pull in context files when you need them.',
      'When the user asks you to remember something, write it to MEMORY.md.',
    ].join('\n'));
  }

  // 2. Manifest of available-but-not-loaded context.
  const manifestParts: string[] = [
    '# Available context files',
    '',
    'These files exist in ~/.curie-agent/ and you may Read them with the Read tool when relevant to the user\'s request. Paths are absolute — pass them directly to Read.',
  ];
  if (manifest.identity.length) {
    manifestParts.push('', '## Identity & personality', renderRefs(manifest.identity));
  }
  if (manifest.user.length) {
    manifestParts.push('', '## The human you\'re helping', renderRefs(manifest.user));
  }
  if (manifest.memory.length || manifest.dailyMemory.length) {
    manifestParts.push('', '## Memory');
    if (manifest.memory.length) manifestParts.push(renderRefs(manifest.memory));
    if (manifest.dailyMemory.length) {
      manifestParts.push(`Dated session logs (newest first) in ${memoryDir}:`, renderRefs(manifest.dailyMemory));
    }
  }
  if (manifest.tools.length) {
    manifestParts.push('', '## Tool notes', renderRefs(manifest.tools));
  }
  if (manifest.other.length) {
    manifestParts.push('', '## Other', renderRefs(manifest.other));
  }
  parts.push(manifestParts.join('\n'));

  // 3. Write rules — keep them explicit and short.
  parts.push([
    '# Write rules (enforce these)',
    '',
    `- "remember X" or a fact worth keeping → append to ${resolve(mainRoot, 'MEMORY.md')}`,
    `- Today's session log → append to ${resolve(memoryDir, `${today}.md`)} (create if missing)`,
    `- Profile fact about the user changed → update ${resolve(mainRoot, 'USER.md')}`,
    '- Never write memories or session events to USER.md.',
  ].join('\n'));

  // 4. Project overrides — <cwd>/.curie-agent/AGENTS.md layered on top of the global manual.
  const projectPath = resolve(cwd, '.curie-agent', 'AGENTS.md');
  if (existsSync(projectPath)) {
    parts.push(`# Project overrides (${projectPath})\n\n${readFileSync(projectPath, 'utf-8')}`);
  }

  // 5. Current time.
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
  parts.push(`# Current time\n\n${dateStr}, ${timeStr}`);

  return parts.join('\n\n');
}

function cwdFromProjectDir(rawDir: string): string {
  // Read cwd from a JSONL file in the project dir — fall back to reconstructing from dir name.
  const projDir = join(homedir(), '.claude', 'projects', rawDir);
  try {
    const files = readdirSync(projDir).filter(f => f.endsWith('.jsonl'));
    for (const f of files) {
      const content = readFileSync(join(projDir, f), 'utf8');
      for (const line of content.split('\n')) {
        if (!line.includes('"cwd"')) continue;
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          if (typeof obj['cwd'] === 'string') return obj['cwd'] as string;
        } catch { /* skip */ }
      }
    }
  } catch { /* fall through */ }
  // Fallback: reconstruct from dir name (works for simple paths without dashes in dir names)
  const m = rawDir.match(/^([A-Za-z])--(.+)$/);
  if (m) {
    const drive = (m[1] as string).toUpperCase();
    return drive + ':\\' + (m[2] as string).replace(/-/g, '\\');
  }
  return rawDir;
}

function loadClaudeProjects(): ProjectEntry[] {
  const dir = join(homedir(), '.claude', 'projects');
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => {
        const m = e.name.match(/^[A-Za-z]--(.+)$/);
        const projectPath = cwdFromProjectDir(e.name);
        return {
          label: m ? m[1] as string : e.name,
          rawDir: e.name,
          source: 'claude-code' as const,
          projectPath,
        };
      });
  } catch {
    return [];
  }
}

interface OnReminderCallback {
  (task: CronTask): void;
}

interface AppProps {
  provider: { name: string; stream: (args: any) => { iterable: AsyncIterable<any>; cancel(): void }; check: (prompt: string, args?: { model?: string; system?: string }) => Promise<string> };
  streamProviderHolder: { current: { name: string; stream: (args: any) => { iterable: AsyncIterable<any>; cancel(): void }; check: (prompt: string, args?: { model?: string; system?: string }) => Promise<string>; complete?: (args: any) => Promise<{ text: string; stopReason: string }> } };
  model: string;
  approvalMode: string;
  cwd: string;
  themeName: string;
  system: string;
  settings: ReturnType<typeof SettingsManager.prototype.load>;
  projects: ProjectEntry[];
  cronManager: CronManager;
  onReminderHolder: { current: OnReminderCallback | null };
  telegramChatIdRef: React.MutableRefObject<string | null>;
  telegramSubmitRef: React.MutableRefObject<((text: string) => void) | null>;
  telegramGateway: InstanceType<typeof TelegramGateway> | null;
  // Multi-channel support
  channelRegistry: ChannelRegistry;
  channelRouter: ChannelRouter;
  activeChannelRef: React.MutableRefObject<string | null>;
  // MCP tools discovered from connected servers
  mcpToolsRef: { current: typeof allTools };
  // Context window size in tokens
  contextWindowSize?: number;
  /** MCP client instances for connection status display. */
  mcpClientsRef: { current: Array<{ serverId: string; isConnected: boolean; tools: ReadonlyArray<{ name: string }> }> };
  /** Called before creating a new TurnLoop — should reconnect MCP if settings changed. */
  onMcpReconnect?: () => Promise<void>;
  /** When true, tells onMcpReconnect to actually reconnect. Set by /mcp add/remove. */
  mcpNeedsReconnect?: { current: boolean };
  /** If true, resume the most recent session. */
  resumeSession?: boolean;
  /** If set, resume this specific session ID. */
  resumeSessionId?: string;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

import { estimateCost, parseTieredPricing, selectTier } from './pricing.js';

export { estimateCost, parseTieredPricing, selectTier };

function App({ provider, streamProviderHolder, model, approvalMode, cwd, themeName, system, settings, projects, cronManager: externalCronManager, onReminderHolder, telegramChatIdRef, telegramSubmitRef, telegramGateway, channelRegistry, channelRouter, activeChannelRef, mcpToolsRef, mcpClientsRef, onMcpReconnect, mcpNeedsReconnect, contextWindowSize, resumeSession, resumeSessionId }: AppProps) {
  const [messages, setMessages] = useState<
    Array<{ role: 'user' | 'assistant' | 'tool' | 'tool-group' | 'system' | 'decision' | 'heartbeat'; content: string; title?: string }>
  >([]);
  // Multi-channel: per-channel message storage (keyed by channel ID)
  // 'main' channel starts with the cold-start banner as the first message so it
  // scrolls naturally with the conversation rather than being pinned to a header.
  const [channelMessages, setChannelMessages] = useState<Record<string, Array<{ role: 'user' | 'assistant' | 'tool' | 'tool-group' | 'system' | 'decision' | 'heartbeat'; content: string; title?: string }>>>({
    main: [{ role: 'assistant', content: COLD_START_BANNER }],
  });
  // Queue for background messages (cron/reminder/heartbeat) that arrive
  // during an active turn — they must not displace the streaming assistant
  // message from the live rendering slot.
  const backgroundMessageQueueRef = useRef<Array<{ role: 'system' | 'heartbeat'; content: string; title?: string }>>([]);
  const [activeChannelId, setActiveChannelId] = useState<string>('main');
  // Per-channel TurnLoop instances
  const channelTurnLoopsRef = useRef<Map<string, TurnLoop>>(new Map());
  const [currentModel, setCurrentModel] = useState(model);
  const [currentProvider, setCurrentProvider] = useState(provider?.name || '(not configured)');
  const [currentTheme, setCurrentTheme] = useState(themeName);
  const [currentMode, setCurrentMode] = useState(approvalMode);
  const [currentEffort, setCurrentEffort] = useState(settings.effort);
  const [currentDebug, setCurrentDebug] = useState(settings.debug);
  const [currentCwd, setCurrentCwd] = useState(cwd);
  const [currentSystem, setCurrentSystem] = useState(system);
  const [inputTokens, setInputTokens] = useState<number | undefined>(undefined);
  const [outputTokens, setOutputTokens] = useState<number | undefined>(undefined);
  const [currentTab, setCurrentTab] = useState<'assistant' | 'stats' | 'projects' | 'agents' | 'channels'>('assistant');
  const [duration, setDuration] = useState('00:00:00');
  const [status, setStatus] = useState('idle');
  const startedAt = useRef(Date.now());
  const loopRef = useRef<TurnLoop | null>(null);
  // Persist TurnLoop messages across turns so slash commands can read them
  // even when loopRef.current is cleared (mode change, provider change, etc.)
  const sessionMessagesRef = useRef<Message[]>([]);
  const busyRef = useRef(false);
  const toolGroupIndexRef = useRef<number | null>(null);
  const planFileRef = useRef<string | null>(null);
  // Pending approval requests keyed by toolCallId (for Telegram callback correlation)
  const pendingApprovalsRef = useRef<Map<string, { resolve: (v: boolean) => void }>>(new Map());
  // ToolCallId of the current approval request (set by approval-request event, consumed by onApprovalAsk)
  const pendingToolCallIdRef = useRef<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{
    toolName: string;
    input: Record<string, unknown>;
    reason: string;
    resolve: (allow: boolean) => void;
  } | null>(null);
  const shellChildRef = useRef<ReturnType<typeof spawn> | null>(null);
  // Persistent cwd for `!` shell commands. `cd foo` inside a one-shot spawn
  // would evaporate when the subshell exits, so we track it ourselves and
  // pass it to every subsequent spawn.
  const shellCwdRef = useRef<string>(cwd);
  // Load existing settings so subsequent .update() calls (from slash commands)
  // preserve keys like MODEL_URL / MODEL_API_KEY instead of resetting to
  // defaults.
  const settingsMgr = useRef<SettingsManager | null>(null);
  if (!settingsMgr.current) {
    const mgr = new SettingsManager();
    mgr.load();
    settingsMgr.current = mgr;
  }
  const sessionIdRef = useRef<string | null>(null);
  // CronManager instance — created externally, stored here for slash commands
  const cronManagerRef = useRef<CronManager | null>(externalCronManager);
  // TelegramGateway instance — passed from main(), used for response routing
  // telegramChatIdRef is passed as a prop from main()

  // Interactive /init wizard state
  type WizardStep =
    | { phase: 'idle' }
    | { phase: 'provider' }
    | { phase: 'apiKey'; provider: string }
    | { phase: 'url'; provider: string }
    | { phase: 'model'; provider?: string };
  const wizardRef = useRef<WizardStep>({ phase: 'idle' });

  const TEMPLATE_FILES = ['AGENTS.md', 'HEARTBEAT.md', 'SOUL.md', 'USER.md', 'TODO.md', 'MEMORY.md'];

  // Store setMessages in a ref so the checker callback can call it
  // without racing with a render cycle. The checker runs in setInterval,
  // which can fire mid-render — calling setState then can silently fail.
  const setMessagesRef = useRef(setMessages);
  setMessagesRef.current = setMessages;

  // Helper: push a message to both channel and legacy message arrays
  const pushToChannel = useCallback((channelId: string, content: string) => {
    setChannelMessages((prev) => {
      const ch = prev[channelId] || [];
      return { ...prev, [channelId]: [...ch, { role: 'assistant', content }] };
    });
    setMessages((prev) => [...prev, { role: 'assistant', content }]);
  }, []);

  // Wire Telegram approval decision callback so inline button taps resolve pending Promises
  useEffect(() => {
    if (telegramGateway) {
      telegramGateway.setOnApprovalDecision((toolCallId, approved) => {
        const pending = pendingApprovalsRef.current.get(toolCallId);
        if (pending) {
          pending.resolve(approved);
          pendingApprovalsRef.current.delete(toolCallId);
        }
        // Clear TUI approval UI — decision came from Telegram, not keyboard
        setPendingApproval(null);
      });
    }
  }, [telegramGateway]);

  // Register the reminder callback synchronously so it's available
  // before useEffect runs. Uses setMessagesRef to avoid render-cycle race.
  // Telegram sends are handled in main()'s cron checker callback (fresh closure).
  onReminderHolder.current = (task: CronTask) => {
    const timeStr = new Date(task.scheduledAt).toLocaleString();
    const briefTask = task as CronTask & { heartbeatBrief?: string; executedScheduleType?: string };
    const msg = briefTask.heartbeatBrief
      ? { role: 'heartbeat' as const, title: briefTask.executedScheduleType ? scheduleLabel(briefTask.executedScheduleType as ScheduleType) : (task.schedule ? scheduleLabel(task.schedule.type) : 'MANUAL'), content: briefTask.heartbeatBrief }
      : { role: 'system' as const, content: `Curie reminder:\nDate: ${timeStr}\n${task.message}` };

    if (busyRef.current) {
      // Queue the message — don't displace the streaming assistant response
      backgroundMessageQueueRef.current.push(msg);
      return;
    }
    setChannelMessages(prev => {
      const ch = prev[activeChannelId] || [];
      return { ...prev, [activeChannelId]: [...ch, msg] };
    });
  };
  const [agents, setAgents] = useState<Map<string, AgentEntry>>(new Map());
  const agentsRef = useRef<Map<string, AgentEntry>>(new Map());
  agentsRef.current = agents;

  useEffect(() => {
    const id = setInterval(() => {
      setDuration(formatDuration(Date.now() - startedAt.current));
    }, 1000);
    return () => clearInterval(id);
  }, []);

   const theme = getTheme(currentTheme);

  const applySlashResult = useCallback(async (result: SlashCommandResult, agentPrompt?: string) => {
    const push = (content: string) => {
      // Slash command results must go to the per-channel messages array
      // since that's what the ChatSurface renders.
      setChannelMessages((prev) => {
        const ch = prev[activeChannelId] || [];
        return { ...prev, [activeChannelId]: [...ch, { role: 'assistant', content }] };
      });
      // Also sync to legacy messages for backward compatibility.
      setMessages(prev => [...prev, { role: 'assistant', content }]);
    };
    switch (result.type) {
      case 'message':
        if (result.message === 'init_wizard') {
          push(
            'Welcome to curie-agent! Let\'s configure your AI provider.\n' +
            '\n' +
            'Which provider do you want to use?\n' +
            '  1)local eg llama_cpp\n' +
            '  2)openrouter\n' +
            '  3)openai\n' +
            '  4)anthropic\n' +
            '  5)google\n' +
            '  6)ollama\n' +
            '\nType 1, 2, 3, 4, 5, or 6:',
          );
          wizardRef.current = { phase: 'provider' };
          return;
        }
        push(result.message!);
        break;
      case 'update_model':
        setCurrentModel(result.model!);
        settingsMgr.current!.update({ model: result.model! });
        push(result.message!);
        break;

      case 'update_model_cost':
        settingsMgr.current!.update({ MODEL_COST: result.modelCost! });
        push(result.message!);
        break;

      case 'update_context_window':
        settingsMgr.current!.update({ MODEL_CONTEXT_WINDOW: result.contextWindow! });
        push(result.message!);
        break;
      case 'update_provider': {
        const newProvider = result.provider!;
        settingsMgr.current!.update({ MODEL_PROVIDER: newProvider });
        // Create new provider and swap into the holder
        const settings = settingsMgr.current!.get();
        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        streamProviderHolder.current = createProvider(settings);
        loopRef.current = null;
        setCurrentProvider(streamProviderHolder.current.name);
        push(result.message!);
        break;
      }
      case 'update_init': {
        // Legacy: direct API key via /init <key>
        settingsMgr.current!.update({ MODEL_API_KEY: result.apiKey! });
        const settings = settingsMgr.current!.get();
        streamProviderHolder.current = createProvider(settings);
        loopRef.current = null;
        push(result.message! + '\nProvider ready. You can now chat!');
        break;
      }
      case 'update_theme': {
        setCurrentTheme(result.theme!);
        settingsMgr.current!.update({ theme: result.theme! });
        // Repaint the terminal default-background to match the new theme so
        // unpainted cells stay consistent.
        const nextTheme = getTheme(result.theme!);
        process.stdout.write(`\x1b]11;${nextTheme.background}\x07`);
        push(result.message!);
        break;
      }
      case 'update_mode':
        setCurrentMode(result.mode!);
        settingsMgr.current!.update({ mode: result.mode! });
        loopRef.current = null;
        push(result.message!);
        break;
      case 'update_effort':
        setCurrentEffort(result.effort!);
        settingsMgr.current!.update({ effort: result.effort! });
        loopRef.current = null;
        push(result.message!);
        break;
      case 'update_debug':
        setCurrentDebug(result.debug!);
        settingsMgr.current!.update({ debug: result.debug! });
        push(result.message!);
        break;
      case 'update_statusline':
        push(result.message!);
        break;
      case 'update_tools_per_call':
        settingsMgr.current!.update({ TOOLS_PER_CALL: result.toolsPerCall!, WEBSEARCH_PER_CALL: result.websearchPerCall });
        loopRef.current = null;
        push(result.message!);
        break;
      case 'update_websearch_per_call':
        settingsMgr.current!.update({ WEBSEARCH_PER_CALL: result.websearchPerCall! });
        loopRef.current = null;
        push(result.message!);
        break;
      case 'update_mcp': {
        // Persist MCP servers to disk. handleMcp mutates ctx.settings in-place,
        // but that's a shallow copy from .get() — settingsMgr never sees it.
        // The mcpServers field on the result carries the JSON string to persist.
        if (result.mcpServers) {
          settingsMgr.current!.update({ MCP_SERVERS: typeof result.mcpServers === 'string' ? JSON.parse(result.mcpServers) : result.mcpServers });
        }
        loopRef.current = null;
        if (mcpNeedsReconnect) mcpNeedsReconnect.current = true;
        // Clear the active channel's TurnLoop so next message creates a fresh one
        // with the updated MCP tools (reconnectMcp repopulates mcpToolsRef).
        channelTurnLoopsRef.current.delete(activeChannelId);
        if (result.mcpServerId) {
          push(`${result.message}\nServer "${result.mcpServerId}" changed — TurnLoop invalidated. New tools will be loaded on next message.`);
        } else {
          push(`${result.message}\nMCP reloaded — TurnLoop invalidated. New tools will be loaded on next message.`);
        }
        break;
      }
      case 'notification': {
        const note = result.notification;
        if (!note) break;

        // Heartbeat notification handling
        if (note.type === 'heartbeat') {
          if (note.enabled) {
            push('Heartbeat enabled. The agent will run on all configured schedules.');
            settingsMgr.current!.update({ HEARTBEAT: 'on' });
          } else {
            push('Heartbeat disabled.');
            settingsMgr.current!.update({ HEARTBEAT: 'off' });
          }
          break;
        }

        // Heartbeat schedule set
        if (note.type === 'heartbeat-set') {
          settingsMgr.current!.update({ [note.key]: note.value });
          // Re-evaluate all four schedules to pick the next earliest
          const settings = settingsMgr.current!.get();
          cronManagerRef.current?.rescheduleFromSettings({
            HEARTBEAT_INTRADAY: settings.HEARTBEAT_INTRADAY,
            HEARTBEAT_DAILY: settings.HEARTBEAT_DAILY,
            HEARTBEAT_WEEKLY: settings.HEARTBEAT_WEEKLY,
            HEARTBEAT_MONTHLY: settings.HEARTBEAT_MONTHLY,
            HEARTBEAT_DREAMING: settings.HEARTBEAT_DREAMING,
          });
          const scheduleLabel: Record<string, string> = {
            HEARTBEAT_INTRADAY: `intraday: ${note.value}`,
            HEARTBEAT_DAILY: `daily at ${note.value}`,
            HEARTBEAT_WEEKLY: `weekly on ${note.value}`,
            HEARTBEAT_MONTHLY: `monthly on day ${note.value}`,
            HEARTBEAT_DREAMING: `dreaming at ${note.value}`,
          };
          push(`Heartbeat schedule updated: ${scheduleLabel[note.key] ?? note.value}`);
          break;
        }

        // Heartbeat now — run immediately
        if (note.type === 'heartbeat-now') {
          push('Heartbeat cycle starting...');
          const settings = settingsMgr.current!.get();
          const provider = streamProviderHolder.current;
          if (!provider) {
            push('Provider not initialized. Cannot run heartbeat.');
            break;
          }

          // Merge built-in tools + MCP tools, just like the TUI TurnLoop
          const mcpTools = mcpToolsRef.current;
          const heartbeatTools = mcpTools.length > 0
            ? [...allTools, ...mcpTools]
            : allTools;
          const hasMcp = mcpTools.length > 0;

          const executor = new HeartbeatExecutor({
            provider: provider as any,
            model: settings.model,
            tools: heartbeatTools,
            cwd: currentCwd,
            settings,
            effort: currentEffort as 'low' | 'medium' | 'high' | 'max' | 'auto' | undefined,
          });

          executor.execute().then(async (result) => {
            const formatted = HeartbeatDelivery.formatBrief(result);
            setChannelMessages(prev => {
              const ch = prev[activeChannelId] || [];
              return { ...prev, [activeChannelId]: [...ch, { role: 'heartbeat', title: 'manual', content: formatted }] };
            });

            // Also deliver to Telegram if configured
            const telegramChatId = settings.TELEGRAM_CHAT_ID;
            if (telegramChatId && telegramGateway) {
              const delivery = new HeartbeatDelivery({
                chatId: telegramChatId,
                telegramGateway,
              });
              await delivery.deliver(formatted);
            }
          }).catch((err) => {
            push(`Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`);
          });
          break;
        }

        // Original reminder notification handling
        {
          const sysMsg = {
            role: 'system' as const,
            content: `Curie reminder:\nDate: ${note.scheduledAt}\n${note.message}`,
          };
          setChannelMessages((prev) => {
            const ch = prev[activeChannelId] || [];
            return { ...prev, [activeChannelId]: [...ch, sysMsg] };
          });
          setMessages(prev => [...prev, sysMsg]);
        }
        break;
      }
      case 'start_agent': {
        setAgents(prev => {
          const next = new Map(prev);
          next.set(result.agentId!, {
            id: result.agentId!,
            prompt: agentPrompt ?? '',
            output: '',
            status: 'running',
          });
          return next;
        });
        push(result.message!);
        break;
      }
      case 'external': {
        const ext = result.external;
        if (ext === 'channels.set-bot-token') {
          settingsMgr.current!.update({ TELEGRAM_BOT_TOKEN: result.message! });
          push(`Telegram bot token set. Bot will start polling on next user ID configuration.`);
        } else if (ext === 'channels.set-user-id') {
          settingsMgr.current!.update({ TELEGRAM_USER_ID: result.message! });
          push(`Allowed user ID set. Telegram will only process messages from this user.`);
        } else if (ext === 'channels.set-chat-id') {
          settingsMgr.current!.update({ TELEGRAM_CHAT_ID: result.message! });
          push(`Telegram chat ID set. Reminders will now send to this chat.`);
        } else if (ext === 'channels.disconnect') {
          settingsMgr.current!.update({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_USER_ID: '' });
          push('Telegram integration disconnected.');
          telegramGateway?.stop();
        } else if (ext === 'channels.switch') {
          setActiveChannelId(result.message!);
          push(`Switched to channel: ${result.message}`);
        } else {
          push(`Command /${ext} not yet implemented`);
        }
        break;
      }
      case 'exit':
        if (result.message) push(result.message);
        // Let the transcript paint before exiting.
        setTimeout(() => process.exit(0), 30);
        break;
      case 'update_memory': {
        const mem = result.memory!;
        const home = homedir();
        const memoryPath = join(home, '.curie-agent', 'MEMORY.md');

        if (mem.operation === 'status') {
          // Read key memory files and compute approximate tokens (~4 chars ≈ 1 token for English markdown)
          const memDir = join(home, '.curie-agent');
          const files = ['AGENTS.md', 'MEMORY.md', 'USER.md', 'SOUL.md', 'TOOLS.md', 'HEARTBEAT.md'];
          const lines = ['Memory System Status:'];
          let totalChars = 0;
          for (const f of files) {
            const fp = join(memDir, f);
            if (existsSync(fp)) {
              const content = readFileSync(fp, 'utf-8');
              const tokens = Math.ceil(content.length / 4);
              totalChars += content.length;
              lines.push(`  ${f.padEnd(15)} ~${tokens} tokens`);
            }
          }
          lines.push(`  ${'---'.padEnd(15)} ~${'---'}`);
          lines.push(`  ${'TOTAL'.padEnd(15)} ~${Math.ceil(totalChars / 4)} tokens`);
          push(lines.join('\n'));
        } else if (mem.operation === 'add') {
          const existing = existsSync(memoryPath) ? readFileSync(memoryPath, 'utf-8') : '';
          const newContent = existing.trim() ? existing.trimEnd() + '\n' + mem.content : mem.content;
          writeFileSync(memoryPath, newContent, 'utf-8');
          push(result.message!);
        }
        loopRef.current = null;
        break;
      }
      case 'switch_tab': {
        setCurrentTab(result.tab ?? 'stats');
        push(result.message ?? 'Switched to Stats tab');
        break;
      }

       case 'compact': {
        const compact = result.compact!;
        const { messages, depth } = compact;
        const originalSystem = currentSystem;
        if (!streamProviderHolder.current?.complete) {
          push('Compaction requires a provider that supports the complete() method.');
          return;
        }

        // Build compaction prompt based on depth
        const conversationText = messages.map(m => {
          if (m.role === 'user') return `USER: ${m.content}`;
          if (m.role === 'assistant') return `ASSISTANT: ${(m.content as any[]).map((b: any) => {
            if (b.type === 'text') return b.text;
            if (b.type === 'thinking') return b.thinking;
            if (b.type === 'tool-use') return `[tool: ${b.name}(${JSON.stringify(b.input).slice(0, 100)})]`;
            return '';
          }).join('\n')}`;
          if (m.role === 'tool') return `TOOL RESULT (${m.toolUseId}): ${m.content.slice(0, 500)}`;
          return '';
        }).join('\n');

        const compactionPrompt = depth === 'brief'
          ? `You are compacting a conversation between a user and an AI coding agent.
Your job is to reduce the conversation to a single meaningful turn.

RULES:
- Reduce to approximately 2-4 messages (1 user request + 1-3 assistant/tool responses)
- Keep the FIRST user message (session intent)
- Keep the LAST user message (current intent)
- For assistant messages: keep only text that contains decisions, findings, or key facts
- For tool calls: keep only tool name + brief input — no need for full output
- For tool results: keep only if the output was critical to a decision (≤200 chars)

OUTPUT FORMAT:
Respond ONLY with a valid JSON array of Message objects. Use this exact format:

[{"role":"user","content":"User message text"},
{"role":"assistant","content":[{"type":"text","text":"Assistant response"}]},
{"role":"assistant","content":[{"type":"tool-use","id":"tu_1","name":"Read","input":{"path":"main.py"}}]},
{"role":"tool","toolUseId":"tu_1","content":"Tool output text"}]

CRITICAL: Output ONLY the JSON array. No markdown, no explanation, no code fences.`
          : `You are compacting a conversation between a user and an AI coding agent.
Your job is to reduce the conversation size while preserving all important context.

RULES:
- Reduce to approximately 50% of the original message count
- Keep ALL user messages (they define the intent)
- For assistant messages with tool calls: keep the tool name and a brief description of what it did, but truncate long outputs
- For assistant text: keep full content unless very long (>200 chars), then summarize
- For tool results: if >500 chars, keep the first 300 chars + "[truncated, N chars total]"
- NEVER drop entire turns — always keep at least one response per user message

OUTPUT FORMAT:
Respond ONLY with a valid JSON array of Message objects. Use this exact format:

[{"role":"user","content":"User message text"},
{"role":"assistant","content":[{"type":"text","text":"Assistant response"}]},
{"role":"assistant","content":[{"type":"thinking","thinking":"thinking text","signature":"sig"}]},
{"role":"assistant","content":[{"type":"tool-use","id":"tu_1","name":"Read","input":{"path":"main.py"}}]},
{"role":"tool","toolUseId":"tu_1","content":"Tool output text"}]

Each message has: role, content (string for user/tool, array for assistant).
Assistant blocks: {type:"text",text:"..."} | {type:"thinking",thinking:"...",signature:"..."} | {type:"tool-use",id:"...",name:"...",input:{...}}

CRITICAL: Output ONLY the JSON array. No markdown, no explanation, no code fences.`;

        try {
          const provider = streamProviderHolder.current;
          const completeResult = await provider.complete!({
            messages: messages as any,
            system: compactionPrompt,
            tools: [],
            model: currentModel,
          });

          if (!completeResult.text) {
            push('Compaction failed: no compacted messages generated.');
            return;
          }

          // Try to extract JSON from the response (LLM may add explanation text)
          let jsonStr = completeResult.text.trim();
          const firstBracket = jsonStr.indexOf('[');
          const lastBracket = jsonStr.lastIndexOf(']');
          if (firstBracket >= 0 && lastBracket > firstBracket) {
            jsonStr = jsonStr.slice(firstBracket, lastBracket + 1);
          }

          // Parse and validate the compacted messages
          let compactedMessages: Message[];
          try {
            compactedMessages = JSON.parse(jsonStr) as Message[];
            if (!Array.isArray(compactedMessages) || compactedMessages.length === 0) {
              push('Compaction failed: invalid response format.');
              return;
            }
          } catch {
            push('Compaction failed: could not parse compacted messages. The model did not return valid JSON.');
            return;
          }

          // Build summary for display: extract any non-JSON text or generate a brief summary
          const summaryText = `Compacted conversation to ${compactedMessages.length} messages (${depth}).\nThe agent will continue with the condensed context.`;

          // Build new system prompt: original system + compacted messages summary
          const compactedText = compactedMessages.map((m: Message) => {
            if (m.role === 'user') return `USER: ${m.content}`;
            if (m.role === 'assistant') return `ASSISTANT: ${m.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('\n')}`;
            if (m.role === 'tool') return `TOOL RESULT (${m.toolUseId}): ${m.content}`;
            return '';
          }).join('\n');
          const newSystem = originalSystem + '\n\n# Conversation Summary\n\n' + compactedText;

          // Null out old loop so next turn creates fresh loop with compacted state
          loopRef.current = null;

          // Update state
          setCurrentSystem(newSystem);
          sessionMessagesRef.current = compactedMessages;
          setChannelMessages((prev) => ({
            ...prev,
            [activeChannelId]: compactedMessages as any,
          }));

          push(summaryText);
        } catch (err) {
          push(`Compaction failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        break;
      }
    }
  }, []);

  const onSlashCommand = useCallback(async (input: SlashCommandInput) => {
    // Echo the submitted slash command as a user message so the transcript
    // shows what the user typed alongside the assistant's reply.
    const echoed = input.args ? `/${input.command} ${input.args}` : `/${input.command}`;
    setChannelMessages((prev) => {
      const ch = prev[activeChannelId] || [];
      return { ...prev, [activeChannelId]: [...ch, { role: 'user', content: echoed }] };
    });
    setMessages(prev => [...prev, { role: 'user', content: echoed }]);

    const ctx: SlashCommandContext = {
      settings: settingsMgr.current!.get(),
      version: VERSION,
      model: currentModel,
      provider: provider?.name || '(not configured)',
      approvalMode: currentMode,
      cwd: currentCwd,
      inputTokens,
      outputTokens,
      messages: loopRef.current?.getMessages() ?? sessionMessagesRef.current,
      channelMessages: channelMessages[activeChannelId],
      cronManager: cronManagerRef.current ?? undefined,
      mcpClients: mcpClientsRef.current,
      contextWindowSize: contextWindowSize ?? 200_000,
      thinkingBudget: ({ low: 2000, medium: 6000, high: 16000, max: 32000, auto: 0 })[currentEffort ?? 'auto'] ?? 0,
      listSnapshots: (cwd: string) => listSnapshots(cwd),
      revertTo: (cwd: string, sha: string) => revertTo(cwd, sha),
    };
    const result = await handleSlashCommand(input.command, input.args, ctx);
    await applySlashResult(result, input.args);

    // Spawn external agent subprocess after the slash command result is applied.
    if (result.type === 'start_agent' && result.agentId) {
      const agentId = result.agentId;
      const prompt = input.args;
      const agentCwd = currentCwd;

      // Build claude CLI args with agent-specific mode/effort params
      const claudeArgs: string[] = ['-p', prompt];
      if (result.agentMode) claudeArgs.unshift('--mode', result.agentMode);
      if (result.agentEffort) claudeArgs.unshift('--effort', result.agentEffort);
      claudeArgs.unshift('--output-format', 'stream-json', '--verbose');

      setAgents(prev => {
        const next = new Map(prev);
        const child = spawn('claude', claudeArgs, {
          cwd: agentCwd,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const entry = next.get(agentId)!;
        entry.child = child;
        next.set(agentId, entry);

        // Accumulate raw output for the Agents tab (full streaming)
        const rawOutput: string[] = [];

        child.stdout.on('data', (data: Buffer) => {
          const text = data.toString();
          rawOutput.push(text);
          setAgents(prev2 => {
            const next2 = new Map(prev2);
            const e = next2.get(agentId);
            if (e) {
              e.output += text;
              next2.set(agentId, e);
            }
            return next2;
          });
        });

        child.stderr.on('data', (data: Buffer) => {
          const text = data.toString();
          rawOutput.push(text);
          setAgents(prev2 => {
            const next2 = new Map(prev2);
            const e = next2.get(agentId);
            if (e) {
              e.output += text;
              next2.set(agentId, e);
            }
            return next2;
          });
        });

        child.on('close', (code) => {
          setAgents(prev2 => {
            const next2 = new Map(prev2);
            const e = next2.get(agentId);
            if (e) {
              e.status = code === 0 ? 'completed' : 'error';
              next2.set(agentId, e);
            }
            return next2;
          });

          // Parse stream-json output to extract assistant summary for the Assistant tab
          const fullRaw = rawOutput.join('');
          const summary = parseStreamJsonSummary(fullRaw, prompt);
          const finishedAgent = agentsRef.current.get(agentId);

          if (code === 0 && finishedAgent) {
            setMessages(prev => [
              ...prev,
              {
                role: 'assistant',
                content: summary,
                title: `Agent: ${prompt}`,
              },
            ]);
          } else if (finishedAgent) {
            setMessages(prev => [
              ...prev,
              {
                role: 'assistant',
                content: `Agent "${prompt}" failed (exit ${code}):\n\n${finishedAgent.output}`,
                title: `Agent: ${prompt}`,
              },
            ]);
          }
        });

        return next;
      });
    }
  }, [currentModel, currentMode, currentCwd, inputTokens, outputTokens, provider?.name, applySlashResult]);

  const onSubmit = useCallback(async (text: string) => {
    if (busyRef.current) return;

    // Determine target channel: Telegram sets activeChannelRef before calling onSubmit
    const targetChannel = activeChannelRef.current ?? activeChannelId;
    if (activeChannelRef.current) {
      activeChannelRef.current = null;
      setActiveChannelId(targetChannel);
    }

    // Handle interactive /init wizard steps
    const wizard = wizardRef.current;
    if (wizard.phase !== 'idle' && !text.trim().startsWith('/')) {
      const input = text.trim();

      if (wizard.phase === 'provider') {
        const choice = input.toLowerCase();
        const providerMap: Record<string, { name: string; key: string; url: string }> = {
          '1': { name: 'local', key: 'MODEL_API_KEY', url: 'MODEL_URL' },
          '2': { name: 'openrouter', key: 'OPENROUTER_API_KEY', url: 'OPENROUTER_URL' },
          '3': { name: 'openai', key: 'OPENAI_API_KEY', url: 'OPENAI_URL' },
          '4': { name: 'anthropic', key: 'ANTHROPIC_API_KEY', url: 'ANTHROPIC_URL' },
          '5': { name: 'google', key: 'GOOGLE_API_KEY', url: 'GOOGLE_URL' },
          '6': { name: 'ollama', key: 'MODEL_API_KEY', url: 'MODEL_URL' },
        };
        const entry = providerMap[choice];
        if (!entry) {
          setChannelMessages((prev) => ({ ...prev, [targetChannel]: [...(prev[targetChannel] || []), { role: 'assistant', content: 'Invalid choice. Please enter 1-6.\n  1) local\n  2) openrouter\n  3) openai\n  4) anthropic\n  5) google\n  6) ollama' }] }));
          setMessages((prev) => [...prev, { role: 'assistant', content: 'Invalid choice. Please enter 1-6.\n  1) local\n  2) openrouter\n  3) openai\n  4) anthropic\n  5) google\n  6) ollama' }]);
          return;
        }
        const updates: Record<string, string> = { MODEL_PROVIDER: entry.name };
        updates[entry.key] = '';
        updates[entry.url] = entry.name === 'openrouter' ? 'https://openrouter.ai/api/v1'
          : entry.name === 'anthropic' ? 'https://api.anthropic.com'
          : entry.name === 'google' ? 'https://generativelanguage.googleapis.com/v1beta'
          : `https://api.${entry.name}.com/v1`;
        settingsMgr.current!.update(updates);
        if (entry.name === 'ollama') {
          // Ollama doesn't need API key — skip to URL
          wizardRef.current = { phase: 'url', provider: entry.name };
          pushToChannel(targetChannel, `${entry.name}: What is your Ollama API URL?\n  Default: http://localhost:11434/v1\n  (Press Enter for default):`);
        } else {
          wizardRef.current = { phase: 'apiKey', provider: entry.name };
          pushToChannel(targetChannel, `${entry.name}: Enter your API key:`);
        }
        return;
      }

      if (wizard.phase === 'apiKey') {
        const keyName = wizard.provider === 'local' || wizard.provider === 'ollama' ? 'MODEL_API_KEY'
          : wizard.provider === 'openrouter' ? 'OPENROUTER_API_KEY'
          : wizard.provider === 'openai' ? 'OPENAI_API_KEY'
          : wizard.provider === 'google' ? 'GOOGLE_API_KEY'
          : 'ANTHROPIC_API_KEY';
        settingsMgr.current!.update({ [keyName]: input });
        if (wizard.provider === 'local') {
          wizardRef.current = { phase: 'url', provider: wizard.provider };
          pushToChannel(targetChannel, `API key configured.\nWhat is your local API URL?\n  Default: http://localhost:8080/v1\n  (Press Enter for default):`);
        } else if (wizard.provider === 'ollama') {
          settingsMgr.current!.update({ MODEL_URL: 'http://localhost:11434/v1' });
          wizardRef.current = { phase: 'model', provider: wizard.provider };
          pushToChannel(targetChannel, `URL configured: http://localhost:11434/v1\nWhich model do you want to use?\n  Examples: llama3.3, mistral, phi3, qwen2.5\n  Enter model name:`);
        } else if (wizard.provider === 'google') {
          wizardRef.current = { phase: 'model', provider: wizard.provider };
          pushToChannel(targetChannel, `API key configured.\nWhich model do you want to use?\n  Examples: gemini-3-flash-latest, gemini-3.1-pro\n  Enter model name:`);
        } else {
          wizardRef.current = { phase: 'model', provider: wizard.provider };
          pushToChannel(targetChannel, `API key configured.\nWhich model do you want to use?\n  Examples: claude-sonnet-4-6, gpt-4o, o1, llama-3.1-405b\n  Enter model name:`);
        }
        return;
      }

      if (wizard.phase === 'url') {
        const defaultUrl = wizard.provider === 'ollama' ? 'http://localhost:11434/v1' : 'http://localhost:8080/v1';
        const url = input || defaultUrl;
        settingsMgr.current!.update({ MODEL_URL: url });
        const modelExamples = wizard.provider === 'ollama'
          ? 'llama3.3, mistral, gemma-4, qwen3.6'
          : 'claude-sonnet-4-6, gpt-4o, o1, llama-3.1-405b';
        wizardRef.current = { phase: 'model', provider: wizard.provider };
        pushToChannel(targetChannel, `URL configured: ${url}\nWhich model do you want to use?\n  Examples: ${modelExamples}\n  Enter model name:`);
        return;
      }

      if (wizard.phase === 'model') {
        const model = input || 'claude-sonnet-4-6';
        settingsMgr.current!.update({ model });
        const settings = settingsMgr.current!.get();
        streamProviderHolder.current = createProvider(settings);
        loopRef.current = null;
        setCurrentModel(model);
        setCurrentProvider(streamProviderHolder.current.name);
        wizardRef.current = { phase: 'idle' };
        pushToChannel(targetChannel, `Configuration complete!\n  Provider: ${wizard.provider || 'anthropic'}\n  Model: ${model}\n\nWriting workspace files...`);
        // Copy template files as-is to ~/.curie-agent/
        (async () => {
          try {
            const CurieDir = join(homedir(), '.curie-agent');
            if (!existsSync(CurieDir)) {
              mkdirSync(CurieDir, { recursive: true });
            }
            const memoryDir = join(CurieDir, 'memory');
            if (!existsSync(memoryDir)) {
              mkdirSync(memoryDir, { recursive: true });
            }
            for (const filename of TEMPLATE_FILES) {
              const templatePath = join(TEMPLATES_DIR, filename);
              if (!existsSync(templatePath)) {
                pushToChannel(targetChannel, `  Skipped ${filename} (no template)`);
                continue;
              }
              const content = readFileSync(templatePath, 'utf-8');
              writeFileSync(join(CurieDir, filename), content, 'utf-8');
              pushToChannel(targetChannel, `  Wrote ${filename}`);
            }
            pushToChannel(targetChannel, '\nReady! Type a message to get started.');
            // Reload system prompt so the TurnLoop picks up the new AGENTS.md
            setCurrentSystem(loadAgentPrompt(currentCwd));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            pushToChannel(targetChannel, `Failed to write files: ${msg}`);
          }
        })();
        return;
      }

     }

    if (currentDebug) {
      console.error(`[debug] prompt: ${text}, channel: ${targetChannel}`);
    }

    // Get or create TurnLoop for the target channel
    const channelTurnLoops = channelTurnLoopsRef.current;
    let loop = channelTurnLoops.get(targetChannel);
    if (!loop) {
      // Reconnect MCP tools before building TurnLoop so we pick up
      // any changes made via /mcp add/remove from another channel.
      if (onMcpReconnect) {
        try {
          await onMcpReconnect();
        } catch {
          /* reconnect failure is non-fatal */
        }
      }
      // Try to resume an existing session for this channel
      const channel = channelRegistry.get(targetChannel);
      setGlobalCwd(currentCwd);
      loop = new TurnLoop({
        provider: streamProviderHolder.current,
        model: currentModel,
        tools: [...allTools, ...mcpToolsRef.current],
        cwd: currentCwd,
        settings: settingsMgr.current!.get(),
        approvalMode: currentMode as any,
        effort: currentEffort as any,
        system: currentSystem + buildModePreamble(currentMode, currentCwd),
        sessionId: channel?.sessionId,
        resume: resumeSession,
        resumeSessionId: resumeSessionId,
        onApprovalAsk: (req) => new Promise<boolean>((resolve) => {
          setPendingApproval({
            toolName: req.name,
            input: req.input,
            reason: req.reason,
            resolve,
          });

          // Also send Telegram approval request if this is a Telegram channel
          const telegramChatId = channelRouter.getTelegramChatId(targetChannel);
          if (telegramChatId) {
            const toolCallId = pendingToolCallIdRef.current;
            if (toolCallId) {
              pendingApprovalsRef.current.set(toolCallId, { resolve });
              channelRouter.sendTelegramApproval(telegramChatId, req.name, req.input, toolCallId);
            } else {
              // Fallback: generate a key so resolve still works
              const fallbackId = `tg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
              pendingApprovalsRef.current.set(fallbackId, { resolve });
              channelRouter.sendTelegramApproval(telegramChatId, req.name, req.input, fallbackId);
            }
          }
        }),
      });
      channelTurnLoops.set(targetChannel, loop);
    }
    loopRef.current = loop;

    const channelMsgs = channelMessages[targetChannel] || [];
    setChannelMessages((prev) => ({
      ...prev,
      [targetChannel]: [...channelMsgs, { role: 'user', content: text }],
    }));
    // Also sync the legacy messages for backward compat
    setMessages((prev) => [...prev, { role: 'user', content: text }]);

    busyRef.current = true;
    setStatus('working');

    let assistantText = '';
    toolGroupIndexRef.current = null;

    const unsubs = [
      loop.eventBus.subscribe('assistant-delta', (e: Event) => {
        if (e.type !== 'assistant-delta') return;
        assistantText += e.text;
        setChannelMessages((prev) => {
          const chMsgs = prev[targetChannel] || [];
          // Seal the tool-group: replace its content with a compact "[N tools]" summary.
          let base = chMsgs;
          const gi = toolGroupIndexRef.current;
          if (gi !== null && base[gi]?.role === 'tool-group') {
            const names = (base[gi]!.content.split(' · ') as string[]);
            const count = names.length;
            const summary = count <= 3
              ? `[${names.join(' · ')}]`
              : `[${count} tools: ${names.slice(0, 2).join(', ')}, …]`;
            base = [...base.slice(0, gi), { role: 'tool-group' as const, content: summary }, ...base.slice(gi + 1)];
            toolGroupIndexRef.current = null;
          }
          const last = base[base.length - 1];
          if (last && last.role === 'assistant') {
            return { ...prev, [targetChannel]: [...base.slice(0, -1), { role: 'assistant' as const, content: assistantText }] };
          }
          return { ...prev, [targetChannel]: [...base, { role: 'assistant' as const, content: assistantText }] };
        });
        // Also sync to legacy messages
        setMessages((prev) => {
          // Seal the tool-group
          let base = prev;
          const gi = toolGroupIndexRef.current;
          if (gi !== null && base[gi]?.role === 'tool-group') {
            const names = (base[gi]!.content.split(' · ') as string[]);
            const count = names.length;
            const summary = count <= 3
              ? `[${names.join(' · ')}]`
              : `[${count} tools: ${names.slice(0, 2).join(', ')}, …]`;
            base = [...base.slice(0, gi), { role: 'tool-group' as const, content: summary }, ...base.slice(gi + 1)];
            toolGroupIndexRef.current = null;
          }
          const last = base[base.length - 1];
          if (last && last.role === 'assistant') {
            return [...base.slice(0, -1), { role: 'assistant' as const, content: assistantText }];
          }
          return [...base, { role: 'assistant' as const, content: assistantText }];
        });
      }),
      loop.eventBus.subscribe('session-start', (e: Event) => {
        if (e.type === 'session-start') {
          sessionIdRef.current = e.id;
          (globalThis as { __CurieSessionId?: string }).__CurieSessionId = e.id;
        }
      }),
      loop.eventBus.subscribe('session-resumed', (e: Event) => {
        if (e.type === 'session-resumed' && e.turnsRecovered > 0) {
          const bannerText = `Context restored: ${e.turnsRecovered} turn(s) from session ${e.id}`;
          setMessages(prev => [...prev, { role: 'system' as const, content: bannerText }]);
          setChannelMessages((prev) => ({
            ...prev,
            [targetChannel]: [...(prev[targetChannel] || []), { role: 'system' as const, content: bannerText }],
          }));
        }
      }),
      loop.eventBus.subscribe('usage', (e: Event) => {
        if (e.type === 'usage') {
          setInputTokens(e.inputTokens);
          setOutputTokens(e.outputTokens);
        }
      }),
      loop.eventBus.subscribe('tool-call', (e: Event) => {
        if (e.type !== 'tool-call') return;
        // Extract a human-readable detail from the tool input.
        const detail = (() => {
          const data = e.input as Record<string, unknown>;
          if (data.path && typeof data.path === 'string') return data.path;
          if (data.file_path && typeof data.file_path === 'string') return data.file_path;
          if (data.path && typeof data.path === 'number') return String(data.path);
          if (data.query && typeof data.query === 'string') return data.query;
          if (data.url && typeof data.url === 'string') return data.url;
          if (data.text && typeof data.text === 'string') return data.text;
          if (data.command && typeof data.command === 'string') return data.command;
          if (data.prompt && typeof data.prompt === 'string') return data.prompt.slice(0, 80);
          if (Object.keys(data).length > 0) {
            return Object.entries(data).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');
          }
          return '';
        })();
        const display = detail ? `${e.name}: ${detail}` : e.name;
        // Update both per-channel and legacy messages
        const updateToolCall = (msgs: typeof channelMessages[string]) => {
          const gi = toolGroupIndexRef.current;
          if (gi !== null && msgs[gi]?.role === 'tool-group') {
            const updated = { ...msgs[gi]!, content: `${msgs[gi]!.content} · ${display}` };
            return [...msgs.slice(0, gi), updated, ...msgs.slice(gi + 1)];
          }
          toolGroupIndexRef.current = msgs.length;
          return [...msgs, { role: 'tool-group' as const, content: display }];
        };
        setChannelMessages((prev) => {
          const chMsgs = prev[targetChannel] || [];
          return { ...prev, [targetChannel]: updateToolCall(chMsgs) };
        });
        setMessages((prev) => updateToolCall(prev));
      }),
      loop.eventBus.subscribe('tool-result', (e: Event) => {
        if (e.type !== 'tool-result') return;
        if (e.error) {
          const resultMsg: typeof channelMessages[string][number] = { role: 'tool' as const, content: `Error: ${e.error}` };
          setChannelMessages((prev) => ({ ...prev, [targetChannel]: [...(prev[targetChannel] || []), resultMsg] }));
          setMessages((prev) => [...prev, resultMsg]);
          return;
        }
        // Detect plan file creation: Write result referencing plans/*.md while in plan mode.
        if (currentMode === 'plan' && e.output && typeof e.output === 'object') {
          const path = (e.output as { path?: string }).path;
          if (typeof path === 'string' && /plans[\\/][^\\/]+\.md$/i.test(path)) {
            planFileRef.current = path;
          }
        }
      }),
      loop.eventBus.subscribe('error', (e: Event) => {
        if (e.type === 'error') {
          const errMsg: typeof channelMessages[string][number] = { role: 'tool' as const, content: 'Error: ' + e.message };
          setChannelMessages((prev) => ({ ...prev, [targetChannel]: [...(prev[targetChannel] || []), errMsg] }));
          setMessages((prev) => [...prev, errMsg]);
        }
      }),
      loop.eventBus.subscribe('approval-request', (e: Event) => {
        if (e.type === 'approval-request' && e.decision === 'ask') {
          pendingToolCallIdRef.current = e.toolCallId;
        }
      }),
    ];

    let runResult: Awaited<ReturnType<typeof loop.run>> | undefined;
    try {
      runResult = await loop.run(text);
    } finally {
      // Update channel registry with the real session ID (handles placeholder → real session)
      if (runResult) {
        channelRegistry.updateSession(targetChannel, runResult.sessionId);
      }
      // Persist full TurnLoop messages for slash commands (e.g. /context messages)
      sessionMessagesRef.current = loop.getMessages();
      unsubs.forEach(u => u());
      toolGroupIndexRef.current = null;
      busyRef.current = false;
      // Flush any queued background messages now that the turn finished.
      // They were queued to avoid displacing the streaming assistant response;
      // now they can be appended as regular inline messages.
      const queue = backgroundMessageQueueRef.current;
      if (queue.length > 0) {
        backgroundMessageQueueRef.current = [];
        setChannelMessages(prev => {
          const ch = prev[activeChannelId] || [];
          return { ...prev, [activeChannelId]: [...ch, ...queue] };
        });
      }
      loopRef.current = null;
      setStatus('idle');
      // Route response back to Telegram if this is a Telegram channel
      const telegramChatId = channelRouter.getTelegramChatId(targetChannel);
      if (telegramChatId && assistantText) {
        const text = assistantText.length > 4096 ? assistantText.slice(0, 4096) : assistantText;
        await channelRouter.sendTelegramResponse(telegramChatId, text).catch(console.error);
        telegramGateway?.stopTyping(telegramChatId);
      } else {
        // Fallback: legacy Telegram routing for main channel
        const chatId = telegramChatIdRef.current;
        if (chatId && assistantText) {
          const text = assistantText.length > 4096 ? assistantText.slice(0, 4096) : assistantText;
          telegramGateway?.sendMessage(chatId, text).catch(console.error);
          telegramGateway?.stopTyping(chatId);
        }
        telegramChatIdRef.current = null;
      }
    }

    // Post-turn: if a plan file was just written, auto-switch to `auto` mode
    // and tell the user so they can approve by sending the next message.
    if (planFileRef.current) {
      const pf = planFileRef.current;
      planFileRef.current = null;
      const planMsg: typeof channelMessages[string][number] = {
        role: 'system',
        content: `Plan written to ${pf}. Switching to auto mode — send any message to execute, or /mode plan to keep planning.`,
      };
      setChannelMessages((prev) => ({
        ...prev,
        [targetChannel]: [...(prev[targetChannel] || []), planMsg],
      }));
      setMessages(prev => [...prev, planMsg]);
      setCurrentMode('auto');
      settingsMgr.current!.update({ mode: 'auto' });
    }
  }, [streamProviderHolder, currentModel, currentMode, currentCwd, currentSystem, currentDebug, currentEffort, activeChannelId, channelMessages, channelRegistry, channelRouter]);

  // Wire submit ref so gateway can inject Telegram messages into the turn loop
  useEffect(() => {
    telegramSubmitRef.current = onSubmit;
  }, [onSubmit, telegramSubmitRef]);

  const onBashCommand = useCallback((command: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStatus('running shell');
    setMessages(prev => [...prev, { role: 'user', content: `! ${command}` }]);

    // Handle `cd` (and `chdir`) ourselves so directory changes persist across
    // subsequent `!` invocations. Match: cd, cd <arg>, cd "a b"/'a b', chdir.
    const cdMatch = command.trim().match(/^(?:cd|chdir)(?:\s+(.+))?\s*$/i);
    if (cdMatch) {
      const rawArg = (cdMatch[1] ?? '').trim();
      const stripped = rawArg
        .replace(/^"(.*)"$/, '$1')
        .replace(/^'(.*)'$/, '$1');
      const target = stripped.length === 0
        ? homedir()
        : stripped === '-'
          ? shellCwdRef.current
          : stripped.startsWith('~')
            ? resolve(homedir(), stripped.slice(1).replace(/^[\\/]/, ''))
            : isAbsolute(stripped)
              ? stripped
              : resolve(shellCwdRef.current, stripped);

      let content: string;
      if (!existsSync(target)) {
        content = `$ ${command}\ncd: no such directory: ${target}\n[exit 1]`;
      } else if (!statSync(target).isDirectory()) {
        content = `$ ${command}\ncd: not a directory: ${target}\n[exit 1]`;
      } else {
        shellCwdRef.current = target;
        loopRef.current?.setCwd(target);
        content = `$ ${command}\n${target}\n[exit 0]`;
      }
      setMessages(prev => [...prev, { role: 'tool', content }]);
      busyRef.current = false;
      setStatus('idle');
      return;
    }

    const isWin = process.platform === 'win32';
    const shell = isWin ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
    const shellArgs = isWin ? ['/c', command] : ['-c', command];
    const child = spawn(shell, shellArgs, {
      cwd: shellCwdRef.current,
      env: process.env,
    });
    shellChildRef.current = child;

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', d => { stdout += d.toString(); });
    child.stderr?.on('data', d => { stderr += d.toString(); });

    child.on('close', code => {
      const output = [stdout.trimEnd(), stderr.trimEnd()].filter(Boolean).join('\n');
      const content = output.length
        ? `$ ${command}\n${output}\n[exit ${code ?? 0}]`
        : `$ ${command}\n[exit ${code ?? 0}]`;
      setMessages(prev => [...prev, { role: 'tool', content }]);
      shellChildRef.current = null;
      busyRef.current = false;
      setStatus('idle');
    });

    child.on('error', err => {
      setMessages(prev => [
        ...prev,
        { role: 'tool', content: `$ ${command}\nError: ${err.message}` },
      ]);
      shellChildRef.current = null;
      busyRef.current = false;
      setStatus('idle');
    });
  }, []);

  const onEffortChange = useCallback((effort: string) => {
    setCurrentEffort(effort as typeof currentEffort);
    settingsMgr.current!.update({ effort: effort as typeof currentEffort });
    loopRef.current = null;
    const usr = { role: 'user' as const, content: `/effort ${effort}` };
    const asst = { role: 'assistant' as const, content: `Effort set to ${effort}.` };
    setChannelMessages((prev) => {
      const ch = prev[activeChannelId] || [];
      return { ...prev, [activeChannelId]: [...ch, usr, asst] };
    });
    setMessages(prev => [...prev, usr, asst]);
  }, []);

  const onModeChange = useCallback((mode: string) => {
    setCurrentMode(mode);
    settingsMgr.current!.update({ mode: mode as CurieMode });
    // Rebuild the TurnLoop on next turn so the permission engine picks up
    // the new approval mode.
    loopRef.current = null;
    const usr = { role: 'user' as const, content: `/mode ${mode}` };
    const asst = { role: 'assistant' as const, content: `Mode set to ${mode}.` };
    setChannelMessages((prev) => {
      const ch = prev[activeChannelId] || [];
      return { ...prev, [activeChannelId]: [...ch, usr, asst] };
    });
    setMessages(prev => [...prev, usr, asst]);
  }, []);

  const onInterrupt = useCallback(() => {
    let interrupted = false;
    if (loopRef.current && busyRef.current) {
      loopRef.current.cancel();
      interrupted = true;
    }
    if (shellChildRef.current) {
      try {
        shellChildRef.current.kill('SIGTERM');
      } catch {
        // ignore — child may have already exited
      }
      interrupted = true;
    }
    if (interrupted) {
      setMessages(prev => [...prev, { role: 'system', content: '[interrupted]' }]);
    }
  }, []);

  const onApprovalDecision = useCallback((decision: 'allow' | 'deny') => {
    setPendingApproval(prev => {
      if (prev) prev.resolve(decision === 'allow');
      return null;
    });
    // Also clean up any stale Telegram pending approvals for this tool call
    const currentToolCallId = pendingToolCallIdRef.current;
    if (currentToolCallId) {
      pendingApprovalsRef.current.delete(currentToolCallId);
    }
  }, []);

  const onSelectProject = useCallback((p: { label: string; projectPath: string }) => {
    if (!existsSync(p.projectPath) || !statSync(p.projectPath).isDirectory()) {
      setMessages(prev => [...prev, { role: 'system', content: `Cannot switch to project: directory not found (${p.projectPath})` }]);
      return;
    }
    setCurrentCwd(p.projectPath);
    shellCwdRef.current = p.projectPath;
    setCurrentSystem(loadAgentPrompt(p.projectPath));
    loopRef.current = null;
    setMessages(prev => [...prev, { role: 'system', content: `Active project switched to ${p.label} (${p.projectPath})` }]);
  }, []);

  const project = basename(currentCwd);
  const cost = estimateCost(currentModel, inputTokens ?? 0, outputTokens ?? 0, settingsMgr.current?.get().MODEL_COST);

  // Build channel entries for the Channels tab
  const channelList = channelRegistry.list();
  const channelTabEntries: ChannelTabEntry[] = channelList.map(ch => ({
    id: ch.id,
    type: ch.type,
    identifier: ch.identifier,
    displayName: ch.displayName,
    sessionId: ch.sessionId,
    messageCount: (channelMessages[ch.id] || []).length,
    isActive: ch.id === activeChannelId,
  }));

  return (
    <ChatSurface
      messages={channelMessages[activeChannelId] || []}
      model={currentModel}
      provider={currentProvider}
      approvalMode={currentMode}
      effort={currentEffort}
      inputTokens={inputTokens}
      outputTokens={outputTokens}
      contextWindowSize={contextWindowSize}
      project={project}
      duration={duration}
      costUsd={cost}
      activeTab={currentTab}
      status={status}
      contextMode="CodeContext Zen"
      agent={currentModel}
      onSubmit={onSubmit}
      onSlashCommand={onSlashCommand}
      onBashCommand={onBashCommand}
      onInterrupt={onInterrupt}
      onEffortChange={onEffortChange}
      onModeChange={onModeChange}
      onCancel={() => process.exit(0)}
      theme={theme}
      projects={projects}
      agents={agents}
      channels={channelTabEntries}
      onChannelSelect={(channelId) => {
        setActiveChannelId(channelId);
        settingsMgr.current!.update({ CHANNEL_TAB_ACTIVE: channelId });
        setCurrentTab('assistant');
      }}
      pendingApproval={pendingApproval ? {
        toolName: pendingApproval.toolName,
        input: pendingApproval.input,
        reason: pendingApproval.reason,
      } : null}
      onApprovalDecision={onApprovalDecision}
      onSelectProject={onSelectProject}
      historyArray={userInputHistory}
      historyIndexRef={userInputHistoryIndexObj}
      setHistoryIndexFn={setUserInputHistoryIndex}
    />
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createProvider(settings: CurieSettings): any | null {
  const providerName =
    typeof settings.MODEL_PROVIDER === 'string'
      ? settings.MODEL_PROVIDER.trim().toLowerCase()
      : 'anthropic';

  if (providerName === 'openai') {
    const openaiKey =
      (typeof settings.OPENAI_API_KEY === 'string' ? settings.OPENAI_API_KEY.trim() : '') ||
      process.env.OPENAI_API_KEY ||
      '';
    const openaiUrl =
      (typeof settings.OPENAI_URL === 'string' ? settings.OPENAI_URL.trim() : '') ||
      process.env.OPENAI_URL ||
      '';
    if (!openaiKey) {
      console.error(
        'curie-agent: no OpenAI API key configured.\n' +
          '  Run `curie-agent` and use `/init` to configure, or set "OPENAI_API_KEY" in ~/.curie-agent/settings.json.',
      );
      return null;
    }
    const p = new OpenAIProvider(openaiKey, openaiUrl || undefined);
    return { name: p.name, stream: p.stream.bind(p), check: p.check.bind(p) };
  }

  if (providerName === 'openrouter') {
    const orKey =
      (typeof settings.OPENROUTER_API_KEY === 'string' ? settings.OPENROUTER_API_KEY.trim() : '') ||
      process.env.OPENROUTER_API_KEY ||
      '';
    const orUrl =
      (typeof settings.OPENROUTER_URL === 'string' ? settings.OPENROUTER_URL.trim() : '') ||
      process.env.OPENROUTER_URL ||
      'https://openrouter.ai/api/v1';
    if (!orKey) {
      console.error(
        'curie-agent: no OpenRouter API key configured.\n' +
          '  Run `curie-agent` and use `/init` to configure, or set "OPENROUTER_API_KEY" in ~/.curie-agent/settings.json.',
      );
      return null;
    }
    const p = new OpenRouterProvider(orKey, orUrl);
    return { name: 'openrouter', stream: p.stream.bind(p), check: p.check.bind(p), complete: p.complete.bind(p) };
  }

  if (providerName === 'ollama' || providerName === 'local') {
    const key =
      (typeof settings.MODEL_API_KEY === 'string' ? settings.MODEL_API_KEY.trim() : '') ||
      process.env.MODEL_API_KEY ||
      '';
    const url =
      (typeof settings.MODEL_URL === 'string' ? settings.MODEL_URL.trim() : '') ||
      process.env.MODEL_URL ||
      '';
    if (!url) {
      console.error(
        'curie-agent: no local provider URL configured.\n' +
          '  Run `curie-agent` and use `/init` to configure, or set "MODEL_URL" in ~/.curie-agent/settings.json.',
      );
      return null;
    }
    const p = new OllamaProvider(key || undefined, url || undefined);
    const displayName = providerName === 'ollama' ? 'ollama' : 'local';
    return { name: displayName, stream: p.stream.bind(p), check: p.check.bind(p) };
  }

  if (providerName === 'google') {
    const googleKey =
      (typeof settings.GOOGLE_API_KEY === 'string' ? settings.GOOGLE_API_KEY.trim() : '') ||
      process.env.GOOGLE_API_KEY ||
      '';
    const googleUrl =
      (typeof settings.GOOGLE_URL === 'string' ? settings.GOOGLE_URL.trim() : '') ||
      process.env.GOOGLE_URL ||
      '';
    if (!googleKey) {
      console.error(
        'curie-agent: no Google API key configured.\n' +
          '  Run `curie-agent` and use `/init` to configure, or set "GOOGLE_API_KEY" in ~/.curie-agent/settings.json.',
      );
      return null;
    }
    const p = new GoogleGeminiProvider(googleKey, googleUrl || undefined);
    return { name: p.name, stream: p.stream.bind(p), check: p.check.bind(p) };
  }

  // anthropic (default)
  const fromSettingsKey =
    typeof settings.ANTHROPIC_API_KEY === 'string' ? settings.ANTHROPIC_API_KEY.trim() : '';
  const fromSettingsUrl =
    typeof settings.ANTHROPIC_URL === 'string' ? settings.ANTHROPIC_URL.trim() : '';
  const apiKey = fromSettingsKey || process.env.ANTHROPIC_API_KEY || '';
  const baseUrl = fromSettingsUrl || process.env.ANTHROPIC_URL || '';
  if (!apiKey) {
    console.error(
      'curie-agent: no API key configured.\n' +
        `  Looked at ~/.curie-agent/settings.json (ANTHROPIC_API_KEY = ${fromSettingsKey ? '[set]' : '[missing/empty]'}),\n` +
        `  and ANTHROPIC_API_KEY env var (${process.env.ANTHROPIC_API_KEY ? '[set]' : '[missing]'}).\n` +
        '  Run `curie-agent` and use `/init` to configure, or set "ANTHROPIC_API_KEY" in ~/.curie-agent/settings.json.',
    );
    return null;
  }
  const p = new AnthropicProvider(apiKey, baseUrl || undefined);
  return { name: p.name, stream: p.stream.bind(p), check: p.check.bind(p) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = args.cwd || join(homedir(), '.curie-agent'); 

  if (args.version) {
    console.log(`curie-agent ${VERSION}`);
    process.exit(0);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Load persisted settings
  const settingsManager = new SettingsManager();
  const settings = settingsManager.load();

  // CLI flags override settings, settings override defaults
  const model = args.model || settings.model || DEFAULT_SETTINGS.model;
  const themeName = settings.theme || DEFAULT_SETTINGS.theme;
  const approvalMode = args.approvalMode || settings.mode || DEFAULT_SETTINGS.mode;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const streamProviderHolder = { current: null as any };

  streamProviderHolder.current = createProvider(settings);
  const system = loadAgentPrompt(cwd);

  // Initialize cron manager for reminders
  const cronManager = new CronManager();

  // Auto-create unified heartbeat task if HEARTBEAT=on
  const hbSettings = cronManager.load();
  const s = settingsManager.load();
  if (s.HEARTBEAT === 'on' && !hbSettings.tasks.some((t) => t.type === 'heartbeat')) {
    const picked = pickNextSchedule({
      HEARTBEAT_INTRADAY: s.HEARTBEAT_INTRADAY,
      HEARTBEAT_DAILY: s.HEARTBEAT_DAILY,
      HEARTBEAT_WEEKLY: s.HEARTBEAT_WEEKLY,
      HEARTBEAT_MONTHLY: s.HEARTBEAT_MONTHLY,
      HEARTBEAT_DREAMING: s.HEARTBEAT_DREAMING,
    }, Date.now());
    if (picked) {
      cronManager.createHeartbeat('Heartbeat: unified schedule', picked);
    }
  } else if (hbSettings.tasks.some((t) => t.type === 'heartbeat')) {
    // Consolidate: if multiple pending heartbeat tasks exist, cancel duplicates
    const hbTasks = hbSettings.tasks.filter((t) => t.type === 'heartbeat' && t.status === 'pending');
    if (hbTasks.length > 1) {
      hbTasks.sort((a, b) => a.scheduledAt - b.scheduledAt);
      for (const dup of hbTasks.slice(1)) {
        dup.status = 'cancelled';
      }
      cronManager.save();
    }
  }

  // Mutable holder for the reminder notification callback.
  // Created outside the component since hooks can't be called in main().
  const onReminderHolder = { current: null as OnReminderCallback | null };

  // Ref to the submit function — the Telegram gateway uses this to inject messages into the turn loop
  const telegramSubmitRef = { current: null as ((text: string) => void) | null };
  // Ref to store the chat ID of the current Telegram conversation (set by gateway callback)
  const telegramChatIdRef = { current: null as string | null };
  // Ref to track the active channel for multi-channel support
  const activeChannelRef = { current: null as string | null };

  // Channel management for multi-channel conversation separation
  const channelRegistry = new ChannelRegistry();
  // Send function for ChannelRouter
  const sendTelegram = async (chatId: string, text: string) => {
    if (telegramGateway) {
      await telegramGateway.sendMessage(chatId, text);
    }
  };
  // Send approval request for ChannelRouter
  const sendApproval = async (
    chatId: string,
    toolName: string,
    input: Record<string, unknown>,
    toolCallId: string,
  ) => {
    if (telegramGateway) {
      // Build a human-readable summary from the tool input
      const data = input as Record<string, unknown>;
      const esc = (s: unknown) => {
        const str = typeof s === 'string' ? s : JSON.stringify(s);
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[^\x20-\x7E]/g, '');
      };
      let summary = '';
      if (toolName === 'Edit') {
        const filePath = esc(data.path ?? data.file_path ?? 'unknown');
        const oldLines = esc(data.old_string as string)?.split('\n').slice(0, 3).join(' ') || '';
        const newLines = esc(data.new_string as string)?.split('\n').slice(0, 3).join(' ') || '';
        summary = `File: ${filePath}\n---\n${oldLines}\n+++\n${newLines}`;
      }
      else if (data.command && typeof data.command === 'string') summary = 'Command: ' + esc(data.command);
      else if (data.path && typeof data.path === 'string') summary = 'Path: ' + esc(data.path);
      else if (data.file_path && typeof data.file_path === 'string') summary = 'Path: ' + esc(data.file_path);
      else if (data.query && typeof data.query === 'string') summary = 'Query: ' + esc(data.query);
      else if (data.url && typeof data.url === 'string') summary = 'URL: ' + esc(data.url);
      else if (data.text && typeof data.text === 'string') summary = 'Text: ' + esc(data.text).slice(0, 100);
      else summary = esc(JSON.stringify(data));
      try {
        await telegramGateway.sendApprovalRequest(chatId, toolCallId, toolName, summary);
      } catch (err) {
        console.error('[cli] sendApproval failed:', err);
      }
    }
  };
  const channelRouter = new ChannelRouter(channelRegistry, sendTelegram, settingsManager, sendApproval);
  // Create the "main" channel if it doesn't exist
  const mainSessionId = ''; // Will be created on first turn
  channelRegistry.getOrCreate('cli', 'main', mainSessionId, 'Main');

  // Create Telegram gateway outside React lifecycle so it stays alive
  let telegramGateway: TelegramGateway | null = null;
  if (settings.TELEGRAM_BOT_TOKEN && settings.TELEGRAM_USER_ID) {
    telegramGateway = new TelegramGateway({
      botToken: settings.TELEGRAM_BOT_TOKEN,
      allowedUserId: settings.TELEGRAM_USER_ID,
      onUserMessage: (ctx: { text: string; chatId: string; userId: string; isGroup: boolean; chatTitle?: string }) => {
        console.error(`[telegram-gateway] onUserMessage: chatId=${ctx.chatId}, isGroup=${ctx.isGroup}`);
        // Route through ChannelRouter to get the channel for this chat
        const route = channelRouter.onTelegramMessage(ctx);
        if (route) {
          // Store for response routing
          telegramChatIdRef.current = ctx.chatId;
          settingsManager.update({ TELEGRAM_CHAT_ID: ctx.chatId });
          // Set active channel so onSubmit knows where to route
          activeChannelRef.current = route.channelId;
          if (telegramSubmitRef.current) {
            telegramSubmitRef.current(ctx.text);
          } else {
            console.error('[telegram-gateway] No submit handler available');
          }
        } else {
          console.error('[telegram-gateway] Message rejected (group or channel error)');
        }
      },
    });
    telegramGateway.start().catch(console.error);
    console.error(`[telegram-gateway] Bot started for user ${settings.TELEGRAM_USER_ID}`);
  }

  // --- MCP server connections ---
  const mcpServersRaw = settings.MCP_SERVERS;
  const mcpToolsRef: React.MutableRefObject<typeof allTools> = { current: [] };
  const mcpClientsRef: React.MutableRefObject<Array<{ serverId: string; isConnected: boolean; tools: ReadonlyArray<{ name: string }> }>> = { current: [] };
  const mcpRawClientsRef: React.MutableRefObject<MCPClient[]> = { current: [] };
  // Tracks whether MCP config has changed (via /mcp add/remove) since last connection.
  // Prevents unnecessary reconnect on first user message when MCP is already fresh.
  const mcpNeedsReconnect = { current: false };

  const parseMcpConfigs = (raw: string | Record<string, unknown> | undefined): MCPConfig[] => {
    if (!raw) return [];
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as Record<string, unknown>;
      return Object.values(parsed).map((v) => {
        const r = v as Record<string, unknown>;
        return {
          id: (r.id as string) ?? '',
          name: (r.name as string) ?? '',
          transport: (r.transport as 'stdio' | 'sse' | 'streamable-http') ?? 'stdio',
          command: r.command as string | undefined,
          args: r.args as string[] | undefined,
          env: r.env as Record<string, string> | undefined,
          url: r.url as string | undefined,
          headers: r.headers as Record<string, string> | undefined,
        };
      }) as MCPConfig[];
    } catch {
      return [];
    }
  };

  const reconnectMcp = async () => {
    // Disconnect existing clients
    for (const client of mcpRawClientsRef.current) {
      client.disconnect().catch(() => {});
    }
    mcpRawClientsRef.current = [];
    mcpClientsRef.current = [];
    mcpToolsRef.current = [];

    // Read fresh settings from disk so we pick up settingsManager updates
    const freshSettings = settingsManager.get();
    const configs = parseMcpConfigs(freshSettings.MCP_SERVERS);
    if (configs.length > 0) {
      try {
        console.error(`[mcp] Reconnecting to ${configs.length} MCP server(s)...`);
        const result = await createMcpTools(configs);
        mcpToolsRef.current = result.tools as unknown as typeof allTools;
        mcpClientsRef.current = result.clients.map((c: MCPClient) => ({
          serverId: c.serverId,
          isConnected: c.isConnected,
          tools: c.tools,
        }));
        mcpRawClientsRef.current = result.clients;
        console.error(`[mcp] Connected — ${mcpToolsRef.current.length} tool(s) from ${mcpClientsRef.current.length} server(s)`);
      } catch (err) {
        console.error(`[mcp] Reconnect failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  };

  // Initial MCP connection
  if (mcpServersRaw && (typeof mcpServersRaw === 'string' || typeof mcpServersRaw === 'object')) {
    try {
      const configs = parseMcpConfigs(mcpServersRaw);
      if (configs.length > 0) {
        console.error(`[mcp] Connecting to ${configs.length} MCP server(s)...`);
        const result = await createMcpTools(configs);
        mcpToolsRef.current = result.tools as unknown as typeof allTools;
        mcpClientsRef.current = result.clients.map((c: MCPClient) => ({
          serverId: c.serverId,
          isConnected: c.isConnected,
          tools: c.tools,
        }));
        mcpRawClientsRef.current = result.clients;
        console.error(`[mcp] Connected — ${mcpToolsRef.current.length} tool(s) exposed from ${mcpClientsRef.current.length} server(s)`);
      }
    } catch (err) {
      console.error(`[mcp] Failed to load MCP configs: ${err instanceof Error ? err.message : err}`);
    }
  }
  const mergedTools = [...allTools, ...mcpToolsRef.current];

  if (args.prompt && args.headless) {
    setGlobalCwd(cwd);
    const loop = new TurnLoop({
      provider: streamProviderHolder.current,
      model,
      tools: mergedTools,
      cwd,
      settings,
      approvalMode: (args.approvalMode as any) || 'yolo',
      effort: settings.effort,
      system,
    });

    loop.eventBus.subscribe('assistant-delta', (e: Event) => {
      if (e.type === 'assistant-delta') {
        process.stdout.write(e.text);
      }
    });

    const result = await loop.run(args.prompt);
    process.exit(result.reason === 'error' ? 1 : 0);
  }

  // Override the terminal's default background via OSC 11 so the unpainted
  // cells (padding, gaps between widgets) match the theme instead of showing
  // whatever color the user's terminal profile happens to use.
  const theme = getTheme(themeName);
  const RESET_BG = '\x1b]111\x07';
  process.stdout.write(`\x1b]11;${theme.background}\x07`);
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    // Disconnect MCP clients
    for (const client of mcpRawClientsRef.current) {
      client.disconnect().catch(() => {});
    }
    process.stdout.write(RESET_BG);
    const id = (globalThis as { __CurieSessionId?: string }).__CurieSessionId;
    if (id) {
      process.stdout.write(`\nSession saved. Resume with: curie-agent resume ${id}\n`);
    }
  };
  process.on('exit', restore);
  process.on('SIGINT', () => {
    telegramGateway?.stop();
    cronManager.stopChecker();
    for (const client of mcpRawClientsRef.current) {
      client.disconnect().catch(() => {});
    }
    restore();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    telegramGateway?.stop();
    cronManager.stopChecker();
    for (const client of mcpRawClientsRef.current) {
      client.disconnect().catch(() => {});
    }
    restore();
    process.exit(0);
  });

  const claudeProjects = loadClaudeProjects();

  // Start the background checker — fires reminders every 60 seconds.
  // Notification rendering is handled by App via onReminderHolder.
  // Telegram sends happen here (in main()'s closure) so settingsManager
  // is always fresh — never stale from React props.
  cronManager.startChecker(60_000, async (task: CronTask) => {
    // Handle heartbeat tasks
    if (task.type === 'heartbeat' && task.schedule) {
      const scheduleType = task.schedule.type as ScheduleType;
      const settings = settingsManager.load();
      if (settings.HEARTBEAT !== 'on') {
        return;
      }

      const mcpTools = mcpToolsRef.current;
      const heartbeatTools = mcpTools.length > 0
        ? [...allTools, ...mcpTools]
        : allTools;

      const executor = new HeartbeatExecutor({
        provider: streamProviderHolder.current,
        model: settings.model,
        tools: heartbeatTools,
        cwd: cwd,
        settings,
        effort: 'auto' as any,
        scheduleType,
      });

      try {
        const result = await executor.execute();
        const formatted = HeartbeatDelivery.formatBrief(result);
        const label = `[${scheduleLabel(task.schedule.type)}] `;

        // Deliver to Telegram if configured
        const tgChatId = settings.TELEGRAM_CHAT_ID || null;
        const tgChat = tgChatId ?? telegramChatIdRef.current;
        if (tgChat && telegramGateway) {
          await telegramGateway.sendMessage(tgChat, label + formatted);
        }

        // Re-evaluate all four schedules and update the task's next fire time
        const currentSettings = settingsManager.load();
        cronManager.rescheduleFromSettings({
          HEARTBEAT_INTRADAY: currentSettings.HEARTBEAT_INTRADAY,
          HEARTBEAT_DAILY: currentSettings.HEARTBEAT_DAILY,
          HEARTBEAT_WEEKLY: currentSettings.HEARTBEAT_WEEKLY,
          HEARTBEAT_MONTHLY: currentSettings.HEARTBEAT_MONTHLY,
          HEARTBEAT_DREAMING: currentSettings.HEARTBEAT_DREAMING,
        });

        // Show in TUI via reminder holder (attaches brief to task for UI)
        // Note: rescheduleFromSettings mutates task.schedule.type to the next
        // earliest schedule, so preserve the executed type for the UI title.
        const briefTask = task as CronTask & { heartbeatBrief?: string; executedScheduleType?: string };
        briefTask.heartbeatBrief = formatted;
        briefTask.executedScheduleType = scheduleType;
        onReminderHolder.current?.(briefTask);
      } catch (err) {
        // Heartbeat errors silently ignored — Telegram fallback may surface them
      }
      return;
    }

    // Original reminder handling
    const cb = onReminderHolder.current;
    if (cb) cb(task);

    // Send to Telegram if configured
    const settings = settingsManager.load();
    const chatId = settings.TELEGRAM_CHAT_ID ?? telegramChatIdRef.current;
    if (chatId && telegramGateway) {
      const timeStr = new Date(task.scheduledAt).toLocaleString();
      telegramGateway.sendMessage(chatId, `Curie reminder:\nDate: ${timeStr}\n${task.message}`).catch(() => {});
    }
  });

  render(
    <App
      provider={streamProviderHolder.current}
      streamProviderHolder={streamProviderHolder}
      model={model}
      approvalMode={approvalMode}
      cwd={cwd}
      themeName={themeName}
      system={system}
      settings={settings}
      projects={claudeProjects}
      cronManager={cronManager}
      onReminderHolder={onReminderHolder}
      telegramChatIdRef={telegramChatIdRef}
      telegramSubmitRef={telegramSubmitRef}
      telegramGateway={telegramGateway}
      channelRegistry={channelRegistry}
      channelRouter={channelRouter}
      activeChannelRef={activeChannelRef}
      mcpToolsRef={mcpToolsRef}
      mcpClientsRef={mcpClientsRef}
      mcpNeedsReconnect={mcpNeedsReconnect}
      onMcpReconnect={async () => {
        if (mcpNeedsReconnect.current) {
          mcpNeedsReconnect.current = false;
          await reconnectMcp();
        }
      }}
      contextWindowSize={200_000}
      resumeSession={args.resume}
      resumeSessionId={args.resume ? args.prompt : undefined}
    />,
    {
      exitOnCtrlC: false,
      kittyKeyboard: { mode: 'auto' },
    },
  );
}

main().catch((err) => {
  console.error('curie-agent error:', err);
  process.exit(1);
});
