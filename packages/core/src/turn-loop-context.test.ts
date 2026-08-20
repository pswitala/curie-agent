import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Event } from './event-bus.js';
import { TurnLoop, type ProviderStream, type Tool, type ProviderEvent } from './turn-loop.js';
import { SessionStore } from './session-store.js';
import { withMessageTimestamp } from './context.js';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), 'curie-agent-test-ctx', crypto.randomUUID());
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createTestStore(): SessionStore {
  return new SessionStore(tmpDir);
}

function inertLoop(store: SessionStore): TurnLoop {
  const provider: ProviderStream = {
    name: 'test',
    stream: () => ({ iterable: (async function* () { /* nothing */ })(), cancel() { /* noop */ } }),
    check: async () => 'APPROVE',
  };
  return new TurnLoop({ provider, model: 'test-model', tools: [], cwd: '/tmp', settings: {} as never }, store);
}

/**
 * Settings shaped like the failing research run: a real window, but tools that
 * return enough text to blow through it inside a single `run()`. Before mid-run
 * enforcement this configuration could only ever end in the hard-abort error.
 */
function tightSettings(over: Record<string, unknown> = {}): never {
  return {
    current_provider: 'test',
    providers: { test: { model_context_window: 20_000, max_output_tokens: 2_000 } },
    auto_compact: { enabled: 'on', threshold: 75, warn_threshold: 60, forced_threshold: 85 },
    ...over,
  } as never;
}

/** A tool whose result is large enough to fill the window in a few calls. */
function bloatTool(chars: number, name = 'WebFetch'): Tool {
  return {
    definition: { name, description: 'fetch a page', inputSchema: { type: 'object', properties: {} } },
    execute: async () => ({ output: 'x'.repeat(chars) }),
  };
}

/** Streams one tool call per turn for `toolTurns` turns, then a final text reply. */
function bloatProvider(toolTurns: number, summary = 'COMPACTED SUMMARY') {
  let turn = 0;
  const checkCalls: string[] = [];
  const provider: ProviderStream = {
    name: 'test',
    stream: () => {
      const i = turn++;
      return {
        iterable: (async function* () {
          if (i < toolTurns) {
            yield { type: 'tool-call', id: `call_${String(i)}`, name: 'WebFetch', input: { url: `https://e.com/${String(i)}` } } as ProviderEvent;
          } else {
            yield { type: 'text-delta', text: 'all done' } as ProviderEvent;
          }
          yield { type: 'stop', reason: 'stop' } as ProviderEvent;
        })(),
        cancel() { /* noop */ },
      };
    },
    check: async (prompt: string) => { checkCalls.push(prompt); return summary; },
  };
  return { provider, checkCalls };
}

