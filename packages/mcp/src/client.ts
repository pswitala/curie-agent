import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Tool as MCPTool, CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { createTransport } from './transport.js';
import type { MCPConfig } from './types.js';
import { MCPConnectionError, normalizeError } from './errors.js';

export interface MCPClientOptions {
  config: MCPConfig;
  /** Called when the server pushes a `notifications/tools/list_changed` event. */
  onToolsChanged?: () => void;
}

export class MCPClient {
  private sdkClient: Client;
  private transport: Transport | null = null;
  private _tools: MCPTool[] = [];
  private readonly config: MCPConfig;
  private disposed = false;
  private connecting = false;

  constructor(options: MCPClientOptions) {
    this.config = options.config;

    this.sdkClient = new Client(
      { name: `curie-agent-mcp-${options.config.id}`, version: '0.1.0' },
    );

    // Register tool list changed handler
    if (options.onToolsChanged) {
      this.sdkClient.setNotificationHandler(
        ToolListChangedNotificationSchema,
        async () => {
          try {
            await this.refreshTools();
            options.onToolsChanged!();
          } catch (err) {
            console.error(`[mcp:${this.config.id}] Failed to refresh tools:`, normalizeError(err, this.config.id));
          }
        },
      );
    }

    // Handle out-of-band transport errors
    this.sdkClient.onerror = (error) => {
      console.error(`[mcp:${this.config.id}] Transport error:`, error.message);
    };

    this.sdkClient.onclose = () => {
      console.log(`[mcp:${this.config.id}] Connection closed`);
    };
  }

  get tools(): ReadonlyArray<MCPTool> {
    return this._tools;
  }

  get isConnected(): boolean {
    return !this.disposed && this.transport !== null;
  }

  get serverId(): string {
    return this.config.id;
  }

  get serverName(): string {
    return this.config.name;
  }

  async connect(): Promise<void> {
    if (this.connecting) {
      throw new MCPConnectionError('Already connecting', this.config.id);
    }
    if (this.isConnected) {
      return; // already connected
    }
    if (this.disposed) {
      throw new MCPConnectionError('Client has been disposed', this.config.id);
    }

    this.connecting = true;
    try {
      const transport = await createTransport(this.config);
      this.transport = transport;
      await this.sdkClient.connect(transport);
      await this.refreshTools();
      console.error(`[mcp:${this.config.id}] Connected, tools: ${this._tools.length}`);
    } catch (err) {
      console.error(`[mcp:${this.config.id}] Connect failed: ${normalizeError(err, this.config.id).message}`);
      throw err;
    } finally {
      this.connecting = false;
    }
  }

  private async refreshTools(): Promise<void> {
    let cursor: string | undefined;
    const allTools: MCPTool[] = [];
    do {
      const result = await this.sdkClient.listTools({ cursor });
      allTools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor);
    this._tools = allTools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.isConnected) {
      throw new MCPConnectionError('Not connected — call connect() first', this.config.id);
    }
    try {
      const result = await this.sdkClient.callTool({ name, arguments: args });
      // Handle the SDK's union return type: if it has `toolResult` instead of `content`,
      // it means the server returned the compat shape.
      if ('toolResult' in result) {
        return {
          content: [],
          isError: true,
        };
      }
      return result;
    } catch (err) {
      throw normalizeError(err, this.config.id);
    }
  }

  async disconnect(): Promise<void> {
    this.disposed = true;
    try {
      await this.sdkClient.close();
    } catch {
      // ignore close errors during shutdown
    }
    this.transport = null;
  }
}
