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
import { normalizeToolSchema } from './provider.js';
import { streamOpenAICompatible } from './openai-compatible-stream.js';

type CancelableIterable<T> = { iterable: AsyncIterable<T>; cancel(): void };

function effortToReasoning(effort?: ReasoningEffort): string | undefined {
  switch (effort) {
    case 'low':    return 'low';
    case 'medium': return 'medium';
    case 'high':   return 'high';
    case 'max':    return 'xhigh';
    case 'auto':
    default:       return undefined;
  }
}

function effortToReasoningObj(effort?: ReasoningEffort): { effort: string } | undefined {
  const level = effortToReasoning(effort);
  if (level) return { effort: level };
  return undefined;
}

/** Default output caps for `check()` — sized for one-word harm verdicts. */
const CHECK_MAX_TOKENS = 2048;
const CHECK_RESPONSES_MAX_TOKENS = 256;

const REASONING_MODEL_RE = /^(o1|o3|o4|gpt-5)[-\d:.]*(mini|medium|high|pro)?(-\d+)?$/i;

function isReasoningModel(model: string): boolean {
  return REASONING_MODEL_RE.test(model);
}

// ─── Provider ────────────────────────────────────────────────

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
    'o3',
    'o4-mini',
    'gpt-5.5',
    'gpt-5.5-pro',
    'gpt-5.4',
    'gpt-5.4-mini',
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

  // ─── Stream ────────────────────────────────────────────────

  stream(args: ProviderStreamArgs): CancelableIterable<ProviderEvent> {
    const model = args.model || this.defaultModel;
    if (isReasoningModel(model)) {
      return this.streamResponses(args, model);
    }
    return this.streamChat(args, model);
  }

  private streamChat(args: ProviderStreamArgs, model: string): CancelableIterable<ProviderEvent> {
    const modelIsReasoning = isReasoningModel(model);
    const reasoningEffort = effortToReasoning(args.effort);

    const maxTokens = modelIsReasoning
      ? args.maxTokens ?? 65_536
      : args.maxTokens;

    const messages = this.mapMessages(args.messages);
    const tools = args.tools ? this.mapTools(args.tools) : undefined;

    const allMessages: OpenAI.ChatCompletionMessageParam[] = args.system
      ? [{ role: 'system', content: args.system }, ...messages]
      : messages;

    const streamParams = {
      model,
      messages: allMessages,
      stream: true,
      ...(tools ? { tools } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
      ...(modelIsReasoning && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      // Routing hint: OpenAI uses this to prefer the same cache-warm backend
      // across turns of one conversation, mirroring OpenRouter's session_id.
      ...(args.sessionId ? { prompt_cache_key: args.sessionId } : {}),
      stream_options: { include_usage: true },
    } as OpenAI.ChatCompletionCreateParams;

    const abortCtrl = new AbortController();

    return {
      iterable: streamOpenAICompatible(this.client, streamParams, args.signal ?? abortCtrl.signal),
      cancel() {
        abortCtrl.abort();
      },
    };
  }

  private streamResponses(args: ProviderStreamArgs, model: string): CancelableIterable<ProviderEvent> {
    const self = this;
    const reasoningEffort = effortToReasoningObj(args.effort);
    const inputItems = this.mapMessagesToInput(args.messages);
    const tools = args.tools ? this.mapToolsToResponses(args.tools) : undefined;

    const respParams: Record<string, unknown> = {
      model,
      input: inputItems,
      ...(args.system ? { instructions: args.system } : {}),
      ...(tools ? { tools } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(args.maxTokens ? { max_output_tokens: args.maxTokens } : {}),
      ...(args.sessionId ? { prompt_cache_key: args.sessionId } : {}),
      reasoning: {
        ...(reasoningEffort ?? { effort: 'low' }),
        summary: 'auto',
      },
      truncation: 'auto',
      stream: true,
    };

    async function* generator(): AsyncIterable<ProviderEvent> {
      const sdkStream = await self.client.responses.create(respParams as any) as unknown as AsyncIterable<Record<string, unknown>>;

      const pendingTools = new Map<number, { callId: string; name: string; input: Record<string, unknown> }>();
      let lastUsageInput = 0;
      let lastUsageOutput = 0;
      let lastCachedTokens: number | undefined;

      for await (const raw of sdkStream) {
        if (args.signal?.aborted) break;
        const evt = raw as Record<string, unknown>;
        const type = String(evt.type ?? '');

        if (type === 'response.output_text.delta') {
          yield { type: 'text-delta', text: String(evt.delta ?? '') };
        } else if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning.delta') {
          yield { type: 'thinking-delta', text: String(evt.delta ?? '') };
        } else if (type === 'response.function_call_arguments.done') {
          const idx = Number(evt.output_index ?? 0);
          let input: Record<string, unknown> = {};
          try { if (evt.arguments) input = JSON.parse(String(evt.arguments)); } catch { /* empty */ }
          const existing = pendingTools.get(idx);
          if (existing) existing.input = input;
        } else if (type === 'response.output_item.added') {
          const item = evt.item as Record<string, unknown>;
          if (item && item.type === 'function_call') {
            pendingTools.set(Number(evt.output_index ?? 0), {
              callId: String(item.call_id ?? ''),
              name: String(item.name ?? ''),
              input: {},
            });
          }
        } else if (type === 'response.completed') {
          const resp = evt.response as Record<string, unknown>;
          const u = resp.usage as Record<string, unknown>;
          if (u) {
            lastUsageInput = Number(u.input_tokens ?? 0);
            lastUsageOutput = Number(u.output_tokens ?? 0);
            const details = u.input_tokens_details as Record<string, unknown> | undefined;
            const cached = details?.cached_tokens;
            lastCachedTokens = typeof cached === 'number' ? cached : undefined;
          }
        }
      }

      // Flush buffered tool calls in stream order so the TUI renders them as one grouped block.
      for (const [, pending] of pendingTools) {
        yield { type: 'tool-call', id: pending.callId, name: pending.name, input: pending.input };
      }

      if (lastUsageInput || lastUsageOutput) {
        yield { type: 'usage', inputTokens: lastUsageInput, outputTokens: lastUsageOutput, cacheReadTokens: lastCachedTokens };
      }

      yield { type: 'stop', reason: args.signal?.aborted ? 'aborted' : 'stop' };
    }

    return {
      iterable: generator(),
      cancel() {
        // Responses API stream cancellation via abort signal in the loop.
      },
    };
  }

  // ─── Check ─────────────────────────────────────────────────

  async check(prompt: string, args?: {
    model?: string;
    system?: string;
    signal?: AbortSignal;
    /** Callers that need long output (compaction summaries) must raise this. */
    maxTokens?: number;
  }): Promise<string> {
    const model = args?.model || this.defaultModel;
    if (isReasoningModel(model)) {
      return this.checkResponses(prompt, args);
    }
    return this.checkChat(prompt, args);
  }

  private async checkChat(prompt: string, args?: {
    model?: string;
    system?: string;
    signal?: AbortSignal;
    maxTokens?: number;
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
      max_tokens: args?.maxTokens ?? CHECK_MAX_TOKENS,
      temperature: 0,
    });
    return response.choices[0]?.message?.content?.trim() ?? '';
  }

  private async checkResponses(prompt: string, args?: {
    model?: string;
    system?: string;
    signal?: AbortSignal;
    maxTokens?: number;
  }): Promise<string> {
    const model = args?.model || this.defaultModel;
    const response = await this.client.responses.create({
      model,
      input: [{ role: 'user', content: prompt }],
      ...(args?.system ? { instructions: args.system } : {}),
      max_output_tokens: args?.maxTokens ?? CHECK_RESPONSES_MAX_TOKENS,
      temperature: 0,
      truncation: 'auto',
    } as any);
    return (response as { output_text?: string })?.output_text?.trim() ?? '';
  }

  // ─── Complete ──────────────────────────────────────────────

  async complete(args: ProviderCompleteArgs): Promise<ProviderCompleteResult> {
    const model = args.model || this.defaultModel;
    if (isReasoningModel(model)) {
      return this.completeResponses(args, model);
    }
    return this.completeChat(args, model);
  }

  private async completeChat(args: ProviderCompleteArgs, model: string): Promise<ProviderCompleteResult> {
    const modelIsReasoning = isReasoningModel(model);
    const reasoningEffort = effortToReasoning(args.effort);

    const maxTokens = modelIsReasoning
      ? args.maxTokens ?? 65_536
      : args.maxTokens;

    const messages = this.mapMessages(args.messages);
    const tools = args.tools ? this.mapTools(args.tools) : undefined;

    const allMessages: OpenAI.ChatCompletionMessageParam[] = args.system
      ? [{ role: 'system', content: args.system }, ...messages]
      : messages;

    const responseParams = {
      model,
      messages: allMessages,
      stream: false,
      ...(tools ? { tools } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
      ...(modelIsReasoning && reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
      ...(args.sessionId ? { prompt_cache_key: args.sessionId } : {}),
      stream_options: { include_usage: true },
    };
    const response = await this.client.chat.completions.create(responseParams as any) as OpenAI.ChatCompletion;

    const choice = response.choices[0];
    const text = choice?.message?.content ?? '';

    const toolCalls = choice?.message?.tool_calls?.map(tc => {
      let input: Record<string, unknown> = {};
      try { if (tc.function?.arguments) input = JSON.parse(tc.function.arguments); } catch { /* empty */ }
      return { id: tc.id ?? '', name: tc.function?.name ?? '', input };
    }).filter(tc => tc.id) ?? [];

    const usage = response.usage
      ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          cacheReadTokens: response.usage.prompt_tokens_details?.cached_tokens,
        }
      : undefined;

    return {
      text: text.trim(),
      stopReason: (choice?.finish_reason === 'stop' || choice?.finish_reason === 'function_call')
        ? 'stop'
        : choice?.finish_reason === 'tool_calls' ? 'tool_use'
        : choice?.finish_reason === 'length' ? 'length'
        : choice?.finish_reason === 'content_filter' ? 'content_filter'
        : 'stop',
      usage,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private async completeResponses(args: ProviderCompleteArgs, model: string): Promise<ProviderCompleteResult> {
    const reasoningEffort = effortToReasoningObj(args.effort);
    const inputItems = this.mapMessagesToInput(args.messages);
    const tools = args.tools ? this.mapToolsToResponses(args.tools) : undefined;

    const respParams: Record<string, unknown> = {
      model,
      input: inputItems,
      ...(args.system ? { instructions: args.system } : {}),
      ...(tools ? { tools } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      ...(args.maxTokens ? { max_output_tokens: args.maxTokens } : {}),
      ...(args.sessionId ? { prompt_cache_key: args.sessionId } : {}),
      ...(reasoningEffort ? { reasoning: reasoningEffort } : {}),
      truncation: 'auto',
    };

    const response = await this.client.responses.create(respParams as any) as unknown as Record<string, unknown>;

    const text = (response.output_text as string) ?? '';

    const outputItems = (response.output as any[]) ?? [];
    const toolCalls = outputItems
      .filter(item => item.type === 'function_call')
      .map((fc) => {
        let input: Record<string, unknown> = {};
        try { if (fc.arguments) input = JSON.parse(fc.arguments); } catch { /* empty */ }
        return { id: fc.call_id as string, name: fc.name as string, input };
      });

    const usageObj = response.usage as {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
    } | undefined;
    const usage = usageObj
      ? {
          inputTokens: usageObj.input_tokens ?? 0,
          outputTokens: usageObj.output_tokens ?? 0,
          cacheReadTokens: usageObj.input_tokens_details?.cached_tokens,
        }
      : undefined;

    return {
      text: text.trim(),
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'stop',
      usage,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  // ─── Chat Completions mappers ──────────────────────────────

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
            function: { name: c.name, arguments: JSON.stringify(c.input) },
          }));

        return {
          role: 'assistant',
          content: textParts.join('\n') || '',
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
        parameters: normalizeToolSchema(t.inputSchema),
      },
    }));
  }

  // ─── Responses API mappers ─────────────────────────────────

  private mapMessagesToInput(messages: ProviderMessage[]): Record<string, unknown>[] {
    const items: Record<string, unknown>[] = [];
    for (const m of messages) {
      if (m.role === 'tool') {
        items.push({
          type: 'function_call_output',
          call_id: (m as { toolUseId: string }).toolUseId,
          output: m.content as string,
        });
      } else if (typeof m.content === 'string') {
        items.push({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        });
      } else if (Array.isArray(m.content)) {
        if (m.role === 'assistant') {
          const textParts = m.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map(c => c.text);
          const toolUses = m.content
            .filter((c): c is { type: 'tool-use'; id: string; name: string; input: Record<string, unknown> } => c.type === 'tool-use');

          if (textParts.length > 0) {
            items.push({
              role: 'assistant',
              type: 'message',
              content: textParts.map((t) => ({ type: 'output_text', text: t })),
              status: 'completed',
            });
          }
          for (const tu of toolUses) {
            items.push({
              type: 'function_call',
              call_id: tu.id,
              name: tu.name,
              arguments: JSON.stringify(tu.input),
            });
          }
        } else {
          const textParts = m.content
            .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
            .map(c => c.text);
          items.push({
            role: 'user',
            content: textParts.join('\n'),
          });
        }
      }
    }
    return items;
  }

  private mapToolsToResponses(tools: ToolDefinition[]): Record<string, unknown>[] {
    return tools.map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: normalizeToolSchema(t.inputSchema),
      strict: null,
    }));
  }
}
