import { platform, arch, hostname } from 'node:os';
import { detectWindowsShell } from './shell-detect.js';

/** Format OS info for system prompt injection. */
export function getOsInfo(): string {
  const p = platform();
  const osName = p === 'win32' ? 'Windows' : p === 'darwin' ? 'macOS' : 'Linux';
  const base = `${osName} (${arch()}, ${hostname()})`;
  if (p === 'win32') {
    const shell = detectWindowsShell();
    const shellGuidance =
      shell === 'cmd'
        ? '. Shell: cmd.exe (Command Prompt).' +
          ' Use Windows commands: dir (not ls), type (not cat), del (not rm), copy (not cp), findstr (not grep).' +
          ' Chain commands with & not &&. Set env variables with: set VAR=value (not export).'
        : '. Shell: PowerShell.' +
          ' Unix aliases work: ls (Get-ChildItem), cat (Get-Content), grep (Select-String), curl (Invoke-WebRequest).' +
          ' Chain with && in PS 7+. Use $env:VAR for env variables.';
    return (
      base +
      shellGuidance +
      ' File path separator is backslash but glob patterns must always use forward slashes.' +
      ' Use `**/*.ts` not `**\\*.ts`. The `path` parameter also accepts forward slashes.'
    );
  }
  return base;
}

export function getTzOffsetString(timeZone: string, date: Date = new Date()): string {
  if (timeZone === 'UTC') return 'Z';
  try {
    const tzString = date.toLocaleString('en-US', { timeZone, timeStyle: 'long' });
    const match = tzString.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (match && match[1]) {
      const sign = match[1][0];
      const hours = match[1].slice(1).padStart(2, '0');
      const minutes = (match[2] || '00').padStart(2, '0');
      return `${sign}${hours}:${minutes}`;
    }
  } catch (e) {}

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    });
    const parts = formatter.formatToParts(date);
    const tzNamePart = parts.find(p => p.type === 'timeZoneName');
    if (tzNamePart) {
      const match = tzNamePart.value.match(/GMT([+-]\d+)(?::(\d+))?/);
      if (match && match[1]) {
        const sign = match[1][0];
        const hours = match[1].slice(1).padStart(2, '0');
        const minutes = (match[2] || '00').padStart(2, '0');
        return `${sign}${hours}:${minutes}`;
      }
    }
  } catch (e) {}

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absMinutes / 60)).padStart(2, '0');
  const mins = String(absMinutes % 60).padStart(2, '0');
  return `${sign}${hours}:${mins}`;
}

/** Format a date/time as a readable string for prompt injection. Defaults to now. */
export function formatDate(date: Date = new Date()): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const localStr = date.toLocaleString('en-US', { timeZone: timezone });
  const offset = getTzOffsetString(timezone, date);
  return `${localStr} (Timezone: ${timezone}, Offset: ${offset})`;
}

/**
 * Wrap a system prompt with (stable, non-time-varying) OS context.
 * Kept out of the date-stamping path so the system prompt stays byte-identical
 * across turns, which is required for provider-side prompt caching to work.
 * Returns the enriched prompt, or undefined if no system prompt given.
 */
export function withOsContext(systemPrompt: string | undefined): string | undefined {
  if (!systemPrompt) return undefined;
  return `[Operating system: ${getOsInfo()}]\n\n${systemPrompt}`;
}

/**
 * Prepend a send-time timestamp to a single message. Pure function of
 * (text, timestampMs) so the same message reconstructed from stored events
 * produces byte-identical output, keeping cached prefixes valid across resumes.
 */
export function withMessageTimestamp(text: string, timestampMs: number): string {
  return `[Message sent at: ${formatDate(new Date(timestampMs))}]\n${text}`;
}
