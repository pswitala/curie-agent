import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { editTool } from './edit';

function mockSettings(): Record<string, unknown> {
  return {
    safety: { path_guard: 'off' },
  };
}

describe('Edit tool', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-test-'));
    filePath = path.join(tmpDir, 'target.txt');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runEdit(input: Record<string, unknown>) {
    return editTool.execute(input, mockSettings() as any, tmpDir);
  }

  it('replaces a unique occurrence', async () => {
    fs.writeFileSync(filePath, 'const a = 1;\nconst b = 2;\n');
    const result = await runEdit({ file_path: filePath, old_string: 'const b = 2;', new_string: 'const b = 3;' });
    expect(result.error).toBeUndefined();
    expect(result.output).toMatchObject({ replacements: 1 });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('const a = 1;\nconst b = 3;\n');
  });

  it('errors when old_string occurs multiple times without replace_all', async () => {
    fs.writeFileSync(filePath, 'x = 1;\nx = 1;\nx = 1;\n');
    const result = await runEdit({ file_path: filePath, old_string: 'x = 1;', new_string: 'x = 2;' });
    expect(result.error).toContain('Found 3 occurrences');
    expect(result.error).toContain('replace_all');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('x = 1;\nx = 1;\nx = 1;\n'); // untouched
  });

  it('replaces all occurrences with replace_all', async () => {
    fs.writeFileSync(filePath, 'x = 1;\nx = 1;\nx = 1;\n');
    const result = await runEdit({ file_path: filePath, old_string: 'x = 1;', new_string: 'x = 2;', replace_all: true });
    expect(result.error).toBeUndefined();
    expect(result.output).toMatchObject({ replacements: 3 });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('x = 2;\nx = 2;\nx = 2;\n');
  });

  it('errors when old_string and new_string are identical', async () => {
    fs.writeFileSync(filePath, 'hello');
    const result = await runEdit({ file_path: filePath, old_string: 'hello', new_string: 'hello' });
    expect(result.error).toContain('identical');
  });

  it('errors when old_string is empty', async () => {
    fs.writeFileSync(filePath, 'hello');
    const result = await runEdit({ file_path: filePath, old_string: '', new_string: 'x' });
    expect(result.error).toContain('empty');
  });

  it('gives an exact-match hint when the string is not found', async () => {
    fs.writeFileSync(filePath, 'indented line');
    const result = await runEdit({ file_path: filePath, old_string: '  indented line  ', new_string: 'x' });
    expect(result.error).toContain('String not found');
    expect(result.error).toContain('whitespace');
  });

  it('errors with a read-first hint for a missing file', async () => {
    const result = await runEdit({ file_path: path.join(tmpDir, 'nope.txt'), old_string: 'a', new_string: 'b' });
    expect(result.error).toContain('Read it first');
  });

  it('accepts alias input keys (path, old_str, new_str)', async () => {
    fs.writeFileSync(filePath, 'alias me');
    const result = await runEdit({ path: filePath, old_str: 'alias me', new_str: 'aliased' });
    expect(result.error).toBeUndefined();
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('aliased');
  });
});
