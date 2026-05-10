import { EventBus, type Event } from './event-bus.js';
import { SessionStore, type SessionInfo } from './session-store.js';
import { PermissionEngine, type ApprovalMode } from './permission.js';
import type { CurieSettings } from './settings.js';

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
  }): CancelableIterable<ProviderEvent>;
  /** Non-streaming call — used for quick evaluations (e.g. harm-check). */
  check(prompt: string, args?: { model?: string; system?: string }): Promise<string>;
}

export interface Tool {
  definition: { name: string; description: string; inputSchema: unknown };
  execute: (input: Record<string, unknown>, settings: any, cwd?: string) => Promise<{ output: unknown; error?: string }>;
}

export type ProviderEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'thinking-block'; thinking: string; signature: string }
  | { type: 'tool-call'; id: string; name: string; input: Record<string, unknown>; thoughtSignature?: string }
  | { type: 'tool-result-request'; callId: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
  | { type: 'stop'; reason: string };

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
  onApprovalAsk?: (req: { name: string; input: Record<string, unknown>; reason: string }) => Promise<boolean>;
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
  | { role: 'tool'; toolUseId: string; content: string };

// The provider's stream() returns a CancelableIterable with a cancel() method
// that synchronously aborts the underlying HTTP connection (e.g., Anthropic's
// stream.abort()). The TurnLoop wires this cancel() to the AbortSignal's abort
// event so pressing Esc closes the stream immediately instead of waiting for
// the next SSE event from the server.

export class TurnLoop {
  private bus: EventBus;
  private store: SessionStore;
  private permission: PermissionEngine;
  private config: TurnLoopConfig;
  private abort = false;
  private abortController: AbortController | null = null;
  private messages: Message[] = [];
  private activeSessionId: string | undefined;
  private recoveredTurns: number = 0;

  constructor(config: TurnLoopConfig, store?: SessionStore) {
    this.config = config;
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

  private async evaluateHarm(toolName: string, input: Record<string, unknown>): Promise<{ approved: boolean; reason: string }> {
    const inputJson = JSON.stringify(input);
    const systemPrompt = 'You are a safety evaluator. Given a tool call, determine if it is potentially harmful to the user\'s system. Harmful means: deleting files, executing arbitrary shell commands, sending data to external services, modifying system configuration, or any action that could cause data loss or security compromise. Your response must be exactly one of these two strings: APPROVE or DENY. Do not add any other text.';
    const prompt = `Evaluate this tool call:\nTool: ${toolName}\nInput: ${inputJson}`;

    try {
      const response = await this.config.provider.check(prompt, { model: this.config.model, system: systemPrompt });
      const decision = response.trim().toUpperCase();
      if (decision === 'APPROVE') {
        return { approved: true, reason: `LLM harm-check: APPROVE` };
      }
      return { approved: false, reason: `LLM harm-check: DENY — ${response.trim()}` };
    } catch {
      // If LLM check fails, deny for safety
      return { approved: false, reason: 'LLM harm-check failed — denied' };
    }
  }

  private reconstructMessages(events: Event[]): Message[] {
    const messages: Message[] = [];
    let currentTurn = {
      assistantDeltas: [] as string[],
      toolCalls: [] as Array<{ toolCallId: string; name: string; input: Record<string, unknown>; thoughtSignature?: string }>,
      toolResults: [] as Array<{ toolCallId: string; output: unknown }>,
    };
    let hasActiveTurn = false;

    for (const event of events) {
      if (event.type === 'user-prompt') {
        if (hasActiveTurn) {
          messages.push(...this.buildTurnMessages(currentTurn));
        }
        messages.push({ role: 'user', content: event.text });
        currentTurn = { assistantDeltas: [], toolCalls: [], toolResults: [] };
        hasActiveTurn = true;
        continue;
      }
      if (!hasActiveTurn) continue;

      if (event.type === 'assistant-delta') {
        currentTurn.assistantDeltas.push(event.text);
      } else if (event.type === 'tool-call') {
        currentTurn.toolCalls.push({ toolCallId: event.toolCallId, name: event.name, input: event.input, thoughtSignature: event.thoughtSignature });
      } else if (event.type === 'tool-result') {
        currentTurn.toolResults.push({ toolCallId: event.toolCallId, output: event.output });
      }
    }
    if (hasActiveTurn) {
      messages.push(...this.buildTurnMessages(currentTurn));
    }

    return messages;
  }

  private buildTurnMessages(turn: {
    assistantDeltas: string[];
    toolCalls: Array<{ toolCallId: string; name: string; input: Record<string, unknown>; thoughtSignature?: string }>;
    toolResults: Array<{ toolCallId: string; output: unknown }>;
  }): Message[] {
    const msgs: Message[] = [];

    // Assistant message: text blocks + tool-use blocks
    const assistantBlocks: AssistantBlock[] = [];
    for (const text of turn.assistantDeltas) {
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
        msgs.push({ role: 'tool', toolUseId: tc.toolCallId, content });
      }
    }

    return msgs;
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
      } else {
        // Session ID was provided but doesn't exist on disk yet
        // (e.g. ChannelRouter generates a placeholder before TurnLoop creates it)
        session = this.store.create(
          this.config.cwd,
          this.config.model,
          this.config.provider.name,
        );
        this.activeSessionId = session.id;
      }
    } else {
      session = this.store.create(
        this.config.cwd,
        this.config.model,
        this.config.provider.name,
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
    emit({ type: 'user-prompt', id: session.id, text: prompt, cwd: this.config.cwd, timestamp: Date.now() });

    this.messages.push({ role: 'user', content: prompt });
    let turn = 0;
    const maxTurns = this.config.maxTurns ?? 50;

    try {
      while (turn < maxTurns && !this.abort) {
        turn++;

        let fullText = '';
        const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown>; thoughtSignature?: string }> = [];
        let totalToolCalls = 0;
        let websearchToolCalls = 0;
        const thinkingBlocks: Array<{ thinking: string; signature: string }> = [];

        // Local providers (Ollama, llama.cpp) don't support Anthropic thinking blocks.
        // Strip thinking blocks from message history to avoid serialization errors.
        const self = this;
        const isLocal = self.config.provider.name === 'local';
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

        // Start the provider stream and capture its cancel function.
        // The cancel() method synchronously aborts the underlying HTTP connection
        // (e.g., Anthropic's stream.abort()), making Esc feel instantaneous.
        const cancelable = self.config.provider.stream({
          messages: streamMessages as any,
          tools: self.config.tools.map((t) => t.definition),
          model: self.config.model,
          system: self.config.system,
          signal: abortCtrl.signal,
          effort: self.config.effort,
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

              case 'thinking-block':
                thinkingBlocks.push({ thinking: event.thinking, signature: event.signature });
                break;

              case 'tool-call':
                toolCalls.push({ id: event.id, name: event.name, input: event.input, thoughtSignature: event.thoughtSignature });
                emit({ type: 'tool-call', id: session.id, toolCallId: event.id, name: event.name, input: event.input, thoughtSignature: event.thoughtSignature, timestamp: Date.now() });
                break;

              case 'usage':
                emit({ type: 'usage', id: session.id, inputTokens: event.inputTokens, outputTokens: event.outputTokens, cacheReadTokens: event.cacheReadTokens, cacheWriteTokens: event.cacheWriteTokens, timestamp: Date.now() });
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
            throw err;
          }
        }

        if (this.abort) {
          emit({ type: 'assistant-stop', id: session.id, timestamp: Date.now() });
          emit({ type: 'session-stop', id: session.id, reason: 'cancelled', timestamp: Date.now() });
          return { events: this.bus.history(), sessionId: session.id, reason: 'cancelled' };
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

        if (toolCalls.length === 0) {
          emit({ type: 'assistant-stop', id: session.id, timestamp: Date.now() });
          emit({ type: 'session-stop', id: session.id, reason: 'stop', timestamp: Date.now() });
          return { events: this.bus.history(), sessionId: session.id, reason: 'stop' };
        }

        for (const tc of toolCalls) {
          if (this.abort) break;

          // --- Tool usage limits ---
          const totalLimit = this.config.settings.TOOLS_PER_CALL ?? 10;
          const websearchLimit = this.config.settings.WEBSEARCH_PER_CALL ?? 5;

          if (totalToolCalls >= totalLimit) {
            const msg = `Tool call limit reached (${totalLimit} per turn). Skipping remaining tool call(s).`;
            emit({ type: 'status', id: session.id, message: msg, timestamp: Date.now() });
            for (const remaining of toolCalls.slice(toolCalls.indexOf(tc))) {
              this.messages.push({ role: 'tool', toolUseId: remaining.id, content: `Skipped: ${msg}` });
              emit({ type: 'tool-result', id: session.id, toolCallId: remaining.id, output: null, error: msg, timestamp: Date.now() });
            }
            break;
          }

          if (websearchTools.has(tc.name) && websearchToolCalls >= websearchLimit) {
            const msg = `WebSearch/WebFetch limit reached (${websearchLimit} per turn). Skipping remaining tool call(s).`;
            emit({ type: 'status', id: session.id, message: msg, timestamp: Date.now() });
            for (const remaining of toolCalls.slice(toolCalls.indexOf(tc))) {
              this.messages.push({ role: 'tool', toolUseId: remaining.id, content: `Skipped: ${msg}` });
              emit({ type: 'tool-result', id: session.id, toolCallId: remaining.id, output: null, error: msg, timestamp: Date.now() });
            }
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
            timestamp: Date.now(),
          });

          if (permResult.decision === 'deny') {
            emit({ type: 'approval-decision', id: session.id, toolCallId: tc.id, decision: 'deny', timestamp: Date.now() });
            this.messages.push({ role: 'tool', toolUseId: tc.id, content: `Tool call denied: ${permResult.reason}` });
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
                approved = await ask({ name: tc.name, input: tc.input, reason: harm.reason });
                decisionBy = 'user';
              }
            } else {
              approved = ask
                ? await ask({ name: tc.name, input: tc.input, reason: permResult.reason })
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
              this.messages.push({ role: 'tool', toolUseId: tc.id, content: decisionBy === 'llm' ? `Tool call denied by LLM harm-check: ${tc.name}` : 'Tool call denied by user.' });
              continue;
            }
            toolApproved = approved;
            toolDecisionBy = decisionBy === 'llm' ? 'llm' : 'user';
          }

          totalToolCalls++;
          if (websearchTools.has(tc.name)) websearchToolCalls++;

          const tool = this.config.tools.find((t) => t.definition.name === tc.name);
          if (!tool) {
            emit({ type: 'tool-result', id: session.id, toolCallId: tc.id, output: null, error: `Unknown tool: ${tc.name}`, timestamp: Date.now() });
            this.messages.push({ role: 'tool', toolUseId: tc.id, content: `Unknown tool: ${tc.name}` });
            continue;
          }

          try {
            const result = await tool.execute(tc.input, this.config.settings, this.config.cwd);
            emit({ type: 'tool-result', id: session.id, toolCallId: tc.id, output: result.output, error: result.error, timestamp: Date.now() });
            const outputStr = result.error ? `Error: ${result.error}` : JSON.stringify(result.output);
            const decisionLabel = toolDecisionBy === 'llm' ? 'LLM-approved' : toolDecisionBy === 'user' ? 'Approved by user' : 'Auto Approved';
            this.messages.push({ role: 'tool', toolUseId: tc.id, content: `${tc.name}: ${decisionLabel} — ${outputStr}` });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            emit({ type: 'tool-result', id: session.id, toolCallId: tc.id, output: null, error: msg, timestamp: Date.now() });
            const decisionLabel = toolDecisionBy === 'llm' ? 'LLM-approved' : toolDecisionBy === 'user' ? 'Approved by user' : 'Auto Approved';
            this.messages.push({ role: 'tool', toolUseId: tc.id, content: `${tc.name}: ${decisionLabel} — Error: ${msg}` });
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
