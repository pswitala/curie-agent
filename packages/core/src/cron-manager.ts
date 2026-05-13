import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type ScheduleType = 'intraday' | 'daily' | 'weekly' | 'monthly' | 'dreaming';

/** Human-readable label for a schedule type. */
export function scheduleLabel(type: ScheduleType): string {
  return type.toUpperCase(); // INTRADAY, DAILY, WEEKLY, MONTHLY
}

export interface CronTask {
  id: string;
  type: 'reminder' | 'heartbeat';
  scheduledAt: number;
  message: string;
  /** Schedule definition for heartbeat tasks. */
  schedule?: {
    type: ScheduleType;
    // intraday: string = comma-separated "H:MM" list, e.g. "8:10,10:10,14:20,16:20"
    // daily: string = "H:MM" (24h)
    // weekly: string = "day@H:MM" (monday@6:00)
    // monthly: string = "D@H:MM" (1@6:00)
    // dreaming: string = "H:MM" (24h)
    value: string;
  };
  status: 'pending' | 'fired' | 'cancelled';
  createdAt: number;
}

export interface CronFile {
  version: 1;
  tasks: CronTask[];
}

const CRON_DIR = join(homedir(), '.curie-agent');
const CRON_FILE = join(CRON_DIR, 'cron.json');

function loadCronFile(): CronFile {
  if (existsSync(CRON_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(CRON_FILE, 'utf-8')) as unknown;
      if (typeof parsed === 'object' && parsed !== null && 'tasks' in parsed && Array.isArray((parsed as CronFile).tasks)) {
        return parsed as CronFile;
      }
    } catch {
      // corrupt file — start fresh
    }
  }
  return { version: 1, tasks: [] };
}

