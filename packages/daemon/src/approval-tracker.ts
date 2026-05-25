import type { EventBus, Event } from '@curie-agent/core';

interface PendingApproval {
  toolCallId: string;
  name: string;
  input: Record<string, unknown>;
  sessionId: string;
  channelId: string;
  resolve: (value: boolean) => void;
  reject: (reason?: unknown) => void;
  decided: boolean;
  createdAt: number;
}

/**
 * Tracks pending approval requests. TurnLoop calls register() when it
 * needs user approval; clients resolve via decide() RPC.
 */
export class ApprovalTracker {
  private pending = new Map<string, PendingApproval>();

  constructor(private eventBus: EventBus) {}

  /**
   * Register a pending approval. Returns a promise that resolves
   * when the user approves/rejects, or after 30s timeout (auto-deny).
   * Emits approval-request to the shared event bus so clients can decide.
   */
  register(params: {
    toolCallId: string;
    name: string;
    input: Record<string, unknown>;
    sessionId: string;
    channelId: string;
  }): Promise<boolean> {
    const { toolCallId, name, input, sessionId, channelId } = params;
    const id = crypto.randomUUID();

    return new Promise<boolean>((resolve, reject) => {
      this.pending.set(toolCallId, {
        toolCallId, name, input, sessionId, channelId,
        resolve, reject, decided: false, createdAt: Date.now(),
      });

      // 30s timeout — auto-deny if no client responds
      setTimeout(() => {
        const entry = this.pending.get(toolCallId);
        if (entry && !entry.decided) {
          entry.decided = true;
          entry.resolve(false);
          this.pending.delete(toolCallId);
        }
      }, 30_000);
      // approval-request is bridged to the shared bus by ChannelManager from
      // the turn-loop's own event (which carries decision + mode fields).
      // Do not emit here to avoid duplicates.
    });
  }

  /**
   * Resolve a pending approval. First call wins; subsequent calls
   * return { decided: true, decision: 'already-decided' }.
   */
  decide(toolCallId: string, decision: 'allow' | 'deny'): { decided: boolean; decision: string } {
    const entry = this.pending.get(toolCallId);
    if (!entry || entry.decided) {
      return { decided: true, decision: 'already-decided' };
    }

    entry.decided = true;
    entry.resolve(decision === 'allow');

    const id = crypto.randomUUID();
    this.eventBus.emit({
      type: 'approval-decision',
      id, toolCallId, decision, timestamp: Date.now(),
    } as Event);

    this.pending.delete(toolCallId);
    return { decided: true, decision };
  }

  /** List all pending approvals. */
  list(sessionId?: string): Array<{
    toolCallId: string;
    name: string;
    input: Record<string, unknown>;
    sessionId: string;
    channelId: string;
    createdAt: number;
  }> {
    const result: Array<{
      toolCallId: string;
      name: string;
      input: Record<string, unknown>;
      sessionId: string;
      channelId: string;
      createdAt: number;
    }> = [];

    for (const entry of this.pending.values()) {
      if (sessionId && entry.sessionId !== sessionId) continue;
      result.push({
        toolCallId: entry.toolCallId,
        name: entry.name,
        input: entry.input,
        sessionId: entry.sessionId,
        channelId: entry.channelId,
        createdAt: entry.createdAt,
      });
    }

    return result;
  }

  /** Remove stale entries (cleanup). */
  clear() {
    for (const [toolCallId, entry] of this.pending) {
      if (!entry.decided) {
        entry.reject(new Error('cleared'));
      }
    }
    this.pending.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
