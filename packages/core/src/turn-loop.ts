import fs from 'node:fs';
import { EventBus, type Event } from './event-bus.js';
import { SessionStore, type SessionInfo } from './session-store.js';
import { PermissionEngine, type ApprovalMode } from './permission.js';
import type { CurieSettings } from './settings.js';
import { createSnapshot } from './safety/snapshot.js';
import { summarizeToolInput } from './safety/tool-digest.js';
import { withOsContext, withMessageTimestamp } from './context.js';
import {
  resolveBudget, estimateRequestTokens, breakdownChars, fillPct, classify, calibrate,
  formatTokens, DEFAULT_CALIBRATION,
} from './context-budget.js';
import { compactMessages, buildSummaryMessage } from './compaction.js';

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'max' | 'auto';

export interface CancelableIterable<T> {
  iterable: AsyncIterable<T>;
  cancel(): void;
}

export interface ProviderStream {
  name: string;
  stream(args: {
    messages: Array<{ role: string; content: unknown }>;
    tools?: Array<{ name: string; description: string; inputSchema: unknown }>;
    model?: string;
    system?: string;
    signal?: AbortSignal;
    effort?: ReasoningEffort;
    maxTokens?: number;
    sessionId?: string;
  }): CancelableIterable<ProviderEvent>;
  /**
   * Non-streaming call — used for quick evaluations (harm-check) and for
   * writing compaction summaries. `maxTokens` matters for the latter: the
   * adapters' built-in defaults are sized for one-word harm verdicts.
   */
  check(prompt: string, args?: { model?: string; system?: string; signal?: AbortSignal; maxTokens?: number }): Promise<string>;
}

export interface Tool {
  definition: { name: string; description: string; inputSchema: unknown };
  execute: (input: Record<string, unknown>, settings: any, cwd?: string, sessionId?: string) => Promise<{ output: unknown; error?: string; clientOutput?: unknown }>;
}

export type ProviderEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'thinking-delta'; text: string }
  | { type: 'thinking-block'; thinking: string; signature: string }
  | { type: 'tool-call'; id: string; name: string; input: Record<string, unknown>; thoughtSignature?: string }
  | { type: 'tool-result-request'; callId: string }
  /** `inputTokens` is the TOTAL prompt size including cached tokens; cache fields are subsets. */
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
  | { type: 'stop'; reason: string; errorDetail?: string };

export interface TurnLoopConfig {
  provider: ProviderStream;
  model: string;
  tools: Tool[];
  cwd: string;
  settings: CurieSettings;
  approvalMode?: ApprovalMode;
  permissions?: Record<string, string[]>;
  maxTurns?: number;
  system?: string;
  effort?: ReasoningEffort;
  /** If provided, resume this session instead of creating a new one. */
  sessionId?: string;
  /** If true and sessionId is not set, find the most recent session to resume. */
  resume?: boolean;
  /** If set, use this session ID for resume (overrides channel session). */
  resumeSessionId?: string;
  /** Called when a tool call needs interactive approval. Return true to allow, false to deny. */
  onApprovalAsk?: (req: { toolCallId?: string; name: string; input: Record<string, unknown>; reason: string }) => Promise<boolean>;
  /** Optional session type / entrypoint (e.g. webui, tui, telegram, heartbeat) */
  type?: string;
}

export interface TurnLoopResult {
  events: Event[];
  sessionId: string;
  reason: string;
}

export type AssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'tool-use'; id: string; name: string; input: Record<string, unknown>; thoughtSignature?: string };

export type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: AssistantBlock[] }
  | { role: 'tool'; toolUseId: string; toolName?: string; content: string };

// The provider's stream() returns a CancelableIterable with a cancel() method
// that synchronously aborts the underlying HTTP connection (e.g., Anthropic's
// stream.abort()). The TurnLoop wires this cancel() to the AbortSignal's abort
// event so pressing Esc closes the stream immediately instead of waiting for
// the next SSE event from the server.

// Brief delay to let WebSocket events flush to clients between approval requests.
const approvalThrottleMs = 50;

/**
 * Ceiling on mid-run compactions. If a fresh summary plus the protected tail is
 * still over budget, the history is not the problem and looping would just burn
 * summarizer calls — fall through to the hard abort.
 */
const MAX_COMPACTIONS_PER_RUN = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rebuild the provider message array from a session's persisted events.
 *
 * Module-level so the daemon can compact an idle session without instantiating
 * a TurnLoop — one implementation, so live and out-of-band paths cannot drift.
 */
