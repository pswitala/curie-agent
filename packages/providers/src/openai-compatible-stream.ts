import type OpenAI from 'openai';
import type { ProviderEvent } from './provider.js';

/**
 * Stream consumer for any OpenAI Chat Completions-compatible endpoint
 * (OpenAI standard models, Ollama, llama.cpp, vLLM, etc.).
 *
 * Behavior matches the OpenRouter reference: tool calls are buffered
 * during the stream and emitted as a single batch after it completes,
 * so the TUI renders them as one grouped block. <think>...</think>
 * tags inside content deltas are routed to thinking-delta events;
 * accumulated thinking is flushed as a single thinking-block at end.
 */
export async function* streamOpenAICompatible(
  client: OpenAI,
  streamParams: OpenAI.ChatCompletionCreateParams,
  signal?: AbortSignal,
): AsyncIterable<ProviderEvent> {
  const sdkStream = (await client.chat.completions.create(streamParams)) as AsyncIterable<OpenAI.ChatCompletionChunk>;

  const pendingTools = new Map<number, { id: string; name: string; inputStr: string }>();
  let lastUsage: OpenAI.CompletionUsage | null = null;
  let inThinkBlock = false;
  let accumulatedThinking = '';

  for await (const chunk of sdkStream) {
    if (signal?.aborted) break;

    if (chunk.usage) lastUsage = chunk.usage;

    const choice = chunk.choices?.[0];
    if (!choice) continue;

    if (choice.delta?.content && typeof choice.delta.content === 'string') {
      const content = choice.delta.content;

      if (!inThinkBlock && content.includes('<think>')) {
        const parts = content.split('<think>');
        if (parts[0]) yield { type: 'text-delta', text: parts[0] };
        inThinkBlock = true;

        const rest = parts.slice(1).join('<think>');
        if (rest.includes('</think>')) {
          const thinkParts = rest.split('</think>');
          yield { type: 'thinking-delta', text: thinkParts[0] || '' };
          accumulatedThinking += thinkParts[0] || '';
          inThinkBlock = false;
          if (thinkParts[1]) yield { type: 'text-delta', text: thinkParts[1] };
        } else {
          yield { type: 'thinking-delta', text: rest };
          accumulatedThinking += rest;
        }
      } else if (inThinkBlock) {
        if (content.includes('</think>')) {
          const parts = content.split('</think>');
          yield { type: 'thinking-delta', text: parts[0] || '' };
          accumulatedThinking += parts[0] || '';
          inThinkBlock = false;
          if (parts[1]) yield { type: 'text-delta', text: parts[1] };
        } else {
          yield { type: 'thinking-delta', text: content };
          accumulatedThinking += content;
        }
      } else {
        yield { type: 'text-delta', text: content };
      }
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

  if (accumulatedThinking) {
    yield { type: 'thinking-block', thinking: accumulatedThinking, signature: '' };
  }

  for (const [, pending] of pendingTools) {
    let input: Record<string, unknown> = {};
    try {
      if (pending.inputStr) input = JSON.parse(pending.inputStr);
    } catch {
      /* empty input on parse failure */
    }
    yield { type: 'tool-call', id: pending.id, name: pending.name, input };
  }

  if (lastUsage) {
    yield {
      type: 'usage',
      inputTokens: lastUsage.prompt_tokens ?? 0,
      outputTokens: lastUsage.completion_tokens ?? 0,
    };
  }

  yield { type: 'stop', reason: signal?.aborted ? 'aborted' : 'stop' };
}
