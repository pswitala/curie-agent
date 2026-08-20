import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import type { Event } from './event-bus.js';
import { TurnLoop, type ProviderStream, type Tool, type ProviderEvent } from './turn-loop.js';
import { SessionStore } from './session-store.js';

/**
 * Regression for the failure that motivated this work.
 *
 * A deep-research run on OpenRouter with a 1M window died with:
 *
 *   Estimated input (~1833k tokens) would exceed the context window (1000k)
 *
 * The shape that produced it: one `run()` iterating many turns, each fetching
 * large uncapped pages, with the only budget check happening *between* user
 * prompts — which never came. This reproduces that shape end to end.
 */

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), 'curie-agent-test-repro', crypto.randomUUID());
});

afterEach(() => {
  if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Polish market research: ~2.5 chars/token, well under the English assumption of 4. */
const DENSE_TEXT = 'Stadnina koni w województwie śląskim — pensjonat, rozród, treningi. ';
const POLISH_CHARS_PER_TOKEN = 2.5;
/** One WebFetch page at the tool's own 100 KB ceiling. */
const PAGE_REPEATS = 1500;

function studPulseSettings(): never {
  return {
    current_provider: 'openrouter',
    providers: { openrouter: { model_context_window: 1_000_000, max_output_tokens: 32_768 } },
    auto_compact: { enabled: 'on', threshold: 75, warn_threshold: 60, forced_threshold: 85 },
    tools_per_call: 10,
    websearch_per_call: 5,
    tools_per_run: 200,
    websearch_per_run: 60,
  } as never;
}

describe('regression: deep-research context overflow', () => {
  it('completes a long research run that previously hard-aborted', async () => {
    const store = new SessionStore(tmpDir);

    // Many turns of WebFetch, each returning a large page — the pattern that
    // grew context monotonically to 1.8M tokens.
    const TURNS = 40;
    let turn = 0;
    const provider: ProviderStream = {
      name: 'openrouter',
      stream: (streamArgs) => {
        const i = turn++;
        const charsSent = JSON.stringify(streamArgs.messages).length;
        return {
          iterable: (async function* () {
            if (i < TURNS) {
              yield { type: 'tool-call', id: `call_${String(i)}`, name: 'WebFetch', input: { url: `https://lendy.pl/${String(i)}` } } as ProviderEvent;
            } else {
              yield { type: 'text-delta', text: 'Deliverables complete.' } as ProviderEvent;
            }
            // Usage consistent with the payload actually received, at Polish
            // density — this is what teaches calibration that 4 chars/token
            // under-counts by ~40% here.
            yield { type: 'usage', inputTokens: Math.ceil(charsSent / POLISH_CHARS_PER_TOKEN), outputTokens: 500 } as ProviderEvent;
            yield { type: 'stop', reason: 'stop' } as ProviderEvent;
          })(),
          cancel() { /* noop */ },
        };
      },
      check: async () => 'Polish equestrian market: ~100 certified stables (lendy.pl), state studs Janów/Michałów verified, competitors priced.',
    };

    // WebFetch now caps its own output at 100 KB; model that here.
    const webFetch: Tool = {
      definition: { name: 'WebFetch', description: 'Fetches a URL and extracts readable content.', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } },
      execute: async () => ({ output: DENSE_TEXT.repeat(PAGE_REPEATS) }),
    };

    const result = await new TurnLoop(
      { provider, model: 'qwen/qwen3.6-plus', tools: [webFetch], cwd: tmpDir, settings: studPulseSettings(), maxTurns: 60 },
      store,
    ).run('Research the Polish equestrian market for StudPulse: competitors, pricing, client list, social channels.');

    // The original symptom.
    const errors = result.events.filter(e => e.type === 'error') as Extract<Event, { type: 'error' }>[];
    expect(errors.map(e => e.message).join('\n')).not.toMatch(/exceed the usable context/);
    expect(result.reason).toBe('stop');

    // It survived by compacting, not by luck.
    expect(result.events.some(e => e.type === 'compaction')).toBe(true);

    // And the research itself is still on disk in full.
    const persisted = store.loadEvents(result.sessionId);
    const toolResults = persisted.filter(e => e.type === 'tool-result');
    expect(toolResults.length).toBeGreaterThan(20);
  });

  it('is governed identically inside a subagent, which was never threshold-checked before', async () => {
    const store = new SessionStore(tmpDir);
    let turn = 0;
    const provider: ProviderStream = {
      name: 'openrouter',
      stream: () => {
        const i = turn++;
        return {
          iterable: (async function* () {
            if (i < 40) {
              yield { type: 'tool-call', id: `c${String(i)}`, name: 'WebFetch', input: {} } as ProviderEvent;
            } else {
              yield { type: 'text-delta', text: 'done' } as ProviderEvent;
            }
            yield { type: 'stop', reason: 'stop' } as ProviderEvent;
          })(),
          cancel() { /* noop */ },
        };
      },
      check: async () => 'summary',
    };

    // A subagent is just another TurnLoop — the enforcement lives there, so it
    // needs no separate wiring. That is the point of moving it out of the daemon.
    const result = await new TurnLoop(
      {
        provider, model: 'm', cwd: tmpDir, maxTurns: 60, type: 'subagent',
        tools: [{
          definition: { name: 'WebFetch', description: 'fetch', inputSchema: { type: 'object', properties: {} } },
          execute: async () => ({ output: DENSE_TEXT.repeat(PAGE_REPEATS) }),
        }],
        settings: studPulseSettings(),
      },
      store,
    ).run('deep research');

    expect(result.reason).toBe('stop');
    expect(result.events.some(e => e.type === 'compaction')).toBe(true);
  });
});
