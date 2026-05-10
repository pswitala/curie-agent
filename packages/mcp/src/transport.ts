import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { MCPConfig } from './types.js';

let _stdioTransport: typeof import('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport;
let _sseTransport: typeof import('@modelcontextprotocol/sdk/client/sse.js').SSEClientTransport;
let _streamableHttpTransport: typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransport;

async function lazyLoadTransports() {
  if (!_stdioTransport) {
    const sdk = await import('@modelcontextprotocol/sdk/client/stdio.js');
    _stdioTransport = sdk.StdioClientTransport;
  }
  if (!_sseTransport) {
    const sdk = await import('@modelcontextprotocol/sdk/client/sse.js');
    _sseTransport = sdk.SSEClientTransport;
  }
  if (!_streamableHttpTransport) {
    const sdk = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
    _streamableHttpTransport = sdk.StreamableHTTPClientTransport;
  }
  return { _stdioTransport, _sseTransport, _streamableHttpTransport };
}

/**
 * The SDK merges getDefaultEnvironment() with config.env in its start() method:
 *   { ...getDefaultEnvironment(), ...this._serverParams.env }
 *
 * So we can pass config.env directly — the SDK handles the merge.
 * But we need to make sure getDefaultEnvironment is called at the right time
 * (it reads from process.env which may have changed).
 */

export async function createTransport(config: MCPConfig): Promise<Transport> {
  const { _stdioTransport, _sseTransport, _streamableHttpTransport } = await lazyLoadTransports();

  switch (config.transport) {
    case 'stdio': {
      if (!config.command) {
        throw new Error(`MCP server "${config.id}" requires "command" for stdio transport`);
      }
      // Pass env directly — SDK merges it with getDefaultEnvironment() internally.
      console.error(`[mcp:${config.id}] Creating stdio transport: cmd="${config.command}" args=${JSON.stringify(config.args)} env=${JSON.stringify(config.env)} cwd=${config.cwd}`);
      return new _stdioTransport({
        command: config.command,
        args: config.args ?? [],
        env: config.env,
        cwd: config.cwd,
      });
    }
    case 'sse':
      if (!config.url) {
        throw new Error(`MCP server "${config.id}" requires "url" for sse transport`);
      }
      return new _sseTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
      });
    case 'streamable-http':
      if (!config.url) {
        throw new Error(`MCP server "${config.id}" requires "url" for streamable-http transport`);
      }
      return new _streamableHttpTransport(new URL(config.url), {
        requestInit: {
          headers: config.headers,
        },
      });
    default: {
      const _exhaustive: never = config.transport;
      throw new Error(`Unsupported MCP transport: ${_exhaustive}`);
    }
  }
}
