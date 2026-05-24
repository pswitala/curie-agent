import { homedir } from 'node:os';
import { join, isAbsolute, resolve as pathResolve } from 'node:path';
import { statSync, realpathSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { isPathAllowed, parseAllowlist, createSnapshot, type SessionInfo } from '@curie-agent/core';

export interface SlashCdResult {
  kind: 'usage' | 'error' | 'not-found' | 'success';
  message: string;
}

export interface SlashCdOptions {
  /** Current session's CWD (from metadata). */
  cwd: string;
  /** User-typed path argument. */
  pathArg: string;
  /** Safety settings from the session. */
  safetyPathAllowlist: unknown;
  safetySnapshotsEnabled: boolean;
}

/**
 * Resolve a user-provided path argument into an absolute, expanded path.
 */
export function resolveCdPath(pathArg: string, cwd: string): string {
  const trimmed = pathArg.trim();
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~')) return join(homedir(), trimmed.slice(2));
  if (isAbsolute(trimmed)) return trimmed;
  return pathResolve(cwd, trimmed);
}

/**
 * Validate that the resolved path exists and is a directory.
 * Returns { ok: true, normalized } on success or an error object.
 */
export function validateCdTarget(resolvedPath: string): { ok: true; normalized: string } | { ok: false; message: string } {
  try {
    const stat = statSync(resolvedPath);
    if (!stat.isDirectory()) return { ok: false, message: `"${resolvedPath}" is not a directory.` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return { ok: false, message: `Cannot access "${resolvedPath}": ${msg}` };
  }

  // Normalize (resolve symlinks, cross-platform)
  try {
    return { ok: true, normalized: realpathSync(resolvedPath) };
  } catch {
    return { ok: true, normalized: pathResolve(resolvedPath) };
  }
}

/**
 * Check whether the target directory passes PathGuard safety checks.
 */
export function checkCdSafety(normalizedPath: string, cwd: string, allowlist: string[]): boolean {
  return isPathAllowed(normalizedPath, cwd, allowlist);
}

/**
 * Execute a full /cd operation and return the result.
 * The caller (jsonrpc-handler) emits events based on the result.
 */
export async function executeCd(
  pathArg: string,
  currentCwd: string,
  safetyPathAllowlist: unknown,
  safetySnapshotsEnabled: boolean,
  sessionMetadataPath: string,
): Promise<SlashCdResult> {
  // No args → usage
  if (!pathArg.trim()) {
    return { kind: 'usage', message: 'Usage: `/cd <path>` — Change working directory.\nExamples:\n* `/cd ../other-project` — relative to current\n* `/cd /home/user/docs` — absolute path\n* `/cd ~` — home directory' };
  }

  // Step 1: Resolve path
  const resolved = resolveCdPath(pathArg, currentCwd);

  // Step 2: Validate directory exists
  const validation = validateCdTarget(resolved);
  if (!validation.ok) return { kind: 'error', message: validation.message };

  // Step 3: PathGuard safety check
  const allowlist = parseAllowlist(safetyPathAllowlist);
  if (!checkCdSafety(validation.normalized, currentCwd, allowlist)) {
    return {
      kind: 'error',
      message: `PathGuard: "${validation.normalized}" is outside the allowed directories (project: "${currentCwd}").\nPaths within ~${homedir()}/.curie-agent are always permitted.`,
    };
  }

  // Step 4: Git snapshot of current directory before switching (best-effort)
  try {
    if (safetySnapshotsEnabled) {
      await createSnapshot(currentCwd).catch(() => {});
    }
  } catch {
    // Snapshots are best-effort; silently ignore
  }

  // Step 5: Update session metadata with new CWD
  try {
    if (existsSync(sessionMetadataPath)) {
      const info = JSON.parse(readFileSync(sessionMetadataPath, 'utf-8')) as SessionInfo;
      info.cwd = validation.normalized;
      info.updatedAt = Date.now();
      writeFileSync(sessionMetadataPath, JSON.stringify(info, null, 2) + '\n');
    }
  } catch (err) {
    return { kind: 'error', message: `Failed to update session directory: ${err instanceof Error ? err.message : 'unknown error'}` };
  }

  // Step 6: Success
  return { kind: 'success', message: `Changed directory to:\n**${validation.normalized}**` };
}
