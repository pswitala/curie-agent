import { summarizeToolInput } from './safety/tool-digest.js';
import { withMessageTimestamp } from './context.js';
import { estimateRequestTokens, clampCalibration, DEFAULT_CALIBRATION, type ContextBudget } from './context-budget.js';
import type { Message, ProviderStream } from './turn-loop.js';

/**
 * Conversation compaction.
 *
 * Two things distinguish this from what it replaces:
 *
 * 1. **It summarizes the whole transcript.** The previous implementation built
 *    its transcript from `user-prompt` and `assistant-delta` events only, so
 *    the tool calls and tool results that actually filled the window were
 *    excluded from the summary — and then deleted along with everything else.
 * 2. **It is non-destructive.** Compaction produces a summary and a kept tail;
 *    the caller appends a `compaction` marker to the session log rather than
 *    overwriting it.
 */

export interface CompactionResult {
  summary: string;
  /** Messages kept verbatim after the summary. May be empty. */
  keptMessages: Message[];
  summarizedMessageCount: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
}

/** Recent messages kept verbatim so the model retains its immediate working state. */
export const DEFAULT_MIN_TAIL_MESSAGES = 4;

/** Per-tool-result budget in the rendered transcript. */
const RESULT_SAMPLE_CHARS = 4000;

/** Output cap for the summarizer. The old 2048 could not hold a long research session. */
export const SUMMARY_MAX_TOKENS = 8192;

/**
 * Share of the usable window a single summarizer prompt may occupy. Above this
 * the transcript is summarized in chunks, then the chunk summaries are merged.
 */
const TRANSCRIPT_BUDGET_FRACTION = 0.6;

/**
 * Share of the usable window the kept tail may occupy. Leaves room for the
 * summary, the system prompt, tool schemas and the next few tool results —
 * otherwise compaction "succeeds" while leaving the history still over budget.
 */
const TAIL_BUDGET_FRACTION = 0.3;

const SUMMARY_PREFIX = '[Summary of prior conversation]';

const SYSTEM_PROMPT = [
  'You are a conversation summarizer for a coding agent.',
  'Produce a dense, high-fidelity summary of the transcript below.',
  'Preserve: the original goals, what was accomplished, findings and conclusions reached,',
  'every file path / URL / command / identifier mentioned, decisions made and why,',
  'current configuration state, and the pending next steps.',
  'Tool results are the bulk of this transcript — carry their substance forward, not just',
  'the fact that a tool ran. Prefer concrete detail over narration.',
  'Output ONLY the summary text: no preamble, no sign-off, no meta-commentary.',
].join(' ');

const MERGE_PROMPT = [
  'You are merging sequential partial summaries of one long conversation into a single summary.',
  'Preserve every concrete detail: file paths, URLs, commands, identifiers, findings, decisions,',
  'and pending next steps. Remove only redundancy between the parts.',
  'Output ONLY the merged summary text.',
].join(' ');

function truncate(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return `${text.slice(0, budget)}…[${String(text.length)} chars total]`;
}

/**
 * Render the message history as readable dialogue, including tool calls and
 * results. Tool inputs go through `summarizeToolInput`, which keeps
 * safety-relevant fields (url, command, file_path, pattern) intact and reduces
 * bulk fields to a head sample.
 */
export function renderTranscript(messages: readonly Message[]): string {
  const parts: string[] = [];
  const toolNameById = new Map<string, string>();

  for (const m of messages) {
    if (m.role === 'user') {
      parts.push(`User: ${m.content}`);
      continue;
    }

    if (m.role === 'assistant') {
      for (const block of m.content) {
        if (block.type === 'text') {
          if (block.text.trim()) parts.push(`Assistant: ${block.text}`);
        } else if (block.type === 'tool-use') {
          toolNameById.set(block.id, block.name);
          parts.push(`Assistant calls ${block.name}\n${summarizeToolInput(block.name, block.input)}`);
        }
        // Thinking blocks are deliberately omitted — they are the model's scratch
        // space, already superseded by the text and tool calls they produced.
      }
      continue;
    }

    const name = m.toolName ?? toolNameById.get(m.toolUseId) ?? 'tool';
    parts.push(`Result of ${name}: ${truncate(m.content, RESULT_SAMPLE_CHARS)}`);
  }

  return parts.join('\n\n');
}

/** Every tool-use id produced by the assistant messages in `slice`. */
function toolUseIds(slice: readonly Message[]): Set<string> {
  const ids = new Set<string>();
  for (const m of slice) {
    if (m.role !== 'assistant') continue;
    for (const block of m.content) {
      if (block.type === 'tool-use') ids.add(block.id);
    }
  }
  return ids;
}

/** Every tool-result id present in `slice`. */
function toolResultIds(slice: readonly Message[]): Set<string> {
  const ids = new Set<string>();
  for (const m of slice) {
    if (m.role === 'tool') ids.add(m.toolUseId);
  }
  return ids;
}

/**
 * Is cutting before index `i` valid for the provider APIs?
 *
 * Anthropic and OpenAI both reject a `tool` message with no preceding
 * `tool_use`, and a `tool_use` with no following result. Splitting mid-turn
 * without this check turns a context overflow into a hard 400.
 */
export function isSafeCut(messages: readonly Message[], i: number): boolean {
  if (messages[i]?.role === 'tool') return false;
  const head = messages.slice(0, i);
  const results = toolResultIds(head);
  for (const id of toolUseIds(head)) {
    if (!results.has(id)) return false;
  }
  return true;
}

