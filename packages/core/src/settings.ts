import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ── Nested sub-interfaces ───────────────────────────────────────────────────

export interface ProviderConfig {
  api_key: string;
  url: string;
  model: string;
  model_cost: string;
  model_context_window: number;
  max_output_tokens?: number;
  provider_order?: string[];
  [key: string]: string | number | string[] | undefined;
}

export interface ProviderMap {
  anthropic: ProviderConfig;
  openai: ProviderConfig;
  openrouter: ProviderConfig;
  google: ProviderConfig;
  ollama: ProviderConfig;
  local: ProviderConfig;
  [key: string]: ProviderConfig;
}

export interface ChannelsConfig {
  bot_token: string;
  user_id: string;
  chat_id: string;
  allow_groups: boolean;
  tab_active: string;
}

export interface HeartbeatConfig {
  schedule: 'on' | 'off';
  mode: 'plan' | 'edit' | 'auto' | 'yolo';
  intraday: string;
  daily: string;
  weekly: string;
  monthly: string;
  dreaming: string;
}

export interface SafetyConfig {
  path_guard: 'on' | 'off';
  path_allowlist: unknown;
  command_guard: 'on' | 'off';
  snapshots: 'on' | 'off';
}

export interface AutoCompactConfig {
  enabled: 'on' | 'off';
  threshold: number;
  warn_threshold: number;
  forced_threshold: number;
}

export interface WikiConfig {
  path: string;         // '' → ~/.curie-agent/wiki
  autoLint: 'on' | 'off';
}

// ── Top-level interface (nested shape) ──────────────────────────────────────

export interface CurieSettings {
  // Core
  model: string;
  effort: 'low' | 'medium' | 'high' | 'max' | 'auto';
  mode: 'plan' | 'edit' | 'auto' | 'yolo';
  theme: string;
  statusline: boolean;
  debug: boolean;

  // Provider resolution
  current_provider: string;
  providers: ProviderMap;
  model_override?: string;

  // Channels (Telegram)
  channels: ChannelsConfig;

  // Tool limits
  tools_per_call: number;
  websearch_per_call: number;

  // Brave Search
  brave_search_api_key: string;

  // Heartbeat
  heartbeat: HeartbeatConfig;

  // MCP servers
  mcp_servers: Record<string, unknown>;

  // Safety
  safety: SafetyConfig;

  // Autocompaction
  auto_compact: AutoCompactConfig;

  // Pricing tier warning
  pricing_tier_warn: 'on' | 'off';

  // Wiki engine
  wiki: WikiConfig;

  // Daemon binding IP (empty = 127.0.0.1)
  web_ip: string;

  daemon_token?: string;

  // ── Legacy flat keys (backward compat only, stripped on save) ──────────
  MODEL_PROVIDER?: string;
  MODEL_URL?: string;
  MODEL_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_URL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_URL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_URL?: string;
  GOOGLE_API_KEY?: string;
  GOOGLE_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_USER_ID?: string;
  TELEGRAM_CHAT_ID?: string;
  TELEGRAM_ALLOW_GROUPS?: boolean;
  CHANNEL_TAB_ACTIVE?: string;
  MCP_SERVERS?: Record<string, unknown>;
  TOOLS_PER_CALL?: number;
  WEBSEARCH_PER_CALL?: number;
  HEARTBEAT?: 'on' | 'off';
  HEARTBEAT_INTRADAY?: string;
  HEARTBEAT_DAILY?: string;
  HEARTBEAT_WEEKLY?: string;
  HEARTBEAT_MONTHLY?: string;
  HEARTBEAT_DREAMING?: string;
  MODEL_COST?: string;
  MODEL_CONTEXT_WINDOW?: number;
  SAFETY_PATH_GUARD?: 'on' | 'off';
  SAFETY_PATH_ALLOWLIST?: string;
  SAFETY_COMMAND_GUARD?: 'on' | 'off';
  SAFETY_SNAPSHOTS?: 'on' | 'off';
  AUTO_COMPACT?: 'on' | 'off';
  AUTO_COMPACT_THRESHOLD?: number;
  AUTO_COMPACT_WARN_THRESHOLD?: number;
  AUTO_COMPACT_FORCED_THRESHOLD?: number;
  PRICING_TIER_WARN?: 'on' | 'off';
}

