import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { createTool, expandPath, type ToolContext } from './tool.js';
import { resolveSafePath, parseAllowlist } from '@curie-agent/core/safety/path-guard.js';

const EditSchema = z.object({
  file_path: z
    .string()
    .describe('The path to the file to modify (absolute, or relative to the working directory)'),
  old_string: z
    .string()
    .describe('The exact text to replace, including whitespace and indentation. Must be unique in the file unless replace_all is set.'),
  new_string: z.string().describe('The text to replace it with (must differ from old_string)'),
  replace_all: z.boolean().optional().describe('Replace every occurrence of old_string (default false)'),
});

export const editTool = createTool(
  'Edit',
  [
    'Performs an exact string replacement in an existing file.',
    '`old_string` must match the file contents exactly — including whitespace and indentation — and must be unique in the file;',
    'if it appears more than once, include more surrounding context to make it unique or pass `replace_all: true` to change every instance.',
    'Read the file first to get the exact text.',
  ].join(' '),
  EditSchema,
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

    if (!fs.existsSync(filePath)) {
      return { output: null, error: `File not found: ${filePath}. Read it first before editing.` };
    }

    if (input.old_string === '') {
      return { output: null, error: 'old_string is empty — provide the exact text to replace.' };
    }
    if (input.old_string === input.new_string) {
      return { output: null, error: 'old_string and new_string are identical — nothing to change.' };
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const count = content.split(input.old_string).length - 1;

    if (count === 0) {
      return {
        output: null,
        error:
          `String not found in ${filePath}: "${input.old_string.slice(0, 80)}". ` +
          'old_string must match the file contents exactly, including whitespace and indentation. ' +
          'Read the file again to get the exact text.',
      };
    }

    if (input.replace_all) {
      const newContent = content.split(input.old_string).join(input.new_string);
      fs.writeFileSync(filePath, newContent, 'utf-8');
      return { output: { path: filePath, replacements: count } };
    }

    if (count > 1) {
      return {
        output: null,
        error:
          `Found ${String(count)} occurrences of old_string in ${filePath}. ` +
          'Include more surrounding context to make it unique, or pass replace_all: true to replace every occurrence.',
      };
    }

    const idx = content.indexOf(input.old_string);
    const newContent = content.slice(0, idx) + input.new_string + content.slice(idx + input.old_string.length);
    fs.writeFileSync(filePath, newContent, 'utf-8');
    return { output: { path: filePath, replacements: 1 } };
  },
  undefined,
  {
    aliases: {
      path: 'file_path',
      filename: 'file_path',
      filepath: 'file_path',
      file: 'file_path',
      old_str: 'old_string',
      new_str: 'new_string',
    },
  },
);
