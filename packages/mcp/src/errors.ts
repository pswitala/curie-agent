export class MCPConnectionError extends Error {
  constructor(message: string, public readonly serverId: string) {
    super(`[mcp:${serverId}] ${message}`);
    this.name = 'MCPConnectionError';
  }
}

export class MCPTimeoutError extends Error {
  constructor(message: string, public readonly serverId: string, public readonly timeoutMs: number) {
    super(`[mcp:${serverId}] ${message} (timeout: ${timeoutMs}ms)`);
    this.name = 'MCPTimeoutError';
  }
}

export class MCPServerError extends Error {
  constructor(message: string, public readonly serverId: string, public readonly code?: string) {
    super(`[mcp:${serverId}] ${message}`);
    this.name = 'MCPServerError';
  }
}

export function isMCPConnectionError(err: unknown): err is MCPConnectionError {
  return err instanceof MCPConnectionError;
}

export function normalizeError(err: unknown, serverId?: string): Error {
  if (err instanceof Error) {
    return serverId ? new MCPConnectionError(err.message, serverId) : err;
  }
  return new MCPConnectionError(String(err), serverId ?? 'unknown');
}
