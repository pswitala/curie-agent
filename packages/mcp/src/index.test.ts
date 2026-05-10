import { describe, expect, it } from 'vitest';
import {
  MCPConnectionError,
  MCPTimeoutError,
  MCPServerError,
  isMCPConnectionError,
  normalizeError,
  parseMcpConfigs,
  stringifyMcpConfigs,
} from './index.js';

describe('parseMcpConfigs', () => {
  it('returns empty array for undefined', () => {
    expect(parseMcpConfigs(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseMcpConfigs('')).toEqual([]);
  });

  it('parses valid JSON config map', () => {
    const raw = JSON.stringify({
      fs: { id: 'fs', name: 'Filesystem', transport: 'stdio' as const, command: 'node' },
    });
    const result = parseMcpConfigs(raw);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('fs');
    expect(result[0].transport).toBe('stdio');
  });

  it('returns empty array for invalid JSON', () => {
    expect(parseMcpConfigs('not json')).toEqual([]);
  });

  it('parses multiple configs', () => {
    const raw = JSON.stringify({
      a: { id: 'a', name: 'A', transport: 'stdio' as const, command: 'a' },
      b: { id: 'b', name: 'B', transport: 'sse' as const, url: 'http://localhost:3000' },
    });
    const result = parseMcpConfigs(raw);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('stringifyMcpConfigs', () => {
  it('serializes empty array', () => {
    expect(stringifyMcpConfigs([])).toBe('{}');
  });

  it('serializes a single config', () => {
    const configs = [{ id: 'fs', name: 'Filesystem', transport: 'stdio' as const, command: 'node' }];
    const result = stringifyMcpConfigs(configs);
    const parsed = JSON.parse(result);
    expect(parsed.fs.id).toBe('fs');
    expect(parsed.fs.command).toBe('node');
  });

  it('round-trips through parse', () => {
    const configs = [
      { id: 'x', name: 'X', transport: 'streamable-http' as const, url: 'http://x' },
    ];
    const serialized = stringifyMcpConfigs(configs);
    const parsed = parseMcpConfigs(serialized);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject(configs[0]);
  });
});

describe('MCPConnectionError', () => {
  it('includes serverId in message', () => {
    const err = new MCPConnectionError('failed', 'test-server');
    expect(err.message).toBe('[mcp:test-server] failed');
    expect(err.serverId).toBe('test-server');
    expect(err.name).toBe('MCPConnectionError');
  });

  it('isMCPConnectionError guard', () => {
    const err = new MCPConnectionError('fail', 's');
    expect(isMCPConnectionError(err)).toBe(true);
    expect(isMCPConnectionError(new Error('not mcp'))).toBe(false);
    expect(isMCPConnectionError('string')).toBe(false);
    expect(isMCPConnectionError(null)).toBe(false);
    expect(isMCPConnectionError(undefined)).toBe(false);
  });
});

describe('MCPTimeoutError', () => {
  it('includes timeout in message', () => {
    const err = new MCPTimeoutError('timed out', 's', 5000);
    expect(err.message).toBe('[mcp:s] timed out (timeout: 5000ms)');
    expect(err.serverId).toBe('s');
    expect(err.timeoutMs).toBe(5000);
    expect(err.name).toBe('MCPTimeoutError');
  });
});

describe('MCPServerError', () => {
  it('includes code when provided', () => {
    const err = new MCPServerError('error', 's', 'INTERNAL');
    expect(err.serverId).toBe('s');
    expect(err.code).toBe('INTERNAL');
    expect(err.name).toBe('MCPServerError');
  });
});

describe('normalizeError', () => {
  it('wraps existing Error', () => {
    const err = new Error('original');
    const result = normalizeError(err, 's');
    expect(result).toBeInstanceOf(MCPConnectionError);
    expect(result.message).toBe('[mcp:s] original');
  });

  it('returns plain Error when no serverId', () => {
    const err = new Error('original');
    const result = normalizeError(err);
    expect(result).toBe(err);
  });

  it('wraps non-Error values', () => {
    const result = normalizeError('string error', 's');
    expect(result).toBeInstanceOf(MCPConnectionError);
    expect(result.message).toBe('[mcp:s] string error');
  });

  it('handles null with unknown serverId', () => {
    const result = normalizeError(null);
    expect(result).toBeInstanceOf(MCPConnectionError);
    expect(result.message).toBe('[mcp:unknown] null');
  });
});
