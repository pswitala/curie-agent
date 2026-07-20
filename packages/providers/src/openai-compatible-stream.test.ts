import { describe, it, expect } from 'vitest';
import type OpenAI from 'openai';
import { streamOpenAICompatible } from './openai-compatible-stream.js';
import type { ProviderEvent } from './provider.js';

type Chunk = OpenAI.ChatCompletionChunk;

function makeChunk(content?: string, toolCalls?: NonNullable<NonNullable<Chunk['choices'][0]['delta']>['tool_calls']>, usage?: Chunk['usage']): Chunk {
  return {
    id: 'chunk',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [
      {
        index: 0,
        delta: {
          ...(content !== undefined ? { content } : {}),
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: null,
      },
    ],
    ...(usage ? { usage } : {}),
  } as Chunk;
}

function makeClient(chunks: Chunk[]): OpenAI {
  const iterable = {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
  return {
    chat: {
      completions: {
        create: async () => iterable,
      },
    },
  } as unknown as OpenAI;
}

async function collect(iter: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

describe('streamOpenAICompatible', () => {
  it('emits text deltas straight through when no thinking tags are present', async () => {
    const client = makeClient([makeChunk('hello '), makeChunk('world')]);
    const events = await collect(streamOpenAICompatible(client, {} as OpenAI.ChatCompletionCreateParams));
    expect(events.filter((e) => e.type === 'text-delta')).toEqual([
      { type: 'text-delta', text: 'hello ' },
      { type: 'text-delta', text: 'world' },
    ]);
    expect(events[events.length - 1]).toEqual({ type: 'stop', reason: 'stop' });
  });

  it('routes <think>...</think> content into thinking-delta and flushes thinking-block at end', async () => {
    const client = makeClient([
      makeChunk('intro <think>step '),
      makeChunk('one'),
      makeChunk(' step two</think> done'),
    ]);
    const events = await collect(streamOpenAICompatible(client, {} as OpenAI.ChatCompletionCreateParams));

    const thinkingDeltas = events.filter((e) => e.type === 'thinking-delta').map((e) => (e as { text: string }).text);
    expect(thinkingDeltas.join('')).toBe('step one step two');

    const thinkingBlock = events.find((e) => e.type === 'thinking-block');
    expect(thinkingBlock).toEqual({ type: 'thinking-block', thinking: 'step one step two', signature: '' });

    const textDeltas = events.filter((e) => e.type === 'text-delta').map((e) => (e as { text: string }).text);
    expect(textDeltas.join('')).toBe('intro  done');
  });

  it('routes gemma4 <|channel>thought\\n...<channel|> blocks into thinking events', async () => {
    const client = makeClient([
      makeChunk('<|channel>thought\nstep one\n'),
      makeChunk('step two\n'),
      makeChunk('<channel|>The answer is 42.'),
    ]);
    const events = await collect(streamOpenAICompatible(client, {} as OpenAI.ChatCompletionCreateParams));

    const thinking = events.filter((e) => e.type === 'thinking-delta').map((e) => (e as { text: string }).text).join('');
    expect(thinking).toBe('step one\nstep two\n');

    const block = events.find((e) => e.type === 'thinking-block');
    expect(block).toEqual({ type: 'thinking-block', thinking: 'step one\nstep two\n', signature: '' });

    const text = events.filter((e) => e.type === 'text-delta').map((e) => (e as { text: string }).text).join('');
    expect(text).toBe('The answer is 42.');
  });

  it('handles <think> and </think> in the same chunk', async () => {
    const client = makeClient([makeChunk('a<think>b</think>c')]);
    const events = await collect(streamOpenAICompatible(client, {} as OpenAI.ChatCompletionCreateParams));
    expect(events.filter((e) => e.type === 'text-delta').map((e) => (e as { text: string }).text).join('')).toBe('ac');
    expect(events.filter((e) => e.type === 'thinking-delta').map((e) => (e as { text: string }).text).join('')).toBe('b');
  });

  it('buffers tool calls and emits them as a single batch after the stream', async () => {
    const client = makeClient([
      makeChunk('thinking about it '),
      makeChunk(undefined, [
        { index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"' } },
      ]),
      makeChunk(undefined, [
        { index: 0, function: { arguments: 'a.txt"}' } } as never,
      ]),
      makeChunk(undefined, [
        { index: 1, id: 'call_2', type: 'function', function: { name: 'list', arguments: '{}' } },
      ]),
      makeChunk(' continuing'),
    ]);
    const events = await collect(streamOpenAICompatible(client, {} as OpenAI.ChatCompletionCreateParams));

    const toolCalls = events.filter((e) => e.type === 'tool-call');
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]).toEqual({ type: 'tool-call', id: 'call_1', name: 'read_file', input: { path: 'a.txt' } });
    expect(toolCalls[1]).toEqual({ type: 'tool-call', id: 'call_2', name: 'list', input: {} });

    // No text-delta should appear AFTER any tool-call (tool calls come at the end).
    const lastTextIdx = events.findLastIndex((e) => e.type === 'text-delta');
    const firstToolIdx = events.findIndex((e) => e.type === 'tool-call');
    expect(lastTextIdx).toBeLessThan(firstToolIdx);
  });

  it('emits usage when stream provides it and ends with stop', async () => {
    const client = makeClient([makeChunk('hi', undefined, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })]);
    const events = await collect(streamOpenAICompatible(client, {} as OpenAI.ChatCompletionCreateParams));
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toEqual({ type: 'usage', inputTokens: 10, outputTokens: 5 });
    expect(events[events.length - 1]).toEqual({ type: 'stop', reason: 'stop' });
  });

  it('surfaces cached_tokens from prompt_tokens_details as cacheReadTokens', async () => {
    const client = makeClient([makeChunk('hi', undefined, {
      prompt_tokens: 100,
      completion_tokens: 5,
      total_tokens: 105,
      prompt_tokens_details: { cached_tokens: 80 },
    } as Chunk['usage'])]);
    const events = await collect(streamOpenAICompatible(client, {} as OpenAI.ChatCompletionCreateParams));
    const usage = events.find((e) => e.type === 'usage') as { cacheReadTokens?: number };
    expect(usage.cacheReadTokens).toBe(80);
  });

  it('leaves cacheReadTokens undefined when the provider reports no cache stats', async () => {
    const client = makeClient([makeChunk('hi', undefined, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })]);
    const events = await collect(streamOpenAICompatible(client, {} as OpenAI.ChatCompletionCreateParams));
    const usage = events.find((e) => e.type === 'usage') as { cacheReadTokens?: number };
    expect(usage.cacheReadTokens).toBeUndefined();
  });

  it('suppresses thinking-delta and thinking-block when suppressThinking is true', async () => {
    const client = makeClient([makeChunk('hello <think>this is reasoning</think> world')]);
    const events = await collect(
      streamOpenAICompatible(client, {} as OpenAI.ChatCompletionCreateParams, undefined, { suppressThinking: true }),
    );
    expect(events.filter((e) => e.type === 'thinking-delta')).toHaveLength(0);
    expect(events.filter((e) => e.type === 'thinking-block')).toHaveLength(0);
    const text = events.filter((e) => e.type === 'text-delta').map((e) => (e as { text: string }).text).join('');
    expect(text).toBe('hello  world');
  });

  it('reports stop reason "aborted" when signal aborts before iteration begins', async () => {
    const client = makeClient([makeChunk('hi')]);
    const ctrl = new AbortController();
    ctrl.abort();
    const events = await collect(streamOpenAICompatible(client, {} as OpenAI.ChatCompletionCreateParams, ctrl.signal));
    expect(events[events.length - 1]).toEqual({ type: 'stop', reason: 'aborted' });
  });

  it('yields stop event with error reason when SDK throws during iteration', async () => {
    let yieldCount = 0;
    const throwingIterable = {
      async *[Symbol.asyncIterator]() {
        yield makeChunk('first ');
        yieldCount++;
        yield makeChunk('second ');
        yieldCount++;
        throw new Error('SSE parse error: malformed chunk');
      },
    };
    const client = {
      chat: {
        completions: {
          create: async () => throwingIterable,
        },
      },
    } as unknown as OpenAI;

    const events = await collect(streamOpenAICompatible(client, {} as OpenAI.ChatCompletionCreateParams));
    // Should have yielded text deltas before the error, then a stop event
    const textDeltas = events.filter((e) => e.type === 'text-delta');
    expect(textDeltas).toHaveLength(2);
    const stopEvent = events[events.length - 1];
    expect(stopEvent.type).toBe('stop');
    expect(stopEvent.reason).toBe('error');
    expect(stopEvent.errorDetail).toContain('SSE parse error');
  });

 it('respects timeout and yields aborted stop when server is slow', async () => {
    // Mock that simulates a hanging SSE stream: waits in the generator,
    // checks abort signal, throws when aborted (like real SDK does).
    const hangingClient = {
      chat: {
        completions: {
          create: async () => {
            let _abortSignal: AbortSignal | null = null;
            return (async function* () {
              // We can't access the internal abortCtrl from here, so we simulate
              // by waiting a long time. The for-await loop in streamOpenAICompatible
              // checks abortCtrl.signal.aborted at the top of each iteration.
              // When timeout fires, the next loop check will break.
              // To make the test actually finish, we yield after a short delay
              // and let the loop detect the abort.
              await new Promise((resolve) => setTimeout(resolve, 100));
              if (_abortSignal?.aborted) return;
              yield makeChunk('partial');
            })();
          },
        },
      },
    } as unknown as OpenAI;

    const events = await collect(
      streamOpenAICompatible(hangingClient, {} as OpenAI.ChatCompletionCreateParams, undefined, { timeoutMs: 50 }),
    );
    // After 50ms timeout, the loop breaks on next iteration check.
    // The mock yields after 100ms, but by then the abort fired at 50ms.
    // The generator yields 'partial' then the loop checks aborted and breaks.
    const stopEvent = events[events.length - 1];
    expect(stopEvent.type).toBe('stop');
    expect(stopEvent.reason).toBe('aborted');
  });
});
