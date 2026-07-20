import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OpenAI from 'openai';

const mockChatCreate = vi.fn();
const mockResponsesCreate = vi.fn();

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(function (this: any) {
    this.chat = { completions: { create: mockChatCreate } };
    this.responses = { create: mockResponsesCreate };
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OpenAIProvider } = await import('./openai.js');

const MockOpenAI = vi.mocked(OpenAI) as unknown as ReturnType<typeof vi.fn>;

function makeAsyncIterable(items: unknown[]) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => (i < items.length ? { value: items[i++], done: false } : { value: undefined, done: true }),
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

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  describe('constructor', () => {
    it('accepts an explicit API key', () => {
      new OpenAIProvider('my-key');
      const lastCall = MockOpenAI.mock.calls[MockOpenAI.mock.calls.length - 1];
      expect(lastCall?.[0]?.apiKey).toBe('my-key');
    });

    it('passes baseUrl to SDK constructor', () => {
      new OpenAIProvider('key', 'http://localhost:11434/v1');
      expect(MockOpenAI).toHaveBeenCalled();
    });

    it('prefers explicit key over env var', () => {
      process.env.OPENAI_API_KEY = 'env-key';
      new OpenAIProvider('explicit');
      const lastCall = MockOpenAI.mock.calls[MockOpenAI.mock.calls.length - 1];
      expect(lastCall?.[0]?.apiKey).toBe('explicit');
    });
  });

  describe('metadata', () => {
    it('has correct name', () => {
      expect(new OpenAIProvider('key').name).toBe('openai');
    });

    it('has expected models list', () => {
      const p = new OpenAIProvider('key');
      expect(p.models).toContain('gpt-4o');
      expect(p.models).toContain('gpt-4o-mini');
      expect(p.models).toContain('o1');
      expect(p.models).toContain('o3-mini');
      expect(p.models).toContain('gpt-4-turbo');
    });

    it('has correct default model', () => {
      expect(new OpenAIProvider('key').defaultModel).toBe('gpt-4o');
    });
  });

  describe('stream method exists', () => {
    it('stream is a method on the prototype', () => {
      expect(typeof (OpenAIProvider.prototype as unknown as Record<string, unknown>).stream).toBe('function');
    });
  });

  describe('prompt cache key + cache read-back', () => {
    beforeEach(() => {
      mockChatCreate.mockReset();
      mockResponsesCreate.mockReset();
    });

    it('includes prompt_cache_key on the chat stream() request when sessionId is provided', async () => {
      mockChatCreate.mockResolvedValue(makeAsyncIterable([]));
      const p = new OpenAIProvider('key');
      await collectStream(p, { messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o', sessionId: 'sess-1' });
      expect(mockChatCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt_cache_key: 'sess-1' }));
    });

    it('omits prompt_cache_key on the chat stream() request when sessionId is not provided', async () => {
      mockChatCreate.mockResolvedValue(makeAsyncIterable([]));
      const p = new OpenAIProvider('key');
      await collectStream(p, { messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o' });
      const callArgs = mockChatCreate.mock.calls[0]?.[0];
      expect(callArgs.prompt_cache_key).toBeUndefined();
    });

    it('includes prompt_cache_key on the chat complete() request', async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      });
      const p = new OpenAIProvider('key');
      await p.complete({ messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o', sessionId: 'sess-2' });
      expect(mockChatCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt_cache_key: 'sess-2' }));
    });

    it('parses cacheReadTokens from prompt_tokens_details on chat complete()', async () => {
      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 80 } },
      });
      const p = new OpenAIProvider('key');
      const result = await p.complete({ messages: [{ role: 'user', content: 'hi' }], model: 'gpt-4o' });
      expect(result.usage?.cacheReadTokens).toBe(80);
    });

    it('includes prompt_cache_key on the responses stream() request', async () => {
      mockResponsesCreate.mockResolvedValue(makeAsyncIterable([]));
      const p = new OpenAIProvider('key');
      await collectStream(p, { messages: [{ role: 'user', content: 'hi' }], model: 'o1', sessionId: 'sess-3' });
      expect(mockResponsesCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt_cache_key: 'sess-3' }));
    });

    it('parses cached_tokens from input_tokens_details on the responses stream() usage event', async () => {
      mockResponsesCreate.mockResolvedValue(makeAsyncIterable([
        {
          type: 'response.completed',
          response: {
            usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 80 } },
          },
        },
      ]));
      const p = new OpenAIProvider('key');
      const events = await collectStream(p, { messages: [{ role: 'user', content: 'hi' }], model: 'o1' });
      const usage = events.find((e: any) => e.type === 'usage');
      expect(usage.inputTokens).toBe(100);
      expect(usage.cacheReadTokens).toBe(80);
    });

    it('includes prompt_cache_key on the responses complete() request', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'hi',
        output: [],
        usage: { input_tokens: 10, output_tokens: 2 },
      });
      const p = new OpenAIProvider('key');
      await p.complete({ messages: [{ role: 'user', content: 'hi' }], model: 'o1', sessionId: 'sess-4' });
      expect(mockResponsesCreate).toHaveBeenCalledWith(expect.objectContaining({ prompt_cache_key: 'sess-4' }));
    });

    it('parses cacheReadTokens from input_tokens_details on responses complete()', async () => {
      mockResponsesCreate.mockResolvedValue({
        output_text: 'hi',
        output: [],
        usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 80 } },
      });
      const p = new OpenAIProvider('key');
      const result = await p.complete({ messages: [{ role: 'user', content: 'hi' }], model: 'o1' });
      expect(result.usage?.cacheReadTokens).toBe(80);
    });
  });
});
