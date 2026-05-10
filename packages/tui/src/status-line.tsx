import React from 'react';
import { Box, Text } from 'ink';
import type { ThemeColors } from '../../render/src/themes.js';

interface StatusLineProps {
  model: string;
  provider: string;
  approvalMode: string;
  effort?: string;
  inputTokens?: number;
  outputTokens?: number;
  theme?: ThemeColors;
}

function formatTokens(input?: number, output?: number): string {
  if (input !== undefined && output !== undefined) {
    return `${formatCount(input)} / ${formatCount(output)} tokens`;
  }
  return '';
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

export function StatusLine({
  model,
  approvalMode,
  effort,
  inputTokens,
  outputTokens,
  theme,
}: StatusLineProps) {
  const parts: Array<{ label: string; color: string }> = [
    { label: model, color: theme?.primary || '#7aa2f7' },
  ];

  if (effort) {
    parts.push({ label: effort, color: theme?.secondary || '#2ac3de' });
  }

  parts.push({ label: approvalMode, color: theme?.title || '#7aa2f7' });

  const tokens = formatTokens(inputTokens, outputTokens);
  if (tokens) {
    parts.push({ label: tokens, color: theme?.foreground || '#a9b1d6' });
  }

  return (
    <Box>
      {parts.map((part, i) => (
        <React.Fragment key={part.label}>
          {i > 0 && (
            <>
              <Text> </Text>
              <Text color={theme?.muted || '#565f89'}>·</Text>
              <Text> </Text>
            </>
          )}
          <Text color={part.color}>{part.label}</Text>
        </React.Fragment>
      ))}
    </Box>
  );
}
