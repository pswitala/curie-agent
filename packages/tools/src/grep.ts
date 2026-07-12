import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { isPathAllowed, parseAllowlist } from '@curie-agent/core/safety/path-guard.js';
import { minimatch, readGitignore, shouldIgnore } from './glob.js';
import { createTool, expandPath, type ToolContext } from './tool.js';

const EXT_MAP: Record<string, string[]> = {
  js: ['.js', '.jsx', '.mjs', '.cjs'],
  ts: ['.ts', '.tsx', '.mts', '.cts'],
  py: ['.py'],
  rust: ['.rs'],
  rs: ['.rs'],
  go: ['.go'],
  java: ['.java'],
  rb: ['.rb'],
  c: ['.c', '.h'],
  cpp: ['.cpp', '.cc', '.cxx', '.hpp', '.hh'],
  cs: ['.cs'],
  php: ['.php'],
  swift: ['.swift'],
  kotlin: ['.kt', '.kts'],
  scala: ['.scala'],
  sh: ['.sh', '.bash'],
  md: ['.md', '.markdown'],
  json: ['.json', '.jsonc'],
  yaml: ['.yml', '.yaml'],
  html: ['.html', '.htm'],
  css: ['.css', '.scss', '.less'],
  sql: ['.sql'],
  toml: ['.toml'],
  xml: ['.xml'],
};

const FILE_TYPES = Object.keys(EXT_MAP) as [string, ...string[]];

const MAX_FILE_SIZE = 1_000_000; // skip files larger than 1 MB
const MAX_LINE_LENGTH = 300;
const DEFAULT_HEAD_LIMIT = 250;

const GrepSchema = z.object({
  pattern: z
    .string()
    .describe(
      'The regular expression to search for (JavaScript RegExp syntax). ' +
        'Escape literal characters like ( ) [ ] { } . + * ? with a backslash.',
    ),
  path: z
    .string()
    .optional()
    .describe('File or directory to search in. Defaults to the current working directory.'),
  glob: z
    .string()
    .optional()
    .describe(
      'Glob pattern to filter which files are searched (e.g. "*.ts", "src/**/*.tsx"). ' +
        'Patterns without "/" match against the file name only.',
    ),
  type: z
    .enum(FILE_TYPES)
    .optional()
    .describe(`File type to search, one of: ${FILE_TYPES.join(', ')}`),
  case_insensitive: z.boolean().optional().describe('Case-insensitive search (default false)'),
  line_numbers: z.boolean().optional().describe('Include 1-based line numbers in results (default true)'),
  context: z.number().optional().describe('Number of lines to include before and after each match'),
  head_limit: z
    .number()
    .optional()
    .describe(`Maximum number of match rows to return (default ${String(DEFAULT_HEAD_LIMIT)})`),
});

function truncateLine(line: string): string {
  return line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + '…' : line;
}

interface MatchRow {
  line?: number;
  text: string;
  before?: string[];
  after?: string[];
}

