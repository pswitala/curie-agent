import type { Tool as CurieTool, ToolDef, ToolResult } from '@curie-agent/tools';
import type { MCPClient } from './client.js';
import type { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import type { CurieSettings } from '@curie-agent/core';

export class MCPToolAdapter implements CurieTool {
  readonly definition: ToolDef;
  private client: MCPClient;
  private readonly mcpToolName: string;

  constructor(client: MCPClient, mcpTool: MCPTool, serverPrefix: string) {
    this.client = client;
    this.mcpToolName = mcpTool.name;

    // Prefix the tool name to avoid collisions: e.g., "filesystem-read-file"
    const prefixedName = `${serverPrefix}-${mcpTool.name}`;

    this.definition = {
      name: prefixedName,
      description: mcpTool.description ?? '',
      inputSchema: mcpTool.inputSchema as ToolDef['inputSchema'],
    };
  }

  async execute(input: Record<string, unknown>, _settings: CurieSettings): Promise<ToolResult> {
    const result = await this.client.callTool(this.mcpToolName, input);

    // Convert MCP CallToolResult content array -> string
    const outputParts: string[] = [];
    for (const content of result.content) {
      if (content.type === 'text') {
        outputParts.push(content.text);
      } else if (content.type === 'image') {
        outputParts.push(`[image: ${content.data} (${content.mimeType})]`);
      } else if (content.type === 'resource') {
        outputParts.push(`[resource: ${JSON.stringify(content.resource)}]`);
      } else {
        outputParts.push(JSON.stringify(content));
      }
    }

    const outputStr = outputParts.join('\n');

    if (result.isError) {
      return { output: outputStr, error: `MCP tool "${this.mcpToolName}" reported error` };
    }

    return { output: outputStr };
  }
}
