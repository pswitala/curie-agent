import { describe, it, expect } from 'vitest';
import { summarizeToolInput } from './tool-digest.js';

const DIGEST_CAP = 1500;

describe('summarizeToolInput — bulk payloads', () => {
  it('truncates a large Write content but keeps file_path intact', () => {
    const filePath = 'C:/git/dev.curie-agent/app/packages/core/src/very/deeply/nested/module.ts';
    const content = 'x'.repeat(50_000);
    const digest = summarizeToolInput('Write', { file_path: filePath, content });

    expect(digest.length).toBeLessThanOrEqual(DIGEST_CAP);
    expect(digest).toContain(`file_path: ${filePath}`);
    expect(digest).toContain('…[50000 chars total]');
    expect(digest).not.toContain(content);
  });

  it('truncates both Edit strings but keeps file_path intact', () => {
    const digest = summarizeToolInput('Edit', {
      file_path: '/app/main.ts',
      old_string: 'a'.repeat(5000),
      new_string: 'b'.repeat(7000),
      replace_all: false,
    });

    expect(digest.length).toBeLessThanOrEqual(DIGEST_CAP);
    expect(digest).toContain('file_path: /app/main.ts');
    expect(digest).toContain('…[5000 chars total]');
    expect(digest).toContain('…[7000 chars total]');
    expect(digest).toContain('replace_all: false');
  });

  it('is orders of magnitude smaller than the raw JSON for a large Write', () => {
    const input = { file_path: '/app/main.ts', content: 'y'.repeat(50_000) };
    const digest = summarizeToolInput('Write', input);

    expect(digest.length).toBeLessThan(JSON.stringify(input).length / 50);
  });
});

describe('summarizeToolInput — high-signal fields', () => {
  it('preserves a 900-character Bash command verbatim', () => {
    const command = `echo ${'a'.repeat(880)}`;
    expect(command.length).toBeGreaterThan(800);
    expect(command.length).toBeLessThan(1000);

    const digest = summarizeToolInput('Bash', { command, description: 'echo a lot' });

    expect(digest).toContain(command);
    expect(digest).not.toContain('chars total');
  });

  it('truncates a command that exceeds even the high-signal budget', () => {
    const digest = summarizeToolInput('Bash', { command: 'z'.repeat(4000) });
    expect(digest).toContain('…[4000 chars total]');
    expect(digest.length).toBeLessThanOrEqual(DIGEST_CAP);
  });

  it('keeps url, pattern and glob intact', () => {
    const digest = summarizeToolInput('Grep', {
      pattern: 'function\\s+\\w+\\(',
      path: '/app/src',
      glob: '**/*.{ts,tsx}',
    });

    expect(digest).toContain('pattern: function\\s+\\w+\\(');
    expect(digest).toContain('path: /app/src');
    expect(digest).toContain('glob: **/*.{ts,tsx}');
  });

  it('escapes multi-line values so each field stays on one line', () => {
    const digest = summarizeToolInput('Bash', { command: 'echo one\necho two' });
    expect(digest.split('\n')).toHaveLength(2);
    expect(digest).toContain('\\necho two');
  });
});

describe('summarizeToolInput — cheap tools stay cheap', () => {
  it('Read is no larger than the raw JSON it replaces', () => {
    const input = { file_path: '/app/main.ts', offset: 10, limit: 200 };
    const digest = summarizeToolInput('Read', input);

    expect(digest).toContain('file_path: /app/main.ts');
    expect(digest).toContain('offset: 10');
    expect(digest).toContain('limit: 200');
    expect(digest.length).toBeLessThanOrEqual(JSON.stringify(input).length + 'Tool: Read'.length);
  });

  it('Glob renders compactly', () => {
    const digest = summarizeToolInput('Glob', { pattern: 'src/**/*.ts' });
    expect(digest).toBe('Tool: Glob\npattern: src/**/*.ts');
  });
});

describe('summarizeToolInput — value shapes', () => {
  it('renders numbers, booleans and null without throwing', () => {
    const digest = summarizeToolInput('Thing', { n: 42, b: true, z: null });
    expect(digest).toContain('n: 42');
    expect(digest).toContain('b: true');
    expect(digest).toContain('z: null');
  });

  it('renders short arrays inline and collapses long ones', () => {
    expect(summarizeToolInput('Todo', { ids: ['a', 'b', 'c'] })).toContain('ids: [a, b, c]');

    const many = summarizeToolInput('Todo', { ids: Array.from({ length: 50 }, (_, i) => `id-${i}`) });
    expect(many).toContain('…42 more');
  });

  it('collapses nested objects past the depth limit', () => {
    const digest = summarizeToolInput('Chart', {
      series: [{ name: 'a', points: [{ x: 1, y: 2 }] }],
    });
    expect(digest).toContain('series:');
    expect(digest.length).toBeLessThanOrEqual(DIGEST_CAP);
  });

  it('skips undefined values', () => {
    const digest = summarizeToolInput('Read', { file_path: '/a.ts', offset: undefined });
    expect(digest).toBe('Tool: Read\nfile_path: /a.ts');
  });

  it('handles an empty or non-object input', () => {
    expect(summarizeToolInput('Ping', {})).toBe('Tool: Ping\n(no arguments)');
    expect(summarizeToolInput('Ping', null)).toBe('Tool: Ping\n(no arguments)');
    expect(summarizeToolInput('Ping', 'oops')).toBe('Tool: Ping\n(no arguments)');
  });

  it('applies the generic rules to unknown / MCP tools', () => {
    const digest = summarizeToolInput('mcp__brave-search__brave_web_search', {
      query: 'curie agent',
      unexpected_blob: 'q'.repeat(9000),
    });

    expect(digest).toContain('query: curie agent');
    expect(digest).toContain('…[9000 chars total]');
    expect(digest.length).toBeLessThanOrEqual(DIGEST_CAP);
  });

  it('caps the total digest when many fields are large', () => {
    const input: Record<string, string> = {};
    for (let i = 0; i < 40; i++) input[`command_${i}`] = 'c'.repeat(500);

    const digest = summarizeToolInput('Wide', input);
    expect(digest.length).toBeLessThanOrEqual(DIGEST_CAP + '…[truncated]'.length);
    expect(digest.endsWith('…[truncated]')).toBe(true);
  });
});