function saveCronFile(data: CronFile): void {
  if (!existsSync(CRON_DIR)) {
    const { mkdirSync } = require('node:fs');
    mkdirSync(CRON_DIR, { recursive: true });
  }
  writeFileSync(CRON_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

type ReminderCallback = (task: CronTask) => void;

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
export function computeNextFire(schedule: CronTask['schedule'], now: number): number {
  if (!schedule) return now;
  const { type, value } = schedule;
  if (!value) return now;

  if (type === 'intraday') {
    const tokens = value.split(',').map((s) => s.trim()).filter(Boolean);
    const slots: { hour: number; minute: number }[] = [];
    for (const token of tokens) {
      const t = parseTime(token);
      if (t) slots.push(t);
    }
    if (slots.length === 0) return now;
    slots.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
    const firstSlot = slots[0]!;
    const base = new Date(now);
    for (const slot of slots) {
      const candidate = new Date(base);
      candidate.setHours(slot.hour, slot.minute, 0, 0);
      if (candidate.getTime() > now) return candidate.getTime();
    }
    // All slots passed today — use first slot tomorrow
    const tomorrow = new Date(base);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(firstSlot.hour, firstSlot.minute, 0, 0);
    return tomorrow.getTime();
  }

  if (type === 'daily') {
    const t = parseTime(value);
    if (!t) return now;
    const next = new Date(now);
    next.setHours(t.hour, t.minute, 0, 0);
    if (next.getTime() <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime();
  }

  if (type === 'weekly') {
    const w = parseWeekly(value);
    if (!w) return now;
    const next = new Date(now);
    next.setHours(w.hour, w.minute, 0, 0);
    // Move to the correct weekday
    while (next.getDay() !== w.day) {
      next.setDate(next.getDate() + 1);
    }
    if (next.getTime() <= now) {
      next.setDate(next.getDate() + 7);
    }
    return next.getTime();
  }

  if (type === 'monthly') {
    const m = parseMonthly(value);
    if (!m) return now;
    const next = new Date(now);
    next.setDate(m.dayOfMonth);
    next.setHours(m.hour, m.minute, 0, 0);
    if (next.getTime() <= now) {
      next.setMonth(next.getMonth() + 1);
      if (next.getMonth() > 11) {
        next.setFullYear(next.getFullYear() + 1);
      }
    }
    return next.getTime();
  }

  if (type === 'dreaming') {
    const t = parseTime(value);
    if (!t) return now;
    const next = new Date(now);
    next.setHours(t.hour, t.minute, 0, 0);
    if (next.getTime() <= now) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime();
  }

  return now;
}

/**
 * Evaluate all four heartbeat schedule settings and return the one
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

export class CronManager {
  private data: CronFile;
  private checkerTimer: ReturnType<typeof setInterval> | null = null;
  private onReminderFired: ReminderCallback | null = null;
  private ttlMs: number;

  constructor(ttlMs?: number) {
    this.ttlMs = ttlMs ?? (7 * 24 * 60 * 60 * 1000); // 7 days default
    this.data = loadCronFile();
    this.pruneOld(Date.now() - this.ttlMs);
  }

  load(): CronFile {
    this.data = loadCronFile();
    return this.data;
  }

  save(): void {
    saveCronFile(this.data);
  }

  createReminder(message: string, scheduledAt: number): CronTask {
    const task: CronTask = {
      id: crypto.randomUUID(),
      type: 'reminder',
      scheduledAt,
      message,
      status: 'pending',
      createdAt: Date.now(),
    };
    this.data.tasks.push(task);
    this.save();
    return task;
  }

  cancelReminder(id: string): boolean {
    const task = this.data.tasks.find((t) => t.id === id);
    if (!task) return false;
    task.status = 'cancelled';
    this.save();
    return true;
  }

  listReminders(filter?: 'pending' | 'fired' | 'cancelled'): CronTask[] {
    if (!filter) return [...this.data.tasks];
    return this.data.tasks.filter((t) => t.status === filter);
  }

  clearCompleted(): number {
    const before = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter((t) => t.status !== 'fired');
    const removed = before - this.data.tasks.length;
    if (removed > 0) {
      this.save();
    }
    return removed;
  }

  /** Remove fired/cancelled tasks older than the cutoff. Pending tasks always kept. */
  pruneOld(cutoff: number): number {
    const before = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter(
      (t) => t.status === 'pending' || t.createdAt >= cutoff,
    );
    const removed = before - this.data.tasks.length;
    if (removed > 0) {
      this.save();
    }
    return removed;
  }

  createHeartbeat(message: string, schedule: { type: ScheduleType; value: string }): CronTask {
    const now = Date.now();
    const task: CronTask = {
      id: crypto.randomUUID(),
      type: 'heartbeat',
      scheduledAt: computeNextFire(schedule, now),
      message,
      schedule,
      status: 'pending',
      createdAt: now,
    };
    this.data.tasks.push(task);
    this.save();
    return task;
  }

  /** Update the schedule of all pending heartbeat tasks matching the given schedule type. */
  updateHeartbeatSchedule(scheduleType: ScheduleType, value: string): void {
    const now = Date.now();
    const newSchedule = { type: scheduleType, value };
    let changed = false;
    for (const task of this.data.tasks) {
      if (task.type === 'heartbeat' && task.status === 'pending' && task.schedule?.type === scheduleType) {
        task.schedule = newSchedule;
        task.scheduledAt = computeNextFire(newSchedule, now);
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /**
   * Find the unified heartbeat task and re-evaluate all four schedule
   * settings to pick the next earliest fire time. Called after a
   * schedule setting changes or after a heartbeat fires.
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
    const task = this.data.tasks.find((t) => t.type === 'heartbeat' && t.status === 'pending');
    if (!task) return;
    task.schedule = picked;
    task.scheduledAt = computeNextFire(picked, ref);
    this.save();
  }

  startChecker(intervalMs: number = 60_000, callback: ReminderCallback): void {
    this.onReminderFired = callback;
    this.checkerTimer = setInterval(() => {
      this.data = loadCronFile();
      this.pruneOld(Date.now() - this.ttlMs);
      const now = Date.now();
      const pending = this.data.tasks.filter(
        (t) => t.status === 'pending' && t.scheduledAt <= now,
      );

      for (const task of pending) {
        const isHeartbeat = task.type === 'heartbeat';
        // Mark reminders as fired so they don't re-fire.
        // Leave heartbeats as pending — the caller will call
        // rescheduleFromSettings() which searches for pending heartbeats.
        if (!isHeartbeat) {
          task.status = 'fired';
        }
        callback(task);
        // Don't re-schedule heartbeats here — let the caller (cli.tsx)
        // call rescheduleFromSettings() with all four schedule settings
      }
      if (pending.length > 0) {
        this.save();
      }
    }, intervalMs);
  }

  stopChecker(): void {
    if (this.checkerTimer) {
      clearInterval(this.checkerTimer);
      this.checkerTimer = null;
    }
  }

  get pendingCount(): number {
    return this.data.tasks.filter((t) => t.status === 'pending').length;
  }
}
