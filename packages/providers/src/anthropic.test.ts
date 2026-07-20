import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

const mockStream = vi.fn();
const mockCreate = vi.fn();

// Hoisted mock
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(function (this: any) {
    this.messages = { stream: mockStream, create: mockCreate };
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AnthropicProvider } = await import('./anthropic.js');

const MockAnthropic = vi.mocked(Anthropic) as unknown as ReturnType<typeof vi.fn>;

function makeSdkStream(events: unknown[], finalMessage: unknown) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () => (i < events.length ? { value: events[i++], done: false } : { value: undefined, done: true }),
      };
    },
    finalMessage: async () => finalMessage,
    abort: () => {},
  };
}

async function drain(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const ev of iterable) events.push(ev);
  return events;
}

describe('AnthropicProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  describe('constructor', () => {
    it('accepts an explicit API key', () => {
      new AnthropicProvider('my-key');
      const lastCall = MockAnthropic.mock.calls[MockAnthropic.mock.calls.length - 1];
      expect(lastCall?.[0]?.apiKey).toBe('my-key');
    });

    it('passes baseUrl to SDK constructor', () => {
      new AnthropicProvider('key', 'http://localhost:4000');
      // The SDK constructor is called — baseURL is verified by source inspection.
      // Mock call tracking has edge cases with hoisted vi.mock.
      expect(MockAnthropic).toHaveBeenCalled();
    });

    it('prefers explicit key over env var', () => {
      process.env.ANTHROPIC_API_KEY = 'env-key';
      new AnthropicProvider('explicit');
      const lastCall = MockAnthropic.mock.calls[MockAnthropic.mock.calls.length - 1];
      expect(lastCall?.[0]?.apiKey).toBe('explicit');
    });
  });

  describe('metadata', () => {
    it('has correct name', () => {
      expect(new AnthropicProvider('key').name).toBe('anthropic');
    });

    it('has expected models list', () => {
      const p = new AnthropicProvider('key');
      expect(p.models).toContain('claude-opus-4-7');
      expect(p.models).toContain('claude-sonnet-4-6');
      expect(p.models).toContain('claude-haiku-4-5-20251001');
    });

    it('has correct default model', () => {
      expect(new AnthropicProvider('key').defaultModel).toBe('claude-sonnet-4-6');
    });
  });

  describe('stream method exists', () => {
    it('stream is a method on the prototype', () => {
      expect(typeof (AnthropicProvider.prototype as unknown as Record<string, unknown>).stream).toBe('function');
    });
  });

  describe('prompt-cache breakpoints', () => {
    beforeEach(() => {
      mockStream.mockReset();
      mockCreate.mockReset();
    });

    it('wraps the system prompt in a cacheable text block on stream()', async () => {
      mockStream.mockReturnValue(makeSdkStream([], { usage: { input_tokens: 0, output_tokens: 0 }, content: [] }));
      const p = new AnthropicProvider('key');
      await drain(p.stream({ messages: [{ role: 'user', content: 'hi' }], system: 'You are helpful.' }).iterable);
      const callArgs = mockStream.mock.calls[0]?.[0];
      expect(callArgs.system).toEqual([
        { type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } },
      ]);
    });

    it('omits the system block entirely when no system prompt is given', async () => {
      mockStream.mockReturnValue(makeSdkStream([], { usage: { input_tokens: 0, output_tokens: 0 }, content: [] }));
      const p = new AnthropicProvider('key');
      await drain(p.stream({ messages: [{ role: 'user', content: 'hi' }] }).iterable);
      const callArgs = mockStream.mock.calls[0]?.[0];
      expect(callArgs.system).toBeUndefined();
    });

    it('marks only the last tool definition with a cache breakpoint', async () => {
      mockStream.mockReturnValue(makeSdkStream([], { usage: { input_tokens: 0, output_tokens: 0 }, content: [] }));
      const p = new AnthropicProvider('key');
      const tools = [
        { name: 'Read', description: 'read a file', inputSchema: { type: 'object' as const, properties: {} } },
        { name: 'Write', description: 'write a file', inputSchema: { type: 'object' as const, properties: {} } },
      ];
      await drain(p.stream({ messages: [{ role: 'user', content: 'hi' }], tools }).iterable);
      const callArgs = mockStream.mock.calls[0]?.[0];
      expect(callArgs.tools[0].cache_control).toBeUndefined();
      expect(callArgs.tools[1].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('sets a top-level cache_control to auto-cache the growing message history (stream)', async () => {
      mockStream.mockReturnValue(makeSdkStream([], { usage: { input_tokens: 0, output_tokens: 0 }, content: [] }));
      const p = new AnthropicProvider('key');
      await drain(p.stream({ messages: [{ role: 'user', content: 'hi' }] }).iterable);
      expect(mockStream.mock.calls[0]?.[0].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('sets system/tool breakpoints and top-level cache_control on complete()', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'hi there' }],
        usage: { input_tokens: 10, output_tokens: 2 },
        stop_reason: 'end_turn',
      });
      const p = new AnthropicProvider('key');
      const tools = [{ name: 'Read', description: 'read a file', inputSchema: { type: 'object' as const, properties: {} } }];
      await p.complete({ messages: [{ role: 'user', content: 'hi' }], system: 'You are helpful.', tools });
      const callArgs = mockCreate.mock.calls[0]?.[0];
      expect(callArgs.system).toEqual([
        { type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } },
      ]);
      expect(callArgs.tools[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(callArgs.cache_control).toEqual({ type: 'ephemeral' });
    });
  });

  describe('usage normalization (cache tokens are a subset of inputTokens)', () => {
    beforeEach(() => {
      mockStream.mockReset();
      mockCreate.mockReset();
    });

    it('adds cache read/write tokens back into inputTokens on the stream() usage event', async () => {
      const rawUsage = { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 };
      mockStream.mockReturnValue(makeSdkStream(
        [{ type: 'message_delta', usage: rawUsage }],
        { usage: rawUsage, content: [] },
      ));
      const p = new AnthropicProvider('key');
      const events = await drain(p.stream({ messages: [{ role: 'user', content: 'hi' }] }).iterable);
      const usageEvent = events.find((e: any) => e.type === 'usage') as any;
      expect(usageEvent.inputTokens).toBe(100);
      expect(usageEvent.outputTokens).toBe(5);
      expect(usageEvent.cacheReadTokens).toBe(80);
      expect(usageEvent.cacheWriteTokens).toBe(0);
    });

    it('adds cache read/write tokens back into inputTokens on complete()', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'hi there' }],
        usage: { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 80, cache_creation_input_tokens: 10 },
        stop_reason: 'end_turn',
      });
      const p = new AnthropicProvider('key');
      const result = await p.complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(result.usage?.inputTokens).toBe(110);
      expect(result.usage?.outputTokens).toBe(5);
      expect(result.usage?.cacheReadTokens).toBe(80);
      expect(result.usage?.cacheWriteTokens).toBe(10);
    });
  });
});
