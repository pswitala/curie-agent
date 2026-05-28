import { execSync } from 'node:child_process';
import { platform } from 'node:os';

export type WindowsShell = 'pwsh' | 'powershell' | 'cmd';

let _cached: WindowsShell | undefined;

/**
 * Detect the best available Windows shell by probing PATH.
 * Prefers pwsh (PowerShell 7+) over powershell (5.x) over cmd.exe.
 * Result is cached for the process lifetime.
 *
 * Returns 'cmd' on non-Windows (caller should branch on platform).
 */
export function detectWindowsShell(): WindowsShell {
  if (platform() !== 'win32') return 'cmd';
  if (_cached !== undefined) return _cached;
  for (const name of ['pwsh', 'powershell'] as const) {
    try {
      execSync(`where ${name}.exe`, { stdio: 'ignore', timeout: 2000 });
      _cached = name;
      return name;
    } catch {}
  }
  _cached = 'cmd';
  return 'cmd';
}

/** Reset the cached shell (testing or forced re-detection). */
export function resetWindowsShellCache(): void {
  _cached = undefined;
}
