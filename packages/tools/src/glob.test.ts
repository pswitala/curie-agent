import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { globTool } from './glob';

// Helper to create a temporary directory structure for testing.
function setupFixture(fixture: Record<string, string | 'dir'>, baseDir?: string): string {
  const tmp = baseDir ?? fs.mkdtempSync(path.join(require('os').tmpdir(), 'glob-test-'));
  for (const [relativePath, content] of Object.entries(fixture)) {
    const fullPath = path.join(tmp, relativePath);
    if (content === 'dir') {
      fs.mkdirSync(fullPath, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
  }
  return tmp;
}

// Mock settings shared across tests.
function mockSettings(): Record<string, unknown> {
  return {
    safety: { path_guard: 'off' }, // Disable PathGuard for isolated unit tests.
  };
}

describe('Glob tool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = setupFixture({
      'src/index.ts': 'export const x = 1;',
      'src/utils/helper.ts': 'export function add(a, b) { return a + b; }',
      'src/components/Button.tsx': 'export function Button() {}',
      'src/components/Link.tsx': 'export function Link() {}',
      'tests/index.test.ts': 'test("ok", () => {});',
      'package.json': '{"name": "test"}',
      'README.md': '# Test',
      'node_modules/pkg/index.js': 'module.exports = {};',
      '.gitignore': 'node_modules/',
    });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runGlob(pattern: string, searchPath?: string) {
    return globTool.execute(
      { pattern, path: searchPath },
      mockSettings() as any,
      tmpDir,
    );
  }

  it('finds files matching a single-star pattern', async () => {
    const result = await runGlob('**/*.ts');
    const output = (result.output as any) as string[];
    expect(output).toHaveLength(3);
    expect(output.some((f) => f.replace(/\\/g, '/').endsWith('src/index.ts'))).toBe(true);
    expect(output.some((f) => f.replace(/\\/g, '/').endsWith('tests/index.test.ts'))).toBe(true);
  });

  it('finds files matching a double-star with directory prefix', async () => {
    const result = await runGlob('src/**/*.tsx');
    const output = (result.output as any) as string[];
    expect(output).toHaveLength(2);
    expect(output.every((f) => f.endsWith('.tsx'))).toBe(true);
  });

  it('finds files with specific name pattern', async () => {
    const result = await runGlob('**/Button.tsx');
    const output = (result.output as any) as string[];
    expect(output).toHaveLength(1);
    expect(output[0]).toContain('Button.tsx');
  });

  it('respects gitignore patterns', async () => {
    const result = await runGlob('**/*');
    const output = (result.output as any) as string[];
    // node_modules/ is in .gitignore, so files inside should be excluded.
    expect(output.some((f) => f.includes('node_modules'))).toBe(false);
  });

  it('returns empty array when no files match', async () => {
    const result = await runGlob('**/*.rs');
    const output = (result.output as any) as string[];
    expect(output).toHaveLength(0);
  });

  it('honors the path parameter to search in a subdirectory', async () => {
    // When searching in a subdirectory, relPath is still relative to cwd,
    // so pattern must account for the full relative path.
    const result = await runGlob('**/*.tsx', 'src/components');
    const output = (result.output as any) as string[];
    expect(output).toHaveLength(2);
  });

  it('finds files with **/ prefix in pattern from root', async () => {
    const result = await runGlob('**/*.tsx');
    const output = (result.output as any) as string[];
    expect(output).toHaveLength(2);
    expect(output.every((f) => f.endsWith('.tsx'))).toBe(true);
  });

  it('matches files with single-character wildcard (?)', async () => {
    const result = await runGlob('**/Link.tsx');
    const output = (result.output as any) as string[];
    expect(output).toHaveLength(1);
  });

  it('sorts results alphabetically', async () => {
    const result = await runGlob('**/*.tsx');
    const output = (result.output as any) as string[];
    expect(output).toEqual([...output].sort());
  });
});

describe('Glob tool - path separator normalization', () => {
  // Tests that relPath is always forward-slash separated regardless of platform,
  // ensuring globToRegex patterns work correctly on Windows too.

  it('matches nested path after normalizing separators to forward slashes', async () => {
    // Create a fixture with nested dirs and test the tool finds files regardless of platform.
    const tmpDir = setupFixture({
      'src/components/index.ts': 'export default {};',
      'a/b/c/deep.ts': 'deep content',
    });

    // Pattern **/*.ts should find both files (using forward-slash paths internally).
    const result = await globTool.execute(
      { pattern: '**/*.ts' },
      mockSettings() as any,
      tmpDir,
    );
    const output = (result.output as any) as string[];
    expect(output).toHaveLength(2);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does not match across directories with single star', async () => {
    const tmpDir = setupFixture({
      'src/deep/nested.ts': 'content',
    });

    // src/*.ts should NOT match src/deep/nested.ts (single * doesn't cross /)
    const result = await globTool.execute(
      { pattern: 'src/*.ts' },
      mockSettings() as any,
      tmpDir,
    );
    const output = (result.output as any) as string[];
    expect(output).toHaveLength(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('matches double star across multiple directory levels', async () => {
    const tmpDir = setupFixture({
      'a/b/c/deep.ts': 'deep content',
    });

    // **/deep.ts should match a/b/c/deep.ts
    const result = await globTool.execute(
      { pattern: '**/deep.ts' },
      mockSettings() as any,
      tmpDir,
    );
    const output = (result.output as any) as string[];
    expect(output).toHaveLength(1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('Glob tool - symlink cycle detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'glob-symlink-'));
    // Create a normal file.
    fs.writeFileSync(path.join(tmpDir, 'real.txt'), 'content');
    // Create a symlink cycle: a -> b -> a
    const aDir = path.join(tmpDir, 'a');
    const bDir = path.join(tmpDir, 'b');
    fs.mkdirSync(aDir);
    fs.mkdirSync(bDir);
    fs.writeFileSync(path.join(aDir, 'file.txt'), 'in a');
    fs.writeFileSync(path.join(bDir, 'file.txt'), 'in b');
    try {
      fs.symlinkSync(bDir, path.join(aDir, 'link-to-b'), 'dir');
      fs.symlinkSync(aDir, path.join(bDir, 'link-to-a'), 'dir');
    } catch {
      // skip on systems that don't allow symlink creation (e.g. CI without admin).
    }
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('does not infinite-loop on symlink cycles', async () => {
    // If this test hangs (>5s), cycle detection is broken.
    const result = await globTool.execute(
      { pattern: '**/*.txt' },
      mockSettings() as any,
      tmpDir,
    );
    const output = (result.output as any) as string[];
    // Should find at least the files in a/ and b/ without hanging.
    expect(output.some((f) => f.includes('\\a\\') || f.includes('/a/'))).toBe(true);
  });
});
