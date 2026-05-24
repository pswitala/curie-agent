#!/usr/bin/env node

process.title = 'curie-agent';

import { render } from 'ink';
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { spawn, execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';

import { ChatSurface, COLD_START_BANNER, getInitialWizardState, advanceStep, createIdentityFiles, getConfirmationMessage, isAlreadyInitialized, PROVIDER_INFO } from '@curie-agent/tui';
import type { InitWizardState } from '@curie-agent/tui';
import { getTheme } from '@curie-agent/render';
import { SettingsManager, DEFAULT_SETTINGS } from '@curie-agent/core';
import type { CurieSettings } from '@curie-agent/core';
import { ensureToken, loadToken } from '@curie-agent/daemon';
import type { DaemonServer } from '@curie-agent/daemon';
import type { TabId } from '@curie-agent/tui';
import type { ProjectEntry } from '@curie-agent/tui';
import type { AgentEntry } from '@curie-agent/tui';
import type { ChannelTabEntry } from '@curie-agent/tui';
import type { EffortLevel } from '@curie-agent/tui';
import type { ModeLevel } from '@curie-agent/tui';
import { AnthropicProvider, OpenAIProvider, OllamaProvider, GoogleGeminiProvider, OpenRouterProvider } from '@curie-agent/providers';
import { allTools, discoverAllSkills, formatSkillsForPrompt } from '@curie-agent/tools';
import { createMcpTools } from '@curie-agent/mcp';
import type { MCPConfig } from '@curie-agent/mcp';
import { DaemonRpcClient, DaemonWsClient } from './daemon-client.js';
import type { WsEvent } from './daemon-client.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
const VERSION = pkg.version;

// Module-level user input history — survives App remounts by Ink.
const userInputHistory: string[] = [];
const userInputHistoryIndexObj = { current: -1 };
const setUserInputHistoryIndex = (idx: number) => { userInputHistoryIndexObj.current = idx; };

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface Args {
  version?: boolean;
  help?: boolean;
  headless?: boolean;
  outputFormat?: string;
  model?: string;
  approvalMode?: string;
  session?: string;
  cwd?: string;
  resume?: boolean;
  daemon?: string;
  web?: string;
  sessions?: string;
  prompt?: string;
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
    } else if (arg === 'daemon') {
      args.daemon = argv[i + 1]?.startsWith('-') ? 'start' : (argv[i + 1] || 'start');
      if (!argv[i + 1]?.startsWith('-')) i++;
    } else if (arg === 'web') {
      args.web = argv[i + 1]?.startsWith('-') ? 'open' : (argv[i + 1] || 'open');
      if (!argv[i + 1]?.startsWith('-')) i++;
    } else if (arg === 'sessions') {
      args.sessions = argv[i + 1]?.startsWith('-') ? 'list' : (argv[i + 1] || 'list');
      if (!argv[i + 1]?.startsWith('-')) i++;
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
  curie-agent daemon [start|stop|token]    HTTP daemon management
  curie-agent web [open|url]               Web dashboard
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
  /remind <message at time>             Create a reminder
  /cron <list|delete|clear>             Manage reminders
  /heartbeat <status|enable|disable|now> Manage heartbeat
`.trim());
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
  const s = String(totalSeconds % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Parse MCP server configs from settings. */
function parseMcpConfigs(raw: string | Record<string, unknown> | undefined): MCPConfig[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw as Record<string, unknown>;
    return Object.entries(parsed).map(([key, v]) => {
      const r = v as Record<string, unknown>;
      return {
        id: key,
        name: (r.name as string) || key,
        transport: (r.transport as 'stdio' | 'sse' | 'streamable-http') ?? 'stdio',
        command: r.command as string | undefined,
        args: r.args as string[] | undefined,
        env: r.env as Record<string, string> | undefined,
        url: r.url as string | undefined,
        headers: r.headers as Record<string, string> | undefined,
      };
    });
  } catch {
    return [];
  }
}

/** Create a provider instance from settings. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createProvider(settings: CurieSettings): any | null {
  const providerName = (settings.current_provider || 'anthropic').trim().toLowerCase();

  if (providerName === 'anthropic') {
    const key = (typeof settings.providers?.anthropic?.api_key === 'string' ? settings.providers.anthropic.api_key.trim() : '')
      || process.env.ANTHROPIC_API_KEY || '';
    const url = (typeof settings.providers?.anthropic?.url === 'string' ? settings.providers.anthropic.url.trim() : '')
      || process.env.ANTHROPIC_URL || '';
    if (!key) return null;
    const p = new AnthropicProvider(key, url || undefined);
    return { name: p.name, stream: p.stream.bind(p), check: p.check.bind(p) };
  }

  if (providerName === 'openai') {
    const key = (typeof settings.providers?.openai?.api_key === 'string' ? settings.providers.openai.api_key.trim() : '')
      || process.env.OPENAI_API_KEY || '';
    const url = (typeof settings.providers?.openai?.url === 'string' ? settings.providers.openai.url.trim() : '')
      || process.env.OPENAI_URL || '';
    if (!key) return null;
    const p = new OpenAIProvider(key, url || undefined);
    return { name: p.name, stream: p.stream.bind(p), check: p.check.bind(p) };
  }

  if (providerName === 'openrouter') {
    const key = (typeof settings.providers?.openrouter?.api_key === 'string' ? settings.providers.openrouter.api_key.trim() : '')
      || process.env.OPENROUTER_API_KEY || '';
    const url = (typeof settings.providers?.openrouter?.url === 'string' ? settings.providers.openrouter.url.trim() : '')
      || process.env.OPENROUTER_URL || 'https://openrouter.ai/api/v1';
    if (!key) return null;
    const p = new OpenRouterProvider(key, url);
    return { name: 'openrouter', stream: p.stream.bind(p), check: p.check.bind(p), complete: p.complete.bind(p) };
  }

  if (providerName === 'ollama') {
    const key = (typeof settings.providers?.ollama?.api_key === 'string' ? settings.providers.ollama.api_key.trim() : '')
      || process.env.MODEL_API_KEY || '';
    const url = (typeof settings.providers?.ollama?.url === 'string' ? settings.providers.ollama.url.trim() : '')
      || process.env.MODEL_URL || '';
    if (!url) return null;
    const p = new OllamaProvider(key || undefined, url || undefined);
    return { name: 'ollama', stream: p.stream.bind(p), check: p.check.bind(p) };
  }

  if (providerName === 'local') {
    const key = (typeof settings.providers?.local?.api_key === 'string' ? settings.providers.local.api_key.trim() : '')
      || process.env.MODEL_API_KEY || '';
    const url = (typeof settings.providers?.local?.url === 'string' ? settings.providers.local.url.trim() : '')
      || process.env.MODEL_URL || '';
    if (!url) return null;
    const p = new OllamaProvider(key || undefined, url || undefined);
    return { name: 'local', stream: p.stream.bind(p), check: p.check.bind(p) };
  }

  if (providerName === 'google') {
    const key = (typeof settings.providers?.google?.api_key === 'string' ? settings.providers.google.api_key.trim() : '')
      || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
    if (!key) return null;
    const p = new GoogleGeminiProvider(key);
    return { name: p.name, stream: p.stream.bind(p), check: p.check.bind(p) };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Daemon management helpers
// ---------------------------------------------------------------------------

const DEFAULT_DAEMON_URL = `http://127.0.0.1:${process.env.PORT || '3457'}`;

/** Build the daemon URL from settings (uses web_ip if set). */
function getDaemonUrl(): string {
  try {
    const sm = new SettingsManager();
    sm.load();
    const ip = sm.get().web_ip || '127.0.0.1';
    const port = process.env.PORT || '3457';
    const url = `http://${ip}:${port}`;
    if (ip !== '127.0.0.1') {
      console.log(`Using daemon URL: ${url} (web_ip=${ip})`);
    }
    return url;
  } catch {
    return DEFAULT_DAEMON_URL;
  }
}

/** Check if the daemon is reachable. */
async function checkDaemon(url: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/health`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Auto-start the daemon as a detached process, then wait for it. */
async function startDaemon(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Resolve the path to this CLI script so we can spawn it as a daemon
    const cliPath = join(__dirname, 'cli.js');
    const child = spawn(process.execPath, [cliPath, 'daemon', 'start'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();

    // Poll until daemon is ready (30s timeout)
    let attempts = 0;
    const token = loadToken() || ensureToken();
    const timer = setInterval(async () => {
      attempts++;
    if (await checkDaemon(getDaemonUrl(), token)) {
        clearInterval(timer);
        resolve();
      }
      if (attempts >= 60) {
        clearInterval(timer);
        reject(new Error('Daemon failed to start within 30s'));
      }
    }, 500);
  });
}

/** Ensure daemon is running; start it if not. */
async function ensureDaemon(): Promise<{ url: string; token: string }> {
  const token = loadToken() || ensureToken();
  const url = process.env.CURIE_DAEMON_URL || getDaemonUrl();

  if (await checkDaemon(url, token)) {
    return { url, token };
  }

  console.log('Starting daemon...');
  await startDaemon();
  return { url, token };
}

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function handleDaemonCommand(subcommand: string): Promise<{ keepRunning: boolean; daemon?: DaemonServer }> {
  switch (subcommand) {
    case 'start': {
      const { getOrCreateDaemonServer } = await import('@curie-agent/daemon');
      const { SessionStore, EventBus } = await import('@curie-agent/core');
      const settingsManager = new SettingsManager();
      settingsManager.load();
      const token = ensureToken();
      const sessionStore = new SessionStore();
      const eventBus = new EventBus();

      // Provider factory
      const createProviderFactory = (s: CurieSettings) => {
        const provider = createProvider(s);
        if (!provider) {
          const orKey = (typeof s.providers?.openrouter?.api_key === 'string' ? s.providers.openrouter.api_key.trim() : '') || '';
          const orUrl = (typeof s.providers?.openrouter?.url === 'string' ? s.providers.openrouter.url.trim() : '') || 'https://openrouter.ai/api/v1';
          const p = new OpenRouterProvider(orKey || 'none', orUrl);
          return { name: 'openrouter', stream: p.stream.bind(p), check: p.check.bind(p) };
        }
        return provider;
      };

      // Build tools array with MCP
      const mcpServersRaw = settingsManager.get().mcp_servers;
      const mcpConfigs = parseMcpConfigs(mcpServersRaw);
      let mergedTools: typeof allTools = allTools;
      if (mcpConfigs.length > 0) {
        const result = await createMcpTools(mcpConfigs);
        mergedTools = [...allTools, ...result.tools] as any;
      }

      // Read AGENTS.md for system prompt (if exists), then append skills catalog
      const agentsPath = join(homedir(), '.curie-agent', 'AGENTS.md');
      const agentsMd = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf-8') : undefined;
      const skills = discoverAllSkills(process.cwd());
      const skillsSection = formatSkillsForPrompt(skills);
      let systemPrompt: string | undefined;
      if (agentsMd && skillsSection) {
        systemPrompt = agentsMd + '\n\n' + skillsSection;
      } else if (agentsMd) {
        systemPrompt = agentsMd;
      } else if (skillsSection) {
        systemPrompt = skillsSection;
      }

      // Read web_ip from settings for daemon binding
      const settings = settingsManager.get();
      const webIp = settings.web_ip || '';
      const port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;

      const daemon = getOrCreateDaemonServer({
        sessionStore,
        settingsManager,
        eventBus,
        createProvider: createProviderFactory,
        tools: mergedTools,
        systemPrompt,
        web_ip: webIp,
        port,
      });
      let daemonUrl: string;
      try {
        const { url } = await daemon.start();
        daemonUrl = url;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Daemon failed to start: ${msg}`);
        process.exit(1);
      }
      console.log(`Daemon started on ${daemonUrl}`);
      console.log(`Token: ${token}`);
      console.log(`Dashboard: ${daemonUrl}?token=${token}`);
      return { keepRunning: true, daemon };
    }
    case 'stop': {
      // Phase 1: In-process daemon
      const { getDaemonInstance } = await import('@curie-agent/daemon');
      const daemon = getDaemonInstance();
      if (daemon) {
        await daemon.stop();
        console.log('Daemon stopped.');
        return { keepRunning: false };
      }
      console.log('No in-process daemon instance.');

      // Phase 2: Kill processes on port 3457
      const PORT = 3457;
      const isWin = platform() === 'win32';
      let pids: string[] = [];

      try {
        if (isWin) {
          const output = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf-8' });
          pids = [...new Set(
            output.trim().split('\n')
              .map(line => line.trim().split(/\s+/).pop()!)
              .filter(Boolean)
          )];
        } else {
          const output = execSync(`lsof -ti:${PORT}`, { encoding: 'utf-8' });
          pids = output.trim().split('\n').filter(Boolean);
        }
      } catch {
        console.log(`No daemon process found on port ${PORT}.`);
        return { keepRunning: false };
      }

      for (const pid of pids) {
        try {
          if (isWin) {
            execSync(`taskkill //PID ${pid} //F`, { stdio: 'inherit' });
          } else {
            execSync(`kill -9 ${pid}`, { stdio: 'inherit' });
          }
          console.log(`Killed process ${pid}.`);
        } catch {
          console.error(`Failed to kill process ${pid}.`);
        }
      }

      console.log(`Killed ${pids.length} daemon process(es) on port ${PORT}.`);
      return { keepRunning: false };
    }
    case 'token': {
      console.log(loadToken() || ensureToken());
      return { keepRunning: false };
    }
    default: {
      console.error(`Unknown daemon command: ${subcommand}\nUse: start | stop | token`);
      return { keepRunning: false };
    }
  }
}

