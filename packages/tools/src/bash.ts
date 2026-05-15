import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { z } from 'zod';
import { createTool, type ToolContext } from './tool.js';
import { isPathAllowed, parseAllowlist } from '@curie-agent/core/safety/path-guard.js';

const execFileAsync = promisify(execFile);

const BashSchema = z.object({
  command: z.string().describe('The command to execute'),
  timeout: z.number().optional().describe('Optional timeout in milliseconds (max 600000)'),
  description: z.string().optional().describe('Clear, concise description of what this command does'),
});

const SHELLS: Record<string, string> = {
  win32: 'cmd.exe',
  linux: '/bin/bash',
  darwin: '/bin/bash',
};

export const bashTool = createTool(
  'Bash',
  'Executes a bash command and returns its output. For shell-only operations.',
  BashSchema,
  async (input, ctx: ToolContext) => {
    if (ctx.settings.safety?.path_guard !== 'off') {
      if (!isPathAllowed(ctx.cwd, ctx.cwd, parseAllowlist(ctx.settings.safety?.path_allowlist ?? ''))) {
        return { output: null, error: 'Bash: session cwd is outside allowed directories' };
      }
    }

    const shell = SHELLS[process.platform] || '/bin/sh';
    const timeout = Math.min(input.timeout || 120000, 600000);

    return new Promise((resolve) => {
      const child = spawn(shell, ['/c', input.command], {
        cwd: ctx.cwd,
        timeout,
        shell: false,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          output: {
            exitCode: code,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
          },
          error: code !== 0 ? stderr.trim() : undefined,
        });
      });

      child.on('error', (err) => {
        resolve({
          output: null,
          error: `Command failed: ${err.message}`,
        });
      });
    });
  },
);
