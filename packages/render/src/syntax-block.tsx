import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { createHighlighter } from 'shiki';
import { color } from './colors.js';
import type { ThemeColors } from './themes.js';

const SHIKI_THEME_MAP: Record<string, string> = {
  'tokyo-night': 'tokyo-night',
  nord: 'nord',
  dracula: 'dracula',
  solarized: 'solarized-dark',
  gruvbox: 'gruvbox-dark',
};

let highlighterPromise: ReturnType<typeof createHighlighter> | null = null;

async function getHighlighter(theme: string) {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [theme],
      langs: ['typescript', 'javascript', 'python', 'rust', 'go', 'java', 'css', 'html', 'json', 'toml', 'yaml', 'markdown', 'bash', 'shell', 'sql'],
    });
  }
  return highlighterPromise;
}

interface SyntaxBlockProps {
  code: string;
  language: string;
  theme?: string;
  themeColors?: ThemeColors;
}

export function SyntaxBlock({
  code,
  language,
  theme = 'tokyo-night',
  themeColors,
}: SyntaxBlockProps) {
  const lines = useMemo(() => code.split('\n'), [code]);
  const borderColor = themeColors?.border || '#414868';
  const titleColor = themeColors?.title || '#7aa2f7';

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">╭</Text>
        <Text color="cyan">{'─'.repeat(Math.max(40, code.length > 0 ? Math.max(...lines.map((l) => l.length)) : 40) + 2)}</Text>
        <Text color="cyan">╮</Text>
      </Box>
      <Box>
        <Text color="cyan">│</Text>
        <Text> </Text>
        <Text color={titleColor}>{language}</Text>
        <Text>
          {' '.repeat(Math.max(30, code.length > 0 ? Math.max(...lines.map((l) => l.length)) : 30) - language.length)}
        </Text>
        <Text> </Text>
        <Text color="cyan">│</Text>
      </Box>
      <Box>
        <Text color="cyan">│</Text>
        <Text> </Text>
      </Box>
      {lines.map((line, i) => (
        <Box key={i}>
          <Text color="cyan">│</Text>
          <Text> </Text>
          <Text>{line}</Text>
          <Text>
            {' '.repeat(Math.max(1, 60 - line.length))}
          </Text>
          <Text> </Text>
          <Text color="cyan">│</Text>
        </Box>
      ))}
      <Box>
        <Text color="cyan">│</Text>
        <Text> </Text>
      </Box>
      <Box>
        <Text color="cyan">╰</Text>
        <Text color="cyan">{'─'.repeat(Math.max(40, code.length > 0 ? Math.max(...lines.map((l) => l.length)) : 40) + 2)}</Text>
        <Text color="cyan">╯</Text>
      </Box>
    </Box>
  );
}
