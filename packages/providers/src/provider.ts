export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Coerce a tool's `inputSchema` into the object shape that OpenAI-compatible
 * `function.parameters` requires. The type says object, but MCP servers hand us
 * whatever they like and a schema can arrive as a JSON string; shipping that
 * verbatim earns an HTTP 422 from strict upstreams (DeepInfra/vLLM) while lax
 * ones silently accept it, which makes the failure look provider-specific.
 */
export function normalizeToolSchema(schema: unknown): Record<string, unknown> {
  if (typeof schema === 'string') {
    try {
      const parsed: unknown = JSON.parse(schema);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* fall through to the empty-object default */ }
    return { type: 'object', properties: {} };
  }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {} };
  }
  return schema as Record<string, unknown>;
}

export type ProviderEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'thinking-delta'; text: string }
  | { type: 'thinking-block'; thinking: string; signature: string }
  | { type: 'tool-call'; id: string; name: string; input: Record<string, unknown>; thoughtSignature?: string }
  | { type: 'tool-result-request'; callId: string }
  /**
   * `inputTokens` is the TOTAL prompt size (including any cached tokens) —
   * `cacheReadTokens`/`cacheWriteTokens` are subsets of it, not additional
   * tokens on top. Adapters whose raw usage excludes cache tokens (e.g.
   * Anthropic's `input_tokens`) must add them back in before emitting.
   */
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
  | { type: 'stop'; reason: string; errorDetail?: string };

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max' | 'auto';

export interface ProviderStreamArgs {
  messages: ProviderMessage[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  system?: string;
  effort?: ReasoningEffort;
  /** Stable per-conversation id. Providers that support sticky routing (e.g. OpenRouter) use this to pin requests to the same upstream instance, maximizing prompt-cache hits. */
  sessionId?: string;
}

export interface ProviderCompleteArgs {
  messages: ProviderMessage[];
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  system?: string;
  effort?: ReasoningEffort;
  /** Stable per-conversation id. Providers that support sticky routing (e.g. OpenRouter) use this to pin requests to the same upstream instance, maximizing prompt-cache hits. */
  sessionId?: string;
}

export interface ProviderCompleteResult {
  text: string;
  stopReason: 'stop' | 'end_turn' | 'tool_use' | 'length' | 'content_filter' | 'aborted';
  /** `inputTokens` is the TOTAL prompt size including cached tokens; cache fields are subsets. */
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
}

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'image'; source: { media_type: string; data: string } }
  | { type: 'tool-use'; id: string; name: string; input: Record<string, unknown>; thoughtSignature?: string }
  | { type: 'tool-result'; tool_use_id: string; name?: string; content: string };

export type ProviderMessage =
  | { role: 'user'; content: string | MessageContent[] }
  | { role: 'assistant'; content: string | MessageContent[] }
  | { role: 'tool'; toolUseId: string; toolName?: string; content: string };

export interface Provider {
  name: string;
  models: string[];
  defaultModel: string;
  stream(args: ProviderStreamArgs): { iterable: AsyncIterable<ProviderEvent>; cancel(): void };
  /** Non-streaming call — used for quick evaluations (e.g. harm-check). */
  /**
   * Non-streaming call. `maxTokens` defaults to a harm-check-sized cap; callers
   * that need long output (compaction summaries) must raise it explicitly.
   */
  check(prompt: string, args?: { model?: string; system?: string; signal?: AbortSignal; maxTokens?: number }): Promise<string>;
  /** Non-streaming call with full tool-use support — used for heartbeat and other batch scenarios. */
  complete(args: ProviderCompleteArgs): Promise<ProviderCompleteResult>;
}

export interface ProviderRegistry {
  register(provider: Provider): void;
  get(name: string): Provider | undefined;
  list(): Provider[];
}

export function createRegistry(): ProviderRegistry {
  const providers = new Map<string, Provider>();
  return {
    register: (p) => providers.set(p.name, p),
    get: (n) => providers.get(n),
    list: () => [...providers.values()],
  };
}
