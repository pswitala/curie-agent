import { describe, it, expect } from 'vitest';
import { PermissionEngine, PURE_TOOLS } from './permission.js';

describe('PURE_TOOLS export', () => {
  it('is exported for cross-package reuse (e.g. daemon tool-call counting)', () => {
    expect(PURE_TOOLS.has('Chart')).toBe(true);
  });
});

describe('PermissionEngine — PURE_TOOLS (Chart)', () => {
  it('allows Chart in auto mode without the unconditional ask', () => {
    const engine = new PermissionEngine({}, 'auto');
    const result = engine.check('Chart', { type: 'line', title: 'x', series: [] });
    expect(result.decision).toBe('allow');
  });

  it('allows Chart in plan mode, where non-read-only tools are denied', () => {
    const engine = new PermissionEngine({}, 'plan');
    const result = engine.check('Chart', {});
    expect(result.decision).toBe('allow');
  });

  it('allows Chart in edit mode without asking', () => {
    const engine = new PermissionEngine({}, 'edit');
    const result = engine.check('Chart', {});
    expect(result.decision).toBe('allow');
  });

  it('allows Chart in yolo mode', () => {
    const engine = new PermissionEngine({}, 'yolo');
    const result = engine.check('Chart', {});
    expect(result.decision).toBe('allow');
  });

  it('an explicit deny rule still wins over PURE_TOOLS', () => {
    const engine = new PermissionEngine({ deny: ['Chart'] }, 'auto');
    const result = engine.check('Chart', {});
    expect(result.decision).toBe('deny');
  });

  it('does not affect other tools — auto mode still asks for Read', () => {
    const engine = new PermissionEngine({}, 'auto');
    const result = engine.check('Read', { file_path: '/tmp/x' });
    expect(result.decision).toBe('ask');
  });

  it('does not affect other tools — plan mode still denies Write', () => {
    const engine = new PermissionEngine({}, 'plan');
    const result = engine.check('Write', { file_path: '/tmp/x' });
    expect(result.decision).toBe('deny');
  });
});

describe('PermissionEngine — baseline mode behavior', () => {
  it('plan mode allows read-only tools', () => {
    const engine = new PermissionEngine({}, 'plan');
    for (const tool of ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']) {
      expect(engine.check(tool, {}).decision, tool).toBe('allow');
    }
  });

  it('edit mode allows read-only tools without asking', () => {
    const engine = new PermissionEngine({}, 'edit');
    expect(engine.check('Read', {}).decision).toBe('allow');
  });

  it('edit mode asks for mutating tools', () => {
    const engine = new PermissionEngine({}, 'edit');
    expect(engine.check('Write', {}).decision).toBe('ask');
  });

  it('yolo mode allows everything by default', () => {
    const engine = new PermissionEngine({}, 'yolo');
    expect(engine.check('Bash', { command: 'ls' }).decision).toBe('allow');
  });

  it('explicit allow rule wins regardless of mode', () => {
    const engine = new PermissionEngine({ allow: ['Bash(git status)'] }, 'plan');
    expect(engine.check('Bash', { command: 'git status' }).decision).toBe('allow');
  });
});
