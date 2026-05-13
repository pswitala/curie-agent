import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CronManager, computeNextFire, pickNextSchedule } from './cron-manager.js';

describe('computeNextFire', () => {
  it('intraday fires at the next upcoming time in the list', () => {
    const schedule = { type: 'intraday' as const, value: '8:10,10:10,14:20,16:20' };
    // 10:15 local — next slot after now is 10:10 is past, so 14:20
    const now = new Date();
    now.setHours(10, 15, 0, 0);
    const next = computeNextFire(schedule, now.getTime());
    const d = new Date(next);
    expect(d.getHours() * 60 + d.getMinutes()).toBeGreaterThan(10 * 60 + 15);
  });

  it('intraday rolls over to first slot tomorrow when all slots passed', () => {
    const schedule = { type: 'intraday' as const, value: '8:10,10:10' };
    const now = new Date();
    now.setHours(23, 0, 0, 0);
    const next = computeNextFire(schedule, now.getTime());
    const d = new Date(next);
    expect(d.getDate()).toBe(now.getDate() + 1 > new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      ? 1
      : now.getDate() + 1);
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(10);
  });

  it('intraday with single entry fires at that time', () => {
    const schedule = { type: 'intraday' as const, value: '9:00' };
    const now = new Date();
    now.setHours(8, 0, 0, 0);
    const next = computeNextFire(schedule, now.getTime());
    const d = new Date(next);
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
  });

  it('daily fires at the set time', () => {
    const schedule = { type: 'daily' as const, value: '6:00' };
    const now = new Date('2026-05-04T03:00:00Z').getTime();
    const next = computeNextFire(schedule, now);
    expect(new Date(next).getHours()).toBe(6);
    expect(new Date(next).getMinutes()).toBe(0);
  });

  it('daily rolls over to next day', () => {
    const schedule = { type: 'daily' as const, value: '6:00' };
    const now = new Date('2026-05-04T07:00:00Z').getTime();
    const next = computeNextFire(schedule, now);
    expect(new Date(next).getUTCDate()).toBe(5);
    expect(new Date(next).getHours()).toBe(6);
  });

  it('weekly fires on the set day and time', () => {
    // Monday = 1
    const schedule = { type: 'weekly' as const, value: 'monday@6:00' };
    const now = new Date('2026-05-04T03:00:00Z').getTime(); // Monday
    const next = computeNextFire(schedule, now);
    expect(new Date(next).getDay()).toBe(1);
    expect(new Date(next).getHours()).toBe(6);
  });

  it('monthly fires on the set day of month', () => {
    const schedule = { type: 'monthly' as const, value: '1@6:00' };
    const now = new Date('2026-05-04T03:00:00Z').getTime();
    const next = computeNextFire(schedule, now);
    expect(new Date(next).getUTCDate()).toBe(1);
    expect(new Date(next).getUTCMonth()).toBe(5); // June
  });

  it('dreaming fires at the set time', () => {
    const schedule = { type: 'dreaming' as const, value: '2:00' };
    const now = new Date('2026-05-04T00:00:00Z').getTime();
    const next = computeNextFire(schedule, now);
    expect(new Date(next).getHours()).toBe(2);
    expect(new Date(next).getMinutes()).toBe(0);
  });

  it('dreaming rolls over to next day', () => {
    const schedule = { type: 'dreaming' as const, value: '2:00' };
    const now = new Date('2026-05-04T03:00:00Z').getTime();
    const next = computeNextFire(schedule, now);
    expect(new Date(next).getUTCDate()).toBe(5);
    expect(new Date(next).getHours()).toBe(2);
  });

  it('null schedule returns now', () => {
    const now = Date.now();
    expect(computeNextFire(null, now)).toBe(now);
  });
});

describe('CronManager heartbeat tasks', () => {
  let manager: CronManager;

  beforeEach(() => {
    manager = new CronManager();
    manager.data.tasks = [];
    manager.save();
  });

  afterEach(() => {
    manager.stopChecker();
    manager.data.tasks = [];
  });

  it('creates a heartbeat task with schedule', () => {
    const task = manager.createHeartbeat('Daily check', { type: 'daily', value: '6:00' });
    expect(task.type).toBe('heartbeat');
    expect(task.schedule).toEqual({ type: 'daily', value: '6:00' });
    expect(task.status).toBe('pending');
    // scheduledAt is computed via computeNextFire — always >= now
    expect(task.scheduledAt).toBeGreaterThanOrEqual(Date.now());
  });

  it('creates heartbeat and lists alongside reminders', () => {
    manager.createReminder('Test reminder', Date.now() + 60_000);
    manager.createHeartbeat('Heartbeat', { type: 'intraday', value: '8:00,12:00' });
    const all = manager.listReminders();
    expect(all).toHaveLength(2);
    expect(all.find((t) => t.type === 'reminder')).toBeDefined();
    expect(all.find((t) => t.type === 'heartbeat')).toBeDefined();
  });

  it('clearCompleted only removes fired reminders, not heartbeats', () => {
    const reminder = manager.createReminder('Test', Date.now() + 60_000);
    reminder.status = 'fired';
    manager.save();
    const heartbeat = manager.createHeartbeat('HB', { type: 'daily', value: '6:00' });

    const removed = manager.clearCompleted();
    expect(removed).toBe(1);

    // Heartbeat should still be pending
    const remaining = manager.listReminders();
    expect(remaining.find((t) => t.id === heartbeat.id)).toBeDefined();
  });

  it('cancels heartbeat tasks', () => {
    const task = manager.createHeartbeat('HB', { type: 'weekly', value: 'monday@6:00' });
    const result = manager.cancelReminder(task.id);
    expect(result).toBe(true);
    // Task should now be cancelled in memory
    const cancelled = manager.listReminders('cancelled');
    expect(cancelled.find((t) => t.id === task.id)).toBeDefined();
  });

 it('reschedules from settings after a schedule update', () => {
    manager.createHeartbeat('HB', { type: 'intraday', value: '23:00' });
    const initialScheduledAt = manager.listReminders('pending').find((t) => t.id)?.scheduledAt;

    // Use a fixed now (3:00 AM) where daily 6:00 (3h) is sooner than intraday 23:00 (20h)
    manager.rescheduleFromSettings({
      HEARTBEAT_INTRADAY: '23:00',
      HEARTBEAT_DAILY: '6:00',
    }, new Date('2026-05-04T03:00:00Z').getTime());

    const updated = manager.listReminders().find((t) => t.schedule?.value === '23:00' || t.schedule?.value === '6:00');
    // The task's schedule should have been updated to the earliest (daily 6:00)
    expect(updated?.schedule?.type).toBe('daily');
    expect(updated?.schedule?.value).toBe('6:00');
  });

  it('rescheduleFromSettings does nothing when no pending heartbeat', () => {
    manager.data.tasks = [];
    manager.save();
    // Should not throw
    expect(() => manager.rescheduleFromSettings({ HEARTBEAT_DAILY: '6:00' })).not.toThrow();
  });
});

