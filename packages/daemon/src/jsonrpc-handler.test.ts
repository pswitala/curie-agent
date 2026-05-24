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
    expect(settingsManager.update).toHaveBeenCalled();
    expect(settingsManager.save).toHaveBeenCalled();
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
});

