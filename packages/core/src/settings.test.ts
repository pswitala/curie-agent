import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, SettingsManager, migrateFlatToNested, stripLegacyKeys, isLegacyFlatFormat } from './settings.js';

const _testDir = join(tmpdir(), `curie-settings-test-${Date.now()}`);
const _settingsFile = join(_testDir, 'settings.json');

function ensureTestDir() {
  if (!existsSync(_testDir)) {
    require('node:fs').mkdirSync(_testDir, { recursive: true });
  }
}

function cleanupTestDir() {
  if (existsSync(_testDir)) {
    rmSync(_testDir, { recursive: true, force: true });
  }
}

// Create a SettingsManager that reads/writes to the test dir
function createTestManager(): SettingsManager {
  const manager = new SettingsManager();
  const fs = require('node:fs');
  if (!fs.existsSync(_testDir)) {
    fs.mkdirSync(_testDir, { recursive: true });
  }

  // Store original methods
  const origSettings = manager.settings;

  // Override load to use test file
  const originalLoad = manager.load.bind(manager);
  manager.load = function () {
    // Use the internal migration logic with test file
    this.settings = { ...DEFAULT_SETTINGS };
    if (fs.existsSync(_settingsFile)) {
      try {
        const raw = fs.readFileSync(_settingsFile, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown> | null;
        if (parsed && typeof parsed === 'object') {
          if (isLegacyFlatFormat(parsed)) {
            this.settings = migrateFlatToNested(parsed);
            this.save();
          } else {
            this.settings = parseNestedSettings(parsed);
          }
        }
      } catch { /* ignore */ }
    }
    return this.settings;
  };

  // Override save to use test file
  manager.save = function () {
    fs.writeFileSync(_settingsFile, JSON.stringify(stripLegacyKeys(this.settings), null, 2) + '\n');
  };

  return manager;
}

// We need parseNestedSettings imported for the test manager
import { parseNestedSettings } from './settings.js';

describe('DEFAULT_SETTINGS', () => {
  it('should have correct default model', () => {
    expect(DEFAULT_SETTINGS.model).toBe('claude-sonnet-4-6');
  });

  it('should have correct default effort', () => {
    expect(DEFAULT_SETTINGS.effort).toBe('auto');
  });

  it('should have correct default mode', () => {
    expect(DEFAULT_SETTINGS.mode).toBe('auto');
  });

  it('should have correct default theme', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('nord');
  });

  it('should have statusline enabled by default', () => {
    expect(DEFAULT_SETTINGS.statusline).toBe(true);
  });

  it('should have debug disabled by default', () => {
    expect(DEFAULT_SETTINGS.debug).toBe(false);
  });

  it('should default to anthropic provider', () => {
    expect(DEFAULT_SETTINGS.current_provider).toBe('anthropic');
  });

  it('should have anthropic provider config with correct defaults', () => {
    const p = DEFAULT_SETTINGS.providers.anthropic;
    expect(p.url).toBe('https://api.anthropic.com');
    expect(p.model).toBe('claude-sonnet-4-6');
    expect(p.api_key).toBe('');
    expect(p.model_context_window).toBe(200000);
  });

  it('should have openai provider config with correct defaults', () => {
    const p = DEFAULT_SETTINGS.providers.openai;
    expect(p.url).toBe('https://api.openai.com');
    expect(p.model).toBe('gpt-4o');
  });

  it('should have openrouter provider config with correct defaults', () => {
    const p = DEFAULT_SETTINGS.providers.openrouter;
    expect(p.url).toBe('https://openrouter.ai/api/v1');
    expect(p.model).toBe('anthropic/claude-sonnet-4-6');
  });

  it('should have ollama provider config with correct defaults', () => {
    const p = DEFAULT_SETTINGS.providers.ollama;
    expect(p.url).toBe('http://localhost:11434/v1');
    expect(p.model).toBe('llama3');
  });

  it('should have channels config with correct defaults', () => {
    const c = DEFAULT_SETTINGS.channels;
    expect(c.bot_token).toBe('');
    expect(c.user_id).toBe('');
    expect(c.chat_id).toBe('');
    expect(c.allow_groups).toBe(false);
    expect(c.tab_active).toBe('main');
  });

  it('should have heartbeat defaults', () => {
    const h = DEFAULT_SETTINGS.heartbeat;
    expect(h.schedule).toBe('off');
    expect(h.daily).toBe('6:00');
    expect(h.weekly).toBe('monday@6:00');
  });

  it('should have safety defaults', () => {
    const s = DEFAULT_SETTINGS.safety;
    expect(s.path_guard).toBe('on');
    expect(s.command_guard).toBe('on');
    expect(s.snapshots).toBe('on');
  });

  it('should have auto_compact defaults', () => {
    const a = DEFAULT_SETTINGS.auto_compact;
    expect(a.enabled).toBe('on');
    expect(a.threshold).toBe(75);
    expect(a.warn_threshold).toBe(60);
    expect(a.forced_threshold).toBe(85);
  });

  it('should have correct tools_per_call and websearch_per_call defaults', () => {
    expect(DEFAULT_SETTINGS.tools_per_call).toBe(10);
    expect(DEFAULT_SETTINGS.websearch_per_call).toBe(5);
  });
});

