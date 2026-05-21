import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { EventBus } from './event-bus.js';
import { TurnLoop, type ReasoningEffort, type ProviderStream, type Tool } from './turn-loop.js';
import type { CurieSettings } from './settings.js';
import type { ScheduleType } from './unified-task.js';
import { readTaskSummary } from './task-summary.js';

export interface HeartbeatExecutorConfig {
  provider: ProviderStream;
  model: string;
  tools: Tool[];
  cwd: string;
  settings: CurieSettings;
  effort?: ReasoningEffort;
  /** Max turns for the tool-use loop (default 30). */
  maxTurns?: number;
  /** Which HEARTBEAT.md section to execute (times|daily|weekly|monthly). */
  scheduleType?: ScheduleType;
  /** System prompt for the heartbeat turn loop. */
  system?: string;
}

export interface HeartbeatResult {
  sessionId: string;
  text: string;
  toolCalls: number;
  maxTurns?: number;
  reason: string;
  usage: { inputTokens: number; outputTokens: number };
  errors: string[];
}

export interface BatchResult {
  text: string;
  toolCalls: number;
  sessionId: string;
  reason: string;
  errors: string[];
}

/**
 * Wraps TurnLoop with yolo (auto-approve) mode and collects
 * text output, tool call count, and errors via EventBus subscriptions.
 */
export class BatchTurnLoop {
  private turnLoop: TurnLoop;
  private collectedText = '';
  private toolCallCount = 0;
  private errors: string[] = [];

  constructor(config: {
    provider: ProviderStream;
    model: string;
    tools: Tool[];
    cwd: string;
    settings: CurieSettings;
    effort?: ReasoningEffort;
    maxTurns?: number;
    system?: string;
    type?: string;
  }) {
    const approvalMode = config.settings.heartbeat?.mode || 'yolo';
    this.turnLoop = new TurnLoop({
      provider: config.provider,
      model: config.model,
      tools: config.tools,
      cwd: config.cwd,
      settings: config.settings,
      approvalMode,
      effort: config.effort,
      maxTurns: config.maxTurns,
      system: config.system,
      type: config.type || 'heartbeat',
    });
  }

  async run(prompt: string): Promise<BatchResult> {
    const unsubs = [
      this.turnLoop.eventBus.subscribe('assistant-delta', (e) => {
        if (e.type === 'assistant-delta') this.collectedText += e.text;
      }),
      this.turnLoop.eventBus.subscribe('tool-call', (e) => {
        if (e.type === 'tool-call') this.toolCallCount++;
      }),
      this.turnLoop.eventBus.subscribe('error', (e) => {
        if (e.type === 'error') this.errors.push(e.message);
      }),
    ];

    const result = await this.turnLoop.run(prompt);
    unsubs.forEach((u) => u());

    return {
      text: this.collectedText,
      toolCalls: this.toolCallCount,
      sessionId: result.sessionId,
      reason: result.reason,
      errors: this.errors,
    };
  }
}

/**
 * Default heartbeat protocol — used when ~/.curie-agent/HEARTBEAT.md
 * does not exist.
 */
const DEFAULT_HEARTBEAT_PROTOCOL = `# HEARTBEAT.md
AI AGENT INSTRUCTIONS: This file dictates your periodic proactive routine. Execute the following protocol sequentially.

## Data Ingestion & State Check
Scan and load the current state of:
- tasks.json (or todo.json): Parse active tasks in the current project
- Short-Term Memory: Ingest recent daily logs from ~/.curie-agent/memory/

## Synthesis & Insight Generation
Cross-reference ingested data to formulate proactive insights (1-3 concise, actionable observations).

## Execution & System Updates
- Consolidate MEMORY.md: Extract core developments from recent daily logs
- Stage TODOs: New obligations from daily logs as appropriately prioritized tasks

## User Output (The Heartbeat Brief)
Generate a strictly formatted status report:
- Insights: [Brief bullet points]
- Proposed Actions: [Tasks ready to be added to tasks.json]
- System Status: [Confirmation of updates]`;

