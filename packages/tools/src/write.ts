import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createTool, expandPath, type ToolContext } from './tool.js';
import { resolveSafePath, parseAllowlist } from '@curie-agent/core/safety/path-guard.js';

const WriteSchema = z.object({
  file_path: z.string().describe('The absolute path to the file to write'),
  content: z.string().describe('The content to write to the file'),
});

export const writeTool = createTool(
  'Write',
  'Writes a file to the local filesystem. Creates new files or overwrites existing ones. ' +
  'Use this for any content too large to deliver inline — research reports, summaries, essays, generated documents. ' +
  'For very long content (>500 lines), write a skeleton first with placeholder headings, ' +
  'then fill each section using the Edit tool so each individual tool call stays small and fits within output limits.',
  WriteSchema,
  async (input, ctx: ToolContext) => {
    let filePath: string;

    if (ctx.settings.safety?.path_guard !== 'off') {
      const check = resolveSafePath(
        input.file_path,
        ctx.cwd,
        parseAllowlist(ctx.settings.safety?.path_allowlist ?? ''),
      );
      if ('error' in check) return { output: null, error: check.error };
      filePath = check.path;
    } else {
      filePath = path.resolve(ctx.cwd, expandPath(input.file_path));
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, input.content, 'utf-8');

    return {
      output: {
        path: filePath,
        bytes: Buffer.byteLength(input.content, 'utf-8'),
      },
    };
  },
);
