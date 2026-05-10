import { describe, it, expect } from 'vitest';

function parseStreamJsonSummary(raw: string, prompt: string): string {
  const { basename } = require('path');
  const lines = raw.split('\n');
  const texts: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('__meta')) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;

      // type: "assistant" — message.content is an array of blocks
      if (obj.type === 'assistant' && obj.message && typeof obj.message === 'object') {
        const msg = obj.message as Record<string, unknown>;
        const contentArr = msg.content;
        if (Array.isArray(contentArr)) {
          for (const block of contentArr) {
            if (typeof block !== 'object' || block === null) continue;
            const b = block as Record<string, unknown>;
            // Only text blocks — skip thinking blocks (internal reasoning)
            if (b.type === 'text' && typeof b.text === 'string') {
              texts.push(b.text);
            }
          }
        }
      }

      // type: "result" — final output has a flat "result" field
      if (obj.type === 'result' && typeof obj.result === 'string') {
        texts.push(obj.result);
      }
    } catch {
      // Not JSON — skip
    }
  }

  const fullText = texts.join('\n').trim();

  if (fullText) {
    const summary = fullText.length > 2000
      ? fullText.slice(0, 2000) + '... (truncated)'
      : fullText;
    return `Agent done work on project: ${basename(process.cwd())}\n${'---'.repeat(10)}\n${summary}`;
  }

  const nonJsonLines = lines
    .filter(l => l.trim() && !l.trim().startsWith('{'))
    .filter(l => !l.trim().startsWith('['))
    .join('\n')
    .trim();

  if (nonJsonLines) {
    const summary = nonJsonLines.length > 2000
      ? nonJsonLines.slice(0, 2000) + '... (truncated)'
      : nonJsonLines;
    return `Agent done work on project: ${basename(process.cwd())}\n${'---'.repeat(10)}\n${summary}`;
  }

  return `Agent finished on project: ${basename(process.cwd())}`;
}

describe('parseStreamJsonSummary', () => {
  it('extracts text from assistant block content (real format)', () => {
    const json = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'Let me think about this...', signature: '' },
          { type: 'text', text: 'Hello world!' },
        ],
      },
    });
    const result = parseStreamJsonSummary(json, 'check codebase');
    expect(result).not.toContain('Let me think about this...'); // thinking is skipped
    expect(result).toContain('Hello world!');
    expect(result).toContain('Agent done work on project:');
  });

  it('extracts text only (no thinking)', () => {
    const json = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Found 3 issues in the code.' },
        ],
      },
    });
    const result = parseStreamJsonSummary(json, 'check codebase');
    expect(result).toContain('Found 3 issues in the code.');
    expect(result).not.toContain('thinking');
  });

  it('extracts result from result event', () => {
    const json = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'Done successfully',
    });
    const result = parseStreamJsonSummary(json, 'check codebase');
    expect(result).toContain('Done successfully');
  });

  it('combines multiple assistant events', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'First part' }] },
      }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Second part' }] },
      }),
    ];
    const result = parseStreamJsonSummary(lines.join('\n'), 'check codebase');
    expect(result).toContain('First part');
    expect(result).toContain('Second part');
  });

  it('skips system/init events', () => {
    const json = JSON.stringify({
      type: 'system',
      subtype: 'init',
      model: 'claude-opus-4-7',
    });
    const result = parseStreamJsonSummary(json, 'check codebase');
    expect(result).toContain('Agent finished on project:');
    expect(result).not.toContain('claude-opus-4-7');
  });

  it('handles full real-world output', () => {
    const output = JSON.stringify({
      type: 'system',
      subtype: 'init',
      model: 'claude-opus-4-7',
    }) + '\n' +
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'thinking', thinking: 'The user wants me to check the codebase.', signature: '' },
          { type: 'text', text: 'I found the following issues:\n1. Missing error handling in auth.\n2. Unnecessary console.log in production code.' },
        ],
      },
    }) + '\n' +
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'I found 2 issues in your codebase.',
    });

    const result = parseStreamJsonSummary(output, 'check codebase');
    expect(result).toContain('Missing error handling');
    expect(result).toContain('console.log');
  });

  it('skips __meta lines from --verbose', () => {
    const lines = [
      '__meta {"timestamp":"2026-05-02T12:00:00Z"}',
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Result' }] } }),
      '__meta {"event":"done"}',
    ];
    const result = parseStreamJsonSummary(lines.join('\n'), 'check codebase');
    expect(result).toContain('Result');
    expect(result).not.toContain('__meta');
  });

  it('handles empty input', () => {
    const result = parseStreamJsonSummary('', 'check codebase');
    expect(result).toContain('Agent finished on project:');
  });

  it('truncates long summaries at 2000 chars', () => {
    const longText = 'x'.repeat(3000);
    const json = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: longText }] },
    });
    const result = parseStreamJsonSummary(json, 'check codebase');
    expect(result).toContain('... (truncated)');
    expect(result.length).toBeLessThan(3000);
  });
});
