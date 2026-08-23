import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { migrateTasks, repairTaskShapes } from './task-migration.js';
import type { TasksFile } from './unified-task.js';

let tmpDir: string;
let storePath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curie-migrate-'));
  storePath = path.join(tmpDir, 'tasks.json');
});

afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function write(file: string, data: unknown): string {
  const target = path.join(tmpDir, file);
  fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf-8');
  return target;
}

function readStore(): TasksFile {
  return JSON.parse(fs.readFileSync(storePath, 'utf-8')) as TasksFile;
}

describe('repairTaskShapes', () => {
  it('renames the legacy auto mode to agent', () => {
    // `normalizeTask` in the Todo tool coerces unknown modes to 'human', which
    // silently demoted scheduled tasks into inert todo-list items.
    write('tasks.json', {
      $schema: 'tasks.schema.json', version: 1,
      tasks: [{
        id: 'a1', title: 'Check stock prices', description: '', status: 'pending',
        priority: 'medium', tags: [], mode: 'auto', scheduled_at: Date.now() + 60_000,
        frequency: null, scope: 'personal', order: 0, created_at: new Date().toISOString(),
      }],
    });

    const report = repairTaskShapes(storePath);
    expect(report?.modesRenamed).toBe(1);
    expect(readStore().tasks[0]?.mode).toBe('agent');
  });

  it('renames the legacy manual mode to human', () => {
    write('tasks.json', {
      $schema: 'tasks.schema.json', version: 1,
      tasks: [{
        id: 'a1', title: 'Update LinkedIn', description: '', status: 'todo',
        priority: 'medium', tags: [], mode: 'manual', frequency: null,
        scope: 'personal', order: 0, created_at: new Date().toISOString(),
      }],
    });

    repairTaskShapes(storePath);
    expect(readStore().tasks[0]?.mode).toBe('human');
  });

  it('lifts a scheduled task out of an unfireable status', () => {
    // The scheduler only ever looks at 'pending'.
    write('tasks.json', {
      $schema: 'tasks.schema.json', version: 1,
      tasks: [{
        id: 'a1', title: 'Research Gemini', description: '', status: 'todo',
        priority: 'medium', tags: [], mode: 'auto', scheduled_at: Date.now() + 60_000,
        frequency: null, scope: 'personal', order: 0, created_at: new Date().toISOString(),
      }],
    });

    const report = repairTaskShapes(storePath);
    expect(report?.statusesFixed).toBe(1);
    expect(readStore().tasks[0]?.status).toBe('pending');
  });

  it('leaves human todos on their own status', () => {
    write('tasks.json', {
      $schema: 'tasks.schema.json', version: 1,
      tasks: [{
        id: 'a1', title: 'Buy milk', description: '', status: 'todo',
        priority: 'medium', tags: [], mode: 'human', frequency: null,
        scope: 'personal', order: 0, created_at: new Date().toISOString(),
      }],
    });

    repairTaskShapes(storePath);
    expect(readStore().tasks[0]?.status).toBe('todo');
  });

  it('backfills missing scalar fields', () => {
    write('tasks.json', {
      $schema: 'tasks.schema.json', version: 1,
      tasks: [{ id: 'a1', title: 'Legacy row', completed_at: null }],
    });

    const report = repairTaskShapes(storePath);
    expect(report?.fieldsFilled).toBeGreaterThan(0);

    const task = readStore().tasks[0]!;
    expect(task.mode).toBe('human');
    expect(task.status).toBe('todo');
    expect(task.priority).toBe('medium');
    expect(task.tags).toEqual([]);
    expect(task.order).toBe(0);
    expect(task.created_at).toBeTruthy();
    expect('completed_at' in task).toBe(false);
    expect(task.frequency).toBeNull();
  });

  it('reports an unrecognised mode instead of rewriting it', () => {
    // Silent coercion is what caused the original data loss.
    write('tasks.json', {
      $schema: 'tasks.schema.json', version: 1,
      tasks: [{
        id: 'a1', title: 'Mystery', description: '', status: 'todo', priority: 'medium',
        tags: [], mode: 'quantum', frequency: null, scope: 'personal', order: 0,
        created_at: new Date().toISOString(),
      }],
    });

    const report = repairTaskShapes(storePath);
    expect(report?.unknownModes).toEqual(['quantum']);
    expect(readStore().tasks[0]?.mode).toBe('quantum');
  });

  it('is idempotent', () => {
    write('tasks.json', {
      $schema: 'tasks.schema.json', version: 1,
      tasks: [{
        id: 'a1', title: 'Check prices', description: '', status: 'todo',
        priority: 'medium', tags: [], mode: 'auto', scheduled_at: Date.now() + 60_000,
        frequency: null, scope: 'personal', order: 0, created_at: new Date().toISOString(),
      }],
    });

    repairTaskShapes(storePath);
    const afterFirst = fs.readFileSync(storePath, 'utf-8');

    const second = repairTaskShapes(storePath);
    expect(second?.modesRenamed).toBe(0);
    expect(second?.statusesFixed).toBe(0);
    expect(second?.fieldsFilled).toBe(0);
    expect(fs.readFileSync(storePath, 'utf-8')).toBe(afterFirst);
  });

  it('no-ops on a missing or corrupt store', () => {
    expect(repairTaskShapes(path.join(tmpDir, 'absent.json'))).toBeNull();

    fs.writeFileSync(storePath, '{ not json', 'utf-8');
    expect(repairTaskShapes(storePath)).toBeNull();
    expect(fs.readFileSync(storePath, 'utf-8')).toBe('{ not json');
  });
});