// ── Default settings (nested format) ────────────────────────────────────────

function makeDefaultProviders(): ProviderMap {
  const p: Partial<ProviderMap> = {};
  for (const name of ['anthropic', 'openai', 'openrouter', 'google', 'ollama', 'local'] as const) {
    p[name] = { api_key: '', url: '', model: '', model_cost: '', model_context_window: 131072 };
  }
  return {
    anthropic: { ...p.anthropic!, url: 'https://api.anthropic.com', model: 'claude-sonnet-4-6', model_context_window: 200000 },
    openai: { ...p.openai!, url: 'https://api.openai.com', model: 'gpt-4o' },
    openrouter: { ...p.openrouter!, url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-4-6', model_context_window: 200000 },
    google: { ...p.google!, model: 'gemini-2.5-pro' },
    ollama: { ...p.ollama!, url: 'http://localhost:11434/v1', model: 'llama3' },
    local: { ...p.local!, model: 'custom' },
  } as ProviderMap;
}

export const DEFAULT_SETTINGS: CurieSettings = {
  model: 'claude-sonnet-4-6',
  effort: 'auto',
  mode: 'auto',
  theme: 'nord',
  statusline: true,
  debug: false,
  current_provider: 'anthropic',
  providers: makeDefaultProviders(),
  channels: { bot_token: '', user_id: '', chat_id: '', allow_groups: false, tab_active: 'main' },
  tools_per_call: 10,
  websearch_per_call: 5,
  brave_search_api_key: '',
  heartbeat: { schedule: 'off', mode: 'yolo', intraday: '', daily: '6:00', weekly: 'monday@6:00', monthly: '1@6:00', dreaming: '2:00' },
  mcp_servers: {},
  safety: { path_guard: 'on', path_allowlist: '', command_guard: 'on', snapshots: 'on' },
  auto_compact: { enabled: 'on', threshold: 75, warn_threshold: 60, forced_threshold: 85 },
  pricing_tier_warn: 'on',
  wiki: { path: '', autoLint: 'off' },
  web_ip: '',
};

// ── Migration helpers ───────────────────────────────────────────────────────

function migrateMode(raw: unknown): CurieSettings['mode'] {
  if (typeof raw !== 'string') return DEFAULT_SETTINGS.mode;
  switch (raw) {
    case 'plan': case 'edit': case 'auto': case 'yolo': return raw;
    default: return DEFAULT_SETTINGS.mode;
  }
}

/** Case-insensitive pick: find first non-empty string value matching any of the candidate keys. */
function pickString(parsed: Record<string, unknown>, ...keys: string[]): string | undefined {
  const normalize = (s: string) => s.replace(/[_-]/g, '').toLowerCase();
  const targets = new Set(keys.map(normalize));
  for (const key of keys) {
    const direct = parsed[key];
    if (typeof direct === 'string' && direct.length > 0) return direct;
  }
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== 'string' || v.length === 0) continue;
    if (targets.has(normalize(k))) return v;
  }
  return undefined;
}

function pickNumber(parsed: Record<string, unknown>, ...keys: string[]): number | undefined {
  const normalize = (s: string) => s.replace(/[_-]/g, '').toLowerCase();
  const targets = new Set(keys.map(normalize));
  for (const key of keys) {
    const direct = parsed[key];
    if (typeof direct === 'number') return direct;
  }
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== 'number') continue;
    if (targets.has(normalize(k))) return v;
  }
  return undefined;
}

