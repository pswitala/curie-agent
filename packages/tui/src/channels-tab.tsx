import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ThemeColors } from '../../render/src/themes.js';

export interface ChannelTabEntry {
  id: string;
  type: 'cli' | 'telegram';
  identifier: string;
  displayName: string;
  sessionId: string;
  messageCount: number;
  isActive: boolean;
}

interface ChannelsTabProps {
  channels: ChannelTabEntry[];
  theme?: ThemeColors;
  isActive: boolean;
  onSelectChannel?: (channelId: string) => void;
}

export function ChannelsTab({
  channels,
  theme,
  isActive,
  onSelectChannel,
}: ChannelsTabProps) {
  const primary = theme?.primary || '#7aa2f7';
  const muted = theme?.muted || '#565f89';
  const border = theme?.border || '#414868';
  const secondary = theme?.secondary || '#2ac3de';

  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((_, key) => {
    if (!isActive) return;

    if (key.downArrow) {
      setSelectedIndex(i => Math.min(channels.length - 1, i + 1));
      return;
    }
    if (key.upArrow) {
      setSelectedIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.return && channels.length > 0) {
      const channel = channels[selectedIndex];
      if (channel && onSelectChannel) onSelectChannel(channel.id);
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={primary} bold>{' Channels '}</Text>
      <Box flexDirection="column" marginTop={1}>
        {channels.length === 0 ? (
          <Text color={muted}>  No channels yet. Start chatting to create one.</Text>
        ) : (
          channels.map((ch, i) => {
            const isSelected = i === selectedIndex;
            const typeIcon = ch.type === 'cli' ? '◉' : '✉';
            const typeColor = ch.type === 'cli' ? primary : secondary;
            const nameColor = isSelected ? primary : muted;
            const prefix = isSelected ? '› ' : ch.isActive ? '▶ ' : '  ';

            return (
              <Box key={ch.id}>
                <Text color={isSelected ? primary : muted}>{prefix}</Text>
                <Text color={typeColor}>{typeIcon}</Text>
                <Text color={nameColor}>{` ${ch.displayName}`}</Text>
                <Text color={muted}>{` (${ch.messageCount} msgs)`}</Text>
              </Box>
            );
          })
        )}
      </Box>
      <Box marginTop={1}>
        <Text color={muted}>↑↓ navigate · Enter select</Text>
      </Box>
    </Box>
  );
}
