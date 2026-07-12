import type {
  Provider,
  ProviderEvent,
  ProviderStreamArgs,
  ProviderCompleteArgs,
  ProviderCompleteResult,
  ProviderMessage,
  MessageContent,
  ToolDefinition,
} from './provider.js';

type CancelableIterable<T> = { iterable: AsyncIterable<T>; cancel(): void };

let _callId = 0;
function nextCallId(): string {
  return `call_${++_callId}`;
}

/** Returns true if the model may return thought fields on parts. */
function isThinkingModelName(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith('gemini-2.5') || m.startsWith('gemini-3') || m.includes('flash-latest') || m.includes('pro-latest');
}

/**
 * Map curie effort level to Gemini thinkingBudget.
 * Without an explicit budget, Gemini often allocates 0 tokens for tool-call
 * turns — resulting in no thought parts and no thinking-delta events.
 * -1 means dynamic (model always allocates some thinking tokens).
 */
function effortToThinkingBudget(effort?: string): number {
  switch (effort) {
    case 'low':    return 1024;
    case 'medium': return 4096;
    case 'high':   return 16000;
    case 'max':    return 24576;
    default:       return -1;
  }
}

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const DEFAULT_API_VERSION = 'v1beta';

type ApiCandidate = { content: { parts: unknown[] } };
type ApiChunk = { candidates?: ApiCandidate[] };

