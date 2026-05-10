import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createTool } from './tool.js';

describe('createTool', () => {
  it('filters out null values from input before validation', async () => {
    const schema = z.object({
      file_path: z.string(),
      limit: z.number().optional(),
    });
    const tool = createTool('TestTool', 'A test tool', schema, async (input) => ({
      output: { path: input.file_path },
    }));

    const result = await tool.execute(
      { file_path: null, limit: undefined },
      {} as any,
    );
    expect(result.error).toMatch(/Validation error/);
    expect(result.error).toContain('file_path');
  });

  it('accepts input without null values', async () => {
    const schema = z.object({
      file_path: z.string(),
    });
    const tool = createTool('TestTool2', 'A test tool', schema, async (input) => ({
      output: { path: input.file_path },
    }));

    const result = await tool.execute(
      { file_path: '/some/path.txt' },
      {} as any,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ path: '/some/path.txt' });
  });

  it('formats validation errors with property paths', async () => {
    const schema = z.object({
      name: z.string(),
      count: z.number().min(1),
    });
    const tool = createTool('TestTool3', 'A test tool', schema, async (input) => ({
      output: input,
    }));

    const result = await tool.execute(
      { name: 123, count: 'not-a-number' },
      {} as any,
    );
    expect(result.error).toMatch(/Validation error for tool "TestTool3"/);
    expect(result.error).toContain('name');
    expect(result.error).toContain('count');
  });

  it('maps camelCase key aliases to snake_case (filePath -> file_path)', async () => {
    const schema = z.object({
      file_path: z.string(),
    });
    const tool = createTool('TestTool4', 'A test tool', schema, async (input) => ({
      output: { path: input.file_path },
    }));

    const result = await tool.execute(
      { filePath: '/some/path.txt' },
      {} as any,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ path: '/some/path.txt' });
  });

  it('prefers explicit snake_case over camelCase alias', async () => {
    const schema = z.object({
      file_path: z.string(),
    });
    const tool = createTool('TestTool5', 'A test tool', schema, async (input) => ({
      output: { path: input.file_path },
    }));

    // When both are provided, snake_case wins
    const result = await tool.execute(
      { file_path: '/snake/path.txt', filePath: '/camel/path.txt' },
      {} as any,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ path: '/snake/path.txt' });
  });

  it('maps oldString/newString aliases for Edit tool', async () => {
    const schema = z.object({
      file_path: z.string(),
      old_string: z.string(),
      new_string: z.string(),
    });
    const tool = createTool('TestTool6', 'A test tool', schema, async (input) => ({
      output: { file: input.file_path, old: input.old_string, new: input.new_string },
    }));

    const result = await tool.execute(
      { filePath: '/test.txt', oldString: 'hello', newString: 'world' },
      {} as any,
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ file: '/test.txt', old: 'hello', new: 'world' });
  });
});
