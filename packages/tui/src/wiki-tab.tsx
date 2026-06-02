import React from 'react';
import { Box, Text } from 'ink';
import type { ThemeColors } from '../../render/src/themes.js';

export interface WikiPageEntry {
  slug: string;
  title: string;
  category: string;
}

interface WikiTabProps {
  pages?: WikiPageEntry[];
  wikiPath?: string;
  theme?: ThemeColors;
  isActive: boolean;
}

export function WikiTab({ pages, wikiPath, theme, isActive }: WikiTabProps) {
  const primary = theme?.primary || '#7aa2f7';
  const muted = theme?.muted || '#565f89';
  const border = theme?.border || '#414868';
  const fg = theme?.foreground || '#a9b1d6';
  const gold = '#e0af68';

  if (!isActive) return null;

  const byCategory: Record<string, WikiPageEntry[]> = {};
  for (const p of pages ?? []) {
    const cat = p.category || 'other';
    (byCategory[cat] ??= []).push(p);
  }
  const categories = Object.entries(byCategory);
  const total = pages?.length ?? 0;

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={primary}>Wiki Knowledge Base</Text>
        {wikiPath && (
          <Text color={muted}>{`  ${wikiPath}`}</Text>
        )}
      </Box>

      <Box marginBottom={1} borderStyle="single" borderColor={border} paddingX={1} paddingY={0} flexDirection="column">
        {total === 0 ? (
          <Text color={muted}>No pages yet — initialize with: curie-agent wiki init</Text>
        ) : (
          <>
            <Text color={fg}>{`${total} page${total === 1 ? '' : 's'} across ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`}</Text>
            {categories.map(([cat, entries]) => (
              <Box key={cat}>
                <Text color={gold}>{`  ${cat}`}</Text>
                <Text color={muted}>{`  (${entries.length})`}</Text>
              </Box>
            ))}
          </>
        )}
      </Box>

      <Box>
        <Text color={muted}>{'  /wiki list  ·  /wiki search <q>  ·  /wiki lint  ·  /wiki status'}</Text>
      </Box>
    </Box>
  );
}
