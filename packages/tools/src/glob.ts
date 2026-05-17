import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
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
  let regex = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\\*\\*')
    .replace(/\*/g, '[^/]*')
    .replace(/\\\*\\\*/g, '.*')
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
    if (minimatch(`${p}/**`, relPath)) return true;
  }
  return false;
}

export const globTool = createTool(
  'Glob',
  'Fast file pattern matching. Gitignore-aware file pattern matching.',
  GlobSchema,
  async (input, ctx: ToolContext) => {
    const searchDir = input.path ? path.resolve(ctx.cwd, expandPath(input.path)) : ctx.cwd;
    const gitignorePatterns = readGitignore(ctx.cwd);

    const results: string[] = [];

    function walk(dir: string) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(ctx.cwd, fullPath);

        if (entry.isDirectory()) {
          if (shouldIgnore(relPath, gitignorePatterns)) continue;
          walk(fullPath);
        } else {
          if (shouldIgnore(relPath, gitignorePatterns)) continue;
          if (minimatch(input.pattern, relPath)) {
            results.push(fullPath);
          }
        }
      }
    }

    walk(searchDir);
    return { output: results.sort() };
  },
);
