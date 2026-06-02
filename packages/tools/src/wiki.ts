import { z } from 'zod';
import { createTool, type ToolContext } from './tool.js';

// Ops that require slug
const SlugOps = ['page_get', 'page_put', 'index_upsert'] as const;
// Ops that require content
const ContentOps = ['page_put'] as const;

const WikiSchema = z.object({
  op: z.enum([
    'init',
    'list_sources',
    'list_pages',
    'page_get',
    'page_put',
    'index_get',
    'index_upsert',
    'log_append',
    'search',
    'graph',
    'lint_report',
  ]).describe(
    'Operation: init (scaffold wiki), list_sources, list_pages, page_get, page_put, ' +
    'index_get, index_upsert, log_append, search, graph (backlink graph), lint_report',
  ),
  slug: z.string().optional().describe('Page slug relative to pages/ (e.g. concepts/topic)'),
  content: z.string().optional().describe('Markdown content for page_put'),
  query: z.string().optional().describe('Search query for the search op'),
  title: z.string().optional().describe('Page title for index_upsert'),
  summary: z.string().optional().describe('One-line summary for index_upsert'),
  category: z.string().optional().describe('Category for index_upsert (e.g. Concepts, Entities, Summaries)'),
  date: z.string().optional().describe('Date for index_upsert (YYYY-MM-DD)'),
  prefix: z.enum(['INGEST', 'QUERY', 'LINT', 'EDIT']).optional().describe('Log prefix for log_append'),
  line: z.string().optional().describe('Detail line for log_append'),
});

export const wikiTool = createTool(
  'Wiki',
  'Operate on the curie-agent knowledge wiki: scaffold, read/write pages, update the index, ' +
  'append to the log, search content, build the backlink graph, or run a deterministic lint ' +
  'report. The Ingest/Query/Lint *workflows* are not single calls — compose this tool with ' +
  'Read/WebFetch under the WIKI.md procedure.',
  WikiSchema,
  async (input, ctx: ToolContext) => {
    // Lazy import to avoid loading @curie-agent/wiki at startup when unused
    const { WikiManager, initWiki } = await import('@curie-agent/wiki');

    const rawWiki = (ctx.settings as unknown as Record<string, unknown>).wiki as
      | { path?: string; autoLint?: string }
      | undefined;
    const settingsForWiki = rawWiki
      ? { wiki: { path: rawWiki.path ?? '', autoLint: (rawWiki.autoLint ?? 'off') as 'on' | 'off' } }
      : undefined;

    switch (input.op) {
      case 'init': {
        const root = initWiki(settingsForWiki);
        return { output: { message: `Wiki initialized at ${root}`, root } };
      }

      default: {
        const wm = new WikiManager(settingsForWiki);
        wm.ensureStructure();

        switch (input.op) {
          case 'list_sources':
            return { output: wm.listRawSources() };

          case 'list_pages':
            return { output: wm.listPages() };

          case 'page_get': {
            if (!input.slug) return { output: null, error: 'slug is required for page_get' };
            const content = wm.readPage(input.slug);
            if (content === null) return { output: null, error: `Page not found: ${input.slug}` };
            return { output: content };
          }

          case 'page_put': {
            if (!input.slug) return { output: null, error: 'slug is required for page_put' };
            if (input.content === undefined) return { output: null, error: 'content is required for page_put' };
            wm.writePage(input.slug, input.content);
            return { output: { message: `Page written: ${input.slug}` } };
          }

          case 'index_get':
            return { output: wm.readIndex() };

          case 'index_upsert': {
            if (!input.slug) return { output: null, error: 'slug is required for index_upsert' };
            wm.upsertIndexEntry({
              slug: input.slug,
              title: input.title ?? input.slug.split('/').pop() ?? input.slug,
              summary: input.summary ?? '',
              category: input.category ?? 'Other',
              date: input.date,
            });
            return { output: { message: `Index updated: ${input.slug}` } };
          }

          case 'log_append': {
            if (!input.prefix) return { output: null, error: 'prefix is required for log_append' };
            const title = input.title ?? input.query ?? 'entry';
            wm.appendLog(input.prefix, title, input.line);
            return { output: { message: `Log appended: [${input.prefix}] ${title}` } };
          }

          case 'search': {
            if (!input.query) return { output: null, error: 'query is required for search' };
            return { output: wm.search(input.query) };
          }

          case 'graph':
            return { output: wm.graph() };

          case 'lint_report': {
            const report = wm.lintReport();
            return { output: report };
          }

          default:
            return { output: null, error: `Unknown op: ${String(input.op)}` };
        }
      }
    }
  },
);
