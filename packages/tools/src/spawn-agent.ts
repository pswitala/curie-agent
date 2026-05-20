import { z } from 'zod';
import type { Tool } from '@curie-agent/core';
import { SubagentExecutor } from '@curie-agent/core';
import type { ProviderStream, ReasoningEffort } from '@curie-agent/core';
import type { CurieSettings } from '@curie-agent/core';
import type { ApprovalMode } from '@curie-agent/core';

export interface SpawnAgentToolConfig {
  subagentExecutor: SubagentExecutor;
  provider: ProviderStream;
  cwd: string;
  settings: CurieSettings;
  model: string;
}

export function createSpawnAgentTool(config: SpawnAgentToolConfig): Tool {
  const { subagentExecutor, provider, cwd, settings, model } = config;

  return {
    definition: {
      name: 'spawn_agent',
      description: 'Spawn a subagent to work on a task in parallel. The subagent runs with its own TurnLoop and streams output back to the parent session. Returns the agent ID for tracking.',
      inputSchema: JSON.stringify({
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: {
            type: 'string',
            description: 'The task instruction for the subagent',
          },
          mode: {
            type: 'string',
            enum: ['plan', 'edit', 'auto', 'yolo'],
            description: 'Approval mode override (default: inherits from parent session)',
          },
          effort: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'max', 'auto'],
            description: 'Reasoning effort override (default: inherits from parent)',
          },
          tools: {
            type: 'array',
            items: { type: 'string' },
            description: 'Subset of tool names to allow. Empty or omitted = all parent tools.',
          },
          model: {
            type: 'string',
            description: 'Model override for this subagent (e.g. "anthropic/claude-sonnet-4-6")',
          },
          provider: {
            type: 'string',
            enum: ['anthropic', 'openai', 'google', 'ollama', 'openrouter'],
            description: 'Provider to use for this subagent (default: inherits from parent)',
          },
        },
      }),
    },
    async execute(input: Record<string, unknown>) {
      const prompt = input.prompt as string;
      if (!prompt) {
        return { output: null, error: 'spawn_agent requires a "prompt" argument' };
      }

      const mode = input.mode as ApprovalMode | undefined;
      const effort = input.effort as ReasoningEffort | undefined;
      const tools = input.tools as string[] | undefined;
      const modelOverride = input.model as string | undefined;
      const providerName = input.provider as string | undefined;

      try {
        // If a specific provider is requested, create a settings override
        const spawnSettings = providerName
          ? { ...settings, current_provider: providerName } as typeof settings
          : settings;

        const handle = await subagentExecutor.spawn({
          provider,
          model: modelOverride || model,
          tools: [{
            definition: { name: 'noop', description: 'Placeholder', inputSchema: '{}' },
            execute: async () => ({ output: null }),
          }],
          cwd,
          settings,
          prompt,
          providerName: providerName || undefined,
          mode,
          effort,
          allowedTools: tools,
          type: 'subagent',
        });

        return {
          output: {
            agentId: handle.agentId,
            prompt: handle.prompt,
            status: handle.status,
            sessionId: handle.sessionId,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { output: null, error: `Failed to spawn subagent: ${msg}` };
      }
    },
  };
}
