/**
 * Unified task manager — the single owner of the task store.
 * Manages tasks across both personal (~/.curie-agent/tasks.json) and project (<cwd>/tasks.json) scopes.
 *
 * Two invariants matter here:
 *  1. Nothing is ever deleted automatically. Only explicit user actions
 *     (`removeTask`, `clearCompleted`) drop a task.
 *  2. Every write goes through `mutate()`, which re-reads the file if another
 *     process touched it since our last read. Without this, two in-memory
 *     copies of the task array silently overwrite each other's work.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import type { ScheduleType, TaskMode, TaskPriority, TaskScope, TaskStatus, UnifiedTask, TasksFile } from './unified-task.js';
import { scheduleLabel, generateTaskId, taskTimestamp, pickNextSchedule, computeNextFire } from './unified-task.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FILE = join(homedir(), '.curie-agent', 'tasks.json');

/** Minimum length accepted for an ID-prefix lookup. */
const MIN_PREFIX_LENGTH = 4;

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

function emptyFile(): TasksFile {
  return { $schema: 'tasks.schema.json', version: 1, tasks: [] };
}

function loadTasksFile(filePath: string): TasksFile {
  if (existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
      if (typeof parsed === 'object' && parsed !== null && 'tasks' in parsed && Array.isArray((parsed as TasksFile).tasks)) {
        return parsed as TasksFile;
      }
    } catch {
      /* corrupt — start fresh */
    }
  }
  return emptyFile();
}

/** Write via temp file + rename so a crash mid-write can't truncate the store. */
function saveTasksFile(data: TasksFile, filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmpPath, filePath);
}

/**
 * Cheap fingerprint of the file on disk. mtime alone can collide when two
 * writes land inside the same millisecond, so size is folded in.
 */