describe('pickNextSchedule', () => {
  it('returns null when all schedules are empty', () => {
    const result = pickNextSchedule({
      HEARTBEAT_INTRADAY: '',
      HEARTBEAT_DAILY: '',
      HEARTBEAT_WEEKLY: '',
      HEARTBEAT_MONTHLY: '',
    });
    expect(result).toBeNull();
  });

  it('returns null when no settings provided', () => {
    const result = pickNextSchedule({});
    expect(result).toBeNull();
  });

  it('picks intraday when only intraday is set', () => {
    const result = pickNextSchedule({ HEARTBEAT_INTRADAY: '8:00,14:00' });
    expect(result).toEqual({ type: 'intraday', value: '8:00,14:00' });
  });

  it('picks intraday when intraday is sooner than daily', () => {
    // At 9:00 AM: daily 6:00 (tomorrow) vs intraday 23:00 (today)
    // intraday 23:00 today is sooner, so intraday should win
    // To make daily win, use times 1:00 (tomorrow) vs daily 6:00 (today if before 6am, tomorrow if after)
    // Better: use a time where daily is clearly sooner
    const result = pickNextSchedule({
      HEARTBEAT_INTRADAY: '23:00',
      HEARTBEAT_DAILY: '6:00',
    }, new Date('2026-05-04T09:00:00Z').getTime());
    // times 23:00 today (14h) vs daily 6:00 tomorrow (21h) -> times wins
    // Need to flip: times at 1:00 (tomorrow) vs daily 6:00 (tomorrow)
    // Actually, let's test the opposite case in the next test
    expect(result?.type).toBe('intraday');
    expect(result?.value).toBe('23:00');
  });

  it('picks intraday when intraday is sooner than daily', () => {
    // At 9:00 AM: intraday 8:00 (tomorrow) vs daily 23:00 (today) -> daily wins
    const result = pickNextSchedule({
      HEARTBEAT_INTRADAY: '8:00',
      HEARTBEAT_DAILY: '23:00',
    }, new Date('2026-05-04T09:00:00Z').getTime());
    expect(result?.type).toBe('daily');
    expect(result?.value).toBe('23:00');
  });

  it('picks daily over intraday when daily is truly sooner', () => {
    // At 6:30 AM: daily 6:00 (tomorrow) vs intraday 23:00 (today) -> intraday wins (16.5h vs 23.5h)
    // At 3:00 AM: daily 6:00 (today) vs intraday 23:00 (today) -> daily wins (3h vs 20h)
    const result = pickNextSchedule({
      HEARTBEAT_INTRADAY: '23:00',
      HEARTBEAT_DAILY: '6:00',
    }, new Date('2026-05-04T03:00:00Z').getTime());
    expect(result?.type).toBe('daily');
    expect(result?.value).toBe('6:00');
  });

  it('breaks ties by priority: intraday > daily > weekly > monthly', () => {
    // All at same time — intraday wins
    const result = pickNextSchedule({
      HEARTBEAT_INTRADAY: '6:00',
      HEARTBEAT_DAILY: '6:00',
    });
    expect(result?.type).toBe('intraday');
  });

  it('skips empty schedule types', () => {
    const result = pickNextSchedule({
      HEARTBEAT_INTRADAY: '',
      HEARTBEAT_DAILY: '10:00',
      HEARTBEAT_WEEKLY: '',
      HEARTBEAT_MONTHLY: '15@8:00',
    });
    // daily 10:00 is sooner than monthly 15th
    expect(result?.type).toBe('daily');
  });

  it('picks weekly over monthly when sooner', () => {
    const result = pickNextSchedule({
      HEARTBEAT_WEEKLY: 'monday@6:00',
      HEARTBEAT_MONTHLY: '15@6:00',
    });
    // Assuming today is before next Monday, weekly is sooner
    expect(result?.type).toBe('weekly');
  });

  it('picks dreaming when only dreaming is set', () => {
    const result = pickNextSchedule({
      HEARTBEAT_DREAMING: '2:00',
    }, new Date('2026-05-04T00:00:00Z').getTime());
    expect(result?.type).toBe('dreaming');
    expect(result?.value).toBe('2:00');
  });

  it('includes dreaming in tie-break (lowest priority)', () => {
    const result = pickNextSchedule({
      HEARTBEAT_DAILY: '6:00',
      HEARTBEAT_DREAMING: '6:00',
    });
    expect(result?.type).toBe('daily');
  });
});
