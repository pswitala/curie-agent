import React from 'react';
import { Box, Text } from 'ink';
import type { ThemeColors } from '../../render/src/themes.js';

export type TabId = 'stats' | 'assistant' | 'projects' | 'agents' | 'channels';

interface TabBarProps {
  active: TabId;
  theme?: ThemeColors;
}

export const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'assistant', label: 'Assistant' },
  { id: 'channels', label: 'Channels' },
  { id: 'stats', label: 'Stats' },
  { id: 'projects', label: 'Projects' },
  { id: 'agents', label: 'Agents' },
];

export const TAB_IDS: TabId[] = TABS.map(t => t.id);

export function TabBar({ active, theme }: TabBarProps) {
  const primary = theme?.primary || '#7aa2f7';
  const muted = theme?.muted || '#565f89';
  const border = theme?.border || '#414868';
  // Use the border color as an "elevated surface" tint for the active tab.
  const activeBg = border;

  return (
    <Box width="100%" borderStyle="single" borderColor={border} borderTop={false} paddingX={1}>
      {TABS.map((tab, i) => {
        const isActive = tab.id === active;
        return (
          <Box key={tab.id} flexGrow={1} justifyContent="center" marginRight={i < TABS.length - 1 ? 2 : 0}>
            {isActive ? (
              <Text bold color={primary} backgroundColor={activeBg}>
                {`  ${tab.label}  `}
              </Text>
            ) : (
              <Text color={muted}>{`  ${tab.label}  `}</Text>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
