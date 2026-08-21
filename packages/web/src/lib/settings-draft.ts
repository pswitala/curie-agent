/**
 * Dot-path draft logic for the settings page.
 *
 * The daemon's `config.set` speaks dot paths, so the editor keeps two copies of
 * the settings tree — the fetched `base` and an editable `draft` — and derives
 * the writes to send by diffing them. Everything here is pure so it can be
 * unit-tested without a DOM.
 */

export type Draft = Record<string, unknown>;

export interface Write {
  path: string;
  value: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Read a dot path. Returns undefined for any missing or non-object segment. */
export function getPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split('.')) {
    if (!isPlainObject(current)) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Render an unknown settings value as text for an input box.
 *
 * Values arrive from the daemon as `unknown`, so a plain `String(v)` would turn
 * an unexpected object into the literal "[object Object]" and then save that
 * string back over a structured setting.
 */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/**
 * Immutable dot-path write — clones only the nodes along `path`.
 *
 * Returning a new object is what makes React re-render; mutating in place and
 * returning the same reference is a silent no-op.
 */
export function setPath<T extends Draft>(obj: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.');
  const next = { ...obj } as Draft;
  if (rest.length === 0) {
    next[head] = value;
  } else {
    const child = obj[head];
    next[head] = setPath(isPlainObject(child) ? child : {}, rest.join('.'), value);
  }
  return next as T;
}

/**
 * Deep-diff `draft` against `base` into dot-path writes.
 *
 * Plain objects recurse; arrays and scalars are leaves compared by JSON value.
 * Keys present in `base` but absent from `draft` are ignored — the UI never
 * deletes settings.
 */
export function diffPaths(base: Draft, draft: Draft, prefix = ''): Write[] {
  const writes: Write[] = [];
  for (const [key, value] of Object.entries(draft)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const previous = base[key];
    if (isPlainObject(value) && isPlainObject(previous)) {
      writes.push(...diffPaths(previous, value, path));
    } else if (isPlainObject(value) && previous === undefined) {
      // A whole new subtree — send it as one write rather than synthesising
      // paths the daemon would have to create segment by segment.
      writes.push({ path, value });
    } else if (JSON.stringify(value) !== JSON.stringify(previous)) {
      writes.push({ path, value });
    }
  }
  return writes;
}

/**
 * `current_provider` last, so the daemon's derived-model mirror sees the fresh
 * provider data. Switching provider *and* editing that provider's model in one
 * save would otherwise mirror the old model into the top-level `model`.
 */
export function orderWrites(writes: Write[]): Write[] {
  return [...writes].sort((a, b) => {
    const rank = (w: Write) => (w.path === 'current_provider' ? 1 : 0);
    return rank(a) - rank(b);
  });
}

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function isTime(v: string): boolean {
  return TIME.test(v.trim());
}

/**
 * Cross-field and format checks that constrained inputs cannot express.
 * Enums are <select>, bounded numbers are type=number min/max, and booleans are
 * toggles — those are unfalsifiable by construction and not re-checked here.
 *
 * Returns a path -> message map; empty means safe to save.
 */
export function validate(draft: Draft): Record<string, string> {
  const errors: Record<string, string> = {};

  // Auto-compaction thresholds must stay ordered. `min`/`max` attributes can't
  // express this, and the daemon's `/context auto` only range-checks.
  const ac = draft.auto_compact;
  if (isPlainObject(ac)) {
    const warn = Number(ac.warn_threshold);
    const suggest = Number(ac.threshold);
    const force = Number(ac.forced_threshold);
    const bounded: [string, number][] = [
      ['auto_compact.warn_threshold', warn],
      ['auto_compact.threshold', suggest],
      ['auto_compact.forced_threshold', force],
    ];
    for (const [path, n] of bounded) {
      if (!Number.isFinite(n) || n < 5 || n > 99) {
        errors[path] = 'Use a percentage between 5 and 99.';
      }
    }
    if (!errors['auto_compact.warn_threshold'] && !errors['auto_compact.threshold'] && warn >= suggest) {
      errors['auto_compact.warn_threshold'] = 'Warn must be below the suggest threshold.';
    }
    if (!errors['auto_compact.threshold'] && !errors['auto_compact.forced_threshold'] && suggest >= force) {
      errors['auto_compact.threshold'] = 'Suggest must be below the force threshold.';
    }
  }

  // Heartbeat schedule strings. `config.set` reschedules the task manager
  // *after* writing the file, so a bad value lands on disk and can leave
  // schedules half-cancelled.
  const hb = draft.heartbeat;
  if (isPlainObject(hb)) {
    // Blank times revert to the packaged default on reload (parseNestedSettings
    // uses `|| DEFAULT`), so an empty value would silently not stick. Turn the
    // heartbeat off with `schedule` instead.
    for (const key of ['daily', 'dreaming'] as const) {
      const raw = asText(hb[key]).trim();
      if (!raw) errors[`heartbeat.${key}`] = 'Required — turn the heartbeat off with Schedule instead.';
      else if (!isTime(raw)) errors[`heartbeat.${key}`] = 'Use H:MM, 24-hour (e.g. 6:00).';
    }

    const intraday = asText(hb.intraday).trim();
    if (intraday && !intraday.split(',').every(part => isTime(part))) {
      errors['heartbeat.intraday'] = 'Comma-separated H:MM times (e.g. 7:55,11:55).';
    }

    const weekly = asText(hb.weekly).trim();
    if (!weekly) {
      errors['heartbeat.weekly'] = 'Required — turn the heartbeat off with Schedule instead.';
    } else {
      const [day, time] = weekly.split('@');
      if (!time || !isTime(time) || !WEEKDAYS.includes(day.toLowerCase())) {
        errors['heartbeat.weekly'] = 'Use day@H:MM (e.g. monday@6:00).';
      }
    }

    const monthly = asText(hb.monthly).trim();
    if (!monthly) {
      errors['heartbeat.monthly'] = 'Required — turn the heartbeat off with Schedule instead.';
    } else {
      const [day, time] = monthly.split('@');
      const dayNum = Number(day);
      if (!time || !isTime(time) || !Number.isInteger(dayNum) || dayNum < 1 || dayNum > 31) {
        errors['heartbeat.monthly'] = 'Use D@H:MM with a day of 1-31 (e.g. 1@6:00).';
      }
    }
  }

  // A blank provider model reverts to the packaged default on reload.
  const providers = draft.providers;
  if (isPlainObject(providers)) {
    for (const [name, cfg] of Object.entries(providers)) {
      if (!isPlainObject(cfg)) continue;
      if (!asText(cfg.model).trim()) {
        errors[`providers.${name}.model`] = 'Required — a blank model reverts to the default on restart.';
      }
      const window = Number(cfg.model_context_window);
      if (!Number.isFinite(window) || window < 1000) {
        errors[`providers.${name}.model_context_window`] = 'Must be at least 1000 tokens.';
      }
    }
  }

  return errors;
}

/** Parse a JSON textarea into a plain object of objects (used for mcp_servers). */
export function parseJsonObject(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Invalid JSON.' };
  }
  if (!isPlainObject(parsed)) return { ok: false, error: 'Expected a JSON object, e.g. { "name": { … } }.' };
  for (const [key, value] of Object.entries(parsed)) {
    if (!isPlainObject(value)) return { ok: false, error: `"${key}" must be an object.` };
  }
  return { ok: true, value: parsed };
}

/** One-per-line textarea text -> string[], dropping blanks. */
export function linesToArray(text: string): string[] {
  return text.split('\n').map(line => line.trim()).filter(Boolean);
}

/**
 * string | string[] -> one-per-line textarea text.
 *
 * `safety.path_allowlist` is typed `unknown` and is a comma-separated string in
 * older settings files but an array in newer ones; both must render.
 */
export function arrayToLines(value: unknown): string {
  if (Array.isArray(value)) return value.map(v => String(v)).join('\n');
  if (typeof value === 'string') return linesToArray(value.split(',').join('\n')).join('\n');
  return '';
}
