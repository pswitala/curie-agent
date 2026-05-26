/**
 * Unified task types shared across all curie-agent packages.
 * Replaces the separate TodoTask (todo.json) and CronTask (cron.json) models.
 */

// ---------------------------------------------------------------------------
// Schedule type (kept from cron-manager for heartbeat recurring tasks)
// ---------------------------------------------------------------------------

export type ScheduleType = 'intraday' | 'daily' | 'weekly' | 'monthly' | 'dreaming';

/** Human-readable label for a schedule type. */
export function scheduleLabel(type: ScheduleType): string {
  return type.toUpperCase();
}

// ---------------------------------------------------------------------------
// UnifiedTask fields (the single task model)
// ---------------------------------------------------------------------------

export type TaskMode = 'human' | 'agent' | 'notify';
export const TASK_MODES: readonly TaskMode[] = ['human', 'agent', 'notify'];

/** Statuses used by different modes. Includes execution states from daemon integration. */
export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'canceled' | 'pending' | 'executing' | 'completed' | 'failed';
export const TASK_STATUSES: readonly TaskStatus[] = [
  'backlog', 'todo', 'in_progress', 'done', 'canceled', 'pending',
];

/** Priority levels. */
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

/** Scope — which file the task lives in. */
export type TaskScope = 'personal' | 'project';

// ---------------------------------------------------------------------------
// Main interfaces
// ---------------------------------------------------------------------------

export interface UnifiedTask {
  /** UUID v4 identifier. */
  id: string;

  /** Short human-readable title. */
  title: string;

  /** Optional longer description. */
  description: string;

  // Lifecycle — extended to cover all modes
  status: TaskStatus;

  // Priority & discovery (already in Todo)
  priority: TaskPriority;
  tags: string[];

  /** Execution mode — the key unifier. */
  mode: TaskMode;
  //   human  = todo list item (human does it)          — replaces current Todo
  //   agent  = LLM executes at scheduled_at             — replaces CronTask type='task' + heartbeat
  //   notify = reminder notification only               — replaces CronTask type='reminder'

  /** Execution result summary (agent mode only, after LLM completes). */
  result?: string;

  /** Spawn overrides stored when scheduling from WebUI (provider, model, effort, etc.). */
  metadata?: Record<string, unknown>;

  // Timing
  /** When the task should fire (epoch ms). Required for auto/notify. Optional for manual. */
  scheduled_at?: number;

  /** Recurring schedule — only meaningful for mode='agent'. Defines heartbeat-like tasks. */
  frequency?: { type: ScheduleType; value: string } | null;

  // Scope tracking
  scope: TaskScope;

  // Metadata (used by human tasks, not relevant for auto/notify)
  order: number;
  created_at: string;
  completed_at?: string;
  last_run?: number;            // epoch ms — only meaningful for recurring auto tasks
}