export class HeartbeatExecutor {
  private heartbeatDir: string;

  constructor(private config: HeartbeatExecutorConfig) {
    this.heartbeatDir = join(homedir(), '.curie-agent');
  }

  async execute(): Promise<HeartbeatResult> {
    // 1. Read HEARTBEAT.md instructions
    const heartbeatProtocol = this.readHeartbeatMd();

    // 2. Gather context
    const context = await this.gatherContext();

    // 3. Build prompt with schedule-type header
    const prompt = this.buildPrompt(heartbeatProtocol, context, this.config.scheduleType);

    // 4. Run batch turn loop
    const batchResult = await new BatchTurnLoop({
      provider: this.config.provider,
      model: this.config.model,
      tools: this.config.tools,
      cwd: this.config.cwd,
      settings: this.config.settings,
      effort: this.config.effort,
      maxTurns: this.config.maxTurns ?? 30,
      // System prompt from daemon-app carries AGENTS.md + skills catalog.
      // Standalone use gets a minimal fallback (no skills).
      system: this.config.system || 'You are running a Heartbeat cycle.',
    }).run(prompt);

    const maxTurns = this.config.maxTurns ?? 30;
    return {
      sessionId: batchResult.sessionId,
      text: batchResult.text,
      toolCalls: batchResult.toolCalls,
      maxTurns,
      reason: batchResult.reason,
      usage: { inputTokens: 0, outputTokens: 0 },
      errors: batchResult.errors,
    };
  }

  private readHeartbeatMd(): string {
    const path = join(this.heartbeatDir, 'HEARTBEAT.md');
    if (existsSync(path)) {
      return readFileSync(path, 'utf-8');
    }
    return DEFAULT_HEARTBEAT_PROTOCOL;
  }

  private async gatherContext(): Promise<string> {
    const sections: string[] = [];

    // Gather MEMORY.md
    const memoryPath = join(this.heartbeatDir, 'MEMORY.md');
    if (existsSync(memoryPath)) {
      sections.push('=== MEMORY.md ===\n' + readFileSync(memoryPath, 'utf-8'));
    }

    // Gather USER.md
    const userPath = join(this.heartbeatDir, 'USER.md');
    if (existsSync(userPath)) {
      sections.push('=== USER.md ===\n' + readFileSync(userPath, 'utf-8'));
    }

    // Gather AGENTS.md
    const agentsPath = join(this.heartbeatDir, 'AGENTS.md');
    if (existsSync(agentsPath)) {
      sections.push('=== AGENTS.md ===\n' + readFileSync(agentsPath, 'utf-8'));
    }

    // Gather project tasks/todo file from cwd (try unified format first, fall back to legacy)
    const taskPath = join(this.config.cwd, 'tasks.json');
    if (!existsSync(taskPath)) {
      const todoPath = join(this.config.cwd, 'todo.json');
      if (existsSync(todoPath)) {
        sections.push('=== Project Tasks ===\n' + readTaskSummary(todoPath));
      }
    } else {
      sections.push('=== Project Tasks ===\n' + readTaskSummary(taskPath));
    }

    // Gather daily memory logs (last 3)
    const memoryDir = join(this.heartbeatDir, 'memory');
    if (existsSync(memoryDir)) {
      sections.push(`=== Memory Directory ===\nDirectory: ${memoryDir} — the agent should glob for recent daily log files`);
    }

    return sections.join('\n\n');
  }

  private buildPrompt(protocol: string, context: string, scheduleType?: ScheduleType): string {
    const scheduleHint = scheduleType
      ? `Execute the **${scheduleType}** section of the HEARTBEAT protocol.\n`
      : '';

    const now = new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    return [
      '=== HEARTBEAT PROTOCOL ===',
      protocol,
      '',
      '=== GATHERED CONTEXT ===',
      context,
      '',
      '=== CURRENT TIME ===',
      now,
      '',
      `${scheduleHint}Please now execute the Heartbeat protocol using the gathered context. Produce the final Heartbeat Brief as specified in the protocol.`,
    ].join('\n');
  }
}
