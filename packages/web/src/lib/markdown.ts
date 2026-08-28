import { marked, Marked } from 'marked';
import type { RendererObject, TokenizerAndRendererExtension, Tokens } from 'marked';
import DOMPurify from 'dompurify';

export function escapeHtml(text: string): string {
  return text.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

/** Escape for use inside a double-quoted HTML attribute. */
export function escAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * marked has no sanitizer, and this output goes straight into
 * dangerouslySetInnerHTML. Model output and fetched web content both reach it,
 * so an unsanitized `<img src=x onerror=…>` in a scraped page would execute in
 * the dashboard. Nothing in the daemon emits raw HTML any more — `/context`
 * became a structured event — so the allowlist can stay strict.
 *
 * Note for the document renderer below: DOMPurify validates `data-*` attributes
 * *before* consulting ALLOWED_ATTR and ALLOWED_URI_REGEXP (purify.cjs.js:1990,
 * "we don't need to check the value; it's always URI safe"), so `data-doc`
 * survives this config untouched. Do not set ALLOW_DATA_ATTR:false or
 * SAFE_FOR_TEMPLATES (which forces it false) — internal doc links would
 * silently stop working. markdown.test.ts guards this.
 */
function sanitize(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'hr', 'span', 'div',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'mark', 'sub', 'sup',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'blockquote', 'code', 'pre', 'kbd', 'samp', 'var',
      'a', 'img',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
      'input', // GFM task-list checkboxes
    ],
    ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'class', 'lang', 'colspan', 'rowspan', 'start', 'type', 'checked', 'disabled'],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
    FORBID_ATTR: ['style', 'srcset', 'formaction', 'form'],
  });
}

export function renderMarkdown(content: string): string {
  try {
    return sanitize(marked.parse(content) as string);
  } catch {
    return escapeHtml(content);
  }
}

// ---------------------------------------------------------------------------
// Document rendering — adds internal navigation on top of the chat pipeline.
// ---------------------------------------------------------------------------

/** The directory portion of a source-relative doc path (`''` at the root). */
export function docDirOf(docPath: string): string {
  const i = docPath.lastIndexOf('/');
  return i < 0 ? '' : docPath.slice(0, i);
}

/**
 * Resolve a relative markdown link against the directory of the current
 * document. Pure and fs-free. Returns null when the link is external, escapes
 * the source root, or does not point at markdown — callers render those as
 * plain text rather than dead links.
 */
export function resolveRelDocPath(currentDir: string, href: string): string | null {
  let p = href.split('#')[0] ?? '';
  try {
    p = decodeURIComponent(p);
  } catch { /* malformed escapes — keep the raw form */ }
  p = p.replace(/\\/g, '/').trim();
  if (!p) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return null; // any scheme is external

  const joined = p.startsWith('/') ? p.slice(1) : (currentDir ? `${currentDir}/${p}` : p);
  const out: string[] = [];
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null; // escapes the source root
      out.pop();
      continue;
    }
    out.push(seg);
  }

  const norm = out.join('/');
  if (!/\.(md|markdown)$/i.test(norm)) return null;
  return norm;
}

/**
 * `[[target]]` / `[[target|Label]]`.
 *
 * An inline extension rather than a regex pre-pass over the raw source: marked
 * consults inline extensions only after code spans and fenced blocks are
 * tokenised, so `[[foo]]` inside backticks stays literal for free.
 */
const wikilinkExt: TokenizerAndRendererExtension = {
  name: 'wikilink',
  level: 'inline',
  start(src: string) {
    const i = src.indexOf('[[');
    return i < 0 ? undefined : i;
  },
  tokenizer(src: string) {
    const m = /^\[\[([^\]|\n]+?)(?:\|([^\]\n]*))?\]\]/.exec(src);
    if (!m) return undefined;
    // The label group is optional, so it really is undefined for a bare
    // `[[target]]` — TS types RegExp captures as string, hence the cast.
    const [raw, target, label] = m as unknown as (string | undefined)[];
    if (raw === undefined || target === undefined) return undefined;
    return {
      type: 'wikilink',
      raw,
      target: target.trim(),
      label: (label ?? target).trim(),
    };
  },
  renderer(token) {
    const t = token as unknown as { target: string; label: string };
    return `<a class="doc-link" data-doc="wikilink:${escAttr(t.target)}">${escText(t.label)}</a>`;
  },
};

/**
 * Internal links carry `data-doc` and deliberately NO `href`: under the strict
 * ALLOWED_URI_REGEXP above, `href="notes.md"` and even `href="#"` fail every
 * branch and get stripped. `data-doc` grants no capability on its own — every
 * click is re-validated server-side by resolveDocPath in the daemon.
 */
function docRenderer(currentDir: string, known?: Set<string>): RendererObject {
  return {
    link(token: Tokens.Link) {
      const href = token.href;
      // External, anchor or protocol-relative -> let marked render it as usual.
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) return false;

      const target = resolveRelDocPath(currentDir, href);
      const text = this.parser.parseInline(token.tokens);
      if (!target) return text; // unresolvable -> plain text, not a dead link

      const broken = known && !known.has(target) ? ' doc-link-broken' : '';
      const title = token.title ? ` title="${escAttr(token.title)}"` : '';
      return `<a class="doc-link${broken}" data-doc="path:${escAttr(target)}"${title}>${text}</a>`;
    },
  };
}

export interface DocRenderContext {
  /** Directory of the document being rendered, for relative-link resolution. */
  dir: string;
  /** Known source-relative paths; unknown targets get `.doc-link-broken`. */
  known?: Set<string>;
}

/**
 * Render a standalone document. Uses a private Marked instance so the
 * per-document renderer and `breaks: false` never leak into the global
 * instance that renderMarkdown (chat) uses.
 *
 * `breaks: false` because prose documents are hard-wrapped; chat keeps
 * `breaks: true` since chat messages are newline-significant.
 */
export function renderDocMarkdown(content: string, ctx: DocRenderContext): string {
  try {
    const m = new Marked({ gfm: true, breaks: false });
    m.use({ extensions: [wikilinkExt], renderer: docRenderer(ctx.dir, ctx.known) });
    return sanitize(m.parse(content) as string);
  } catch {
    return escapeHtml(content);
  }
}
