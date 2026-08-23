import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskManager, getTaskManager, resetTaskManagers } from './task-manager.js';
import type { TasksFile, UnifiedTask } from './unified-task.js';

let tmpDir: string;
let storePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curie-tasks-'));
  storePath = path.join(tmpDir, 'tasks.json');
  resetTaskManagers();
});

afterEach(() => {
  resetTaskManagers();
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function readStore(): TasksFile {
  return JSON.parse(fs.readFileSync(storePath, 'utf-8')) as TasksFile;
}

function writeStore(tasks: Partial<UnifiedTask>[]): void {
  const file: TasksFile = { $schema: 'tasks.schema.json', version: 1, tasks: tasks as UnifiedTask[] };
  fs.writeFileSync(storePath, JSON.stringify(file, null, 2), 'utf-8');
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

describe('TaskManager retention', () => {
  // The regression that matters most: a 7-day TTL used to hard-delete any
  // human task that wasn't 'pending', wiping the real todo list on every start.
  it('keeps an old open todo across construction, load and unrelated writes', () => {
    writeStore([
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', title: 'Renew ID document', description: '', status: 'todo', priority: 'medium', tags: [], mode: 'human', frequency: null, scope: 'personal', order: 0, created_at: daysAgo(60) },
    ]);

    const manager = new TaskManager(storePath);
    expect(manager.list()).toHaveLength(1);

    manager.load();
    expect(manager.list()).toHaveLength(1);

    // An unrelated mutation must not take the old task with it.
    manager.create({ title: 'Something new', mode: 'human', scope: 'personal' });
    expect(readStore().tasks).toHaveLength(2);
    expect(readStore().tasks.map((t) => t.title)).toContain('Renew ID document');

    // And it survives a fresh process too.
    expect(new TaskManager(storePath).list()).toHaveLength(2);
  });

  it('keeps old completed tasks until explicitly cleared', () => {
    writeStore([
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', title: 'Done long ago', description: '', status: 'done', priority: 'medium', tags: [], mode: 'human', frequency: null, scope: 'personal', order: 0, created_at: daysAgo(90), completed_at: daysAgo(89) },
      { id: 'aaaaaaaa-0000-0000-0000-000000000002', title: 'Still open', description: '', status: 'todo', priority: 'medium', tags: [], mode: 'human', frequency: null, scope: 'personal', order: 1, created_at: daysAgo(90) },
    ]);

    const manager = new TaskManager(storePath);
    expect(manager.list()).toHaveLength(2);

    expect(manager.clearCompleted()).toBe(1);
    expect(manager.list()).toHaveLength(1);
    expect(manager.list()[0]?.title).toBe('Still open');
  });
});

describe('TaskManager create', () => {
  it('puts human tasks on the todo list and scheduled tasks in pending', () => {
    const manager = new TaskManager(storePath);
    expect(manager.create({ title: 'A', mode: 'human', scope: 'personal' }).status).toBe('todo');
    expect(manager.create({ title: 'B', mode: 'agent', scope: 'personal', scheduled_at: Date.now() + 60_000 }).status).toBe('pending');
    expect(manager.create({ title: 'C', mode: 'notify', scope: 'personal', scheduled_at: Date.now() + 60_000 }).status).toBe('pending');
  });

  it('persists immediately and assigns increasing order', () => {
    const manager = new TaskManager(storePath);
    manager.create({ title: 'first', mode: 'human', scope: 'personal' });
    manager.create({ title: 'second', mode: 'human', scope: 'personal' });

    const stored = readStore().tasks;
    expect(stored.map((t) => t.order)).toEqual([0, 1]);
  });

  it('leaves no temp file behind', () => {
    const manager = new TaskManager(storePath);
    manager.create({ title: 'A', mode: 'human', scope: 'personal' });
    expect(fs.existsSync(`${storePath}.tmp`)).toBe(false);
  });
});

describe('TaskManager status transitions', () => {
  it('stamps completed_at on terminal statuses', () => {
    const manager = new TaskManager(storePath);
    const task = manager.create({ title: 'A', mode: 'human', scope: 'personal' });

    manager.updateTaskStatus(task.id, 'done');
    const stored = manager.findTask(task.id);
    expect(stored?.status).toBe('done');
    expect(stored?.completed_at).toBeTruthy();
  });

  it('re-arms a recurring task instead of completing it', () => {
    const manager = new TaskManager(storePath);
    const task = manager.create({
      title: 'Heartbeat: DAILY',
      mode: 'agent',
      scope: 'personal',
      scheduled_at: Date.now() + 60_000,
      frequency: { type: 'daily', value: '7:15' },
    });

    manager.updateTaskStatus(task.id, 'done');
    const stored = manager.findTask(task.id);
    expect(stored?.status).toBe('pending');
    expect(stored?.completed_at).toBeUndefined();
  });

  it('patches fields through updateTask', () => {
    const manager = new TaskManager(storePath);
    const task = manager.create({ title: 'Original', mode: 'human', scope: 'personal' });

    const updated = manager.updateTask(task.id, { title: 'Edited', priority: 'high' });
    expect(updated?.title).toBe('Edited');
    expect(readStore().tasks[0]?.priority).toBe('high');
    expect(manager.updateTask('nonexistent-id', { title: 'x' })).toBeUndefined();
  });

  it('renormalizes order after removal', () => {
    const manager = new TaskManager(storePath);
    manager.create({ title: 'A', mode: 'human', scope: 'personal' });
    const middle = manager.create({ title: 'B', mode: 'human', scope: 'personal' });
    manager.create({ title: 'C', mode: 'human', scope: 'personal' });

    expect(manager.removeTask(middle.id)).toBe(true);
    expect(readStore().tasks.map((t) => t.order)).toEqual([0, 1]);
    expect(readStore().tasks.map((t) => t.title)).toEqual(['A', 'C']);
  });
});

describe('TaskManager findTask', () => {
  it('resolves an unambiguous ID prefix', () => {
    // /cron list and /todo list print only the first 8 characters, so the ID a
    // user can see has to be an ID they can use.
    const manager = new TaskManager(storePath);
    const task = manager.create({ title: 'A', mode: 'human', scope: 'personal' });

    expect(manager.findTask(task.id)?.id).toBe(task.id);
    expect(manager.findTask(task.id.slice(0, 8))?.id).toBe(task.id);
  });

  it('refuses an ambiguous prefix rather than guessing', () => {
    writeStore([
      { id: 'abcdef01-0000-0000-0000-000000000001', title: 'A', description: '', status: 'todo', priority: 'medium', tags: [], mode: 'human', frequency: null, scope: 'personal', order: 0, created_at: daysAgo(1) },
      { id: 'abcdef02-0000-0000-0000-000000000002', title: 'B', description: '', status: 'todo', priority: 'medium', tags: [], mode: 'human', frequency: null, scope: 'personal', order: 1, created_at: daysAgo(1) },
    ]);
    const manager = new TaskManager(storePath);

    expect(manager.findTask('abcdef')).toBeUndefined();
    expect(manager.findTask('abcdef01')?.title).toBe('A');
  });

  it('ignores prefixes too short to be meaningful', () => {
    const manager = new TaskManager(storePath);
    manager.create({ title: 'A', mode: 'human', scope: 'personal' });
    expect(manager.findTask('a')).toBeUndefined();
    expect(manager.findTask('')).toBeUndefined();
  });
});

describe('TaskManager getNextTasks', () => {
  it('returns only pending tasks that are due', () => {
    const manager = new TaskManager(storePath);
    const now = Date.now();
    const due = manager.create({ title: 'due', mode: 'notify', scope: 'personal', scheduled_at: now - 1000 });
    manager.create({ title: 'later', mode: 'notify', scope: 'personal', scheduled_at: now + 600_000 });
    manager.create({ title: 'unscheduled', mode: 'human', scope: 'personal' });

    const next = manager.getNextTasks(now);
    expect(next.map((t) => t.id)).toEqual([due.id]);
  });

  it('skips tasks already in flight', () => {
    const manager = new TaskManager(storePath);
    const now = Date.now();
    const task = manager.create({ title: 'due', mode: 'agent', scope: 'personal', scheduled_at: now - 1000 });

    manager.markExecuting(task.id);
    expect(manager.getNextTasks(now)).toHaveLength(0);
    expect(manager.findTask(task.id)?.status).toBe('executing');

    manager.clearExecuting(task.id);
    manager.updateTaskStatus(task.id, 'pending');
    expect(manager.getNextTasks(now)).toHaveLength(1);
  });
});

describe('TaskManager concurrent writers', () => {
  // Two in-memory copies of the array used to overwrite each other wholesale.
  // This is the heartbeat clobber: the daemon loads at tick start, an LLM run
  // adds a task minutes later, then the daemon's cleanup saves its stale copy.
  it('does not drop another writer\'s task on save', () => {
    const daemonSide = new TaskManager(storePath);
    const toolSide = new TaskManager(storePath);

    const original = daemonSide.create({ title: 'heartbeat', mode: 'agent', scope: 'personal', scheduled_at: Date.now() + 60_000 });

    // The tool adds a task the daemon's copy has never seen.
    toolSide.load();
    toolSide.create({ title: 'staged by heartbeat', mode: 'human', scope: 'personal' });

    // The daemon now cleans up its own task from its stale snapshot.
    daemonSide.removeTask(original.id);

    const titles = readStore().tasks.map((t) => t.title);
    expect(titles).toContain('staged by heartbeat');
    expect(titles).not.toContain('heartbeat');
  });

  it('picks up foreign edits before mutating', () => {
    const manager = new TaskManager(storePath);
    manager.create({ title: 'mine', mode: 'human', scope: 'personal' });

    // Someone else rewrites the file behind our back.
    const foreign = readStore();
    foreign.tasks.push({
      id: 'ffffffff-0000-0000-0000-000000000001', title: 'theirs', description: '', status: 'todo',
      priority: 'medium', tags: [], mode: 'human', frequency: null, scope: 'personal', order: 1,
      created_at: new Date().toISOString(),
    } as UnifiedTask);
    fs.writeFileSync(storePath, JSON.stringify(foreign, null, 2), 'utf-8');

    manager.create({ title: 'mine again', mode: 'human', scope: 'personal' });

    expect(readStore().tasks.map((t) => t.title)).toEqual(['mine', 'theirs', 'mine again']);
  });
});

describe('getTaskManager', () => {
  it('returns one shared instance per resolved path', () => {
    expect(getTaskManager(storePath)).toBe(getTaskManager(storePath));
    expect(getTaskManager(storePath)).not.toBe(getTaskManager(path.join(tmpDir, 'other.json')));
  });

  it('shares state between callers', () => {
    getTaskManager(storePath).create({ title: 'via A', mode: 'human', scope: 'personal' });
    expect(getTaskManager(storePath).list()).toHaveLength(1);
  });
});

describe('TaskManager heartbeat scheduling', () => {
  const settings = { HEARTBEAT_DAILY: '7:15' };

  it('creates exactly one heartbeat task', () => {
    const manager = new TaskManager(storePath);
    manager.rescheduleFromSettings(settings);

    const heartbeats = manager.getHeartbeats();
    expect(heartbeats).toHaveLength(1);
    expect(heartbeats[0]?.title).toBe('Heartbeat: DAILY');
    expect(manager.isHeartbeat(heartbeats[0]!)).toBe(true);
  });

  it('does not move the armed slot when the schedule is unchanged', () => {
    // Recomputing scheduled_at on every config-changed event silently skipped
    // the slot the user was waiting for.
    const manager = new TaskManager(storePath);
    manager.rescheduleFromSettings(settings);
    const armedAt = manager.getHeartbeats()[0]?.scheduled_at;

    manager.rescheduleFromSettings(settings);
    expect(manager.getHeartbeats()[0]?.scheduled_at).toBe(armedAt);
  });

  it('re-arms when the winning schedule changes', () => {
    const manager = new TaskManager(storePath);
    manager.rescheduleFromSettings(settings);
    const armedAt = manager.getHeartbeats()[0]?.scheduled_at;

    manager.rescheduleFromSettings({ HEARTBEAT_DAILY: '7:15', HEARTBEAT_INTRADAY: '0:05' });
    const after = manager.getHeartbeats()[0];
    expect(after?.title).toBe('Heartbeat: INTRADAY');
    expect(after?.scheduled_at).not.toBe(armedAt);
  });

  it('cancels duplicates and can cancel them all', () => {
    const manager = new TaskManager(storePath);
    for (const value of ['7:15', '8:15']) {
      manager.create({
        title: 'Heartbeat', mode: 'agent', scope: 'personal',
        scheduled_at: Date.now() + 60_000, frequency: { type: 'daily', value },
      });
    }
    expect(manager.getHeartbeats()).toHaveLength(2);

    manager.rescheduleFromSettings(settings);
    expect(manager.getHeartbeats()).toHaveLength(1);

    expect(manager.cancelAllHeartbeats()).toBe(1);
    expect(manager.getHeartbeats()).toHaveLength(0);
  });
});

describe('TaskManager resilience', () => {
  it('recovers from a corrupt store', () => {
    fs.writeFileSync(storePath, '{ not json', 'utf-8');
    const manager = new TaskManager(storePath);
    expect(manager.list()).toHaveLength(0);
    expect(manager.create({ title: 'A', mode: 'human', scope: 'personal' }).title).toBe('A');
  });

  it('creates the store directory on first write', () => {
    const nested = path.join(tmpDir, 'deep', 'nested', 'tasks.json');
    new TaskManager(nested).create({ title: 'A', mode: 'human', scope: 'personal' });
    expect(fs.existsSync(nested)).toBe(true);
  });
});
