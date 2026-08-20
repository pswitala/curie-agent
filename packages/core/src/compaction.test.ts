import { describe, it, expect, vi } from 'vitest';
import {
  renderTranscript, splitAtSafeBoundary, isSafeCut, buildSummaryMessage, compactMessages,
} from './compaction.js';
import type { Message, ProviderStream } from './turn-loop.js';

const budget = { windowTokens: 200_000, reservedOutput: 32_768, usableTokens: 167_232 };

function fakeProvider(reply = 'SUMMARY', calls: Array<{ prompt: string; maxTokens?: number }> = []): ProviderStream {
  return {
    name: 'fake',
    stream: () => { throw new Error('not used'); },
    check: vi.fn(async (prompt: string, a?: { maxTokens?: number }) => {
      calls.push({ prompt, maxTokens: a?.maxTokens });
      return reply;
    }),
  } as unknown as ProviderStream;
}

/** user → assistant(tool-use A) → tool A → assistant(text) → user → assistant(text) */
const conversation: Message[] = [
  { role: 'user', content: 'find the docs' },
  { role: 'assistant', content: [{ type: 'tool-use', id: 'A', name: 'WebFetch', input: { url: 'https://example.com/a' } }] },
  { role: 'tool', toolUseId: 'A', toolName: 'WebFetch', content: 'page body' },
  { role: 'assistant', content: [{ type: 'text', text: 'found it' }] },
  { role: 'user', content: 'now summarize' },
  { role: 'assistant', content: [{ type: 'text', text: 'here you go' }] },
];

describe('renderTranscript', () => {
  it('includes tool calls and their results — not just user/assistant prose', () => {
    const t = renderTranscript(conversation);
    expect(t).toContain('User: find the docs');
    expect(t).toContain('Assistant: found it');
    expect(t).toContain('Assistant calls WebFetch');
    expect(t).toContain('https://example.com/a');
    expect(t).toContain('Result of WebFetch: page body');
  });

  it('truncates a huge tool result with an explicit marker', () => {
    const t = renderTranscript([{ role: 'tool', toolUseId: 'A', toolName: 'WebFetch', content: 'x'.repeat(50_000) }]);
    expect(t).toContain('chars total]');
    expect(t.length).toBeLessThan(6000);
  });

  it('omits thinking blocks', () => {
    const t = renderTranscript([{ role: 'assistant', content: [{ type: 'thinking', thinking: 'SECRET SCRATCH', signature: 's' }] }]);
    expect(t).not.toContain('SECRET SCRATCH');
  });

  it('falls back to the tool-use name when toolName is absent', () => {
    const t = renderTranscript([
      { role: 'assistant', content: [{ type: 'tool-use', id: 'A', name: 'Grep', input: {} }] },
      { role: 'tool', toolUseId: 'A', content: 'hit' },
    ]);
    expect(t).toContain('Result of Grep: hit');
  });
});

describe('isSafeCut / splitAtSafeBoundary', () => {
  it('rejects a cut that orphans a tool result from its tool-use', () => {
    expect(isSafeCut(conversation, 2)).toBe(false);
  });

  it('accepts a cut at a user-message boundary', () => {
    expect(isSafeCut(conversation, 4)).toBe(true);
  });

  it('never returns a tail beginning with a tool message', () => {
    for (let minTail = 0; minTail <= conversation.length + 2; minTail++) {
      const [, tail] = splitAtSafeBoundary(conversation, minTail);
      expect(tail[0]?.role).not.toBe('tool');
    }
  });

  it('never leaves an unmatched tool-use in the head', () => {
    for (let minTail = 0; minTail <= conversation.length + 2; minTail++) {
      const [head] = splitAtSafeBoundary(conversation, minTail);
      const used = new Set<string>();
      for (const m of head) {
        if (m.role === 'assistant') for (const b of m.content) if (b.type === 'tool-use') used.add(b.id);
      }
      for (const m of head) if (m.role === 'tool') used.delete(m.toolUseId);
      expect([...used]).toEqual([]);
    }
  });

  it('keeps at least minTailMessages when a safe cut allows it', () => {
    const [, tail] = splitAtSafeBoundary(conversation, 2);
    expect(tail.length).toBeGreaterThanOrEqual(2);
  });

  it('summarizes everything when no safe cut exists', () => {
    // A single unresolved tool-use turn: any cut would orphan something.
    const stuck: Message[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'tool-use', id: 'A', name: 'Bash', input: {} }] },
      { role: 'tool', toolUseId: 'A', content: 'out' },
    ];
    const [head, tail] = splitAtSafeBoundary(stuck, 0);
    expect(head.length + tail.length).toBe(stuck.length);
    expect(tail[0]?.role).not.toBe('tool');
  });

  it('handles an empty history', () => {
    expect(splitAtSafeBoundary([], 4)).toEqual([[], []]);
  });

  it('shrinks the tail below a token ceiling rather than honouring the message count', () => {
    // Four WebFetch results can exceed the whole window. A purely count-based
    // tail would leave the history over budget no matter how often it compacts.
    const fat: Message[] = Array.from({ length: 8 }, (_, i): Message => ({ role: 'user', content: `m${String(i)} ${'x'.repeat(40_000)}` }));
    const [head, tail] = splitAtSafeBoundary(fat, 4, { maxTailTokens: 2_000, calibration: 4 });

    expect(head.length).toBeGreaterThan(4);
    expect(tail.length).toBeLessThan(4);
    for (const m of tail) expect(m.role).not.toBe('tool');
  });

  it('keeps the preferred tail when it already fits', () => {
    const light: Message[] = Array.from({ length: 8 }, (_, i): Message => ({ role: 'user', content: `m${String(i)}` }));
    const [, tail] = splitAtSafeBoundary(light, 4, { maxTailTokens: 100_000, calibration: 4 });
    expect(tail).toHaveLength(4);
  });
});

