import { describe, it, expect } from 'vitest';
import { EventSchema, ToolDefinitionSchema, JsonRpcRequestSchema, PROTOCOL_VERSION } from './index.js';

describe('PROTOCOL_VERSION', () => {
  it('is protocol/v1', () => {
    expect(PROTOCOL_VERSION).toBe('protocol/v1');
  });
});

describe('EventSchema', () => {
  it('validates a status event', () => {
    const result = EventSchema.safeParse({
      type: 'status',
      id: '1',
      message: 'hello',
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it('validates a tool-call event', () => {
    const result = EventSchema.safeParse({
      type: 'tool-call',
      id: '1',
      toolCallId: 'tc-1',
      name: 'Read',
      input: { path: 'file.ts' },
      timestamp: Date.now(),
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid event type', () => {
    const result = EventSchema.safeParse({
      type: 'invalid',
      id: '1',
      timestamp: Date.now(),
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = EventSchema.safeParse({
      type: 'status',
      id: '1',
      timestamp: Date.now(),
    });
    expect(result.success).toBe(false);
  });
});

describe('ToolDefinitionSchema', () => {
  it('validates a tool definition', () => {
    const result = ToolDefinitionSchema.safeParse({
      name: 'Read',
      description: 'Read a file',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    });
    expect(result.success).toBe(true);
  });
});

describe('JsonRpcRequestSchema', () => {
  it('validates a JSON-RPC request', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '2.0',
      id: 1,
      method: 'session.list',
      params: {},
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid jsonrpc version', () => {
    const result = JsonRpcRequestSchema.safeParse({
      jsonrpc: '1.0',
      id: 1,
      method: 'test',
    });
    expect(result.success).toBe(false);
  });
});
