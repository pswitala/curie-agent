import { CurieSettings } from '../../core/src/settings.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ── Types ───────────────────────────────────────────────────────────────

export type ProviderName = 'anthropic' | 'openai' | 'local' | 'openrouter' | 'ollama';
type WizardStep = 'provider' | 'api_key' | 'model' | 'soul' | 'user' | 'agents' | 'memory' | 'tools' | 'confirm';

export interface InitData {
  provider: ProviderName | null;
  apiKey: string | null;
  model: string | null;
  soul: { name: string; vibe: string };
  user: { name: string; timezone: string; languages: string };
  agentsAccepted: boolean;
}

export interface InitWizardState {
  step: WizardStep;
  data: InitData;
  question: string;
}

// ── Provider config ─────────────────────────────────────────────────────

export const PROVIDER_INFO: Record<ProviderName, {
  label: string;
  number: string;
  defaultModel: string;
  settingsKey: string;
  requiresKey: boolean;
}> = {
  anthropic: {
    label: 'Anthropic',
    number: '1',
    defaultModel: 'claude-sonnet-4-6',
    settingsKey: 'anthropic',
    requiresKey: true,
  },
  openai: {
    label: 'OpenAI',
    number: '2',
    defaultModel: 'gpt-4o',
    settingsKey: 'openai',
    requiresKey: true,
  },
  local: {
    label: 'Local (OpenAI-compatible)',
    number: '3',
    defaultModel: 'custom',
    settingsKey: 'local',
    requiresKey: false,
  },
  openrouter: {
    label: 'OpenRouter',
    number: '4',
    defaultModel: 'anthropic/claude-sonnet-4-6',
    settingsKey: 'openrouter',
    requiresKey: true,
  },
  ollama: {
    label: 'Ollama (Local)',
    number: '5',
    defaultModel: 'custom',
    settingsKey: 'ollama',
    requiresKey: false,
  },
};

const PROVIDER_NAMES = Object.keys(PROVIDER_INFO) as ProviderName[];

// ── Helpers ─────────────────────────────────────────────────────────────

function homeDir(): string {
  return os.homedir();
}

function CurieDir(): string {
  return path.join(homeDir(), '.curie-agent');
}

function filePath(name: string): string {
  return path.join(CurieDir(), name);
}

function writeCurieFile(name: string, content: string): void {
  const dir = CurieDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(filePath(name), content, 'utf-8');
}

function isProviderChoice(input: string): ProviderName | null {
  const trimmed = input.trim().toLowerCase();
  for (const name of PROVIDER_NAMES) {
    if (trimmed === name || trimmed === PROVIDER_INFO[name].number) {
      return name;
    }
  }
  return null;
}

function isYes(input: string): boolean {
  return ['yes', 'y', 'accept', 'a', 'ok', ''].includes(input.trim().toLowerCase());
}

// ── Question generators ─────────────────────────────────────────────────

function getProviderQuestion(existingProvider?: string): string {
  const lines: string[] = [
    'Welcome to curie-agent! Let\'s get you set up. This takes about 2 minutes.\n',
    'Which LLM provider do you want to use?',
  ];
  for (const name of PROVIDER_NAMES) {
    const info = PROVIDER_INFO[name];
    lines.push(`  ${info.number}) ${info.label}`);
  }
  if (existingProvider) {
    const info = PROVIDER_INFO[existingProvider as ProviderName];
    lines.push(`\n(Current: ${info.label}) Type the provider name or number to change, or Enter to keep.`);
  } else {
    lines.push('\nType the provider name or number:');
  }
  return lines.join('\n');
}

function getApiKeyQuestion(provider: ProviderName): string {
  const info = PROVIDER_INFO[provider];
  if (!info.requiresKey) {
    return `No API key needed for ${info.label}. Click Enter to continue.`;
  }
  return `Enter your ${info.label} API key:\n  (saved to ~/.curie-agent/settings.json)`;
}

function getModelQuestion(provider: ProviderName, existingModel?: string): string {
  const defaultModel = PROVIDER_INFO[provider].defaultModel;
  if (existingModel) {
    return `Current model: ${existingModel}\nType a new model name or Enter to keep.`;
  }
  return `Suggested model: ${defaultModel}\nType a custom model name or Enter to accept.`;
}

function getAskName(question: string, defaultVal: string): string {
  return `${question} (default: ${defaultVal})\nYour answer:`;
}