describe('buildSummaryMessage', () => {
  it('is a user message carrying the summary', () => {
    const m = buildSummaryMessage('the summary', 1_700_000_000_000);
    expect(m.role).toBe('user');
    expect(m.content).toContain('the summary');
    expect(m.content).toContain('[Summary of prior conversation]');
  });

  it('is byte-identical for the same timestamp — the prompt-cache invariant', () => {
    const a = buildSummaryMessage('s', 1_700_000_000_000);
    const b = buildSummaryMessage('s', 1_700_000_000_000);
    expect(a).toEqual(b);
  });
});

describe('compactMessages', () => {
  it('summarizes the head and keeps the tail verbatim', async () => {
    const r = await compactMessages({ messages: conversation, provider: fakeProvider(), model: 'm', budget, minTailMessages: 2 });
    expect(r.summary).toBe('SUMMARY');
    expect(r.summarizedMessageCount).toBeGreaterThan(0);
    expect(r.keptMessages.length).toBeGreaterThanOrEqual(2);
    expect(r.keptMessages).toEqual(conversation.slice(conversation.length - r.keptMessages.length));
  });

  it('reports a real before/after, not a hardcoded number', async () => {
    const big: Message[] = [
      ...Array.from({ length: 20 }, (_, i): Message => ({ role: 'tool', toolUseId: `t${String(i)}`, toolName: 'WebFetch', content: 'y'.repeat(20_000) })),
      { role: 'user', content: 'continue' },
    ];
    const r = await compactMessages({ messages: big, provider: fakeProvider(), model: 'm', budget, minTailMessages: 1 });
    expect(r.estimatedTokensBefore).toBeGreaterThan(r.estimatedTokensAfter);
    expect(r.estimatedTokensAfter).toBeGreaterThan(0);
  });

  it('raises the summarizer output cap above the harm-check default', async () => {
    const calls: Array<{ prompt: string; maxTokens?: number }> = [];
    await compactMessages({ messages: conversation, provider: fakeProvider('S', calls), model: 'm', budget });
    expect(calls[0]?.maxTokens).toBe(8192);
  });

  it('chunks an oversized transcript and merges the parts', async () => {
    const calls: Array<{ prompt: string; maxTokens?: number }> = [];
    const tiny = { windowTokens: 4000, reservedOutput: 1000, usableTokens: 3000 };
    const huge: Message[] = [
      ...Array.from({ length: 12 }, (_, i): Message => ({ role: 'user', content: `chunk${String(i)} ${'z'.repeat(9000)}` })),
      { role: 'user', content: 'tail' },
    ];
    const r = await compactMessages({ messages: huge, provider: fakeProvider('PART', calls), model: 'm', budget: tiny, minTailMessages: 1 });
    expect(calls.length).toBeGreaterThan(2);
    expect(calls.some(c => c.prompt.startsWith('Merge these'))).toBe(true);
    expect(r.summary).toBe('PART');
  });

  it('rejects a history with nothing to summarize', async () => {
    await expect(compactMessages({ messages: [], provider: fakeProvider(), model: 'm', budget }))
      .rejects.toThrow(/Nothing to compact/);
  });

  it('rejects an empty summarizer response rather than silently losing history', async () => {
    await expect(compactMessages({ messages: conversation, provider: fakeProvider('   '), model: 'm', budget }))
      .rejects.toThrow(/returned no text/);
  });
});