describe('mid-run context enforcement', () => {
  it('compacts mid-run and COMPLETES instead of hard-aborting', async () => {
    const store = createTestStore();
    const { provider } = bloatProvider(6);
    const result = await new TurnLoop(
      { provider, model: 'test-model', tools: [bloatTool(30_000)], cwd: tmpDir, settings: tightSettings(), maxTurns: 20 },
      store,
    ).run('research everything');

    expect(result.reason).toBe('stop');
    expect(result.events.some(e => e.type === 'compaction')).toBe(true);
    expect(result.events.some(e => e.type === 'error')).toBe(false);
  });

  it('records real before/after token counts on the compaction event', async () => {
    const store = createTestStore();
    const { provider } = bloatProvider(6);
    const result = await new TurnLoop(
      { provider, model: 'test-model', tools: [bloatTool(30_000)], cwd: tmpDir, settings: tightSettings(), maxTurns: 20 },
      store,
    ).run('research everything');

    const c = result.events.find(e => e.type === 'compaction') as Extract<Event, { type: 'compaction' }>;
    expect(c).toBeDefined();
    expect(c.tokensBefore).toBeGreaterThan(c.tokensAfter);
    expect(c.summarizedMessageCount).toBeGreaterThan(0);
    expect(c.summary).toBe('COMPACTED SUMMARY');
  });

  it('appends the compaction marker without truncating the event log', async () => {
    const store = createTestStore();
    const { provider } = bloatProvider(6);
    const result = await new TurnLoop(
      { provider, model: 'test-model', tools: [bloatTool(30_000)], cwd: tmpDir, settings: tightSettings(), maxTurns: 20 },
      store,
    ).run('research everything');

    const persisted = store.loadEvents(result.sessionId);
    // Compaction shrinks what the MODEL carries, not what was recorded. Every
    // original tool result must still be on disk.
    expect(persisted.filter(e => e.type === 'tool-result').length).toBeGreaterThan(0);
    expect(persisted.some(e => e.type === 'compaction')).toBe(true);
    expect(persisted[0]?.type).toBe('session-start');
    expect(persisted.some(e => e.type === 'user-prompt')).toBe(true);
  });

  it('hard-aborts only after exhausting its compaction attempts', async () => {
    const store = createTestStore();
    // The summarizer itself returns something enormous, so compacting never helps.
    const { provider } = bloatProvider(20, 'S'.repeat(200_000));
    const result = await new TurnLoop(
      { provider, model: 'test-model', tools: [bloatTool(30_000)], cwd: tmpDir, settings: tightSettings(), maxTurns: 30 },
      store,
    ).run('research everything');

    expect(result.reason).toBe('error');
    const err = result.events.find(e => e.type === 'error') as Extract<Event, { type: 'error' }> | undefined;
    expect(err?.message).toMatch(/exceed the usable context/);
    expect(err?.message).toMatch(/after 3 compaction/);
  });

  it('does not compact when auto-compaction is disabled, and stays silent', async () => {
    const store = createTestStore();
    const { provider } = bloatProvider(6);
    const result = await new TurnLoop(
      {
        provider, model: 'test-model', tools: [bloatTool(30_000)], cwd: tmpDir, maxTurns: 20,
        settings: tightSettings({ auto_compact: { enabled: 'off', threshold: 75, warn_threshold: 60, forced_threshold: 85 } }),
      },
      store,
    ).run('research everything');

    expect(result.events.some(e => e.type === 'compaction')).toBe(false);
    // Disabling must silence advisories too, not just forced compaction.
    expect(result.events.some(e => e.type === 'context-warning')).toBe(false);
  });

  it('emits each context advisory at most once per run', async () => {
    const store = createTestStore();
    const { provider } = bloatProvider(8);
    const result = await new TurnLoop(
      {
        provider, model: 'test-model', tools: [bloatTool(2_000)], cwd: tmpDir, maxTurns: 20,
        settings: tightSettings({ auto_compact: { enabled: 'on', threshold: 60, warn_threshold: 20, forced_threshold: 99 } }),
      },
      store,
    ).run('go');

    const warnings = result.events.filter(e => e.type === 'context-warning');
    const distinct = new Set(warnings.map(w => (w as Extract<Event, { type: 'context-warning' }>).message));
    expect(warnings.length).toBe(distinct.size);
    expect(warnings.length).toBeLessThanOrEqual(2);
  });

  it('emits a context-report with a per-component breakdown before each request', async () => {
    const store = createTestStore();
    const { provider } = bloatProvider(1);
    const result = await new TurnLoop(
      { provider, model: 'test-model', tools: [bloatTool(1_000)], cwd: tmpDir, settings: tightSettings(), maxTurns: 5 },
      store,
    ).run('go');

    const report = result.events.find(e => e.type === 'context-report') as Extract<Event, { type: 'context-report' }>;
    expect(report).toBeDefined();
    expect(report.windowTokens).toBe(20_000);
    expect(report.reservedOutput).toBe(2_000);
    expect(report.breakdown.map(b => b.label)).toEqual(
      ['System prompt', 'Tool definitions', 'Conversation', 'Tool results'],
    );
    // Tool schemas are counted — the old estimator omitted them entirely.
    expect(report.breakdown.find(b => b.label === 'Tool definitions')!.tokens).toBeGreaterThan(0);
  });

  it('keeps per-turn reports off disk while persisting the compaction marker', async () => {
    const store = createTestStore();
    const { provider } = bloatProvider(6);
    const result = await new TurnLoop(
      { provider, model: 'test-model', tools: [bloatTool(30_000)], cwd: tmpDir, settings: tightSettings(), maxTurns: 20 },
      store,
    ).run('research everything');

    // context-report fires before every provider call — persisting it would add
    // one JSONL line per turn of pure telemetry. The marker drives replay, so it must persist.
    expect(result.events.some(e => e.type === 'context-report')).toBe(true);
    const persisted = store.loadEvents(result.sessionId);
    expect(persisted.some(e => e.type === 'context-report')).toBe(false);
    expect(persisted.some(e => e.type === 'compaction')).toBe(true);
  });
});

