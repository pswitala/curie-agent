import { DEFAULT_SETTINGS, type AutoCompactConfig, type CurieSettings } from './settings.js';
import type { AssistantBlock, Message } from './turn-loop.js';

/**
 * The single context accountant.
 *
 * Before this module there were three unconnected implementations: an inline
 * chars/4 pre-flight gate in the turn loop that could only hard-abort, a
 * post-run threshold check in the daemon that only ran between user prompts,
 * and a fully-implemented `TokenMonitor` that was never instantiated outside
 * its own test. They disagreed on every default. This is the only one now.
 */

export interface ContextBudget {
  /** Total context window for the active provider's model. */
  windowTokens: number;
  /** Headroom held back for the model's reply. */
  reservedOutput: number;
  /** windowTokens - reservedOutput. What the prompt may actually occupy. */
  usableTokens: number;
}

export interface ToolDefinitionLike {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** Seed chars-per-token. Roughly right for English; corrected by `calibrate()`. */
export const DEFAULT_CALIBRATION = 4;

/**
 * Bounds on the learned chars-per-token ratio. Below 2 is denser than any real
 * tokenizer; above 6 is sparser. Clamping keeps one anomalous `usage` event
 * from poisoning every subsequent estimate.
 */
const MIN_CALIBRATION = 2;
const MAX_CALIBRATION = 6;

/**
 * The reserve may never exceed this share of the window. Without the clamp a
 * default `max_output_tokens` of 65536 against the default 131072 window made
 * half the context unusable and invisible.
 */
const MAX_RESERVE_FRACTION = 0.25;

/** Fallback when a provider has no `max_output_tokens` configured. */
const FALLBACK_RESERVED_OUTPUT = 32768;

export type ContextStatus = 'ok' | 'warn' | 'suggest' | 'forced';

export function resolveBudget(settings: CurieSettings): ContextBudget {
  const provider = settings.providers[settings.current_provider];
  const windowTokens = provider?.model_context_window
    ?? DEFAULT_SETTINGS.providers[settings.current_provider]?.model_context_window
    ?? DEFAULT_SETTINGS.providers.anthropic.model_context_window;

  const requested = provider?.max_output_tokens ?? FALLBACK_RESERVED_OUTPUT;
  const reservedOutput = Math.min(requested, Math.floor(windowTokens * MAX_RESERVE_FRACTION));

  return { windowTokens, reservedOutput, usableTokens: windowTokens - reservedOutput };
}

/** Character weight of one assistant content block, counting only what is sent. */
function blockChars(block: AssistantBlock): number {
  switch (block.type) {
    case 'text':
      return block.text.length;
    case 'thinking':
      return block.thinking.length + block.signature.length;
    case 'tool-use':
      return block.name.length + JSON.stringify(block.input).length;
  }
}

export function messageChars(message: Message): number {
  switch (message.role) {
    case 'user':
      return message.content.length;
    case 'tool':
      return message.content.length + (message.toolName?.length ?? 0);
    case 'assistant':
      return message.content.reduce((sum, b) => sum + blockChars(b), 0);
  }
}

/**
 * Character weight of the tool schemas. The previous estimator omitted these
 * entirely — with ~15 built-ins plus MCP servers that is thousands of tokens
 * the gate could not see.
 */
export function toolDefinitionChars(tools: readonly ToolDefinitionLike[]): number {
  let chars = 0;
  for (const t of tools) {
    chars += t.name.length + t.description.length;
    chars += JSON.stringify(t.inputSchema).length;
  }
  return chars;
}

/** Per-component character counts, so callers can attribute where context went. */
export interface ContextBreakdown {
  system: number;
  toolDefinitions: number;
  conversation: number;
  toolResults: number;
}

/** Fixed overhead for request envelope, role markers and JSON structure. */
const ENVELOPE_CHARS = 200;

export function breakdownChars(args: {
  system?: string;
  messages: readonly Message[];
  toolDefinitions?: readonly ToolDefinitionLike[];
}): ContextBreakdown {
  let conversation = 0;
  let toolResults = 0;
  for (const m of args.messages) {
    if (m.role === 'tool') toolResults += messageChars(m);
    else conversation += messageChars(m);
  }
  return {
    system: (args.system?.length ?? 0) + ENVELOPE_CHARS,
    toolDefinitions: toolDefinitionChars(args.toolDefinitions ?? []),
    conversation,
    toolResults,
  };
}

export function clampCalibration(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return DEFAULT_CALIBRATION;
  return Math.min(MAX_CALIBRATION, Math.max(MIN_CALIBRATION, ratio));
}

/**
 * Learn chars-per-token from a real usage report. A single hardcoded 4 is an
 * English heuristic; Polish, CJK and code-heavy transcripts land well below it,
 * which is how a run can be estimated at half its true size.
 */
export function calibrate(charsSent: number, actualInputTokens: number): number {
  if (charsSent <= 0 || actualInputTokens <= 0) return DEFAULT_CALIBRATION;
  return clampCalibration(charsSent / actualInputTokens);
}

export function estimateRequestTokens(args: {
  system?: string;
  messages: readonly Message[];
  toolDefinitions?: readonly ToolDefinitionLike[];
  calibration?: number;
}): number {
  const b = breakdownChars(args);
  const chars = b.system + b.toolDefinitions + b.conversation + b.toolResults;
  return Math.ceil(chars / clampCalibration(args.calibration ?? DEFAULT_CALIBRATION));
}

export function fillPct(estimatedTokens: number, budget: ContextBudget): number {
  if (budget.usableTokens <= 0) return 100;
  return Math.min(100, Math.round((estimatedTokens / budget.usableTokens) * 100));
}

/**
 * Map a fill percentage onto an action.
 *
 * `enabled: 'off'` silences everything, not just the forced tier. Previously it
 * gated only forced compaction, so disabling auto-compaction still produced a
 * stream of warnings the user had explicitly opted out of.
 */
export function classify(pct: number, cfg?: Partial<AutoCompactConfig>): ContextStatus {
  const d = DEFAULT_SETTINGS.auto_compact;
  if ((cfg?.enabled ?? d.enabled) === 'off') return 'ok';
  if (pct >= (cfg?.forced_threshold ?? d.forced_threshold)) return 'forced';
  if (pct >= (cfg?.threshold ?? d.threshold)) return 'suggest';
  if (pct >= (cfg?.warn_threshold ?? d.warn_threshold)) return 'warn';
  return 'ok';
}

/** Human-readable token count: 900 → "900", 12400 → "12.4k", 1200000 → "1.2m". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}