describe('SettingsManager migration', () => {
  let testManager: SettingsManager;

  beforeEach(() => {
    cleanupTestDir();
    ensureTestDir();
    testManager = createTestManager();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  it('getActiveModel returns provider default when no override', () => {
    testManager.load();
    expect(testManager.getActiveModel()).toBe('claude-sonnet-4-6');
  });

  it('getActiveModel returns provider model when set via setProviderKey', () => {
    testManager.load();
    testManager.setProviderKey('anthropic', 'model', 'claude-opus-4-7');
    expect(testManager.getActiveModel()).toBe('claude-opus-4-7');
  });

  it('getCurrentProvider returns current_provider', () => {
    testManager.load();
    expect(testManager.getCurrentProvider()).toBe('anthropic');
  });

  it('getProviderKey returns api_key', () => {
    testManager.load();
    const key = testManager.getProviderKey('anthropic', 'api_key');
    expect(key).toBe('');
  });

  it('getProviderKey returns url', () => {
    testManager.load();
    const url = testManager.getProviderKey('anthropic', 'url');
    expect(url).toBe('https://api.anthropic.com');
  });

  it('getProviderKey returns model', () => {
    testManager.load();
    const model = testManager.getProviderKey('openai', 'model');
    expect(model).toBe('gpt-4o');
  });

  it('getModelCost returns empty string by default', () => {
    testManager.load();
    expect(testManager.getModelCost()).toBe('');
  });

  it('getModelContextWindow returns correct value', () => {
    testManager.load();
    expect(testManager.getModelContextWindow()).toBe(200000);
  });

  it('syncs top-level model to provider default on setCurrentProvider', () => {
    testManager.load();
    expect(testManager.getActiveModel()).toBe('claude-sonnet-4-6');
    testManager.setCurrentProvider('openrouter');
    expect(testManager.getActiveModel()).toBe('anthropic/claude-sonnet-4-6');
    expect(testManager.getCurrentProvider()).toBe('openrouter');
  });

  it('syncs model on load when current_provider is openrouter', () => {
    require('node:fs').writeFileSync(_settingsFile, JSON.stringify({
      current_provider: 'openrouter',
      providers: DEFAULT_SETTINGS.providers,
      channels: DEFAULT_SETTINGS.channels,
      heartbeat: DEFAULT_SETTINGS.heartbeat,
      safety: DEFAULT_SETTINGS.safety,
      auto_compact: DEFAULT_SETTINGS.auto_compact,
      tools_per_call: DEFAULT_SETTINGS.tools_per_call,
      websearch_per_call: DEFAULT_SETTINGS.websearch_per_call,
      brave_search_api_key: DEFAULT_SETTINGS.brave_search_api_key,
      mcp_servers: {},
      pricing_tier_warn: DEFAULT_SETTINGS.pricing_tier_warn,
    }));
    testManager.load();
    // Top-level model should be synced to openrouter's default
    expect(testManager.getActiveModel()).toBe('anthropic/claude-sonnet-4-6');
    expect(testManager.getCurrentProvider()).toBe('openrouter');
  });

  it('switching provider loads that providers model', () => {
    testManager.load();
    testManager.setProviderKey('anthropic', 'model', 'claude-opus-4-7');
    expect(testManager.getActiveModel()).toBe('claude-opus-4-7');
    testManager.setCurrentProvider('openrouter');
    // Should load openrouter's default model, not the anthropic one we set
    expect(testManager.getActiveModel()).toBe('anthropic/claude-sonnet-4-6');
  });

  it('setProviderKey persists provider model across load', () => {
    testManager.load();
    testManager.setProviderKey('local', 'model', 'qwen-123');
    expect(testManager.getProviderKey('local', 'model')).toBe('qwen-123');
  });

  it('detects flat format with MODEL_API_KEY', () => {
    expect(isLegacyFlatFormat({ MODEL_API_KEY: 'test' })).toBe(true);
    expect(isLegacyFlatFormat({ model_api_key: 'test' })).toBe(true);
    expect(isLegacyFlatFormat({ providers: { anthropic: {} } })).toBe(false);
  });

  it('migrates flat anthropic config to nested', () => {
    const flat = {
      MODEL_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-test-123',
      ANTHROPIC_URL: 'https://custom.anthropic.com',
      model: 'claude-opus-4-5',
      TOOLS_PER_CALL: 5,
    };
    const nested = migrateFlatToNested(flat);
    expect(nested.current_provider).toBe('anthropic');
    expect(nested.providers.anthropic.api_key).toBe('sk-test-123');
    expect(nested.providers.anthropic.url).toBe('https://custom.anthropic.com');
    expect(nested.providers.anthropic.model).toBe('claude-opus-4-5');
    expect(nested.tools_per_call).toBe(5);
  });

  it('migrates flat openrouter config to nested', () => {
    const flat = {
      MODEL_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'sk-or-test',
      model: 'anthropic/claude-3-opus',
    };
    const nested = migrateFlatToNested(flat);
    expect(nested.current_provider).toBe('openrouter');
    expect(nested.providers.openrouter.api_key).toBe('sk-or-test');
    expect(nested.providers.openrouter.model).toBe('anthropic/claude-3-opus');
  });

  it('migrates flat ollama config to nested', () => {
    const flat = {
      MODEL_PROVIDER: 'ollama',
      MODEL_API_KEY: '',
      MODEL_URL: 'http://localhost:11434/v1',
      model: 'llama3.2',
    };
    const nested = migrateFlatToNested(flat);
    expect(nested.current_provider).toBe('ollama');
    expect(nested.providers.ollama.url).toBe('http://localhost:11434/v1');
    expect(nested.providers.ollama.model).toBe('llama3.2');
  });

  it('migrates MODEL_COST and MODEL_CONTEXT_WINDOW into current provider', () => {
    const flat = {
      MODEL_PROVIDER: 'anthropic',
      MODEL_COST: '0.5;3.0',
      MODEL_CONTEXT_WINDOW: 250000,
    };
    const nested = migrateFlatToNested(flat);
    expect(nested.providers.anthropic.model_cost).toBe('0.5;3.0');
    expect(nested.providers.anthropic.model_context_window).toBe(250000);
  });

  it('migrates channels settings', () => {
    const flat = {
      TELEGRAM_BOT_TOKEN: '123:ABC',
      TELEGRAM_USER_ID: '456',
      CHANNEL_TAB_ACTIVE: 'work',
    };
    const nested = migrateFlatToNested(flat);
    expect(nested.channels.bot_token).toBe('123:ABC');
    expect(nested.channels.user_id).toBe('456');
    expect(nested.channels.tab_active).toBe('work');
  });

  it('migrates case-insensitive keys', () => {
    const flat = {
      model_api_key: 'lowercase-key',
      model_provider: 'openai',
      Model_Cost: '1.0;2.0',
    };
    const nested = migrateFlatToNested(flat);
    // model_api_key is global, feeds all providers
    expect(nested.providers.anthropic.api_key).toBe('lowercase-key');
    expect(nested.providers.openai.api_key).toBe('lowercase-key');
    // Model_Cost -> current_provider (openai) model_cost
    expect(nested.providers.openai.model_cost).toBe('1.0;2.0');
  });

  it('strips legacy keys on save', () => {
    testManager.load();
    testManager.update({
      current_provider: 'anthropic',
      providers: { ...DEFAULT_SETTINGS.providers, anthropic: { ...DEFAULT_SETTINGS.providers.anthropic, api_key: 'test' } },
      tools_per_call: 8,
    });
    // The save should not include legacy flat keys
    const saved = JSON.parse(require('node:fs').readFileSync(_settingsFile, 'utf-8'));
    expect(saved.MODEL_API_KEY).toBeUndefined();
    expect(saved.TOOLS_PER_CALL).toBeUndefined();
    expect(saved.tools_per_call).toBe(8);
    expect(saved.providers.anthropic.api_key).toBe('test');
  });
});
