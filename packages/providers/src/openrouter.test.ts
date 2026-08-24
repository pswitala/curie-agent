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

    // Verified against a strict upstream (DeepInfra) — these non-standard keys are
    // accepted, so they stay unconditional.
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

  describe('getModels / getModelInfo', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function stubModelsFetch(payload: unknown) {
      const fetchMock = vi.fn().mockResolvedValue({ json: async () => payload });
      vi.stubGlobal('fetch', fetchMock);
      return fetchMock;
    }

    it('requests /models on the base URL without a duplicated /api segment', async () => {
      const fetchMock = stubModelsFetch({ data: [{ id: 'anthropic/claude-sonnet-4-6' }] });
      const p = new OpenRouterProvider('key');
      await p.getModels();
      expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/models');
    });

    it('keeps context_length and converts per-token pricing to per-million', async () => {
      stubModelsFetch({
        data: [
          {
            id: 'anthropic/claude-sonnet-4-6',
            context_length: 1000000,
            pricing: { prompt: '0.000003', completion: '0.000015' },
          },
        ],
      });
      const p = new OpenRouterProvider('key');
      await p.getModels();
      const info = p.getModelInfo('anthropic/claude-sonnet-4-6');
      expect(info?.contextLength).toBe(1000000);
      expect(info?.pricePromptPerM).toBeCloseTo(3);
      expect(info?.priceCompletionPerM).toBeCloseTo(15);
    });

    it('returns undefined for an unknown model', async () => {
      stubModelsFetch({ data: [{ id: 'a/b' }] });
      const p = new OpenRouterProvider('key');
      await p.getModels();
      expect(p.getModelInfo('nope/nope')).toBeUndefined();
    });

    it('falls back to the static list when the models API fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
      const p = new OpenRouterProvider('key');
      const models = await p.getModels();
      expect(models).toContain('anthropic/claude-sonnet-4-6');
      expect(p.getModelInfo('anthropic/claude-sonnet-4-6')).toBeUndefined();
    });

    it('captures top_provider.max_completion_tokens', async () => {
      stubModelsFetch({
        data: [{ id: 'deepseek/deepseek-v4-flash-0731', top_provider: { max_completion_tokens: 32768 } }],
      });
      const p = new OpenRouterProvider('key');
      await p.getModels();
      expect(p.getModelInfo('deepseek/deepseek-v4-flash-0731')?.maxCompletionTokens).toBe(32768);
    });

    it('treats a null max_completion_tokens as unknown', async () => {
      stubModelsFetch({ data: [{ id: 'a/b', top_provider: { max_completion_tokens: null } }] });
      const p = new OpenRouterProvider('key');
      await p.getModels();
      expect(p.getModelInfo('a/b')?.maxCompletionTokens).toBeUndefined();
    });
  });

  describe('tool schemas', () => {
    it('sends function.parameters as an object even when the schema arrives as a JSON string', async () => {
      mockCreate.mockResolvedValue(makeAsyncIterableStream([]));
      const p = new OpenRouterProvider('key');
      await collectStream(p, {
        messages: [{ role: 'user', content: 'hi' }],
        // spawn_agent used to ship its schema pre-stringified; MCP servers can
        // still hand us anything. A string here is a 422 on strict upstreams.
        tools: [{
          name: 'spawn_agent',
          description: 'd',
          inputSchema: JSON.stringify({ type: 'object', properties: { prompt: { type: 'string' } } }),
        }],
      });
      const params = mockCreate.mock.calls[0]?.[0].tools[0].function.parameters;
      expect(typeof params).toBe('object');
      expect(params).toEqual({ type: 'object', properties: { prompt: { type: 'string' } } });
    });

    it('substitutes an empty object for an unparseable schema', async () => {
      mockCreate.mockResolvedValue(makeAsyncIterableStream([]));
      const p = new OpenRouterProvider('key');
      await collectStream(p, {
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 't', description: 'd', inputSchema: 'not json' }],
      });
      expect(mockCreate.mock.calls[0]?.[0].tools[0].function.parameters)
        .toEqual({ type: 'object', properties: {} });
    });
  });

  describe('provider routing', () => {
    it('sends provider.order from the legacy string[] argument', async () => {
      mockCreate.mockResolvedValue(makeAsyncIterableStream([]));
      const p = new OpenRouterProvider('key', undefined, ['deepinfra', 'novita']);
      await collectStream(p, { messages: [{ role: 'user', content: 'hi' }] });
      expect(mockCreate.mock.calls[0]?.[0].provider).toEqual({ order: ['deepinfra', 'novita'] });
    });

    it('sends allow_fallbacks and require_parameters when configured', async () => {
      mockCreate.mockResolvedValue(makeAsyncIterableStream([]));
      const p = new OpenRouterProvider('key', undefined, {
        order: ['deepinfra'],
        allowFallbacks: false,
        requireParameters: true,
      });
      await collectStream(p, { messages: [{ role: 'user', content: 'hi' }] });
      expect(mockCreate.mock.calls[0]?.[0].provider).toEqual({
        order: ['deepinfra'],
        allow_fallbacks: false,
        require_parameters: true,
      });
    });

    it('omits the provider block entirely when nothing is configured', async () => {
      mockCreate.mockResolvedValue(makeAsyncIterableStream([]));
      const p = new OpenRouterProvider('key');
      await collectStream(p, { messages: [{ role: 'user', content: 'hi' }] });
      expect(mockCreate.mock.calls[0]?.[0].provider).toBeUndefined();
    });

    it('applies routing to check() too, so harm-checks are not free-routed', async () => {
      mockCreate.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
      const p = new OpenRouterProvider('key', undefined, { order: ['novita'], allowFallbacks: false });
      await p.check('safe?');
      expect(mockCreate.mock.calls[0]?.[0].provider)
        .toEqual({ order: ['novita'], allow_fallbacks: false });
    });
  });

  describe('max_tokens clamping', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    it('clamps the requested cap to the model max_completion_tokens', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: async () => ({ data: [{ id: 'deepseek/v4', top_provider: { max_completion_tokens: 32768 } }] }),
      }));
      const p = new OpenRouterProvider('key');
      await p.getModels();
      mockCreate.mockResolvedValue(makeAsyncIterableStream([]));
      await collectStream(p, { messages: [{ role: 'user', content: 'hi' }], model: 'deepseek/v4', maxTokens: 131072 });
      expect(mockCreate.mock.calls[0]?.[0].max_tokens).toBe(32768);
    });

    it('passes the requested cap through when the model cap is unknown', async () => {
      mockCreate.mockResolvedValue(makeAsyncIterableStream([]));
      const p = new OpenRouterProvider('key');
      await collectStream(p, { messages: [{ role: 'user', content: 'hi' }], model: 'unknown/model', maxTokens: 4096 });
      expect(mockCreate.mock.calls[0]?.[0].max_tokens).toBe(4096);
    });
  });

  describe('reasoning effort', () => {
    it("omits reasoning for effort 'auto'", async () => {
      mockCreate.mockResolvedValue(makeAsyncIterableStream([]));
      const p = new OpenRouterProvider('key');
      await collectStream(p, { messages: [{ role: 'user', content: 'hi' }], effort: 'auto' });
      expect(mockCreate.mock.calls[0]?.[0].reasoning).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('yields a stop/error event carrying the status and upstream 422 body', async () => {
      const err = Object.assign(new Error('Provider returned error'), {
        status: 422,
        error: {
          message: 'Provider returned error',
          metadata: { provider_name: 'DeepInfra', raw: '{"detail":"max_tokens too large"}' },
        },
      });
      mockCreate.mockRejectedValue(err);
      const p = new OpenRouterProvider('key');
      const events = await collectStream(p, { messages: [{ role: 'user', content: 'hi' }] });
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('stop');
      expect(events[0].reason).toBe('error');
      expect(events[0].errorDetail).toContain('HTTP 422');
      expect(events[0].errorDetail).toContain('DeepInfra');
      expect(events[0].errorDetail).toContain('max_tokens too large');
    });

    it('reports a mid-stream failure as stop/error instead of throwing', async () => {
      mockCreate.mockResolvedValue({
        [Symbol.asyncIterator]() {
          return { next: async () => { throw Object.assign(new Error('boom'), { status: 500 }); } };
        },
      });
      const p = new OpenRouterProvider('key');
      const events = await collectStream(p, { messages: [{ role: 'user', content: 'hi' }] });
      expect(events.at(-1)).toMatchObject({ type: 'stop', reason: 'error' });
      expect(events.at(-1).errorDetail).toContain('HTTP 500');
    });
  });
});