export interface SplitOptions {
  /**
   * Token ceiling for the kept tail. Message *count* alone is not a bound: four
   * WebFetch results can be larger than the whole window, so a purely
   * count-based tail can leave the history over budget no matter how many times
   * it is compacted.
   */
  maxTailTokens?: number;
  calibration?: number;
}

/**
 * Split into a head to summarize and a tail to keep verbatim, cutting only
 * where the remaining history is still a valid request.
 *
 * Prefers keeping `minTailMessages`, but shrinks the tail — down to empty if
 * necessary — to stay under `maxTailTokens`.
 *
 * Returns `[messages, []]` when no safe cut exists: everything is summarized.
 */
export function splitAtSafeBoundary(
  messages: readonly Message[],
  minTailMessages: number = DEFAULT_MIN_TAIL_MESSAGES,
  options: SplitOptions = {},
): [head: Message[], tail: Message[]] {
  const preferred = Math.max(1, messages.length - Math.max(0, minTailMessages));
  const cut = (i: number): [Message[], Message[]] => [messages.slice(0, i), messages.slice(i)];

  if (options.maxTailTokens !== undefined) {
    // Walk forward from the preferred cut, shrinking the tail until it fits.
    for (let i = preferred; i <= messages.length; i++) {
      if (!isSafeCut(messages, i)) continue;
      const tokens = estimateRequestTokens({ messages: messages.slice(i), calibration: options.calibration });
      if (tokens <= options.maxTailTokens) return cut(i);
    }
  }

  for (let i = preferred; i >= 1; i--) {
    if (isSafeCut(messages, i)) return cut(i);
  }
  return [[...messages], []];
}

/** The synthetic user message that carries a summary back into the history. */
export function buildSummaryMessage(summary: string, timestampMs: number): Message {
  // Routed through withMessageTimestamp so live and reconstructed histories are
  // byte-identical — that equality is what keeps the provider prompt cache warm.
  return { role: 'user', content: withMessageTimestamp(`${SUMMARY_PREFIX}\n\n${summary}`, timestampMs) };
}

/** Split a transcript into chunks that each fit the summarizer's own budget. */
function chunkTranscript(transcript: string, maxChars: number): string[] {
  if (transcript.length <= maxChars) return [transcript];
  const chunks: string[] = [];
  const paragraphs = transcript.split('\n\n');
  let current = '';
  for (const p of paragraphs) {
    if (current && current.length + p.length + 2 > maxChars) {
      chunks.push(current);
      current = '';
    }
    // A single paragraph over budget (one huge tool result) is hard-split.
    if (p.length > maxChars) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < p.length; i += maxChars) chunks.push(p.slice(i, i + maxChars));
      continue;
    }
    current = current ? `${current}\n\n${p}` : p;
  }
  if (current) chunks.push(current);
  return chunks;
}

export interface CompactMessagesArgs {
  messages: readonly Message[];
  provider: ProviderStream;
  /** Summarizer model. Callers pass `auto_compact.model` or the active model. */
  model: string;
  budget: ContextBudget;
  minTailMessages?: number;
  calibration?: number;
  signal?: AbortSignal;
}

export async function compactMessages(args: CompactMessagesArgs): Promise<CompactionResult> {
  const { messages, provider, model, budget, signal } = args;

  const estimatedTokensBefore = estimateRequestTokens({ messages, calibration: args.calibration });

  const [head, tail] = splitAtSafeBoundary(messages, args.minTailMessages ?? DEFAULT_MIN_TAIL_MESSAGES, {
    maxTailTokens: Math.floor(budget.usableTokens * TAIL_BUDGET_FRACTION),
    calibration: args.calibration,
  });
  if (head.length === 0) {
    throw new Error('Nothing to compact: no messages precede the protected tail.');
  }

  const transcript = renderTranscript(head);
  if (!transcript.trim()) {
    throw new Error('Nothing to compact: no conversational content found.');
  }

  // Budget the summarizer prompt in characters, using the same calibration the
  // caller estimates with, so a huge transcript cannot itself overflow.
  const maxPromptTokens = Math.floor(budget.usableTokens * TRANSCRIPT_BUDGET_FRACTION);
  const charsPerToken = clampCalibration(args.calibration ?? DEFAULT_CALIBRATION);
  const maxPromptChars = Math.max(4000, Math.floor(maxPromptTokens * charsPerToken));

  const chunks = chunkTranscript(transcript, maxPromptChars);

  const partials: string[] = [];
  for (const [i, chunk] of chunks.entries()) {
    const label = chunks.length > 1 ? ` (part ${String(i + 1)} of ${String(chunks.length)})` : '';
    const text = await provider.check(`Summarize this conversation history${label}:\n\n${chunk}`, {
      model, system: SYSTEM_PROMPT, signal, maxTokens: SUMMARY_MAX_TOKENS,
    });
    partials.push(text.trim());
  }

  let summary = partials.join('\n\n');
  if (partials.length > 1) {
    const merged = await provider.check(
      `Merge these ${String(partials.length)} partial summaries into one:\n\n${partials.map((p, i) => `--- Part ${String(i + 1)} ---\n${p}`).join('\n\n')}`,
      { model, system: MERGE_PROMPT, signal, maxTokens: SUMMARY_MAX_TOKENS },
    );
    if (merged.trim()) summary = merged.trim();
  }

  if (!summary) {
    throw new Error('Compaction failed: the summarizer returned no text.');
  }

  const keptMessages = [...tail];
  const estimatedTokensAfter = estimateRequestTokens({
    messages: [buildSummaryMessage(summary, 0), ...keptMessages],
    calibration: args.calibration,
  });

  return {
    summary,
    keptMessages,
    summarizedMessageCount: head.length,
    estimatedTokensBefore,
    estimatedTokensAfter,
  };
}
