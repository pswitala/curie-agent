import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type LogPrefix = 'INGEST' | 'QUERY' | 'LINT' | 'EDIT';

const LOG_HEADER = `# Wiki Log\n\n<!-- Append-only chronological record. Parse with: grep "^## \\[" log.md | tail -5 -->\n\n`;

/** Append a parseable entry to log.md.
 *
 * Format:
 *   ## [YYYY-MM-DD] ingest | Title
 *   INGEST: detail line
 */
export function appendLog(root: string, prefix: LogPrefix, title: string, detail?: string): void {
  const logPath = join(root, 'log.md');
  const today = new Date().toISOString().slice(0, 10);

  const header = `## [${today}] ${prefix.toLowerCase()} | ${title}`;
  const detailLine = detail ? `${prefix}: ${detail}\n` : '';
  const entry = `${header}\n${detailLine}\n`;

  if (existsSync(logPath)) {
    const existing = readFileSync(logPath, 'utf-8');
    writeFileSync(logPath, existing + entry, 'utf-8');
  } else {
    writeFileSync(logPath, LOG_HEADER + entry, 'utf-8');
  }
}

export function readLog(root: string): string {
  const logPath = join(root, 'log.md');
  if (!existsSync(logPath)) return '';
  return readFileSync(logPath, 'utf-8');
}
