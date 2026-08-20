import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubagentExecutor } from './subagent-executor.js';
import { EventBus } from './event-bus.js';
import { SessionStore } from './session-store.js';
import { DEFAULT_SETTINGS } from './settings.js';

function createMockProvider() {
  return {
    name: 'test',
    stream: vi.fn(() => ({
      iterable: (async function* () {})(),
      cancel: vi.fn(),
    })),
    check: vi.fn(() => Promise.resolve('APPROVE')),
  };
}

function createMockTool(name: string) {
  return {
    definition: { name, description: 'test', inputSchema: '{}' },
    execute: vi.fn(() => Promise.resolve({ output: null })),
  };
}

describe('SubagentExecutor', () => {
  let executor: SubagentExecutor;
  let eventBus: EventBus;
  let sessionStore: SessionStore;

  beforeEach(() => {
    eventBus = new EventBus();
    sessionStore = new SessionStore();
    executor = new SubagentExecutor(eventBus, sessionStore);
  });

  it('should spawn a subagent and return a handle', async () => {
    const mockProvider = createMockProvider();
    const mockTools = [createMockTool('Read'), createMockTool('Bash')];

    // The spawn will fail because the provider doesn't produce real events,
    // but it should create the handle and emit agent-start
    const handlePromise = executor.spawn({
      provider: mockProvider,
      model: 'test-model',
      tools: mockTools,
      cwd: '/tmp',
      settings: {} as any,
      prompt: 'Test task',
    });

    const handle = await handlePromise;

    expect(handle.agentId).toBeDefined();
    expect(handle.prompt).toBe('Test task');
    expect(['starting', 'running']).toContain(handle.status);
    expect(handle.sessionId).toBeDefined();
  });

  it('should list agents', () => {
    const all = executor.list();
    expect(Array.isArray(all)).toBe(true);
  });

  it('should list agents filtered by status', () => {
    const running = executor.list('running');
    expect(Array.isArray(running)).toBe(true);
  });

  it('should return undefined for unknown agent stats', () => {
    const stats = executor.stats('nonexistent');
    expect(stats).toBeUndefined();
  });

  it('should not allow sendMessage to non-existent agent', () => {
    const result = executor.sendMessage('nonexistent', 'hello');
    expect(result).toBe(false);
  });

  it('should not allow cancel of non-existent agent', () => {
    const result = executor.cancel('nonexistent');
    expect(result).toBe(false);
  });

  it('should shutdown cleanly', () => {
    executor.shutdown();
    expect(executor.list().length).toBe(0);
  });

  it('cancel() aborts the running child TurnLoop', async () => {
    // A provider that streams forever unless the TurnLoop breaks out of it.
    const neverEndingProvider = {
      name: 'test',
      stream: vi.fn(() => ({
        iterable: (async function* () {
          for (;;) {
            await new Promise((r) => setTimeout(r, 1));
            yield { type: 'text-delta', text: '.' };
          }
        })(),
        cancel: vi.fn(),
      })),
      check: vi.fn(() => Promise.resolve('APPROVE')),
    };

    const handle = await executor.spawn({
      provider: neverEndingProvider as any,
      model: 'test-model',
      tools: [],
      cwd: '/tmp',
      settings: DEFAULT_SETTINGS,
      prompt: 'run forever',
    });

    // Let the loop actually enter the stream before cancelling.
    await new Promise((r) => setTimeout(r, 20));

    expect(executor.cancel(handle.agentId)).toBe(true);

    const final = await executor.waitFor(handle.agentId);
    expect(final?.status).toBe('cancelled');
  });

  it('waitFor() returns undefined for an unknown agent', async () => {
    expect(await executor.waitFor('nonexistent')).toBeUndefined();
  });

  it('should enforce concurrency limit', async () => {
    const executor2 = new SubagentExecutor(eventBus, sessionStore, 1);
    const mockProvider = createMockProvider();
    const mockTools = [createMockTool('Read')];

    // Spawn first agent
    const handle1 = await executor2.spawn({
      provider: mockProvider,
      model: 'test-model',
      tools: mockTools,
      cwd: '/tmp',
      settings: {} as any,
      prompt: 'Task 1',
    });

    // Second spawn should fail due to concurrency limit
    await expect(executor2.spawn({
      provider: mockProvider,
      model: 'test-model',
      tools: mockTools,
      cwd: '/tmp',
      settings: {} as any,
      prompt: 'Task 2',
    })).rejects.toThrow(/Concurrency limit/);

    // Clean up
    executor2.shutdown();
  });
});
