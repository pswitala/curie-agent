import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { isPathAllowed, parseAllowlist } from '@curie-agent/core/safety/path-guard.js';
import { createTool, expandPath, type ToolContext } from './tool.js';

const GlobSchema = z.object({
  pattern: z.string().describe('The glob pattern to match files against'),
  path: z.string().optional().describe('The directory to search in'),
});

function minimatch(pattern: string, str: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(str);
}

function globToRegex(pattern: string): RegExp {
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

function readGitignore(cwd: string): string[] {
  const gitignorePath = path.join(cwd, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return [];
  return fs
    .readFileSync(gitignorePath, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function shouldIgnore(relPath: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (minimatch(p, relPath)) return true;
    // Also match as directory prefix: "node_modules" should ignore node_modules/foo/bar
    const dirPrefix = p.replace(/\/$/, '') + '/';
    if (relPath.startsWith(dirPrefix)) return true;
  }
  return false;
}

export const globTool = createTool(
  'Glob',
  'Fast file pattern matching. Gitignore-aware file pattern matching.',
  GlobSchema,
  async (input, ctx: ToolContext) => {
    const searchDir = input.path ? path.resolve(ctx.cwd, expandPath(input.path)) : ctx.cwd;

    // Safety: refuse searches outside allowed directories.
    if (ctx.settings.safety?.path_guard !== 'off') {
      const allowlist = parseAllowlist(ctx.settings.safety?.path_allowlist ?? '');
      if (!isPathAllowed(searchDir, ctx.cwd, allowlist)) {
        return { output: null, error: 'PathGuard: glob blocked — path is outside allowed directories' };
      }
    }

    // Read .gitignore from both cwd (global filters) and searchDir (local filters).
    const cwdGitignorePatterns = readGitignore(ctx.cwd);

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
        // Normalize to forward slashes so globToRegex patterns work on all platforms.
        const relPath = path.relative(ctx.cwd, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (shouldIgnore(relPath, cwdGitignorePatterns)) continue;
          walk(fullPath, depth + 1);
        } else {
          if (shouldIgnore(relPath, cwdGitignorePatterns)) continue;
          if (minimatch(input.pattern, relPath)) {
            results.push(fullPath);
          }
        }
      }
    }

    walk(searchDir, 0);
    return { output: results.sort() };
  },
);
