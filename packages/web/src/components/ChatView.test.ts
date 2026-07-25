import { describe, it, expect } from 'vitest';
import { eventToMessage, findToolResult } from './ChatView.js';
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
