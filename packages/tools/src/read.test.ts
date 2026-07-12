import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readTool } from './read';

function mockSettings(): Record<string, unknown> {
  return {
    safety: { path_guard: 'off' },
  };
}

describe('Read tool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runRead(input: Record<string, unknown>) {
    return readTool.execute(input, mockSettings() as any, tmpDir);
  }

  it('returns numbered lines', async () => {
    const filePath = path.join(tmpDir, 'small.txt');
    fs.writeFileSync(filePath, 'alpha\nbeta\ngamma');
    const result = await runRead({ file_path: filePath });
    expect(result.error).toBeUndefined();
    expect(result.output).toBe('1\talpha\n2\tbeta\n3\tgamma');
  });

  it('caps output at 2000 lines by default with a footer', async () => {
    const filePath = path.join(tmpDir, 'big.txt');
    fs.writeFileSync(filePath, Array.from({ length: 2500 }, (_, i) => `line ${String(i + 1)}`).join('\n'));
    const result = await runRead({ file_path: filePath });
    const text = result.output as string;
    expect(text).toContain('2000\tline 2000');
    expect(text).not.toContain('2001\tline 2001');
    expect(text).toContain('[Showing lines 1-2000 of 2500. Use offset/limit to read more.]');
  });

  it('windows with offset and limit and numbers lines correctly', async () => {
    const filePath = path.join(tmpDir, 'window.txt');
    fs.writeFileSync(filePath, Array.from({ length: 10 }, (_, i) => `line ${String(i + 1)}`).join('\n'));
    const result = await runRead({ file_path: filePath, offset: 4, limit: 3 });
    const text = result.output as string;
    expect(text).toContain('4\tline 4');
    expect(text).toContain('6\tline 6');
    expect(text).not.toContain('7\tline 7');
    expect(text).toContain('[Showing lines 4-6 of 10.');
  });

  it('truncates very long lines', async () => {
    const filePath = path.join(tmpDir, 'long.txt');
    fs.writeFileSync(filePath, 'x'.repeat(5000));
    const result = await runRead({ file_path: filePath });
    const text = result.output as string;
    expect(text).toContain('[line truncated]');
    expect(text.length).toBeLessThan(3000);
  });

  it('lists directory entries when given a directory', async () => {
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a');
    const result = await runRead({ file_path: tmpDir });
    const entries = result.output as Array<{ name: string; isDirectory: boolean }>;
    expect(entries.some((e) => e.name === 'sub' && e.isDirectory)).toBe(true);
    expect(entries.some((e) => e.name === 'a.txt' && !e.isDirectory)).toBe(true);
  });

  it('errors for a missing file', async () => {
    const result = await runRead({ file_path: path.join(tmpDir, 'missing.txt') });
    expect(result.error).toContain('File not found');
  });

  it('returns a graceful error for PDFs instead of throwing', async () => {
    const filePath = path.join(tmpDir, 'doc.pdf');
    fs.writeFileSync(filePath, '%PDF-1.4');
    const result = await runRead({ file_path: filePath });
    expect(result.error).toContain('PDF files are not supported');
  });

  it('accepts the path alias for file_path', async () => {
    const filePath = path.join(tmpDir, 'alias.txt');
    fs.writeFileSync(filePath, 'aliased');
    const result = await runRead({ path: filePath });
    expect(result.error).toBeUndefined();
    expect(result.output).toBe('1\taliased');
  });
});
