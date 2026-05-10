import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleGenerativeAI } from '@google/generative-ai';

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GoogleGeminiProvider } = await import('./google.js');

const MockGoogleGenerativeAI = vi.mocked(GoogleGenerativeAI) as unknown as ReturnType<typeof vi.fn>;

describe('GoogleGeminiProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.GOOGLE_API_KEY;
  });

  describe('constructor', () => {
    it('accepts an explicit API key', () => {
      new GoogleGeminiProvider('my-key');
      const lastCall = MockGoogleGenerativeAI.mock.calls[MockGoogleGenerativeAI.mock.calls.length - 1];
      expect(lastCall?.[0]).toBe('my-key');
    });

    it('uses env var when no explicit key', () => {
      new GoogleGeminiProvider();
      const lastCall = MockGoogleGenerativeAI.mock.calls[MockGoogleGenerativeAI.mock.calls.length - 1];
      expect(lastCall?.[0]).toBe('test-key');
    });

    it('prefers explicit key over env var', () => {
      process.env.GOOGLE_API_KEY = 'env-key';
      new GoogleGeminiProvider('explicit');
      const lastCall = MockGoogleGenerativeAI.mock.calls[MockGoogleGenerativeAI.mock.calls.length - 1];
      expect(lastCall?.[0]).toBe('explicit');
    });

    it('throws when no API key available', () => {
      delete process.env.GOOGLE_API_KEY;
      expect(() => new GoogleGeminiProvider()).toThrow('no API key');
    });
  });

  describe('metadata', () => {
    it('has correct name', () => {
      expect(new GoogleGeminiProvider('key').name).toBe('google');
    });

    it('has expected models list', () => {
      const p = new GoogleGeminiProvider('key');
      expect(p.models).toContain('gemini-2.5-pro');
      expect(p.models).toContain('gemini-2.5-flash');
      expect(p.models).toContain('gemini-2.0-flash-lite');
      expect(p.models).toContain('gemini-2.0-flash');
    });

    it('has correct default model', () => {
      expect(new GoogleGeminiProvider('key').defaultModel).toBe('gemini-2.0-flash');
    });
  });

  describe('stream method exists', () => {
    it('stream is a method on the prototype', () => {
      expect(typeof (GoogleGeminiProvider.prototype as unknown as Record<string, unknown>).stream).toBe('function');
    });
  });
});
