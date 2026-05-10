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