function fingerprint(filePath: string): string {
  try {
    const stat = statSync(filePath);
    return `${String(stat.mtimeMs)}:${String(stat.size)}`;
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// TaskManager class
// ---------------------------------------------------------------------------

export class TaskManager {
  private data: TasksFile;
  /** File path for persistence. */
  private filePath: string;
  /** Fingerprint of the file as of our last read/write — used to detect foreign writes. */
  private seenFingerprint = '';
  /** Set of task IDs currently being executed (prevents re-firing). */
  private executing = new Set<string>();

  constructor(filePath: string = DEFAULT_FILE) {
    this.filePath = filePath;
    this.data = loadTasksFile(this.filePath);
    this.seenFingerprint = fingerprint(this.filePath);
  }

  /** Reload the file from disk. */
  load(): TasksFile {
    this.data = loadTasksFile(this.filePath);
    this.seenFingerprint = fingerprint(this.filePath);
    return this.data;
  }

  /**
   * Persist the in-memory array as-is. Prefer the mutating methods below —
   * they reload first, so they can't clobber another writer's changes.
   */
  save(): void {
    saveTasksFile(this.data, this.filePath);
    this.seenFingerprint = fingerprint(this.filePath);
  }

  /** Re-read the file if someone else wrote it since we last looked. */
  private refreshIfStale(): void {
    const current = fingerprint(this.filePath);
    if (current !== '' && current !== this.seenFingerprint) {
      this.data = loadTasksFile(this.filePath);
      this.seenFingerprint = current;
    }
  }

  /**
   * The only write path: reload-if-stale → mutate → persist.
   * All lookups must happen inside `fn`, since a refresh replaces the array.
   */
  private mutate<T>(fn: () => T): T {
    this.refreshIfStale();
    const result = fn();
    this.save();
    return result;
  }

  // -----------------------------------------------------------------------
  // Creation
  // -----------------------------------------------------------------------

  /** Create a new task with the given mode and scope. */
  create(options: {
    title: string;
    description?: string;
    mode: TaskMode;
    scope: TaskScope;
    priority?: TaskPriority;
    tags?: string[];
    scheduled_at?: number;
    frequency?: { type: ScheduleType; value: string } | null;
    metadata?: Record<string, unknown>;
  }): UnifiedTask {
    return this.mutate(() => {
      const task: UnifiedTask = {
        id: generateTaskId(),
        title: options.title,
        description: options.description ?? '',
        // human tasks land on the todo list; agent/notify tasks wait for the scheduler
        status: options.mode === 'human' ? 'todo' : 'pending',
        priority: options.priority ?? 'medium',
        tags: options.tags ?? [],
        mode: options.mode,
        scheduled_at: options.scheduled_at,
        frequency: options.frequency ?? null,
        scope: options.scope,
        metadata: options.metadata,
        order: this.data.tasks.length,
        created_at: taskTimestamp(),
        completed_at: undefined,
      };

      this.data.tasks.push(task);
      return task;
    });
  }

  // -----------------------------------------------------------------------
  // Status updates
  // -----------------------------------------------------------------------

  /** Update a task's status and set completed_at if terminal. */
  updateTaskStatus(id: string, status: TaskStatus): boolean {
    return this.mutate(() => {
      const task = this.findTask(id);
      if (!task) return false;
      task.status = status;

      const terminalStatuses: TaskStatus[] = ['done', 'canceled', 'completed', 'failed'];
      if (terminalStatuses.includes(status)) {
        task.completed_at = taskTimestamp();
      }

      // Recurring tasks never reach a terminal state — they re-arm instead.
      if (task.frequency && status === 'done') {
        task.status = 'pending';
        delete task.completed_at;
      }

      return true;
    });
  }

  /** Advance through the manual task lifecycle (todo → in_progress → done). */
  setTaskStatus(id: string, status: 'todo' | 'in_progress'): boolean {
    return this.updateTaskStatus(id, status);
  }

  /**
   * Apply a partial patch to a task. Use this instead of mutating the object
   * returned by `findTask()` and calling `save()` — that pattern races.
   */
  updateTask(id: string, patch: Partial<Omit<UnifiedTask, 'id'>>): UnifiedTask | undefined {
    return this.mutate(() => {
      const task = this.findTask(id);
      if (!task) return undefined;
      Object.assign(task, patch);
      return task;
    });
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /**
   * Find a single task by ID. Falls back to a unique prefix match, so the
   * truncated IDs shown by `/todo list` and `/cron list` are usable directly.
   * Ambiguous prefixes resolve to undefined rather than an arbitrary task.
   */
  findTask(id: string): UnifiedTask | undefined {
    if (!id) return undefined;
    const exact = this.data.tasks.find((t) => t.id === id);
    if (exact) return exact;
    if (id.length < MIN_PREFIX_LENGTH) return undefined;
    const matches = this.data.tasks.filter((t) => t.id.startsWith(id));
    return matches.length === 1 ? matches[0] : undefined;
  }

  /** List tasks with optional filters. */
  list(options?: {
    status?: TaskStatus;
    mode?: TaskMode;
    scope?: TaskScope;
    priority?: TaskPriority;
  }): UnifiedTask[] {
    let tasks = [...this.data.tasks];

    if (options?.status) tasks = tasks.filter((t) => t.status === options.status);
    if (options?.mode) tasks = tasks.filter((t) => t.mode === options.mode);
    if (options?.scope) tasks = tasks.filter((t) => t.scope === options.scope);
    if (options?.priority) tasks = tasks.filter((t) => t.priority === options.priority);

    // Sort: active first (backlog/todo/in_progress/pending), then done/canceled
    const activeStatuses = new Set(['backlog', 'todo', 'in_progress', 'pending']);
    tasks.sort((a, b) => {
      const aActive = activeStatuses.has(a.status) ? 0 : 1;
      const bActive = activeStatuses.has(b.status) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return a.order - b.order;
    });

    return tasks;
  }

  /** Get pending scheduled tasks that are due (mode=agent or notify with scheduled_at <= now). */
  getNextTasks(now?: number): UnifiedTask[] {
    const reference = now ?? Date.now();
    return this.data.tasks.filter((t) => {
      if (t.status !== 'pending') return false;
      if (!t.scheduled_at) return false;
      if (this.executing.has(t.id)) return false;
      return t.scheduled_at <= reference;
    });
  }

  // -----------------------------------------------------------------------
  // Lifecycle helpers (for daemon integration)
  // -----------------------------------------------------------------------

  /** Mark a task as currently executing. */
  markExecuting(id: string): boolean {
    const marked = this.mutate(() => {
      const task = this.findTask(id);
      if (!task) return false;
      task.status = 'executing';
      return true;
    });
    if (marked) this.executing.add(id);
    return marked;
  }

  /** Clear executing flag for a task. */
  clearExecuting(id: string): void {
    this.executing.delete(id);
  }

  // -----------------------------------------------------------------------
  // Deletion
  // -----------------------------------------------------------------------

  /** Cancel (soft-delete) a pending/fired task. */
  cancelTask(id: string): boolean {
    return this.mutate(() => {
      const task = this.findTask(id);
      if (!task) return false;
      task.status = 'canceled';
      task.completed_at = taskTimestamp();
      return true;
    });
  }

  /**
   * Remove completed/canceled/failed tasks (hard-delete).
   * Explicit user action only — nothing calls this on a timer.
   */
  clearCompleted(): number {
    return this.mutate(() => {
      const before = this.data.tasks.length;
      this.data.tasks = this.data.tasks.filter(
        (t) => t.status !== 'done' && t.status !== 'canceled' && t.status !== 'completed' && t.status !== 'failed',
      );
      const removed = before - this.data.tasks.length;
      if (removed > 0) {
        this.renormalizeOrders();
      }
      return removed;
    });
  }

  /** Remove a task permanently. */
  removeTask(id: string): boolean {
    return this.mutate(() => {
      const task = this.findTask(id);
      if (!task) return false;
      const idx = this.data.tasks.indexOf(task);
      if (idx === -1) return false;
      this.data.tasks.splice(idx, 1);
      this.renormalizeOrders();
      return true;
    });
  }

  /** Reorder tasks to match the given ID sequence. IDs not listed keep their relative order. */
  reorder(ids: string[]): number {
    return this.mutate(() => {
      const rank = new Map<string, number>();
      ids.forEach((id, i) => {
        const task = this.findTask(id);
        if (task) rank.set(task.id, i);
      });
      if (rank.size === 0) return 0;
      const fallback = rank.size;
      this.data.tasks.sort((a, b) => (rank.get(a.id) ?? fallback + a.order) - (rank.get(b.id) ?? fallback + b.order));
      this.renormalizeOrders();
      return rank.size;
    });
  }

  /** Renormalize the `order` field for all tasks in scope. */
  private renormalizeOrders(): void {
    let order = 0;
    for (const task of this.data.tasks) {
      task.order = order++;
    }
  }

  /** Count of pending tasks. */
  get pendingCount(): number {
    return this.data.tasks.filter((t) => t.status === 'pending').length;
  }

  // -----------------------------------------------------------------------
  // Heartbeat helpers
  // -----------------------------------------------------------------------

  /** Check if a task is a recurring heartbeat (agent mode with a frequency). */
  isHeartbeat(task: UnifiedTask): boolean {
    return task.mode === 'agent' && task.frequency !== null && task.frequency !== undefined;
  }

  /** Get all pending heartbeat tasks. */
  getHeartbeats(): UnifiedTask[] {
    return this.data.tasks.filter((t) => t.mode === 'agent' && t.frequency !== null && t.frequency !== undefined && t.status === 'pending');
  }

  // -----------------------------------------------------------------------
  // Heartbeat schedule management
  // -----------------------------------------------------------------------

  /**
   * Evaluate all five heartbeat schedule settings and ensure exactly one
   * pending agent+frequency task exists in the store. Called after settings change.
   *
   * If the winning schedule is unchanged, `scheduled_at` is left alone —
   * recomputing it from "now" on every config change silently skips the slot
   * the user was waiting for.
   */
  rescheduleFromSettings(settings: {
    HEARTBEAT_INTRADAY?: string;
    HEARTBEAT_DAILY?: string;
    HEARTBEAT_WEEKLY?: string;
    HEARTBEAT_MONTHLY?: string;
    HEARTBEAT_DREAMING?: string;
  }, now?: number): void {
    const ref = now ?? Date.now();
    const picked = pickNextSchedule(settings, ref);
    if (!picked) return;

    const all = this.getHeartbeats();
    const [primary, ...extras] = all;
    for (const extra of extras) {
      this.updateTaskStatus(extra.id, 'canceled');
    }

    if (primary) {
      const alreadyArmed = primary.frequency?.type === picked.type && primary.frequency.value === picked.value;
      if (alreadyArmed) return;
      this.updateTask(primary.id, {
        frequency: picked,
        title: `Heartbeat: ${scheduleLabel(picked.type)}`,
        scheduled_at: computeNextFire(picked, ref),
      });
    } else {
      this.create({
        title: `Heartbeat: ${scheduleLabel(picked.type)}`,
        mode: 'agent',
        scope: 'personal',
        scheduled_at: computeNextFire(picked, ref),
        frequency: picked,
      });
    }
  }

  /** Cancel all pending heartbeat tasks. Returns count cancelled. */
  cancelAllHeartbeats(): number {
    const hbs = this.getHeartbeats();
    let count = 0;
    for (const hb of hbs) {
      this.updateTaskStatus(hb.id, 'canceled');
      count++;
    }
    return count;
  }
}

// ---------------------------------------------------------------------------
// Process-shared instances
// ---------------------------------------------------------------------------

const instances = new Map<string, TaskManager>();

/**
 * Get the process-shared TaskManager for a store path. Every writer in a
 * process must go through this — separate instances hold separate copies of
 * the task array and overwrite each other on save.
 */
export function getTaskManager(filePath?: string): TaskManager {
  const key = resolve(filePath ?? DEFAULT_FILE);
  let instance = instances.get(key);
  if (!instance) {
    instance = new TaskManager(key);
    instances.set(key, instance);
  }
  return instance;
}

/** Drop all memoized instances. Test helper. */
export function resetTaskManagers(): void {
  instances.clear();
}
