/**
 * Shared utility for reading and summarizing tasks from JSON files.
 * Replaces the duplicate readTodoSummary() functions in task-executor.ts and heartbeat-executor.ts.
 */

import { readFileSync } from 'node:fs';
import type { TasksFile } from './unified-task.js';

/** Format active tasks as a summary string for context prompts. */
export function readTaskSummary(filePath: string): string {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as unknown;

    if (typeof data !== 'object' || data === null || !('tasks' in data)) return '(corrupt tasks.json)';

    const file = data as TasksFile;
    if (!Array.isArray(file.tasks) || !file.tasks.length) return '(empty)';

    // Show non-done/non-canceled tasks sorted by order
    const active = file.tasks.filter(
      (t) => t.status && !['done', 'canceled'].includes(t.status),
    );
    active.sort((a, b) => a.order - b.order);

    if (!active.length) {
      const doneCount = file.tasks.filter((t) => t.status === 'done').length;
      return `All ${file.tasks.length} task(s) complete (${doneCount} done).`;
    }

    const lines = active.map((t) => {
      const icon = t.status === 'in_progress' ? '[*]' : '-';
      const priority = t.priority && t.priority !== 'medium' ? ` [${t.priority}]` : '';
      return `${icon} ${t.id.slice(0, 8)} ${t.title}${priority}`;
    });

    return lines.join('\n');
  } catch {
    return '(corrupt tasks.json)';
  }
}
