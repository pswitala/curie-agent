import OpenAI from 'openai';
import type {
  Provider,
  ProviderEvent,
  ProviderStreamArgs,
  ProviderCompleteArgs,
  ProviderCompleteResult,
  ProviderMessage,
  ReasoningEffort,
  ToolDefinition,
} from './provider.js';

type CancelableIterable<T> = { iterable: AsyncIterable<T>; cancel(): void };

function effortToReasoning(effort?: ReasoningEffort) {
  switch (effort) {
    case 'low':    return { effort: 'low' };
    case 'medium': return { effort: 'medium' };
    case 'high':   return { effort: 'high' };
    case 'max':    return { effort: 'xhigh' };
    case 'auto':
    default:       return undefined;
  }
}

const FALLBACK_MODELS = [
  'anthropic/claude-opus-4-7',
  'anthropic/claude-sonnet-4-6',
  'anthropic/claude-3-7-sonnet',
  'anthropic/claude-haiku-4-5-20251001',
  'openai/gpt-4o',
  'openai/gpt-4o-mini',
  'openai/o3-mini',
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'google/gemini-2.0-flash',
  'meta/llama-3.3-70b',
  'mistral/mistral-large',
  'deepseek/deepseek-r1',
  'qwen/qwen-2.5-72b',
];

export class OpenRouterProvider implements Provider {
  readonly name = 'openrouter';
  readonly models: string[];
  readonly defaultModel = 'anthropic/claude-sonnet-4-6';

  private client: OpenAI;
  private _baseUrl: string;
  private _allModels: string[] | null = null;

  constructor(apiKey?: string, baseUrl?: string) {
    const resolvedKey = (apiKey && apiKey.length > 0)
      ? apiKey
      : process.env.OPENROUTER_API_KEY;
    if (!resolvedKey) {
      throw new Error(
        'OpenRouterProvider: no API key (pass explicitly or set OPENROUTER_API_KEY).',
      );
    }
    this._baseUrl = baseUrl || 'https://openrouter.ai/api/v1';
    this.client = new OpenAI({
      apiKey: resolvedKey,
      baseURL: this._baseUrl,
      defaultHeaders: {
        'HTTP-Referer': 'https://curie-agent.dev',
        'X-Title': 'curie-agent',
      },
    });
    this.models = [...FALLBACK_MODELS];
  }

  private async _fetchModels(): Promise<string[]> {
    if (this._allModels) return this._allModels;
    try {
      const resp = await fetch(`${this._baseUrl}/api/models`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json() as { data?: Array<{ id: string }> };
      if (data.data?.length) {
        this._allModels = data.data.map(m => m.id).filter(Boolean);
        return this._allModels;
      }
    } catch {
      /* fallback to static list */
    }
    this._allModels = [...FALLBACK_MODELS];
    return this._allModels;
  }

  async getModels(): Promise<string[]> {
    return this._fetchModels();
  }

  stream(args: ProviderStreamArgs): CancelableIterable<ProviderEvent> {
    const self = this;
    const model = args.model || this.defaultModel;

    const messages = this.mapMessages(args.messages);
    const tools = args.tools ? this.mapTools(args.tools) : undefined;

    const allMessages: OpenAI.ChatCompletionMessageParam[] = args.system
      ? [{ role: 'system', content: args.system }, ...messages]
      : messages;

    const reasoning = effortToReasoning(args.effort);

    const streamParams: OpenAI.ChatCompletionCreateParams & { reasoning?: object } = {
      model,
      messages: allMessages,
      stream: true,
      ...(tools ? { tools } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}),
      ...(reasoning ? { reasoning } : {}),
      stream_options: { include_usage: true },
    };

    let sdkStream: AsyncIterable<OpenAI.ChatCompletionChunk> | null = null;

    async function* generator(): AsyncIterable<ProviderEvent> {
      sdkStream = await self.client.chat.completions.create(streamParams) as AsyncIterable<OpenAI.ChatCompletionChunk>;

      if (!sdkStream) return;

      const pendingTools = new Map<number, { id: string; name: string; inputStr: string }>();
      let lastUsage: OpenAI.CompletionUsage | null = null;

      for await (const chunk of sdkStream) {
        if (args.signal?.aborted) {
          break;
        }

        if (chunk.usage) {
          lastUsage = chunk.usage;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.delta?.content) {
          yield { type: 'text-delta', text: choice.delta.content };
        }

        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (tc.id) {
              pendingTools.set(idx, { id: tc.id, name: tc.function?.name ?? '', inputStr: '' });
            }
            const pending = pendingTools.get(idx);
            if (pending) {
              pending.inputStr += tc.function?.arguments ?? '';
            }
          }
        }
      }

