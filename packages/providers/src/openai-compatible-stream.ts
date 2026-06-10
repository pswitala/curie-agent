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
 *
 * Supports request timeout (default 60s) and catches SDK parse errors
 * mid-stream, yielding a 'stop' event rather than propagating.
 */
export async function* streamOpenAICompatible(
  client: OpenAI,
  streamParams: OpenAI.ChatCompletionCreateParams,
  signal?: AbortSignal,
  options?: {
    suppressThinking?: boolean;
    timeoutMs?: number;
    /** Called when no usage data arrived from the stream. Receives accumulated output text. */
    onNoUsage?: (outputText: string) => { inputTokens: number; outputTokens: number };
  },
): AsyncIterable<ProviderEvent> {
  const suppressThinking = options?.suppressThinking ?? false;
  const timeoutMs = options?.timeoutMs ?? 60_000;

  // Create internal abort controller: fires on user abort OR timeout.
  const abortCtrl = new AbortController();
  function forwardUserAbort() { abortCtrl.abort(); }

  // If already aborted, forward immediately (addEventListener won't fire for pre-aborted signals)
  if (signal?.aborted) {
    abortCtrl.abort();
  } else {
    signal?.addEventListener('abort', forwardUserAbort, { once: true });
  }

  const timeoutId = setTimeout(
    () => abortCtrl.abort(new Error('Provider request timeout after ' + timeoutMs + 'ms')),
    timeoutMs,
  );

  try {
    const sdkStream = (await client.chat.completions.create(streamParams)) as unknown as AsyncIterable<OpenAI.ChatCompletionChunk>;

    const pendingTools = new Map<number, { id: string; name: string; inputStr: string }>();
    let lastUsage: OpenAI.CompletionUsage | null = null;
    let finishReason: string | null = null;
    let inThinkBlock = false;
    let accumulatedThinking = '';
    let debugTextAccum = '';
    let debugToolCallCount = 0;

    const debugLog = process.env.DEBUG_PROVIDER ? (m: string) => console.log('[stream]', m) : null;

    // Gemma4 thinking open tag: <|channel>thought\n  close tag: <channel|>
    const GEMMA_OPEN = '<|channel>thought\n';
    const GEMMA_CLOSE = '<channel|>';

    try {
      for await (const chunk of sdkStream) {
        if (abortCtrl.signal.aborted) break;

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
                debugTextAccum += remaining;
                yield { type: 'text-delta', text: remaining };
                remaining = '';
              } else {
                if (openIdx > 0) {
                  debugTextAccum += remaining.slice(0, openIdx);
                  yield { type: 'text-delta', text: remaining.slice(0, openIdx) };
                }
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

        // DeepSeek v2 / Qwen 3.6+: reasoning_content streams in a separate delta field
        // (not wrapped in <thinking> tags inside content). Route directly to thinking-delta.
        const rc = (choice.delta as any)?.reasoning_content;
        if (rc) {
          if (!suppressThinking) yield { type: 'thinking-delta', text: rc };
          accumulatedThinking += rc;
        }

        if (choice.finish_reason) finishReason = choice.finish_reason;

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
      // SDK threw during SSE iteration (parse error, connection reset, etc.).
      // If it's our own abort, treat as clean stop. Otherwise surface the error.
      if (abortCtrl.signal.aborted) {
        yield { type: 'stop', reason: 'aborted' };
        return;
      }

      const err = streamErr as Error | undefined;
      const msg = err?.message ?? String(streamErr);
      const status = (streamErr as any)?.status ?? (streamErr as any)?.response?.status;
      const detail = status ? `HTTP ${status}: ${msg}` : msg;
      yield { type: 'stop', reason: 'error', errorDetail: detail };
      return;
    }

    if (accumulatedThinking && !suppressThinking) {
      yield { type: 'thinking-block', thinking: accumulatedThinking, signature: '' };
    }

    // Skip tool calls whose JSON was truncated by the output token limit —
    // emitting them with empty inputs causes retry loops in the turn loop.
    for (const [, pending] of pendingTools) {
      let input: Record<string, unknown> = {};
      let parseOk = true;
      try {
        if (pending.inputStr) input = JSON.parse(pending.inputStr);
      } catch { parseOk = false; }
      if (!parseOk && finishReason === 'length') continue;
      debugToolCallCount++;
      yield { type: 'tool-call', id: pending.id, name: pending.name, input };
    }

    // Debug summary at end of stream
    debugLog?.(`DONE: textLen=${debugTextAccum.trim().length}, toolCalls=${debugToolCallCount}, thinkingLen=${accumulatedThinking.length}`);
    if (debugTextAccum.trim().length === 0 && debugToolCallCount === 0) {
      debugLog?.('WARNING: model produced zero text and zero tool calls');
    }

    if (lastUsage) {
      yield {
        type: 'usage',
        inputTokens: lastUsage.prompt_tokens ?? 0,
        outputTokens: lastUsage.completion_tokens ?? 0,
      };
    } else if (options?.onNoUsage) {
      const estimated = options.onNoUsage(debugTextAccum.trim());
      yield { type: 'usage', inputTokens: estimated.inputTokens, outputTokens: estimated.outputTokens };
    }

    yield { type: 'stop', reason: abortCtrl.signal.aborted ? 'aborted' : (finishReason === 'length' ? 'length' : 'stop') };
  } catch (sdkErr) {
    // SDK threw during initial request (abort, connection refused, etc.)
    if (abortCtrl.signal.aborted) {
      yield { type: 'stop', reason: 'aborted' };
    } else {
      const err = sdkErr as Error | undefined;
      const msg = err?.message ?? String(sdkErr);
      const status = (sdkErr as any)?.status ?? (sdkErr as any)?.response?.status;
      const detail = status ? `HTTP ${status}: ${msg}` : msg;
      yield { type: 'stop', reason: 'error', errorDetail: detail };
    }
  } finally {
    signal?.removeEventListener('abort', forwardUserAbort);
    clearTimeout(timeoutId);
  }
}