export interface TasksFile {
  $schema: string;
  version: number;
  tasks: UnifiedTask[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Default task creation shape for new tasks (mode-dependent defaults). */
export function createTaskDefaults(mode: TaskMode, scope: TaskScope): Omit<UnifiedTask, 'id' | 'title' | 'description'> {
  if (mode === 'human') {
    return { status: 'todo', priority: 'medium' as const, tags: [], mode, frequency: null, scope, order: 0, created_at: new Date().toISOString(), completed_at: undefined };
  }
  // auto / notify
  return { status: 'pending', priority: 'medium' as const, tags: [], mode, frequency: null, scope, order: 0, created_at: new Date().toISOString() };
}

/** Generate a UUID v4. */
export function generateTaskId(): string {
  return crypto.randomUUID();
}

/** ISO timestamp for created_at / completed_at. */
export function taskTimestamp(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Schedule math (previously in cron-manager)
// ---------------------------------------------------------------------------

/** Parse "H:MM" into { hour, minute }. */
function parseTime(value: string): { hour: number; minute: number } | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = parseInt(match[1] ?? '0', 10);
  const minute = parseInt(match[2] ?? '0', 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/** Parse "day@H:MM" into { day, hour, minute }. */
function parseWeekly(value: string): { day: number; hour: number; minute: number } | null {
  const atIdx = value.indexOf('@');
  if (atIdx < 0) return null;
  const dayStr = value.slice(0, atIdx).toLowerCase();
  const timeStr = value.slice(atIdx + 1);
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const day = dayNames.indexOf(dayStr);
  if (day < 0) return null;
  const time = parseTime(timeStr);
  if (!time) return null;
  return { day, ...time };
}

/** Parse "D@H:MM" into { dayOfMonth, hour, minute }. */
function parseMonthly(value: string): { dayOfMonth: number; hour: number; minute: number } | null {
  const atIdx = value.indexOf('@');
  if (atIdx < 0) return null;
  const dayStr = value.slice(0, atIdx);
  const dayOfMonth = parseInt(dayStr, 10);
  if (isNaN(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) return null;
  const time = parseTime(value.slice(atIdx + 1));
  if (!time) return null;
  return { dayOfMonth, ...time };
}

/** Compute the next fire time for a schedule. Returns epoch ms. */
export function computeNextFire(schedule: { type: ScheduleType; value: string } | null, now?: number): number {
  const reference = now ?? Date.now();
  if (!schedule) return reference;
  const { type, value } = schedule;
  if (!value) return reference;

  if (type === 'intraday') {
    const tokens = value.split(',').map((s) => s.trim()).filter(Boolean);
    const slots: { hour: number; minute: number }[] = [];
    for (const token of tokens) {
      const t = parseTime(token);
      if (t) slots.push(t);
    }
    if (slots.length === 0) return reference;
    slots.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
    const firstSlot = slots[0]!;
    const base = new Date(reference);
    for (const slot of slots) {
      const candidate = new Date(base);
      candidate.setHours(slot.hour, slot.minute, 0, 0);
      if (candidate.getTime() > reference) return candidate.getTime();
    }
    // All slots passed today — use first slot tomorrow
    const tomorrow = new Date(base);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(firstSlot.hour, firstSlot.minute, 0, 0);
    return tomorrow.getTime();
  }

  if (type === 'daily') {
    const t = parseTime(value);
    if (!t) return reference;
    const next = new Date(reference);
    next.setHours(t.hour, t.minute, 0, 0);
    if (next.getTime() <= reference) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime();
  }

  if (type === 'weekly') {
    const w = parseWeekly(value);
    if (!w) return reference;
    const next = new Date(reference);
    next.setHours(w.hour, w.minute, 0, 0);
    // Move to the correct weekday
    while (next.getDay() !== w.day) {
      next.setDate(next.getDate() + 1);
    }
    if (next.getTime() <= reference) {
      next.setDate(next.getDate() + 7);
    }
    return next.getTime();
  }

  if (type === 'monthly') {
    const m = parseMonthly(value);
    if (!m) return reference;
    const next = new Date(reference);
    next.setDate(m.dayOfMonth);
    next.setHours(m.hour, m.minute, 0, 0);
    if (next.getTime() <= reference) {
      next.setMonth(next.getMonth() + 1);
      if (next.getMonth() > 11) {
        next.setFullYear(next.getFullYear() + 1);
      }
    }
    return next.getTime();
  }

  if (type === 'dreaming') {
    const t = parseTime(value);
    if (!t) return reference;
    const next = new Date(reference);
    next.setHours(t.hour, t.minute, 0, 0);
    if (next.getTime() <= reference) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime();
  }

  return reference;
}

/**
 * Evaluate all five heartbeat schedule settings and return the one
 * with the earliest next fire time. Returns null if all are empty.
 */
export function pickNextSchedule(settings: {
  HEARTBEAT_INTRADAY?: string;
  HEARTBEAT_DAILY?: string;
  HEARTBEAT_WEEKLY?: string;
  HEARTBEAT_MONTHLY?: string;
  HEARTBEAT_DREAMING?: string;
}, now?: number): { type: ScheduleType; value: string } | null {
  const reference = now ?? Date.now();
  const candidates: Array<{ type: ScheduleType; value: string; nextFire: number }> = [];
  // Tie-break priority: intraday > daily > weekly > monthly > dreaming
  const priority = { intraday: 0, daily: 1, weekly: 2, monthly: 3, dreaming: 4 };

  const schedules: Array<{ type: ScheduleType; value: string }> = [
    { type: 'intraday', value: settings.HEARTBEAT_INTRADAY ?? '' },
    { type: 'daily', value: settings.HEARTBEAT_DAILY ?? '' },
    { type: 'weekly', value: settings.HEARTBEAT_WEEKLY ?? '' },
    { type: 'monthly', value: settings.HEARTBEAT_MONTHLY ?? '' },
    { type: 'dreaming', value: settings.HEARTBEAT_DREAMING ?? '' },
  ];

  for (const { type, value } of schedules) {
    if (!value) continue;
    const nextFire = computeNextFire({ type, value }, reference);
    candidates.push({ type, value, nextFire });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const diff = a.nextFire - b.nextFire;
    if (diff !== 0) return diff;
    return priority[a.type] - priority[b.type];
  });

  const best = candidates[0]!;
  return { type: best.type, value: best.value };
}