describe('compaction replay', () => {
  it('replays only post-marker events, seeded by the summary', () => {
    const loop = inertLoop(createTestStore());
    const events: Event[] = [
      { type: 'user-prompt', id: 'u1', text: 'ancient history', cwd: '/tmp', timestamp: 1000 },
      { type: 'assistant-delta', id: 'a1', text: 'old reply', timestamp: 1001 },
      { type: 'compaction', id: 'c1', summary: 'THE SUMMARY', summarizedMessageCount: 2, tokensBefore: 900, tokensAfter: 100, timestamp: 2000 },
      { type: 'user-prompt', id: 'u2', text: 'recent question', cwd: '/tmp', timestamp: 3000 },
      { type: 'assistant-delta', id: 'a2', text: 'recent reply', timestamp: 3001 },
    ];

    const messages = (loop as unknown as { reconstructMessages(e: Event[]): Array<{ role: string; content: unknown }> })
      .reconstructMessages(events);

    expect(messages).toHaveLength(3);
    expect(String(messages[0]!.content)).toContain('THE SUMMARY');
    expect(JSON.stringify(messages)).not.toContain('ancient history');
    expect(JSON.stringify(messages)).not.toContain('old reply');
    expect(messages[1]!.content).toBe(withMessageTimestamp('recent question', 3000));
  });

  it('replays assistant events that follow a mid-run marker with no intervening user prompt', () => {
    const loop = inertLoop(createTestStore());
    const events: Event[] = [
      { type: 'compaction', id: 'c1', summary: 'S', summarizedMessageCount: 1, tokensBefore: 9, tokensAfter: 1, timestamp: 2000 },
      { type: 'assistant-delta', id: 'a1', text: 'continuing', timestamp: 2001 },
    ];

    const messages = (loop as unknown as { reconstructMessages(e: Event[]): Array<{ role: string; content: unknown }> })
      .reconstructMessages(events);

    expect(messages).toHaveLength(2);
    expect(messages[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'continuing' }] });
  });

  it('reconstructs byte-identically across repeated resumes', () => {
    const loop = inertLoop(createTestStore());
    const events: Event[] = [
      { type: 'compaction', id: 'c1', summary: 'S', summarizedMessageCount: 1, tokensBefore: 9, tokensAfter: 1, timestamp: 2000 },
      { type: 'user-prompt', id: 'u2', text: 'next', cwd: '/tmp', timestamp: 3000 },
    ];

    const rm = (loop as unknown as { reconstructMessages(e: Event[]): unknown }).reconstructMessages.bind(loop);
    // Byte equality is what keeps the provider's cached prefix valid on resume.
    expect(JSON.stringify(rm(events))).toBe(JSON.stringify(rm(events)));
  });

  it('uses the last marker when several exist', () => {
    const loop = inertLoop(createTestStore());
    const events: Event[] = [
      { type: 'compaction', id: 'c1', summary: 'FIRST', summarizedMessageCount: 1, tokensBefore: 9, tokensAfter: 1, timestamp: 1000 },
      { type: 'user-prompt', id: 'u1', text: 'middle', cwd: '/tmp', timestamp: 1500 },
      { type: 'compaction', id: 'c2', summary: 'SECOND', summarizedMessageCount: 1, tokensBefore: 9, tokensAfter: 1, timestamp: 2000 },
      { type: 'user-prompt', id: 'u2', text: 'latest', cwd: '/tmp', timestamp: 3000 },
    ];

    const messages = (loop as unknown as { reconstructMessages(e: Event[]): Array<{ content: unknown }> })
      .reconstructMessages(events);

    expect(messages).toHaveLength(2);
    expect(String(messages[0]!.content)).toContain('SECOND');
    expect(String(messages[0]!.content)).not.toContain('FIRST');
  });
});

describe('run-scoped tool limits', () => {
  it('stops a runaway tool loop that per-turn limits cannot bound', async () => {
    const store = createTestStore();
    let turn = 0;
    const provider: ProviderStream = {
      name: 'test',
      stream: () => {
        const i = turn++;
        return {
          // One tool call per turn, forever — never trips the per-turn cap.
          iterable: (async function* () {
            yield { type: 'tool-call', id: `call_${String(i)}`, name: 'Bash', input: {} } as ProviderEvent;
            yield { type: 'stop', reason: 'stop' } as ProviderEvent;
          })(),
          cancel() { /* noop */ },
        };
      },
      check: async () => 'APPROVE',
    };

    const result = await new TurnLoop(
      {
        provider, model: 'test-model', cwd: tmpDir, maxTurns: 30,
        tools: [{
          definition: { name: 'Bash', description: 'run', inputSchema: { type: 'object', properties: {} } },
          execute: async () => ({ output: 'ok' }),
        }],
        settings: {
          current_provider: 'test',
          providers: { test: { model_context_window: 1_000_000, max_output_tokens: 8_000 } },
          tools_per_call: 10,
          tools_per_run: 5,
        } as never,
      },
      store,
    ).run('loop forever');

    const executed = result.events.filter(e => e.type === 'tool-result' && !(e as Extract<Event, { type: 'tool-result' }>).error);
    expect(executed.length).toBe(5);
    expect(result.events.some(e => e.type === 'status' && /5 for this run/.test((e as Extract<Event, { type: 'status' }>).message))).toBe(true);
  });

  it('caps web searches per run independently of other tools', async () => {
    const store = createTestStore();
    let turn = 0;
    const provider: ProviderStream = {
      name: 'test',
      stream: () => {
        const i = turn++;
        return {
          iterable: (async function* () {
            yield { type: 'tool-call', id: `call_${String(i)}`, name: 'WebFetch', input: {} } as ProviderEvent;
            yield { type: 'stop', reason: 'stop' } as ProviderEvent;
          })(),
          cancel() { /* noop */ },
        };
      },
      check: async () => 'APPROVE',
    };

    const result = await new TurnLoop(
      {
        provider, model: 'test-model', cwd: tmpDir, maxTurns: 20, tools: [bloatTool(10)],
        settings: {
          current_provider: 'test',
          providers: { test: { model_context_window: 1_000_000, max_output_tokens: 8_000 } },
          tools_per_call: 10, websearch_per_call: 10, tools_per_run: 100, websearch_per_run: 3,
        } as never,
      },
      store,
    ).run('search everything');

    const executed = result.events.filter(e => e.type === 'tool-result' && !(e as Extract<Event, { type: 'tool-result' }>).error);
    expect(executed.length).toBe(3);
  });
});
