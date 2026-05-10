import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { CronManager } from './cron-manager.js';
import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const TEST_CRON_FILE = join(homedir(), '.curie-agent', 'cron-test.json');

function backupCronFile(): string | null {
  if (existsSync(TEST_CRON_FILE)) {
    const content = readFileSync(TEST_CRON_FILE, 'utf-8');
    writeFileSync(TEST_CRON_FILE + '.bak', content);
    return content;
  }
  return null;
}

function restoreCronFile(backup: string | null): void {
  if (backup !== null) {
    writeFileSync(TEST_CRON_FILE, backup, 'utf-8');
  } else if (existsSync(TEST_CRON_FILE)) {
    unlinkSync(TEST_CRON_FILE);
  }
  if (existsSync(TEST_CRON_FILE + '.bak')) {
    unlinkSync(TEST_CRON_FILE + '.bak');
  }
}

describe('CronManager', () => {
  let manager: CronManager;

  beforeEach(() => {
    // Start with a fresh manager and clean the file
    manager = new CronManager();
    manager.data.tasks = [];
    manager.save();
  });

  afterEach(() => {
    manager.stopChecker();
    // Clean up after each test to prevent state leaking
    manager.data.tasks = [];
    manager.save();
  });

  afterAll(() => {
    manager.stopChecker();
  });

  it('creates a reminder', () => {
    const task = manager.createReminder('test reminder', Date.now() + 60_000);
    expect(task.id).toBeTruthy();
    expect(task.message).toBe('test reminder');
    expect(task.status).toBe('pending');
    expect(task.type).toBe('reminder');
  });

  it('persists and reloads tasks', () => {
    manager.createReminder('persist test', Date.now() + 60_000);
    const loaded = manager.load();
    expect(loaded.tasks.length).toBe(1);
    expect(loaded.tasks[0].message).toBe('persist test');
  });

  it('lists all reminders', () => {
    manager.createReminder('task 1', Date.now() + 60_000);
    manager.createReminder('task 2', Date.now() + 120_000);
    const all = manager.listReminders();
    expect(all.length).toBe(2);
  });

  it('filters reminders by status', () => {
    manager.createReminder('pending', Date.now() + 60_000);
    const pending = manager.listReminders('pending');
    expect(pending.length).toBe(1);
    expect(pending[0].message).toBe('pending');
  });

  it('cancels a reminder', () => {
    const task = manager.createReminder('cancel me', Date.now() + 60_000);
    const result = manager.cancelReminder(task.id);
    expect(result).toBe(true);
    const tasks = manager.listReminders('cancelled');
    expect(tasks.length).toBe(1);
    expect(tasks[0].status).toBe('cancelled');
  });

  it('returns false for invalid cancel', () => {
    expect(manager.cancelReminder('non-existent-id')).toBe(false);
  });

  it('clears completed (fired) tasks', () => {
    const t1 = manager.createReminder('fire 1', Date.now() - 1000);
    const t2 = manager.createReminder('fire 2', Date.now() - 2000);
    manager.createReminder('stay', Date.now() + 60_000);

    // Manually fire only the first two tasks
    t1.status = 'fired';
    t2.status = 'fired';
    manager.save();

    const cleared = manager.clearCompleted();
    expect(cleared).toBe(2);
    expect(manager.listReminders().length).toBe(1);
    expect(manager.listReminders()[0].message).toBe('stay');
  });

  it('tracks pending count', () => {
    manager.createReminder('p1', Date.now() + 60_000);
    manager.createReminder('p2', Date.now() + 60_000);
    const firedTask = manager.createReminder('fired', Date.now() - 1000);
    firedTask.status = 'fired';
    expect(manager.pendingCount).toBe(2);
  });

  it('fires reminders via checker callback', (done) => {
    const firedTasks: typeof manager['data']['tasks'] = [];
    manager.startChecker(50, (task) => {
      firedTasks.push(task);
      manager.stopChecker();
    });
    // Create a reminder that should fire immediately
    manager.createReminder('quick fire', Date.now() - 100);

    setTimeout(() => {
      expect(firedTasks.length).toBe(1);
      expect(firedTasks[0].message).toBe('quick fire');
      done();
    }, 200);
  }, 3000);

  it('prunes old fired reminders while keeping pending ones', () => {
    const sevenDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const recent = Date.now() + 60_000;

    const oldFired = manager.createReminder('old fired', recent);
    oldFired.status = 'fired';
    (oldFired as any).createdAt = sevenDaysAgo;

    const oldCancelled = manager.createReminder('old cancelled', recent);
    oldCancelled.status = 'cancelled';
    (oldCancelled as any).createdAt = sevenDaysAgo;

    manager.createReminder('pending stays', Date.now() + 120_000);
    const recentFired = manager.createReminder('recent fired', Date.now() - 1000);
    recentFired.status = 'fired';

    manager.save();
    const removed = manager.pruneOld(Date.now() - 7 * 24 * 60 * 60 * 1000);
    expect(removed).toBe(2);
    expect(manager.listReminders().length).toBe(2);
    expect(manager.listReminders('pending').length).toBe(1);
    expect(manager.listReminders('fired').length).toBe(1); // recent fired survives
  });

  it('prunes during startup when tasks exceed TTL', () => {
    const sevenDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    const oldFired = manager.createReminder('old', Date.now() + 60_000);
    oldFired.status = 'fired';
    (oldFired as any).createdAt = sevenDaysAgo;
    manager.save();

    // New manager should prune on construction
    const fresh = new CronManager();
    expect(fresh.listReminders().length).toBe(0);
  });

  it('custom ttlMs is respected', () => {
    const shortTtl = new CronManager(1000); // 1 second
    const oldFired = shortTtl.createReminder('ttl test', Date.now() + 60_000);
    oldFired.status = 'fired';
    (oldFired as any).createdAt = Date.now() - 2000;
    shortTtl.save();

    const fresh = new CronManager(1000);
    expect(fresh.listReminders().length).toBe(0);
  });
});
