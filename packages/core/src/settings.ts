import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CurieSettings {
  model: string;
  effort: 'low' | 'medium' | 'high' | 'max' | 'auto';
  mode: 'plan' | 'edit' | 'auto' | 'yolo';
  theme: string;
  statusline: boolean;
  debug: boolean;
  // Upper-case keys match the user's requested shape in settings.json.
  MODEL_PROVIDER?: string; // 'anthropic' | 'openai' | 'local' | 'openrouter'
  // Local (llama.cpp / any OpenAI-compatible server)
  MODEL_URL?: string;
  MODEL_API_KEY?: string;
  // OpenAI
  OPENAI_API_KEY?: string;
  OPENAI_URL?: string;
  // Anthropic
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_URL?: string;
  // OpenRouter (uses Anthropic provider under the hood)
  OPENROUTER_API_KEY?: string;
  OPENROUTER_URL?: string;
  // Google Gemini
  GOOGLE_API_KEY?: string;
  GOOGLE_URL?: string;
  // Telegram gateway config
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_USER_ID?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_ALLOW_GROUPS?: boolean;
  CHANNEL_TAB_ACTIVE?: string;
  // Brave Search API key
  BRAVE_SEARCH_API_KEY?: string;
  // MCP server configs (object of { [id]: MCPConfig })
  MCP_SERVERS?: Record<string, unknown>;
  // Tool usage limits (prevent API exhaustion)
  TOOLS_PER_CALL?: number;
  WEBSEARCH_PER_CALL?: number;
  // Heartbeat periodic task — each schedule fires its section of HEARTBEAT.md
  HEARTBEAT?: 'on' | 'off';
  HEARTBEAT_INTRADAY?: string;  // comma-separated "H:MM" list, e.g. "8:10,10:10,14:20,16:20"
  HEARTBEAT_DAILY?: string;   // "H:MM"  (24h)
  HEARTBEAT_WEEKLY?: string;  // "day@H:MM" (monday|tuesday|...|sunday@H:MM)
  HEARTBEAT_MONTHLY?: string; // "D@H:MM" (1-31@H:MM)
  // Model pricing: semicolon-separated "inputPerMillion;outputPerMillion", e.g. "0.5;2.0"
  // Tiered: separate tiers with '|', each tiered segment uses '|'threshold<input;output>', e.g. "0.5;2.0|200000<1.0;4.0"
  MODEL_COST?: string;
  // Model context window in tokens
  MODEL_CONTEXT_WINDOW?: number;
  // Safety: path guard — reject Write/Edit/Bash outside cwd + allowlist
  SAFETY_PATH_GUARD?: 'on' | 'off';
  // Safety: comma-separated absolute paths allowed in addition to cwd
  SAFETY_PATH_ALLOWLIST?: string;
  // Safety: command guard — reject/ask on dangerous shell patterns
  SAFETY_COMMAND_GUARD?: 'on' | 'off';
  // Safety: git snapshot before each yolo-mode turn
  SAFETY_SNAPSHOTS?: 'on' | 'off';
}

export const DEFAULT_SETTINGS: CurieSettings = {
  model: 'claude-sonnet-4-6',
  effort: 'auto',
  mode: 'auto',
  theme: 'nord',
  statusline: true,
  debug: false,
  BRAVE_SEARCH_API_KEY: '',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_USER_ID: '',
  TELEGRAM_CHAT_ID: '',
  TELEGRAM_ALLOW_GROUPS: false,
  CHANNEL_TAB_ACTIVE: 'main',
  TOOLS_PER_CALL: 10,
  WEBSEARCH_PER_CALL: 5,
  HEARTBEAT: 'off',
  HEARTBEAT_INTRADAY: '',
  HEARTBEAT_DAILY: '6:00',
  HEARTBEAT_WEEKLY: 'monday@6:00',
  HEARTBEAT_MONTHLY: '1@6:00',
  SAFETY_PATH_GUARD: 'on',
  SAFETY_PATH_ALLOWLIST: '',
  SAFETY_COMMAND_GUARD: 'on',
  SAFETY_SNAPSHOTS: 'on',
};

