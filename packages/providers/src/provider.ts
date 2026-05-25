export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ProviderEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'thinking-delta'; text: string }
  | { type: 'thinking-block'; thinking: string; signature: string }
  | { type: 'tool-call'; id: string; name: string; input: Record<string, unknown>; thoughtSignature?: string }
  | { type: 'tool-result-request'; callId: string }
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
}

export interface ProviderCompleteResult {
  text: string;
  stopReason: 'stop' | 'end_turn' | 'tool_use' | 'length' | 'content_filter' | 'aborted';
  usage?: { inputTokens: number; outputTokens: number };
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
}

export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'image'; source: { media_type: string; data: string } }
  | { type: 'tool-use'; id: string; name: string; input: Record<string, unknown>; thoughtSignature?: string }
  | { type: 'tool-result'; tool_use_id: string; content: string };

export type ProviderMessage =
  | { role: 'user'; content: string | MessageContent[] }
  | { role: 'assistant'; content: string | MessageContent[] }
  | { role: 'tool'; toolUseId: string; content: string };

export interface Provider {
  name: string;
  models: string[];
  defaultModel: string;
  stream(args: ProviderStreamArgs): { iterable: AsyncIterable<ProviderEvent>; cancel(): void };
  /** Non-streaming call — used for quick evaluations (e.g. harm-check). */
  check(prompt: string, args?: { model?: string; system?: string; signal?: AbortSignal }): Promise<string>;
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