function pickBool(parsed: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  const normalize = (s: string) => s.replace(/[_-]/g, '').toLowerCase();
  const targets = new Set(keys.map(normalize));
  for (const key of keys) {
    const direct = parsed[key];
    if (typeof direct === 'boolean') return direct;
  }
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== 'boolean') continue;
    if (targets.has(normalize(k))) return v;
  }
  return undefined;
}

/** Detect whether raw JSON is legacy flat format (no `providers` object, but has flat provider keys). */
export function isLegacyFlatFormat(raw: Record<string, unknown>): boolean {
  const hasNested = 'providers' in raw && typeof raw.providers === 'object' && raw.providers !== null;
  if (hasNested) return false;
  const flatMarkerKeys = [
    'MODEL_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY',
    'GOOGLE_API_KEY', 'MODEL_URL', 'ANTHROPIC_URL', 'OPENAI_URL', 'OPENROUTER_URL', 'GOOGLE_URL',
    'MODEL_PROVIDER',
  ];
  const normalize = (s: string) => s.replace(/[_-]/g, '').toLowerCase();
  const markerTargets = new Set(flatMarkerKeys.map(normalize));
  return Object.keys(raw).some(k => markerTargets.has(normalize(k)));
}

/** Migrate flat settings JSON to nested format. */
export function migrateFlatToNested(parsed: Record<string, unknown>): CurieSettings {
  const modelProvider = (pickString(parsed, 'MODEL_PROVIDER') || 'anthropic').toLowerCase();

  // Resolve which provider MODEL_API_KEY/MODEL_URL belonged to
  const resolvedProvider: keyof ProviderMap = ['ollama', 'local'].includes(modelProvider)
    ? modelProvider as keyof ProviderMap
    : (modelProvider as keyof ProviderMap) || 'anthropic';

  // Build provider configs from flat keys
  const anthropicKey = pickString(parsed, 'ANTHROPIC_API_KEY', 'MODEL_API_KEY') || '';
  const anthropicUrl = pickString(parsed, 'ANTHROPIC_URL', 'MODEL_URL') || 'https://api.anthropic.com';

  const openaiKey = pickString(parsed, 'OPENAI_API_KEY', 'MODEL_API_KEY') || '';
  const openaiUrl = pickString(parsed, 'OPENAI_URL', 'MODEL_URL') || 'https://api.openai.com';

  const orKey = pickString(parsed, 'OPENROUTER_API_KEY', 'MODEL_API_KEY') || '';
  const orUrl = pickString(parsed, 'OPENROUTER_URL', 'MODEL_URL') || 'https://openrouter.ai/api/v1';

  const googleKey = pickString(parsed, 'GOOGLE_API_KEY', 'MODEL_API_KEY') || '';
  const googleUrl = pickString(parsed, 'GOOGLE_URL', 'MODEL_URL') || '';

  const ollamaKey = pickString(parsed, 'MODEL_API_KEY') || '';
  const ollamaUrl = pickString(parsed, 'MODEL_URL') || 'http://localhost:11434/v1';

  const localKey = pickString(parsed, 'MODEL_API_KEY') || '';
  const localUrl = pickString(parsed, 'MODEL_URL') || '';

  const providers: ProviderMap = {
    anthropic: { api_key: anthropicKey, url: anthropicUrl, model: DEFAULT_SETTINGS.providers.anthropic.model, model_cost: '', model_context_window: 200000 },
    openai: { api_key: openaiKey, url: openaiUrl, model: DEFAULT_SETTINGS.providers.openai.model, model_cost: '', model_context_window: 131072 },
    openrouter: { api_key: orKey, url: orUrl, model: DEFAULT_SETTINGS.providers.openrouter.model, model_cost: '', model_context_window: 200000 },
    google: { api_key: googleKey, url: googleUrl, model: DEFAULT_SETTINGS.providers.google.model, model_cost: '', model_context_window: 131072 },
    ollama: { api_key: ollamaKey, url: ollamaUrl, model: DEFAULT_SETTINGS.providers.ollama.model, model_cost: '', model_context_window: 131072 },
    local: { api_key: localKey, url: localUrl, model: DEFAULT_SETTINGS.providers.local.model, model_cost: '', model_context_window: 131072 },
  };

  // Preserve flat model into the active provider's model
  const flatModel = pickString(parsed, 'model') || DEFAULT_SETTINGS.model;

  // Preserve flat model_cost / model_context_window into current provider
  const flatModelCost = pickString(parsed, 'MODEL_COST', 'model_cost');
  const flatModelCtxWindow = pickNumber(parsed, 'MODEL_CONTEXT_WINDOW', 'model_context_window');

  const rp = providers[resolvedProvider]!;
  rp.model = flatModel;
  if (flatModelCost) rp.model_cost = flatModelCost;
  if (flatModelCtxWindow && flatModelCtxWindow > 0) rp.model_context_window = flatModelCtxWindow;

  const telegramBot = pickString(parsed, 'TELEGRAM_BOT_TOKEN', 'telegram_bot_token') || '';
  const telegramUser = pickString(parsed, 'TELEGRAM_USER_ID', 'telegram_user_id') || '';
  const telegramChat = pickString(parsed, 'TELEGRAM_CHAT_ID', 'telegram_chat_id') || '';
  const telegramGroups = pickBool(parsed, 'TELEGRAM_ALLOW_GROUPS', 'telegram_allow_groups') ?? false;
  const channelTab = pickString(parsed, 'CHANNEL_TAB_ACTIVE', 'channel_tab_active') || DEFAULT_SETTINGS.channels.tab_active;

  const mcpServers = parsed.MCP_SERVERS || parsed.mcp_servers || {};

  const safetyPathGuard = (pickString(parsed, 'SAFETY_PATH_GUARD', 'safety_path_guard') || 'on') as 'on' | 'off';
  const safetyPathAllow = parsed.SAFETY_PATH_ALLOWLIST ?? parsed.safety_path_allowlist ?? '';
  const safetyCmdGuard = (pickString(parsed, 'SAFETY_COMMAND_GUARD', 'safety_command_guard') || 'on') as 'on' | 'off';
  const safetySnaps = (pickString(parsed, 'SAFETY_SNAPSHOTS', 'safety_snapshots') || 'on') as 'on' | 'off';

  const acEnabled = (pickString(parsed, 'AUTO_COMPACT', 'auto_compact') || 'on') as 'on' | 'off';
  const acThreshold = (pickNumber(parsed, 'AUTO_COMPACT_THRESHOLD', 'auto_compact_threshold') ?? 75);
  const acWarnThreshold = (pickNumber(parsed, 'AUTO_COMPACT_WARN_THRESHOLD', 'auto_compact_warn_threshold') ?? 60);
  const acForcedThreshold = (pickNumber(parsed, 'AUTO_COMPACT_FORCED_THRESHOLD', 'auto_compact_forced_threshold') ?? 85);

  return {
    model: flatModel,
    effort: (pickString(parsed, 'effort') as CurieSettings['effort']) || DEFAULT_SETTINGS.effort,
    mode: migrateMode(parsed.mode),
    theme: (pickString(parsed, 'theme') || DEFAULT_SETTINGS.theme) as string,
    statusline: pickBool(parsed, 'statusline') ?? DEFAULT_SETTINGS.statusline,
    debug: pickBool(parsed, 'debug') ?? DEFAULT_SETTINGS.debug,
    current_provider: resolvedProvider as string,
    providers,
    channels: { bot_token: telegramBot, user_id: telegramUser, chat_id: telegramChat, allow_groups: telegramGroups, tab_active: channelTab },
    tools_per_call: (typeof pickNumber(parsed, 'TOOLS_PER_CALL', 'tools_per_call') === 'number' && pickNumber(parsed, 'TOOLS_PER_CALL', 'tools_per_call')! > 0)
      ? pickNumber(parsed, 'TOOLS_PER_CALL', 'tools_per_call')! : DEFAULT_SETTINGS.tools_per_call,
    websearch_per_call: (typeof pickNumber(parsed, 'WEBSEARCH_PER_CALL', 'websearch_per_call') === 'number' && pickNumber(parsed, 'WEBSEARCH_PER_CALL', 'websearch_per_call')! > 0)
      ? pickNumber(parsed, 'WEBSEARCH_PER_CALL', 'websearch_per_call')! : DEFAULT_SETTINGS.websearch_per_call,
    brave_search_api_key: pickString(parsed, 'BRAVE_SEARCH_API_KEY', 'brave_search_api_key', 'BRAVE_API_KEY') || '',
    heartbeat: {
      schedule: (pickString(parsed, 'HEARTBEAT', 'heartbeat') || 'off') as 'on' | 'off',
      mode: migrateMode(pickString(parsed, 'HEARTBEAT_MODE', 'heartbeat_mode', 'heartbeat.mode')) || 'yolo',
      intraday: pickString(parsed, 'HEARTBEAT_INTRADAY', 'HEARTBEAT_TIMES', 'HEARTBEAT_HOURLY', 'heartbeat_intraday', 'heartbeat_times') || DEFAULT_SETTINGS.heartbeat.intraday,
      daily: pickString(parsed, 'HEARTBEAT_DAILY', 'heartbeat_daily') || DEFAULT_SETTINGS.heartbeat.daily,
      weekly: pickString(parsed, 'HEARTBEAT_WEEKLY', 'heartbeat_weekly') || DEFAULT_SETTINGS.heartbeat.weekly,
      monthly: pickString(parsed, 'HEARTBEAT_MONTHLY', 'heartbeat_monthly') || DEFAULT_SETTINGS.heartbeat.monthly,
      dreaming: pickString(parsed, 'HEARTBEAT_DREAMING', 'heartbeat_dreaming') || DEFAULT_SETTINGS.heartbeat.dreaming,
    },
    mcp_servers: mcpServers as Record<string, unknown>,
    safety: {
      path_guard: safetyPathGuard,
      path_allowlist: safetyPathAllow,
      command_guard: safetyCmdGuard,
      snapshots: safetySnaps,
    },
    auto_compact: {
      enabled: acEnabled,
      threshold: acThreshold,
      warn_threshold: acWarnThreshold,
      forced_threshold: acForcedThreshold,
    },
    pricing_tier_warn: (pickString(parsed, 'PRICING_TIER_WARN', 'pricing_tier_warn') || 'on') as 'on' | 'off',
    wiki: { path: '', autoLint: 'off' },
    web_ip: pickString(parsed, 'web_ip', 'WEB_IP') || '',
  };
}

