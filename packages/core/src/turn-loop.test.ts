import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Event } from './event-bus.js';
import { TurnLoop } from './turn-loop.js';
import { EventBus, type ProviderStream, type Tool, type ProviderEvent } from './turn-loop.js';
import { SessionStore } from './session-store.js';
import { withMessageTimestamp } from './context.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

function randomDir(): string {
  return path.join(os.tmpdir(), 'curie-agent-test-turn-loop', crypto.randomUUID());
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

function createTestStore(): SessionStore {
  return new SessionStore(tmpDir);
}

function createTurnLoop(store: SessionStore) {
  const mockProvider: ProviderStream = {
    name: 'test',
    stream: () => ({
      iterable: (async function* () {})(),
      cancel() {},
    }),
    check: async () => 'APPROVE',
  };

  const tools: Tool[] = [];

  const loop = new TurnLoop(
    {
      provider: mockProvider,
      model: 'test-model',
      tools,
      cwd: '/tmp',
      settings: {},
    },
    store,
  );

  return loop;
}

describe('reconstructMessages', () => {
  it('returns empty array when no events exist', () => {
    const store = createTestStore();
    const loop = createTurnLoop(store);
    const messages = (loop as any).reconstructMessages([]);
    expect(messages).toEqual([]);
  });

  it('reconstructs a simple single-turn conversation', () => {
    const store = createTestStore();
    const loop = createTurnLoop(store);

    const events: Event[] = [
      { type: 'user-prompt', id: 'u1', text: 'hello', cwd: '/tmp', timestamp: 1000 },
      { type: 'assistant-delta', id: 'a1', text: 'Hi ', timestamp: 1001 },
      { type: 'assistant-delta', id: 'a2', text: 'there!', timestamp: 1002 },
      { type: 'assistant-stop', id: 's1', timestamp: 1003 },
    ];

    const messages = (loop as any).reconstructMessages(events);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'user', content: withMessageTimestamp('hello', 1000) });
    // Consecutive deltas coalesce into one block, not one block per delta.
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi there!' }],
    });
  });

  it('reconstructs assistant with tool-use blocks', () => {
    const store = createTestStore();
    const loop = createTurnLoop(store);

    const events: Event[] = [
      { type: 'user-prompt', id: 'u1', text: 'read file', cwd: '/tmp', timestamp: 1000 },
      { type: 'assistant-delta', id: 'a1', text: 'Let me read ', timestamp: 1001 },
      {
        type: 'tool-call',
        id: 'tc1',
        toolCallId: 'call_1',
        name: 'Read',
        input: { path: '/app/main.ts' },
        timestamp: 1002,
      },
      { type: 'assistant-stop', id: 's1', timestamp: 1003 },
      {
        type: 'tool-result',
        id: 'tr1',
        toolCallId: 'call_1',
        output: 'file contents here',
        timestamp: 1004,
      },
    ];

    const messages = (loop as any).reconstructMessages(events);

    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: 'user', content: withMessageTimestamp('read file', 1000) });
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me read ' },
        { type: 'tool-use', id: 'call_1', name: 'Read', input: { path: '/app/main.ts' } },
      ],
    });
    expect(messages[2]).toEqual({ role: 'tool', toolUseId: 'call_1', toolName: 'Read', content: 'file contents here' });
  });

  it('handles object output by JSON.stringifying it', () => {
    const store = createTestStore();
    const loop = createTurnLoop(store);

    const events: Event[] = [
      { type: 'user-prompt', id: 'u1', text: 'test', cwd: '/tmp', timestamp: 1000 },
      { type: 'assistant-delta', id: 'a1', text: 'ok', timestamp: 1001 },
      {
        type: 'tool-call',
        id: 'tc1',
        toolCallId: 'call_1',
        name: 'Bash',
        input: { command: 'ls' },
        timestamp: 1002,
      },
      {
        type: 'tool-result',
        id: 'tr1',
        toolCallId: 'call_1',
        output: { files: ['a.txt', 'b.txt'], size: 1024 },
        timestamp: 1003,
      },
    ];

    const messages = (loop as any).reconstructMessages(events);

    expect(messages[2]).toEqual({
      role: 'tool',
      toolUseId: 'call_1',
      toolName: 'Bash',
      content: JSON.stringify({ files: ['a.txt', 'b.txt'], size: 1024 }),
    });
  });

  it('handles multiple turns', () => {
    const store = createTestStore();
    const loop = createTurnLoop(store);

    const events: Event[] = [
      // Turn 1
      { type: 'user-prompt', id: 'u1', text: 'first', cwd: '/tmp', timestamp: 1000 },
      { type: 'assistant-delta', id: 'a1', text: 'response 1', timestamp: 1001 },
      { type: 'assistant-stop', id: 's1', timestamp: 1002 },
      // Turn 2
      { type: 'user-prompt', id: 'u2', text: 'second', cwd: '/tmp', timestamp: 2000 },
      { type: 'assistant-delta', id: 'a2', text: 'response 2', timestamp: 2001 },
      { type: 'assistant-stop', id: 's2', timestamp: 2002 },
    ];

    const messages = (loop as any).reconstructMessages(events);

    expect(messages).toHaveLength(4);
    expect(messages[0]).toEqual({ role: 'user', content: withMessageTimestamp('first', 1000) });
    expect(messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'response 1' }] });
    expect(messages[2]).toEqual({ role: 'user', content: withMessageTimestamp('second', 2000) });
    expect(messages[3]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'response 2' }] });
  });

  it('skips non-content events (usage, approval-request, etc.)', () => {
    const store = createTestStore();
    const loop = createTurnLoop(store);

    const events: Event[] = [
      { type: 'user-prompt', id: 'u1', text: 'hello', cwd: '/tmp', timestamp: 1000 },
      { type: 'usage', id: 'u1', inputTokens: 100, outputTokens: 50, timestamp: 1001 },
      { type: 'assistant-delta', id: 'a1', text: 'hi', timestamp: 1002 },
      { type: 'approval-request', id: 'ar1', toolCallId: 'call_1', name: 'Read', input: {}, decision: 'ask', timestamp: 1003 },
      { type: 'assistant-stop', id: 's1', timestamp: 1004 },
    ];

    const messages = (loop as any).reconstructMessages(events);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'user', content: withMessageTimestamp('hello', 1000) });
    expect(messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'hi' }] });
  });

  it('groups tool calls and results by turn (bounded by user-prompt)', () => {
    const store = createTestStore();
    const loop = createTurnLoop(store);

    const events: Event[] = [
      // Turn 1: user asks, assistant uses 2 tools
      { type: 'user-prompt', id: 'u1', text: 'do stuff', cwd: '/tmp', timestamp: 1000 },
      { type: 'assistant-delta', id: 'a1', text: 'checking ', timestamp: 1001 },
      {
        type: 'tool-call',
        id: 'tc1',
        toolCallId: 'call_1',
        name: 'Read',
        input: { path: '/a.txt' },
        timestamp: 1002,
      },
      { type: 'assistant-delta', id: 'a2', text: 'and ', timestamp: 1003 },
      {
        type: 'tool-call',
        id: 'tc2',
        toolCallId: 'call_2',
        name: 'Glob',
        input: { pattern: '*.txt' },
        timestamp: 1004,
      },
      { type: 'assistant-stop', id: 's1', timestamp: 1005 },
      { type: 'tool-result', id: 'tr1', toolCallId: 'call_1', output: 'a.txt content', timestamp: 1006 },
      { type: 'tool-result', id: 'tr2', toolCallId: 'call_2', output: 'b.txt\nc.txt', timestamp: 1007 },
      // Turn 2: user responds
      { type: 'user-prompt', id: 'u2', text: 'got it', cwd: '/tmp', timestamp: 2000 },
      { type: 'assistant-delta', id: 'a3', text: 'done', timestamp: 2001 },
    ];

    const messages = (loop as any).reconstructMessages(events);

    expect(messages).toHaveLength(6);

    // Turn 1: user message
    expect(messages[0]).toEqual({ role: 'user', content: withMessageTimestamp('do stuff', 1000) });

    // Turn 1: assistant with 2 tool-use blocks. The two deltas coalesce into a
    // single text block — one block per persisted delta would make a resumed
    // session hundreds of tiny blocks of pure JSON overhead.
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'text', text: 'checking and ' },
        { type: 'tool-use', id: 'call_1', name: 'Read', input: { path: '/a.txt' } },
        { type: 'tool-use', id: 'call_2', name: 'Glob', input: { pattern: '*.txt' } },
      ],
    });

    // Turn 1: tool results
    expect(messages[2]).toEqual({ role: 'tool', toolUseId: 'call_1', toolName: 'Read', content: 'a.txt content' });
    expect(messages[3]).toEqual({ role: 'tool', toolUseId: 'call_2', toolName: 'Glob', content: 'b.txt\nc.txt' });

    // Turn 2: user message
    expect(messages[4]).toEqual({ role: 'user', content: withMessageTimestamp('got it', 2000) });

    // Turn 2: assistant response
    expect(messages[5]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'done' }] });
  });
});

