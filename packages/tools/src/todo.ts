/**
 * Todo tool — manages structured task lists.
 * Refactored to use the UnifiedTask schema (supports manual/auto/notify modes).
 * Backward compatible with legacy todo.json format (missing `mode` treated as 'manual').
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createTool, expandPath, type ToolContext } from './tool.js';
import type { TaskPriority, TaskScope, UnifiedTask, TasksFile, ScheduleType, TaskMode } from '@curie-agent/core';

// ---------------------------------------------------------------------------
// Zod schema (same action surface, extended fields)
// ---------------------------------------------------------------------------

const ACTION_VALUES = ['list', 'add', 'edit', 'remove', 'complete', 'cancel', 'start', 'reorder'] as const;
type ActionValue = (typeof ACTION_VALUES)[number];

const TodoSchema = z.object({
  action: z.enum(ACTION_VALUES).describe('Action: list, add, edit, remove, complete, cancel, start, reorder'),
  scope: z.enum(['personal', 'project']).describe('Scope: personal (~/.curie-agent/tasks.json) or project (<cwd>/tasks.json)'),
  id: z.string().optional().describe('Task ID (required for edit, remove, complete, cancel, start, reorder)'),
  title: z.string().optional().describe('Task title (required for add, optional for edit)'),
  description: z.string().optional().describe('Task description (optional)'),
  status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'canceled']).optional().describe('Task status'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Task priority'),
  tags: z.array(z.string()).optional().describe('Task tags'),
  ids: z.array(z.string()).optional().describe('Task IDs for reorder action (ordered list)'),
  // Filtering params (used with list action)
  filter_status: z.enum(['backlog', 'todo', 'in_progress', 'done', 'canceled']).optional().describe('Filter by status'),
  filter_priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Filter by priority'),
}).strict();

type TodoInput = z.infer<typeof TodoSchema>;

// ---------------------------------------------------------------------------
// Type helpers (convert legacy TodoTask to UnifiedTask)
// ---------------------------------------------------------------------------

/** Ensure a task has all UnifiedTask fields (migrates legacy format on read). */
function normalizeTask(t: unknown): UnifiedTask {
  if (!t || typeof t !== 'object') return {} as UnifiedTask;
  const obj = t as Record<string, unknown>;
  const validStatuses: UnifiedTask['status'][] = ['backlog', 'todo', 'in_progress', 'done', 'canceled', 'pending'];
  const rawStatus = String(obj.status ?? '');
  const status = (validStatuses.includes(rawStatus as unknown as UnifiedTask['status']) ? rawStatus : 'todo') as UnifiedTask['status'];

  const validModes: TaskMode[] = ['manual', 'auto', 'notify'];
  const rawMode = String(obj.mode ?? '');
  const mode = (validModes.includes(rawMode as unknown as TaskMode) ? rawMode : 'manual') as TaskMode;

  const validPriority: TaskPriority[] = ['low', 'medium', 'high', 'critical'];
  const rawPriority = String(obj.priority ?? 'medium');
  const priority = validPriority.includes(rawPriority as TaskPriority) ? (rawPriority as TaskPriority) : 'medium';

  let frequency: { type: ScheduleType; value: string } | null = null;
  if (obj.frequency && typeof obj.frequency === 'object' && 'type' in obj.frequency && 'value' in obj.frequency) {
    const rawType = String((obj.frequency as Record<string, unknown>).type);
    const validSchedules: ScheduleType[] = ['intraday', 'daily', 'weekly', 'monthly', 'dreaming'];
    if (validSchedules.includes(rawType as ScheduleType)) {
      frequency = { type: rawType as ScheduleType, value: String((obj.frequency as Record<string, unknown>).value ?? '') };
    }
  }

  return {
    id: String(obj.id ?? ''),
    title: String(obj.title ?? ''),
    description: String(obj.description ?? ''),
    status,
    priority,
    tags: Array.isArray(obj.tags) ? obj.tags as string[] : [],
    mode,
    scheduled_at: typeof obj.scheduled_at === 'number' ? obj.scheduled_at : undefined,
    frequency,
    result: typeof obj.result === 'string' ? obj.result : undefined,
    scope: String(obj.scope) === 'project' ? 'project' : 'personal',
    order: typeof obj.order === 'number' ? obj.order : 0,
    created_at: String(obj.created_at ?? new Date().toISOString()),
    completed_at: obj.completed_at && obj.completed_at !== null ? String(obj.completed_at) : undefined,
    last_run: typeof obj.last_run === 'number' ? obj.last_run : undefined,
  };
}

