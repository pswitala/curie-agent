import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { BatchTurnLoop } from './heartbeat-executor.js';
import type { Tool, ReasoningEffort, ProviderStream } from './turn-loop.js';
import type { CurieSettings } from './settings.js';

export interface TaskExecutorConfig {
  provider: ProviderStream;
  model: string;
  tools: Tool[];
  cwd: string;
  settings: CurieSettings;
  effort?: ReasoningEffort;
  /** Max turns for the tool-use loop (default 50). */
  maxTurns?: number;
  /** The task instruction/prompt. */
  instruction: string;
}

export interface TaskResult {
  sessionId: string;
  text: string;
  toolCalls: number;
  errors: string[];
}

export class TaskExecutor {
  private curieDir: string;

  constructor(private config: TaskExecutorConfig) {
    this.curieDir = join(homedir(), '.curie-agent');
  }

  async execute(): Promise<TaskResult> {
    const context = this.gatherContext();
    const prompt = this.buildPrompt(this.config.instruction, context);

    const batchResult = await new BatchTurnLoop({
      provider: this.config.provider,
      model: this.config.model,
      tools: this.config.tools,
      cwd: this.config.cwd,
      settings: this.config.settings,
      effort: this.config.effort,
      maxTurns: this.config.maxTurns ?? 50,
      system: `You are executing a scheduled task. Complete the task instruction using available tools. Deliver the results to the user.`,
    }).run(prompt);

    return {
      sessionId: batchResult.sessionId,
      text: batchResult.text,
      toolCalls: batchResult.toolCalls,
      errors: batchResult.errors,
    };
  }

  private gatherContext(): string {
    const sections: string[] = [];
    const readIf = (name: string, dir: string) => {
      const path = join(dir, name);
      if (existsSync(path)) {
        sections.push(`=== ${name} ===\n` + readFileSync(path, 'utf-8'));
      }
    };

    readIf('MEMORY.md', this.curieDir);
    readIf('USER.md', this.curieDir);
    readIf('AGENTS.md', this.curieDir);
    readIf('TODO.md', this.config.cwd);

    const memoryDir = join(this.curieDir, 'memory');
    if (existsSync(memoryDir)) {
      sections.push(`=== Memory Directory ===\nDirectory: ${memoryDir}`);
    }

    return sections.join('\n\n');
  }

  private buildPrompt(instruction: string, context: string): string {
    const now = new Date().toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });

    return [
      '=== TASK INSTRUCTION ===',
      instruction,
      '',
      '=== GATHERED CONTEXT ===',
      context || '(no context files found)',
      '',
      '=== CURRENT TIME ===',
      now,
      '',
      'Execute the task instruction above. Use available tools to gather data, browse websites, read files, and produce results. Deliver a clear summary of what you accomplished.',
    ].join('\n');
  }
}
