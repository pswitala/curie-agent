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
  'Writes a file to the local filesystem. Creates new files or overwrites existing ones.',
  WriteSchema,
  async (input, ctx: ToolContext) => {
    let filePath: string;

    if (ctx.settings.SAFETY_PATH_GUARD !== 'off') {
      const check = resolveSafePath(
        input.file_path,
        ctx.cwd,
        parseAllowlist(ctx.settings.SAFETY_PATH_ALLOWLIST ?? ''),
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
