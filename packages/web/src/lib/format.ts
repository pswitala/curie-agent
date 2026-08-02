/** Shared formatting helpers for the web dashboard. */

export function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m${secs % 60}s`;
}

export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Short relative age, e.g. `now`, `12s ago`, `4m ago`, `2h ago`. */
export function formatRelative(ts: number, now: number): string {
  const secs = Math.max(0, Math.floor((now - ts) / 1000));
  if (secs < 3) return 'now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function stringifyInput(input: Record<string, unknown>): string {
  if (!input || Object.keys(input).length === 0) return '';
  const entries = Object.entries(input);
  if (entries.length === 1) {
    const entry = entries[0];
    if (!entry) return '';
    const k = entry[0];
    const v = entry[1];
    const val = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
    return `${k}: ${val}`;
  }
  return entries.map(([k, v]) => {
    const val = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
    return `${k}: ${val}`;
  }).join('\n');
}

/** One-line summary of a tool call's arguments. */
export function formatToolArgs(name: string, input: Record<string, unknown>): string {
  if (!input) return '';
  if (name === 'Bash') return String(input.command || '').slice(0, 80);
  const path = input.file_path || input.path || '';
  if (path) return String(path);
  return Object.entries(input)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`)
    .join(', ');
}