// ---------------------------------------------------------------------------
// File I/O (supports both old todo.json and new tasks.json)
// ---------------------------------------------------------------------------

function resolveScopePath(scope: 'personal' | 'project', cwd: string): string {
  if (scope === 'personal') {
    // Try new format first, fall back to legacy
    const newPath = path.join(expandPath('~'), '.curie-agent', 'tasks.json');
    if (fs.existsSync(newPath)) return newPath;
    return path.join(expandPath('~'), '.curie-agent', 'todo.json');
  }
  const projectPath = path.join(cwd, 'tasks.json');
  if (fs.existsSync(projectPath)) return projectPath;
  return path.join(cwd, 'todo.json');
}

function readTaskFile(filePath: string): TasksFile | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'tasks' in parsed && Array.isArray((parsed as TasksFile).tasks)) {
      return parsed as TasksFile;
    }
    // Legacy format without $schema/version — wrap it
    if (typeof parsed === 'object' && parsed !== null && 'tasks' in parsed) {
      const tasks = (parsed as Record<string, unknown>).tasks;
      return { $schema: 'legacy.schema.json', version: 1, tasks: Array.isArray(tasks) ? tasks : [] };
    }
    return null;
  } catch {
    return null; // corrupted → reset
  }
}

function ensureTaskFile(filePath: string): TasksFile {
  if (!fs.existsSync(filePath)) {
    const fresh: TasksFile = { $schema: 'tasks.schema.json', version: 1, tasks: [] };
    fs.writeFileSync(filePath, JSON.stringify(fresh, null, 2), 'utf-8');
    return fresh;
  }
  const data = readTaskFile(filePath);
  if (!data) {
    const fresh: TasksFile = { $schema: 'tasks.schema.json', version: 1, tasks: [] };
    fs.writeFileSync(filePath, JSON.stringify(fresh, null, 2), 'utf-8');
    return fresh;
  }
  // Normalize existing tasks to UnifiedTask format
  const normalized: UnifiedTask[] = (data.tasks as unknown[]).map(normalizeTask);
  if (normalized.length !== data.tasks.length || JSON.stringify(normalized) !== JSON.stringify(data.tasks)) {
    data.tasks = normalized;
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
  return data;
}

function generateId(): string {
  return crypto.randomUUID();
}

function formatDate(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export const todoTool = createTool(
  'Todo',
  'Manages a structured JSON-based task list with add, edit, remove, complete, cancel, start, reorder, and list actions. Tasks can be manual (todo list), auto (LLM executes at scheduled time), or notify (reminder notification only). Defaults to manual mode unless a time is specified.',
  TodoSchema,
  async (input: TodoInput, ctx: ToolContext) => {
    const filePath = resolveScopePath(input.scope, ctx.cwd);

    if (input.action === 'list') {
      const data = ensureTaskFile(filePath);
      let tasks: UnifiedTask[];
      try {
        tasks = data.tasks.map(normalizeTask);
      } catch {
        return { output: null, error: 'Failed to parse task file.' };
      }

      if (input.filter_status) tasks = tasks.filter((t) => t.status === input.filter_status);
      if (input.filter_priority) tasks = tasks.filter((t) => t.priority === input.filter_priority);
      if (input.tags && input.tags.length > 0) {
        tasks = tasks.filter((t) => input.tags!.every((tag) => t.tags.includes(tag)));
      }
      tasks.sort((a, b) => a.order - b.order);
      return { output: tasks };
    }

    if (input.action === 'add') {
      const data = ensureTaskFile(filePath);
      if (!input.title) return { output: null, error: 'Title is required for add action' };
      // Normalize existing tasks first
      let tasks: UnifiedTask[];
      try {
        tasks = data.tasks.map(normalizeTask);
      } catch {
        tasks = [];
      }

      const task: UnifiedTask = {
        id: generateId(),
        title: input.title,
        description: input.description ?? '',
        status: 'todo',
        priority: (input.priority as TaskPriority) ?? 'medium',
        tags: input.tags ?? [],
        mode: 'manual', // default — new fields are always manual unless specified via tool context
        scheduled_at: undefined,
        frequency: null,
        result: undefined,
        scope: input.scope,
        order: tasks.length,
        created_at: formatDate(),
        completed_at: undefined,
      };
      data.tasks.push(task);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { output: task };
    }

    if (input.action === 'edit') {
      const data = ensureTaskFile(filePath);
      let tasks: UnifiedTask[];
      try {
        tasks = data.tasks.map(normalizeTask);
      } catch {
        return { output: null, error: 'Failed to parse task file.' };
      }
      if (!input.id) return { output: null, error: 'ID is required for edit action' };
      const idx = tasks.findIndex((t) => t.id === input.id);
      if (idx === -1) return { output: null, error: `Task with id "${input.id}" not found` };
      const task = tasks[idx]!;
      if (input.title !== undefined) task.title = input.title;
      if (input.description !== undefined) task.description = input.description;
      if (input.status !== undefined) task.status = input.status as UnifiedTask['status'];
      if (input.priority !== undefined) task.priority = input.priority as TaskPriority;
      if (input.tags !== undefined) task.tags = input.tags as string[];
      data.tasks[idx] = task;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { output: task };
    }

    if (input.action === 'remove') {
      const data = ensureTaskFile(filePath);
      let tasks: UnifiedTask[];
      try {
        tasks = data.tasks.map(normalizeTask);
      } catch {
        return { output: null, error: 'Failed to parse task file.' };
      }
      if (!input.id) return { output: null, error: 'ID is required for remove action' };
      const idx = tasks.findIndex((t) => t.id === input.id);
      if (idx === -1) return { output: null, error: `Task with id "${input.id}" not found` };
      tasks.splice(idx, 1);
      tasks.forEach((t, i) => { t.order = i; });
      data.tasks = tasks as any;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { output: { success: true, id: input.id } };
    }

    if (input.action === 'complete') {
      const data = ensureTaskFile(filePath);
      let tasks: UnifiedTask[];
      try {
        tasks = data.tasks.map(normalizeTask);
      } catch {
        return { output: null, error: 'Failed to parse task file.' };
      }
      if (!input.id) return { output: null, error: 'ID is required for complete action' };
      const idx = tasks.findIndex((t) => t.id === input.id);
      if (idx === -1) return { output: null, error: `Task with id "${input.id}" not found` };
      const task = tasks[idx]!;
      task.status = 'done';
      task.completed_at = formatDate();
      data.tasks[idx] = task;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { output: task };
    }

    if (input.action === 'cancel') {
      const data = ensureTaskFile(filePath);
      let tasks: UnifiedTask[];
      try {
        tasks = data.tasks.map(normalizeTask);
      } catch {
        return { output: null, error: 'Failed to parse task file.' };
      }
      if (!input.id) return { output: null, error: 'ID is required for cancel action' };
      const idx = tasks.findIndex((t) => t.id === input.id);
      if (idx === -1) return { output: null, error: `Task with id "${input.id}" not found` };
      tasks[idx]!.status = 'canceled';
      data.tasks[idx] = tasks[idx]!;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { output: tasks[idx]! };
    }

    if (input.action === 'start') {
      const data = ensureTaskFile(filePath);
      let tasks: UnifiedTask[];
      try {
        tasks = data.tasks.map(normalizeTask);
      } catch {
        return { output: null, error: 'Failed to parse task file.' };
      }
      if (!input.id) return { output: null, error: 'ID is required for start action' };
      const idx = tasks.findIndex((t) => t.id === input.id);
      if (idx === -1) return { output: null, error: `Task with id "${input.id}" not found` };
      tasks[idx]!.status = 'in_progress';
      data.tasks[idx] = tasks[idx]!;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { output: tasks[idx]! };
    }

    if (input.action === 'reorder') {
      const data = ensureTaskFile(filePath);
      let tasks: UnifiedTask[];
      try {
        tasks = data.tasks.map(normalizeTask);
      } catch {
        return { output: null, error: 'Failed to parse task file.' };
      }
      const ids = input.ids;
      if (!ids || !ids.length) return { output: null, error: 'IDs array is required for reorder action' };
      const existingIds = new Set(tasks.map((t) => t.id));
      const validIds = ids.filter((id) => existingIds.has(id));
      if (validIds.length !== tasks.length) {
        return { output: null, error: `Not all task IDs exist. Missing: ${ids.filter((id) => !existingIds.has(id)).join(', ')}` };
      }
      tasks.sort((a, b) => validIds.indexOf(a.id) - validIds.indexOf(b.id));
      tasks.forEach((t, i) => { t.order = i; });
      data.tasks = tasks as any;
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      return { output: { reordered: true, count: validIds.length } };
    }

    return { output: null, error: `Unknown action: ${input.action}` };
  },
);
