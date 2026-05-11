import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { isPathAllowed, parseAllowlist } from '@curie-agent/core/safety/path-guard.js';
import { createTool, expandPath, type ToolContext } from './tool.js';

const ReadSchema = z.object({
  file_path: z.string().describe('The absolute path to the file to read'),
  offset: z.number().optional().describe('The line number to start reading from'),
  limit: z.number().optional().describe('The number of lines to read'),
  pages: z.string().optional().describe('Page range for PDF files'),
});

export const readTool = createTool(
  'Read',
  'Reads a file from the local filesystem. Supports text files, PDF, notebooks, and images.',
  ReadSchema,
  async (input, ctx: ToolContext) => {
    const filePath = path.resolve(ctx.cwd, expandPath(input.file_path));

    // Safety: refuse reads outside allowed directories (project cwd + user allowlist).
    if (ctx.settings.SAFETY_PATH_GUARD !== 'off') {
      const allowlist = parseAllowlist(ctx.settings.SAFETY_PATH_ALLOWLIST ?? '');
      if (!isPathAllowed(filePath, ctx.cwd, allowlist)) {
        return { output: null, error: 'PathGuard: read blocked — path is outside allowed directories' };
      }
    }

    // Safety: always block reading curie-agent settings (contains API keys).
    const settingsPath = path.join(expandPath('~/.curie-agent'), 'settings.json');
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
      return { output: null, error: `PDF reading requires a PDF library. Path: ${filePath}` };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    let resultLines = lines;
    if (input.offset !== undefined) {
      const start = Math.max(0, input.offset - 1);
      resultLines = lines.slice(start);
    }
    if (input.limit !== undefined) {
      resultLines = resultLines.slice(0, input.limit);
    }

    const numbered = resultLines
      .map((line, i) => {
        const ln = input.offset !== undefined ? input.offset + i : i + 1;
        return `${ln}\t${line}`;
      })
      .join('\n');

    return {
      output: {
        path: filePath,
        totalLines: lines.length,
        content: numbered,
      },
    };
  },
);
