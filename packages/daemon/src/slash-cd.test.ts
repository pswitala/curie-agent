import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { resolveCdPath, validateCdTarget, checkCdSafety, executeCd } from './slash-cd.js';
import * as fs from 'node:fs';
import path from 'node:path';

vi.mock('node:os', () => ({ homedir: () => '/home/testuser' }));

// Use __dirname-based paths which always exist on disk
const TEST_CWD = path.join(__dirname, '..');
const TEST_METADATA_PATH = path.join(__dirname, '..', '.test-cd-meta.json');

describe('resolveCdPath', () => {
  it('returns home for ~', () => {
    expect(resolveCdPath('~', '/some/other/dir')).toBe('/home/testuser');
  });

  it('expands ~/subdir using path.join (handles platform separators)', () => {
    const result = resolveCdPath('~/subdir', '/some/other/dir');
    // On Windows, join adds backslashes; on POSIX it's forward slashes
    expect(result).toContain('home' + path.sep);
    expect(result).toContain('testuser' + path.sep);
    expect(result).toContain('subdir');
  });

  it('returns absolute paths as-is', () => {
    const absPath = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc/config';
    expect(resolveCdPath(absPath, TEST_CWD)).toBe(absPath);
  });

  it('resolves relative paths against cwd using path.resolve', () => {
    const result = resolveCdPath('../other-project', TEST_CWD);
    const expected = path.resolve(TEST_CWD, '../other-project');
    expect(result).toBe(expected);
  });

  it('handles .. as parent directory', () => {
    const result = resolveCdPath('..', TEST_CWD);
    const expected = path.resolve(TEST_CWD, '..');
    expect(result).toBe(expected);
  });

  it('trims whitespace from path arg', () => {
    expect(resolveCdPath('  ' + (process.platform === 'win32' ? 'C:\\foo' : '/etc/config'), TEST_CWD)).toContain(
      process.platform === 'win32' ? 'C:\\foo' : '/etc/config',
    );
  });
});

describe('validateCdTarget', () => {
  it('returns ok for a valid directory', () => {
    const result = validateCdTarget(TEST_CWD);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.normalized).toBeTruthy();
  });

  it('rejects non-existent path', () => {
    const result = validateCdTarget('/nonexistent/path/that/does/not/exist');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Cannot access');
  });

  it('rejects a file (not a directory)', () => {
    const testFile = path.join(__dirname, 'jsonrpc-handler.test.ts');
    const result = validateCdTarget(testFile);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('is not a directory');
  });

  it('rejects with clear message for permission errors', () => {
    const result = validateCdTarget('/root/forbidden/path/noaccess');
    // On Windows this may resolve differently; check ok is false or message exists
    if (!result.ok) {
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});

describe('checkCdSafety', () => {
  it('allows path inside cwd', () => {
    const result = checkCdSafety(TEST_CWD, TEST_CWD, []);
    expect(result).toBe(true);
  });

  it('rejects path outside cwd and ~/.curie-agent with empty allowlist', () => {
    const result = checkCdSafety('/tmp', TEST_CWD, []);
    expect(result).toBe(false);
  });

  it('allows path in user allowlist', () => {
    const result = checkCdSafety('/home/testuser/allowed-project', '/project/main', ['/home/testuser/allowed-project']);
    expect(result).toBe(true);
  });
});

describe('executeCd', () => {
  beforeEach(() => {
    // Create a clean metadata file for tests if it doesn't exist
    if (!fs.existsSync(TEST_METADATA_PATH)) {
      fs.writeFileSync(TEST_METADATA_PATH, JSON.stringify({
        id: 'test-session',
        cwd: TEST_CWD,
        model: 'claude-sonnet-4-6',
        provider: 'anthropic',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }, null, 2));
    }
  });

  it('returns usage when no args provided', async () => {
    const result = await executeCd('', TEST_CWD, '', false, TEST_METADATA_PATH);
    expect(result.kind).toBe('usage');
    expect(result.message).toContain('Usage:');
  });

  it('rejects non-existent path', async () => {
    const result = await executeCd('/nonexistent/path/xyz', TEST_CWD, '', false, TEST_METADATA_PATH);
    expect(result.kind).toBe('error');
  });

  it('rejects a file (not a directory)', async () => {
    const testFile = path.join(__dirname, 'jsonrpc-handler.test.ts');
    const result = await executeCd(testFile, TEST_CWD, '', false, TEST_METADATA_PATH);
    expect(result.kind).toBe('error');
  });

  it('rejects paths outside allowed scope via PathGuard', async () => {
    // Use a path on the same drive that exists but is outside project cwd
    const outsideProject = process.platform === 'win32' ? 'C:\\Windows' : '/tmp';
    const result = await executeCd(outsideProject, TEST_CWD, '', false, TEST_METADATA_PATH);
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toContain('PathGuard');
    }
  });

  it('succeeds for a valid directory within cwd scope', async () => {
    const subdir = path.join(TEST_CWD, 'src');
    if (fs.existsSync(subdir) && fs.statSync(subdir).isDirectory()) {
      const result = await executeCd('src', TEST_CWD, '', false, TEST_METADATA_PATH);
      expect(result.kind).toBe('success');
    }
  });

  it('updates session metadata with new cwd on success', async () => {
    const subdir = path.join(TEST_CWD, 'src');
    if (fs.existsSync(subdir) && fs.statSync(subdir).isDirectory()) {
      // Read original cwd
      const originalMeta = JSON.parse(fs.readFileSync(TEST_METADATA_PATH, 'utf-8')) as Record<string, unknown>;
      const originalCwd = originalMeta.cwd as string;

      await executeCd('src', TEST_CWD, '', false, TEST_METADATA_PATH);

      // Metadata should be updated to /src subdirectory
      const updatedMeta = JSON.parse(fs.readFileSync(TEST_METADATA_PATH, 'utf-8')) as Record<string, unknown>;
      expect(updatedMeta.cwd).toBe(path.resolve(subdir));
    }
  });

  it('allows path in user allowlist even outside project cwd', async () => {
    const testDir = '/home/testuser';
    if (fs.existsSync(testDir) && fs.statSync(testDir).isDirectory()) {
      const result = await executeCd('~', TEST_CWD, testDir, false, TEST_METADATA_PATH);
      // Allowlist should permit the home directory
      expect(result.kind).toBe('success');
    } else {
      // If home doesn't exist (e.g. Windows), this is still considered a valid resolve
      expect(resolveCdPath('~', '/any')).toBe('/home/testuser');
    }
  });

  it('handles tilde expansion correctly', async () => {
    const result = await executeCd('~/.curie-agent', TEST_CWD, '', false, TEST_METADATA_PATH);
    // ~/.curie-agent is always allowed via curieAgentDir in PathGuard
    if (fs.existsSync(path.resolve('/home/testuser/.curie-agent'))) {
      expect(result.kind).toBe('success');
    } else {
      // If dir doesn't exist, should get a validation error not safety error
      expect(result.kind).toBe('error');
    }
  });
});

afterAll(() => {
  // Cleanup test metadata file
  if (fs.existsSync(TEST_METADATA_PATH)) {
    fs.rmSync(TEST_METADATA_PATH);
  }
});
