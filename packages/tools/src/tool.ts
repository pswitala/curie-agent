import { z } from 'zod';
import path from 'node:path';
import { homedir } from 'node:os';
import type { CurieSettings } from '@curie-agent/core';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface Tool {
  definition: ToolDef;
  execute: (input: Record<string, unknown>, settings: CurieSettings, cwd?: string) => Promise<ToolResult>;
}

export interface ToolResult {
  output: unknown;
  error?: string;
  /** Optional richer payload for the tool-result *event* only (persisted to
   *  events.jsonl / broadcast over WS) — never sent back to the model, so it
   *  doesn't affect message-history cost. */
  clientOutput?: unknown;
}

export interface ToolContext {
  cwd: string;
  settings: CurieSettings;
  sessionId?: string;
}

export function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(homedir(), p.slice(1));
  }
  return p;
}

let _globalCwd = '';

/** Set the global cwd used by all tools when not provided at call time. */
export function setGlobalCwd(cwd: string): void {
  _globalCwd = cwd;
}

function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const raw = z.toJSONSchema(schema) as Record<string, unknown>;
  // Strip $schema meta-field — not needed by LLM providers
  delete raw['$schema'];
  return raw;
}

/**
 * Common camelCase -> snake_case mappings for tool input keys.
 * LLMs (especially local models) often normalize snake_case schema keys
 * to camelCase when generating tool calls. This map lets us accept either form.
 */
const KEY_ALIASES: Record<string, string> = {
  // Read / Edit
  filePath: 'file_path',
  oldString: 'old_string',
  newString: 'new_string',
  replaceAll: 'replace_all',
  // Reminder / Task
  scheduledAt: 'scheduled_at',
  // WebSearch
  blockedDomains: 'blocked_domains',
  allowedDomains: 'allowed_domains',
};

export interface CreateToolOptions {
  /**
   * Per-tool input key aliases (e.g. { path: 'file_path' }), resolved before
   * the global KEY_ALIASES table. Lets file tools accept `path`/`filename`
   * without breaking tools where `path` is a legitimate parameter.
   */
  aliases?: Record<string, string>;
}

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}

/** Build a one-line parameter summary from the tool's JSON schema. */
function describeParameters(jsonSchema: Record<string, unknown>): string {
  const props = jsonSchema.properties;
  if (typeof props !== 'object' || props === null) return '';
  const required = new Set(
    Array.isArray(jsonSchema.required)
      ? (jsonSchema.required as unknown[]).filter((r): r is string => typeof r === 'string')
      : [],
  );
  return Object.entries(props as Record<string, unknown>)
    .map(([key, val]) => {
      const type =
        typeof val === 'object' && val !== null && typeof (val as Record<string, unknown>).type === 'string'
          ? ((val as Record<string, unknown>).type as string)
          : 'any';
      return `${key} (${type}${required.has(key) ? ', required' : ''})`;
    })
    .join(', ');
}

function editDistance(a: string, b: string): number {
  let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const del = (prevRow[j] ?? 0) + 1;
      const ins = (row[j - 1] ?? 0) + 1;
      const sub = (prevRow[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      row.push(Math.min(del, ins, sub));
    }
    prevRow = row;
  }
  return prevRow[b.length] ?? 0;
}

/** Suggest the closest schema key for an unknown input key, if any is close enough. */
function nearestKey(key: string, knownKeys: Set<string>): string | undefined {
  const lower = key.toLowerCase();
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of knownKeys) {
    const cl = candidate.toLowerCase();
    // Substring containment ("path" in "file_path") is a strong signal on its own.
    const score = cl === lower ? 0 : cl.includes(lower) || lower.includes(cl) ? 1 : editDistance(lower, cl);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore <= 3 ? best : undefined;
}

export function createTool<Schema extends z.ZodObject<z.ZodRawShape>>(
  name: string,
  description: string,
  schema: Schema,
  execute: (input: z.infer<Schema>, ctx: ToolContext) => Promise<ToolResult>,
  cwd?: string,
  options?: CreateToolOptions,
): Tool & { validate: (raw: Record<string, unknown>) => z.infer<Schema> } {
  const jsonSchema = zodToJsonSchema(schema);
  const knownKeys = new Set(Object.keys(schema.shape));
  const toolAliases = options?.aliases ?? {};

  const def: ToolDef = {
    name,
    description,
    inputSchema: jsonSchema as ToolDef['inputSchema'],
  };

  return {
    definition: def,
    validate: (raw) => schema.parse(raw),
    async execute(input: Record<string, unknown>, settings: CurieSettings, toolCwd?: string, sessionId?: string) {
      // Normalize input: strip null/undefined values and resolve aliased keys.
      // LLMs (especially local models) frequently normalize snake_case schema
      // keys to camelCase or use near-miss names like `path` for `file_path`.
      const normalized: Record<string, unknown> = {};
      const unknownKeys: string[] = [];
      // Pass 1: exact schema keys always win, regardless of input key order.
      for (const [k, v] of Object.entries(input)) {
        if (v === null || v === undefined) continue;
        if (knownKeys.has(k)) normalized[k] = v;
      }
      // Pass 2: resolve remaining keys via per-tool aliases, the global table,
      // then generic camelCase->snake_case when the converted key is in the schema.
      for (const [k, v] of Object.entries(input)) {
        if (v === null || v === undefined || knownKeys.has(k)) continue;
        const snake = camelToSnake(k);
        const target = toolAliases[k] ?? KEY_ALIASES[k] ?? (knownKeys.has(snake) ? snake : k);
        if (!(target in normalized)) {
          normalized[target] = v;
        }
        if (!knownKeys.has(target)) unknownKeys.push(k);
      }
      try {
        const parsed = schema.parse(normalized) as z.infer<Schema>;
        return execute(parsed, { cwd: toolCwd ?? cwd ?? _globalCwd ?? '', settings, sessionId });
      } catch (err) {
        if (err instanceof z.ZodError) {
          const details = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
          const summary = describeParameters(jsonSchema);
          const hints = unknownKeys
            .map((k) => {
              const suggestion = nearestKey(k, knownKeys);
              return suggestion ? ` Unknown parameter "${k}" — did you mean "${suggestion}"?` : '';
            })
            .join('');
          return {
            output: null,
            error: `Validation error for tool "${name}": ${details}.${summary ? ` Expected parameters: ${summary}.` : ''}${hints}`,
          };
        }
        throw err;
      }
    },
  };
}
