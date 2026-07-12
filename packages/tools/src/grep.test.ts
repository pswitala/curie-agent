import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { grepTool } from './grep';

interface GrepOutput {
  pattern: string;
  total_matches: number;
  files: Array<{ file: string; matches: Array<{ line?: number; text: string; before?: string[]; after?: string[] }> }>;
  truncated?: string;
}

function setupFixture(fixture: Record<string, string>): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grep-test-'));
  for (const [relativePath, content] of Object.entries(fixture)) {
    const fullPath = path.join(tmp, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return tmp;
}

function mockSettings(): Record<string, unknown> {
  return {
    safety: { path_guard: 'off' },
  };
}

describe('Grep tool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = setupFixture({
      'src/index.ts': 'export function createTool() {}\nconst other = 1;',
      'src/nested/deep.ts': 'createTool();\n// createTool comment',
      'src/style.css': '.createTool { color: red; }',
      'dist/index.js': 'export function createTool() {}',
      'dist/index.d.ts': 'export declare function createTool(): void;',
      'README.md': 'Use createTool to make tools.',
      'node_modules/pkg/index.js': 'createTool();',
      '.gitignore': 'dist/\nnode_modules/',
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function runGrep(input: Record<string, unknown>): Promise<{ output: GrepOutput; error?: string }> {
    const result = await grepTool.execute(input, mockSettings() as any, tmpDir);
    return { output: result.output as GrepOutput, error: result.error };
  }

  it('finds matches in nested directories with cwd-relative paths', async () => {
    const { output } = await runGrep({ pattern: 'createTool' });
    const fileNames = output.files.map((f) => f.file);
    expect(fileNames).toContain('src/index.ts');
    expect(fileNames).toContain('src/nested/deep.ts');
  });

  it('excludes gitignored files (dist/ twins)', async () => {
    const { output } = await runGrep({ pattern: 'createTool' });
    const fileNames = output.files.map((f) => f.file);
    expect(fileNames.some((f) => f.startsWith('dist/'))).toBe(false);
    expect(fileNames.some((f) => f.startsWith('node_modules/'))).toBe(false);
  });

  it('excludes nested dist/ dirs for bare gitignore patterns (monorepo layout)', async () => {
    fs.mkdirSync(path.join(tmpDir, 'packages/pkg/dist'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'packages/pkg/src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'packages/pkg/dist/twin.js'), 'createTool();');
    fs.writeFileSync(path.join(tmpDir, 'packages/pkg/src/twin.ts'), 'createTool();');
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'dist\nnode_modules');
    const { output } = await runGrep({ pattern: 'createTool' });
    const fileNames = output.files.map((f) => f.file);
    expect(fileNames).toContain('packages/pkg/src/twin.ts');
    expect(fileNames.some((f) => f.includes('packages/pkg/dist'))).toBe(false);
  });

  it('still searches an explicitly targeted gitignored directory', async () => {
    const { output } = await runGrep({ pattern: 'createTool', path: 'dist' });
    const fileNames = output.files.map((f) => f.file);
    expect(fileNames).toContain('dist/index.js');
  });

  it('filters by basename glob without slash', async () => {
    const { output } = await runGrep({ pattern: 'createTool', glob: '*.ts' });
    const fileNames = output.files.map((f) => f.file);
    expect(fileNames).toContain('src/index.ts');
    expect(fileNames).not.toContain('src/style.css');
    expect(fileNames).not.toContain('README.md');
  });

  it('filters by path glob with slash', async () => {
    const { output } = await runGrep({ pattern: 'createTool', glob: 'src/nested/*.ts' });
    const fileNames = output.files.map((f) => f.file);
    expect(fileNames).toEqual(['src/nested/deep.ts']);
  });

  it('filters by file type', async () => {
    const { output } = await runGrep({ pattern: 'createTool', type: 'ts' });
    const fileNames = output.files.map((f) => f.file);
    expect(fileNames).toContain('src/index.ts');
    expect(fileNames).not.toContain('src/style.css');
    expect(fileNames).not.toContain('README.md');
  });

  it('supports case-insensitive search', async () => {
    const sensitive = await runGrep({ pattern: 'CREATETOOL' });
    expect(sensitive.output.total_matches).toBe(0);
    const insensitive = await runGrep({ pattern: 'CREATETOOL', case_insensitive: true });
    expect(insensitive.output.total_matches).toBeGreaterThan(0);
  });

  it('accepts the legacy -i alias for case-insensitivity', async () => {
    const { output } = await runGrep({ pattern: 'CREATETOOL', '-i': true });
    expect(output.total_matches).toBeGreaterThan(0);
  });

  it('returns context lines around matches', async () => {
    fs.writeFileSync(path.join(tmpDir, 'ctx.txt'), 'one\ntwo\nTARGET\nfour\nfive');
    const { output } = await runGrep({ pattern: 'TARGET', context: 2 });
    const match = output.files.find((f) => f.file === 'ctx.txt')?.matches[0];
    expect(match?.before).toEqual(['one', 'two']);
    expect(match?.after).toEqual(['four', 'five']);
  });

  it('searches a single file when path points at a file', async () => {
    const { output } = await runGrep({ pattern: 'createTool', path: 'src/index.ts' });
    expect(output.total_matches).toBe(1);
    expect(output.files[0]?.file).toBe('src/index.ts');
    expect(output.files[0]?.matches[0]?.line).toBe(1);
  });

  it('returns an actionable error for an invalid regex instead of throwing', async () => {
    const { error } = await runGrep({ pattern: 'unbalanced(' });
    expect(error).toContain('Invalid regular expression');
    expect(error).toContain('backslash');
  });

  it('returns an error for a nonexistent path', async () => {
    const { error } = await runGrep({ pattern: 'x', path: 'no/such/dir' });
    expect(error).toContain('Path not found');
  });

  it('reports truncation with a remediation hint when head_limit is exceeded', async () => {
    const manyLines = Array.from({ length: 30 }, (_, i) => `match line ${String(i)}`).join('\n');
    fs.writeFileSync(path.join(tmpDir, 'many.txt'), manyLines);
    const { output } = await runGrep({ pattern: 'match line', head_limit: 10 });
    expect(output.total_matches).toBe(30);
    expect(output.truncated).toContain('Showing first 10 of 30 matches');
    expect(output.truncated).toContain('Narrow the search');
    const emitted = output.files.reduce((n, f) => n + f.matches.length, 0);
    expect(emitted).toBe(10);
  });

  it('omits line numbers when line_numbers is false', async () => {
    const { output } = await runGrep({ pattern: 'createTool', line_numbers: false, path: 'src/index.ts' });
    expect(output.files[0]?.matches[0]?.line).toBeUndefined();
  });
});