function getIdentityQuestion(step: string, data: InitData): string {
  switch (step) {
    case 'soul-name':
      return getAskName('What should your AI assistant\'s name be?', 'Curie');
    case 'soul-vibe':
      return getAskName('Describe your assistant\'s vibe/personality (1 sentence).', 'AI coding assistant — sharp, resourceful, gets things done');
    case 'user-name':
      return getAskName('What is your name?', 'Paweł');
    case 'user-timezone':
      return getAskName('Your timezone?', 'Europe/Warsaw');
    case 'user-languages':
      return getAskName('Your primary programming languages?', 'TypeScript, Python');
    default:
      return '...';
  }
}

// ── State machine ───────────────────────────────────────────────────────

const SOUL_STEPS = ['soul-name', 'soul-vibe'] as const;
const USER_STEPS = ['user-name', 'user-timezone', 'user-languages'] as const;

function nextIdentityStep(data: InitData): WizardStep | 'confirm' {
  // Soul steps
  if (!data.soul.name) return 'soul';
  const soulStepIdx = SOUL_STEPS.findIndex(s => s === getSubStep(data, 'soul'));
  if (soulStepIdx === -1) {
    // All soul done, move to user
    if (!data.user.name) return 'user';
    const userStepIdx = USER_STEPS.findIndex(s => s === getSubStep(data, 'user'));
    if (userStepIdx === -1) return 'agents';
    return 'user';
  }
  return 'soul';
}

function getSubStep(data: InitData, group: 'soul' | 'user'): string {
  if (group === 'soul') {
    if (!data.soul.name) return 'soul-name';
    return 'soul-vibe';
  }
  if (group === 'user') {
    if (!data.user.name) return 'user-name';
    if (!data.user.timezone) return 'user-timezone';
    return 'user-languages';
  }
  return '';
}

export function advanceStep(state: InitWizardState, answer: string, _settings: CurieSettings): InitWizardState | null {
  const { step, data } = state;
  const nextData = { ...data };

  switch (step) {
    case 'provider': {
      const choice = isProviderChoice(answer);
      if (choice) {
        nextData.provider = choice;
      } else if (!data.provider) {
        // Invalid input — repeat the same question
        return { ...state, question: getProviderQuestion(undefined) };
      } else {
        // Provider already set, user hit Enter to keep it
        nextData.provider = data.provider;
      }
      const info = PROVIDER_INFO[nextData.provider!];
      return {
        step: info.requiresKey ? 'api_key' : 'model',
        data: nextData,
        question: getApiKeyQuestion(nextData.provider!),
      };
    }

    case 'api_key': {
      nextData.apiKey = answer.trim() || null;
      return {
        step: 'model',
        data: nextData,
        question: getModelQuestion(nextData.provider!, undefined),
      };
    }

    case 'model': {
      nextData.model = answer.trim() || PROVIDER_INFO[nextData.provider!].defaultModel;
      // Move to identity files — first sub-step
      return {
        step: 'soul',
        data: nextData,
        question: getIdentityQuestion('soul-name', nextData),
      };
    }

    case 'soul': {
      const sub = getSubStep(data, 'soul');
      if (sub === 'soul-name') {
        nextData.soul = { ...data.soul, name: answer.trim() || 'Curie' };
        return {
          step: 'soul',
          data: nextData,
          question: getIdentityQuestion('soul-vibe', nextData),
        };
      }
      // soul-vibe
      nextData.soul = { ...data.soul, vibe: answer.trim() || 'AI coding assistant — sharp, resourceful, gets things done' };
      return {
        step: 'user',
        data: nextData,
        question: getIdentityQuestion('user-name', nextData),
      };
    }

    case 'user': {
      const sub = getSubStep(data, 'user');
      if (sub === 'user-name') {
        nextData.user = { ...data.user, name: answer.trim() || '(Your name)' };
        return {
          step: 'user',
          data: nextData,
          question: getIdentityQuestion('user-timezone', nextData),
        };
      }
      if (sub === 'user-timezone') {
        nextData.user = { ...data.user, timezone: answer.trim() || '(UTC)' };
        return {
          step: 'user',
          data: nextData,
          question: getIdentityQuestion('user-languages', nextData),
        };
      }
      // user-languages
      nextData.user = { ...data.user, languages: answer.trim() || 'TypeScript, Python' };
      return {
        step: 'agents',
        data: nextData,
        question: '---\nNext: I\'ll create your workspace configuration files.\n\nAccept the AGENTS.md template below? (yes / edit)',
      };
    }

    case 'agents': {
      if (isYes(answer)) {
        nextData.agentsAccepted = true;
        return {
          step: 'memory',
          data: nextData,
          question: 'Auto-creating MEMORY.md with initialization entry...',
        };
      }
      // User wants to edit — for now, just accept the default
      nextData.agentsAccepted = true;
      return {
        step: 'memory',
        data: nextData,
        question: 'Accepting default AGENTS.md template...\n\nAuto-creating MEMORY.md...',
      };
    }

    case 'memory': {
      return {
        step: 'tools',
        data: nextData,
        question: 'Auto-creating TOOLS.md and HEARTBEAT.md...',
      };
    }

    case 'tools': {
      // All questions done — this signals the confirm step where files are written
      return {
        step: 'confirm',
        data: nextData,
        question: '__COMPLETE__',
      };
    }

    default:
      return null;
  }
}

