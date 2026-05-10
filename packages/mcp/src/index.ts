export { MCPClient } from './client.js';
export { MCPToolAdapter } from './tool-adapter.js';
export type { MCPConfig, MCPConfigMap } from './types.js';
export { parseMcpConfigs, stringifyMcpConfigs } from './types.js';
export {
  MCPConnectionError,
  MCPTimeoutError,
  MCPServerError,
  isMCPConnectionError,
  normalizeError,
} from './errors.js';
export { createTransport } from './transport.js';

import type { Tool as CurieTool } from '@curie-agent/tools';
import { MCPClient } from './client.js';
import { MCPToolAdapter } from './tool-adapter.js';
import type { MCPConfig } from './types.js';
import { normalizeError } from './errors.js';

/** Options for creating MCP tools from server configs. */
export interface CreateMcpToolsOptions {
  /** Server configurations to connect to. */
  configs: MCPConfig[];
  /** Called when tools change on a server (via `notifications/tools/list_changed`). */
  onToolsChanged?: (serverId: string, tools: CurieTool[]) => void;
  /** Whether to continue connecting other servers even if one fails. Default: true. */
  failFast?: boolean;
}

/** Result of creating MCP tools from server configs. */
export interface CreateMcpToolsResult {
  /** All discovered tools wrapped as `CurieTool` instances. */
  tools: CurieTool[];
  /** The active MCP clients — caller should dispose them on shutdown. */
  clients: MCPClient[];
}

/**
 * Connect to all configured MCP servers and return their tools wrapped
 * as `CurieTool` instances, plus the client handles for lifecycle management.
 *
 * Servers that fail to connect are logged and skipped (unless `failFast: true`).
 */
export async function createMcpTools(
  options: CreateMcpToolsOptions | MCPConfig[],
): Promise<CreateMcpToolsResult> {
  const configs = Array.isArray(options) ? options : options.configs;
  const onToolsChanged = 'onToolsChanged' in options ? options.onToolsChanged : undefined;
  const failFast = 'failFast' in options ? options.failFast : false;

  const allTools: CurieTool[] = [];
  const clients: MCPClient[] = [];

  for (const config of configs) {
    const client = new MCPClient({
      config,
      onToolsChanged: () => {
        if (onToolsChanged) {
          const prefix = `${config.id}-`;
          const currentServerTools = allTools.filter((t) => t.definition.name.startsWith(prefix));
          onToolsChanged(config.id, currentServerTools);
        }
      },
    });

    try {
      await client.connect();
    } catch (err) {
      const msg = normalizeError(err, config.id).message;
      console.error(`[mcp] Failed to connect to server "${config.id}": ${msg}`);
      if (failFast) throw err;
      continue;
    }

    // Wrap each MCP tool from this server as a CurieTool
    const adapters = client.tools.map((mcpTool) =>
      new MCPToolAdapter(client, mcpTool, config.id),
    );

    allTools.push(...adapters);
    clients.push(client);
  }

  return { tools: allTools, clients };
}
