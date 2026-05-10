import { describe, it, expect, vi } from 'vitest';
import { createRegistry } from './provider.js';

describe('createRegistry', () => {
  it('returns an empty registry initially', () => {
    const reg = createRegistry();
    expect(reg.list()).toEqual([]);
    expect(reg.get('nonexistent')).toBeUndefined();
  });

  it('registers and retrieves a provider by name', () => {
    const reg = createRegistry();
    const mockProvider = {
      name: 'test',
      models: ['model-1'],
      defaultModel: 'model-1',
      stream: vi.fn(),
      check: vi.fn(),
      complete: vi.fn(),
    };
    reg.register(mockProvider);
    expect(reg.get('test')).toBe(mockProvider);
  });

  it('overwrites existing provider with same name', () => {
    const reg = createRegistry();
    const p1 = { name: 'test', models: [], defaultModel: '', stream: vi.fn(), check: vi.fn(), complete: vi.fn() };
    const p2 = { name: 'test', models: [], defaultModel: '', stream: vi.fn(), check: vi.fn(), complete: vi.fn() };
    reg.register(p1);
    reg.register(p2);
    expect(reg.get('test')).toBe(p2);
    expect(reg.list()).toHaveLength(1);
  });

  it('list returns all registered providers', () => {
    const reg = createRegistry();
    const p1 = { name: 'a', models: [], defaultModel: '', stream: vi.fn(), check: vi.fn(), complete: vi.fn() };
    const p2 = { name: 'b', models: [], defaultModel: '', stream: vi.fn(), check: vi.fn(), complete: vi.fn() };
    reg.register(p1);
    reg.register(p2);
    const list = reg.list();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name)).toContain('a');
    expect(list.map((p) => p.name)).toContain('b');
  });

  it('get returns undefined for unregistered names', () => {
    const reg = createRegistry();
    expect(reg.get('foo')).toBeUndefined();
  });
});
