import { describe, it, expect, vi, afterEach } from 'vitest';
import { webSearchTool } from './web-search';
import { webFetchTool } from './web-fetch';
import { DEFAULT_SETTINGS } from '@curie-agent/core';

describe('webSearchTool', () => {
  it('passes validation with all expected fields', () => {
    expect(() => webSearchTool.validate({ query: 'test' })).toBeDefined();
    expect(() => webSearchTool.validate({
      query: 'test',
      count: 5,
      blocked_domains: ['example.com'],
      allowed_domains: ['brave.com'],
    })).toBeDefined();
  });

  it('has correct schema definition', () => {
    expect(webSearchTool.definition.name).toBe('WebSearch');
    expect(typeof webSearchTool.definition.description).toBe('string');
  });
});

describe('webFetchTool', () => {
  it('returns error for invalid URL', async () => {
    const result = await webFetchTool.execute(
      { url: 'not-a-url', prompt: 'extract text' },
      DEFAULT_SETTINGS,
    );

    expect(result.output).toBeNull();
    expect(result.error).toContain('Invalid URL');
  });

  it('strips HTML tags from HTML content', async () => {
    const mockHtml = '<html><body><script>var x=1;</script><p>Hello <b>World</b></p></body></html>';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => mockHtml,
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetch as never;

    const result = await webFetchTool.execute(
      { url: 'https://example.com', prompt: 'extract text' },
      DEFAULT_SETTINGS,
    );

    expect(result.output).toBeDefined();
    const content = (result.output as { content: string })?.content;
    expect(content).not.toContain('<script>');
    expect(content).not.toContain('<b>');
    expect(content).toContain('Hello World');

    global.fetch = originalFetch;
  });

  it('truncates content over 100 KB with a notice', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: async () => 'a'.repeat(150_000),
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetch as never;

    const result = await webFetchTool.execute(
      { url: 'https://example.com/big', prompt: 'extract' },
      DEFAULT_SETTINGS,
    );

    const content = (result.output as { content: string }).content;
    expect(content).toContain('...[truncated at 100 KB of 150 KB');
    expect(content).toContain('refine the prompt or fetch a subpage');
    expect(content.length).toBeLessThan(101_000);

    global.fetch = originalFetch;
  });

  it('honours max_chars and clamps it to the 100 KB ceiling', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: async () => 'a'.repeat(150_000),
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetch as never;

    const small = await webFetchTool.execute(
      { url: 'https://example.com/big', prompt: 'extract', max_chars: 500 },
      DEFAULT_SETTINGS,
    );
    const smallContent = (small.output as { content: string }).content;
    expect(smallContent.startsWith('a'.repeat(500))).toBe(true);
    expect(smallContent).toContain('...[truncated at 1 KB of 150 KB');

    const clamped = await webFetchTool.execute(
      { url: 'https://example.com/big', prompt: 'extract', max_chars: 999_999 },
      DEFAULT_SETTINGS,
    );
    const clampedContent = (clamped.output as { content: string }).content;
    expect(clampedContent).toContain('...[truncated at 100 KB of 150 KB');

    global.fetch = originalFetch;
  });

  it('leaves content under the cap untouched', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: async () => 'short body',
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetch as never;

    const result = await webFetchTool.execute(
      { url: 'https://example.com', prompt: 'extract' },
      DEFAULT_SETTINGS,
    );
    expect((result.output as { content: string }).content).toBe('short body');

    global.fetch = originalFetch;
  });

  it('returns error for non-OK HTTP response', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetch as never;

    const result = await webFetchTool.execute(
      { url: 'https://example.com/missing', prompt: 'extract' },
      DEFAULT_SETTINGS,
    );

    expect(result.output).toBeNull();
    expect(result.error).toContain('404');

    global.fetch = originalFetch;
  });
});
