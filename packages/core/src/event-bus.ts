export type Event =
  | { type: 'user-prompt'; id: string; text: string; cwd: string; timestamp: number }
  | { type: 'assistant-delta'; id: string; text: string; timestamp: number }
  | { type: 'thinking-delta'; id: string; text: string; timestamp: number }
  | { type: 'assistant-stop'; id: string; timestamp: number }
  | { type: 'tool-call'; id: string; toolCallId: string; name: string; input: Record<string, unknown>; thoughtSignature?: string; timestamp: number }
  | { type: 'tool-result'; id: string; toolCallId: string; output: unknown; error?: string; timestamp: number }
  | { type: 'approval-request'; id: string; toolCallId: string; name: string; input: Record<string, unknown>; decision?: 'allow' | 'deny' | 'ask'; mode?: string; timestamp: number }
  | { type: 'approval-decision'; id: string; toolCallId: string; decision: 'allow' | 'deny'; by?: string; timestamp: number }
  | { type: 'usage'; id: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; timestamp: number }
  | { type: 'error'; id: string; message: string; code?: string; timestamp: number }
  | { type: 'session-start'; id: string; model: string; provider: string; cwd: string; timestamp: number }
  | { type: 'session-stop'; id: string; reason: string; timestamp: number }
  | { type: 'hook'; id: string; phase: string; name: string; result?: string; error?: string; timestamp: number }
  | { type: 'status'; id: string; message: string; spinner?: boolean; timestamp: number }
  | { type: 'session-resumed'; id: string; turnsRecovered: number; timestamp: number }
| { type: 'context-warning'; id: string; message: string; timestamp: number }
// Compaction marker. Appended, never overwriting: message reconstruction replays
// forward from the last marker, so the full transcript stays on disk for the UI,
// audit and debugging while the model only carries the summary.
| { type: 'compaction'; id: string; summary: string; summarizedMessageCount: number; tokensBefore: number; tokensAfter: number; timestamp: number }
// Context-window snapshot with a per-component split. Carries data, not markup,
// so the TUI and the web dashboard can each render it natively.
| { type: 'context-report'; id: string; model: string; windowTokens: number; usedTokens: number; reservedOutput: number; breakdown: Array<{ label: string; tokens: number }>; timestamp: number }
// Subagent events
| { type: 'agent-start'; id: string; agentId: string; sessionId: string; prompt: string; timestamp: number }
| { type: 'agent-text-delta'; id: string; agentId: string; text: string; timestamp: number }
| { type: 'agent-thinking-delta'; id: string; agentId: string; text: string; timestamp: number }
| { type: 'agent-tool-call'; id: string; agentId: string; toolCallId: string; name: string; input: Record<string, unknown>; timestamp: number }
| { type: 'agent-tool-result'; id: string; agentId: string; toolCallId: string; output: unknown; error?: string; timestamp: number }
| { type: 'agent-usage'; id: string; agentId: string; inputTokens: number; outputTokens: number; timestamp: number }
| { type: 'agent-done'; id: string; agentId: string; sessionId: string; text: string; toolCalls: number; errors: string[]; durationMs: number; timestamp: number }
| { type: 'agent-error'; id: string; agentId: string; sessionId: string; message: string; code?: string; timestamp: number };

export type EventType = Event['type'];

type Handler<T extends Event> = (event: T) => void;

function filterEvent<T extends Event>(events: Handler<Event>[], type: T['type']): Handler<T>[] {
  return events.filter((h) => {
    const fn = h as Handler<T>;
    return true;
  }) as Handler<T>[];
}

export class EventBus {
  private listeners = new Map<EventType, Set<Handler<Event>>>();
  private onceListeners = new Map<EventType, Set<Handler<Event>>>();
  private _history: Event[] = [];

  subscribe<T extends Event>(type: T['type'], fn: (event: T) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(fn as Handler<Event>);
    return () => this.unsubscribe(type, fn as Handler<Event>);
  }

  unsubscribe<T extends Event>(type: T['type'], fn: (event: T) => void): void {
    this.listeners.get(type)?.delete(fn as Handler<Event>);
  }

  once<T extends Event>(type: T['type'], fn: (event: T) => void): () => void {
    if (!this.onceListeners.has(type)) {
      this.onceListeners.set(type, new Set());
    }
    this.onceListeners.get(type)!.add(fn as Handler<Event>);
    return () => this.onceListeners.get(type)?.delete(fn as Handler<Event>);
  }

  emit<T extends Event>(event: T): void {
    this._history.push(event);
    const type = event.type;

    for (const fn of this.listeners.get(type) ?? []) {
      fn(event);
    }

    const onceSet = this.onceListeners.get(type);
    if (onceSet) {
      for (const fn of onceSet) {
        fn(event);
      }
      this.onceListeners.delete(type);
    }
  }

  emitAll(events: Event[]): void {
    for (const event of events) {
      this.emit(event);
    }
  }

  history(): Event[] {
    return this._history;
  }

  clear(): void {
    this.listeners.clear();
    this.onceListeners.clear();
    this._history = [];
  }
}
