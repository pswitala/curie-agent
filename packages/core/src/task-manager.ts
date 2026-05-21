/**
 * Unified task manager — replaces CronManager as the primary task store.
 * Manages tasks across both personal (~/.curie-agent/tasks.json) and project (<cwd>/tasks.json) scopes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { ScheduleType, TaskMode, TaskPriority, TaskScope, TaskStatus, UnifiedTask, TasksFile } from './unified-task.js';
import { scheduleLabel, createTaskDefaults, generateTaskId, taskTimestamp, pickNextSchedule, computeNextFire } from './unified-task.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_FILE = join(homedir(), '.curie-agent', 'tasks.json');
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// File I/O helpers
// ---------------------------------------------------------------------------

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
  return { $schema: 'tasks.schema.json', version: 1, tasks: [] };
}

function saveTasksFile(data: TasksFile, filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Callback types (for daemon integration)
// ---------------------------------------------------------------------------

type TaskFiredCallback = (task: UnifiedTask) => void | Promise<void>;

// ---------------------------------------------------------------------------
// TaskManager class
// ---------------------------------------------------------------------------

export class TaskManager {
  private data: TasksFile;
  /** TTL for pruning completed tasks. */
  private ttlMs: number;
  /** File path for persistence. */
  private filePath: string;
  /** Set of task IDs currently being executed (prevents re-firing). */
  private executing = new Set<string>();

  constructor(optTtlOrPath?: number | string, optFilePath?: string) {
    if (typeof optTtlOrPath === 'string') {
      this.filePath = optTtlOrPath;
      this.ttlMs = DEFAULT_TTL_MS;
    } else {
      this.ttlMs = optTtlOrPath ?? DEFAULT_TTL_MS;
      this.filePath = optFilePath ?? DEFAULT_FILE;
    }
    this.data = loadTasksFile(this.filePath);
    this.pruneOld(Date.now() - this.ttlMs);
  }

  /** Reload the file from disk. */
  load(): TasksFile {
    this.data = loadTasksFile(this.filePath);
    return this.data;
  }

  /** Persist to disk. */
  save(): void {
    saveTasksFile(this.data, this.filePath);
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
    const defaults = createTaskDefaults(options.mode, options.scope);
    const task: UnifiedTask = {
      id: generateTaskId(),
      title: options.title,
      description: options.description ?? '',
      status: 'scheduled_at' in options && options.scheduled_at ? (options.mode === 'manual' ? 'todo' : 'pending') : defaults.status,
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

    if (task.status === 'done' || task.status === 'canceled') {
      task.completed_at = taskTimestamp();
    }

    this.data.tasks.push(task);
    this.save();
    return task;
  }

  // -----------------------------------------------------------------------
  // Status updates
  // -----------------------------------------------------------------------

  /** Update a task's status and set completed_at if terminal. */
  updateTaskStatus(id: string, status: TaskStatus): boolean {
    const task = this.findTask(id);
    if (!task) return false;
    const oldStatus = task.status;
    task.status = status;

    const terminalStatuses: TaskStatus[] = ['done', 'canceled', 'completed', 'failed'];
    if (terminalStatuses.includes(status)) {
      task.completed_at = taskTimestamp();
    }

    // For recurring auto tasks with frequency, reset to pending instead of done
    if (task.frequency && status === 'done') {
      task.status = 'pending';
      delete task.completed_at;
    }

    this.save();
    return true;
  }

  /** Advance through the manual task lifecycle (todo → in_progress → done). */
  setTaskStatus(id: string, status: 'todo' | 'in_progress'): boolean {
    return this.updateTaskStatus(id, status);
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /** Find a single task by ID. */
  findTask(id: string): UnifiedTask | undefined {
    return this.data.tasks.find((t) => t.id === id);
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

  /** Get pending scheduled tasks that are due (mode=auto or notify with scheduled_at <= now). */
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
    const task = this.findTask(id);
    if (!task) return false;
    task.status = 'executing';
    this.executing.add(id);
    this.save();
    return true;
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
    const task = this.findTask(id);
    if (!task) return false;
    task.status = 'canceled';
    task.completed_at = taskTimestamp();
    this.save();
    return true;
  }

  /** Remove completed/fired/failed tasks (hard-delete). */
  clearCompleted(): number {
    const before = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter(
      (t) => t.status !== 'done' && t.status !== 'canceled' && t.status !== 'completed' && t.status !== 'failed',
    );
    const removed = before - this.data.tasks.length;
    if (removed > 0) {
      // Renormalize orders after removal
      this.renormalizeOrders();
      this.save();
    }
    return removed;
  }

  /** Remove a task permanently. */
  removeTask(id: string): boolean {
    const idx = this.data.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return false;
    this.data.tasks.splice(idx, 1);
    this.renormalizeOrders();
    this.save();
    return true;
  }

  /** Renormalize the `order` field for all tasks in scope. */
  private renormalizeOrders(): void {
    let order = 0;
    for (const task of this.data.tasks) {
      task.order = order++;
    }
  }

  // -----------------------------------------------------------------------
  // Pruning
  // -----------------------------------------------------------------------

  /** Remove completed tasks older than the cutoff. Pending/pending-like tasks always kept. */
  pruneOld(cutoff: number): number {
    const before = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter(
      (t) => t.status === 'pending' || (t.scheduled_at && t.scheduled_at > cutoff) || t.created_at > new Date(cutoff).toISOString(),
    );
    // Actually, prune by timestamp: keep pending tasks forever, remove old completed ones
    this.data.tasks = this.data.tasks.filter((t) => {
      if (t.status === 'pending') return true;
      if (!t.completed_at) return t.created_at > new Date(cutoff).toISOString();
      const completedTime = new Date(t.completed_at).getTime();
      return completedTime >= cutoff;
    });
    const removed = before - this.data.tasks.length;
    if (removed > 0) {
      this.renormalizeOrders();
      this.save();
    }
    return removed;
  }

  /** Count of pending tasks. */
  get pendingCount(): number {
    return this.data.tasks.filter((t) => t.status === 'pending').length;
  }

  // -----------------------------------------------------------------------
  // Heartbeat helpers
  // -----------------------------------------------------------------------

  /** Check if a task is a recurring heartbeat (auto mode with frequency). */
  isHeartbeat(task: UnifiedTask): boolean {
    return task.mode === 'auto' && task.frequency !== null;
  }

  /** Get all pending heartbeat tasks. */
  getHeartbeats(): UnifiedTask[] {
    return this.data.tasks.filter((t) => t.mode === 'auto' && t.frequency !== null && t.status === 'pending');
  }

  // -----------------------------------------------------------------------
  // Heartbeat schedule management
  // -----------------------------------------------------------------------

  /**
   * Evaluate all five heartbeat schedule settings and ensure exactly one
   * pending auto+frequency task exists in the store. Called after settings change.
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

    // Find existing heartbeat task for this schedule type
    let existing = this.getHeartbeats().find(t => t.frequency?.type === picked.type);
    if (existing) {
      existing.frequency = picked;
      existing.scheduled_at = computeNextFire(picked, ref);
      this.save();
    } else {
      this.create({
        title: `Heartbeat: ${scheduleLabel(picked.type)}`,
        mode: 'auto',
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
