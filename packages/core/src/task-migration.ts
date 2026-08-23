/**
 * Migration utilities.
 *
 * - `migrateTasks()` — one-shot merge of legacy todo.json + cron.json into tasks.json.
 * - `repairTaskShapes()` — idempotent in-place fix-up of tasks written by older
 *   versions, run on every startup.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { TaskMode, TaskPriority, TaskScope, UnifiedTask, TasksFile } from './unified-task.js';
import { taskTimestamp } from './unified-task.js';

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
    case 'task': return 'agent';
    case 'heartbeat': return 'agent';
    default: return 'agent';
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

  // Migrate todo.json → human tasks.
  // An explicit path replaces the home default rather than adding to it —
  // otherwise every caller (including tests) also pulls in the user's personal store.
  const todoPaths = oldTodoPath ? [oldTodoPath] : [join(homedir(), '.curie-agent', 'todo.json')];
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
        mode: 'human',
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

  // Migrate cron.json → agent/notify tasks
  const cronPaths = oldCronPath ? [oldCronPath] : [join(homedir(), '.curie-agent', 'cron.json')];
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

// ---------------------------------------------------------------------------
// Shape repair (idempotent, runs on every startup)
// ---------------------------------------------------------------------------

/** Legacy mode names → current TaskMode. */
const MODE_ALIASES: Record<string, TaskMode> = {
  auto: 'agent',
  manual: 'human',
};

export interface RepairReport {
  /** Tasks whose `mode` was renamed. */
  modesRenamed: number;
  /** Scheduled non-human tasks lifted out of an unfireable status. */
  statusesFixed: number;
  /** Missing/invalid scalar fields given defaults. */
  fieldsFilled: number;
  /** Modes we did not recognise and deliberately left alone. */
  unknownModes: string[];
}

const VALID_STATUSES: UnifiedTask['status'][] = [
  'backlog', 'todo', 'in_progress', 'done', 'canceled', 'pending', 'executing', 'completed', 'failed',
];
const VALID_PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'critical'];

/**
 * Repair tasks written by older versions, in place.
 *
 * Two shapes exist in real stores and neither can ever fire:
 *  - `mode: 'auto'` — renamed to `'agent'`. `normalizeTask()` in the Todo tool
 *    coerces unrecognised modes to `'human'`, which silently demoted scheduled
 *    tasks into inert todo-list items.
 *  - a scheduled `agent`/`notify` task sitting on `status: 'todo'` — the
 *    scheduler only ever looks at `'pending'`.
 *
 * Unknown modes are reported, not rewritten — a silent coercion is what caused
 * the original data loss.
 */
export function repairTaskShapes(tasksPath?: string): RepairReport | null {
  const target = tasksPath ?? join(homedir(), '.curie-agent', 'tasks.json');
  if (!existsSync(target)) return null;

  let file: TasksFile;
  try {
    const parsed = JSON.parse(readFileSync(target, 'utf-8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as TasksFile).tasks)) return null;
    file = parsed as TasksFile;
  } catch {
    return null; // corrupt — leave it for a human to look at
  }

  const report: RepairReport = { modesRenamed: 0, statusesFixed: 0, fieldsFilled: 0, unknownModes: [] };
  const knownModes: TaskMode[] = ['human', 'agent', 'notify'];

  file.tasks.forEach((task, index) => {
    const raw = task as unknown as Record<string, unknown>;

    // --- mode ---------------------------------------------------------
    const rawMode = typeof raw.mode === 'string' ? raw.mode : '';
    const alias = MODE_ALIASES[rawMode];
    if (alias) {
      task.mode = alias;
      report.modesRenamed++;
    } else if (rawMode === '') {
      // Absent mode predates the unified model — those were all todo items.
      task.mode = 'human';
      report.fieldsFilled++;
    } else if (!knownModes.includes(rawMode as TaskMode)) {
      if (!report.unknownModes.includes(rawMode)) report.unknownModes.push(rawMode);
      return; // don't touch a task we don't understand
    }

    // --- required scalars ---------------------------------------------
    if (!VALID_STATUSES.includes(task.status)) {
      task.status = task.mode === 'human' ? 'todo' : 'pending';
      report.fieldsFilled++;
    }
    if (!VALID_PRIORITIES.includes(task.priority)) {
      task.priority = 'medium';
      report.fieldsFilled++;
    }
    if (!Array.isArray(task.tags)) {
      task.tags = [];
      report.fieldsFilled++;
    }
    if (typeof task.order !== 'number') {
      task.order = index;
      report.fieldsFilled++;
    }
    if (typeof task.created_at !== 'string' || !task.created_at) {
      task.created_at = taskTimestamp();
      report.fieldsFilled++;
    }
    if (raw.completed_at === null) {
      delete raw.completed_at;
      report.fieldsFilled++;
    }
    if (raw.frequency === undefined) {
      task.frequency = null;
      report.fieldsFilled++;
    }

    // --- fireability --------------------------------------------------
    // A scheduled agent/notify task must be 'pending' or the checker skips it forever.
    if (task.mode !== 'human' && task.scheduled_at && (task.status === 'todo' || task.status === 'backlog')) {
      task.status = 'pending';
      report.statusesFixed++;
    }
  });

  if (report.modesRenamed === 0 && report.statusesFixed === 0 && report.fieldsFilled === 0) return report;

  const tmpPath = `${target}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf-8');
  renameSync(tmpPath, target);
  return report;
}