/** Serialize settings to JSON, stripping legacy flat keys. */
export function stripLegacyKeys(s: CurieSettings): Record<string, unknown> {
  const legacy = new Set([
    'MODEL_PROVIDER', 'MODEL_URL', 'MODEL_API_KEY',
    'OPENAI_API_KEY', 'OPENAI_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_URL',
    'OPENROUTER_API_KEY', 'OPENROUTER_URL', 'GOOGLE_API_KEY', 'GOOGLE_URL',
    'TELEGRAM_BOT_TOKEN', 'TELEGRAM_USER_ID', 'TELEGRAM_CHAT_ID', 'TELEGRAM_ALLOW_GROUPS',
    'CHANNEL_TAB_ACTIVE', 'MCP_SERVERS',
    'TOOLS_PER_CALL', 'WEBSEARCH_PER_CALL',
    'HEARTBEAT', 'HEARTBEAT_INTRADAY', 'HEARTBEAT_DAILY', 'HEARTBEAT_WEEKLY',
    'HEARTBEAT_MONTHLY', 'HEARTBEAT_DREAMING',
    'MODEL_COST', 'MODEL_CONTEXT_WINDOW',
    'SAFETY_PATH_GUARD', 'SAFETY_PATH_ALLOWLIST', 'SAFETY_COMMAND_GUARD', 'SAFETY_SNAPSHOTS',
    'AUTO_COMPACT', 'AUTO_COMPACT_THRESHOLD', 'AUTO_COMPACT_WARN_THRESHOLD', 'AUTO_COMPACT_FORCED_THRESHOLD',
    'PRICING_TIER_WARN',
  ]);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (legacy.has(k)) continue;
    if (v === undefined) continue;
    result[k] = v;
  }
  return result;
}

