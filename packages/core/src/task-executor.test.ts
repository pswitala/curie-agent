import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskExecutor } from './task-executor.js';
import type { ProviderStream } from './turn-loop.js';

function randomDir(): string {
  return path.join(os.tmpdir(), 'curie-agent-test-task-executor', crypto.randomUUID());
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = randomDir();
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function createMockProvider(): ProviderStream {
  return {
    name: 'test',
    stream: () => ({
      iterable: (async function* () {})(),
      cancel() {},
    }),
    check: async () => 'APPROVE',
  };
}

describe('TaskExecutor', () => {
  it('constructs with required config', () => {
    const executor = new TaskExecutor({
      provider: createMockProvider(),
      model: 'test-model',
      tools: [],
      cwd: tmpDir,
      settings: {},
      instruction: 'Check abc.com and summarize',
    });
    expect(executor).toBeTruthy();
  });

  it('accepts optional maxTurns', () => {
    const executor = new TaskExecutor({
      provider: createMockProvider(),
      model: 'test-model',
      tools: [],
      cwd: tmpDir,
      settings: {},
      instruction: 'Test',
      maxTurns: 20,
    });
    expect(executor).toBeTruthy();
  });

  it('builds prompt with instruction, context, and timestamp', () => {
    const executor = new TaskExecutor({
      provider: createMockProvider(),
      model: 'test-model',
      tools: [],
      cwd: tmpDir,
      settings: {},
      instruction: 'Make a report',
    });
    // Access private buildPrompt method
    const prompt = (executor as any).buildPrompt('Make a report', 'Some context');
    expect(prompt).toContain('=== TASK INSTRUCTION ===');
    expect(prompt).toContain('Make a report');
    expect(prompt).toContain('=== GATHERED CONTEXT ===');
    expect(prompt).toContain('Some context');
    expect(prompt).toContain('=== CURRENT TIME ===');
    expect(prompt).toContain('Execute the task instruction above');
  });

  it('builds prompt with empty context', () => {
    const executor = new TaskExecutor({
      provider: createMockProvider(),
      model: 'test-model',
      tools: [],
      cwd: tmpDir,
      settings: {},
      instruction: 'Do something',
    });
    const prompt = (executor as any).buildPrompt('Do something', '');
    expect(prompt).toContain('(no context files found)');
  });

  it('gathers context from existing files', () => {
    const curieDir = path.join(tmpDir, 'curie');
    fs.mkdirSync(curieDir, { recursive: true });
    fs.writeFileSync(path.join(curieDir, 'MEMORY.md'), '# Memory');
    fs.writeFileSync(path.join(curieDir, 'USER.md'), '# User');
    fs.writeFileSync(path.join(tmpDir, 'todo.json'), JSON.stringify({ version: 1, tasks: [{ id: 'abc', title: 'Test task', status: 'todo' }] }));

    const executor = new TaskExecutor({
      provider: createMockProvider(),
      model: 'test-model',
      tools: [],
      cwd: tmpDir,
      settings: {},
      instruction: 'Test',
    });
    (executor as any).curieDir = curieDir;

    const context = (executor as any).gatherContext();
    expect(context).toContain('=== MEMORY.md ===');
    expect(context).toContain('# Memory');
    expect(context).toContain('=== USER.md ===');
    expect(context).toContain('# User');
    expect(context).toContain('=== Project Tasks ===');
    expect(context).toContain('Test task');
  });

  it('gathers context without crashing when files are missing', () => {
    const curieDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(curieDir, { recursive: true });

    const executor = new TaskExecutor({
      provider: createMockProvider(),
      model: 'test-model',
      tools: [],
      cwd: tmpDir,
      settings: {},
      instruction: 'Test',
    });
    (executor as any).curieDir = curieDir;

    const context = (executor as any).gatherContext();
    expect(context).toBe('');
  });

  it('includes memory directory in context', () => {
    const curieDir = path.join(tmpDir, 'curie');
    const memoryDir = path.join(curieDir, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });

    const executor = new TaskExecutor({
      provider: createMockProvider(),
      model: 'test-model',
      tools: [],
      cwd: tmpDir,
      settings: {},
      instruction: 'Test',
    });
    (executor as any).curieDir = curieDir;

    const context = (executor as any).gatherContext();
    expect(context).toContain('=== Memory Directory ===');
  });

  it('executes without throwing', async () => {
    const executor = new TaskExecutor({
      provider: createMockProvider(),
      model: 'test-model',
      tools: [],
      cwd: tmpDir,
      settings: {},
      instruction: 'Test execution',
      maxTurns: 1,
    });
    const result = await executor.execute();
    expect(result.sessionId).toBeTruthy();
    expect(result.toolCalls).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
