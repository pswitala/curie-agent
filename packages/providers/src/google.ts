import { GoogleGenerativeAI } from '@google/generative-ai';
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

/** Returns true if the model may return thought_signature fields on function call parts. */
function isThinkingModelName(model: string): boolean {
  const m = model.toLowerCase();
  return m.startsWith('gemini-2.5') || m.startsWith('gemini-3') || m.includes('flash-latest') || m.includes('pro-latest');
}

export class GoogleGeminiProvider implements Provider {
  readonly name = 'google';
  readonly models = [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash-lite',
    'gemini-2.0-flash',
  ];
  readonly defaultModel = 'gemini-2.0-flash';

  private genAI: GoogleGenerativeAI;
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
    this.genAI = new GoogleGenerativeAI(resolvedKey);
    this.baseUrl = baseUrl || '';
  }

  private isThinkingModel(model?: string): boolean {
    return isThinkingModelName(model || this.defaultModel);
  }

  private baseModelParams(): Record<string, unknown> {
    const params: Record<string, unknown> = { model: this.defaultModel };
    if (this.baseUrl) {
      params['baseUrl'] = this.baseUrl;
    }
    return params;
  }

   private getModel(model?: string, tools?: unknown): ReturnType<typeof this.genAI.getGenerativeModel> {
    const m = model || this.defaultModel;
    const params: Record<string, unknown> = { ...this.baseModelParams(), model: m };
    if (this.isThinkingModel(m)) {
      params['enable_thoughts'] = false;
    }
    if (tools && (tools as unknown[]).length > 0) {
      params['tools'] = [{ functionDeclarations: tools }];
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.genAI.getGenerativeModel(params as any);
  }

 stream(args: ProviderStreamArgs): CancelableIterable<ProviderEvent> {
    const model = args.model || this.defaultModel;
    const tools = args.tools ? this.toFunctionDeclarations(args.tools) : undefined;
    const genModel = this.getModel(model, tools);

    const contents = this.mapMessages(args.messages);
    const requestTools = args.tools ? [{ functionDeclarations: this.toFunctionDeclarations(args.tools) }] : undefined;

    async function* generator(): AsyncIterable<ProviderEvent> {
      const streamResult = await genModel.generateContentStream({
        contents,
        systemInstruction: args.system,
        ...(requestTools ? { tools: requestTools as never } : {}),
      });

      // Collect raw chunk parts as they stream in to preserve thoughtSignature,
      // which the SDK's aggregated response object drops from its typed interface.
      const rawParts: Array<Record<string, unknown>> = [];

      for await (const chunk of streamResult.stream) {
        if (args.signal?.aborted) {
          break;
        }

        const text = chunk.text();
        if (text) {
          yield { type: 'text-delta', text };
        }

        // Capture raw parts from each chunk before the SDK strips unknown fields
        const chunkParts = chunk.candidates?.[0]?.content?.parts ?? [];
        for (const part of chunkParts) {
          rawParts.push(part as unknown as Record<string, unknown>);
        }
      }

      if (args.signal?.aborted) {
        yield { type: 'stop', reason: 'aborted' };
        return;
      }

      try {
        // Prefer raw parts collected during streaming (preserves thoughtSignature).
        // Fall back to aggregated response parts if streaming collected nothing.
        const response = await streamResult.response;
        const aggParts = response.candidates?.[0]?.content?.parts ?? [];
        const parts = rawParts.length > 0 ? rawParts : (aggParts as unknown as Record<string, unknown>[]);

        for (const p of parts) {
          if (p.functionCall && typeof p.functionCall === 'object') {
            const fc = p.functionCall as { name: string; args?: Record<string, unknown> };
            const sig = (typeof p.thoughtSignature === 'string' ? p.thoughtSignature : undefined)
                     ?? (typeof p.thought_signature === 'string' ? p.thought_signature : undefined);
            yield {
              type: 'tool-call',
              id: nextCallId(),
              name: fc.name,
              input: (fc.args ?? {}) as Record<string, unknown>,
              ...(sig ? { thoughtSignature: sig } : {}),
            };
          }
        }
      } catch {
        // Response may throw if prompt was blocked
      }

      yield { type: 'stop', reason: 'stop' };
    }

    return {
      iterable: generator(),
      cancel() {
        // The Google Gemini SDK doesn't expose a public cancel method.
        // The signal.aborted check inside the generator loop breaks on the
        // next iteration, but there's no way to synchronously abort.
      },
    };
  }

  async check(prompt: string, args?: {
    model?: string;
    system?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const model = args?.model || this.defaultModel;
    const genModel = this.getModel(model);

    const response = await genModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: args?.system,
    });

    return response.response.text().trim().slice(0, 256);
  }

  async complete(args: ProviderCompleteArgs): Promise<ProviderCompleteResult> {
    const model = args.model || this.defaultModel;
    const tools = args.tools ? this.toFunctionDeclarations(args.tools) : undefined;
    const genModel = this.getModel(model, tools);

    let contents = this.mapMessages(args.messages);
    const allText: string[] = [];
    let stopReason: ProviderCompleteResult['stopReason'] = 'stop';
    let toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> | undefined;

    for (let turn = 0; turn < 16; turn++) {
      const requestTools = args.tools ? [{ functionDeclarations: this.toFunctionDeclarations(args.tools) }] : undefined;

      const response = await genModel.generateContent({
        contents,
        systemInstruction: args.system,
        ...(requestTools ? { tools: requestTools as never } : {}),
      });

      const text = response.response.text().trim();
      if (text) allText.push(text);

      // Use raw parts to preserve thought_signature for thinking models.
      const rawParts = response.response.candidates?.[0]?.content?.parts ?? [];
      const fcParts = rawParts.filter((p) => (p as unknown as Record<string, unknown>).functionCall);
      if (fcParts.length === 0) {
        stopReason = 'stop';
        break;
      }

      toolCalls = fcParts.map((p) => {
        const fc = (p as unknown as Record<string, unknown>).functionCall as { name: string; args?: Record<string, unknown> };
        return { id: nextCallId(), name: fc.name, input: (fc.args ?? {}) as Record<string, unknown> };
      });
      stopReason = 'tool_use';

      // Build follow-up content echoing thoughtSignature back for thinking models.
      // thoughtSignature is a top-level Part field (camelCase in JS SDK).
      contents.push({
        role: 'model',
        parts: fcParts.map((p) => {
          const raw = p as unknown as Record<string, unknown>;
          const fc = raw.functionCall as Record<string, unknown>;
          const sig = (typeof raw.thoughtSignature === 'string' ? raw.thoughtSignature : undefined)
                   ?? (typeof raw.thought_signature === 'string' ? raw.thought_signature : undefined);
          const part: Record<string, unknown> = { functionCall: { name: fc.name, args: fc.args } };
          if (sig) part.thoughtSignature = sig;
          return part;
        }),
      } as never);

      for (const p of fcParts) {
        const fc = (p as unknown as Record<string, unknown>).functionCall as { name: string; args?: Record<string, unknown> };
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: fc.name,
              response: { result: fc.args },
            },
          }],
        } as never);
      }
    }

    return {
      text: allText.join('\n'),
      stopReason,
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
   * Google's API is strict: it does NOT support the "required" array in
   * function declaration parameters. Required fields are communicated via
   * description text instead.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private toFunctionSchema(schema: unknown): any {
    if (typeof schema !== 'object' || schema === null) {
      return { type: 'object', properties: {} };
    }

    const s = schema as Record<string, unknown>;
    const type = typeof s.type === 'string' ? s.type : 'object';

    if (type === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const properties: Record<string, any> = {};
      if (s.properties && typeof s.properties === 'object') {
        for (const [key, val] of Object.entries(s.properties as Record<string, unknown>)) {
          properties[key] = this.toFunctionSchema(val);
        }
      }
      // Google Gemini API does NOT accept "required" in parameters schema.
      // Omit it; the model will still infer importance from descriptions.
      return { type: 'object', properties };
    }

    // For non-object types, return a simple schema
    // Google requires "items" for array types
    if (type === 'array') {
      const itemsSchema = s.items ? this.toFunctionSchema(s.items) : { type: 'string' };
      return { type: 'array', items: itemsSchema };
    }
    return { type, properties: {} };
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
              name: m.content,
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
                name: c.tool_use_id,
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