function migrateMode(raw: unknown): CurieSettings['mode'] {
  if (typeof raw !== 'string') return DEFAULT_SETTINGS.mode;
  switch (raw) {
    case 'plan': case 'edit': case 'auto': case 'yolo': return raw;
    case 'auto-edit': return 'edit';
    case 'manual': return 'auto';
    case 'full-auto': return 'yolo';
    default: return DEFAULT_SETTINGS.mode;
  }
}

const CONFIG_DIR = join(homedir(), '.curie-agent');
const SETTINGS_FILE = join(CONFIG_DIR, 'settings.json');

export class SettingsManager {
  private settings: CurieSettings;

  constructor() {
    this.settings = { ...DEFAULT_SETTINGS };
  }

  load(): CurieSettings {
    this.settings = { ...DEFAULT_SETTINGS };
    if (existsSync(SETTINGS_FILE)) {
      try {
        const raw = readFileSync(SETTINGS_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown> | null;
        if (parsed && typeof parsed === 'object') {
          // Accept MODEL_URL / MODEL_API_KEY regardless of casing (users
          // commonly write model_url, ModelUrl, MODEL_API, etc.).
          const pick = (...keys: string[]): string | undefined => {
            for (const key of keys) {
              const direct = parsed[key];
              if (typeof direct === 'string' && direct.length > 0) return direct;
            }
            const normalize = (s: string) => s.replace(/[_-]/g, '').toLowerCase();
            const targets = keys.map(normalize);
            for (const [k, v] of Object.entries(parsed)) {
              if (typeof v !== 'string' || v.length === 0) continue;
              if (targets.includes(normalize(k))) return v;
            }
            return undefined;
          };

          const merged: CurieSettings = {
            model: (parsed.model as string) ?? DEFAULT_SETTINGS.model,
            effort: (parsed.effort as CurieSettings['effort']) ?? DEFAULT_SETTINGS.effort,
            mode: migrateMode(parsed.mode),
            theme: (parsed.theme as string) ?? DEFAULT_SETTINGS.theme,
            statusline: (parsed.statusline as boolean) ?? DEFAULT_SETTINGS.statusline,
            debug: (parsed.debug as boolean) ?? DEFAULT_SETTINGS.debug,
            BRAVE_SEARCH_API_KEY: pick('BRAVE_SEARCH_API_KEY', 'brave_search_api_key', 'braveSearchApiKey', 'BRAVE_API_KEY'),
            MODEL_URL: pick('MODEL_URL', 'model_url', 'modelUrl', 'MODEL_BASE_URL', 'baseUrl'),
            MODEL_API_KEY: pick('MODEL_API_KEY', 'model_api_key', 'MODEL_API', 'model_api', 'modelApiKey', 'apiKey', 'API_KEY'),
            MODEL_PROVIDER: pick('MODEL_PROVIDER', 'model_provider', 'modelProvider'),
            OPENAI_API_KEY: pick('OPENAI_API_KEY', 'openai_api_key', 'openaiApiKey'),
            OPENAI_URL: pick('OPENAI_URL', 'openai_url', 'openaiBaseUrl', 'OPENAI_BASE_URL', 'openai_base_url'),
            ANTHROPIC_API_KEY: pick('ANTHROPIC_API_KEY', 'anthropic_api_key', 'anthropicApiKey'),
            ANTHROPIC_URL: pick('ANTHROPIC_URL', 'anthropic_url', 'anthropicUrl'),
            OPENROUTER_API_KEY: pick('OPENROUTER_API_KEY', 'openrouter_api_key', 'openrouterApiKey'),
            OPENROUTER_URL: pick('OPENROUTER_URL', 'openrouter_url', 'openrouterUrl'),
            GOOGLE_API_KEY: pick('GOOGLE_API_KEY', 'google_api_key', 'googleApiKey'),
            GOOGLE_URL: pick('GOOGLE_URL', 'google_url', 'googleBaseUrl'),
            TELEGRAM_BOT_TOKEN: pick('TELEGRAM_BOT_TOKEN', 'telegram_bot_token', 'telegramBotToken'),
            TELEGRAM_USER_ID: pick('TELEGRAM_USER_ID', 'telegram_user_id', 'telegramUserId'),
            TELEGRAM_CHAT_ID: pick('TELEGRAM_CHAT_ID', 'telegram_chat_id', 'telegramChatId'),
            TELEGRAM_ALLOW_GROUPS: (parsed.TELEGRAM_ALLOW_GROUPS as boolean) ?? false,
            CHANNEL_TAB_ACTIVE: (parsed.CHANNEL_TAB_ACTIVE as string) ?? 'main',
            MCP_SERVERS: (parsed.MCP_SERVERS as Record<string, unknown>) ?? (parsed.mcp_servers as Record<string, unknown>),
            TOOLS_PER_CALL: (typeof parsed.TOOLS_PER_CALL === 'number' && parsed.TOOLS_PER_CALL > 0)
              ? parsed.TOOLS_PER_CALL : DEFAULT_SETTINGS.TOOLS_PER_CALL,
            WEBSEARCH_PER_CALL: (typeof parsed.WEBSEARCH_PER_CALL === 'number' && parsed.WEBSEARCH_PER_CALL > 0)
              ? parsed.WEBSEARCH_PER_CALL : DEFAULT_SETTINGS.WEBSEARCH_PER_CALL,
            HEARTBEAT: (parsed.HEARTBEAT as 'on' | 'off') ?? DEFAULT_SETTINGS.HEARTBEAT,
            HEARTBEAT_INTRADAY: (parsed.HEARTBEAT_INTRADAY as string) ?? (parsed.HEARTBEAT_TIMES as string) ?? (parsed.HEARTBEAT_HOURLY as string) ?? DEFAULT_SETTINGS.HEARTBEAT_INTRADAY,
            HEARTBEAT_DAILY: (parsed.HEARTBEAT_DAILY as string) ?? DEFAULT_SETTINGS.HEARTBEAT_DAILY,
            HEARTBEAT_WEEKLY: (parsed.HEARTBEAT_WEEKLY as string) ?? DEFAULT_SETTINGS.HEARTBEAT_WEEKLY,
            HEARTBEAT_MONTHLY: (parsed.HEARTBEAT_MONTHLY as string) ?? DEFAULT_SETTINGS.HEARTBEAT_MONTHLY,
            MODEL_COST: (parsed.MODEL_COST as string) ?? (parsed.model_cost as string),
            MODEL_CONTEXT_WINDOW: (typeof parsed.MODEL_CONTEXT_WINDOW === 'number' && parsed.MODEL_CONTEXT_WINDOW > 0)
              ? parsed.MODEL_CONTEXT_WINDOW : undefined,
            SAFETY_PATH_GUARD: (parsed.SAFETY_PATH_GUARD as 'on' | 'off') ?? DEFAULT_SETTINGS.SAFETY_PATH_GUARD,
            SAFETY_PATH_ALLOWLIST: (parsed.SAFETY_PATH_ALLOWLIST as string) ?? '',
            SAFETY_COMMAND_GUARD: (parsed.SAFETY_COMMAND_GUARD as 'on' | 'off') ?? DEFAULT_SETTINGS.SAFETY_COMMAND_GUARD,
            SAFETY_SNAPSHOTS: (parsed.SAFETY_SNAPSHOTS as 'on' | 'off') ?? DEFAULT_SETTINGS.SAFETY_SNAPSHOTS,
          };
          this.settings = merged;
        }
      } catch {
        // ignore parse errors, use defaults
      }
    }
    return this.settings;
  }

  save(): void {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2) + '\n');
  }

  update(partial: Partial<CurieSettings>): CurieSettings {
    this.settings = { ...this.settings, ...partial };
    this.save();
    return this.settings;
  }

  get(): CurieSettings {
    return { ...this.settings };
  }
}
