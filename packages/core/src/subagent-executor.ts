import { randomUUID } from 'node:crypto';
import { TurnLoop, type ReasoningEffort, type ProviderStream, type Tool } from './turn-loop.js';
import { EventBus, type Event } from './event-bus.js';
import { SessionStore, type SessionInfo } from './session-store.js';
import type { ApprovalMode } from './permission.js';
import type { CurieSettings } from './settings.js';

export interface SubagentConfig {
  provider: ProviderStream;
  model: string;
  tools: Tool[];
  cwd: string;
  settings: CurieSettings;
  prompt: string;
  system?: string;
  providerName?: string;
  mode?: ApprovalMode;
  effort?: ReasoningEffort;
  maxTurns?: number;
  /** Tool names to allow (subset of parent's tools). Undefined = all tools. */
  allowedTools?: string[];
  /** Additional context to inject into the subagent's system prompt */
  context?: string;
  /** Session type / entrypoint (e.g. 'subagent') */
  type?: string;
  /** Extra data attached to this agent — stored in handle and emitted with lifecycle events */
  metadata?: Record<string, unknown>;
}

export interface SubagentHandle {
  agentId: string;
  sessionId: string;
  prompt: string;
  provider: string;
  status: 'starting' | 'running' | 'waiting_tool' | 'done' | 'error' | 'cancelled';
  text: string;
  toolCalls: number;
  errors: string[];
  inputTokens: number;
  outputTokens: number;
  startedAt: number;
  doneAt?: number;
  /** Link back to a scheduled task (auto-mode tasks only). */
  taskId?: string;
  /** Type of spawn: 'subagent' (manual) or 'auto' (scheduled task). */
  taskType?: string;
  /** Extra data — passed through from spawn config. */
  metadata?: Record<string, unknown>;
}

export class SubagentExecutor {
  private agents: Map<string, SubagentHandle> = new Map();
  private running: Map<string, Promise<void>> = new Map();
  private maxConcurrent: number;

  constructor(
    private eventBus: EventBus,
    private sessionStore: SessionStore,
    private maxConcurrentOption?: number,
  ) {
    this.maxConcurrent = maxConcurrentOption ?? 5;
  }

  async spawn(config: SubagentConfig): Promise<SubagentHandle> {
    // Enforce concurrency limit
    const runningCount = this.getRunningCount();
    if (runningCount >= this.maxConcurrent) {
      throw new Error(
        `Concurrency limit reached (${this.maxConcurrent} concurrent subagents). Cancel one first.`,
      );
    }

    const agentId = randomUUID();
    const status: SubagentHandle['status'] = 'starting';

    const handle: SubagentHandle = {
      agentId,
      sessionId: '',
      prompt: config.prompt,
      provider: config.providerName || config.provider.name,
      status,
      text: '',
      toolCalls: 0,
      errors: [],
      inputTokens: 0,
      outputTokens: 0,
      startedAt: Date.now(),
      taskId: (config.metadata as Record<string, unknown> | undefined)?.taskId as string | undefined,
      taskType: (config.metadata as Record<string, unknown> | undefined)?.taskType as string | undefined,
      metadata: config.metadata,
    };
    this.agents.set(agentId, handle);

    // Emit agent-start event
    this.eventBus.emit({
      type: 'agent-start',
      id: randomUUID(),
      agentId,
      sessionId: '',
      prompt: config.prompt,
      timestamp: Date.now(),
    } as unknown as Event);

    // Filter tools if allowedTools is specified
    const tools = config.allowedTools
      ? config.tools.filter((t) => config.allowedTools!.includes(t.definition.name))
      : config.tools;

    // Create session for this subagent
    const subSession = this.sessionStore.create(
      config.cwd,
      config.model,
      config.provider.name,
      config.type || 'subagent',
    );
    handle.sessionId = subSession.id;

    // Update status to running
    handle.status = 'running';

    const promise = this.runSubagent({
      ...config,
      tools,
      sessionId: subSession.id,
    }).finally(() => {
      this.running.delete(agentId);
    });

    this.running.set(agentId, promise);
    return handle;
  }

