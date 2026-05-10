import React from 'react';
import { Box, Text, useApp } from 'ink';
import type { ThemeColors } from './themes.js';
import { color } from './colors.js';

interface PanelProps {
  title?: string;
  borderColor?: string;
  children: React.ReactNode;
  padding?: number;
  marginTop?: number;
  marginBottom?: number;
  theme?: ThemeColors;
}

export function Panel({
  title,
  borderColor,
  children,
  padding = 1,
  marginTop = 0,
  marginBottom = 0,
  theme,
}: PanelProps) {
  const app = useApp();
  const cols = ((app as any).stdout?.columns ?? process.stdout.columns) ?? 80;
  const borderC = borderColor ?? theme?.border ?? '';
  const w = cols - 2;

  const hChar = '─';
  const topChar = '╭';
  const botChar = '╰';
  const leftChar = '│';
  const rightChar = '│';

  const topLine = title
    ? `${topChar}${hChar}${' '.repeat(w - 2)}${botChar}`
    : `${topChar}${hChar.repeat(w)}${botChar}`;
  const botLine = `${topChar}${hChar.repeat(w)}${botChar}`;

  return (
    <Box>
      {marginTop > 0 && <Box height={marginTop} />}
      <Box>
        <Text color="cyan">{topLine}</Text>
        {title && (
          <Box>
            <Text color="cyan">{leftChar}</Text>
            <Text> </Text>
            <Text bold color="cyan">
              {title}
            </Text>
            <Text>
              {' '.repeat(w - title.length - 3)}
            </Text>
            <Text color="cyan">{rightChar}</Text>
          </Box>
        )}
      </Box>
      {padding > 0 && <Box height={padding}>
        <Text color="cyan">{leftChar}</Text>
        <Box flexGrow={1}>{children}</Box>
        <Text color="cyan">{rightChar}</Text>
      </Box>}
      <Box>
        <Text color="cyan">{botLine}</Text>
      </Box>
      {marginBottom > 0 && <Box height={marginBottom} />}
    </Box>
  );
}
