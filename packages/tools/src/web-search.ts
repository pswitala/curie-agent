import { z } from 'zod';
import { createTool, type ToolContext } from './tool.js';

const WebSearchSchema = z.object({
  query: z.string().describe('The search query to look up on the web'),
  count: z.number().optional().describe('Number of results to return (max 20, default 10)'),
  blocked_domains: z.array(z.string()).optional().describe('Domains to exclude from search results'),
  allowed_domains: z.array(z.string()).optional().describe('Only return results from these domains'),
});

export const webSearchTool = createTool(
  'WebSearch',
  'Search the web using Brave Search API. Returns titles, URLs, and snippets.',
  WebSearchSchema,
  async (input, ctx: ToolContext) => {
    const apiKey = ctx.settings.BRAVE_SEARCH_API_KEY;
    if (!apiKey) {
      return {
        output: null,
        error: 'BRAVE_SEARCH_API_KEY is not configured in settings.json',
      };
    }

    const count = Math.min(input.count ?? 10, 20);

    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', input.query);
    url.searchParams.set('count', String(count));

    if (input.allowed_domains?.length) {
      url.searchParams.set('filters', input.allowed_domains.join(','));
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });

    if (!response.ok) {
      return {
        output: null,
        error: `Brave Search API error: ${response.status} ${response.statusText}`,
      };
    }

    const data = await response.json() as Record<string, unknown>;

    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const web = data.web as Record<string, unknown> | undefined;
    const webResults = (web?.results as Record<string, unknown>[] | undefined) ?? [];

    for (const r of webResults) {
      const title = (r.title as string) ?? '';
      const urlStr = (r.url as string) ?? '';
      const snippet = (r.description as string) ?? '';

      if (input.blocked_domains?.length) {
        try {
          const hostname = new URL(urlStr).hostname;
          if (input.blocked_domains.some((d) => hostname.includes(d))) continue;
        } catch {
          continue;
        }
      }

      results.push({ title, url: urlStr, snippet });

      if (results.length >= count) break;
    }

    return { output: results };
  },
);
