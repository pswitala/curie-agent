import { describe, it, expect, afterEach } from 'vitest';
import { z } from 'zod';
import { createTool, setGlobalCwd, type ToolContext } from './tool.js';

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

  afterEach(() => {
    setGlobalCwd('');
  });

  it('passes cwd to tool context via createTool param', async () => {
    const schema = z.object({ file_path: z.string() });
    const tool = createTool(
      'TestTool7',
      'A test tool',
      schema,
      async (input, ctx: ToolContext) => ({ output: { cwd: ctx.cwd, path: input.file_path } }),
      '/my/project',
    );
    const result = await tool.execute({ file_path: 'test.txt' }, {} as any);
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ cwd: '/my/project', path: 'test.txt' });
  });

  it('passes cwd to tool context via setGlobalCwd', async () => {
    const schema = z.object({ file_path: z.string() });
    const tool = createTool(
      'TestTool8',
      'A test tool',
      schema,
      async (input, ctx: ToolContext) => ({ output: { cwd: ctx.cwd, path: input.file_path } }),
    );
    setGlobalCwd('/global/project');
    const result = await tool.execute({ file_path: 'test.txt' }, {} as any);
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ cwd: '/global/project', path: 'test.txt' });
  });

  it('call-time cwd overrides global cwd', async () => {
    const schema = z.object({ file_path: z.string() });
    const tool = createTool(
      'TestTool9',
      'A test tool',
      schema,
      async (input, ctx: ToolContext) => ({ output: { cwd: ctx.cwd, path: input.file_path } }),
      '/default/project',
    );
    setGlobalCwd('/global/project');
    const result = await tool.execute({ file_path: 'test.txt' }, {} as any, '/override/project');
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ cwd: '/override/project', path: 'test.txt' });
  });

  describe('per-tool aliases and schema-aware normalization', () => {
    const fileSchema = z.object({
      file_path: z.string(),
      content: z.string().optional(),
    });
    const makeFileTool = () =>
      createTool(
        'AliasTool',
        'A test tool',
        fileSchema,
        async (input) => ({ output: { path: input.file_path } }),
        undefined,
        { aliases: { path: 'file_path', filename: 'file_path' } },
      );

    it('maps a per-tool alias (path -> file_path)', async () => {
      const result = await makeFileTool().execute({ path: '/aliased.txt' }, {} as any);
      expect(result.error).toBeUndefined();
      expect(result.output).toEqual({ path: '/aliased.txt' });
    });

    it('explicit schema key wins over alias regardless of key order', async () => {
      const tool = makeFileTool();
      const a = await tool.execute({ path: '/alias.txt', file_path: '/explicit.txt' }, {} as any);
      expect(a.output).toEqual({ path: '/explicit.txt' });
      const b = await tool.execute({ file_path: '/explicit.txt', path: '/alias.txt' }, {} as any);
      expect(b.output).toEqual({ path: '/explicit.txt' });
    });

    it('generic camelCase fallback applies only when the snake form is in the schema', async () => {
      const schema = z.object({ head_limit: z.number(), other: z.string().optional() });
      const tool = createTool('FallbackTool', 'A test tool', schema, async (input) => ({
        output: { limit: input.head_limit },
      }));
      const ok = await tool.execute({ headLimit: 5 }, {} as any);
      expect(ok.error).toBeUndefined();
      expect(ok.output).toEqual({ limit: 5 });

      // someKey -> some_key is not in the schema, so it must not satisfy head_limit
      const bad = await tool.execute({ someKey: 5 }, {} as any);
      expect(bad.error).toMatch(/Validation error/);
    });

    it('does not remap a legitimate path param on tools without a file_path alias', async () => {
      const globLike = z.object({ pattern: z.string(), path: z.string().optional() });
      const tool = createTool('GlobLike', 'A test tool', globLike, async (input) => ({
        output: { pattern: input.pattern, path: input.path },
      }));
      const result = await tool.execute({ pattern: '*.ts', path: 'src' }, {} as any);
      expect(result.error).toBeUndefined();
      expect(result.output).toEqual({ pattern: '*.ts', path: 'src' });
    });

    it('validation errors include an Expected parameters summary', async () => {
      const result = await makeFileTool().execute({}, {} as any);
      expect(result.error).toContain('Expected parameters:');
      expect(result.error).toContain('file_path (string, required)');
      expect(result.error).toContain('content (string)');
    });

    it('suggests the nearest parameter name for unknown keys', async () => {
      const schema = z.object({ file_path: z.string() });
      const tool = createTool('SuggestTool', 'A test tool', schema, async (input) => ({
        output: input.file_path,
      }));
      const result = await tool.execute({ file: '/x.txt' }, {} as any);
      expect(result.error).toContain('Unknown parameter "file"');
      expect(result.error).toContain('did you mean "file_path"');
    });
  });
});