describe('prompt-cache stability', () => {
  it('reconstructs a resumed session\'s user messages byte-identical to what was originally streamed', async () => {
    const store = createTestStore();
    const calls: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
    const responses = ['reply one', 'reply two'];
    let callIndex = 0;

    const provider: ProviderStream = {
      name: 'test',
      stream: (args) => {
        calls.push(args as { messages: Array<{ role: string; content: unknown }> });
        const text = responses[callIndex++] ?? 'ok';
        return {
          iterable: (async function* () {
            yield { type: 'text-delta', text } as ProviderEvent;
            yield { type: 'stop', reason: 'stop' } as ProviderEvent;
          })(),
          cancel() {},
        };
      },
      check: async () => 'APPROVE',
    };

    const loop1 = new TurnLoop(
      { provider, model: 'test-model', tools: [], cwd: tmpDir, settings: { providers: {}, current_provider: 'test' } },
      store,
    );
    const result1 = await loop1.run('first message');

    const loop2 = new TurnLoop(
      {
        provider,
        model: 'test-model',
        tools: [],
        cwd: tmpDir,
        settings: { providers: {}, current_provider: 'test' },
        resumeSessionId: result1.sessionId,
      },
      store,
    );
    await loop2.run('second message');

    expect(calls).toHaveLength(2);
    // The first user message as reconstructed on resume must be byte-identical
    // to what was actually streamed live in turn 1 — otherwise every resume
    // busts the provider's cached prefix.
    expect(calls[1]!.messages[0]).toEqual(calls[0]!.messages[0]);
  });

  it('keeps the system prompt byte-identical across turns within one run, with no timestamp', async () => {
    const store = createTestStore();
    const calls: Array<{ system?: string }> = [];
    let turnIdx = 0;

    const provider: ProviderStream = {
      name: 'test',
      stream: (args) => {
        calls.push(args as { system?: string });
        return {
          iterable: (async function* () {
            if (turnIdx++ === 0) {
              yield { type: 'tool-call', id: 'call_1', name: 'Read', input: {} } as ProviderEvent;
            } else {
              yield { type: 'text-delta', text: 'done' } as ProviderEvent;
            }
            yield { type: 'stop', reason: 'stop' } as ProviderEvent;
          })(),
          cancel() {},
        };
      },
      check: async () => 'APPROVE',
    };

    const readTool: Tool = {
      definition: { name: 'Read', description: 'read a file', inputSchema: { type: 'object', properties: {} } },
      execute: async () => ({ output: 'file contents' }),
    };

    const loop = new TurnLoop(
      {
        provider,
        model: 'test-model',
        tools: [readTool],
        cwd: tmpDir,
        settings: { providers: {}, current_provider: 'test' },
        system: 'You are curie-agent, a helpful coding assistant.',
      },
      store,
    );

    await loop.run('do something with a file');

    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]!.system).toBe(calls[1]!.system);
    expect(calls[0]!.system).toContain('[Operating system:');
    expect(calls[0]!.system).not.toContain('[Current date and time:');
    expect(calls[0]!.system).not.toContain('[Message sent at:');
  });
});