export class GoogleGeminiProvider implements Provider {
  readonly name = 'google';
  readonly models = [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
  ];
  readonly defaultModel = 'gemini-2.0-flash';

  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    const resolvedKey = (apiKey && apiKey.length > 0)
      ? apiKey
      : process.env.GOOGLE_API_KEY;
    if (!resolvedKey) {
      throw new Error(
        'GoogleGeminiProvider: no API key (pass explicitly or set GOOGLE_API_KEY).',
      );
    }
    this.apiKey = resolvedKey;
    this.baseUrl = baseUrl || DEFAULT_BASE_URL;
  }

  private isThinkingModel(model?: string): boolean {
    return isThinkingModelName(model || this.defaultModel);
  }

  private apiEndpoint(model: string, task: string, altSse?: boolean): string {
    const safeModel = model.startsWith('models/') ? model : `models/${model}`;
    let url = `${this.baseUrl}/${DEFAULT_API_VERSION}/${safeModel}:${task}`;
    if (altSse) {
      url += '?alt=sse';
    }
    return url;
  }

  /** Build the API request body, including thinkingConfig for thinking models. */
  private buildRequestBody(
    model: string,
    contents: unknown[],
    opts?: {
      system?: string;
      tools?: unknown[];
      thinking?: boolean;
      effort?: string;
    },
  ): Record<string, unknown> {
    const safeModel = model.startsWith('models/') ? model : `models/${model}`;
    const body: Record<string, unknown> = { model: safeModel, contents };
    if (opts?.system) {
      body.systemInstruction = { role: 'system', parts: [{ text: opts.system }] };
    }
    if (opts?.tools && opts.tools.length) body.tools = opts.tools;
    const generationConfig: Record<string, unknown> = {};
    if (opts?.thinking) {
      generationConfig.thinkingConfig = {
        includeThoughts: true,
        thinkingBudget: effortToThinkingBudget(opts.effort),
      };
    }
    if (Object.keys(generationConfig).length) {
      body.generationConfig = generationConfig;
    }
    return body;
  }

  /** Parse the SSE stream response line by line into complete JSON chunks. */
  private async* parseSSEStream(response: Response): AsyncGenerator<Record<string, unknown>> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let dataLines: string[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIdx: number;
      while ((nlIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nlIdx).replace(/\r$/, '');
        buffer = buffer.slice(nlIdx + 1);

        if (line.startsWith('data: ')) {
          dataLines.push(line.slice(6));
        } else if (line.startsWith('event:')) {
          // `event: default` lines are Gemini's event boundaries — yield
          // accumulated data before moving to the next event.
          if (dataLines.length > 0) {
            for (const dl of dataLines) {
              const trimmed = dl.trim();
              if (!trimmed) continue;
              try {
                yield JSON.parse(trimmed) as Record<string, unknown>;
              } catch { /* skip malformed */ }
            }
            dataLines = [];
          }
        } else if (line === '') {
          if (dataLines.length > 0) {
            for (const dl of dataLines) {
              const trimmed = dl.trim();
              if (!trimmed) continue;
              try {
                yield JSON.parse(trimmed) as Record<string, unknown>;
              } catch { /* skip malformed */ }
            }
            dataLines = [];
          }
        }
        // ignore comment lines (':'), id:, retry: — skip them
      }
    }

    if (dataLines.length > 0) {
      for (const dl of dataLines) {
        const trimmed = dl.trim();
        if (!trimmed) continue;
        try {
          yield JSON.parse(trimmed) as Record<string, unknown>;
        } catch { /* empty */ }
      }
    }
  }

 stream(args: ProviderStreamArgs): CancelableIterable<ProviderEvent> {
    const model = args.model || this.defaultModel;
    const thinking = this.isThinkingModel(model);
    const tools = args.tools ? this.toFunctionDeclarations(args.tools) : undefined;

    const contents = this.mapMessages(args.messages);
    const requestBody = this.buildRequestBody(model, contents, {
      system: args.system,
      tools: tools ? [{ functionDeclarations: tools }] : undefined,
      thinking,
      effort: args.effort,
    });

    const controller = new AbortController();
    if (args.signal) {
      args.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    async function* generator(): AsyncIterable<ProviderEvent> {
      const url = self.apiEndpoint(model, 'streamGenerateContent', true);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': self.apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Google API error ${response.status} (${url}): ${errText}`);
      }

     const rawParts: Array<Record<string, unknown>> = [];
      let accumulatedThinking = '';
      let totalInputTokens = 0;
      let totalOutputTokens = 0;

      for await (const chunk of self.parseSSEStream(response)) {
        if (args.signal?.aborted || controller.signal.aborted) {
          break;
        }

        const apiChunk = chunk as unknown as ApiChunk;
        const chunkParts = apiChunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of chunkParts) {
          const raw = part as unknown as Record<string, unknown>;

          if (raw.thought === true && typeof raw.text === 'string' && raw.text) {
            accumulatedThinking += raw.text;
            yield { type: 'thinking-delta', text: raw.text };
          } else if (typeof raw.text === 'string' && raw.text) {
            yield { type: 'text-delta', text: raw.text };
          }

          rawParts.push(raw);
        }

        const usage = (chunk as Record<string, unknown>).usageMetadata as Record<string, unknown> | undefined;
        if (usage) {
          totalInputTokens = Number(usage.promptTokenCount ?? totalInputTokens);
          totalOutputTokens = Number(usage.candidatesTokenCount ?? totalOutputTokens);
        }
      }

      if (accumulatedThinking) {
        yield { type: 'thinking-block', thinking: accumulatedThinking, signature: '' };
      }

      if (args.signal?.aborted || controller.signal.aborted) {
        yield { type: 'stop', reason: 'aborted' };
        return;
      }

      let thoughtSignature = '';
      for (const p of rawParts) {
        if (p.functionCall && typeof p.functionCall === 'object') {
          // Extract thoughtSignature from function call part (Gemini API quirk)
          if (!thoughtSignature) {
            thoughtSignature = (typeof p.thoughtSignature === 'string' ? p.thoughtSignature : undefined)
                     ?? (typeof p.thought_signature === 'string' ? p.thought_signature : undefined)
                     ?? '';
          }
          const fc = p.functionCall as { name: string; args?: Record<string, unknown> };
          yield {
            type: 'tool-call',
            id: nextCallId(),
            name: fc.name,
            input: (fc.args ?? {}) as Record<string, unknown>,
            ...(thoughtSignature ? { thoughtSignature: thoughtSignature } : {}),
          };
        }
      }

      if (totalInputTokens || totalOutputTokens) {
        yield { type: 'usage', inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
      }

      yield { type: 'stop', reason: 'stop' };
    }

    return {
      iterable: generator(),
      cancel() {
        controller.abort();
      },
    };
  }

  async check(prompt: string, args?: {
    model?: string;
    system?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const model = args?.model || this.defaultModel;
    const requestBody = this.buildRequestBody(model, [{ role: 'user', parts: [{ text: prompt }] }], {
      system: args?.system,
    });

    const response = await fetch(this.apiEndpoint(model, 'generateContent'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: args?.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google API error ${response.status}: ${errText}`);
    }

    const json = await response.json() as unknown as ApiChunk;
    const parts = (json.candidates?.[0]?.content?.parts ?? []) as Record<string, unknown>[];
    const text = parts.map((p) => p.text).filter(Boolean).join('');
    return text.trim().slice(0, 256);
  }

  async complete(args: ProviderCompleteArgs): Promise<ProviderCompleteResult> {
    const model = args.model || this.defaultModel;
    const thinking = this.isThinkingModel(model);
    const contents = this.mapMessages(args.messages);
    const tools = args.tools ? this.toFunctionDeclarations(args.tools) : undefined;
    const requestBody = this.buildRequestBody(model, contents, {
      system: args.system,
      tools: tools ? [{ functionDeclarations: tools }] : undefined,
      thinking,
      effort: args.effort,
    });

    const response = await fetch(this.apiEndpoint(model, 'generateContent'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(requestBody),
      signal: args.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Google API error ${response.status}: ${errText}`);
    }

    const json = await response.json() as unknown as ApiChunk;
    const rawParts = (json.candidates?.[0]?.content?.parts ?? []) as Record<string, unknown>[];

    // Collect text (non-thought) parts
    const allText: string[] = [];
    for (const part of rawParts) {
      if (part.thought !== true && typeof part.text === 'string' && part.text) {
        allText.push(part.text);
      }
    }

    // Like the other providers, return tool calls to the caller instead of
    // looping — the caller is responsible for executing tools.
    const fcParts = rawParts.filter((p) => p.functionCall);
    const toolCalls = fcParts.length > 0
      ? fcParts.map((p) => {
          const fc = p.functionCall as { name: string; args?: Record<string, unknown> };
          return { id: nextCallId(), name: fc.name, input: (fc.args ?? {}) as Record<string, unknown> };
        })
      : undefined;

    return {
      text: allText.join('\n'),
      stopReason: toolCalls ? 'tool_use' : 'stop',
      toolCalls,
    };
  }

  private toFunctionDeclarations(tools: ToolDefinition[]): Array<{ name: string; description: string; parameters: unknown }> {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: this.toFunctionSchema(t.inputSchema),
    }));
  }

  /**
   * Convert a JSON Schema object to Google's FunctionDeclarationSchema format.
   * Gemini accepts an OpenAPI-style Schema subset, so copy only the fields it
   * documents (type, description, enum, items, properties, required) and drop
   * everything else ($schema, additionalProperties, $defs, ...) that the API
   * may reject.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toFunctionSchema(schema: unknown): any {
    if (typeof schema !== 'object' || schema === null) {
      return { type: 'object', properties: {} };
    }

    const s = schema as Record<string, unknown>;
    const type = typeof s.type === 'string' ? s.type : 'object';
    const description = typeof s.description === 'string' ? s.description : undefined;

    if (type === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const properties: Record<string, any> = {};
      if (s.properties && typeof s.properties === 'object') {
        for (const [key, val] of Object.entries(s.properties as Record<string, unknown>)) {
          properties[key] = this.toFunctionSchema(val);
        }
      }
      const required = Array.isArray(s.required)
        ? s.required.filter((r): r is string => typeof r === 'string')
        : [];
      return {
        type: 'object',
        properties,
        ...(description ? { description } : {}),
        ...(required.length > 0 ? { required } : {}),
      };
    }

    // Google requires "items" for array types
    if (type === 'array') {
      const itemsSchema = s.items ? this.toFunctionSchema(s.items) : { type: 'string' };
      return { type: 'array', items: itemsSchema, ...(description ? { description } : {}) };
    }

    const enumValues = Array.isArray(s.enum) ? s.enum : undefined;
    return {
      type,
      ...(description ? { description } : {}),
      ...(enumValues ? { enum: enumValues } : {}),
    };
  }

  private mapMessages(messages: ProviderMessage[]): Array<{
    role: string;
    parts: Array<{ text: string } | { functionCall: { name: string; args: object } } | { functionResponse: { name: string; response: Record<string, unknown> } }>;
  }> {
    return messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'user',
          parts: [{
            functionResponse: {
              name: m.toolName ?? 'tool',
              response: { output: m.content },
            },
          }],
        };
      }

      if (typeof m.content === 'string') {
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        };
      }

      if (Array.isArray(m.content)) {
        const parts: Array<{ text: string } | { functionCall: { name: string; args: object } } | { functionResponse: { name: string; response: Record<string, unknown> } }> = [];

        for (const c of m.content) {
          if (c.type === 'text') {
            parts.push({ text: c.text });
          } else if (c.type === 'thinking') {
            // Thinking blocks from turn loop are sent as regular text (Gemini
            // uses accumulated text approach; thinking blocks are internal).
            const tc = c as { thinking: string };
            if (tc.thinking) {
              parts.push({ text: tc.thinking });
            }
          } else if (c.type === 'tool-use') {
            // thoughtSignature is a top-level Part field (camelCase in JS SDK)
            const fcPart: Record<string, unknown> = {
              functionCall: { name: c.name, args: c.input as object },
              ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}),
            };
            parts.push(fcPart as never);
          } else if (c.type === 'tool-result') {
            parts.push({
              functionResponse: {
                name: c.name ?? c.tool_use_id,
                response: { output: c.content },
              },
            });
          } else if (c.type === 'image') {
            parts.push({ text: `[image: ${c.source.media_type}]` });
          } else {
            parts.push({ text: JSON.stringify(c) });
          }
        }

        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts,
        };
      }

      return {
        role: 'user',
        parts: [{ text: JSON.stringify(m.content) }],
      };
    });
  }
}