async function handleWebCommand(subcommand: string): Promise<void> {
  const token = loadToken() || ensureToken();
  const url = `${getDaemonUrl()}?token=${token}`;

  switch (subcommand) {
    case 'open': {
      // Ensure daemon is running
      const ok = await checkDaemon(DEFAULT_DAEMON_URL, token);
      if (!ok) {
        console.log('Starting daemon...');
        await startDaemon();
      }
      const openCmd = platform() === 'win32' ? 'start' : platform() === 'darwin' ? 'open' : 'xdg-open';
      spawn(openCmd, [url], { detached: true, stdio: 'ignore' });
      console.log(`Opened ${url}`);
      break;
    }
    case 'url': {
      console.log(url);
      break;
    }
    default:
      console.error(`Unknown web command: ${subcommand}\nUse: open | url`);
      process.exit(1);
  }
}

function handleSessionsCommand(subcommand: string): void {
  const { SessionStore } = require('@curie-agent/core');
  const sessionStore = new SessionStore();

  switch (subcommand) {
    case 'list': {
      const sessions = sessionStore.list();
      if (sessions.length === 0) {
        console.log('No sessions found.');
        return;
      }
      const rows = sessions.map((s: { id: string; cwd: string; model: string; provider: string; createdAt: number; updatedAt: number }) => {
        const created = new Date(s.createdAt).toLocaleString();
        const updated = new Date(s.updatedAt).toLocaleString();
        return `${s.id}  ${s.cwd}  ${s.model}  ${s.provider}  ${created}  ${updated}`;
      });
      console.log(`ID                          CWD  Model  Provider  Created  Updated`);
      console.log(rows.join('\n'));
      break;
    }
    case 'show': {
      const sessions = sessionStore.list();
      if (sessions.length === 0) {
        console.log('No sessions found.');
        return;
      }
      const latest = sessions[sessions.length - 1]!;
      const events = sessionStore.loadEvents(latest.id);
      console.log(`Session: ${latest.id}`);
      console.log(`CWD: ${latest.cwd}`);
      console.log(`Model: ${latest.model}`);
      console.log(`Provider: ${latest.provider}`);
      console.log(`Events: ${events.length}`);
      break;
    }
    case 'rm': {
      const sessions = sessionStore.list();
      if (sessions.length === 0) {
        console.log('No sessions found.');
        return;
      }
      const latest = sessions[sessions.length - 1]!;
      sessionStore.remove(latest.id);
      console.log(`Removed session: ${latest.id}`);
      break;
    }
    default:
      console.error(`Unknown sessions command: ${subcommand}\nUse: list | show | rm`);
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// App component — thin client connecting to daemon
// ---------------------------------------------------------------------------

interface AppProps {
  daemonUrl: string;
  token: string;
  model?: string;
  approvalMode?: string;
  themeName: string;
  cwd?: string;
  resumeSession?: boolean;
  resumeSessionId?: string;
}

function App({ daemonUrl, token, model: initialModel, approvalMode: initialMode, themeName, cwd, resumeSession, resumeSessionId }: AppProps) {
  const rpcRef = useRef<DaemonRpcClient>(new DaemonRpcClient(daemonUrl, token));
  const wsRef = useRef<DaemonWsClient>(new DaemonWsClient(daemonUrl, token));

  const [messages, setMessages] = useState<
    Array<{ role: 'user' | 'assistant' | 'tool' | 'tool-group' | 'system' | 'decision' | 'heartbeat' | 'task' | 'debug' | 'thinking'; content: string; title?: string }>
  >([{ role: 'assistant', content: COLD_START_BANNER }]);

  const [currentModel, setCurrentModel] = useState(initialModel || '');
  const [currentProvider, setCurrentProvider] = useState('connecting...');
  const [currentTheme, setCurrentTheme] = useState(themeName);
  const [currentMode, setCurrentMode] = useState(initialMode || 'auto');
  const currentModeRef = useRef(currentMode);
  useEffect(() => { currentModeRef.current = currentMode; }, [currentMode]);
  const [currentEffort, setCurrentEffort] = useState('auto');
  const [debug, setDebug] = useState(false);
  const debugRef = useRef(debug);
  useEffect(() => { debugRef.current = debug; }, [debug]);
  const [inputTokens, setInputTokens] = useState<number | undefined>(undefined);
  const [outputTokens, setOutputTokens] = useState<number | undefined>(undefined);
  const [currentTab, setCurrentTab] = useState<TabId>('assistant');
  const [duration, setDuration] = useState('00:00:00');
  const [status, setStatus] = useState('idle');
  const [connected, setConnected] = useState(false);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [agents, setAgents] = useState<Map<string, AgentEntry>>(new Map());
  const [channels, setChannels] = useState<ChannelTabEntry[]>([]);

  // Pending approval state
  const [pendingApproval, setPendingApproval] = useState<{
    toolName: string;
    input: Record<string, unknown>;
    reason: string;
  } | null>(null);
  const pendingToolCallIdRef = useRef<string | null>(null);
  const pendingApprovalRef = useRef<null | {
    toolName: string;
    input: Record<string, unknown>;
    reason: string;
  }>(null);
  useEffect(() => { pendingApprovalRef.current = pendingApproval; }, [pendingApproval]);

  // Session tracking
  const sessionIdRef = useRef<string>('main');
  const busyRef = useRef(false);

  // Background message queue (for messages arriving during active turn)
  const backgroundQueueRef = useRef<Array<{ role: 'system' | 'heartbeat' | 'task' | 'debug'; content: string; title?: string }>>([]);

  // Init wizard state
  const [wizardState, setWizardState] = useState<InitWizardState | null>(null);
  const settingsMgrRef = useRef<SettingsManager>(new SettingsManager());
  const settingsLoadedRef = useRef(false);

  const startedAt = useRef(Date.now());

  // Duration timer
  useEffect(() => {
    const id = setInterval(() => {
      setDuration(formatDuration(Date.now() - startedAt.current));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Connect WebSocket
  useEffect(() => {
    const ws = wsRef.current;

    const cleanup = ws.on('*', (event: WsEvent) => {
      handleEvent(event);
    });

    // Specific event handlers
    ws.on('assistant-delta', (event: WsEvent) => {
      const text = String(event.text || '');
      if (!text) return;

      if (busyRef.current) {
        setMessages(prev => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === 'assistant') {
            last.content += text;
          } else {
            next.push({ role: 'assistant', content: text });
          }
          return next;
        });
      }
    });

    ws.on('assistant-stop', () => {
      busyRef.current = false;
      setStatus('idle');

      // Flush background messages
      const queue = backgroundQueueRef.current;
      if (queue.length > 0) {
        setMessages(prev => [...prev, ...queue.map(m => ({
          role: m.role,
          content: m.content,
          title: m.title,
        }))]);
        backgroundQueueRef.current = [];
      }
    });

    ws.on('tool-call', (event: WsEvent) => {
      const name = String(event.name || 'tool');
      const input = (event.input || {}) as Record<string, unknown>;
      const args = Object.keys(input).join(', ');
      setMessages(prev => [...prev, {
        role: 'tool-group',
        content: `${name}: ${args}`,
      }]);
    });

    ws.on('tool-result', (event: WsEvent) => {
      const output = typeof event.output === 'string' ? event.output : JSON.stringify(event.output);
      const error = event.error;
      if (error) {
        setMessages(prev => [...prev, { role: 'tool', content: `[Error] ${error}` }]);
      } else if (debugRef.current) {
        setMessages(prev => [...prev, { role: 'tool', content: output ? `[OK] ${output}` : `[OK] (completed)` }]);
      } else {
        // Non-debug: tool-call already shows the compact name/path, so just mark done
        if (output) {
          // Count lines in the output for a useful summary
          const lineCount = output.split('\n').length;
          setMessages(prev => [...prev, { role: 'tool', content: `[OK] ${lineCount} lines` }]);
        }
      }
    });

    ws.on('approval-request', (event: WsEvent) => {
      // Ignore duplicate requests — modal already shown for another tool call
      if (pendingApprovalRef.current) return;

      const toolCallId = String(event.toolCallId || '');
      const name = String(event.name || 'unknown');
      const input = (event.input || {}) as Record<string, unknown>;
      // In auto/yolo mode the daemon auto-approves — no modal needed
      if (currentModeRef.current === 'auto' || currentModeRef.current === 'yolo') {
        pendingToolCallIdRef.current = toolCallId;
        // Auto-approve immediately
        rpcRef.current.approvalDecide(toolCallId, 'allow').catch(() => {});
        pendingToolCallIdRef.current = null;
        return;
      }
      pendingToolCallIdRef.current = toolCallId;
      setPendingApproval({ toolName: name, input, reason: 'Tool requires approval' });
    });

    ws.on('approval-decision', () => {
      setPendingApproval(null);
      pendingToolCallIdRef.current = null;
    });

    ws.on('usage', (event: WsEvent) => {
      if (event.inputTokens) setInputTokens(Number(event.inputTokens));
      if (event.outputTokens) setOutputTokens(Number(event.outputTokens));
    });

    ws.on('error', (event: WsEvent) => {
      setMessages(prev => [...prev, {
        role: 'system',
        content: `Error: ${event.message}`,
      }]);
      busyRef.current = false;
      setStatus('idle');
    });

    ws.on('session-start', () => {
      setStatus('working');
      busyRef.current = true;
    });

    ws.on('heartbeat-brief', (event: WsEvent) => {
      const msg = {
        role: 'heartbeat' as const,
        title: String(event.scheduleType || 'heartbeat'),
        content: String(event.formattedText || ''),
      };
      if (busyRef.current) {
        backgroundQueueRef.current.push(msg);
      } else {
        setMessages(prev => [...prev, msg]);
      }
    });

    ws.on('cron-task-fired', (event: WsEvent) => {
      const msg = {
        role: event.taskType === 'auto' ? 'task' as const : 'system' as const,
        title: event.taskType === 'auto' ? String(event.message || '') : undefined,
        content: String(event.message || ''),
      };
      if (busyRef.current) {
        backgroundQueueRef.current.push(msg);
      } else {
        setMessages(prev => [...prev, msg]);
      }
    });

    ws.on('daemon-ready', async () => {
      setConnected(true);
      setStatus('idle');

      // Load initial settings from daemon
      try {
        const [modelRes, modeRes, effortRes, debugRes, providerRes] = await Promise.all([
          rpcRef.current.configGet('model').catch(() => null),
          rpcRef.current.configGet('mode').catch(() => null),
          rpcRef.current.configGet('effort').catch(() => null),
          rpcRef.current.configGet('debug').catch(() => null),
          rpcRef.current.providerList().catch(() => []),
        ]);
        if (modelRes) setCurrentModel(String(modelRes));
        if (modeRes) setCurrentMode(String(modeRes));
        if (effortRes) setCurrentEffort(String(effortRes));
        if (debugRes) setDebug(debugRes === true || String(debugRes).toLowerCase() === 'true');
        if (Array.isArray(providerRes) && providerRes.length > 0) {
          setCurrentProvider(String(providerRes[0].name || 'unknown'));
        }
      } catch (err) {
        console.error('[tui] Failed to load initial settings from daemon:', err);
      }
    });

    ws.connect();

    return () => {
      cleanup();
      ws.disconnect();
    };
  }, []);

  // Fallback: fetch settings from daemon once connected (in case daemon-ready event didn't fire in time)
  useEffect(() => {
    if (!connected || settingsLoadedRef.current) return;
    settingsLoadedRef.current = true;
    (async () => {
      try {
        const [modelRes, modeRes, effortRes, debugRes, providerRes] = await Promise.all([
          rpcRef.current.configGet('model').catch(() => null),
          rpcRef.current.configGet('mode').catch(() => null),
          rpcRef.current.configGet('effort').catch(() => null),
          rpcRef.current.configGet('debug').catch(() => null),
          rpcRef.current.providerList().catch(() => []),
        ]);

        if (modelRes) setCurrentModel(String(modelRes));
        if (modeRes) setCurrentMode(String(modeRes));
        if (effortRes) setCurrentEffort(String(effortRes));
        if (debugRes) setDebug(debugRes === true || String(debugRes).toLowerCase() === 'true');
        if (Array.isArray(providerRes) && providerRes.length > 0) {
          setCurrentProvider(String(providerRes[0].name || 'unknown'));
        }
      } catch (err) {
        console.error('[tui] Failed to load initial settings (fallback):', err);
      }
    })();
  }, [connected]);

  // Handle generic event (catch-all for unhandled types)
  const handleEvent = useCallback((event: WsEvent) => {
    // Already handled above by specific handlers
  }, []);

  // Submit message to daemon
  const onSubmit = useCallback(async (text: string) => {
    // Check if wizard is active — route input through state machine
    if (wizardState) {
      setMessages(prev => [...prev, { role: 'user', content: text }]);
      const next = advanceStep(wizardState, text, settingsMgrRef.current.get());
      if (next) {
        setWizardState(next);
        setMessages(prev => [...prev, { role: 'system', content: next.question }]);
        if (next.question === '__COMPLETE__') {
          createIdentityFiles(wizardState.data);
          const info = PROVIDER_INFO[wizardState.data.provider!];
          if (wizardState.data.apiKey) {
            settingsMgrRef.current.setProviderKey(wizardState.data.provider!, 'api_key', wizardState.data.apiKey);
          }
          settingsMgrRef.current.setProviderKey(wizardState.data.provider!, 'model', wizardState.data.model!);
          settingsMgrRef.current.update({ current_provider: wizardState.data.provider!, model: wizardState.data.model! });
          const finalSettings = settingsMgrRef.current.get();
          setCurrentModel(finalSettings.model);
          setCurrentProvider(finalSettings.current_provider);
          setWizardState(null);
          setMessages(prev => [...prev, { role: 'system', content: getConfirmationMessage(wizardState.data) }]);
        }
      }
      return;
    }

    // Add user message to display
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    busyRef.current = true;
    setStatus('working');

    try {
      await rpcRef.current.sessionSend(sessionIdRef.current, text, 'tui');
      // Response will arrive via WebSocket events
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'system',
        content: `Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
      }]);
      busyRef.current = false;
      setStatus('idle');
    }
  }, []);

  // Slash command handler — proxy to daemon
  const onSlashCommand = useCallback(async (input: { command: string; args: string }) => {
    const { command, args } = input;

    // Echo the command
    setMessages(prev => [...prev, { role: 'user', content: `/${command} ${args}` }]);

    try {
      switch (command) {
        case 'model': {
          await rpcRef.current.configSet('model', args.trim());
          setCurrentModel(args.trim());
          setMessages(prev => [...prev, { role: 'system', content: `Model switched to: ${args.trim()}` }]);
          break;
        }
        case 'mode': {
          const mode = args.trim() as ModeLevel;
          await rpcRef.current.configSet('mode', mode);
          setCurrentMode(mode);
          setMessages(prev => [...prev, { role: 'system', content: `Mode switched to: ${mode}` }]);
          break;
        }
        case 'theme': {
          const theme = args.trim();
          await rpcRef.current.configSet('theme', theme);
          setCurrentTheme(theme);
          setMessages(prev => [...prev, { role: 'system', content: `Theme switched to: ${theme}` }]);
          break;
        }
        case 'effort': {
          const effort = args.trim() as EffortLevel;
          await rpcRef.current.configSet('effort', effort);
          setCurrentEffort(effort);
          setMessages(prev => [...prev, { role: 'system', content: `Effort set to: ${effort}` }]);
          break;
        }
        case 'debug': {
          const debug = args.trim().toLowerCase() === 'off' ? false : true;
          await rpcRef.current.configSet('debug', debug);
          setMessages(prev => [...prev, { role: 'system', content: `Debug ${debug ? 'enabled' : 'disabled'}` }]);
          break;
        }
        case 'status': {
          const [statusRes, configRes] = await Promise.all([
            rpcRef.current.daemonStatus().catch(() => ({})),
            rpcRef.current.configGet('model').catch(() => null),
          ]);
          const statusData = statusRes as Record<string, unknown>;
          const modelStr = configRes ? String(configRes) : currentModel;
          setMessages(prev => [...prev, {
            role: 'system',
            content: `Status: ${String(statusData.status || 'ok')}\nVersion: ${VERSION}\nModel: ${modelStr}\nClients: ${String(statusData.clients || 0)}`,
          }]);
          break;
        }
        case 'help': {
          setMessages(prev => [...prev, {
            role: 'system',
            content: `Available commands:\n/model <model> - Switch AI model\n/mode <mode> - Set approval mode\n/theme <name> - Change theme\n/effort <level> - Set reasoning effort\n/debug [on|off] - Toggle debug\n/status - Show status\n/heartbeat <status|enable|disable|now> - Manage heartbeat\n/remind <msg at time> - Create reminder\n/cron <list|delete|clear> - Manage reminders\n/exit - Exit`,
          }]);
          break;
        }
        case 'heartbeat': {
          const action = args.trim();
          if (action === 'now') {
            setMessages(prev => [...prev, { role: 'system', content: 'Running heartbeat...' }]);
            try {
              const result = await rpcRef.current.heartbeatRun();
              const data = result as { text?: string; errors?: string[] };
              if (data?.text) {
                const text = data.text;
                setMessages(prev => [...prev, { role: 'heartbeat', title: 'manual', content: text }]);
              }
            } catch (err) {
              setMessages(prev => [...prev, {
                role: 'system',
                content: `Heartbeat failed: ${err instanceof Error ? err.message : String(err)}`,
              }]);
            }
          } else if (action === 'status') {
            const hb = await rpcRef.current.heartbeatStatus().catch(() => ({}));
            setMessages(prev => [...prev, { role: 'system', content: `Heartbeat: ${JSON.stringify(hb)}` }]);
          } else if (action === 'enable') {
            await rpcRef.current.configSet('heartbeat.schedule', 'on');
            setMessages(prev => [...prev, { role: 'system', content: 'Heartbeat enabled' }]);
          } else if (action === 'disable') {
            await rpcRef.current.configSet('heartbeat.schedule', 'off');
            setMessages(prev => [...prev, { role: 'system', content: 'Heartbeat disabled' }]);
          } else {
            setMessages(prev => [...prev, { role: 'system', content: 'Usage: /heartbeat <status|enable|disable|now>' }]);
          }
          break;
        }
        case 'exit': {
          process.exit(0);
          break;
        }
        case 'remind': {
          setMessages(prev => [...prev, { role: 'system', content: `Reminder feature coming soon` }]);
          break;
        }
        case 'cron': {
          const cronAction = args.trim();
          if (cronAction === 'list') {
            const tasks = await rpcRef.current.cronList().catch(() => []);
            setMessages(prev => [...prev, {
              role: 'system',
              content: Array.isArray(tasks)
                ? `${tasks.length} task(s): ${JSON.stringify(tasks)}`
                : 'No tasks',
            }]);
          } else if (cronAction === 'clear') {
            await rpcRef.current.cronClear().catch(() => {});
            setMessages(prev => [...prev, { role: 'system', content: 'Completed tasks cleared' }]);
          } else {
            setMessages(prev => [...prev, { role: 'system', content: 'Usage: /cron <list|clear>' }]);
          }
          break;
        }
        case 'agent': {
          // Strip --mode and --effort flags from args
          const prompt = args.replace(/--mode\s+\S+\s*/g, '').replace(/--effort\s+\S+\s*/g, '').trim();
          try {
            await rpcRef.current.sessionSend(sessionIdRef.current, `/agent ${prompt}`, 'tui');
          } catch {
            setMessages(prev => [...prev, { role: 'system', content: `Agent started: "${prompt}"` }]);
          }
          break;
        }
        case 'init': {
          const settings = settingsMgrRef.current.load();
          if (!args) {
            if (isAlreadyInitialized()) {
              setMessages(prev => [...prev, { role: 'system', content: 'Already initialized. Provider and settings already configured.' }]);
            } else {
              const initialState = getInitialWizardState(settings);
              setWizardState(initialState);
              setMessages(prev => [...prev, { role: 'system', content: initialState.question }]);
            }
          } else {
            // Legacy: treat as direct API key
            settingsMgrRef.current.setProviderKey('anthropic', 'api_key', args.trim());
            setMessages(prev => [...prev, { role: 'system', content: `API key configured for anthropic.` }]);
          }
          break;
        }

        case 'todo': {
          try {
            await rpcRef.current.sessionSend(sessionIdRef.current, `/todo ${args}`, 'tui');
          } catch {
            setMessages(prev => [...prev, { role: 'system', content: `Todo command failed.` }]);
          }
          break;
        }

        case 'task': {
          try {
            await rpcRef.current.sessionSend(sessionIdRef.current, `/task ${args}`, 'tui');
          } catch {
            setMessages(prev => [...prev, { role: 'system', content: `Task command failed.` }]);
          }
          break;
        }

        case 'todo': {
          try {
            await rpcRef.current.sessionSend(sessionIdRef.current, `/todo ${args}`, 'tui');
          } catch {
            setMessages(prev => [...prev, { role: 'system', content: `Todo command failed.` }]);
          }
          break;
        }

        case 'task': {
          try {
            await rpcRef.current.sessionSend(sessionIdRef.current, `/task ${args}`, 'tui');
          } catch {
            setMessages(prev => [...prev, { role: 'system', content: `Task command failed.` }]);
          }
          break;
        }

        case 'cd': {
          try {
            await rpcRef.current.sessionSend(sessionIdRef.current, `/cd ${args.trim()}`, 'tui');
          } catch {
            setMessages(prev => [...prev, { role: 'system', content: `Failed to change directory. Check the path is valid and within allowed directories.` }]);
          }
          break;
        }

        case 'remind': {
          try {
            await rpcRef.current.sessionSend(sessionIdRef.current, `/remind ${args}`, 'tui');
          } catch {
            setMessages(prev => [...prev, { role: 'system', content: `Reminder command failed.` }]);
          }
          break;
        }
        default: {
          setMessages(prev => [...prev, { role: 'system', content: `Unknown command: /${command}. Type /help for usage.` }]);
        }
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'system',
        content: `Command failed: ${err instanceof Error ? err.message : String(err)}`,
      }]);
    }
  }, [currentModel]);

  // Approval decision handler
  const onApprovalDecision = useCallback(async (decision: 'allow' | 'deny') => {
    const toolCallId = pendingToolCallIdRef.current;
    if (toolCallId) {
      try {
        await rpcRef.current.approvalDecide(toolCallId, decision);
      } catch (err) {
        console.error('Approval decision failed:', err);
      }
    }
    setPendingApproval(null);
    pendingToolCallIdRef.current = null;
  }, []);

  // Mode change handler
  const onModeChange = useCallback(async (mode: ModeLevel) => {
    await rpcRef.current.configSet('mode', mode);
    setCurrentMode(mode);
  }, []);

  // Effort change handler
  const onEffortChange = useCallback(async (effort: EffortLevel) => {
    await rpcRef.current.configSet('effort', effort);
    setCurrentEffort(effort);
  }, []);

  // Interrupt handler (cancel current turn)
  const onInterrupt = useCallback(() => {
    rpcRef.current.sessionCancel(sessionIdRef.current).catch(() => {});
  }, []);

  const theme = getTheme(currentTheme);

  return (
    <ChatSurface
      messages={messages}
      model={currentModel}
      provider={currentProvider}
      approvalMode={currentMode}
      effort={currentEffort}
      inputTokens={inputTokens}
      outputTokens={outputTokens}
      contextWindowSize={200_000}
      contextFillPct={0}
      duration={duration}
      costUsd={0}
      activeTab={currentTab}
      status={status}
      contextMode="CodeContext Zen"
      agent={currentModel}
      onSubmit={onSubmit}
      onSlashCommand={onSlashCommand}
      onInterrupt={onInterrupt}
      onEffortChange={onEffortChange}
      onModeChange={onModeChange}
      onCancel={() => process.exit(0)}
      theme={theme}
      projects={projects}
      agents={agents}
      channels={channels}
      onChannelSelect={() => {}}
      pendingApproval={pendingApproval}
      onApprovalDecision={onApprovalDecision}
      historyArray={userInputHistory}
      historyIndexRef={userInputHistoryIndexObj}
      setHistoryIndexFn={setUserInputHistoryIndex}
    />
  );
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

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

  // Handle daemon subcommands (legacy inline mode)
 if (args.daemon) {
    const result = await handleDaemonCommand(args.daemon);
    if (!result.keepRunning) process.exit(0);
    const daemon = result.daemon;
    const exit = async () => {
      if (daemon) {
        try { await daemon.stop(); } catch { /* ignore */ }
      }
      process.exit(0);
    };
    process.on('SIGINT', exit);
    process.on('SIGTERM', exit);
    return;
  }

  // Handle web subcommands
  if (args.web) {
    await handleWebCommand(args.web);
    process.exit(0);
  }

  // Handle sessions subcommands
  if (args.sessions) {
    handleSessionsCommand(args.sessions);
    process.exit(0);
  }

  // Ensure daemon is running and get connection info
  const { url: daemonUrl, token } = await ensureDaemon();

  // Load local settings for theme
  const settingsManager = new SettingsManager();
  const settings = settingsManager.load();
  const themeName = settings.theme || DEFAULT_SETTINGS.theme;

  // Set terminal background color
  const theme = getTheme(themeName);
  const RESET_BG = '\x1b]111\x07';
  process.stdout.write(`\x1b]11;${theme.background}\x07`);

  const restore = () => {
    process.stdout.write(RESET_BG);
  };
  process.on('exit', restore);
  process.on('SIGINT', () => { restore(); process.exit(0); });
  process.on('SIGTERM', () => { restore(); process.exit(0); });

  // Render the thin-client TUI
  render(
    <App
      daemonUrl={daemonUrl}
      token={token}
      model={args.model}
      approvalMode={args.approvalMode}
      themeName={themeName}
      cwd={cwd}
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
