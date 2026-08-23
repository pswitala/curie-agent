/**
 * Todo tool — manages structured task lists.
 *
 * All reads and writes go through the process-shared TaskManager, so this tool,
 * the daemon scheduler, and the `todo.*` RPC handlers can never overwrite each
 * other. Legacy `todo.json` files are still honoured when present; new stores
 * are created as `tasks.json`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createTool, expandPath, type ToolContext } from './tool.js';
import { getTaskManager, repairTaskShapes } from '@curie-agent/core';
import type { UnifiedTask } from '@curie-agent/core';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const ACTION_VALUES = ['list', 'add', 'edit', 'remove', 'complete', 'cancel', 'start', 'reorder'] as const;

const TodoSchema = z.object({
  action: z.enum(ACTION_VALUES).describe('Action: list, add, edit, remove, complete, cancel, start, reorder'),
  scope: z.enum(['personal', 'project']).describe('Scope: personal (~/.curie-agent/tasks.json) or project (<cwd>/tasks.json)'),
  id: z.string().optional().describe('Task ID or unique ID prefix (required for edit, remove, complete, cancel, start)'),
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
// Store resolution
// ---------------------------------------------------------------------------

/**
 * Resolve which file backs a scope. Prefers the unified `tasks.json`, falls
 * back to an existing legacy `todo.json`, and defaults new stores to
 * `tasks.json`.
 */
function resolveScopePath(scope: 'personal' | 'project', cwd: string): string {
  const dir = scope === 'personal' ? path.join(expandPath('~'), '.curie-agent') : cwd;
  const unified = path.join(dir, 'tasks.json');
  if (fs.existsSync(unified)) return unified;
  const legacy = path.join(dir, 'todo.json');
  if (fs.existsSync(legacy)) return legacy;
  return unified;
}

/** Open the shared manager for a scope, repairing legacy shapes first. */
function openStore(scope: 'personal' | 'project', cwd: string) {
  const filePath = resolveScopePath(scope, cwd);
  repairTaskShapes(filePath);
  const manager = getTaskManager(filePath);
  manager.load();
  return manager;
}

const NOT_FOUND = (id: string) => `Task with id "${id}" not found`;

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export const todoTool = createTool(
  'Todo',
  'Manages a structured JSON-based task list with add, edit, remove, complete, cancel, start, reorder, and list actions. Tasks can be manual (todo list), agent (LLM executes at scheduled time), or notify (reminder notification only). Defaults to manual mode unless a time is specified.',
  TodoSchema,
  async (input: TodoInput, ctx: ToolContext) => {
    const store = openStore(input.scope, ctx.cwd);

    switch (input.action) {
      case 'list': {
        let tasks = store.list({
          status: input.filter_status,
          priority: input.filter_priority,
        });
        if (input.tags && input.tags.length > 0) {
          const wanted = input.tags;
          tasks = tasks.filter((t) => wanted.every((tag) => t.tags.includes(tag)));
        }
        tasks = [...tasks].sort((a, b) => a.order - b.order);
        return { output: tasks };
      }

      case 'add': {
        if (!input.title) return { output: null, error: 'Title is required for add action' };
        const task = store.create({
          title: input.title,
          description: input.description,
          mode: 'human',
          scope: input.scope,
          priority: input.priority,
          tags: input.tags,
        });
        return { output: task };
      }

      case 'edit': {
        if (!input.id) return { output: null, error: 'ID is required for edit action' };
        const patch: Partial<Omit<UnifiedTask, 'id'>> = {};
        if (input.title !== undefined) patch.title = input.title;
        if (input.description !== undefined) patch.description = input.description;
        if (input.status !== undefined) patch.status = input.status;
        if (input.priority !== undefined) patch.priority = input.priority;
        if (input.tags !== undefined) patch.tags = input.tags;
        const updated = store.updateTask(input.id, patch);
        if (!updated) return { output: null, error: NOT_FOUND(input.id) };
        return { output: updated };
      }

      case 'remove': {
        if (!input.id) return { output: null, error: 'ID is required for remove action' };
        const task = store.findTask(input.id);
        if (!task) return { output: null, error: NOT_FOUND(input.id) };
        const removedId = task.id;
        store.removeTask(removedId);
        return { output: { success: true, id: removedId } };
      }

      case 'complete':
      case 'cancel':
      case 'start': {
        if (!input.id) return { output: null, error: `ID is required for ${input.action} action` };
        const task = store.findTask(input.id);
        if (!task) return { output: null, error: NOT_FOUND(input.id) };
        const nextStatus = input.action === 'complete' ? 'done' : input.action === 'cancel' ? 'canceled' : 'in_progress';
        store.updateTaskStatus(task.id, nextStatus);
        return { output: store.findTask(task.id) };
      }

      case 'reorder': {
        const ids = input.ids;
        if (!ids || ids.length === 0) return { output: null, error: 'IDs array is required for reorder action' };
        const missing = ids.filter((id) => !store.findTask(id));
        if (missing.length > 0) {
          return { output: null, error: `Not all task IDs exist. Missing: ${missing.join(', ')}` };
        }
        const count = store.reorder(ids);
        return { output: { reordered: true, count } };
      }

      default:
        return { output: null, error: `Unknown action: ${String(input.action)}` };
    }
  },
);
