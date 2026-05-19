import OpenAI from 'openai';
import type {
  Provider,
  ProviderEvent,
  ProviderStreamArgs,
  ProviderCompleteArgs,
  ProviderCompleteResult,
  ProviderMessage,
  ToolDefinition,
} from './provider.js';
import { streamOpenAICompatible } from './openai-compatible-stream.js';

type CancelableIterable<T> = { iterable: AsyncIterable<T>; cancel(): void };

const FALLBACK_MODELS = [
  'llama3.3',
  'mistral',
  'phi3',
  'qwen2.5',
  'deepseek-r1',
  'llama3.1',
  'llama3',
  'codellama',
  'gemma2',
  'mixtral',
];

export class OllamaProvider implements Provider {
  readonly name = 'ollama';
  readonly models: string[];
  readonly defaultModel = 'custom';

  private client: OpenAI;
  private _baseUrl: string;
  private _allModels: string[] | null = null;

  constructor(apiKey?: string, baseUrl?: string) {
    const resolvedKey = (apiKey && apiKey.length > 0)
      ? apiKey
      : process.env.MODEL_API_KEY;
    this._baseUrl = baseUrl || 'http://localhost:11434/v1';
    this.client = new OpenAI({
      apiKey: resolvedKey || 'sk-not-needed',
      baseURL: this._baseUrl,
    });
    this.models = [...FALLBACK_MODELS];
  }

  private async _fetchModels(): Promise<string[]> {
    if (this._allModels) return this._allModels;
    try {
      const baseUrl = this._baseUrl.replace(/\/v1(\/)?$/, '');
      const resp = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      const data = await resp.json() as { models?: Array<{ name: string }> };
      if (data.models?.length) {
        this._allModels = data.models.map(m => m.name);
        return this._allModels;
      }
    } catch {
      /* fallback to static list */
    }
    this._allModels = [...FALLBACK_MODELS];
    return this._allModels;
  }

  stream(args: ProviderStreamArgs): CancelableIterable<ProviderEvent> {
    const model = args.model || this.defaultModel;

    const messages = this.mapMessages(args.messages);
    const tools = args.tools ? this.mapTools(args.tools) : undefined;

    const allMessages: OpenAI.ChatCompletionMessageParam[] = args.system
      ? [{ role: 'system', content: args.system }, ...messages]
      : messages;

    // Ollama-specific: omit stream_options, thinking blocks, token caching
    const streamParams: OpenAI.ChatCompletionCreateParams = {
      model,
      messages: allMessages,
      stream: true,
      ...(tools ? { tools } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}),
    };

    return {
      iterable: streamOpenAICompatible(this.client, streamParams, args.signal),
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

    const response = await this.client.chat.completions.create({
      model,
      messages: allMessages,
      stream: false,
      ...(tools ? { tools } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}),
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