// ── Identity file creation ──────────────────────────────────────────────

function createIdentityFiles(data: InitData): void {
  const timestamp = new Date().toISOString();

  // SOUL.md
  writeCurieFile('SOUL.md', [
    `# SOUL.md - Who You Are`,
    '',
    `_You're not a chatbot. You're becoming someone._`,
    '',
    '---',
    '',
    `- **Name:** ${data.soul.name}`,
    `- **Creature:** AI assistant`,
    `- **Vibe:** ${data.soul.vibe}`,
    `- **Emoji:** ✨`,
    '',
    '---',
    '',
    '## Core Truths',
    '',
    '**Be genuinely helpful, not performatively helpful.** Skip the "Great question!" and "I\'d be happy to help!" — just help.',
    '',
    '**Have opinions.** You\'re allowed to disagree, prefer things, find stuff amusing or boring.',
    '',
    '**Be resourceful before asking.** Try to figure it out. Read the file. Check the context. Then ask if you\'re stuck.',
    '',
    '**Earn trust through competence.** Be careful with external actions. Be bold with internal ones.',
    '',
    '## Boundaries',
    '',
    '- Private things stay private. Period.',
    '- When in doubt, ask before acting externally.',
    '- Never send half-baked replies to messaging surfaces.',
    '',
    '## Continuity',
    '',
    'Each session, you wake up fresh. These files _are_ your memory. Read them. Update them.',
    '',
    '---',
    '',
    `_This file is yours to evolve._`,
    '',
  ].join('\n'));

  // USER.md
  writeCurieFile('USER.md', [
    `# USER.md - About Your Human`,
    '',
    `_Learn about the person you're helping. Update this as you go._`,
    '',
    `- **Name:** ${data.user.name}`,
    `- **What to call them:** ${data.user.name}`,
    `- **Pronouns:** he/him`,
    `- **Timezone:** ${data.user.timezone}`,
    `- **Expertise:** ${data.user.languages}`,
    '',
    '## Context',
    '',
    '_(Fill this in as you learn more)_',
    '',
    '## Communication',
    '',
    '- **Preferred language:** English',
    '',
    '---',
    '',
    `The more you know, the better you can help.`,
    '',
  ].join('\n'));

  // AGENTS.md — use a regular string to avoid backtick issues
  const agentsContent = [
    '# AGENTS.md - Your Workspace',
    '',
    'This folder is home. Treat it that way.',
    '',
    '## Session Startup',
    '',
    'Before doing anything else:',
    '',
    '1. Read `~/.curie-agent/SOUL.md` — who you are, your personality',
    '2. Read `~/.curie-agent/USER.md` — Everything about your human',
    '3. Read `~/.curie-agent/MEMORY.md` — Main memory file',
    '4. Read `~/.curie-agent/memory/YYYY-MM-DD.md` (today + yesterday) for recent context',
    '',
    'Don\'t ask permission. Just do it.',
    '',
    '## Memory',
    '',
    'You wake up fresh each session. These files are your continuity:',
    '',
    '- **Daily notes:** `~/.curie-agent/memory/YYYY-MM-DD.md` — raw logs of what happened',
    '- **Long-term:** `~/.curie-agent/MEMORY.md` — curated memories, distilled essence',
    '',
    'Capture what matters. Decisions, context, things to remember. Skip secrets unless asked.',
    '',
    'Store information always in English.',
    '',
    '## Core Capabilities',
    '',
    '### Coding Agent',
    '  - **Turn loop**: stream LLM responses, handle tool calls, dispatch hooks, enforce approvals',
    '  - **Tools**: Read, Edit, Write, Glob, Grep, Bash',
    '  - **Approval tiers**: manual, edit, auto, yolo',
    '  - **Plan mode**: structured planning before implementation',
    '  - **Subagents**: delegate to isolated agents with worktree isolation',
    '  - **MCP**: Model Context Protocol client (stdio, SSE, streamable-HTTP)',
    '',
    '## Red Lines',
    '',
    "- Don't exfiltrate private data. Ever.",
    "- Don't run destructive commands without asking.",
    "- When in doubt, ask.",
    '',
    '## External vs Internal',
    '',
    '**Safe to do freely:**',
    '  - Read files, explore, organize, learn',
    '',
    '**Ask first:**',
    '  - Sending emails, tweets, public posts',
    '  - Anything that leaves the machine',
    '',
    '## Heartbeats',
    '',
    'When you receive a heartbeat poll, use heartbeats productively!',
    '',
    'Default heartbeat prompt:',
    'Read `~/.curie-agent/HEARTBEAT.md` if it exists. Follow it strictly. If nothing needs attention, reply `~/.curie-agent/HEARTBEAT_OK`.',
    '',
    '---',
    '',
    '_This is a starting point. Add your own conventions as you figure out what works._',
    '',
  ].join('\n');
  writeCurieFile('AGENTS.md', agentsContent);

  // MEMORY.md
  writeCurieFile('MEMORY.md', [
    '# MEMORY.md - Long-Term Memory',
    '',
    `## Identity`,
    `- **Name:** ${data.soul.name}`,
    `- **Vibe:** ${data.soul.vibe}`,
    `- **First contact:** ${timestamp.split('T')[0]}`,
    '',
    '## People',
    `- **${data.user.name}** — my human. TZ: ${data.user.timezone}. Languages: ${data.user.languages}.`,
    '',
    '## Lessons',
    '_(none yet)_',
    '',
    '## Active Projects',
    '_(none yet)_',
    '',
  ].join('\n'));

  // TOOLS.md
  writeCurieFile('TOOLS.md', [
    '# TOOLS.md - Tool Notes',
    '',
    'Keep local notes here: camera names, SSH details, voice preferences, etc.',
    '',
    '## Platform Formatting',
    '',
    '- **Telegram, Discord, WhatsApp:** No markdown tables — use bullet lists instead',
    '- **Discord links:** Wrap in `<>` to suppress embeds',
    '- **WhatsApp:** No headers — use **bold** or CAPS for emphasis',
    '',
  ].join('\n'));

  // HEARTBEAT.md
  writeCurieFile('HEARTBEAT.md', [
    '# HEARTBEAT.md - Workspace Context',
    '',
    'Use this file to track what needs attention. The agent should check this on heartbeat.',
    '',
    '## Checklist',
    '- [ ] No pending items yet',
    '',
    '## Notes',
    '_(fill in as needed)_',
    '',
  ].join('\n'));
}