  private async runSubagent(config: SubagentConfig & { sessionId: string }): Promise<void> {
    const { agentId } = findHandle(this.agents, config.sessionId) ?? { agentId: '' };

    const turnLoop = new TurnLoop({
      provider: config.provider,
      model: config.model,
      tools: config.tools,
      cwd: config.cwd,
      settings: config.settings,
      approvalMode: config.mode || config.settings.mode || 'auto',
      effort: config.effort,
      maxTurns: config.maxTurns ?? 50,
      system: config.system,
      sessionId: config.sessionId,
      type: config.type || 'subagent',
    }, this.sessionStore);

    // Use config.system directly as the subagent's system prompt
    const runPromise = config.system
      ? createAndRunTurnLoop(turnLoop, config.prompt, config.system)
      : turnLoop.run(config.prompt);

    // Bridge subagent events to shared daemon EventBus
    const eventTypes: Event['type'][] = [
      'assistant-delta', 'thinking-delta', 'assistant-stop',
      'tool-call', 'tool-result', 'usage', 'error',
      'session-start', 'session-stop',
    ];

    const unsubs: Array<() => void> = [];
    let collectedText = '';
    let toolCallCount = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let errors: string[] = [];

    for (const type of eventTypes) {
      unsubs.push(
        turnLoop.eventBus.subscribe(type, (event: Event) => {
          const agentEvent = mapToAgentEvent(event, config.sessionId);
          if (agentEvent) {
            this.eventBus.emit(agentEvent);
          }

          // Collect data for handle
          if (type === 'assistant-delta') {
            collectedText += (event as { text: string }).text;
          } else if (type === 'tool-call') {
            toolCallCount++;
          } else if (type === 'usage') {
            const u = event as { inputTokens: number; outputTokens: number };
            inputTokens += u.inputTokens;
            outputTokens += u.outputTokens;
          } else if (type === 'error') {
            errors.push((event as { message: string }).message);
          }
        }),
      );
    }

    try {
      const result = await runPromise;

      // Update handle with collected data
      const handle = this.agents.get(agentId);
      if (handle) {
        handle.text = collectedText;
        handle.toolCalls = toolCallCount;
        handle.inputTokens = inputTokens;
        handle.outputTokens = outputTokens;
        handle.errors = errors;
        handle.doneAt = Date.now();
        handle.status = result.reason === 'stop' ? 'done' : result.reason === 'cancelled' ? 'cancelled' : 'error';
      }

      // Emit agent-done event
      this.eventBus.emit({
        type: 'agent-done',
        id: randomUUID(),
        agentId,
        sessionId: result.sessionId,
        text: collectedText.slice(0, 2000),
        toolCalls: toolCallCount,
        errors,
        durationMs: handle?.doneAt ? handle.doneAt - (handle?.startedAt || handle?.doneAt) : 0,
        timestamp: Date.now(),
        metadata: config.metadata,
      } as unknown as Event);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      const handle = this.agents.get(agentId);
      if (handle) {
        handle.text = collectedText;
        handle.toolCalls = toolCallCount;
        handle.errors = [...errors, msg];
        handle.status = 'error';
        handle.doneAt = Date.now();
      }

      // Emit agent-error event
      this.eventBus.emit({
        type: 'agent-error',
        id: randomUUID(),
        agentId,
        sessionId: config.sessionId,
        message: msg,
        timestamp: Date.now(),
        metadata: config.metadata,
      } as unknown as Event);
    } finally {
      unsubs.forEach((u) => u());
    }
  }

  cancel(agentId: string): boolean {
    const handle = this.agents.get(agentId);
    if (!handle) return false;

    if (handle.status === 'done' || handle.status === 'error' || handle.status === 'cancelled') {
      return false; // Already finished
    }

    handle.status = 'cancelled';
    handle.doneAt = Date.now();

    // Cancel the TurnLoop if running
    const promise = this.running.get(agentId);
    if (promise) {
      // We need to find and cancel the TurnLoop — stored in the running promise
      // For now, emit cancellation event
    }

    this.eventBus.emit({
      type: 'agent-error',
      id: randomUUID(),
      agentId,
      sessionId: handle.sessionId,
      message: 'Cancelled by user',
      code: 'cancelled',
      timestamp: Date.now(),
    } as unknown as Event);

    return true;
  }

  list(statusFilter?: string): SubagentHandle[] {
    const all = Array.from(this.agents.values());
    if (!statusFilter) return all;
    return all.filter((a) => a.status === statusFilter);
  }

  stats(agentId: string): SubagentHandle | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Send a message to a running subagent.
   * Appends the message as a user prompt to the subagent's session.
   */
  sendMessage(agentId: string, message: string): boolean {
    const handle = this.agents.get(agentId);
    if (!handle || handle.status !== 'running') return false;

    // Append as user event to the subagent's session
    this.sessionStore.appendEvent(handle.sessionId, {
      type: 'user-prompt',
      id: randomUUID(),
      text: message,
      cwd: '',
      timestamp: Date.now(),
    } as unknown as Event);

    return true;
  }

  shutdown(): void {
    for (const agentId of this.agents.keys()) {
      this.cancel(agentId);
    }
    this.agents.clear();
    this.running.clear();
  }

  private getRunningCount(): number {
    return [...this.agents.values()].filter((a: SubagentHandle) => a.status === 'running' || a.status === 'starting').length;
  }
}

function findHandle(agents: Map<string, SubagentHandle>, sessionId: string): SubagentHandle | undefined {
  for (const handle of agents.values()) {
    if (handle.sessionId === sessionId) return handle;
  }
  return undefined;
}

async function createAndRunTurnLoop(turnLoop: TurnLoop, prompt: string, system: string): Promise<{ events: Event[]; sessionId: string; reason: string }> {
  // We need to temporarily set the system on the TurnLoop config
  // Since TurnLoop doesn't expose a setSystem method, we create a new one
  // Actually, the TurnLoop reads config.system directly in its run() method.
  // We can't mutate it after construction, so we need a different approach.

  // The TurnLoop reads this.config.system in run() at line 334:
  //   system: withDateContext(self.config.system)
  // We need to mutate it. Since config is private, we use a workaround:
  // Cast to access the private config.
  const tl = turnLoop as unknown as { config: { system?: string } };
  tl.config.system = system;
  return turnLoop.run(prompt);
}

function mapToAgentEvent(event: Event, sessionId: string): Event | null {
  switch (event.type) {
    case 'assistant-delta': {
      const e = event as { text: string };
      return { ...e, type: 'agent-text-delta' } as unknown as Event;
    }
    case 'thinking-delta': {
      const e = event as { text: string };
      return { ...e, type: 'agent-thinking-delta' } as unknown as Event;
    }
    case 'tool-call': {
      const e = event as { toolCallId: string; name: string; input: Record<string, unknown> };
      return { ...e, type: 'agent-tool-call' } as unknown as Event;
    }
    case 'tool-result': {
      const e = event as { toolCallId: string; output: unknown; error?: string };
      return { ...e, type: 'agent-tool-result' } as unknown as Event;
    }
    case 'usage': {
      const e = event as { inputTokens: number; outputTokens: number };
      return { ...e, type: 'agent-usage' } as unknown as Event;
    }
    case 'error': {
      const e = event as { message: string; code?: string };
      return { ...e, type: 'agent-error' } as unknown as Event;
    }
    default:
      return null;
  }
}