// ── Constants ───────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.curie-agent');
const SETTINGS_FILE = join(homedir(), '.curie-settings.json');

// ── SettingsManager ─────────────────────────────────────────────────────────

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
          if (isLegacyFlatFormat(parsed)) {
            this.settings = migrateFlatToNested(parsed);
            this.save();
          } else {
            this.settings = parseNestedSettings(parsed);
          }
        }
      } catch {
        // ignore parse errors, use defaults
      }
    }
    // Sync top-level model to the active provider's value.
    const prov = this.settings.providers[this.settings.current_provider as keyof ProviderMap];
    if (prov) {
      this.settings.model = prov.model;
    }
    return this.settings;
  }

  save(): void {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(SETTINGS_FILE, JSON.stringify(stripLegacyKeys(this.settings), null, 2) + '\n');
  }

  update(partial: Partial<CurieSettings>): CurieSettings {
    this.settings = { ...this.settings, ...partial };
    this.save();
    return this.settings;
  }

  get(): CurieSettings {
    return { ...this.settings };
  }

  /** Get the currently active model name from provider config. */
  getActiveModel(): string {
    const p = this.settings.providers[this.settings.current_provider as keyof ProviderMap];
    return p?.model || DEFAULT_SETTINGS.model;
  }

  /** Get the currently active provider name. */
  getCurrentProvider(): string {
    return this.settings.current_provider;
  }

  /** Get a specific property from a provider's config. */
  getProviderKey(provider: string, key: 'api_key'): string;
  getProviderKey(provider: string, key: 'url'): string;
  getProviderKey(provider: string, key: 'model'): string;
  getProviderKey(provider: string, key: 'model_cost'): string;
  getProviderKey(provider: string, key: 'model_context_window'): number;
  getProviderKey(provider: string, key: string): string | number {
    const name = provider || this.settings.current_provider;
    const p = this.settings.providers[name as keyof ProviderMap];
    if (!p) return '';
    return ((p as unknown as Record<string, unknown>)[key] as string | number) ?? '';
  }

  /** Set a specific property on a provider's config. */
  setProviderKey(provider: string, key: string, value: unknown): CurieSettings {
    const name = provider || this.settings.current_provider;
    const existing = this.settings.providers[name as keyof ProviderMap] || {} as ProviderConfig;
    this.settings.providers = {
      ...this.settings.providers,
      [name]: { ...existing, [key]: value } as ProviderConfig,
    };
    this.save();
    return this.settings;
  }

  /** Set the current provider and sync model to its value. */
  setCurrentProvider(name: string): CurieSettings {
    this.settings.current_provider = name;
    const prov = this.settings.providers[name as keyof ProviderMap];
    if (prov) {
      this.settings.model = prov.model;
    }
    this.save();
    return this.settings;
  }

  /** Get the active provider's model cost string. */
  getModelCost(): string {
    const p = this.settings.providers[this.settings.current_provider as keyof ProviderMap];
    return p?.model_cost || '';
  }

  /** Get the active provider's context window size. */
  getModelContextWindow(): number {
    const p = this.settings.providers[this.settings.current_provider as keyof ProviderMap];
    return p?.model_context_window || 131072;
  }
}

