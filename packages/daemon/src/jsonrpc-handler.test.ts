import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JsonRpcHandler } from './jsonrpc-handler.js';
import type { SessionStore, SettingsManager } from '@curie-agent/core';
import { Method } from '@curie-agent/protocol';

function createMockSessionStore(): jest.Mocked<SessionStore> {
  return {
    list: vi.fn(),
    load: vi.fn(),
    loadEvents: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
    appendEvent: vi.fn(),
    appendEvents: vi.fn(),
    sessionPath: vi.fn(),
    eventsPath: vi.fn(),
    metadataPath: vi.fn(),
    getFiles: vi.fn(),
  } as unknown as jest.Mocked<SessionStore>;
}

function createMockSettingsManager(): jest.Mocked<SettingsManager> {
  return {
    load: vi.fn(),
    save: vi.fn(),
    update: vi.fn(),
    get: vi.fn().mockReturnValue({
      model: 'claude-sonnet-4-6',
      providers: {
        anthropic: { api_key: 'test-key', url: 'https://api.anthropic.com', model: 'claude-sonnet-4-6' },
        openai: { api_key: '', url: 'https://api.openai.com', model: 'gpt-4o' },
      },
    }),
    getActiveModel: vi.fn(),
    getCurrentProvider: vi.fn(),
    getProviderKey: vi.fn(),
    setProviderKey: vi.fn(),
    setCurrentProvider: vi.fn(),
    getModelCost: vi.fn(),
    getModelContextWindow: vi.fn(),
  } as unknown as jest.Mocked<SettingsManager>;
}

