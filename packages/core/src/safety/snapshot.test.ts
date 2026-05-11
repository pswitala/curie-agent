import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createSnapshot, listSnapshots, revertTo } from './snapshot.js';

const testDir = join(tmpdir(), 'curie-agent-snapshot-test');

function getLogPath(cwd: string): string {
  const dirName = basename(cwd);
  const hash = createHash('md5').update(cwd).digest('hex').substring(0, 8);
  // SNAPSHOTS_DIR is homedir()/.curie-agent/snapshots (same as the module)
  return join(homedir(), '.curie-agent', 'snapshots', `snapshot-${dirName}-${hash}.log`);
}

function cleanLog(cwd: string) {
  const logPath = getLogPath(cwd);
  if (existsSync(logPath)) {
    writeFileSync(logPath, '');
  }
}

function setupRepo(cwd: string) {
  execSync('git init', { cwd, stdio: 'ignore' });
  execSync("git config user.email 'test@test.com'", { cwd, stdio: 'ignore' });
  execSync("git config user.name 'Test'", { cwd, stdio: 'ignore' });
  writeFileSync(join(cwd, 'initial.txt'), 'initial');
  execSync('git add initial.txt', { cwd, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd, stdio: 'ignore' });
}

function cleanupDir(dir: string) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('createSnapshot', () => {
  let repoDir: string;

  beforeEach(() => {
    cleanupDir(testDir);
    mkdirSync(testDir, { recursive: true });
    repoDir = join(testDir, 'repo');
    mkdirSync(repoDir, { recursive: true });
    setupRepo(repoDir);
    cleanLog(repoDir);
  });

  afterEach(() => {
    cleanupDir(testDir);
  });

  it('returns sha for a git repo with changes', async () => {
    writeFileSync(join(repoDir, 'initial.txt'), 'modified');
    const result = await createSnapshot(repoDir, 'test');

    if ('error' in result) {
      throw new Error(`Expected sha, got error: ${result.error}`);
    }
    expect(result.sha).toHaveLength(40);
    const output = execSync(`git cat-file -t ${result.sha}`, { cwd: repoDir, encoding: 'utf-8' }).trim();
    expect(output).toBe('commit');
  });

  it('returns error for non-git directory', async () => {
    const nonGit = join(testDir, 'non-git');
    mkdirSync(nonGit, { recursive: true });
    const result = await createSnapshot(nonGit, 'test');
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.error).toContain('git');
    }
  });

  it('logs snapshot to per-project log file', async () => {
    writeFileSync(join(repoDir, 'initial.txt'), 'modified');
    const result = await createSnapshot(repoDir, 'test-label');

    if ('error' in result) throw new Error(result.error);

    // Verify by re-reading through listSnapshots
    const snapshots = listSnapshots(repoDir);
    expect(snapshots).toHaveLength(1);
    const snap = snapshots[0];
    expect(snap.sha).toBe(result.sha);
    expect(snap.changedFiles).toBe(1);
    expect(snap.label).toBe('test-label');
  });

  it('records changed files count', async () => {
    writeFileSync(join(repoDir, 'initial.txt'), 'modified');
    writeFileSync(join(repoDir, 'extra.txt'), 'new file');
    const result = await createSnapshot(repoDir, 'multi-file');
    if ('error' in result) throw new Error(result.error);

    const snapshots = listSnapshots(repoDir);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].changedFiles).toBe(2);
  });

  it('truncates long prompts to word boundary', async () => {
    const longPrompt = 'this is a very long user prompt that should be truncated';
    const result = await createSnapshot(repoDir, longPrompt);
    if ('error' in result) throw new Error(result.error);

    const snapshots = listSnapshots(repoDir);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].label.length).toBeLessThanOrEqual(25);
  });
});

describe('listSnapshots', () => {
  let repoDir: string;

  beforeEach(() => {
    cleanupDir(testDir);
    mkdirSync(testDir, { recursive: true });
    repoDir = join(testDir, 'repo');
    mkdirSync(repoDir, { recursive: true });
    setupRepo(repoDir);
    cleanLog(repoDir);
  });

  afterEach(() => {
    cleanupDir(testDir);
  });

  it('returns empty array when no snapshots exist', () => {
    const result = listSnapshots(repoDir);
    expect(result).toEqual([]);
  });

  it('returns snapshots in newest-first order', async () => {
    writeFileSync(join(repoDir, 'initial.txt'), 'modified');
    await createSnapshot(repoDir, 'first');
    await new Promise(r => setTimeout(r, 10));
    writeFileSync(join(repoDir, 'initial.txt'), 'modified-2');
    await createSnapshot(repoDir, 'second');

    const snapshots = listSnapshots(repoDir);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].label).toBe('second');
    expect(snapshots[1].label).toBe('first');
  });

  it('keeps snapshots from different repos separate', async () => {
    const repo2Dir = join(testDir, 'repo2');
    mkdirSync(repo2Dir, { recursive: true });
    setupRepo(repo2Dir);
    cleanLog(repo2Dir);

    writeFileSync(join(repoDir, 'initial.txt'), 'modified');
    await createSnapshot(repoDir, 'repo1-snap');
    writeFileSync(join(repo2Dir, 'initial.txt'), 'modified');
    await createSnapshot(repo2Dir, 'repo2-snap');

    const repo1Snaps = listSnapshots(repoDir);
    const repo2Snaps = listSnapshots(repo2Dir);
    expect(repo1Snaps).toHaveLength(1);
    expect(repo2Snaps).toHaveLength(1);
    expect(repo1Snaps[0].label).toBe('repo1-snap');
    expect(repo2Snaps[0].label).toBe('repo2-snap');
  });
});

describe('revertTo', () => {
  let repoDir: string;

  beforeEach(() => {
    cleanupDir(testDir);
    mkdirSync(testDir, { recursive: true });
    repoDir = join(testDir, 'repo');
    mkdirSync(repoDir, { recursive: true });
    setupRepo(repoDir);
    cleanLog(repoDir);
  });

  afterEach(() => {
    cleanupDir(testDir);
  });

  it('restores files to snapshot state', async () => {
    const snap = await createSnapshot(repoDir, 'original');
    if ('error' in snap) throw new Error(snap.error);

    writeFileSync(join(repoDir, 'initial.txt'), 'mutated-after-snapshot');

    const result = await revertTo(repoDir, snap.sha);
    expect(result.success).toBe(true);

    const content = readFileSync(join(repoDir, 'initial.txt'), 'utf-8');
    expect(content).toBe('initial');
  });

  it('returns failure for invalid sha', async () => {
    const result = await revertTo(repoDir, '0000000000000000000000000000000000000000');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
