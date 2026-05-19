import Anthropic from '@anthropic-ai/sdk';
import type {
  Provider,
  ProviderEvent,
  ProviderStreamArgs,
  ProviderCompleteArgs,
  ProviderCompleteResult,
  ProviderMessage,
  MessageContent,
  ReasoningEffort,
} from './provider.js';

type CancelableIterable<T> = { iterable: AsyncIterable<T>; cancel(): void };

function effortToBudget(effort?: ReasoningEffort): number | undefined {
  switch (effort) {
    case 'low':    return 2_000;
    case 'medium': return 6_000;
    case 'high':   return 16_000;
    case 'max':    return 32_000;
    case 'auto':
    default:       return undefined;
  }
}

function effortToAdaptiveEffort(effort?: ReasoningEffort): 'low' | 'medium' | 'high' | 'max' | 'xhigh' | undefined {
  switch (effort) {
    case 'low':    return 'low';
    case 'medium': return 'medium';
    case 'high':   return 'high';
    case 'max':    return 'max';
    case 'auto':
    default:       return undefined;
  }
}

const ADAPTIVE_MODELS = new Set([
  'claude-opus-4-7',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
]);

function isAdaptiveModel(model: string): boolean {
  return ADAPTIVE_MODELS.has(model);
}

export class AnthropicProvider implements Provider {
  readonly name = 'anthropic';
  readonly models = [
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
  ];
  readonly defaultModel = 'claude-sonnet-4-6';

  private client: Anthropic;

  constructor(apiKey?: string, baseUrl?: string) {
    const resolvedKey = (apiKey && apiKey.length > 0)
      ? apiKey
      : process.env.ANTHROPIC_API_KEY;
    if (!resolvedKey) {
      throw new Error(
        'AnthropicProvider: no API key (pass explicitly or set ANTHROPIC_API_KEY / MODEL_API_KEY).',
      );
    }
    this.client = new Anthropic({
      apiKey: resolvedKey,
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
  }

  stream(args: ProviderStreamArgs): CancelableIterable<ProviderEvent> {
    const model = args.model || this.defaultModel;
    const useAdaptive = isAdaptiveModel(model);
    const adaptiveEffort = effortToAdaptiveEffort(args.effort);

    const messages = this.mapMessages(args.messages);
    const tools = args.tools ? this.mapTools(args.tools) : undefined;

    const streamArgs: Anthropic.MessageStreamParams = {
      model,
      max_tokens: args.maxTokens || 16384,
      system: args.system,
      messages,
      tools,
    };

    if (useAdaptive) {
      streamArgs.thinking = { type: 'adaptive', display: 'summarized' };
      if (adaptiveEffort) {
        streamArgs.output_config = { effort: adaptiveEffort };
      }
      streamArgs.temperature = args.temperature;
    } else if (!useAdaptive && args.effort && args.effort !== 'auto') {
      // Manual budget_tokens for older models (Haiku 4.5, etc.)
      const thinkingBudget = effortToBudget(args.effort);
      if (thinkingBudget) {
        streamArgs.max_tokens = thinkingBudget + 8192;
        streamArgs.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
        streamArgs.temperature = 1;
      } else {
        streamArgs.temperature = args.temperature;
      }
    } else {
      streamArgs.temperature = args.temperature;
    }

    const sdkStream = this.client.messages.stream(streamArgs);

    // keyed by content block index
    const toolBlocks = new Map<number, { id: string; name: string; inputStr: string }>();
    const thinkingBlocks = new Map<number, { thinking: string; signature: string }>();

    // Own AbortController for the provider. The external signal (from TurnLoop)
    // triggers this controller, which then aborts the SDK stream.
    const abortCtrl = new AbortController();

    // Listen for the external abort signal inside the generator, right before
    // the for-await loop. This ensures the listener is registered when iteration
    // starts. When the signal fires, we immediately call sdkStream.abort() to
    // close the HTTP connection — not just set a flag.
    async function* generator(): AsyncIterable<ProviderEvent> {
      args.signal?.addEventListener('abort', () => {
        abortCtrl.abort();
        try { (sdkStream as any).return?.(undefined); } catch { /* ignore */ }
      }, { once: true });

      for await (const event of sdkStream) {
        if (abortCtrl.signal.aborted) break;

        if (event.type === 'content_block_start') {
          const cb = event.content_block;
          if (cb.type === 'tool_use') {
            toolBlocks.set(event.index, { id: cb.id, name: cb.name, inputStr: '' });
          } else if (cb.type === 'thinking') {
            thinkingBlocks.set(event.index, { thinking: cb.thinking || '', signature: cb.signature || '' });
          }
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text-delta', text: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            const block = toolBlocks.get(event.index);
            if (block) block.inputStr += event.delta.partial_json;
          } else if (event.delta.type === 'thinking_delta') {
            const t = thinkingBlocks.get(event.index);
            if (t) t.thinking += event.delta.thinking;
            yield { type: 'thinking-delta', text: event.delta.thinking };
          } else if (event.delta.type === 'signature_delta') {
            const t = thinkingBlocks.get(event.index);
            if (t) t.signature += event.delta.signature;
          }
        }

        if (event.type === 'content_block_stop') {
          // Tool calls are buffered until the stream completes so the TUI
          // can render them as one grouped block (matching OpenRouter).
          const thinking = thinkingBlocks.get(event.index);
          if (thinking) {
            yield { type: 'thinking-block', thinking: thinking.thinking, signature: thinking.signature };
            thinkingBlocks.delete(event.index);
          }
        }

        if (event.type === 'message_delta' && event.usage) {
          yield {
            type: 'usage',
            inputTokens: event.usage.input_tokens || 0,
            outputTokens: event.usage.output_tokens || 0,
            cacheReadTokens: event.usage.cache_read_input_tokens ?? undefined,
            cacheWriteTokens: event.usage.cache_creation_input_tokens ?? undefined,
          };
        }
      }

      if (abortCtrl.signal.aborted) {
        yield { type: 'stop', reason: 'aborted' };
        return;
      }

      // Flush buffered tool calls in stream order (Map preserves insertion order).
      for (const [, tool] of toolBlocks) {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tool.inputStr || '{}'); } catch { /* empty input */ }
        yield { type: 'tool-call', id: tool.id, name: tool.name, input };
      }
      toolBlocks.clear();

      try {
        const final = await sdkStream.finalMessage();
        if (final.usage) {
          yield {
            type: 'usage',
            inputTokens: final.usage.input_tokens,
            outputTokens: final.usage.output_tokens,
            cacheReadTokens: final.usage.cache_read_input_tokens ?? undefined,
            cacheWriteTokens: final.usage.cache_creation_input_tokens ?? undefined,
          };
        }
      } catch {
        // sdkStream.finalMessage() throws if the stream was aborted — that's expected.
      }

      yield { type: 'stop', reason: abortCtrl.signal.aborted ? 'aborted' : 'stop' };
    }