/** Parse a nested-format settings JSON into CurieSettings (lightweight, no migration needed). */
export function parseNestedSettings(parsed: Record<string, unknown>): CurieSettings {
  const getString = (keys: string[]) => pickString(parsed, ...keys) || '';
  const getNumber = (keys: string[]) => pickNumber(parsed, ...keys);
  const getBool = (keys: string[]) => pickBool(parsed, ...keys);

  const providers: ProviderMap = { ...DEFAULT_SETTINGS.providers };
  const provKeys: (keyof ProviderMap)[] = ['anthropic', 'openai', 'openrouter', 'google', 'ollama', 'local'];

  const rawProviders = parsed.providers as Record<string, Record<string, string | number | undefined>> | undefined;
  if (rawProviders) {
    for (const name of provKeys) {
      const raw = rawProviders[name];
      if (raw && typeof raw === 'object') {
        providers[name] = {
          api_key: getString([`providers.${name}.api_key`]) || (raw.api_key as string) || '',
          url: getString([`providers.${name}.url`]) || (raw.url as string) || '',
          model: getString([`providers.${name}.model`]) || (raw.model as string) || (DEFAULT_SETTINGS.providers[name as string]!.model),
          model_cost: (raw.model_cost as string) || '',
          model_context_window: typeof raw.model_context_window === 'number' ? raw.model_context_window : (DEFAULT_SETTINGS.providers[name as string]!.model_context_window),
          max_output_tokens: typeof raw.max_output_tokens === 'number' ? raw.max_output_tokens : undefined,
          provider_order: Array.isArray(raw.provider_order) ? raw.provider_order : undefined,
        };
      }
    }
  }

  const rawChannels = parsed.channels as Record<string, string | boolean | number | undefined> | undefined;
  const channelsConfig: ChannelsConfig = {
    bot_token: getString(['channels.bot_token', 'CHANNEL_TAB_ACTIVE']) || (rawChannels?.bot_token as string) || '',
    user_id: getString(['channels.user_id']) || (rawChannels?.user_id as string) || '',
    chat_id: getString(['channels.chat_id']) || (rawChannels?.chat_id as string) || '',
    allow_groups: getBool(['channels.allow_groups', 'TELEGRAM_ALLOW_GROUPS']) ?? (rawChannels?.allow_groups as boolean) ?? false,
    tab_active: getString(['channels.tab_active']) || (rawChannels?.tab_active as string) || DEFAULT_SETTINGS.channels.tab_active,
  };

  const rawHeartbeat = parsed.heartbeat as Record<string, string | undefined> | undefined;
  const heartbeatConfig: HeartbeatConfig = {
    schedule: (getString(['heartbeat.schedule', 'HEARTBEAT']) || (rawHeartbeat?.schedule as string) || 'off') as 'on' | 'off',
    mode: migrateMode(getString(['heartbeat.mode']) || rawHeartbeat?.mode) || 'yolo',
    intraday: getString(['heartbeat.intraday', 'HEARTBEAT_INTRADAY', 'HEARTBEAT_TIMES', 'HEARTBEAT_HOURLY']) || (rawHeartbeat?.intraday as string) || DEFAULT_SETTINGS.heartbeat.intraday,
    daily: getString(['heartbeat.daily', 'HEARTBEAT_DAILY']) || (rawHeartbeat?.daily as string) || DEFAULT_SETTINGS.heartbeat.daily,
    weekly: getString(['heartbeat.weekly', 'HEARTBEAT_WEEKLY']) || (rawHeartbeat?.weekly as string) || DEFAULT_SETTINGS.heartbeat.weekly,
    monthly: getString(['heartbeat.monthly', 'HEARTBEAT_MONTHLY']) || (rawHeartbeat?.monthly as string) || DEFAULT_SETTINGS.heartbeat.monthly,
    dreaming: getString(['heartbeat.dreaming', 'HEARTBEAT_DREAMING']) || (rawHeartbeat?.dreaming as string) || DEFAULT_SETTINGS.heartbeat.dreaming,
  };

  const rawSafety = parsed.safety as Record<string, unknown | undefined> | undefined;
  const safetyConfig: SafetyConfig = {
    path_guard: (getString(['safety.path_guard', 'SAFETY_PATH_GUARD']) || (rawSafety?.path_guard as string) || 'on') as 'on' | 'off',
    path_allowlist: rawSafety?.path_allowlist ?? getString(['safety.path_allowlist', 'SAFETY_PATH_ALLOWLIST']) ?? '',
    command_guard: (getString(['safety.command_guard', 'SAFETY_COMMAND_GUARD']) || (rawSafety?.command_guard as string) || 'on') as 'on' | 'off',
    snapshots: (getString(['safety.snapshots', 'SAFETY_SNAPSHOTS']) || (rawSafety?.snapshots as string) || 'on') as 'on' | 'off',
  };

  const rawAutoComp = parsed.auto_compact as Record<string, string | number | undefined> | undefined;
  const autoCompactConfig: AutoCompactConfig = {
    enabled: (getString(['auto_compact.enabled', 'AUTO_COMPACT']) || (rawAutoComp?.enabled as string) || 'on') as 'on' | 'off',
    threshold: getNumber(['auto_compact.threshold', 'AUTO_COMPACT_THRESHOLD']) ?? (rawAutoComp?.threshold as number) ?? DEFAULT_SETTINGS.auto_compact.threshold,
    warn_threshold: getNumber(['auto_compact.warn_threshold', 'AUTO_COMPACT_WARN_THRESHOLD']) ?? (rawAutoComp?.warn_threshold as number) ?? DEFAULT_SETTINGS.auto_compact.warn_threshold,
    forced_threshold: getNumber(['auto_compact.forced_threshold', 'AUTO_COMPACT_FORCED_THRESHOLD']) ?? (rawAutoComp?.forced_threshold as number) ?? DEFAULT_SETTINGS.auto_compact.forced_threshold,
  };

  return {
    model: getString(['model']) || DEFAULT_SETTINGS.model,
    effort: (getString(['effort']) || DEFAULT_SETTINGS.effort) as CurieSettings['effort'],
    mode: migrateMode(parsed.mode),
    theme: getString(['theme']) || DEFAULT_SETTINGS.theme,
    statusline: getBool(['statusline']) ?? DEFAULT_SETTINGS.statusline,
    debug: getBool(['debug']) ?? DEFAULT_SETTINGS.debug,
    current_provider: getString(['current_provider']) || DEFAULT_SETTINGS.current_provider,
    providers,
    channels: channelsConfig,
    tools_per_call: (typeof getNumber(['tools_per_call', 'TOOLS_PER_CALL']) === 'number' && getNumber(['tools_per_call', 'TOOLS_PER_CALL'])! > 0)
      ? getNumber(['tools_per_call', 'TOOLS_PER_CALL'])! : DEFAULT_SETTINGS.tools_per_call,
    websearch_per_call: (typeof getNumber(['websearch_per_call', 'WEBSEARCH_PER_CALL']) === 'number' && getNumber(['websearch_per_call', 'WEBSEARCH_PER_CALL'])! > 0)
      ? getNumber(['websearch_per_call', 'WEBSEARCH_PER_CALL'])! : DEFAULT_SETTINGS.websearch_per_call,
    brave_search_api_key: getString(['brave_search_api_key', 'BRAVE_SEARCH_API_KEY', 'BRAVE_API_KEY']),
    heartbeat: heartbeatConfig,
    mcp_servers: (parsed.mcp_servers || parsed.MCP_SERVERS) as Record<string, unknown> || {},
    safety: safetyConfig,
    auto_compact: autoCompactConfig,
    pricing_tier_warn: (getString(['pricing_tier_warn', 'PRICING_TIER_WARN']) || 'on') as 'on' | 'off',
    wiki: (() => {
      const rawWiki = parsed.wiki as Record<string, unknown> | undefined;
      return {
        path: (rawWiki?.path as string) || '',
        autoLint: ((rawWiki?.autoLint as string) || 'off') as 'on' | 'off',
      };
    })(),
    web_ip: getString(['web_ip', 'WEB_IP']) || '',
    daemon_token: getString(['daemon_token']),
  };
}
