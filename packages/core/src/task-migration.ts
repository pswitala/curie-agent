/**
 * Migration utility: reads old todo.json and cron.json, writes tasks.json.
 * Runs once — if tasks.json already exists, migration is skipped.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { TaskMode, TaskPriority, TaskScope, UnifiedTask, TasksFile } from './unified-task.js';
import { generateTaskId, taskTimestamp } from './unified-task.js';

// ---------------------------------------------------------------------------
// Type definitions for legacy files
// ---------------------------------------------------------------------------

interface LegacyTodoFile {
  $schema: string;
  version: number;
  tasks: Array<{
    id: string;
    title: string;
    description?: string;
    status?: string;           // 'backlog' | 'todo' | 'in_progress' | 'done' | 'canceled'
    priority?: string;         // 'low' | 'medium' | 'high' | 'critical'
    tags?: string[];
    order?: number;
    created_at?: string;
    completed_at?: string | null;
  }>;
}

interface LegacyCronFile {
  version: number;
  tasks: Array<{
    id: string;
    type: string;              // 'reminder' | 'heartbeat' | 'task'
    scheduledAt: number;
    message: string;
    schedule?: { type: string; value: string };
    status: string;            // 'pending' | 'fired' | 'executing' | 'completed' | 'failed' | 'cancelled'
    createdAt: number;
    completedAt?: number;
    sessionId?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Status mappings
// ---------------------------------------------------------------------------

/** Map old todo.json status → UnifiedTask status. */
function mapTodoStatus(status: string): UnifiedTask['status'] {
  switch (status) {
    case 'backlog': return 'backlog';
    case 'todo': return 'todo';
    case 'in_progress': return 'in_progress';
    case 'done': return 'done';
    case 'canceled': return 'canceled';
    default: return 'todo';
  }
}

/** Map old cron.json type → UnifiedTask mode. */
function mapCronType(type: string): TaskMode {
  switch (type) {
    case 'reminder': return 'notify';
    case 'task': return 'auto';
    case 'heartbeat': return 'auto';
    default: return 'auto';
  }
}

/** Map old cron.json status → UnifiedTask status. */
function mapCronStatus(status: string): UnifiedTask['status'] {
  switch (status) {
    case 'pending': return 'pending';
    case 'fired': return 'done';       // already notified
    case 'executing': return 'pending'; // still pending in new model (daemon will run it)
    case 'completed': return 'done';
    case 'failed': return 'canceled';
    case 'cancelled': return 'canceled';
    default: return 'pending';
  }
}

// ---------------------------------------------------------------------------
// Migration functions
// ---------------------------------------------------------------------------

function readLegacyTodo(filePath: string): LegacyTodoFile | null {
  if (!filePath) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as LegacyTodoFile;
  } catch {
    return null;
  }
}

function readLegacyCron(filePath: string): LegacyCronFile | null {
  if (!filePath) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as LegacyCronFile;
  } catch {
    return null;
  }
}

/**
 * Main migration: merges todo.json and cron.json into tasks.json.
 */
export function migrateTasks(oldTodoPath?: string, oldCronPath?: string, newTasksPath?: string): TasksFile | null {
  const target = newTasksPath || join(homedir(), '.curie-agent', 'tasks.json');

  // Skip if already migrated (file exists)
  try {
    if (readFileSync(target, 'utf-8').trim().length > 0) return null;
  } catch {
    /* target doesn't exist yet — proceed */
  }

  const newFile: TasksFile = { $schema: 'tasks.schema.json', version: 1, tasks: [] };
  let order = 0;

  // Migrate todo.json → manual tasks
  const todoPaths = [oldTodoPath, join(homedir(), '.curie-agent', 'todo.json')].filter(Boolean) as string[];
  for (const filePath of todoPaths) {
    const legacy = readLegacyTodo(filePath);
    if (!legacy) continue;

    const scope: TaskScope = filePath.includes('.curie-agent') ? 'personal' : 'project';
    for (const t of legacy.tasks || []) {
      newFile.tasks.push({
        id: t.id,
        title: t.title,
        description: t.description ?? '',
        status: mapTodoStatus(t.status ?? ''),
        priority: (t.priority as TaskPriority) ?? 'medium',
        tags: t.tags ?? [],
        mode: 'manual',
        scheduled_at: undefined,
        frequency: null,
        result: undefined,
        scope,
        order: order++,
        created_at: t.created_at ?? taskTimestamp(),
        completed_at: t.status === 'done' ? new Date().toISOString() : undefined,
      });
    }
  }

  // Migrate cron.json → auto/notify tasks
  const cronPaths = [oldCronPath, join(homedir(), '.curie-agent', 'cron.json')].filter(Boolean) as string[];
  for (const filePath of cronPaths) {
    const legacy = readLegacyCron(filePath);
    if (!legacy) continue;

    for (const t of legacy.tasks || []) {
      // Skip already-fired tasks from migration (they've been delivered)
      const status = mapCronStatus(t.status);
      if (status === 'done' && !t.message.includes('Heartbeat')) continue;

      newFile.tasks.push({
        id: t.id,
        title: t.message,
        description: '',
        status,
        priority: 'medium',
        tags: [],
        mode: mapCronType(t.type),
        scheduled_at: t.scheduledAt || undefined,
        frequency: t.schedule ? { type: t.schedule.type as any, value: t.schedule.value } : null,
        result: t.status === 'completed' ? `Completed (${t.message})` : undefined,
        scope: 'personal',     // cron tasks are always personal
        order: order++,
        created_at: new Date(t.createdAt).toISOString(),
        completed_at: status === 'done' || status === 'canceled' ? new Date().toISOString() : undefined,
      });
    }
  }

  if (!newFile.tasks.length) return null; // nothing to migrate

  writeFileSync(target, JSON.stringify(newFile, null, 2), 'utf-8');
  return newFile;
}
