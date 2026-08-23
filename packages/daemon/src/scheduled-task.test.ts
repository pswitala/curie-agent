import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { TaskManager } from '@curie-agent/core';
import { CronTaskFiredEvent } from '@curie-agent/protocol';
import { SCHEDULED_TASK_TYPE } from './daemon-app.js';

/**
 * Guards the producer/consumer contract for scheduled agent tasks.
 *
 * The daemon used to stamp `taskType: 'agent'` on subagent metadata while both
 * completion listeners tested for `'auto'` and the event schema only permitted
 * `'notify' | 'auto'`. Nothing matched, so a scheduled task sat at `executing`
 * forever and its result was never stored or announced.
 */
describe('scheduled task event contract', () => {
  it('emits a taskType the event schema accepts', () => {
    const parsed = CronTaskFiredEvent.safeParse({
      type: 'cron-task-fired',
      id: 'evt-1',
      taskId: 'task-1',
      taskType: SCHEDULED_TASK_TYPE,
      message: 'Scheduled task done: Check HF release',
      timestamp: Date.now(),
    });
    expect(parsed.success).toBe(true);
  });

  it('still accepts the legacy notify and auto task types', () => {
    for (const taskType of ['notify', 'auto']) {
      const parsed = CronTaskFiredEvent.safeParse({
        type: 'cron-task-fired',
        id: 'evt-1',
        taskId: 'task-1',
        taskType,
        message: 'x',
        timestamp: Date.now(),
      });
      expect(parsed.success, taskType).toBe(true);
    }
  });

  it('matches the mode used for scheduled agent tasks', () => {
    // The metadata stamp and the task mode must agree, or the listeners that
    // key off it can never resolve the task they belong to.
    expect(SCHEDULED_TASK_TYPE).toBe('agent');
  });
});

describe('scheduled task lifecycle', () => {
  it('records completion and result text', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curie-sched-'));
    try {
      const store = new TaskManager(path.join(tmpDir, 'tasks.json'));
      const task = store.create({
        title: 'Check HF release',
        mode: 'agent',
        scope: 'personal',
        scheduled_at: Date.now() - 1000,
      });

      // The checker picks it up and hands it to a subagent.
      expect(store.getNextTasks().map((t) => t.id)).toEqual([task.id]);
      store.markExecuting(task.id);
      expect(store.findTask(task.id)?.status).toBe('executing');

      // agent-done arrives: status settles and the result is persisted.
      store.updateTaskStatus(task.id, 'completed');
      store.updateTask(task.id, { result: 'Qwen3.8 is not on HF yet.' });

      const done = store.findTask(task.id);
      expect(done?.status).toBe('completed');
      expect(done?.completed_at).toBeTruthy();
      expect(done?.result).toBe('Qwen3.8 is not on HF yet.');

      // A completed task is never re-fired.
      store.clearExecuting(task.id);
      expect(store.getNextTasks()).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('marks a failed run failed rather than canceled', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curie-sched-'));
    try {
      const store = new TaskManager(path.join(tmpDir, 'tasks.json'));
      const task = store.create({
        title: 'Broken task',
        mode: 'agent',
        scope: 'personal',
        scheduled_at: Date.now() - 1000,
      });

      store.updateTaskStatus(task.id, 'failed');
      expect(store.findTask(task.id)?.status).toBe('failed');
      expect(store.getNextTasks()).toHaveLength(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