export function reconstructMessagesFromEvents(allEvents: Event[]): Message[] {
  const messages: Message[] = [];

  // Compaction is append-only: the full log stays on disk for the UI and for
  // audit, but the model only carries history from the last marker forward,
  // seeded by that marker's summary.
  let events = allEvents;
  let seededFromCompaction = false;
  for (let i = allEvents.length - 1; i >= 0; i--) {
    const e = allEvents[i];
    if (e?.type === 'compaction') {
      messages.push(buildSummaryMessage(e.summary, e.timestamp));
      events = allEvents.slice(i + 1);
      seededFromCompaction = true;
      break;
    }
  }

  let currentTurn = {
    assistantDeltas: [] as string[],
    thinkingDeltas: [] as string[],
    toolCalls: [] as Array<{ toolCallId: string; name: string; input: Record<string, unknown>; thoughtSignature?: string }>,
    toolResults: [] as Array<{ toolCallId: string; output: unknown }>,
  };
  // The summary message stands in for the user turn a mid-run compaction has
  // no counterpart for, so the assistant events that follow it are replayed.
  let hasActiveTurn = seededFromCompaction;

  for (const event of events) {
    if (event.type === 'user-prompt') {
      if (hasActiveTurn) {
        messages.push(...buildTurnMessages(currentTurn));
      }
      messages.push({ role: 'user', content: withMessageTimestamp(event.text, event.timestamp) });
      currentTurn = { assistantDeltas: [], thinkingDeltas: [], toolCalls: [], toolResults: [] };
      hasActiveTurn = true;
      continue;
    }
    if (!hasActiveTurn) continue;

    if (event.type === 'assistant-delta') {
      currentTurn.assistantDeltas.push(event.text);
    } else if (event.type === 'thinking-delta') {
      currentTurn.thinkingDeltas.push(event.text);
    } else if (event.type === 'tool-call') {
      currentTurn.toolCalls.push({ toolCallId: event.toolCallId, name: event.name, input: event.input, thoughtSignature: event.thoughtSignature });
    } else if (event.type === 'tool-result') {
      currentTurn.toolResults.push({ toolCallId: event.toolCallId, output: event.output });
    }
  }
  if (hasActiveTurn) {
    messages.push(...buildTurnMessages(currentTurn));
  }

  return messages;
}

function buildTurnMessages(turn: {
  assistantDeltas: string[];
  thinkingDeltas: string[];
  toolCalls: Array<{ toolCallId: string; name: string; input: Record<string, unknown>; thoughtSignature?: string }>;
  toolResults: Array<{ toolCallId: string; output: unknown }>;
}): Message[] {
  const msgs: Message[] = [];

  // Assistant message: text blocks + tool-use blocks.
  //
  // Deltas are joined into ONE block per kind. Pushing one block per persisted
  // delta turned a resumed session into hundreds of five-character blocks —
  // pure JSON overhead on every subsequent request.
  //
  // Thinking is dropped entirely on replay: signatures are not persisted, and
  // Anthropic rejects unsigned thinking blocks. Reconstructed thinking has no
  // value to the model anyway; the text and tool calls it produced are kept.
  const assistantBlocks: AssistantBlock[] = [];
  const text = turn.assistantDeltas.join('');
  if (text) {
    assistantBlocks.push({ type: 'text', text });
  }
  for (const tc of turn.toolCalls) {
    assistantBlocks.push({ type: 'tool-use', id: tc.toolCallId, name: tc.name, input: tc.input, thoughtSignature: tc.thoughtSignature });
  }
  if (assistantBlocks.length > 0) {
    msgs.push({ role: 'assistant', content: assistantBlocks });
  }

  // Tool messages
  for (const tr of turn.toolResults) {
    const tc = turn.toolCalls.find(c => c.toolCallId === tr.toolCallId);
    if (tc) {
      const content = typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output);
      msgs.push({ role: 'tool', toolUseId: tc.toolCallId, toolName: tc.name, content });
    }
  }

  return msgs;
}

export class TurnLoop {
  private bus: EventBus;
  private store: SessionStore;
  private permission: PermissionEngine;
  private config: TurnLoopConfig;
  private _cwd: string;
  private abort = false;
  private abortController: AbortController | null = null;
  private messages: Message[] = [];
  private activeSessionId: string | undefined;
  private recoveredTurns: number = 0;
  /**
   * Learned chars-per-token for this session. Seeded at the English default and
   * corrected from every real `usage` report — a Polish or CJK transcript runs
   * well under 4 chars/token, which is how a run can be estimated at half its
   * true size and sail past the gate.
   */
  private calibration: number = DEFAULT_CALIBRATION;
  /** Characters in the last request sent, used to calibrate against its usage report. */
  private lastRequestChars = 0;

