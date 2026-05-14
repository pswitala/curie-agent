import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GoogleGeminiProvider } = await import('./google.js');

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
    });

    it('uses env var when no explicit key', () => {
      new GoogleGeminiProvider();
    });

    it('prefers explicit key over env var', () => {
      process.env.GOOGLE_API_KEY = 'env-key';
      new GoogleGeminiProvider('explicit');
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

  describe('isThinkingModel', () => {
    const p = new GoogleGeminiProvider('key');
    const isThinkingModel = (p as any).isThinkingModel.bind(p);

    it('detects gemini-2.5 models', () => {
      expect(isThinkingModel('gemini-2.5-pro')).toBe(true);
      expect(isThinkingModel('gemini-2.5-flash')).toBe(true);
    });

    it('detects gemini-3 models', () => {
      expect(isThinkingModel('gemini-3-flash-preview')).toBe(true);
    });

    it('returns false for non-thinking models', () => {
      expect(isThinkingModel('gemini-2.0-flash')).toBe(false);
      expect(isThinkingModel('gemini-1.5-pro')).toBe(false);
    });
  });

  describe('apiEndpoint', () => {
    const p = new GoogleGeminiProvider('key');
    const apiEndpoint = (p as any).apiEndpoint.bind(p);

    it('builds correct URL', () => {
      expect(apiEndpoint('gemini-2.5-flash', 'generateContent')).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      );
    });

    it('adds alt=sse for streaming', () => {
      expect(apiEndpoint('gemini-2.5-flash', 'streamGenerateContent', true)).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
      );
    });

    it('preserves models/ prefix', () => {
      expect(apiEndpoint('models/gemini-2.5-flash', 'generateContent')).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      );
    });
  });

  describe('parseSSEStream', () => {
    const p = new GoogleGeminiProvider('key');
    const parseSSEStream = (p as any).parseSSEStream.bind(p);

    function makeResponse(sseText: string) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseText));
          controller.close();
        },
      });
      return new Response(stream) as Response;
    }

    it('parses single JSON object per data line', async () => {
      const response = makeResponse(
        'data: {"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}\n\n',
      );
      const results: unknown[] = [];
      for await (const chunk of parseSSEStream(response)) {
        results.push(chunk);
      }
      expect(results).toHaveLength(1);
      expect((results[0] as any).candidates?.[0]?.content?.parts?.[0]?.text).toBe('hello');
    });

    it('parses multiple JSON objects between blank lines', async () => {
      const response = makeResponse(
        'data: {"candidates":[{"content":{"parts":[{"text":"a"}]}}]}\n' +
        'data: {"candidates":[{"content":{"parts":[{"text":"b"}]}}]}\n\n',
      );
      const results: unknown[] = [];
      for await (const chunk of parseSSEStream(response)) {
        results.push(chunk);
      }
      expect(results).toHaveLength(2);
      expect((results[0] as any).candidates?.[0]?.content?.parts?.[0]?.text).toBe('a');
      expect((results[1] as any).candidates?.[0]?.content?.parts?.[0]?.text).toBe('b');
    });

    it('parses events with thought: true parts', async () => {
      const response = makeResponse(
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"thinking..."}]}}]}\n\n',
      );
      const results: unknown[] = [];
      for await (const chunk of parseSSEStream(response)) {
        results.push(chunk);
      }
      expect(results).toHaveLength(1);
      const part = (results[0] as any).candidates?.[0]?.content?.parts?.[0];
      expect(part?.thought).toBe(true);
      expect(part?.text).toBe('thinking...');
    });

    it('parses events with thought: true AND regular text in same chunk', async () => {
      const response = makeResponse(
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"Thinking..."},{"text":"Response"}]}}]}\n\n',
      );
      const results: unknown[] = [];
      for await (const chunk of parseSSEStream(response)) {
        results.push(chunk);
      }
      expect(results).toHaveLength(1);
      const parts = (results[0] as any).candidates?.[0]?.content?.parts;
      expect(parts[0]?.thought).toBe(true);
      expect(parts[0]?.text).toBe('Thinking...');
      expect(parts[1]?.text).toBe('Response');
      expect(parts[1]?.thought).toBeUndefined();
    });

    it('skips empty data lines', async () => {
      const response = makeResponse(
        'data: {"candidates":[{"content":{"parts":[{"text":"a"}]}}]}\n\n' +
        'data: \n\n' +
        'data: {"candidates":[{"content":{"parts":[{"text":"b"}]}}]}\n\n',
      );
      const results: unknown[] = [];
      for await (const chunk of parseSSEStream(response)) {
        results.push(chunk);
      }
      expect(results).toHaveLength(2);
    });

    it('yields at event: default boundaries (Gemini SSE format)', async () => {
      // Simulates real Gemini SSE: event: default + data between events, no blank lines
      const response = makeResponse(
        'event: default\ndata: {"candidates":[{"content":{"parts":[{"text":"a"}]}}]}\n\n' +
        'event: default\ndata: {"candidates":[{"content":{"parts":[{"text":"b"}]}}]}\n\n',
      );
      const results: unknown[] = [];
      for await (const chunk of parseSSEStream(response)) {
        results.push(chunk);
      }
      expect(results).toHaveLength(2);
      expect((results[0] as any).candidates?.[0]?.content?.parts?.[0]?.text).toBe('a');
      expect((results[1] as any).candidates?.[0]?.content?.parts?.[0]?.text).toBe('b');
    });

    it('yields at event: default even without blank lines between events', async () => {
      // Gemini may omit blank lines between events
      const response = makeResponse(
        'event: default\ndata: {"candidates":[{"content":{"parts":[{"thought":true,"text":"Thi"}]}}]}\n' +
        'event: default\ndata: {"candidates":[{"content":{"parts":[{"thought":true,"text":"nki"}]}}]}\n\n',
      );
      const results: unknown[] = [];
      for await (const chunk of parseSSEStream(response)) {
        results.push(chunk);
      }
      expect(results).toHaveLength(2);
      const part0 = (results[0] as any).candidates?.[0]?.content?.parts?.[0];
      const part1 = (results[1] as any).candidates?.[0]?.content?.parts?.[0];
      expect(part0?.thought).toBe(true);
      expect(part0?.text).toBe('Thi');
      expect(part1?.thought).toBe(true);
      expect(part1?.text).toBe('nki');
    });

    it('yields usage metadata events mixed with content events', async () => {
      const response = makeResponse(
        'data: {"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}\n' +
        'data: {"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5}}\n\n',
      );
      const results: unknown[] = [];
      for await (const chunk of parseSSEStream(response)) {
        results.push(chunk);
      }
      expect(results).toHaveLength(2);
      expect((results[0] as any).candidates?.[0]?.content?.parts?.[0]?.text).toBe('hello');
      expect((results[1] as any).usageMetadata?.promptTokenCount).toBe(10);
    });
  });
});
