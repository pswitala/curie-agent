import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { isPathAllowed, parseAllowlist } from '@curie-agent/core/safety/path-guard.js';
import { createTool, expandPath, type ToolContext } from './tool.js';

const DEFAULT_LINE_LIMIT = 2000;
const MAX_LINE_LENGTH = 2000;

const ReadSchema = z.object({
  file_path: z
    .string()
    .describe('The path to the file to read (absolute, or relative to the working directory)'),
  offset: z.number().optional().describe('The 1-based line number to start reading from'),
  limit: z
    .number()
    .optional()
    .describe(`The number of lines to read (default ${String(DEFAULT_LINE_LIMIT)})`),
});

export const readTool = createTool(
  'Read',
  [
    'Reads a text or image file from the local filesystem and returns numbered lines (`<line>\\t<text>`).',
    `Reads up to ${String(DEFAULT_LINE_LIMIT)} lines by default; use offset/limit to page through larger files.`,
    'Reading a directory returns its entries. PDFs are not supported.',
  ].join(' '),
  ReadSchema,
  async (input, ctx: ToolContext) => {
    const filePath = path.resolve(ctx.cwd, expandPath(input.file_path));

    // Safety: refuse reads outside allowed directories (project cwd + user allowlist).
    if (ctx.settings.safety?.path_guard !== 'off') {
      const allowlist = parseAllowlist(ctx.settings.safety?.path_allowlist ?? '');
      if (!isPathAllowed(filePath, ctx.cwd, allowlist)) {
        return { output: null, error: 'PathGuard: read blocked — path is outside allowed directories' };
      }
    }

    // Safety: always block reading curie-agent settings (contains API keys).
    const settingsPath = path.join(expandPath('~'), '.curie-settings.json');
    if (filePath === settingsPath || filePath.toLowerCase() === settingsPath.toLowerCase()) {
      return { output: null, error: 'PathGuard: reading settings.json is blocked — file contains API keys and secrets' };
    }

    if (!fs.existsSync(filePath)) {
      return { output: null, error: `File not found: ${filePath}` };
    }

    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(filePath, { withFileTypes: true });
      return { output: entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() })) };
    }

    const ext = path.extname(filePath).toLowerCase();

    if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'].includes(ext)) {
      const buf = fs.readFileSync(filePath);
      return {
        output: {
          type: 'image',
          path: filePath,
          size: buf.length,
          encoding: 'base64',
          data: buf.toString('base64'),
        },
      };
    }

    if (ext === '.pdf') {
      return {
        output: null,
        error: `PDF files are not supported by this tool: ${filePath}. Use Bash with a converter, or ask the user for a text export.`,
      };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    const start = input.offset !== undefined ? Math.max(0, input.offset - 1) : 0;
    const limit = input.limit ?? DEFAULT_LINE_LIMIT;
    const resultLines = lines.slice(start, start + limit);

    const numbered = resultLines
      .map((line, i) => {
        const ln = start + i + 1;
        const text = line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) + '… [line truncated]' : line;
        return `${String(ln)}\t${text}`;
      })
      .join('\n');

    const end = start + resultLines.length;
    if (end < lines.length) {
      const footer = `\n[Showing lines ${String(start + 1)}-${String(end)} of ${String(lines.length)}. Use offset/limit to read more.]`;
      return { output: numbered + footer };
    }
    return { output: numbered };
  },
  undefined,
  {
    aliases: {
      path: 'file_path',
      filename: 'file_path',
      filepath: 'file_path',
      file: 'file_path',
    },
  },
);
