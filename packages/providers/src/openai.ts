import OpenAI from 'openai';
import type {
  Provider,
  ProviderEvent,
  ProviderStreamArgs,
  ProviderCompleteArgs,
  ProviderCompleteResult,
  ProviderMessage,
  MessageContent,
  ReasoningEffort,
  ToolDefinition,
} from './provider.js';

type CancelableIterable<T> = { iterable: AsyncIterable<T>; cancel(): void };

function effortToReasoning(effort?: ReasoningEffort): OpenAI.ChatCompletionCreateParams['reasoning_effort'] | undefined {
  switch (effort) {
    case 'low':    return 'low';
    case 'medium': return 'medium';
    case 'high':   return 'high';
    case 'max':    return 'high';
    case 'auto':
    default:       return undefined;
  }
}

const REASONING_MODEL_RE = /^(o1|o3)[-:]?(mini|medium|high|pro)?$/i;

function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_RE.test(model);
}

export class OpenAIProvider implements Provider {
  readonly name = 'openai';
  readonly models = [
    'gpt-4o',
    'gpt-4o-2024-11-20',
    'gpt-4o-mini',
    'gpt-4o-mini-2024-07-18',
    'o1',
    'o1-mini',
    'o1-preview',
    'o3-mini',
    'o3-mini-2025-01-31',
    'gpt-4-turbo',
  ];
  readonly defaultModel = 'gpt-4o';

  private client: OpenAI;

  constructor(apiKey?: string, baseUrl?: string) {
    const resolvedKey = (apiKey && apiKey.length > 0)
      ? apiKey
      : process.env.OPENAI_API_KEY;
    if (!resolvedKey) {
      throw new Error(
        'OpenAIProvider: no API key (pass explicitly or set OPENAI_API_KEY).',
      );
    }
    this.client = new OpenAI({
      apiKey: resolvedKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
  }

 stream(args: ProviderStreamArgs): CancelableIterable<ProviderEvent> {
    const self = this;
    const model = args.model || this.defaultModel;
    const modelIsReasoning = isReasoningModel(model);
    const reasoningEffort = effortToReasoning(args.effort);

    const maxTokens = modelIsReasoning
      ? args.maxTokens ?? 16_384
      : args.maxTokens;

    const messages = this.mapMessages(args.messages);
    const tools = args.tools ? this.mapTools(args.tools) : undefined;

    const allMessages: OpenAI.ChatCompletionMessageParam[] = args.system
      ? [{ role: 'system', content: args.system }, ...messages]
      : messages;

    const streamParams: OpenAI.ChatCompletionCreateParams = {
      model,
      messages: allMessages,
      stream: true,
      ...(tools ? { tools } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
      ...(modelIsReasoning && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      stream_options: { include_usage: true },
    };

    let sdkStream: AsyncIterable<OpenAI.ChatCompletionChunk> | null = null;

    async function* generator(): AsyncIterable<ProviderEvent> {
      sdkStream = await self.client.chat.completions.create(streamParams) as AsyncIterable<OpenAI.ChatCompletionChunk>;

      const pendingTools = new Map<number, { id: string; name: string; inputStr: string }>();
      let lastUsage: OpenAI.CompletionUsage | null = null;

      if (!sdkStream) return;
      for await (const chunk of sdkStream) {
        if (args.signal?.aborted) {
          break;
        }

        if (chunk.usage) {
          lastUsage = chunk.usage;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        // Text deltas
        if (choice.delta?.content) {
          yield { type: 'text-delta', text: choice.delta.content };
        }

        // Tool call deltas
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

      // Resolve any pending tool calls
      for (const [, pending] of pendingTools) {
        let input: Record<string, unknown> = {};
        try {
          if (pending.inputStr) {
            input = JSON.parse(pending.inputStr);
          }
        } catch { /* empty input on parse failure */ }
        yield { type: 'tool-call', id: pending.id, name: pending.name, input };
      }

      // Emit usage
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
        // The OpenAI Node.js SDK doesn't expose a public cancel method on the
        // async iterable. The signal.aborted check inside the generator loop
        // will break on the next iteration, but there's no way to
        // synchronously abort the underlying HTTP request.
        // The abort signal is still passed through streamParams, so the SDK
        // may honor it internally.
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
    const modelIsReasoning = isReasoningModel(model);
    const reasoningEffort = effortToReasoning(args.effort);

    const maxTokens = modelIsReasoning
      ? args.maxTokens ?? 16_384
      : args.maxTokens;

    const messages = this.mapMessages(args.messages);
    const tools = args.tools ? this.mapTools(args.tools) : undefined;

    const allMessages: OpenAI.ChatCompletionMessageParam[] = args.system
      ? [{ role: 'system', content: args.system }, ...messages]
      : messages;

    const response = await this.client.chat.completions.create({
      model,
      messages: allMessages,
      stream: false,
      ...(tools ? { tools } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
      ...(modelIsReasoning && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
 stream_options: { include_usage: true },
    });

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
