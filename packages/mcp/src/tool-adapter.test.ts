import { describe, expect, it } from 'vitest';
import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import type { CurieSettings } from '@curie-agent/core';
import { MCPToolAdapter } from './tool-adapter.js';
import type { MCPClient } from './client.js';

function makeAdapter(text: string): MCPToolAdapter {
  const client = {
    callTool: async () => ({ content: [{ type: 'text', text }] }),
  } as unknown as MCPClient;
  const mcpTool = { name: 'read-file', description: 'reads', inputSchema: {} } as MCPTool;
  return new MCPToolAdapter(client, mcpTool, 'fs');
}

describe('MCPToolAdapter', () => {
  it('prefixes the tool name with the server id', () => {
    expect(makeAdapter('ok').definition.name).toBe('fs-read-file');
  });

  it('returns short output untouched', async () => {
    const result = await makeAdapter('hello').execute({}, {} as CurieSettings);
    expect(result.output).toBe('hello');
  });

  it('truncates output over 100 KB with a notice', async () => {
    const result = await makeAdapter('a'.repeat(150_000)).execute({}, {} as CurieSettings);
    const output = result.output as string;
    expect(output).toContain('...[truncated at 100 KB of 150 KB');
    expect(output.length).toBeLessThan(101_000);
  });
});
