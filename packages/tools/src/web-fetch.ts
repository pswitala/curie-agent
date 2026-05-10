import { z } from 'zod';
import { createTool, type ToolContext } from './tool.js';

const WebFetchSchema = z.object({
  url: z.string().describe('The URL to fetch content from'),
  prompt: z.string().describe('Description of what content to extract from the page'),
});

export const webFetchTool = createTool(
  'WebFetch',
  'Fetches a URL and extracts readable content. Returns the extracted text.',
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
        'User-Agent': 'Mozilla/5.0 (compatible; HopperBot/1.0)',
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
