// @vitest-environment jsdom
//
// jsdom, not the workspace default of node: this module graph pulls in
// lib/markdown.ts, which loads DOMPurify at import time. The sanitizer tests
// themselves now live in lib/markdown.test.ts.
import { describe, it, expect } from 'vitest';
import { eventToMessage, findToolResult, buildMessages } from './ChatView.js';
import type { WsEvent } from '../lib/ws-client.js';

function chartToolCall(input: Record<string, unknown>, toolCallId = 'call_1'): WsEvent {
  return { type: 'tool-call', id: 'e1', toolCallId, name: 'Chart', input, timestamp: 1000 };
}

describe('eventToMessage — Chart tool-call', () => {
  it('carries the raw input as rawInput, not as a ready-to-render spec', () => {
    const raw = { type: 'barchart', title: 'Aliased', data: [{ name: 'A', points: [{ x: 'a', y: 1 }] }] };
    const msg = eventToMessage(chartToolCall(raw));
    expect(msg).toEqual({ type: 'chart', toolCallId: 'call_1', rawInput: raw, time: expect.any(String) });
  });
});

describe('findToolResult', () => {
  const normalizedSpec = {
    type: 'bar',
    title: 'Aliased',
    series: [{ name: 'A', points: [{ x: 'a', y: 1 }] }],
  };

  it('returns undefined (pending) when no matching tool-result has arrived yet', () => {
    const events: WsEvent[] = [chartToolCall({}, 'call_1')];
    expect(findToolResult(events, 'call_1')).toBeUndefined();
  });

  it('returns the normalized spec from the matching tool-result output once it arrives', () => {
    const events: WsEvent[] = [
      chartToolCall({ type: 'barchart', data: [] }, 'call_1'),
      { type: 'tool-result', id: 'e2', toolCallId: 'call_1', output: normalizedSpec, timestamp: 1001 },
    ];
    expect(findToolResult(events, 'call_1')).toEqual({ output: normalizedSpec, error: undefined });
  });

  it('surfaces the tool-result error for a rejected chart call', () => {
    const events: WsEvent[] = [
      chartToolCall({ type: 'scatter', series: [] }, 'call_1'),
      { type: 'tool-result', id: 'e2', toolCallId: 'call_1', output: null, error: 'Too many series', timestamp: 1001 },
    ];
    expect(findToolResult(events, 'call_1')).toEqual({ output: null, error: 'Too many series' });
  });

  it('does not match a tool-result for a different toolCallId', () => {
    const events: WsEvent[] = [
      { type: 'tool-result', id: 'e2', toolCallId: 'call_other', output: normalizedSpec, timestamp: 1001 },
    ];
    expect(findToolResult(events, 'call_1')).toBeUndefined();
  });
});

describe('eventToMessage — compaction marker', () => {
  const compaction: WsEvent = {
    type: 'compaction', id: 'c1', summary: 'THE SUMMARY',
    summarizedMessageCount: 34, tokensBefore: 411_000, tokensAfter: 18_000, timestamp: 2000,
  } as unknown as WsEvent;

  it('produces its own entry type carrying the token counts', () => {
    expect(eventToMessage(compaction)).toEqual({
      type: 'compaction', summary: 'THE SUMMARY', summarizedMessageCount: 34,
      tokensBefore: 411_000, tokensAfter: 18_000, time: expect.any(String),
    });
  });

  it('is a turn boundary, not glued into the assistant buffer', () => {
    const built = buildMessages([
      { type: 'user-prompt', id: 'u1', text: 'go', timestamp: 1000 } as unknown as WsEvent,
      { type: 'assistant-delta', id: 'a1', text: 'working on it', timestamp: 1001 } as unknown as WsEvent,
      compaction,
    ]);
    const serialized = JSON.stringify(built);
    expect(serialized).toContain('"type":"compaction"');
    // The summary must not be concatenated onto the model's reply.
    expect(serialized).not.toContain('working on itTHE SUMMARY');
  });
});

describe('eventToMessage — context-warning', () => {
  it('gets its own type so it is not welded onto the previous reply', () => {
    const msg = eventToMessage({
      type: 'context-warning', id: 'w1', message: 'Context 81% full.', timestamp: 3000,
    } as unknown as WsEvent);
    expect(msg).toMatchObject({ type: 'context-warning', content: 'Context 81% full.' });
  });

  it('does not concatenate into the assistant buffer', () => {
    const built = buildMessages([
      { type: 'user-prompt', id: 'u1', text: 'go', timestamp: 1000 } as unknown as WsEvent,
      { type: 'assistant-delta', id: 'a1', text: 'Here is the answer.', timestamp: 1001 } as unknown as WsEvent,
      { type: 'context-warning', id: 'w1', message: 'Context 81% full.', timestamp: 1002 } as unknown as WsEvent,
    ]);
    expect(JSON.stringify(built)).not.toContain('Here is the answer.Context 81% full.');
  });
});