    return {
      iterable: generator(),
      cancel() {
        try { (sdkStream as any).abort?.(); } catch { /* stream may already be closed */ }
      },
    };
  }

  async check(prompt: string, args?: {
    model?: string;
    system?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const model = args?.model || this.defaultModel;
    const response = await this.client.messages.create({
      model,
      max_tokens: 256,
      system: args?.system,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    });
    const text = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map(c => c.text)
      .join('\n');
    return text.trim();
  }

  async complete(args: ProviderCompleteArgs): Promise<ProviderCompleteResult> {
    const model = args.model || this.defaultModel;
    const useAdaptive = isAdaptiveModel(model);
    const adaptiveEffort = effortToAdaptiveEffort(args.effort);

    const messages = this.mapMessages(args.messages);
    const tools = args.tools ? this.mapTools(args.tools) : undefined;

    const createArgs: Anthropic.MessageCreateParams = {
      model,
      max_tokens: args.maxTokens || 16384,
      system: args.system,
      messages,
      tools,
    };

    if (useAdaptive) {
      createArgs.thinking = { type: 'adaptive', display: 'summarized' };
      if (adaptiveEffort) {
        createArgs.output_config = { effort: adaptiveEffort };
      }
      createArgs.temperature = args.temperature;
    } else if (!useAdaptive && args.effort && args.effort !== 'auto') {
      const thinkingBudget = effortToBudget(args.effort);
      if (thinkingBudget) {
        createArgs.max_tokens = thinkingBudget + 8192;
        createArgs.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
        createArgs.temperature = 1;
      } else {
        createArgs.temperature = args.temperature ?? 0;
      }
    } else {
      createArgs.temperature = args.temperature ?? 0;
    }

    const response = await this.client.messages.create(createArgs);

    const text = response.content
      .filter((c): c is Anthropic.TextBlock => c.type === 'text')
      .map(c => c.text)
      .join('\n');

    const toolCalls = response.content
      .filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
      .map(c => ({
        id: c.id,
        name: c.name,
        input: c.input as Record<string, unknown>,
      }));

    return {
      text: text.trim(),
      stopReason: (response.stop_reason === 'tool_use')
        ? 'tool_use'
        : (response.stop_reason === 'end_turn')
        ? 'end_turn'
        : 'stop',
      usage: response.usage
        ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens }
        : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  private mapMessages(messages: ProviderMessage[]): Anthropic.MessageParam[] {
    return messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: m.toolUseId,
              content: m.content,
            },
          ],
        } as Anthropic.MessageParam;
      }

      const content =
        typeof m.content === 'string'
          ? m.content
          : m.content.map((c) => {
              if (c.type === 'text') return { type: 'text' as const, text: c.text };
              if (c.type === 'thinking')
                return { type: 'thinking' as const, thinking: c.thinking, signature: c.signature };
              if (c.type === 'tool-use')
                return { type: 'tool_use' as const, id: c.id, name: c.name, input: c.input };
              if (c.type === 'tool-result')
                return { type: 'tool_result' as const, tool_use_id: c.tool_use_id, content: c.content };
              return { type: 'text' as const, text: JSON.stringify(c) };
            });

      return { role: m.role, content } as Anthropic.MessageParam;
    });
  }

  private mapTools(tools: Array<{ name: string; description: string; inputSchema: unknown }>): Anthropic.Tool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));
  }
}
