import { describe, expect, it } from 'vitest';
import { isPathAllowed, resolveSafePath, parseAllowlist } from './path-guard.js';

const sep = require('node:path').sep;

describe('parseAllowlist', () => {
  it('returns empty array for empty string', () => {
    expect(parseAllowlist('')).toEqual([]);
  });

  it('returns empty array for whitespace-only', () => {
    expect(parseAllowlist('   ')).toEqual([]);
  });

  it('splits comma-separated paths', () => {
    const result = parseAllowlist('/a,/b,/c');
    expect(result).toContain('/a');
    expect(result).toContain('/b');
    expect(result).toContain('/c');
    expect(result).toHaveLength(3);
  });

  it('trims whitespace around entries', () => {
    const result = parseAllowlist('  /a  ,  /b  ');
    expect(result).toEqual(['/a', '/b']);
  });

  it('filters out empty entries', () => {
    const result = parseAllowlist('/a,,/b,');
    expect(result).toEqual(['/a', '/b']);
  });
});

describe('isPathAllowed', () => {
  // Use paths that exist under the actual cwd so normalize() resolves via realpathSync
  const cwd = process.cwd();

  it('allows paths inside cwd', () => {
    const target = `${cwd}/some/nested/file.txt`;
    expect(isPathAllowed(target, cwd, [])).toBe(true);
  });

  it('denies paths outside cwd with empty allowlist', () => {
    const outside = require('node:path').resolve(cwd, '../other/file.txt');
    expect(isPathAllowed(outside, cwd, [])).toBe(false);
  });

  it('allows paths in allowlist', () => {
    const tmpDir = require('node:path').join(require('node:os').tmpdir(), 'test-allowlist');
    expect(isPathAllowed(`${tmpDir}/file.txt`, cwd, [tmpDir])).toBe(true);
  });

  it('denies parent directory of cwd', () => {
    const parent = require('node:path').resolve(cwd, '..');
    expect(isPathAllowed(parent, cwd, [])).toBe(false);
  });

  it('allows cwd itself', () => {
    expect(isPathAllowed(cwd, cwd, [])).toBe(true);
  });
});

describe('resolveSafePath', () => {
  const cwd = process.cwd();

  it('resolves relative paths inside cwd', () => {
    const result = resolveSafePath('src/file.txt', cwd, []);
    if ('path' in result) {
      expect(result.path).toMatch(/src[\\/]/);
      expect(result.path).toContain('file.txt');
    } else {
      throw new Error(`Expected path, got error: ${result.error}`);
    }
  });

  it('allows absolute paths inside cwd', () => {
    const target = require('node:path').join(cwd, 'file.txt');
    const result = resolveSafePath(target, cwd, []);
    if ('path' in result) {
      expect(result.path).toBe(target);
    } else {
      throw new Error(`Expected path, got error: ${result.error}`);
    }
  });

  it('denies absolute paths outside cwd', () => {
    const outside = require('node:path').resolve(cwd, '../other/file.txt');
    const result = resolveSafePath(outside, cwd, []);
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('PathGuard');
    }
  });

  it('denies path traversal attempts', () => {
    const result = resolveSafePath('../../../etc/passwd', cwd, []);
    expect('error' in result).toBe(true);
  });

  it('allows paths in allowlist', () => {
    const tmpDir = require('node:path').join(require('node:os').tmpdir(), 'test-allowlist-2');
    const target = require('node:path').join(tmpDir, 'file.txt');
    const result = resolveSafePath(target, cwd, [tmpDir]);
    if ('path' in result) {
      expect(result.path).toBe(target);
    } else {
      throw new Error(`Expected path, got error: ${result.error}`);
    }
  });
});
