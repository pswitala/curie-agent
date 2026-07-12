import { spawn } from 'node:child_process';
import { z } from 'zod';
import { createTool, type ToolContext } from './tool.js';
import { isPathAllowed, parseAllowlist } from '@curie-agent/core/safety/path-guard.js';
import { detectWindowsShell } from '@curie-agent/core/shell-detect.js';

const BashSchema = z.object({
  command: z.string().describe('The command to execute'),
  timeout: z.number().optional().describe('Optional timeout in milliseconds (max 600000)'),
  description: z.string().optional().describe('Clear, concise description of what this command does'),
});

const MAX_OUTPUT = 200_000;

function resolveShell(): { exe: string; flag: string } {
  if (process.platform === 'win32') {
    const shell = detectWindowsShell();
    const exe = shell === 'pwsh' ? 'pwsh.exe' : shell === 'powershell' ? 'powershell.exe' : 'cmd.exe';
    const flag = shell === 'cmd' ? '/c' : '-Command';
    return { exe, flag };
  }
  const exe = process.platform === 'linux' || process.platform === 'darwin' ? '/bin/bash' : '/bin/sh';
  return { exe, flag: '-c' };
}

export const bashTool = createTool(
  'Bash',
  [
    'Executes a shell command and returns exit code, stdout, and stderr.',
    'The shell is bash on Linux/macOS but PowerShell (or cmd) on Windows — use the syntax of the actual platform shell, not POSIX-only commands on Windows.',
    'Output is capped at 200 KB per stream; the timeout defaults to 120000 ms (max 600000).',
    'Prefer the dedicated Read/Write/Edit/Glob/Grep tools over shell equivalents like cat, echo-redirects, find, or grep.',
  ].join(' '),
  BashSchema,
  async (input, ctx: ToolContext) => {
    if (ctx.settings.safety?.path_guard !== 'off') {
      if (!isPathAllowed(ctx.cwd, ctx.cwd, parseAllowlist(ctx.settings.safety?.path_allowlist ?? ''))) {
        return { output: null, error: 'Bash: session cwd is outside allowed directories' };
      }
    }

    const { exe, flag } = resolveShell();
    const timeout = Math.min(input.timeout || 120000, 600000);

    return new Promise((resolve) => {
      const child = spawn(exe, [flag, input.command], {
        cwd: ctx.cwd,
        timeout,
        shell: false,
        env: { ...process.env },
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;

      child.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT) {
          stdout += chunk.toString();
        } else if (!stdoutTruncated) {
          stdoutTruncated = true;
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT) {
          stderr += chunk.toString();
        } else if (!stderrTruncated) {
          stderrTruncated = true;
        }
      });

      // On Unix, Node's spawn({ timeout }) sends SIGTERM which is catchable.
      // Escalate to SIGKILL after a grace period so the process actually dies.
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      if (process.platform !== 'win32') {
        killTimer = setTimeout(() => child.kill('SIGKILL'), timeout + 3000);
      }

      child.on('close', (code) => {
        if (killTimer !== undefined) clearTimeout(killTimer);
        const outText = stdout.trim() + (stdoutTruncated ? '\n...[output truncated at 200 KB]' : '');
        const errText = stderr.trim() + (stderrTruncated ? '\n...[output truncated at 200 KB]' : '');
        resolve({
          output: { exitCode: code, stdout: outText, stderr: errText },
          error: child.killed
            ? `Command timed out after ${timeout}ms`
            : code !== 0
              ? errText || undefined
              : undefined,
        });
      });

      child.on('error', (err) => {
        if (killTimer !== undefined) clearTimeout(killTimer);
        resolve({ output: null, error: `Command failed: ${err.message}` });
      });
    });
  },
);
