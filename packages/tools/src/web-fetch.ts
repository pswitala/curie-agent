import { z } from 'zod';
import { createTool, type ToolContext } from './tool.js';

const MAX_CONTENT = 100_000;

const WebFetchSchema = z.object({
  url: z.string().describe('The URL to fetch content from'),
  prompt: z.string().describe('Description of what content to extract from the page'),
  max_chars: z
    .number()
    .optional()
    .describe(
      `Maximum characters of page content to return (default and hard cap ${String(MAX_CONTENT)})`,
    ),
});

export const webFetchTool = createTool(
  'WebFetch',
  [
    'Fetches a URL and extracts readable content. Returns the extracted text.',
    `Content is capped at ${String(MAX_CONTENT / 1000)} KB; pass max_chars to request less.`,
  ].join(' '),
  WebFetchSchema,
  async (input, ctx: ToolContext) => {
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      return {
        output: null,
        error: `Invalid URL: "${input.url}"`,
      };
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (compatible; CurieBot/1.0)',
      },
    });

    if (!response.ok) {
      return {
        output: null,
        error: `Failed to fetch ${url.toString()}: ${response.status} ${response.statusText}`,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const body = await response.text();

    let content = body;
    if (contentType.includes('text/html')) {
      content = htmlToText(body);
    }

    const cap = Math.max(1, Math.min(input.max_chars ?? MAX_CONTENT, MAX_CONTENT));
    if (content.length > cap) {
      const totalKb = Math.round(content.length / 1000);
      const capKb = Math.round(cap / 1000);
      content =
        content.slice(0, cap) +
        `\n...[truncated at ${String(capKb)} KB of ${String(totalKb)} KB — refine the prompt or fetch a subpage]`;
    }

    return { output: { url: url.toString(), content, contentType } };
  },
);

function htmlToText(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<[^>]+>/g, ' ');
  text = text.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}
