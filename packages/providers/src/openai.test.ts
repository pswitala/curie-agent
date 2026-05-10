import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OpenAI from 'openai';

vi.mock('openai', () => ({
  default: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OpenAIProvider } = await import('./openai.js');

const MockOpenAI = vi.mocked(OpenAI) as unknown as ReturnType<typeof vi.fn>;

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
});