describe('unknown tool handling', () => {
  it('lists available tools in the unknown-tool error', async () => {
    const store = createTestStore();

    let streamCalls = 0;
    const mockProvider: ProviderStream = {
      name: 'test',
      stream: () => ({
        iterable: (async function* () {
          if (streamCalls++ === 0) {
            yield { type: 'tool-call', id: 'call_1', name: 'Bogus', input: {} } as const;
          }
        })(),
        cancel() {},
      }),
      check: async () => 'APPROVE',
    };

    const dummyTool = (name: string): Tool => ({
      definition: { name, description: 'dummy', inputSchema: { type: 'object', properties: {} } },
      execute: async () => ({ output: 'ok' }),
    });

    const loop = new TurnLoop(
      {
        provider: mockProvider,
        model: 'test-model',
        tools: [dummyTool('Read'), dummyTool('Glob')],
        cwd: tmpDir,
        settings: { providers: {}, current_provider: 'test' },
      },
      store,
    );

    const result = await loop.run('call something');
    const toolResults = result.events.filter((e) => e.type === 'tool-result');
    expect(toolResults).toHaveLength(1);
    const error = (toolResults[0] as { error?: string }).error;
    expect(error).toContain('Unknown tool: Bogus');
    expect(error).toContain('Available tools: Read, Glob');
  });
});

