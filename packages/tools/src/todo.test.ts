import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { todoTool } from './todo.js';

// Each test gets its own isolated tmpDir — no shared state between tests.
let tmpDir: string;
beforeEach(() => {
  // Use mkdtempSync for guaranteed unique, safe temp dirs
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curie-test-'));
});
afterEach(() => {
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

function readTodo(projPath: string) {
  const raw = fs.readFileSync(projPath, 'utf-8');
  return JSON.parse(raw);
}

// New project stores are created as tasks.json; an existing todo.json is still honoured.
function projectPath() {
  return path.join(tmpDir, 'tasks.json');
}

describe('todoTool', () => {
  it('creates a new tasks.json on first add (project scope)', async () => {
    const result = await todoTool.execute(
      { action: 'add', scope: 'project', title: 'Test task' },
      {}, tmpDir, 'test-session',
    );
    expect(result.error).toBeUndefined();
    expect((result.output as any).title).toBe('Test task');
    expect((result.output as any).status).toBe('todo');

    const data = readTodo(projectPath());
    expect(data.tasks.length).toBe(1);
  });

  it('adds and lists tasks', async () => {
    await todoTool.execute({ action: 'add', scope: 'project', title: 'Task A' }, {}, tmpDir, 's');
    let data = readTodo(projectPath());
    expect(data.tasks.length).toBe(1);

    await todoTool.execute({ action: 'add', scope: 'project', title: 'Task B' }, {}, tmpDir, 's');
    data = readTodo(projectPath());
    expect(data.tasks.length).toBe(2);

    const all = await todoTool.execute({ action: 'list', scope: 'project' }, {}, tmpDir, 's');
    expect((all.output as any[]).length).toBe(2);
  });

  it('filters list by status and priority', async () => {
    await todoTool.execute({ action: 'add', scope: 'project', title: 'A', priority: 'high' }, {}, tmpDir, 's');
    await todoTool.execute({ action: 'add', scope: 'project', title: 'B', priority: 'low' }, {}, tmpDir, 's');

    // Mark second as done
    const data = readTodo(projectPath());
    data.tasks[1].status = 'done';
    fs.writeFileSync(projectPath(), JSON.stringify(data, null, 2));

    const todoOnly = await todoTool.execute({ action: 'list', scope: 'project', filter_status: 'todo' }, {}, tmpDir, 's');
    expect((todoOnly.output as any[]).length).toBe(1);

    const lowOnly = await todoTool.execute({ action: 'list', scope: 'project', filter_priority: 'low' }, {}, tmpDir, 's');
    expect((lowOnly.output as any[]).length).toBe(1);
  });

  it('filters list by tags', async () => {
    await todoTool.execute({ action: 'add', scope: 'project', title: 'T', tags: ['a', 'b'] }, {}, tmpDir, 's');
    await todoTool.execute({ action: 'add', scope: 'project', title: 'U', tags: ['c'] }, {}, tmpDir, 's');

    const tagged = await todoTool.execute({ action: 'list', scope: 'project', tags: ['a'] }, {}, tmpDir, 's');
    expect((tagged.output as any[]).length).toBe(1);
  });

  it('edits a task title and priority', async () => {
    await todoTool.execute({ action: 'add', scope: 'project', title: 'Original' }, {}, tmpDir, 's');
    const data = readTodo(projectPath());
    const id = data.tasks[0].id;

    const result = await todoTool.execute(
      { action: 'edit', scope: 'project', id, title: 'Edited', priority: 'high' },
      {}, tmpDir, 's',
    );
    expect((result.output as any).title).toBe('Edited');
    expect((result.output as any).priority).toBe('high');
  });

  it('completes a task (status=done + completed_at)', async () => {
    await todoTool.execute({ action: 'add', scope: 'project', title: 'Task' }, {}, tmpDir, 's');
    const data = readTodo(projectPath());

    const result = await todoTool.execute({ action: 'complete', scope: 'project', id: data.tasks[0].id }, {}, tmpDir, 's');
    expect((result.output as any).status).toBe('done');
    expect((result.output as any).completed_at).toBeTruthy();
  });

  it('cancels a task', async () => {
    await todoTool.execute({ action: 'add', scope: 'project', title: 'Task' }, {}, tmpDir, 's');
    const data = readTodo(projectPath());

    const result = await todoTool.execute({ action: 'cancel', scope: 'project', id: data.tasks[0].id }, {}, tmpDir, 's');
    expect((result.output as any).status).toBe('canceled');
  });

  it('starts a task (in_progress)', async () => {
    await todoTool.execute({ action: 'add', scope: 'project', title: 'Task' }, {}, tmpDir, 's');
    const data = readTodo(projectPath());

    const result = await todoTool.execute({ action: 'start', scope: 'project', id: data.tasks[0].id }, {}, tmpDir, 's');
    expect((result.output as any).status).toBe('in_progress');
  });

  it('removes a task and reorders remaining', async () => {
    await todoTool.execute({ action: 'add', scope: 'project', title: 'First' }, {}, tmpDir, 's');
    await todoTool.execute({ action: 'add', scope: 'project', title: 'Second' }, {}, tmpDir, 's');
    await todoTool.execute({ action: 'add', scope: 'project', title: 'Third' }, {}, tmpDir, 's');

    const data = readTodo(projectPath());
    const idToRemove = data.tasks[1].id;

    const result = await todoTool.execute({ action: 'remove', scope: 'project', id: idToRemove }, {}, tmpDir, 's');
    expect((result.output as any).success).toBe(true);

    const afterData = readTodo(projectPath());
    expect(afterData.tasks.length).toBe(2);
    expect(afterData.tasks[0].order).toBe(0);
    expect(afterData.tasks[1].order).toBe(1);
  });

  it('reorders tasks', async () => {
    await todoTool.execute({ action: 'add', scope: 'project', title: 'A' }, {}, tmpDir, 's');
    await todoTool.execute({ action: 'add', scope: 'project', title: 'B' }, {}, tmpDir, 's');
    await todoTool.execute({ action: 'add', scope: 'project', title: 'C' }, {}, tmpDir, 's');

    const data = readTodo(projectPath());
    const ids = [data.tasks[2].id, data.tasks[0].id, data.tasks[1].id]; // C, A, B

    const result = await todoTool.execute({ action: 'reorder', scope: 'project', ids }, {}, tmpDir, 's');
    expect(result.output).not.toBeNull();
    expect((result.output as any).reordered).toBe(true);

    const afterData = readTodo(projectPath());
    expect(afterData.tasks[0].title).toBe('C');
    expect(afterData.tasks[1].title).toBe('A');
    expect(afterData.tasks[2].title).toBe('B');
  });

  it('returns error for unknown task ID', async () => {
    const result = await todoTool.execute({ action: 'remove', scope: 'project', id: 'nonexistent' }, {}, tmpDir, 's');
    expect(result.error).toContain('not found');
  });

  it('generates unique task IDs', async () => {
    await todoTool.execute({ action: 'add', scope: 'project', title: 'First' }, {}, tmpDir, 's');
    await todoTool.execute({ action: 'add', scope: 'project', title: 'Second' }, {}, tmpDir, 's');

    const data = readTodo(projectPath());
    expect(data.tasks[0].id).not.toBe(data.tasks[1].id);
  });

  it('handles corrupted todo.json (auto-recovery)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'todo.json'), '{ corrupt }');

    const result = await todoTool.execute({ action: 'list', scope: 'project' }, {}, tmpDir, 's');
    expect((result.output as any[]).length).toBe(0);

    const addResult = await todoTool.execute({ action: 'add', scope: 'project', title: 'After corrupt' }, {}, tmpDir, 's');
    expect(addResult.error).toBeUndefined();
  });
});
