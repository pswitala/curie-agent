import { CurieSettings } from '../../core/src/settings.js';
import { createIdentityFiles as _createIdentityFiles, type InitData as CoreInitData, type ProviderName as CoreProviderName } from '@curie-agent/core';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Re-export from core for backwards compatibility
export { _createIdentityFiles as createIdentityFiles };
export type { CoreInitData as InitData, CoreProviderName as ProviderName };

// Local aliases for internal use
type InitData = CoreInitData;
type ProviderName = CoreProviderName;

// ── Types ───────────────────────────────────────────────────────────────

type WizardStep = 'provider' | 'api_key' | 'model' | 'soul' | 'user' | 'agents' | 'memory' | 'tools' | 'confirm';

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
  return `Enter your ${info.label} API key:\n  (saved to ~/.curie-settings.json)`;
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
    'Skills installed:',
    '  - deep-research (multi-source research methodology)',
    '  - planning (project, event, life planning)',
    '',
    'You can now use the TUI normally. Type /help for available commands.',
  ].join('\n');
}

// ── Initialization helpers ──────────────────────────────────────────────

export function isAlreadyInitialized(): boolean {
  const curieDir = path.join(os.homedir(), '.curie-agent');
  return fs.existsSync(path.join(curieDir, 'SOUL.md')) && fs.existsSync(path.join(os.homedir(), '.curie-settings.json'));
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