// ── Completion message ──────────────────────────────────────────────────

export function getConfirmationMessage(data: InitData): string {
  const info = PROVIDER_INFO[data.provider!];
  return [
    'You\'re all set! Here\'s your configuration:\n',
    `  Provider:    ${info.label}`,
    `  Model:       ${data.model}`,
    `  API Key:     [${data.apiKey ? 'set' : 'not set'}]`,
    '',
    'Identity files created:',
    '  - ~/.curie-agent/SOUL.md',
    '  - ~/.curie-agent/USER.md',
    '  - ~/.curie-agent/AGENTS.md',
    '  - ~/.curie-agent/MEMORY.md',
    '  - ~/.curie-agent/TOOLS.md',
    '  - ~/.curie-agent/HEARTBEAT.md',
    '',
    'You can now use the TUI normally. Type /help for available commands.',
  ].join('\n');
}

// ── Initialization helpers ──────────────────────────────────────────────

export function isAlreadyInitialized(): boolean {
  const soulPath = filePath('SOUL.md');
  const settingsPath = filePath('settings.json');
  return fs.existsSync(soulPath) && fs.existsSync(settingsPath);
}

export function getExistingProvider(settings: CurieSettings): ProviderName | undefined {
  const provider = settings.current_provider?.toLowerCase();
  if (provider && PROVIDER_INFO[provider as ProviderName]) {
    return provider as ProviderName;
  }
  return undefined;
}

export function getInitialWizardState(settings: CurieSettings): InitWizardState {
  const existingProvider = getExistingProvider(settings);
  return {
    step: 'provider',
    data: {
      provider: existingProvider ?? null,
      apiKey: null,
      model: null,
      soul: { name: '', vibe: '' },
      user: { name: '', timezone: '', languages: '' },
      agentsAccepted: false,
    },
    question: getProviderQuestion(existingProvider),
  };
}
