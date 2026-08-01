/**
 * Compact, schema-agnostic rendering of a tool call's input for the LLM
 * harm-check prompt.
 *
 * The evaluator only needs to know *what kind of action* is about to run and
 * *what it targets* — not the full payload. Inlining `JSON.stringify(input)`
 * put entire file bodies (`Write.content`), full patches (`Edit.old_string` /
 * `new_string`) and whole scripts into every harm-check request, which is where
 * the token cost came from.
 *
 * Truncation here is safe: the path guard runs inside each tool's `execute()`
 * and the command guard runs in `PermissionEngine`, both against the *full*
 * input. This digest only shapes what the LLM sees.
 */

/**
 * Fields a safety evaluator actually reasons about. These keep a generous
 * budget — a `Bash` heredoc is long but is also the primary safety signal.
 */
const HIGH_SIGNAL_KEYS = new Set([
  'command',
  'file_path',
  'path',
  'url',
  'pattern',
  'glob',
  'prompt',
]);

const HIGH_SIGNAL_BUDGET = 1000;
/** Head sample for bulk fields — enough to catch shebangs, `curl … | sh`, payload shape. */
const DEFAULT_BUDGET = 200;
/** Hard ceiling on the whole digest, regardless of how many fields there are. */
const DIGEST_BUDGET = 1500;

const MAX_DEPTH = 1;
const MAX_ITEMS = 8;

function renderString(value: string, budget: number): string {
  if (value.length <= budget) {
    // Quote only when the raw form would break the one-field-per-line layout.
    // Backslashes and quotes are left bare — escaping them would just add noise
    // to the two most common values here: Windows paths and regex patterns.
    return /[\n\r]/.test(value) ? JSON.stringify(value) : value;
  }
  return `${JSON.stringify(value.slice(0, budget))}…[${value.length} chars total]`;
}

function renderValue(value: unknown, budget: number, depth: number): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return renderString(value, budget);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return `[array of ${value.length} items]`;
    const shown = value.slice(0, MAX_ITEMS).map((v) => renderValue(v, budget, depth + 1));
    const more = value.length > MAX_ITEMS ? `, …${value.length - MAX_ITEMS} more` : '';
    const rendered = `[${shown.join(', ')}${more}]`;
    return rendered.length <= budget ? rendered : `[array of ${value.length} items]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (depth >= MAX_DEPTH) return `{${entries.length} keys}`;
    const shown = entries
      .slice(0, MAX_ITEMS)
      .map(([k, v]) => `${k}=${renderValue(v, budget, depth + 1)}`);
    const more = entries.length > MAX_ITEMS ? `, …${entries.length - MAX_ITEMS} more` : '';
    const rendered = `{${shown.join(', ')}${more}}`;
    return rendered.length <= budget ? rendered : `{${entries.length} keys}`;
  }

  return '[unsupported]';
}

/**
 * Render a tool call as a compact, one-field-per-line digest.
 *
 * High-signal fields (paths, commands, URLs, patterns) survive intact; bulk
 * content is reduced to a head sample plus an explicit `…[N chars total]`
 * marker so the reader can tell the value was abbreviated.
 */
export function summarizeToolInput(toolName: string, input: unknown): string {
  const lines = [`Tool: ${toolName}`];

  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (value === undefined) continue;
      const budget = HIGH_SIGNAL_KEYS.has(key) ? HIGH_SIGNAL_BUDGET : DEFAULT_BUDGET;
      lines.push(`${key}: ${renderValue(value, budget, 0)}`);
    }
  }

  if (lines.length === 1) lines.push('(no arguments)');

  const digest = lines.join('\n');
  return digest.length <= DIGEST_BUDGET ? digest : `${digest.slice(0, DIGEST_BUDGET)}…[truncated]`;
}
