import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OpenAI from 'openai';

const mockCreate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function (this: any) {
    this.chat = { completions: { create: mockCreate } };
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OpenRouterProvider } = await import('./openrouter.js');

const MockOpenAI = vi.mocked(OpenAI) as unknown as ReturnType<typeof vi.fn>;

function makeAsyncIterableStream(chunks: unknown[]) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }),
      };
    },
  };
}

async function collectStream(provider: any, args: any) {
  const { iterable } = provider.stream(args);
  const events: any[] = [];
  for await (const ev of iterable) events.push(ev);
  return events;
}

describe('OpenRouterProvider', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    MockOpenAI.mockClear();
    process.env.OPENROUTER_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  describe('metadata', () => {
    it('has correct name', () => {
      expect(new OpenRouterProvider('key').name).toBe('openrouter');
    });

    it('has correct default model', () => {
      expect(new OpenRouterProvider('key').defaultModel).toBe('anthropic/claude-sonnet-4-6');
    });
  });

  describe('sticky session + cache_control', () => {
    it('includes session_id in the stream() request when sessionId is provided', async () => {
      mockCreate.mockResolvedValue(makeAsyncIterableStream([]));
      const p = new OpenRouterProvider('key');
      await collectStream(p, { messages: [{ role: 'user', content: 'hi' }], sessionId: 'abc123' });
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'abc123' }));
    });

    it('omits session_id from the stream() request when not provided', async () => {
      mockCreate.mockResolvedValue(makeAsyncIterableStream([]));
      const p = new OpenRouterProvider('key');
      await collectStream(p, { messages: [{ role: 'user', content: 'hi' }] });
      const callArgs = mockCreate.mock.calls[0]?.[0];
      expect(callArgs.session_id).toBeUndefined();
    });

    it('always includes cache_control on the stream() request, regardless of model', async () => {
      mockCreate.mockResolvedValue(makeAsyncIterableStream([]));
      const p = new OpenRouterProvider('key');
      await collectStream(p, { messages: [{ role: 'user', content: 'hi' }], model: 'openai/gpt-4o' });
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ cache_control: { type: 'ephemeral' } }));
    });

    it('includes session_id and cache_control on the complete() request', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      });
      const p = new OpenRouterProvider('key');
      await p.complete({ messages: [{ role: 'user', content: 'hi' }], sessionId: 'xyz789' });
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        session_id: 'xyz789',
        cache_control: { type: 'ephemeral' },
      }));
    });

    it('parses cacheReadTokens/cacheWriteTokens from prompt_tokens_details on complete()', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 5 },
        },
      });
      const p = new OpenRouterProvider('key');
      const result = await p.complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.usage?.inputTokens).toBe(100);
      expect(result.usage?.outputTokens).toBe(20);
      expect(result.usage?.cacheReadTokens).toBe(80);
      expect(result.usage?.cacheWriteTokens).toBe(5);
    });

    it('parses cacheReadTokens/cacheWriteTokens from prompt_tokens_details on the usage event', async () => {
      mockCreate.mockResolvedValue(makeAsyncIterableStream([
        {
          choices: [{ delta: {} }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 5 },
          },
        },
      ]));
      const p = new OpenRouterProvider('key');
      const events = await collectStream(p, { messages: [{ role: 'user', content: 'hi' }] });
      const usageEvent = events.find((e) => e.type === 'usage');
      expect(usageEvent.inputTokens).toBe(100);
      expect(usageEvent.outputTokens).toBe(20);
      expect(usageEvent.cacheReadTokens).toBe(80);
      expect(usageEvent.cacheWriteTokens).toBe(5);
    });
  });
});