export const grepTool = createTool(
  'Grep',
  [
    'Searches file CONTENTS for a regular expression (use Glob to find files by NAME).',
    'Gitignore-aware: files ignored by .gitignore (plus node_modules/.git) are skipped,',
    'unless `path` points directly inside an ignored directory (e.g. deliberately searching dist/).',
    'Filter files with `glob` (e.g. "*.ts") or `type` (e.g. "ts"). `path` may be a directory or a single file.',
    'Results are grouped by file with cwd-relative forward-slash paths and 1-based line numbers,',
    'capped at `head_limit` rows (default 250) with an explicit truncation notice — narrow the search when you see one.',
  ].join(' '),
  GrepSchema,
  async (input, ctx: ToolContext) => {
    const rawPath = input.path ? input.path.replace(/\\/g, '/') : undefined;
    const searchPath = rawPath ? path.resolve(ctx.cwd, expandPath(rawPath)) : ctx.cwd;

    // Safety: refuse searches outside allowed directories.
    if (ctx.settings.safety?.path_guard !== 'off') {
      const allowlist = parseAllowlist(ctx.settings.safety?.path_allowlist ?? '');
      if (!isPathAllowed(searchPath, ctx.cwd, allowlist)) {
        return { output: null, error: 'PathGuard: grep blocked — path is outside allowed directories' };
      }
    }

    let regex: RegExp;
    try {
      regex = new RegExp(input.pattern, input.case_insensitive ? 'i' : '');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        output: null,
        error:
          `Invalid regular expression "${input.pattern}": ${msg}. ` +
          'Escape literal characters like ( ) [ ] { } . + * ? with a backslash.',
      };
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(searchPath);
    } catch {
      return { output: null, error: `Path not found: ${searchPath}` };
    }

    const searchDir = stat.isDirectory() ? searchPath : path.dirname(searchPath);
    const searchRel = path.relative(ctx.cwd, searchPath).replace(/\\/g, '/');
    const insideCwd = searchRel === '' || (!searchRel.startsWith('..') && !path.isAbsolute(searchRel));

    // Gitignore filtering: cwd patterns plus local patterns from the search dir.
    // When the caller explicitly targets a path that is itself gitignored
    // (e.g. grepping dist/ on purpose), respect that intent and skip filtering.
    const cwdPatterns = insideCwd ? readGitignore(ctx.cwd) : [];
    const localPatterns = searchDir !== ctx.cwd ? readGitignore(searchDir) : [];
    // Check both "dist" and "dist/" forms so a directory target matches "dist/" patterns.
    const explicitlyIgnored =
      searchRel !== '' &&
      insideCwd &&
      (shouldIgnore(searchRel, cwdPatterns) || shouldIgnore(searchRel + '/', cwdPatterns));
    const ignoreBase = insideCwd ? ctx.cwd : searchDir;
    const ignorePatterns = explicitlyIgnored ? [] : insideCwd ? [...cwdPatterns, ...localPatterns] : localPatterns;

    const allowedExts = input.type ? EXT_MAP[input.type] : undefined;
    const globPattern = input.glob;
    const headLimit = input.head_limit ?? DEFAULT_HEAD_LIMIT;
    const includeLineNumbers = input.line_numbers !== false;
    const contextLines = input.context ?? 0;

    const files: { file: string; matches: MatchRow[] }[] = [];
    let totalMatches = 0;
    let emitted = 0;

    function toRelative(fullPath: string): string {
      const rel = path.relative(ctx.cwd, fullPath).replace(/\\/g, '/');
      return rel === '' || rel.startsWith('..') ? fullPath.replace(/\\/g, '/') : rel;
    }

    function matchesGlob(fullPath: string): boolean {
      if (!globPattern) return true;
      if (globPattern.includes('/')) {
        const rel = path.relative(searchDir, fullPath).replace(/\\/g, '/');
        return minimatch(globPattern, rel);
      }
      return minimatch(globPattern, path.basename(fullPath));
    }

    function scanFile(fullPath: string) {
      let content: string;
      try {
        const fileStat = fs.statSync(fullPath);
        if (fileStat.size > MAX_FILE_SIZE) return;
        const buf = fs.readFileSync(fullPath);
        if (buf.subarray(0, 8192).includes(0)) return; // binary file
        content = buf.toString('utf-8');
      } catch {
        return; // unreadable file
      }
      const lines = content.split('\n');
      let group: { file: string; matches: MatchRow[] } | undefined;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined || line === '' || !regex.test(line)) continue;
        totalMatches++;
        if (emitted >= headLimit) continue; // keep counting, stop emitting
        if (!group) {
          group = { file: toRelative(fullPath), matches: [] };
          files.push(group);
        }
        const row: MatchRow = { text: truncateLine(line) };
        if (includeLineNumbers) row.line = i + 1;
        if (contextLines > 0) {
          row.before = lines.slice(Math.max(0, i - contextLines), i).map(truncateLine);
          row.after = lines.slice(i + 1, i + 1 + contextLines).map(truncateLine);
        }
        group.matches.push(row);
        emitted++;
      }
    }

    // Track visited real directories to prevent symlink cycle loops.
    const visitedDirs = new Set<string>();

    function walk(dir: string, depth: number) {
      if (depth > 100) return; // Safety limit
      let realDir: string;
      try {
        realDir = fs.realpathSync(dir);
      } catch {
        return;
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
        const relPath = path.relative(ignoreBase, fullPath).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          if (shouldIgnore(relPath, ignorePatterns)) continue;
          walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          if (shouldIgnore(relPath, ignorePatterns)) continue;
          if (allowedExts && !allowedExts.includes(path.extname(entry.name).toLowerCase())) continue;
          if (!matchesGlob(fullPath)) continue;
          scanFile(fullPath);
        }
      }
    }

    if (stat.isFile()) {
      scanFile(searchPath);
    } else {
      walk(searchPath, 0);
    }

    const output: Record<string, unknown> = {
      pattern: input.pattern,
      total_matches: totalMatches,
      files,
    };
    if (totalMatches > emitted) {
      output.truncated =
        `Showing first ${String(emitted)} of ${String(totalMatches)} matches. ` +
        'Narrow the search with glob, path, type, or a more specific pattern, or raise head_limit.';
    }
    return { output };
  },
  undefined,
  {
    aliases: {
      '-i': 'case_insensitive',
      '-n': 'line_numbers',
      regex: 'pattern',
    },
  },
);
