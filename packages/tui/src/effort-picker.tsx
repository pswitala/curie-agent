import React from 'react';
import { Box, Text } from 'ink';
import type { ThemeColors } from '../../render/src/themes.js';

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'max', 'auto'] as const;
export type EffortLevel = typeof EFFORT_LEVELS[number];

interface EffortPickerProps {
  selectedIndex: number;
  theme?: ThemeColors;
}

export function EffortPicker({ selectedIndex, theme }: EffortPickerProps) {
  const primary = theme?.primary || '#7aa2f7';
  const muted = theme?.muted || '#565f89';
  const border = theme?.border || '#414868';
  const fg = theme?.foreground || '#a9b1d6';
  const bg = theme?.background || '#1a1b26';

  // Width of each row (content area inside the bordered panel).
  const rowWidth = 22;
  const title = 'Reasoning effort';
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
        {EFFORT_LEVELS.map((level, i) => {
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
