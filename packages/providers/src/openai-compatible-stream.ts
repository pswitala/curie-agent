import type OpenAI from 'openai';
import type { ProviderEvent } from './provider.js';

/**
 * Stream consumer for any OpenAI Chat Completions-compatible endpoint
 * (OpenAI standard models, Ollama, llama.cpp, vLLM, etc.).
 *
 * Behavior matches the OpenRouter reference: tool calls are buffered
 * during the stream and emitted as a single batch after it completes,
 * so the TUI renders them as one grouped block. <think>...</think>
 * tags and gemma4-style <|channel>thought\n...<channel|> blocks inside
 * content deltas are routed to thinking-delta events; accumulated
 * thinking is flushed as a single thinking-block at end.
 */
export async function* streamOpenAICompatible(
  client: OpenAI,
  streamParams: OpenAI.ChatCompletionCreateParams,
  signal?: AbortSignal,
  options?: { suppressThinking?: boolean },
): AsyncIterable<ProviderEvent> {
  const suppressThinking = options?.suppressThinking ?? false;
  const sdkStream = (await client.chat.completions.create(streamParams)) as AsyncIterable<OpenAI.ChatCompletionChunk>;

  const pendingTools = new Map<number, { id: string; name: string; inputStr: string }>();
  let lastUsage: OpenAI.CompletionUsage | null = null;
  let inThinkBlock = false;
  let accumulatedThinking = '';

  // Gemma4 thinking open tag: <|channel>thought\n  close tag: <channel|>
  const GEMMA_OPEN = '<|channel>thought\n';
  const GEMMA_CLOSE = '<channel|>';

  for await (const chunk of sdkStream) {
    if (signal?.aborted) break;

    if (chunk.usage) lastUsage = chunk.usage;

    const choice = chunk.choices?.[0];
    if (!choice) continue;

    if (choice.delta?.content && typeof choice.delta.content === 'string') {
      // Process content through a position cursor so both tag formats share one state machine.
      let remaining = choice.delta.content;

      while (remaining.length > 0) {
        if (!inThinkBlock) {
          // Detect whichever opening tag appears first.
          const thinkIdx = remaining.indexOf('<think>');
          const gemmaIdx = remaining.indexOf(GEMMA_OPEN);

          let openIdx = -1;
          let openTag = '';
          if (thinkIdx !== -1 && (gemmaIdx === -1 || thinkIdx <= gemmaIdx)) {
            openIdx = thinkIdx;
            openTag = '<think>';
          } else if (gemmaIdx !== -1) {
            openIdx = gemmaIdx;
            openTag = GEMMA_OPEN;
          }

          if (openIdx === -1) {
            // No opening tag — plain text.
            yield { type: 'text-delta', text: remaining };
            remaining = '';
          } else {
            if (openIdx > 0) yield { type: 'text-delta', text: remaining.slice(0, openIdx) };
            inThinkBlock = true;
            remaining = remaining.slice(openIdx + openTag.length);
          }
        } else {
          // Inside a think block — look for either close tag.
          const closeTag = remaining.includes('</think>') && (!remaining.includes(GEMMA_CLOSE) || remaining.indexOf('</think>') <= remaining.indexOf(GEMMA_CLOSE))
            ? '</think>'
            : remaining.includes(GEMMA_CLOSE)
            ? GEMMA_CLOSE
            : null;

          const closeIdx = closeTag !== null ? remaining.indexOf(closeTag) : -1;

          if (closeIdx === -1) {
            // Still inside think block — no close tag yet.
            if (!suppressThinking) yield { type: 'thinking-delta', text: remaining };
            accumulatedThinking += remaining;
            remaining = '';
          } else {
            const thinkText = remaining.slice(0, closeIdx);
            if (!suppressThinking) yield { type: 'thinking-delta', text: thinkText };
            accumulatedThinking += thinkText;
            inThinkBlock = false;
            remaining = remaining.slice(closeIdx + (closeTag as string).length);
          }
        }
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

  if (accumulatedThinking && !suppressThinking) {
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
