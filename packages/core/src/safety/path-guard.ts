import path from 'node:path';
import fs from 'node:fs';
import { homedir } from 'node:os';

/** Parse comma-separated allowlist string into absolute path array. */
export function parseAllowlist(raw: string): string[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(expandPath);
}

function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') return homedir() + p.slice(1);
  return p;
}

/** Resolve a path via realpathSync (resolves symlinks) or fall back to resolve. */
function normalize(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** Check if `haystack` starts with `prefix` (cross-platform, separator-aware). */
function startsWith(haystack: string, prefix: string): boolean {
  const a = process.platform === 'win32' ? haystack.toLowerCase() : haystack;
  const b = process.platform === 'win32' ? prefix.toLowerCase() : prefix;
  return a === b || a.startsWith(b + path.sep);
}

/** The ~/.curie-agent directory — always allowed. */
export function curieAgentDir(): string {
  return path.join(homedir(), '.curie-agent');
}

/**
 * Check whether `targetPath` is inside `cwd`, `~/.curie-agent`, or any path in `allowlist`.
 */
export function isPathAllowed(
  targetPath: string,
  cwd: string,
  allowlist: string[],
): boolean {
  const t = normalize(targetPath);
  const c = normalize(cwd);
  if (startsWith(t, c)) return true;
  if (startsWith(t, curieAgentDir())) return true;
  return allowlist.some(a => startsWith(t, normalize(a)));
}

/**
 * Resolve a user-provided path and check against allowlist.
 * Returns `{ path }` on success or `{ error }` on failure.
 */
export function resolveSafePath(
  userInput: string,
  cwd: string,
  allowlist: string[],
): { path: string } | { error: string } {
  const expanded = expandPath(userInput);
  const resolved = path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
  const normalized = normalize(resolved);

  if (!isPathAllowed(normalized, cwd, allowlist)) {
    return {
      error: `PathGuard: path '${normalized}' is outside the allowed directories (project: '${cwd}')`,
    };
  }

  return { path: normalized };
}
