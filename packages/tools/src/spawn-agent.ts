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
  /** Tools handed to the subagent. The `tools` input narrows this via allowedTools. */
  tools: Tool[];
}

const MAX_TEXT = 50_000;

export function createSpawnAgentTool(config: SpawnAgentToolConfig): Tool {
  const { subagentExecutor, provider, cwd, settings, model, tools } = config;

  return {
    definition: {
      name: 'spawn_agent',
      description: 'Spawn a subagent to work on a task. The subagent runs with its own TurnLoop and streams output back to the parent session. Blocks until the subagent finishes and returns its final answer, so delegating research here keeps the intermediate tool results out of this session\'s context.',
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
      const allowedToolNames = input.tools as string[] | undefined;
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
          tools,
          cwd,
          settings: spawnSettings,
          prompt,
          providerName: providerName || undefined,
          mode,
          effort,
          allowedTools: allowedToolNames,
          type: 'subagent',
        });

        // Await completion so the parent model actually receives the answer —
        // without this, delegating work to a subagent returns nothing usable.
        const final = (await subagentExecutor.waitFor(handle.agentId)) ?? handle;

        let text = final.text;
        if (text.length > MAX_TEXT) {
          text =
            text.slice(0, MAX_TEXT) +
            `\n...[truncated at ${String(MAX_TEXT / 1000)}k chars of ${String(text.length)} — the full output is in subagent session ${final.sessionId}]`;
        }

        return {
          output: {
            agentId: final.agentId,
            sessionId: final.sessionId,
            status: final.status,
            text,
            toolCalls: final.toolCalls,
            errors: final.errors,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { output: null, error: `Failed to spawn subagent: ${msg}` };
      }
    },
  };
}
