import { z } from 'zod';
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
}

export interface ToolContext {
  cwd: string;
  settings: CurieSettings;
  sessionId?: string;
}

export function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return homedir() + p.slice(1);
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
  // Write
  content: 'content', // already matched
  // Glob
  pattern: 'pattern', // already matched
  // Grep
  regex: 'regex', // already matched
  // Bash
  command: 'command', // already matched
  // Reminder / Task
  scheduledAt: 'scheduled_at',
  // WebSearch
  blockedDomains: 'blocked_domains',
  allowedDomains: 'allowed_domains',
};

export function createTool<Schema extends z.ZodObject<z.ZodRawShape>>(
  name: string,
  description: string,
  schema: Schema,
  execute: (input: z.infer<Schema>, ctx: ToolContext) => Promise<ToolResult>,
  cwd?: string,
): Tool & { validate: (raw: Record<string, unknown>) => z.infer<Schema> } {
  const jsonSchema = zodToJsonSchema(schema);

  const def: ToolDef = {
    name,
    description,
    inputSchema: jsonSchema as ToolDef['inputSchema'],
  };

  return {
    definition: def,
    validate: (raw) => schema.parse(raw),
    async execute(input: Record<string, unknown>, settings: CurieSettings, toolCwd?: string, sessionId?: string) {
      // Normalize input: strip null/undefined values and map camelCase
      // key aliases to their snake_case equivalents. LLMs (especially local
      // models) frequently normalize snake_case schema keys to camelCase.
      const normalized: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        if (v === null || v === undefined) continue;
        const targetKey = KEY_ALIASES[k] ?? k;
        // Only set if the target key isn't already present (preserve explicit snake_case)
        if (!(targetKey in normalized)) {
          normalized[targetKey] = v;
        }
      }
      try {
        const parsed = schema.parse(normalized) as z.infer<Schema>;
        return execute(parsed, { cwd: toolCwd ?? cwd ?? _globalCwd ?? '', settings, sessionId });
      } catch (err) {
        if (err instanceof z.ZodError) {
          const details = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
          return { output: null, error: `Validation error for tool "${name}": ${details}` };
        }
        throw err;
      }
    },
  };
}
