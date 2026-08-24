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
import { normalizeToolSchema } from './provider.js';

type CancelableIterable<T> = { iterable: AsyncIterable<T>; cancel(): void };

/** Default output cap for `check()` — sized for one-word harm verdicts. */
const CHECK_MAX_TOKENS = 2048;

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

/** OpenRouter provider-routing preferences. See https://openrouter.ai/docs/provider-routing */
export interface OpenRouterRouting {
  /** Upstream slugs to try, in order (e.g. ['deepinfra', 'novita']). */
  order?: string[];
  /** When false, the request fails instead of silently falling through to another upstream. */
  allowFallbacks?: boolean;
  /** When true, skip upstreams that don't support every parameter in the request. */
  requireParameters?: boolean;
  /** Hard allowlist of upstream slugs. */
  only?: string[];
}

/** Normalize the legacy `string[]` order argument into the routing object. */
function toRouting(routing?: string[] | OpenRouterRouting): OpenRouterRouting {
  if (!routing) return {};
  return Array.isArray(routing) ? { order: routing } : routing;
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

export interface OpenRouterModelInfo {
  contextLength?: number;
  pricePromptPerM?: number;
  priceCompletionPerM?: number;
  /** `top_provider.max_completion_tokens` — the largest `max_tokens` a route will accept. */
  maxCompletionTokens?: number;
}

/** OpenRouter reports pricing as a per-token decimal string; we store per-million. */
function perMillion(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n * 1_000_000 : undefined;
}

export class OpenRouterProvider implements Provider {
  readonly name = 'openrouter';
  readonly models: string[];
  readonly defaultModel = 'anthropic/claude-sonnet-4-6';

  private client: OpenAI;
  private _baseUrl: string;
  private _routing: OpenRouterRouting;
  private _allModels: string[] | null = null;
  private _modelInfo = new Map<string, OpenRouterModelInfo>();

  constructor(apiKey?: string, baseUrl?: string, routing?: string[] | OpenRouterRouting) {
    const resolvedKey = (apiKey && apiKey.length > 0)
      ? apiKey
      : process.env.OPENROUTER_API_KEY;
    if (!resolvedKey) {
      throw new Error(
        'OpenRouterProvider: no API key (pass explicitly or set OPENROUTER_API_KEY).',
      );
    }
    this._baseUrl = baseUrl || 'https://openrouter.ai/api/v1';
    this._routing = toRouting(routing);
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
      // _baseUrl already ends in /api/v1 — the path here is just /models.
      const resp = await fetch(`${this._baseUrl}/models`, {
        signal: AbortSignal.timeout(5000),
      });
      const data = await resp.json() as {
        data?: Array<{
          id: string;
          context_length?: number;
          pricing?: { prompt?: string; completion?: string };
          top_provider?: { max_completion_tokens?: number | null };
        }>;
      };
      if (data.data?.length) {
        for (const m of data.data) {
          if (!m.id) continue;
          const cap = m.top_provider?.max_completion_tokens;
          this._modelInfo.set(m.id, {
            contextLength: m.context_length,
            pricePromptPerM: perMillion(m.pricing?.prompt),
            priceCompletionPerM: perMillion(m.pricing?.completion),
            maxCompletionTokens: typeof cap === 'number' && cap > 0 ? cap : undefined,
          });
        }
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

  /**
   * Context window and per-million pricing for a model, from the OpenRouter
   * models API. Returns undefined until `getModels()` has populated the cache,
   * or if the model is not in the response.
   */
  getModelInfo(id: string): OpenRouterModelInfo | undefined {
    return this._modelInfo.get(id);
  }

  /**
   * The `provider` routing block, or `{}` when no preferences are configured.
   * Shared by stream/complete/check so a harm-check isn't free-routed to an
   * upstream the user deliberately ordered away from.
   */
  private providerBlock(): { provider?: Record<string, unknown> } {
    const r = this._routing;
    const block: Record<string, unknown> = {};
    if (r.order && r.order.length > 0) block.order = r.order;
    if (r.only && r.only.length > 0) block.only = r.only;
    if (r.allowFallbacks !== undefined) block.allow_fallbacks = r.allowFallbacks;
    if (r.requireParameters !== undefined) block.require_parameters = r.requireParameters;
    return Object.keys(block).length > 0 ? { provider: block } : {};
  }

  /**
   * Clamp the requested output cap to what the route will actually accept.
   * `max_output_tokens` is user-configurable and can easily exceed a given
   * model's completion limit, which strict upstreams reject with HTTP 422
   * rather than clamping silently. Best-effort: if the models cache is cold or
   * the model is unknown, pass the caller's value through unchanged.
   */
  private clampMaxTokens(model: string, requested: number): number {
    const cap = this._modelInfo.get(model)?.maxCompletionTokens;
    return cap ? Math.min(requested, cap) : requested;
  }

  /** Flatten an SDK error into a message that keeps the upstream's 422 detail. */
  private static describeError(err: unknown): string {
    const e = err as {
      status?: number;
      message?: string;
      error?: { message?: string; metadata?: { raw?: unknown; provider_name?: unknown } };
      response?: { status?: number };
    };
    const status = e.status ?? e.response?.status;
    const parts: string[] = [];
    if (status) parts.push(`HTTP ${String(status)}`);
    const upstream = e.error?.metadata?.provider_name;
    if (typeof upstream === 'string' && upstream) parts.push(`upstream=${upstream}`);
    const detail = e.error?.message ?? e.message ?? String(err);
    parts.push(detail);
    // OpenRouter nests the upstream's own validation body here — for a 422 this is
    // the only place the offending field name appears.
    const raw = e.error?.metadata?.raw;
    if (raw !== undefined && raw !== null) {
      const rawStr = typeof raw === 'string' ? raw : JSON.stringify(raw);
      if (rawStr && !detail.includes(rawStr)) parts.push(`raw=${rawStr.slice(0, 1000)}`);
    }
    return parts.join(': ');
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

    const streamParams: OpenAI.ChatCompletionCreateParams & {
      reasoning?: object;
      session_id?: string;
      cache_control?: { type: 'ephemeral' };
    } = {
      model,
      messages: allMessages,
      stream: true,
      ...(tools ? { tools } : {}),
      ...(args.temperature !== undefined ? { temperature: args.temperature } : {}),
      max_tokens: this.clampMaxTokens(model, args.maxTokens ?? 65536),
      ...(reasoning ? { reasoning } : {}),
      ...this.providerBlock(),
      ...(args.sessionId ? { session_id: args.sessionId } : {}),
      // Sticky routing (session_id) pins the conversation to one upstream instance;
      // cache_control lets OpenRouter auto-insert cache breakpoints on that pinned
      // request. Verified accepted by strict upstreams (DeepInfra) as of 2026-08.
      cache_control: { type: 'ephemeral' },
      stream_options: { include_usage: true },
    };

    if (process.env.DEBUG_PROVIDER) {
      // Logs the request body only — never headers, so the API key can't leak.
      // `messages` is dropped: it's the bulk of the payload and the interesting
      // part for a 4xx is the parameter set.
      const rest: Record<string, unknown> = { ...streamParams };
      delete rest.messages;
      console.log(`[openrouter/stream] params=${JSON.stringify(rest).slice(0, 2000)}`);
      console.log(`[openrouter/stream] messages=${String(allMessages.length)}, tools=${String(tools?.length ?? 0)}`);
    }

    let sdkStream: AsyncIterable<OpenAI.ChatCompletionChunk> | null = null;

    async function* generator(): AsyncIterable<ProviderEvent> {
      try {
        sdkStream = await self.client.chat.completions.create(streamParams) as AsyncIterable<OpenAI.ChatCompletionChunk>;
      } catch (sdkErr) {
        // The request was rejected before any SSE arrived — a 4xx from OpenRouter
        // or from the upstream it routed to. Surface it as an error event instead
        // of throwing out of the generator, so the turn loop can report the body.
        if (args.signal?.aborted) {
          yield { type: 'stop', reason: 'aborted' };
          return;
        }
        const detail = OpenRouterProvider.describeError(sdkErr);
        if (process.env.DEBUG_PROVIDER) console.log(`[openrouter/stream] request failed: ${detail}`);
        yield { type: 'stop', reason: 'error', errorDetail: detail };
        return;
      }

      const pendingTools = new Map<number, { id: string; name: string; inputStr: string }>();
      const thinkingBlocks = new Map<number, { thinking: string; signature: string }>();
      let lastUsage: OpenAI.CompletionUsage | null = null;

      try {
        for await (const chunk of sdkStream) {
          if (args.signal?.aborted) {
            break;
          }

          if (chunk.usage) {
            lastUsage = chunk.usage;
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;

          // OpenRouter reasoning_details (not in OpenAI SDK types, cast to any).
          const rawDelta = choice.delta as Record<string, unknown> | undefined;
          const reasoningDetails = rawDelta?.reasoning_details as Array<{
            type: string;
            text?: string;
            signature?: string | null;
            index?: number;
          }> | undefined;

          if (reasoningDetails?.length) {
            for (const rd of reasoningDetails) {
              if (rd.type !== 'reasoning.text') continue;
              const idx = rd.index ?? 0;
              if (!thinkingBlocks.has(idx)) {
                thinkingBlocks.set(idx, { thinking: '', signature: '' });
              }
              const tb = thinkingBlocks.get(idx)!;
              if (rd.text) {
                tb.thinking += rd.text;
                yield { type: 'thinking-delta', text: rd.text };
              }
              if (rd.signature) tb.signature = rd.signature;
            }
          } else {
            // No more reasoning_details — flush any pending thinking blocks.
            for (const [, tb] of thinkingBlocks) {
              yield { type: 'thinking-block', thinking: tb.thinking, signature: tb.signature };
            }
            thinkingBlocks.clear();
          }

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
      } catch (streamErr) {
        // Mid-stream failure (connection reset, SSE parse error, upstream error
        // frame). Mirrors streamOpenAICompatible's handling.
        if (args.signal?.aborted) {
          yield { type: 'stop', reason: 'aborted' };
          return;
        }
        const detail = OpenRouterProvider.describeError(streamErr);
        if (process.env.DEBUG_PROVIDER) console.log(`[openrouter/stream] stream failed: ${detail}`);
        yield { type: 'stop', reason: 'error', errorDetail: detail };
        return;
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
        // OpenRouter reports cache stats under prompt_tokens_details (not in OpenAI SDK types, cast to any).
        const usageDetails = lastUsage as OpenAI.CompletionUsage & {
          prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
        };
        yield {
          type: 'usage',
          inputTokens: lastUsage.prompt_tokens ?? 0,
          outputTokens: lastUsage.completion_tokens ?? 0,
          cacheReadTokens: usageDetails.prompt_tokens_details?.cached_tokens,
          cacheWriteTokens: usageDetails.prompt_tokens_details?.cache_write_tokens,
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
    /** Callers that need long output (compaction summaries) must raise this. */
    maxTokens?: number;
  }): Promise<string> {
    const model = args?.model || this.defaultModel;
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'user', content: prompt },
    ];
    if (args?.system) {
      messages.unshift({ role: 'system' as const, content: args.system });
    }
    // Routing preferences apply here too — without them a harm-check or a
    // compaction summary is free-routed to any upstream, including ones the
    // user deliberately ordered away from.
    const response = await this.client.chat.completions.create({
      model,
      messages,
      max_tokens: this.clampMaxTokens(model, args?.maxTokens ?? CHECK_MAX_TOKENS),
      temperature: 0,
      ...this.providerBlock(),
    } as OpenAI.ChatCompletionCreateParamsNonStreaming);
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
      max_tokens: this.clampMaxTokens(model, args.maxTokens ?? 16384),
      ...(reasoning ? { reasoning } : {}),
      ...this.providerBlock(),
      ...(args.sessionId ? { session_id: args.sessionId } : {}),
      cache_control: { type: 'ephemeral' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    const usageDetails = response.usage as (OpenAI.CompletionUsage & {
      prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    }) | undefined;
    const usage = response.usage
      ? {
          inputTokens: response.usage.prompt_tokens,
          outputTokens: response.usage.completion_tokens,
          cacheReadTokens: usageDetails?.prompt_tokens_details?.cached_tokens,
          cacheWriteTokens: usageDetails?.prompt_tokens_details?.cache_write_tokens,
        }
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
        parameters: normalizeToolSchema(t.inputSchema),
      },
    }));
  }
}
