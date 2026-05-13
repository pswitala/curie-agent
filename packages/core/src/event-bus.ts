export type Event =
  | { type: 'user-prompt'; id: string; text: string; cwd: string; timestamp: number }
  | { type: 'assistant-delta'; id: string; text: string; timestamp: number }
  | { type: 'thinking-delta'; id: string; text: string; timestamp: number }
  | { type: 'assistant-stop'; id: string; timestamp: number }
  | { type: 'tool-call'; id: string; toolCallId: string; name: string; input: Record<string, unknown>; thoughtSignature?: string; timestamp: number }
  | { type: 'tool-result'; id: string; toolCallId: string; output: unknown; error?: string; timestamp: number }
  | { type: 'approval-request'; id: string; toolCallId: string; name: string; input: Record<string, unknown>; decision?: 'allow' | 'deny' | 'ask'; timestamp: number }
  | { type: 'approval-decision'; id: string; toolCallId: string; decision: 'allow' | 'deny'; by?: string; timestamp: number }
  | { type: 'usage'; id: string; inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number; timestamp: number }
  | { type: 'error'; id: string; message: string; code?: string; timestamp: number }
  | { type: 'session-start'; id: string; model: string; provider: string; cwd: string; timestamp: number }
  | { type: 'session-stop'; id: string; reason: string; timestamp: number }
  | { type: 'hook'; id: string; phase: string; name: string; result?: string; error?: string; timestamp: number }
  | { type: 'status'; id: string; message: string; spinner?: boolean; timestamp: number }
  | { type: 'session-resumed'; id: string; turnsRecovered: number; timestamp: number };

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
