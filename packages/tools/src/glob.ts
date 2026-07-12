import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { isPathAllowed, parseAllowlist } from '@curie-agent/core/safety/path-guard.js';
import { createTool, expandPath, type ToolContext } from './tool.js';

const GlobSchema = z.object({
  pattern: z
    .string()
    .describe(
      'Glob pattern to match against. Use forward slashes on all platforms. ' +
        '`*` = one level, `**` = any depth. Pattern is relative to `path` (or cwd if omitted).',
    ),
  path: z
    .string()
    .optional()
    .describe('Directory to search in. Defaults to cwd. Accepts forward or backward slashes.'),
});

export function minimatch(pattern: string, str: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(str);
}

export function globToRegex(pattern: string): RegExp {
  // Use unique Unicode placeholders instead of backslash-escaping to avoid conflicts
  // between the ** protection and single-* replacement steps.
  const placeholder = '';
  const regex = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, placeholder)
    .replace(/\*/g, '[^/]*')
    .replace(placeholder, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${regex}$`);
}

export function readGitignore(cwd: string): string[] {
  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return [];
  return fs
    .readFileSync(gitignorePath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

export function shouldIgnore(relPath: string, patterns: string[]): boolean {
  for (const p of patterns) {
    const clean = p.replace(/\/$/, '');
    if (!clean) continue;
    if (clean.includes('/')) {
      // Anchored pattern: match the relative path itself or as a directory prefix.
      if (minimatch(clean, relPath)) return true;
      if (relPath.startsWith(clean + '/')) return true;
    } else {
      // Bare pattern (gitignore semantics): matches any path segment at any depth,
      // e.g. "dist" ignores dist/ and packages/foo/dist/.
      if (relPath.split('/').some((segment) => minimatch(clean, segment))) return true;
    }
  }
  return false;
}

export const globTool = createTool(
  'Glob',
  [
    'Fast, gitignore-aware recursive file search by glob pattern (finds files by NAME — use Grep to search file contents).',
    'Pattern syntax: `*` matches anything within one directory level; `**` matches across any depth.',
    'Always use forward slashes in patterns, even on Windows (e.g., `src/**/*.ts`).',
    'When `path` is supplied, the pattern matches relative to that directory.',
    'Results are returned as absolute paths, sorted alphabetically.',
    'Examples: `**/*.ts` (all TypeScript files), `src/*/index.ts` (index files one level deep in src/).',
  ].join(' '),
  GlobSchema,
  async (input, ctx: ToolContext) => {
    // Normalize backslashes in path input so Windows-style paths work correctly.
    const rawPath = input.path ? input.path.replace(/\\/g, '/') : undefined;
    const searchDir = rawPath ? path.resolve(ctx.cwd, expandPath(rawPath)) : ctx.cwd;

    // Safety: refuse searches outside allowed directories.
    if (ctx.settings.safety?.path_guard !== 'off') {
      const allowlist = parseAllowlist(ctx.settings.safety?.path_allowlist ?? '');
      if (!isPathAllowed(searchDir, ctx.cwd, allowlist)) {
        return { output: null, error: 'PathGuard: glob blocked — path is outside allowed directories' };
      }
    }

    // Read .gitignore from cwd (global filters) and searchDir if different (local filters).
    const cwdGitignorePatterns = readGitignore(ctx.cwd);
    const searchDirGitignorePatterns = searchDir !== ctx.cwd ? readGitignore(searchDir) : [];
    const allIgnorePatterns = [...cwdGitignorePatterns, ...searchDirGitignorePatterns];

    const results: string[] = [];

    // Track visited real directories to prevent symlink cycle loops.
    const visitedDirs = new Set<string>();

    function walk(dir: string, depth: number) {
      if (depth > 100) return; // Safety limit
      let realDir: string;
      try {
        realDir = fs.realpathSync(dir);
      } catch {
        return; // Can't resolve directory (dangling symlink, permission denied)
      }
      if (visitedDirs.has(realDir)) return;
      visitedDirs.add(realDir);

      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        // relPath is cwd-relative (for gitignore filtering); patternPath is searchDir-relative (for matching).
        const relPath = path.relative(ctx.cwd, fullPath).replace(/\\/g, '/');
        const patternPath = path.relative(searchDir, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (shouldIgnore(relPath, allIgnorePatterns)) continue;
          walk(fullPath, depth + 1);
        } else {
          if (shouldIgnore(relPath, allIgnorePatterns)) continue;
          if (minimatch(input.pattern, patternPath)) {
            results.push(fullPath);
          }
        }
      }
    }

    walk(searchDir, 0);
    return { output: results.sort() };
  },
);