describe('JsonRpcHandler', () => {
  let sessionStore: jest.Mocked<SessionStore>;
  let settingsManager: jest.Mocked<SettingsManager>;
  let handler: JsonRpcHandler;

  beforeEach(() => {
    sessionStore = createMockSessionStore();
    settingsManager = createMockSettingsManager();
    handler = new JsonRpcHandler(sessionStore, settingsManager);
  });

  it('handles session.list', async () => {
    sessionStore.list.mockReturnValue([{ id: 's1', cwd: '/tmp', model: 'sonnet', provider: 'anthropic', createdAt: 1, updatedAt: 1 }]);
    const result = await handler.handle({ jsonrpc: '2.0', id: 1, method: Method.SESSION_LIST });
    expect(result).toHaveProperty('result');
    expect((result as any).result).toHaveLength(1);
  });

  it('handles session.get with valid id', async () => {
    sessionStore.load.mockReturnValue({ id: 's1', cwd: '/tmp', model: 'sonnet', provider: 'anthropic', createdAt: 1, updatedAt: 1 });
    sessionStore.loadEvents.mockReturnValue([]);
    const result = await handler.handle({ jsonrpc: '2.0', id: 2, method: Method.SESSION_GET, params: { id: 's1' } });
    expect(result).toHaveProperty('result');
    expect((result as any).result).toHaveProperty('info');
    expect((result as any).result).toHaveProperty('events');
  });

  it('handles session.get with missing id', async () => {
    const result = await handler.handle({ jsonrpc: '2.0', id: 3, method: Method.SESSION_GET, params: {} });
    expect((result as any).error).toBeDefined();
    expect((result as any).error.code).toBe(-32602);
  });

  it('handles config.get with dot notation', async () => {
    const result = await handler.handle({ jsonrpc: '2.0', id: 4, method: Method.CONFIG_GET, params: { key: 'providers.anthropic.model' } });
    expect((result as any).result).toBe('claude-sonnet-4-6');
  });

  it('handles config.set', async () => {
    const result = await handler.handle({ jsonrpc: '2.0', id: 5, method: Method.CONFIG_SET, params: { key: 'model', value: 'claude-opus-4-7' } });
    expect((result as any).result).toEqual({ status: 'ok', key: 'model', value: 'claude-opus-4-7' });
    // update() persists; the extra save() it used to call was redundant.
    expect(settingsManager.update).toHaveBeenCalled();
  });

  it('handles provider.list', async () => {
    const result = await handler.handle({ jsonrpc: '2.0', id: 6, method: Method.PROVIDER_LIST });
    const list = (result as any).result;
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  it('returns error for unknown method', async () => {
    const result = await handler.handle({ jsonrpc: '2.0', id: 7, method: 'unknown.method' });
    expect((result as any).error).toBeDefined();
    expect((result as any).error.code).toBe(-32601);
  });

  it('handles session.send without provider', async () => {
    const result = await handler.handle({ jsonrpc: '2.0', id: 8, method: Method.SESSION_SEND, params: { id: 's1', text: 'hello' } });
    expect((result as any).result).toEqual({ status: 'error: no provider configured' });
  });

  it('handles session.send with missing params', async () => {
    const result = await handler.handle({ jsonrpc: '2.0', id: 9, method: Method.SESSION_SEND, params: { id: 's1' } });
    expect((result as any).error).toBeDefined();
    expect((result as any).error.code).toBe(-32602);
  });

  describe('session.stats', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    it('includes a session resumed today even though it was created yesterday', async () => {
      sessionStore.list.mockReturnValue([
        { id: 'resumed', cwd: '/tmp', model: 'sonnet', provider: 'anthropic', createdAt: yesterday.getTime(), updatedAt: Date.now(), type: 'webui' },
      ]);
      sessionStore.loadEvents.mockReturnValue([
        { type: 'tool-call', id: 'e1', toolCallId: 'c1', name: 'Read', input: {}, timestamp: Date.now() } as any,
      ]);

      const result = await handler.handle({ jsonrpc: '2.0', id: 10, method: Method.SESSION_STATS });
      const stats = (result as any).result;
      expect(stats.summary.totalSessionsToday).toBe(1);
      expect(stats.summary.totalToolCalls).toBe(1);
    });

    it('excludes Chart (a PURE_TOOLS entry) from tool-call counts, matching the ChatView per-turn badge', async () => {
      sessionStore.list.mockReturnValue([
        { id: 's1', cwd: '/tmp', model: 'sonnet', provider: 'anthropic', createdAt: Date.now(), updatedAt: Date.now(), type: 'webui' },
      ]);
      sessionStore.loadEvents.mockReturnValue([
        { type: 'tool-call', id: 'e1', toolCallId: 'c1', name: 'Chart', input: {}, timestamp: Date.now() } as any,
        { type: 'tool-call', id: 'e2', toolCallId: 'c2', name: 'Read', input: {}, timestamp: Date.now() } as any,
      ]);

      const result = await handler.handle({ jsonrpc: '2.0', id: 11, method: Method.SESSION_STATS });
      const stats = (result as any).result;
      expect(stats.summary.totalToolCalls).toBe(1);
      expect(stats.topTools.map((t: any) => t.name)).toEqual(['Read']);
    });
  });
});

/**
 * A settings manager whose get() reflects prior update() calls, which the
 * static mock above cannot do. Needed for the derived-model mirror, where the
 * handler writes and then immediately re-reads.
 */
function createStatefulSettingsManager(overrides: Record<string, unknown> = {}) {
  let state: Record<string, unknown> = {
    model: 'claude-sonnet-4-6',
    effort: 'auto',
    mode: 'auto',
    theme: 'nord',
    current_provider: 'anthropic',
    providers: {
      anthropic: { api_key: 'secret-anthropic-key', url: 'https://api.anthropic.com', model: 'claude-sonnet-4-6' },
      openai: { api_key: '', url: 'https://api.openai.com', model: 'gpt-4o' },
    },
    heartbeat: { schedule: 'off', daily: '6:00' },
    ...overrides,
  };
  return {
    load: vi.fn(() => state),
    save: vi.fn(),
    update: vi.fn((partial: Record<string, unknown>) => {
      state = { ...state, ...partial };
      return state;
    }),
    get: vi.fn(() => structuredClone(state)),
    getActiveModel: vi.fn(),
    getCurrentProvider: vi.fn(),
    getProviderKey: vi.fn(),
    setProviderKey: vi.fn(),
    setCurrentProvider: vi.fn(),
    getModelCost: vi.fn(),
    getModelContextWindow: vi.fn(),
    peek: () => state,
  } as unknown as jest.Mocked<SettingsManager> & { peek: () => Record<string, unknown> };
}

function createRecordingEventBus() {
  const events: Record<string, unknown>[] = [];
  return {
    bus: { emit: vi.fn((e: Record<string, unknown>) => { events.push(e); }), on: vi.fn(), off: vi.fn() } as any,
    events,
    configChanges: () => events.filter(e => e.type === 'config-changed'),
  };
}

describe('config.get bulk read', () => {
  let handler: JsonRpcHandler;

  beforeEach(() => {
    handler = new JsonRpcHandler(createMockSessionStore(), createStatefulSettingsManager());
  });

  it("returns the whole tree for key '*'", async () => {
    const result = await handler.handle({ jsonrpc: '2.0', id: 1, method: Method.CONFIG_GET, params: { key: '*' } });
    const tree = (result as any).result;
    expect(tree.theme).toBe('nord');
    expect(tree.providers.anthropic.model).toBe('claude-sonnet-4-6');
    expect(tree.heartbeat.daily).toBe('6:00');
  });

  it('returns the whole tree when key is omitted', async () => {
    const result = await handler.handle({ jsonrpc: '2.0', id: 2, method: Method.CONFIG_GET, params: {} });
    expect((result as any).result.current_provider).toBe('anthropic');
  });

  it('still resolves a literal dot path — the relaxed contract is backward compatible', async () => {
    const result = await handler.handle({ jsonrpc: '2.0', id: 3, method: Method.CONFIG_GET, params: { key: 'providers.anthropic.model' } });
    expect((result as any).result).toBe('claude-sonnet-4-6');
  });

  it('still resolves a top-level scalar', async () => {
    const result = await handler.handle({ jsonrpc: '2.0', id: 4, method: Method.CONFIG_GET, params: { key: 'theme' } });
    expect((result as any).result).toBe('nord');
  });

  it('returns undefined for an unknown path rather than erroring', async () => {
    const result = await handler.handle({ jsonrpc: '2.0', id: 5, method: Method.CONFIG_GET, params: { key: 'nope.nope' } });
    expect((result as any).result).toBeUndefined();
  });
});

describe('config.set derived-model mirror', () => {
  let settings: ReturnType<typeof createStatefulSettingsManager>;
  let handler: JsonRpcHandler;

  beforeEach(() => {
    settings = createStatefulSettingsManager();
    handler = new JsonRpcHandler(createMockSessionStore(), settings);
  });

  it("mirrors the active provider's model into the top-level `model`", async () => {
    // Without this, SettingsManager.load() recomputes `model` from the provider
    // on the next daemon start and the write silently reverts.
    await handler.handle({
      jsonrpc: '2.0', id: 1, method: Method.CONFIG_SET,
      params: { key: 'providers.anthropic.model', value: 'claude-opus-5' },
    });
    expect(settings.peek().model).toBe('claude-opus-5');
  });

  it('mirrors on a provider switch', async () => {
    await handler.handle({
      jsonrpc: '2.0', id: 2, method: Method.CONFIG_SET,
      params: { key: 'current_provider', value: 'openai' },
    });
    expect(settings.peek().model).toBe('gpt-4o');
  });

  it('does not mirror a model change on an inactive provider', async () => {
    await handler.handle({
      jsonrpc: '2.0', id: 3, method: Method.CONFIG_SET,
      params: { key: 'providers.openai.model', value: 'gpt-6' },
    });
    expect(settings.peek().model).toBe('claude-sonnet-4-6');
  });

  it('leaves unrelated keys alone', async () => {
    await handler.handle({
      jsonrpc: '2.0', id: 4, method: Method.CONFIG_SET,
      params: { key: 'theme', value: 'dracula' },
    });
    expect(settings.peek().theme).toBe('dracula');
    expect(settings.peek().model).toBe('claude-sonnet-4-6');
  });
});

describe('config-changed emission', () => {
  it('emits for a config.set write', async () => {
    const { bus, configChanges } = createRecordingEventBus();
    const handler = new JsonRpcHandler(createMockSessionStore(), createStatefulSettingsManager(), bus);
    await handler.handle({ jsonrpc: '2.0', id: 1, method: Method.CONFIG_SET, params: { key: 'theme', value: 'dracula' } });
    expect(configChanges()).toHaveLength(1);
    expect(configChanges()[0]).toMatchObject({ key: 'theme', value: 'dracula' });
  });

  it('emits an extra event for the mirrored model', async () => {
    const { bus, configChanges } = createRecordingEventBus();
    const handler = new JsonRpcHandler(createMockSessionStore(), createStatefulSettingsManager(), bus);
    await handler.handle({
      jsonrpc: '2.0', id: 2, method: Method.CONFIG_SET,
      params: { key: 'current_provider', value: 'openai' },
    });
    expect(configChanges().map(e => e.key)).toEqual(['current_provider', 'model']);
  });

  // /mode and /effort used to write settings without emitting, so the web
  // dashboard showed a stale value until the user reloaded.
  it.each([
    ['mode', 'plan'],
    ['effort', 'high'],
  ])('emits for the /%s slash command', async (command, value) => {
    const { bus, configChanges } = createRecordingEventBus();
    const sessionStore = createMockSessionStore();
    (sessionStore.metadataPath as any).mockReturnValue('/nonexistent');
    const handler = new JsonRpcHandler(sessionStore, createStatefulSettingsManager(), bus);

    await (handler as any).executeSlashCommand('s1', `/${command} ${value}`);

    expect(configChanges().filter(e => e.key === command)).toEqual([
      expect.objectContaining({ key: command, value }),
    ]);
  });

  it('does not emit for an invalid /mode value', async () => {
    const { bus, configChanges } = createRecordingEventBus();
    const sessionStore = createMockSessionStore();
    (sessionStore.metadataPath as any).mockReturnValue('/nonexistent');
    const handler = new JsonRpcHandler(sessionStore, createStatefulSettingsManager(), bus);

    await (handler as any).executeSlashCommand('s1', '/mode nonsense');

    expect(configChanges()).toHaveLength(0);
  });
});


describe('docs.* methods', () => {
  let handler: JsonRpcHandler;

  beforeEach(() => {
    handler = new JsonRpcHandler(createMockSessionStore(), createMockSettingsManager());
  });

  const call = (method: string, params?: Record<string, unknown>) =>
    handler.handle({ jsonrpc: '2.0', id: 1, method, params });

  it('rejects an unknown source on docs.read', async () => {
    const r: any = await call(Method.DOCS_READ, { source: 'wiki', path: 'x.md' });
    expect(r.error?.code).toBe(-32602);
  });

  it('rejects an unknown source on docs.list', async () => {
    const r: any = await call(Method.DOCS_LIST, { source: 'sessions' });
    expect(r.error?.code).toBe(-32602);
  });

  it('rejects a missing path on docs.read', async () => {
    const r: any = await call(Method.DOCS_READ, { source: 'memory' });
    expect(r.error?.code).toBe(-32602);
  });

  it('rejects a missing query on docs.search', async () => {
    const r: any = await call(Method.DOCS_SEARCH, { source: 'memory' });
    expect(r.error?.code).toBe(-32602);
  });

  it('returns both sources when source is omitted', async () => {
    const r: any = await call(Method.DOCS_LIST, {});
    expect(r.error).toBeUndefined();
    expect(r.result.sources.map((s: any) => s.source)).toEqual(['artifacts', 'memory']);
  });

  it('returns a result-level error for traversal rather than throwing', async () => {
    const r: any = await call(Method.DOCS_READ, { source: 'memory', path: '../.curie-settings.json' });
    expect(r.error).toBeUndefined();
    expect(r.result.error).toBeTruthy();
  });

  it('refuses a path outside the memory include predicate', async () => {
    const r: any = await call(Method.DOCS_READ, { source: 'memory', path: 'sessions/x.md' });
    expect(r.result.error).toBeTruthy();
  });
});
