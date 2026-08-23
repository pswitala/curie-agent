import { describe, it, expect, vi } from 'vitest';
import { createSpawnAgentTool } from './spawn-agent';
import { DEFAULT_SETTINGS } from '@curie-agent/core';
import type { Tool } from '@curie-agent/core';

function fakeTool(name: string): Tool {
  return {
    definition: { name, description: `fake ${name}`, inputSchema: { type: 'object', properties: {} } },
    execute: async () => ({ output: null }),
  } as unknown as Tool;
}

function setup(finalText = 'the answer') {
  const spawn = vi.fn().mockResolvedValue({
    agentId: 'a1',
    prompt: 'do the thing',
    status: 'running',
    sessionId: 's1',
    text: '',
    toolCalls: 0,
    errors: [],
  });
  const waitFor = vi.fn().mockResolvedValue({
    agentId: 'a1',
    prompt: 'do the thing',
    status: 'done',
    sessionId: 's1',
    text: finalText,
    toolCalls: 3,
    errors: [],
  });
  const tools = [fakeTool('Read'), fakeTool('SendMessage')];
  // The context is resolved per call so a subagent inherits whatever provider,
  // model and settings are current at spawn time.
  const resolve = vi.fn(() => ({
    provider: { name: 'anthropic', stream: vi.fn() } as never,
    cwd: '/tmp',
    settings: DEFAULT_SETTINGS,
    model: 'claude-sonnet-4-6',
    tools,
  }));
  const tool = createSpawnAgentTool({
    subagentExecutor: { spawn, waitFor } as never,
    resolve,
  });
  return { tool, spawn, waitFor, tools, resolve };
}

describe('createSpawnAgentTool', () => {
  it('forwards the parent tools to the subagent', async () => {
    const { tool, spawn, tools } = setup();

    await tool.execute({ prompt: 'do the thing' }, DEFAULT_SETTINGS);

    expect(spawn).toHaveBeenCalledTimes(1);
    const arg = spawn.mock.calls[0]?.[0] as { tools: Tool[]; allowedTools?: string[] };
    expect(arg.tools).toBe(tools);
    expect(arg.tools.map((t) => t.definition.name)).toEqual(['Read', 'SendMessage']);
    expect(arg.allowedTools).toBeUndefined();
  });

  it('passes the input tool names as allowedTools without clobbering tools', async () => {
    const { tool, spawn, tools } = setup();

    await tool.execute({ prompt: 'p', tools: ['Read'] }, DEFAULT_SETTINGS);

    const arg = spawn.mock.calls[0]?.[0] as { tools: Tool[]; allowedTools?: string[] };
    expect(arg.allowedTools).toEqual(['Read']);
    expect(arg.tools).toBe(tools);
  });

  it('applies the provider override to the spawned settings', async () => {
    const { tool, spawn } = setup();

    await tool.execute({ prompt: 'p', provider: 'openai' }, DEFAULT_SETTINGS);

    const arg = spawn.mock.calls[0]?.[0] as {
      settings: { current_provider: string };
      providerName?: string;
    };
    expect(arg.settings.current_provider).toBe('openai');
    expect(arg.providerName).toBe('openai');
  });

  it('inherits parent settings when no provider override is given', async () => {
    const { tool, spawn } = setup();

    await tool.execute({ prompt: 'p' }, DEFAULT_SETTINGS);

    const arg = spawn.mock.calls[0]?.[0] as { settings: unknown; providerName?: string };
    expect(arg.settings).toBe(DEFAULT_SETTINGS);
    expect(arg.providerName).toBeUndefined();
  });

  it('awaits completion and returns the subagent final text', async () => {
    const { tool, waitFor } = setup('here is the research');

    const result = await tool.execute({ prompt: 'research it' }, DEFAULT_SETTINGS);

    expect(waitFor).toHaveBeenCalledWith('a1');
    expect(result.output).toEqual({
      agentId: 'a1',
      sessionId: 's1',
      status: 'done',
      text: 'here is the research',
      toolCalls: 3,
      errors: [],
    });
  });

  it('caps the returned text and points at the child session', async () => {
    const { tool } = setup('x'.repeat(60_000));

    const result = await tool.execute({ prompt: 'research it' }, DEFAULT_SETTINGS);

    const text = (result.output as { text: string }).text;
    expect(text).toContain('...[truncated at 50k chars of 60000');
    expect(text).toContain('subagent session s1');
    expect(text.length).toBeLessThan(50_200);
  });

  it('errors without a prompt', async () => {
    const { tool, spawn } = setup();

    const result = await tool.execute({}, DEFAULT_SETTINGS);

    expect(result.output).toBeNull();
    expect(result.error).toContain('prompt');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('resolves the spawn context on every call, not once at construction', async () => {
    const { tool, resolve } = setup();

    await tool.execute({ prompt: 'first' }, DEFAULT_SETTINGS);
    await tool.execute({ prompt: 'second' }, DEFAULT_SETTINGS);

    expect(resolve).toHaveBeenCalledTimes(2);
  });
});