describe('migrateTasks', () => {
  it('merges legacy todo.json and cron.json', () => {
    const todoPath = write('todo.json', {
      $schema: 'todo.schema.json', version: 1,
      tasks: [{ id: 't1', title: 'Open todo', status: 'todo', priority: 'high', tags: ['x'], order: 0, created_at: '2026-05-01T00:00:00.000Z' }],
    });
    const cronPath = write('cron.json', {
      version: 1,
      tasks: [
        { id: 'c1', type: 'reminder', scheduledAt: 1_800_000_000_000, message: 'Call the clinic', status: 'pending', createdAt: 1_779_000_000_000 },
        { id: 'c2', type: 'task', scheduledAt: 1_800_000_000_000, message: 'Check HF release', status: 'pending', createdAt: 1_779_000_000_000 },
      ],
    });

    const result = migrateTasks(todoPath, cronPath, storePath);
    expect(result).not.toBeNull();

    const byTitle = new Map(readStore().tasks.map((t) => [t.title, t]));
    expect(byTitle.get('Open todo')?.mode).toBe('human');
    expect(byTitle.get('Call the clinic')?.mode).toBe('notify');
    expect(byTitle.get('Check HF release')?.mode).toBe('agent');
    expect(byTitle.get('Check HF release')?.status).toBe('pending');
  });

  it('skips migration when the target already has content', () => {
    write('tasks.json', { $schema: 'tasks.schema.json', version: 1, tasks: [{ id: 'existing', title: 'Keep me' }] });
    const todoPath = write('todo.json', { $schema: 't', version: 1, tasks: [{ id: 't1', title: 'Should not appear' }] });

    expect(migrateTasks(todoPath, undefined, storePath)).toBeNull();
    expect(readStore().tasks.map((t) => t.title)).toEqual(['Keep me']);
  });

  it('does not read the home store when explicit paths are given', () => {
    // Explicit paths must fully replace the defaults, or every caller silently
    // merges the user's personal task store.
    const todoPath = write('todo.json', { $schema: 't', version: 1, tasks: [{ id: 't1', title: 'Only this' }] });

    migrateTasks(todoPath, path.join(tmpDir, 'no-cron.json'), storePath);
    expect(readStore().tasks.map((t) => t.title)).toEqual(['Only this']);
  });

  it('returns null when there is nothing to migrate', () => {
    expect(migrateTasks(
      path.join(tmpDir, 'absent-todo.json'),
      path.join(tmpDir, 'absent-cron.json'),
      storePath,
    )).toBeNull();
  });
});
