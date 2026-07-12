import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Event } from './event-bus.js';
import { TurnLoop } from './turn-loop.js';
import { EventBus, type ProviderStream, type Tool } from './turn-loop.js';
import { SessionStore } from './session-store.js';
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
    expect(messages[0]).toEqual({ role: 'user', content: 'hello' });
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi ' }, { type: 'text', text: 'there!' }],
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
    expect(messages[0]).toEqual({ role: 'user', content: 'read file' });
    expect(messages[1]).toEqual({
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
    expect(messages[0]).toEqual({ role: 'user', content: 'first' });
    expect(messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'response 1' }] });
    expect(messages[2]).toEqual({ role: 'user', content: 'second' });
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
    expect(messages[0]).toEqual({ role: 'user', content: 'hello' });
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
    expect(messages[0]).toEqual({ role: 'user', content: 'do stuff' });

    // Turn 1: assistant with 2 tool-use blocks
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'checking ' },
        { type: 'text', text: 'and ' },
        { type: 'tool-use', id: 'call_1', name: 'Read', input: { path: '/a.txt' } },
        { type: 'tool-use', id: 'call_2', name: 'Glob', input: { pattern: '*.txt' } },
      ],
    });

    // Turn 1: tool results
    expect(messages[2]).toEqual({ role: 'tool', toolUseId: 'call_1', toolName: 'Read', content: 'a.txt content' });
    expect(messages[3]).toEqual({ role: 'tool', toolUseId: 'call_2', toolName: 'Glob', content: 'b.txt\nc.txt' });

    // Turn 2: user message
    expect(messages[4]).toEqual({ role: 'user', content: 'got it' });

    // Turn 2: assistant response
    expect(messages[5]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'done' }] });
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
