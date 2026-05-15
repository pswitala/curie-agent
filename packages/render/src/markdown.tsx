import React, { useMemo, type ReactNode } from 'react';
import { Box, Text } from 'ink';
import { lexer } from 'marked';

interface MarkdownProps {
  value: string;
  foreground?: string;
}

function Inline({ nodes }: { nodes: unknown[] }) {
  const parts: ReactNode[] = [];
  let i = 0;
  for (const item of nodes) {
    const n = item as Record<string, unknown>;
    if (n.type === 'text') {
      parts.push(String(n.text ?? ''));
    } else if (n.type === 'strong') {
      const childNodes = (n.tokens ?? []) as unknown[];
      parts.push(<Text bold key={i}>{Inline({ nodes: childNodes })}</Text>);
    } else if (n.type === 'em') {
      const childNodes = (n.tokens ?? []) as unknown[];
      parts.push(<Text key={i}>{Inline({ nodes: childNodes })}</Text>);
    } else if (n.type === 'codespan') {
      parts.push(
        <Text key={i} backgroundColor="#2d2d2d" color="#e06c75">
          {String(n.text ?? '')}
        </Text>,
      );
    } else if (n.type === 'link') {
      const childNodes = (n.tokens ?? []) as unknown[];
      parts.push(
        <Text key={i} color="#7aa2f7">
          {Inline({ nodes: childNodes })}
        </Text>,
      );
    } else if (n.type === 'break' || n.type === 'br') {
      // Horizontal rule / line break — skip (handled by splitting text tokens)
    } else if (n.type === 'html' || n.type === 'inlineHTML') {
      // Skip raw HTML — no text to show
    } else if (n.type === 'del') {
      const childNodes = (n.tokens ?? []) as unknown[];
      parts.push(<Text key={i}>{Inline({ nodes: childNodes })}</Text>);
    } else if (n.type === 'image') {
      const alt = (n.alt as string) ?? '';
      parts.push(<Text key={i} color="#7aa2f7">[{alt}]</Text>);
    } else {
      const childNodes = (n.tokens as unknown[]) ?? [];
      if (childNodes.length > 0) {
        parts.push(<Text key={i}>{Inline({ nodes: childNodes })}</Text>);
      } else if (n.text != null && String(n.text).trim()) {
        parts.push(<Text key={i}>{String(n.text)}</Text>);
      }
    }
    i++;
  }
  return <>{parts}</>;
}

type BlockToken = { type: string } & Record<string, unknown>;

function flattenText(tokens: unknown[]): string {
  let result = '';
  for (const t of tokens as BlockToken[]) {
    if (t.type === 'text') {
      const childTokens = (t.tokens as BlockToken[]) ?? [];
      if (childTokens.length > 0) {
        result += flattenText(childTokens);
      } else {
        result += String(t.text ?? '');
      }
    } else if (t.type === 'strong' || t.type === 'em' || t.type === 'codespan' || t.type === 'del' || t.type === 'link') {
      result += flattenText((t.tokens as BlockToken[]) ?? []);
    } else if (t.type === 'br' || t.type === 'break') {
      result += '\n';
    } else {
      result += String(t.text ?? '');
    }
  }
  return result;
}

function extractRawText(tokens: unknown[]): string {
  return flattenText(tokens);
}

function renderListContent(token: BlockToken): ReactNode {
  // Handles block-level tokens inside list items (always 'text' type with nested inline tokens)
  if (token.type === 'text') {
    const childNodes = (token.tokens as unknown[]) ?? [];
    return childNodes.length > 0 ? <Inline nodes={childNodes} /> : String(token.text ?? '');
  }
  // For other token types inside list items, try inline rendering
  return <Inline nodes={[]} />;
}

function renderBlock(token: BlockToken, key: React.Key, fg: string): ReactNode {
  if (token.type === 'text') {
    // Block-level text token (e.g. inside list items) — use nested tokens for inline formatting
    const childNodes = token.tokens as unknown[] ?? [];
    const content: ReactNode = childNodes.length > 0
      ? <Inline nodes={childNodes} />
      : String(token.text ?? '');
    return (
      <Box key={key} flexDirection="column">
        <Text color={fg}>{content}</Text>
      </Box>
    );
  }

  if (token.type === 'paragraph') {
    const tokens = token.tokens as unknown[];
    // Extract raw text from tokens, split on \n, render each line separately
    const rawText = extractRawText(tokens);
    const lines = rawText.split('\n').filter(l => l !== '');
    return (
      <Box key={key} flexDirection="column" marginLeft={1} marginTop={1}>
        {lines.map((line, li) => (
          <Text key={li} color={fg}>{line}</Text>
        ))}
      </Box>
    );
  }

  if (token.type === 'code') {
    const lang = (token.lang as string) || '';
    const text = (token.text as string) ?? '';
    return (
      <Box key={key} flexDirection="column" marginLeft={1} marginTop={1}>
        <Box flexDirection="row" backgroundColor="#1a1b26" paddingX={1}>
          <Text color="#666">{lang || 'code'}</Text>
        </Box>
        <Box flexDirection="column" backgroundColor="#1a1b26" paddingX={1}>
          {text.split('\n').map((line: string, li: number) => (
            <Text key={li} color={fg}>{line}\n</Text>
          ))}
        </Box>
      </Box>
    );
  }

  if (token.type === 'codespan') {
    return (
      <Box key={key} flexDirection="column" marginLeft={1} marginTop={1}>
        <Text backgroundColor="#2d2d2d" color="#e06c75">{String(token.text ?? '')}</Text>
      </Box>
    );
  }

  if (token.type === 'blockquote') {
    const innerTokens = token.tokens as { type: string; tokens?: unknown[] }[];
    return (
      <Box key={key} flexDirection="column" marginLeft={1} marginTop={1} borderStyle="single" borderColor="#7aa2f7" paddingX={1}>
        {innerTokens.map((inner, j) => {
          if (inner.type === 'paragraph' && inner.tokens) {
            return (
              <Text key={j} color={fg}>
                <Inline nodes={inner.tokens} />
              </Text>
            );
          }
          return renderBlock(inner, `${key}-${j}`, fg);
        })}
      </Box>
    );
  }

  if (token.type === 'list') {
    const items = (token.items as { raw?: string; tokens?: BlockToken[]; task?: boolean; checked?: boolean }[]) || [];
    const lines = items.map((item) => {
      const prefix = item.task ? (item.checked ? '[x] ' : '[ ] ') : '- ';
      const content = flattenText(item.tokens as BlockToken[]);
      return prefix + content;
    }).join('\n');
    return (
      <Box key={key} flexDirection="column" marginLeft={1}>
        <Text color={fg}>{lines}</Text>
      </Box>
    );
  }

  if (token.type === 'heading') {
    const depth = (token.depth as number) ?? 1;
    const tokens = token.tokens as unknown[];
    const prefix = '#'.repeat(depth) + ' ';
    return (
      <Box key={key} flexDirection="column" marginLeft={1} marginTop={1}>
        <Text bold>{prefix}</Text>
        <Text bold color={fg}>
          <Inline nodes={tokens} />
        </Text>
      </Box>
    );
  }

  return null;
}

export function Markdown({ value, foreground = '#a9b1d6' }: MarkdownProps) {
  const trimmed = useMemo(() => value.trimEnd(), [value]);

  if (!trimmed) {
    return null;
  }

  const blocks = useMemo(() => {
    const tokens = lexer(trimmed);
    return tokens.map((token, i) => renderBlock(token as BlockToken, i, foreground));
  }, [trimmed, foreground]);

  return <>{blocks}</>;
}
