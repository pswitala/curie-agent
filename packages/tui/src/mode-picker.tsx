import React from 'react';
import { Box, Text } from 'ink';
import type { ThemeColors } from '../../render/src/themes.js';

export const MODE_LEVELS = ['plan', 'edit', 'auto', 'yolo'] as const;
export type ModeLevel = typeof MODE_LEVELS[number];

interface ModePickerProps {
  selectedIndex: number;
  theme?: ThemeColors;
}

export function ModePicker({ selectedIndex, theme }: ModePickerProps) {
  const primary = theme?.primary || '#7aa2f7';
  const muted = theme?.muted || '#565f89';
  const border = theme?.border || '#414868';
  const fg = theme?.foreground || '#a9b1d6';
  const bg = theme?.background || '#1a1b26';

  const rowWidth = 22;
  const title = 'Approval mode';
  const hint = 'Tab · Enter save · Esc';

  const centered = (text: string, width: number) => {
    if (text.length >= width) return text.slice(0, width);
    const pad = width - text.length;
    const left = Math.floor(pad / 2);
    const right = pad - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  };

  return (
    <Box justifyContent="center" alignItems="center" flexGrow={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={primary}
        paddingX={1}
      >
        <Text bold color={primary} backgroundColor={bg}>
          {centered(title, rowWidth)}
        </Text>
        <Text backgroundColor={bg}>{' '.repeat(rowWidth)}</Text>
        {MODE_LEVELS.map((level, i) => {
          const isActive = i === selectedIndex;
          const marker = isActive ? ' › ' : '   ';
          const label = `${marker}${level}`;
          const padding = ' '.repeat(Math.max(0, rowWidth - label.length));
          return (
            <Text
              key={level}
              color={isActive ? primary : fg}
              backgroundColor={isActive ? border : bg}
              bold={isActive}
            >
              {label + padding}
            </Text>
          );
        })}
        <Text backgroundColor={bg}>{' '.repeat(rowWidth)}</Text>
        <Text color={muted} backgroundColor={bg}>
          {centered(hint, rowWidth)}
        </Text>
      </Box>
    </Box>
  );
}
