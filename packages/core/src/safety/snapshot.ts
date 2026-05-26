import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

function execFileAsync(
  command: string,
  args: string[],
  options: { cwd: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(err);
      resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

/** A single git snapshot entry. */
export interface Snapshot {
  sha: string;
  timestamp: string; // ISO 8601
  cwd: string;
  label: string;
  changedFiles: number;
}

const SNAPSHOTS_DIR = join(homedir(), '.curie-agent', 'snapshots');

function getDirHash(cwd: string): string {
  return createHash('md5').update(cwd).digest('hex').substring(0, 8);
}

function getProjectLogPath(cwd: string): string {
  const dirName = basename(cwd);
  return join(SNAPSHOTS_DIR, `snapshot-${dirName}-${getDirHash(cwd)}.log`);
}

function sanitizeRef(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]/g, '_').substring(0, 50);
}

/**
 * Create a git snapshot of the current working tree.
 * Uses `git stash create` to produce a dangling commit.
 * Returns the commit SHA on success, or an error string on failure.
 *
 * @param prompt - User message used as the snapshot label (first 25 chars).
 */
export async function createSnapshot(
  cwd: string,
  prompt?: string,
): Promise<{ sha: string } | { error: string }> {
  try {
    // Check we're inside a git repo
    const isWorkTree = await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
    if (isWorkTree.stdout.trim() !== 'true') {
      return { error: 'Not a git repository' };
    }

    // Create snapshot for tracked + staged changes
    let result = await execFileAsync('git', ['stash', 'create'], { cwd });
    let sha = result.stdout.trim();

    // Also capture untracked files via a second stash create with --include-untracked
    try {
      const untracked = await execFileAsync('git', ['stash', 'create', '--include-untracked'], { cwd });
      const untrackedSha = untracked.stdout.trim();
      if (untrackedSha) {
        sha = untrackedSha; // prefer the more complete snapshot
      }
    } catch {
      // If --include-untracked fails, fall back to tracked-only snapshot
    }

    // If no changes at all, use the initial commit as snapshot baseline
    if (!sha) {
      try {
        const initial = await execFileAsync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd });
        sha = initial.stdout.trim().split('\n')[0]!;
      } catch {
        return { error: 'Failed to create snapshot (no changes detected)' };
      }
    }

    // Count changed files: tracked changes + untracked files
    // Exclude the snapshots.log file from the count (it's the metadata store, not a project change)
    const statusResult = await execFileAsync('git', ['status', '--porcelain'], { cwd });
    const changedFiles = statusResult.stdout
      .split('\n')
      .filter(Boolean)
      .filter(line => !line.includes('snapshots.log'))
      .length;

    // Build label from prompt (first 25 chars) or fallback
    let label: string;
    if (prompt) {
      label = prompt.replace(/\s+/g, ' ').trim().substring(0, 25);
      if (label.length === 25 && prompt.length > 25) {
        // Try to break on a word boundary
        const lastSpace = label.lastIndexOf(' ');
        if (lastSpace > 0) label = prompt.substring(0, lastSpace).trim();
      }
    } else {
      label = 'auto';
    }

    // Register snapshot in per-project log file
    const logPath = getProjectLogPath(cwd);
    ensureDir(logPath);
    const timestamp = new Date().toISOString();
    const logLine = `${timestamp}\t${sha}\t${changedFiles}\t${label}\n`;
    try {
      appendFileSync(logPath, logLine);
    } catch {
      // Append failure is non-fatal — snapshot still exists as dangling commit
    }

    // Create a lightweight ref so git gc doesn't reclaim for 90 days
    const refName = `refs/curie/snapshots/${sanitizeRef(timestamp)}-${changedFiles}`;
    try {
      await execFileAsync('git', ['update-ref', refName, sha], { cwd });
    } catch {
      // Ref creation failure is non-fatal
    }

    return { sha };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Snapshot failed: ${msg}` };
  }
}

/**
 * List recent snapshots for a given cwd.
 * Returns up to 20 entries sorted newest-first.
 */
export function listSnapshots(cwd: string): Snapshot[] {
  const logPath = getProjectLogPath(cwd);
  if (!existsSync(logPath)) return [];

  const content = readFileSync(logPath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  // Format: timestamp\tsha\tchangedFiles\tlabel
  const snapshots: Snapshot[] = [];
  for (const line of lines) {
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const [timestamp, sha, changedFilesStr, ...labelParts] = parts;
    if (!sha || !changedFilesStr) continue;
    snapshots.push({
      sha,
      timestamp: timestamp!,
      cwd,
      label: labelParts.join('\t'),
      changedFiles: parseInt(changedFilesStr, 10) || 0,
    });
  }

  return snapshots.reverse().slice(0, 20);
}

/**
 * Revert to a specific snapshot by SHA.
 * Uses `git checkout <sha> -- .` to restore files from the snapshot tree.
 */
export async function revertTo(
  cwd: string,
  sha: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    await execFileAsync('git', ['checkout', sha, '--', '.'], { cwd });
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: `Revert failed: ${msg}`,
    };
  }
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
