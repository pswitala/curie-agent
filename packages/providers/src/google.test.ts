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

  describe('buildRequestBody - thinkingConfig', () => {
    const p = new GoogleGeminiProvider('key');
    const buildRequestBody = (p as any).buildRequestBody.bind(p);

    it('sets thinkingBudget to -1 (dynamic) when effort is auto/undefined', () => {
      const body = buildRequestBody('gemini-2.5-flash', [], { thinking: true, effort: 'auto' });
      expect((body.generationConfig as any).thinkingConfig.thinkingBudget).toBe(-1);
    });

    it('sets thinkingBudget to -1 when effort is undefined', () => {
      const body = buildRequestBody('gemini-2.5-flash', [], { thinking: true });
      expect((body.generationConfig as any).thinkingConfig.thinkingBudget).toBe(-1);
    });

    it('maps effort low to 1024', () => {
      const body = buildRequestBody('gemini-2.5-flash', [], { thinking: true, effort: 'low' });
      expect((body.generationConfig as any).thinkingConfig.thinkingBudget).toBe(1024);
    });

    it('maps effort max to 24576', () => {
      const body = buildRequestBody('gemini-2.5-flash', [], { thinking: true, effort: 'max' });
      expect((body.generationConfig as any).thinkingConfig.thinkingBudget).toBe(24576);
    });

    it('includes includeThoughts: true', () => {
      const body = buildRequestBody('gemini-2.5-flash', [], { thinking: true });
      expect((body.generationConfig as any).thinkingConfig.includeThoughts).toBe(true);
    });

    it('omits thinkingConfig for non-thinking calls', () => {
      const body = buildRequestBody('gemini-2.0-flash', [], { thinking: false });
      expect(body.generationConfig).toBeUndefined();
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

  describe('mapMessages - tool results', () => {
    const p = new GoogleGeminiProvider('key');
    const mapMessages = (p as any).mapMessages.bind(p);

    it('uses toolName for functionResponse.name', () => {
      const out = mapMessages([
        { role: 'tool', toolUseId: 'call_1', toolName: 'Write', content: '{"path":"x.txt"}' },
      ]);
      expect(out[0].parts[0].functionResponse.name).toBe('Write');
      expect(out[0].parts[0].functionResponse.response.output).toBe('{"path":"x.txt"}');
    });

    it('falls back gracefully when toolName is missing', () => {
      const out = mapMessages([{ role: 'tool', toolUseId: 'call_1', content: 'result text' }]);
      expect(out[0].parts[0].functionResponse.name).toBe('tool');
      expect(out[0].parts[0].functionResponse.response.output).toBe('result text');
    });

    it('uses the tool-result name field in content blocks when present', () => {
      const out = mapMessages([
        {
          role: 'user',
          content: [{ type: 'tool-result', tool_use_id: 'call_2', name: 'Grep', content: 'matches' }],
        },
      ]);
      expect(out[0].parts[0].functionResponse.name).toBe('Grep');
    });
  });

  describe('toFunctionSchema', () => {
    const p = new GoogleGeminiProvider('key');
    const toFunctionSchema = (p as any).toFunctionSchema.bind(p);

    const writeLikeSchema = {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'The absolute path to the file to write' },
        content: { type: 'string', description: 'The content to write to the file' },
      },
      required: ['file_path', 'content'],
      additionalProperties: false,
      $schema: 'https://json-schema.org/draft/2020-12/schema',
    };

    it('preserves the required array', () => {
      const out = toFunctionSchema(writeLikeSchema);
      expect(out.required).toEqual(['file_path', 'content']);
    });

    it('preserves per-property descriptions', () => {
      const out = toFunctionSchema(writeLikeSchema);
      expect(out.properties.file_path.description).toBe('The absolute path to the file to write');
      expect(out.properties.content.description).toBe('The content to write to the file');
    });

    it('does not attach a properties key to scalar params', () => {
      const out = toFunctionSchema(writeLikeSchema);
      expect(out.properties.file_path).not.toHaveProperty('properties');
    });

    it('preserves enum values on string params', () => {
      const out = toFunctionSchema({
        type: 'object',
        properties: { mode: { type: 'string', enum: ['plan', 'edit', 'auto'], description: 'Approval mode' } },
        required: ['mode'],
      });
      expect(out.properties.mode.enum).toEqual(['plan', 'edit', 'auto']);
      expect(out.properties.mode.description).toBe('Approval mode');
    });

    it('keeps items and description on array params', () => {
      const out = toFunctionSchema({
        type: 'object',
        properties: {
          allowed_domains: { type: 'array', items: { type: 'string' }, description: 'Only these domains' },
        },
      });
      expect(out.properties.allowed_domains.items).toEqual({ type: 'string' });
      expect(out.properties.allowed_domains.description).toBe('Only these domains');
    });

    it('strips unsupported keys like $schema and additionalProperties', () => {
      const out = toFunctionSchema(writeLikeSchema);
      expect(out).not.toHaveProperty('$schema');
      expect(out).not.toHaveProperty('additionalProperties');
    });

    it('omits required when empty or absent', () => {
      const out = toFunctionSchema({ type: 'object', properties: { q: { type: 'string' } } });
      expect(out).not.toHaveProperty('required');
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

  describe('stream - thinking-delta', () => {
    function makeFetchMock(sseText: string) {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sseText));
          controller.close();
        },
      });
      return vi.fn().mockResolvedValue(new Response(stream, { status: 200 }));
    }

    async function collectEvents(provider: any, model: string, sseText: string) {
      vi.stubGlobal('fetch', makeFetchMock(sseText));
      const { iterable } = provider.stream({ messages: [{ role: 'user', content: 'hi' }], model });
      const events: any[] = [];
      for await (const ev of iterable) events.push(ev);
      vi.unstubAllGlobals();
      return events;
    }

    it('emits thinking-delta for each thought chunk', async () => {
      const p = new GoogleGeminiProvider('key');
      const events = await collectEvents(p, 'gemini-2.5-flash',
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"Why "}]}}]}\n\n' +
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"indeed"}]}}]}\n\n',
      );
      const deltas = events.filter((e) => e.type === 'thinking-delta');
      expect(deltas).toHaveLength(2);
      expect(deltas[0].text).toBe('Why ');
      expect(deltas[1].text).toBe('indeed');
    });

    it('emits thinking-block with accumulated text at stream end', async () => {
      const p = new GoogleGeminiProvider('key');
      const events = await collectEvents(p, 'gemini-2.5-flash',
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"part1"}]}}]}\n\n' +
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"part2"}]}}]}\n\n',
      );
      const block = events.find((e) => e.type === 'thinking-block');
      expect(block).toBeDefined();
      expect(block.thinking).toBe('part1part2');
    });

    it('emits both thinking-delta and text-delta in correct order for mixed chunk', async () => {
      const p = new GoogleGeminiProvider('key');
      const events = await collectEvents(p, 'gemini-2.5-flash',
        'data: {"candidates":[{"content":{"parts":[{"thought":true,"text":"think"},{"text":"answer"}]}}]}\n\n',
      );
      const types = events.map((e) => e.type);
      expect(types).toContain('thinking-delta');
      expect(types).toContain('text-delta');
      expect(types.indexOf('thinking-delta')).toBeLessThan(types.indexOf('text-delta'));
    });

    it('emits no thinking-delta for non-thinking model', async () => {
      const p = new GoogleGeminiProvider('key');
      const events = await collectEvents(p, 'gemini-2.0-flash',
        'data: {"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}\n\n',
      );
      expect(events.some((e) => e.type === 'thinking-delta')).toBe(false);
      expect(events.some((e) => e.type === 'text-delta')).toBe(true);
    });

    it('emits no thinking-block when no thinking parts received', async () => {
      const p = new GoogleGeminiProvider('key');
      const events = await collectEvents(p, 'gemini-2.5-flash',
        'data: {"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}\n\n',
      );
      expect(events.some((e) => e.type === 'thinking-block')).toBe(false);
    });

    it('reads cachedContentTokenCount into cacheReadTokens on the usage event', async () => {
      const p = new GoogleGeminiProvider('key');
      const events = await collectEvents(p, 'gemini-2.5-flash',
        'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n' +
        'data: {"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":20,"cachedContentTokenCount":80}}\n\n',
      );
      const usage = events.find((e) => e.type === 'usage') as any;
      expect(usage.inputTokens).toBe(100);
      expect(usage.outputTokens).toBe(20);
      expect(usage.cacheReadTokens).toBe(80);
    });
  });

  describe('complete - usage', () => {
    it('parses usage including cacheReadTokens from usageMetadata', async () => {
      const p = new GoogleGeminiProvider('key');
      const body = {
        candidates: [{ content: { parts: [{ text: 'hi there' }] } }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, cachedContentTokenCount: 80 },
      };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: async () => body,
      }));
      const result = await p.complete({ messages: [{ role: 'user', content: 'hi' }] });
      vi.unstubAllGlobals();
      expect(result.usage?.inputTokens).toBe(100);
      expect(result.usage?.outputTokens).toBe(20);
      expect(result.usage?.cacheReadTokens).toBe(80);
    });
  });
});