describe('tool-result clientOutput', () => {
  it('emits clientOutput as the tool-result event output, while message history keeps output', async () => {
    const store = createTestStore();

    let streamCalls = 0;
    const mockProvider: ProviderStream = {
      name: 'test',
      stream: () => ({
        iterable: (async function* () {
          if (streamCalls++ === 0) {
            yield { type: 'tool-call', id: 'call_1', name: 'Chart', input: {} } as const;
          }
        })(),
        cancel() {},
      }),
      check: async () => 'APPROVE',
    };

    const chartLikeTool: Tool = {
      definition: { name: 'Chart', description: 'chart', inputSchema: { type: 'object', properties: {} } },
      execute: async () => ({ output: 'terse', clientOutput: { rich: true } }),
    };

    const loop = new TurnLoop(
      {
        provider: mockProvider,
        model: 'test-model',
        tools: [chartLikeTool],
        cwd: tmpDir,
        settings: { providers: {}, current_provider: 'test' },
      },
      store,
    );

    const result = await loop.run('draw a chart');
    const toolResult = result.events.find((e) => e.type === 'tool-result') as { output?: unknown } | undefined;
    expect(toolResult?.output).toEqual({ rich: true });

    const messages = loop.getMessages();
    const toolMessage = messages.find((m: any) => m.role === 'tool');
    expect((toolMessage as any)?.content).toBe('terse');
  });
});

describe('TurnLoop.getMessages', () => {
  it('returns empty array for new loop', () => {
    const store = createTestStore();
    const loop = createTurnLoop(store);
    expect(loop.getMessages()).toEqual([]);
  });

  it('returns a copy, not the internal array', () => {
    const store = createTestStore();
    const loop = createTurnLoop(store);
    const msgs = loop.getMessages();
    msgs.push({ role: 'user', content: 'injected' } as any);
    expect(loop.getMessages()).toEqual([]);
  });
});

describe('TurnLoop.evaluateHarm — prompt size', () => {
  function loopWithCapturingProvider(store: SessionStore) {
    const seen: Array<{ prompt: string; system?: string }> = [];
    const mockProvider: ProviderStream = {
      name: 'test',
      stream: () => ({ iterable: (async function* () {})(), cancel() {} }),
      check: async (prompt, args) => {
        seen.push({ prompt, system: args?.system });
        return 'APPROVE';
      },
    };
    const loop = new TurnLoop(
      { provider: mockProvider, model: 'test-model', tools: [], cwd: '/tmp', settings: {} },
      store,
    );
    return { loop, seen };
  }

  it('does not send a large Write body to the harm-check', async () => {
    const { loop, seen } = loopWithCapturingProvider(createTestStore());
    const content = 'q'.repeat(50_000);

    const result = await (loop as any).evaluateHarm('Write', { file_path: '/app/main.ts', content });

    expect(result.approved).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.prompt).not.toContain(content);
    expect(seen[0]!.prompt).toContain('/app/main.ts');
    expect(seen[0]!.prompt).toContain('…[50000 chars total]');
    expect(seen[0]!.prompt.length).toBeLessThan(2000);
  });

  it('still sends the full Bash command, the primary safety signal', async () => {
    const { loop, seen } = loopWithCapturingProvider(createTestStore());

    await (loop as any).evaluateHarm('Bash', { command: 'rm -rf / --no-preserve-root' });

    expect(seen[0]!.prompt).toContain('rm -rf / --no-preserve-root');
  });

  it('tells the evaluator that long values are abbreviated', async () => {
    const { loop, seen } = loopWithCapturingProvider(createTestStore());

    await (loop as any).evaluateHarm('Read', { file_path: '/a.ts' });

    expect(seen[0]!.system).toContain('chars total');
    expect(seen[0]!.system).toContain('never ask for the full value');
  });
});
