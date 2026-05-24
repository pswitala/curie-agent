import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { isPathAllowed, parseAllowlist } from '@curie-agent/core/safety/path-guard.js';
import { createTool, expandPath, type ToolContext } from './tool.js';

const GrepSchema = z.object({
  pattern: z.string().describe('The regular expression pattern to search for'),
  path: z.string().optional().describe('File or directory to search in'),
  glob: z.string().optional().describe('Glob pattern to filter files'),
  type: z.string().optional().describe('File type to search (js, py, ts, etc.)'),
  '-i': z.boolean().optional().describe('Case insensitive search'),
  '-n': z.boolean().optional().describe('Show line numbers'),
  context: z.number().optional().describe('Lines of context before and after'),
});

const EXT_MAP: Record<string, string[]> = {
  js: ['.js', '.jsx', '.mjs'],
  ts: ['.ts', '.tsx'],
  py: ['.py'],
  rust: ['.rs'],
  go: ['.go'],
  java: ['.java'],
  rb: ['.rb'],
  rs: ['.rs'],
};

export const grepTool = createTool(
  'Grep',
  'Content search with regex support. Searches file contents for matching patterns.',
  GrepSchema,
  async (input, ctx: ToolContext) => {
    const searchPath = input.path ? path.resolve(ctx.cwd, expandPath(input.path)) : ctx.cwd;

    // Safety: refuse searches outside allowed directories.
    if (ctx.settings.safety?.path_guard !== 'off') {
      const allowlist = parseAllowlist(ctx.settings.safety?.path_allowlist ?? '');
      if (!isPathAllowed(searchPath, ctx.cwd, allowlist)) {
        return { output: null, error: 'PathGuard: grep blocked — path is outside allowed directories' };
      }
    }

    const regexFlags = input['-i'] ? 'gi' : 'g';
    const pattern = input.pattern ?? '';
    const regex = new RegExp(pattern, regexFlags);

    const allowedExts = input.type ? EXT_MAP[input.type] : null;
    const results: Array<{ file: string; line: number; text: string }> = [];

    function walk(dir: string) {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          walk(fullPath);
        } else if (entry.isFile()) {
          if (allowedExts) {
            const ext = path.extname(entry.name).toLowerCase();
            if (!allowedExts.includes(ext)) continue;
          }
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              regex.lastIndex = 0;
              const line = lines[i];
              if (line && regex.test(line)) {
                results.push({ file: fullPath, line: i + 1, text: line });
              }
            }
          } catch {
            // skip binary files
          }
        }
      }
    }

    walk(searchPath);

    return {
      output: {
        pattern: input.pattern,
        matches: results.length,
        results: results.slice(0, 250),
      },
    };
  },
);