      for (const [, pending] of pendingTools) {
        let input: Record<string, unknown> = {};
        try {
          if (pending.inputStr) {
            input = JSON.parse(pending.inputStr);
          }
        } catch { /* empty input on parse failure */ }
        yield { type: 'tool-call', id: pending.id, name: pending.name, input };
      }

      if (lastUsage) {
        yield {
          type: 'usage',
          inputTokens: lastUsage.prompt_tokens ?? 0,
          outputTokens: lastUsage.completion_tokens ?? 0,
        };
      }

      yield { type: 'stop', reason: args.signal?.aborted ? 'aborted' : 'stop' };
    }

    return {
      iterable: generator(),
      cancel() {
        // The signal.aborted check inside the generator loop will break on next iteration
      },
    };
  }

  async check(prompt: string, args?: {
    model?: string;
    system?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const model = args?.model || this.defaultModel;
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'user', content: prompt },
    ];
    if (args?.system) {
      messages.unshift({ role: 'system' as const, content: args.system });
    }
    const response = await this.client.chat.completions.create({
      model,
      messages,
      max_tokens: 256,
      temperature: 0,
    });
    return response.choices[0]?.message?.content?.trim() ?? '';
  }

  async complete(args: ProviderCompleteArgs): Promise<ProviderCompleteResult> {
    const model = args.model || this.defaultModel;

    const messages = this.mapMessages(args.messages);
    const tools = args.tools ? this.mapTools(args.tools) : undefined;

    const allMessages: OpenAI.ChatCompletionMessageParam[] = args.system
      ? [{ role: 'system', content: args.system }, ...messages]
      : messages;

    const reasoning = effortToReasoning(args.effort);
    const response = await this.client.chat.completions.create({
      model,
      messages: allMessages,
      stream: false,
      ...(tools ? { tools } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}),
      ...(reasoning ? { reasoning } : {}),
    } as any);

    const choice = response.choices[0];
    const text = choice?.message?.content ?? '';

    const toolCalls = choice?.message?.tool_calls?.map(tc => {
      let input: Record<string, unknown> = {};
      try {
        if (tc.function?.arguments) {
          input = JSON.parse(tc.function.arguments);
        }
      } catch { /* empty input on parse failure */ }
      return {
        id: tc.id ?? '',
        name: tc.function?.name ?? '',
        input,
      };
    }).filter(tc => tc.id) ?? [];

    const usage = response.usage
      ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens }
      : undefined;

    return {
      text: text.trim(),
      stopReason: (choice?.finish_reason === 'stop' || choice?.finish_reason === 'function_call')
        ? 'stop'
        : choice?.finish_reason === 'tool_calls'
        ? 'tool_use'
        : choice?.finish_reason === 'length'
        ? 'length'
        : choice?.finish_reason === 'content_filter'
        ? 'content_filter'
        : 'stop',
      usage,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private mapMessages(messages: ProviderMessage[]): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool',
          content: m.content as string,
          tool_call_id: (m as { toolUseId: string }).toolUseId,
        } as OpenAI.ChatCompletionToolMessageParam;
      }

      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content } as OpenAI.ChatCompletionMessageParam;
      }

      if (Array.isArray(m.content) && m.role === 'user') {
        const textParts = m.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map(c => c.text);
        return { role: 'user', content: textParts.join('\n') };
      }

      if (Array.isArray(m.content) && m.role === 'assistant') {
        const textParts = m.content
          .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
          .map(c => c.text);
        const toolCalls = m.content
          .filter((c): c is { type: 'tool-use'; id: string; name: string; input: Record<string, unknown> } => c.type === 'tool-use')
          .map(c => ({
            id: c.id,
            type: 'function' as const,
            function: {
              name: c.name,
              arguments: JSON.stringify(c.input),
            },
          }));

        return {
          role: 'assistant',
          content: textParts.join('\n') || null,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        } as OpenAI.ChatCompletionAssistantMessageParam;
      }

      return { role: m.role, content: JSON.stringify(m.content) };
    });
  }

  private mapTools(tools: ToolDefinition[]): OpenAI.ChatCompletionTool[] {
    return tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
      },
    }));
  }
}
