import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeTool } from './write';

function mockSettings(): Record<string, unknown> {
  return {
    safety: { path_guard: 'off' },
  };
}

describe('Write tool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runWrite(input: Record<string, unknown>) {
    return writeTool.execute(input, mockSettings() as any, tmpDir);
  }

  it('writes a file and reports byte count', async () => {
    const filePath = path.join(tmpDir, 'out.txt');
    const result = await runWrite({ file_path: filePath, content: 'hello' });
    expect(result.error).toBeUndefined();
    expect(result.output).toMatchObject({ bytes: 5 });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello');
  });

  it('creates parent directories automatically', async () => {
    const filePath = path.join(tmpDir, 'deep', 'nested', 'out.txt');
    const result = await runWrite({ file_path: filePath, content: 'nested' });
    expect(result.error).toBeUndefined();
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('nested');
  });

  it('resolves relative paths against cwd', async () => {
    const result = await runWrite({ file_path: 'relative.txt', content: 'rel' });
    expect(result.error).toBeUndefined();
    expect(fs.readFileSync(path.join(tmpDir, 'relative.txt'), 'utf-8')).toBe('rel');
  });

  it('returns an instructive error when file_path is missing', async () => {
    const result = await runWrite({ content: 'orphan' });
    expect(result.error).toContain('Validation error for tool "Write"');
    expect(result.error).toContain('file_path');
    expect(result.error).toContain('Expected parameters:');
  });

  it('accepts alias input keys (path, text)', async () => {
    const filePath = path.join(tmpDir, 'alias.txt');
    const result = await runWrite({ path: filePath, text: 'aliased' });
    expect(result.error).toBeUndefined();
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('aliased');
  });
});
