/** Configuration for a single MCP server connection. */
export interface MCPConfig {
  /** Unique server identifier, used as prefix for tool names (e.g. "filesystem"). */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Transport protocol for this connection. */
  transport: 'stdio' | 'sse' | 'streamable-http';
  /** Executable command — required for stdio transport. */
  command?: string;
  /** Arguments to pass to the command — for stdio transport. */
  args?: string[];
  /** Environment variables for the subprocess — for stdio transport. */
  env?: Record<string, string>;
  /** Working directory for the subprocess — for stdio transport. */
  cwd?: string;
  /** Server URL — required for sse and streamable-http transports. */
  url?: string;
  /** Additional HTTP headers — for sse and streamable-http transports. */
  headers?: Record<string, string>;
  /** Per-request timeout in milliseconds (default: 30000). */
  timeoutMs?: number;
}

/** Serialized MCP server config map, stored in settings as JSON string. */
export interface MCPConfigMap {
  [serverId: string]: MCPConfig;
}

/** Helper to parse MCP config map from a JSON string. */
export function parseMcpConfigs(raw: string | undefined): MCPConfig[] {
  if (!raw) return [];
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return Object.values(obj).map((v) => v as MCPConfig);
  } catch {
    return [];
  }
}

/** Helper to serialize MCP config map to a JSON string for settings storage. */
export function stringifyMcpConfigs(configs: MCPConfig[]): string {
  const map: Record<string, MCPConfig> = {};
  for (const cfg of configs) {
    map[cfg.id] = cfg;
  }
  return JSON.stringify(map);
}
