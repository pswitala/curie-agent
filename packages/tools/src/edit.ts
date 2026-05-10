import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createTool, expandPath, type ToolContext } from './tool.js';
import { resolveSafePath, parseAllowlist } from '@curie-agent/core/safety/path-guard.js';

const EditSchema = z.object({
  file_path: z.string().describe('The absolute path to the file to modify'),
  old_string: z.string().describe('The text to replace'),
  new_string: z.string().describe('The text to replace it with'),
  replace_all: z.boolean().optional().describe('Replace all occurrences'),
});

export const editTool = createTool(
  'Edit',
  'Performs exact string replacements in files. Use replace_all to change every instance.',
  EditSchema,
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

    if (!fs.existsSync(filePath)) {
      return { output: null, error: `File not found: ${filePath}. Read it first before editing.` };
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    if (input.replace_all) {
      const count = (content.match(new RegExp(escapeRegex(input.old_string), 'g')) || []).length;
      if (count === 0) {
        return { output: null, error: `String not found in file: ${input.old_string.slice(0, 50)}` };
      }
      const newContent = content.split(input.old_string).join(input.new_string);
      fs.writeFileSync(filePath, newContent, 'utf-8');
      return { output: { path: filePath, replacements: count } };
    } else {
      const idx = content.indexOf(input.old_string);
      if (idx === -1) {
        return { output: null, error: `String not found in file. The old_string must match exactly.` };
      }
      const newContent = content.slice(0, idx) + input.new_string + content.slice(idx + input.old_string.length);
      fs.writeFileSync(filePath, newContent, 'utf-8');
      return { output: { path: filePath, replacements: 1 } };
    }
  },
);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
