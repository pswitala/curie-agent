// @vitest-environment jsdom
//
// jsdom, not the workspace default of node: sanitize() runs DOMPurify, which
// needs a DOM. Under node every sanitize() call throws into the escapeHtml
// fallback, so these tests would pass without ever exercising the sanitizer.
import { describe, it, expect } from 'vitest';
import { docDirOf, renderDocMarkdown, renderMarkdown, resolveRelDocPath } from './markdown.js';

const doc = (content: string, dir = '', known?: Set<string>) =>
  renderDocMarkdown(content, { dir, known });

describe('renderMarkdown sanitization', () => {
  it('strips script tags', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script');
  });

  it('strips inline event handlers reachable via fetched page content', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>');
    expect(out).not.toContain('onerror');
  });

  it('strips javascript: URLs', () => {
    expect(renderMarkdown('[click](javascript:alert(1))')).not.toContain('javascript:');
  });

  it('still renders ordinary markdown', () => {
    const out = renderMarkdown('## Title\n\n* one\n* two\n\n`code`');
    expect(out).toContain('<h2');
    expect(out).toContain('<li>');
    expect(out).toContain('<code>');
  });
});

describe('renderDocMarkdown sanitization', () => {
  it('applies the same sanitizer as the chat renderer', () => {
    expect(doc('<script>alert(1)</script>')).not.toContain('<script');
    expect(doc('<img src=x onerror=alert(1)>')).not.toContain('onerror');
    expect(doc('[click](javascript:alert(1))')).not.toContain('javascript:');
  });

  it('leaves external links byte-identical to the chat renderer', () => {
    const md = '[x](https://example.com)';
    expect(doc(md)).toBe(renderMarkdown(md));
  });
});

describe('data-doc survives DOMPurify', () => {
  // Regression guard. DOMPurify validates data-* before ALLOWED_ATTR and
  // ALLOWED_URI_REGEXP, which is the only reason internal links work at all.
  // Setting ALLOW_DATA_ATTR:false or SAFE_FOR_TEMPLATES would break navigation
  // silently — this test is what catches that.
  it('keeps data-doc on wikilinks', () => {
    expect(doc('[[concepts/rag]]')).toContain('data-doc="wikilink:concepts/rag"');
  });

  it('keeps data-doc on relative links', () => {
    expect(doc('[x](rules.md)', 'memory')).toContain('data-doc="path:memory/rules.md"');
  });

  it('emits no href on internal links, since the URI allowlist would strip it', () => {
    const out = doc('[[a]]');
    expect(out).toContain('data-doc=');
    expect(out).not.toContain('href');
  });
});

describe('wikilinks', () => {
  it('renders the target as the label by default', () => {
    const out = doc('[[alpha]]');
    expect(out).toContain('data-doc="wikilink:alpha"');
    expect(out).toContain('>alpha</a>');
  });

  it('honours a pipe label', () => {
    const out = doc('[[alpha|Alpha Page]]');
    expect(out).toContain('data-doc="wikilink:alpha"');
    expect(out).toContain('>Alpha Page</a>');
  });

  it('leaves wikilinks inside a code span literal', () => {
    const out = doc('use `[[alpha]]` here');
    expect(out).not.toContain('data-doc');
    expect(out).toContain('[[alpha]]');
  });

  it('leaves wikilinks inside a fenced block literal', () => {
    const out = doc('```\n[[alpha]]\n```');
    expect(out).not.toContain('data-doc');
  });

  it('escapes markup in the label', () => {
    expect(doc('[[a|<img src=x>]]')).not.toContain('<img');
  });
});

describe('relative link resolution', () => {
  it('resolves a sibling link against the current directory', () => {
    // MEMORY.md sits at the source root, so its links resolve without a prefix.
    expect(doc('[x](./rules.md)', docDirOf('MEMORY.md'))).toContain('data-doc="path:rules.md"');
    expect(doc('[x](./rules.md)', docDirOf('memory/daily.md'))).toContain('data-doc="path:memory/rules.md"');
  });

  it('resolves a parent-directory link', () => {
    expect(doc('[x](../foo.md)', 'memory/job-search')).toContain('data-doc="path:memory/foo.md"');
  });

  it('renders a link that escapes the source root as plain text', () => {
    const out = doc('[secret](../../../etc/passwd.md)', 'memory');
    expect(out).not.toContain('data-doc');
    expect(out).toContain('secret');
  });

  it('renders non-markdown targets as plain text', () => {
    const out = doc('[notes](notes.txt)', 'memory');
    expect(out).not.toContain('data-doc');
    expect(out).toContain('notes');
  });

  it('marks links to unknown documents as broken', () => {
    expect(doc('[x](rules.md)', 'memory', new Set(['memory/other.md']))).toContain('doc-link-broken');
    expect(doc('[x](rules.md)', 'memory', new Set(['memory/rules.md']))).not.toContain('doc-link-broken');
  });
});

describe('resolveRelDocPath', () => {
  it('normalizes . and .. segments', () => {
    expect(resolveRelDocPath('memory', './a.md')).toBe('memory/a.md');
    expect(resolveRelDocPath('memory/job-search', '../a.md')).toBe('memory/a.md');
    expect(resolveRelDocPath('memory', 'nested/../a.md')).toBe('memory/a.md');
  });

  it('treats a leading slash as source-relative, not filesystem-absolute', () => {
    expect(resolveRelDocPath('memory', '/MEMORY.md')).toBe('MEMORY.md');
  });

  it('strips fragments and decodes percent-escapes', () => {
    expect(resolveRelDocPath('memory', 'a.md#section')).toBe('memory/a.md');
    expect(resolveRelDocPath('', 'my%20doc.md')).toBe('my doc.md');
  });

  it('returns null for escapes, schemes, and non-markdown', () => {
    expect(resolveRelDocPath('memory', '../../etc/passwd.md')).toBeNull();
    expect(resolveRelDocPath('', 'https://example.com/a.md')).toBeNull();
    expect(resolveRelDocPath('', 'mailto:a@b.com')).toBeNull();
    expect(resolveRelDocPath('memory', 'a.txt')).toBeNull();
    expect(resolveRelDocPath('memory', '')).toBeNull();
  });
});

describe('docDirOf', () => {
  it('returns the directory portion, empty at the root', () => {
    expect(docDirOf('MEMORY.md')).toBe('');
    expect(docDirOf('memory/a.md')).toBe('memory');
    expect(docDirOf('memory/job-search/a.md')).toBe('memory/job-search');
  });
});

describe('line-break handling', () => {
  it('keeps hard breaks in chat but not in documents', () => {
    expect(renderMarkdown('a\nb')).toContain('<br>');
    expect(doc('a\nb')).not.toContain('<br>');
  });
});