  constructor(config: TurnLoopConfig, store?: SessionStore) {
    this.config = config;
    this._cwd = config.cwd;
    this.bus = new EventBus();
    this.store = store ?? new SessionStore();
    this.permission = new PermissionEngine(config.permissions, config.approvalMode ?? 'auto');
  }

  get eventBus(): EventBus {
    return this.bus;
  }

  get sessionStore(): SessionStore {
    return this.store;
  }

  getSessionId(): string | undefined {
    return this.activeSessionId || this.config.sessionId || undefined;
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  cancel(): void {
    this.abort = true;
    this.abortController?.abort();
  }

  setCwd(newCwd: string): void {
    this._cwd = newCwd;
  }

 private async evaluateHarm(toolName: string, input: Record<string, unknown>): Promise<{ approved: boolean; reason: string }> {
    // Local/Ollama providers run on a single-threaded server. Firing check()
    // re-entrantly while the main stream is in-flight serializes both requests
    // and causes llama.cpp to appear hung. Thinking models (qwen3.x, deepseek-r1,
    // etc.) also never emit a clean APPROVE/DENY token, so the harm-check always
    // times out against these models anyway.
    if (['local', 'ollama'].includes(this.config.provider.name)) {
      return { approved: true, reason: 'local provider: LLM harm-check skipped' };
    }

    const systemPrompt = 'You are a safety evaluator. Given a tool call, determine if it is potentially harmful to the user\'s system. Harmful means: deleting files, executing arbitrary shell commands, sending data to external services, modifying system configuration, or any action that could cause data loss or security compromise. Long argument values are abbreviated — a value ending in `…[N chars total]` shows only its opening characters. Judge the action and its target from what you are given; never ask for the full value. Your response must be exactly one of these two strings: APPROVE or DENY. Do not add any other text.';
    const prompt = `Evaluate this tool call:\n${summarizeToolInput(toolName, input)}`;

    try {
      // Use an AbortController so the HTTP request itself is cancelled on timeout,
      // not just the Promise.race outcome — prevents zombie requests from queuing.
      const abortCtrl = new AbortController();
      const timeoutId = setTimeout(() => abortCtrl.abort(new Error('harm-check timeout')), 15_000);
      try {
        const response = await this.config.provider.check(
          prompt,
          { model: this.config.model, system: systemPrompt, signal: abortCtrl.signal },
        );
        const decision = response.trim().toUpperCase();
        if (decision === 'APPROVE') {
          return { approved: true, reason: `LLM harm-check: APPROVE` };
        }
        return { approved: false, reason: `LLM harm-check: DENY — ${response.trim()}` };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      // If LLM check fails or times out, deny for safety
      return { approved: false, reason: 'LLM harm-check failed — denied' };
    }
  }

  private reconstructMessages(allEvents: Event[]): Message[] {
    return reconstructMessagesFromEvents(allEvents);
  }

  async run(prompt: string): Promise<TurnLoopResult> {
    // Resolve the effective session ID:
    // 1. Explicit resumeSessionId (from CLI: curie-agent resume <id>)
    // 2. Channel sessionId (persisted per-channel session)
    // 3. Most recent session (from CLI: curie-agent resume)
    const effectiveSessionId = this.config.resumeSessionId
      ?? this.config.sessionId
      ?? (this.config.resume ? this.store.list()[0]?.id : undefined);

    let session: SessionInfo;
    if (effectiveSessionId) {
      const loaded = this.store.load(effectiveSessionId);
      if (loaded) {
        session = loaded;
        if (this.config.type && !session.type) {
          session.type = this.config.type;
          try {
            fs.writeFileSync(this.store.metadataPath(session.id), JSON.stringify(session, null, 2) + '\n');
          } catch {}
        }
      } else {
        // Session ID was provided but doesn't exist on disk yet
        // (e.g. ChannelRouter generates a placeholder before TurnLoop creates it)
        session = this.store.create(
          this.config.cwd,
          this.config.model,
          this.config.provider.name,
          this.config.type,
        );
        this.activeSessionId = session.id;
      }
    } else {
      session = this.store.create(
        this.config.cwd,
        this.config.model,
        this.config.provider.name,
        this.config.type,
      );
    }
    this.activeSessionId ??= session.id;

    // Resume: load stored events and reconstruct messages array
    if (effectiveSessionId) {
      const storedEvents = this.store.loadEvents(effectiveSessionId);
      const reconstructed = this.reconstructMessages(storedEvents);
      this.messages = reconstructed;
      this.recoveredTurns = reconstructed.filter(m => m.role !== 'user').length;
      if (this.recoveredTurns > 0) {
        this.bus.emit({ type: 'session-resumed', id: session.id, turnsRecovered: this.recoveredTurns, timestamp: Date.now() });
      }
    }

    const websearchTools = new Set(['WebSearch', 'WebFetch']);

    const emit = (e: Event) => {
      this.bus.emit(e);
      this.store.appendEvent(session.id, e);
    };

    this.abort = false;
    this.abortController = new AbortController();
    emit({ type: 'session-start', id: session.id, model: this.config.model, provider: this.config.provider.name, cwd: this.config.cwd, timestamp: Date.now() });
    const promptTs = Date.now();
    emit({ type: 'user-prompt', id: session.id, text: prompt, cwd: this.config.cwd, timestamp: promptTs });

    this.messages.push({ role: 'user', content: withMessageTimestamp(prompt, promptTs) });
    let turn = 0;
    const maxTurns = this.config.maxTurns ?? 50;
    let continuationCount = 0;
    const maxContinuations = 5;

    // Run-scoped state. The tool counters below are per-turn; these bound the
    // whole run, which is what a 50-turn research loop actually needs.
    let compactionsThisRun = 0;
    let runToolCalls = 0;
    let runWebsearchCalls = 0;
    const advisoriesEmitted = new Set<string>();
    /** Emit a context advisory at most once per run — a 50-turn run should not repeat it 50 times. */
    const emitOnce = (key: string, message: string) => {
      if (advisoriesEmitted.has(key)) return;
      advisoriesEmitted.add(key);
      emit({ type: 'context-warning', id: session.id, message, timestamp: Date.now() });
    };

    try {
      while (turn < maxTurns && !this.abort) {
        turn++;
        if (process.env.DEBUG_PROVIDER) {
          console.log(`[turn-loop] turn=${turn}, messages.length=${this.messages.length}`);
        }

        // Create git snapshot before each turn (best-effort).
        if (this.config.settings.safety?.snapshots !== 'off') {
          await createSnapshot(this._cwd, prompt).catch(() => {
            // Silently ignore — snapshots are recovery, not enforcement
          });
        }

        let fullText = '';
        let hitLengthLimit = false;
        const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown>; thoughtSignature?: string }> = [];
        let totalToolCalls = 0;
        let websearchToolCalls = 0;
        const thinkingBlocks: Array<{ thinking: string; signature: string }> = [];

        // Local providers (Ollama, llama.cpp) don't support Anthropic thinking blocks.
        // Strip thinking blocks from message history to avoid serialization errors.
        const self = this;
        const isLocal = ['local', 'ollama'].includes(self.config.provider.name);
        const streamMessages = isLocal
          ? self.messages.map((m) => {
              if (m.role === 'assistant' && Array.isArray(m.content)) {
                return { ...m, content: m.content.filter((b) => b.type !== 'thinking') };
              }
              return m;
            })
          : self.messages;

        // Capture abortController before the loop — it's always set by this point.
        const abortCtrl = self.abortController as AbortController;

        // Pre-flight budget check. Runs before EVERY provider call, so a single
        // long run is governed the same way a multi-prompt conversation is —
        // the previous design only checked between user prompts, which is why a
        // 50-turn research run could grow unbounded and then hard-abort.
        {
          const budget = resolveBudget(self.config.settings);
          const toolDefinitions = self.config.tools.map((t) => t.definition);
          const parts = breakdownChars({ system: self.config.system, messages: streamMessages, toolDefinitions });
          self.lastRequestChars = parts.system + parts.toolDefinitions + parts.conversation + parts.toolResults;

          const estimated = estimateRequestTokens({
            system: self.config.system, messages: streamMessages, toolDefinitions, calibration: self.calibration,
          });
          const pct = fillPct(estimated, budget);
          const autoCompact = self.config.settings.auto_compact;
          const status = classify(pct, autoCompact);

          // Bus only, not persisted: this fires before every provider call, so
          // appending it would add one JSONL line per turn of pure telemetry.
          // The `compaction` marker below IS persisted — replay depends on it.
          self.bus.emit({
            type: 'context-report', id: session.id, model: self.config.model,
            windowTokens: budget.windowTokens, usedTokens: estimated, reservedOutput: budget.reservedOutput,
            breakdown: [
              { label: 'System prompt', tokens: Math.ceil(parts.system / self.calibration) },
              { label: 'Tool definitions', tokens: Math.ceil(parts.toolDefinitions / self.calibration) },
              { label: 'Conversation', tokens: Math.ceil(parts.conversation / self.calibration) },
              { label: 'Tool results', tokens: Math.ceil(parts.toolResults / self.calibration) },
            ],
            timestamp: Date.now(),
          });

          if (status === 'forced' && compactionsThisRun < MAX_COMPACTIONS_PER_RUN) {
            compactionsThisRun++;
            emit({ type: 'status', id: session.id, message: `Context ${String(pct)}% full — compacting conversation…`, timestamp: Date.now() });
            try {
              const result = await compactMessages({
                messages: self.messages,
                provider: self.config.provider,
                model: autoCompact?.model || self.config.model,
                budget,
                calibration: self.calibration,
                signal: self.abortController?.signal,
              });
              const compactionTs = Date.now();
              self.messages = [buildSummaryMessage(result.summary, compactionTs), ...result.keptMessages];
              emit({
                type: 'compaction', id: session.id, summary: result.summary,
                summarizedMessageCount: result.summarizedMessageCount,
                tokensBefore: result.estimatedTokensBefore, tokensAfter: result.estimatedTokensAfter,
                timestamp: compactionTs,
              });
              // Re-estimate against the compacted history before sending anything.
              turn--;
              continue;
            } catch (err) {
              // Fall through to the hard abort below — compaction failing is not
              // a reason to send a request we know is over budget.
              emit({ type: 'status', id: session.id, timestamp: Date.now(), message:
                `Compaction failed: ${err instanceof Error ? err.message : String(err)}` });
            }
          }

          if (estimated > budget.usableTokens) {
            emit({ type: 'error', id: session.id, timestamp: Date.now(), message:
              `Estimated input (~${formatTokens(estimated)} tokens) would exceed the usable context ` +
              `(${formatTokens(budget.usableTokens)} of a ${formatTokens(budget.windowTokens)} window, ` +
              `${formatTokens(budget.reservedOutput)} reserved for output) for provider ` +
              `"${self.config.settings.current_provider}"` +
              (compactionsThisRun > 0 ? ` — still over budget after ${String(compactionsThisRun)} compaction(s).` : '.') +
              ` Run /context compact, or switch to a model with a larger context window.` });
            emit({ type: 'session-stop', id: session.id, reason: 'error', timestamp: Date.now() });
            return { events: self.bus.history(), sessionId: session.id, reason: 'error' };
          }

          if (status === 'suggest') {
            emitOnce('suggest', `Context ${String(pct)}% full — run \`/context compact\` to summarize history.`);
          } else if (status === 'warn') {
            emitOnce('warn', `Context ${String(pct)}% full.`);
          }
        }

        // Start the provider stream and capture its cancel function.
        // The cancel() method synchronously aborts the underlying HTTP connection
        // (e.g., Anthropic's stream.abort()), making Esc feel instantaneous.
        const maxTokens = self.config.settings.providers[self.config.settings.current_provider]?.max_output_tokens;
        const cancelable = self.config.provider.stream({
          messages: streamMessages as any,
          tools: self.config.tools.map((t) => t.definition),
          model: self.config.model,
          system: withOsContext(self.config.system),
          signal: abortCtrl.signal,
          effort: self.config.effort,
          maxTokens,
          sessionId: session.id,
        });

        // Wire the AbortSignal's abort event to cancel the stream immediately.
        // This is what makes Esc feel instant — it calls stream.abort() on the
        // underlying HTTP connection instead of waiting for the next SSE event.
        abortCtrl.signal.addEventListener('abort', () => {
          cancelable.cancel();
        }, { once: true });

        try {
          for await (const event of cancelable.iterable) {
            if (self.abort) break;

            switch (event.type) {
              case 'text-delta':
                fullText += event.text;
                emit({ type: 'assistant-delta', id: session.id, text: event.text, timestamp: Date.now() });
                break;

              case 'thinking-delta':
                emit({ type: 'thinking-delta', id: session.id, text: event.text, timestamp: Date.now() });
                break;

              case 'thinking-block':
                thinkingBlocks.push({ thinking: event.thinking, signature: event.signature });
                break;

              case 'tool-call':
                toolCalls.push({ id: event.id, name: event.name, input: event.input, thoughtSignature: event.thoughtSignature });
                emit({ type: 'tool-call', id: session.id, toolCallId: event.id, name: event.name, input: event.input, thoughtSignature: event.thoughtSignature, timestamp: Date.now() });
                break;

              case 'usage':
                // Correct the chars-per-token ratio against ground truth, so the
                // next pre-flight estimate reflects this conversation's actual
                // tokenizer density rather than an English-prose assumption.
                if (self.lastRequestChars > 0 && event.inputTokens > 0) {
                  self.calibration = calibrate(self.lastRequestChars, event.inputTokens);
                }
                emit({ type: 'usage', id: session.id, inputTokens: event.inputTokens, outputTokens: event.outputTokens, cacheReadTokens: event.cacheReadTokens, cacheWriteTokens: event.cacheWriteTokens, timestamp: Date.now() });
                break;

              case 'stop':
                if (event.reason === 'error' && event.errorDetail) {
                  const isCtxExceeded = /exceeds.*context|context.*size|too many tokens/i.test(event.errorDetail);
                  emit({ type: 'error', id: session.id, timestamp: Date.now(), message: isCtxExceeded
                    ? `Context window exceeded: ${event.errorDetail}. Run /context compact to summarize history, or switch to a model with a larger context window.`
                    : `Provider stream error: ${event.errorDetail}. This can happen with incompatible local model endpoints or network issues.`
                  });
                } else if (event.reason === 'aborted' && !self.abort) {
                  // Provider timeout (not user-initiated) — surface it
                  emit({ type: 'status', id: session.id, message:
                    'Provider request timed out. The local model may be too slow or overloaded.',
                    timestamp: Date.now(),
                  });
                } else if (event.reason === 'length') {
                  hitLengthLimit = true;
                  emit({ type: 'status', id: session.id, message:
                    'Model hit output token limit. Continuing...',
                    timestamp: Date.now(),
                  });
                }
                break;
            }
          }
        } catch (err: unknown) {
          // If we're cancelling via abort (Esc pressed), the provider's stream
          // may throw due to the closed HTTP connection — fall through to
          // the this.abort check below for clean cancellation handling.
          if (this.abort) {
            // Cancellation caused the error — handled below.
          } else {
            const status = (err as any)?.status ?? (err as any)?.response?.status;
            const msg = err instanceof Error ? err.message : String(err);
            if (status === 413) {
              emit({ type: 'error', id: session.id, message:
                `Provider returned 413 (Request Entity Too Large). The system prompt + messages exceed the local model's context window. Try: reduce AGENTS.md size, or use a larger local model. (Original: ${msg})`,
                timestamp: Date.now(),
              });
              emit({ type: 'session-stop', id: session.id, reason: 'error', timestamp: Date.now() });
              return { events: self.bus.history(), sessionId: session.id, reason: 'error' };
            }
 if (msg.includes('invalid string length') || msg.includes('INVALID_LENGTH')) {
              emit({ type: 'error', id: session.id, message:
                `Provider returned "invalid string length" — the local model's response format is incompatible with the Anthropic SDK. This usually means the model doesn't fully implement the Anthropic API. Try: use a model that supports the Anthropic Messages API (e.g. llama-3.1), or switch to OpenAI-compatible provider with correct model names. (Original: ${msg})`,
                timestamp: Date.now(),
              });
              emit({ type: 'session-stop', id: session.id, reason: 'error', timestamp: Date.now() });
              return { events: self.bus.history(), sessionId: session.id, reason: 'error' };
            }

            // Connection errors: server unreachable, connection reset, refused
            const connErrors = ['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'fetch failed'];
            if (connErrors.some(e => msg.includes(e))) {
              emit({ type: 'error', id: session.id, message:
                `Provider connection error: ${msg}. Check that the local model server is running and reachable at the configured URL.`,
                timestamp: Date.now(),
              });
              emit({ type: 'session-stop', id: session.id, reason: 'error', timestamp: Date.now() });
              return { events: self.bus.history(), sessionId: session.id, reason: 'error' };
            }

            throw err;
          }
        }

        if (this.abort) {
          emit({ type: 'assistant-stop', id: session.id, timestamp: Date.now() });
          emit({ type: 'session-stop', id: session.id, reason: 'cancelled', timestamp: Date.now() });
          return { events: this.bus.history(), sessionId: session.id, reason: 'cancelled' };
        }

        if (process.env.DEBUG_PROVIDER) {
          console.log(`[turn-loop] turn=${turn} stream done: textLen=${fullText.length}, toolCalls=${toolCalls.length}, thinkingBlocks=${thinkingBlocks.length}`);
        }

        // Build assistant message: thinking blocks MUST come first (Anthropic
        // requires them preserved when extended thinking + tool use is combined),
        // then text, then tool-use blocks.
        const assistantContent: AssistantBlock[] = [];
        for (const tb of thinkingBlocks) {
          assistantContent.push({ type: 'thinking', thinking: tb.thinking, signature: tb.signature });
        }
        if (fullText) assistantContent.push({ type: 'text', text: fullText });
        for (const tc of toolCalls) {
          assistantContent.push({ type: 'tool-use', id: tc.id, name: tc.name, input: tc.input, thoughtSignature: tc.thoughtSignature });
        }
        if (assistantContent.length > 0) {
          this.messages.push({ role: 'assistant', content: assistantContent });
        }

        // Hit output token limit without tool calls — tell model to continue
        if (hitLengthLimit && toolCalls.length === 0) {
          if (continuationCount >= maxContinuations) {
            emit({ type: 'status', id: session.id, message:
              `Output length limit reached. Model could not complete response after ${maxContinuations} continuation attempts.`,
              timestamp: Date.now() });
          } else {
            continuationCount++;
            this.messages.push({ role: 'user', content: '[continue — your previous response was cut off by the output token limit. If you were about to call Write with a large content parameter, use the skeleton+Edit approach: first Write a skeleton file with section headers and [PLACEHOLDER] markers, then fill each section with a separate Edit call.]' });
            continue;
          }
        }

        if (toolCalls.length === 0) {
          if (!fullText && thinkingBlocks.length === 0) {
            emit({ type: 'status', id: session.id, message:
              'The model did not return a response. This can happen with incompatible models or configuration issues.',
              timestamp: Date.now() });
          }
          emit({ type: 'assistant-stop', id: session.id, timestamp: Date.now() });
          emit({ type: 'session-stop', id: session.id, reason: 'stop', timestamp: Date.now() });
          return { events: this.bus.history(), sessionId: session.id, reason: 'stop' };
        }

        for (const tc of toolCalls) {
          if (this.abort) break;

          // --- Tool usage limits ---
          // Per-turn caps bound one model response; per-run caps bound the whole
          // `run()`. Without the latter, `maxTurns` 50 x `tools_per_call` 10 is
          // 500 tool calls in a single user turn with nothing to stop it.
          const totalLimit = this.config.settings.tools_per_call ?? 10;
          const websearchLimit = this.config.settings.websearch_per_call ?? 5;
          const runToolLimit = this.config.settings.tools_per_run ?? 200;
          const runWebsearchLimit = this.config.settings.websearch_per_run ?? 60;

          /** Skip this call and every one after it in the batch, telling the model why. */
          const skipRemaining = (msg: string) => {
            emit({ type: 'status', id: session.id, message: msg, timestamp: Date.now() });
            for (const remaining of toolCalls.slice(toolCalls.indexOf(tc))) {
              this.messages.push({ role: 'tool', toolUseId: remaining.id, toolName: remaining.name, content: `Skipped: ${msg}` });
              emit({ type: 'tool-result', id: session.id, toolCallId: remaining.id, output: null, error: msg, timestamp: Date.now() });
            }
          };

          if (totalToolCalls >= totalLimit) {
            skipRemaining(`Tool call limit reached (${String(totalLimit)} per turn). Skipping remaining tool call(s).`);
            break;
          }

          if (runToolCalls >= runToolLimit) {
            skipRemaining(`Tool call limit reached (${String(runToolLimit)} for this run). Wrap up and summarize what you have.`);
            break;
          }

          if (websearchTools.has(tc.name) && websearchToolCalls >= websearchLimit) {
            skipRemaining(`WebSearch/WebFetch limit reached (${String(websearchLimit)} per turn). Skipping remaining tool call(s).`);
            break;
          }

          if (websearchTools.has(tc.name) && runWebsearchCalls >= runWebsearchLimit) {
            skipRemaining(`WebSearch/WebFetch limit reached (${String(runWebsearchLimit)} for this run). Wrap up with the sources you have.`);
            break;
          }
          // --- End tool usage limits ---

          const permResult = this.permission.check(tc.name, tc.input);

          emit({
            type: 'approval-request',
            id: session.id,
            toolCallId: tc.id,
            name: tc.name,
            input: tc.input,
            decision: permResult.decision,
            mode: this.permission.mode,
            timestamp: Date.now(),
          });

          // Yield briefly so WebSocket events flush to clients before processing the next tool.
          await sleep(approvalThrottleMs);

          if (permResult.decision === 'deny') {
            emit({ type: 'approval-decision', id: session.id, toolCallId: tc.id, decision: 'deny', timestamp: Date.now() });
            this.messages.push({ role: 'tool', toolUseId: tc.id, toolName: tc.name, content: `Tool call denied: ${permResult.reason}` });
            continue;
          }

          // Track approval status for display in tool result messages.
          let toolApproved = true;
          let toolDecisionBy: 'auto' | 'llm' | 'user' = 'auto';

          if (permResult.decision === 'ask') {
            const ask = this.config.onApprovalAsk;

            // In auto mode: evaluate harm with LLM before asking user.
            let approved = false;
            let decisionBy: 'llm' | 'user' = 'user';
            if (this.permission['mode'] === 'auto' && ask) {
              const harm = await this.evaluateHarm(tc.name, tc.input);
              if (harm.approved) {
                approved = true;
                decisionBy = 'llm';
              } else {
                // LLM denied — ask user for final decision
                approved = await ask({ toolCallId: tc.id, name: tc.name, input: tc.input, reason: harm.reason });
                decisionBy = 'user';
              }
            } else {
              approved = ask
                ? await ask({ toolCallId: tc.id, name: tc.name, input: tc.input, reason: permResult.reason })
                : true; // no callback wired — treat as allow to preserve old behavior
              decisionBy = approved ? 'user' : 'user';
            }

            emit({
              type: 'approval-decision',
              id: session.id,
              toolCallId: tc.id,
              decision: approved ? 'allow' : 'deny',
              by: decisionBy,
              timestamp: Date.now(),
            });
            if (!approved) {
              this.messages.push({ role: 'tool', toolUseId: tc.id, toolName: tc.name, content: decisionBy === 'llm' ? `Tool call denied by LLM harm-check: ${tc.name}` : 'Tool call denied by user.' });
              continue;
            }
            toolApproved = approved;
            toolDecisionBy = decisionBy === 'llm' ? 'llm' : 'user';
          }

          totalToolCalls++;
          runToolCalls++;
          if (websearchTools.has(tc.name)) {
            websearchToolCalls++;
            runWebsearchCalls++;
          }

          const tool = this.config.tools.find((t) => t.definition.name === tc.name);
          if (!tool) {
            const available = this.config.tools.map((t) => t.definition.name).join(', ');
            const unknownMsg = `Unknown tool: ${tc.name}. Available tools: ${available}`;
            emit({ type: 'tool-result', id: session.id, toolCallId: tc.id, output: null, error: unknownMsg, timestamp: Date.now() });
            this.messages.push({ role: 'tool', toolUseId: tc.id, toolName: tc.name, content: unknownMsg });
            continue;
          }

          try {
            const result = await tool.execute(tc.input, this.config.settings, this.config.cwd, this.config.sessionId);
            emit({ type: 'tool-result', id: session.id, toolCallId: tc.id, output: result.clientOutput ?? result.output, error: result.error, timestamp: Date.now() });
            const outputStr = result.error ? `Error: ${result.error}` : (typeof result.output === 'string' ? result.output : JSON.stringify(result.output));
            this.messages.push({ role: 'tool', toolUseId: tc.id, toolName: tc.name, content: outputStr });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            emit({ type: 'tool-result', id: session.id, toolCallId: tc.id, output: null, error: msg, timestamp: Date.now() });
            this.messages.push({ role: 'tool', toolUseId: tc.id, toolName: tc.name, content: `Error: ${msg}` });
          }
        }
      }

      emit({ type: 'assistant-stop', id: session.id, timestamp: Date.now() });
      emit({ type: 'session-stop', id: session.id, reason: 'max-turns', timestamp: Date.now() });
      return { events: this.bus.history(), sessionId: session.id, reason: 'max-turns' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ type: 'error', id: session.id, message: msg, timestamp: Date.now() });
      emit({ type: 'session-stop', id: session.id, reason: 'error', timestamp: Date.now() });
      return { events: this.bus.history(), sessionId: session.id, reason: 'error' };
    }
  }
}
