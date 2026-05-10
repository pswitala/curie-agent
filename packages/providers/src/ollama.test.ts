import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import OpenAI from 'openai';

vi.mock('openai', () => ({
  default: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { OllamaProvider } = await import('./ollama.js');

const MockOpenAI = vi.mocked(OpenAI) as unknown as ReturnType<typeof vi.fn>;

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MODEL_API_KEY;
  });

  afterEach(() => {
    delete process.env.MODEL_API_KEY;
  });

  describe('constructor', () => {
    it('uses default API key when none provided', () => {
      new OllamaProvider();
      const lastCall = MockOpenAI.mock.calls[MockOpenAI.mock.calls.length - 1];
      expect(lastCall?.[0]?.apiKey).toBe('sk-not-needed');
    });

    it('uses provided API key', () => {
      new OllamaProvider('my-key');
      const lastCall = MockOpenAI.mock.calls[MockOpenAI.mock.calls.length - 1];
      expect(lastCall?.[0]?.apiKey).toBe('my-key');
    });

    it('uses default Ollama URL', () => {
      new OllamaProvider();
      const lastCall = MockOpenAI.mock.calls[MockOpenAI.mock.calls.length - 1];
      expect(lastCall?.[0]?.baseURL).toBe('http://localhost:11434/v1');
    });

    it('accepts custom baseUrl', () => {
      new OllamaProvider('key', 'http://localhost:8080/v1');
      const lastCall = MockOpenAI.mock.calls[MockOpenAI.mock.calls.length - 1];
      expect(lastCall?.[0]?.baseURL).toBe('http://localhost:8080/v1');
    });

    it('prefers explicit key over env var', () => {
      process.env.MODEL_API_KEY = 'env-key';
      new OllamaProvider('explicit');
      const lastCall = MockOpenAI.mock.calls[MockOpenAI.mock.calls.length - 1];
      expect(lastCall?.[0]?.apiKey).toBe('explicit');
    });
  });

  describe('metadata', () => {
    it('has correct name', () => {
      expect(new OllamaProvider().name).toBe('ollama');
    });

    it('has fallback models list', () => {
      const p = new OllamaProvider();
      expect(p.models).toContain('llama3.3');
      expect(p.models).toContain('mistral');
      expect(p.models).toContain('phi3');
    });

    it('has custom as default model', () => {
      expect(new OllamaProvider().defaultModel).toBe('custom');
    });
  });

  describe('stream method exists', () => {
    it('stream is a method on the prototype', () => {
      expect(typeof (OllamaProvider.prototype as unknown as Record<string, unknown>).stream).toBe('function');
    });
  });
});
