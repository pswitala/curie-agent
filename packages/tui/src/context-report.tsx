import React from 'react';
import { Box, Text } from 'ink';
import type { ThemeColors } from '@curie-agent/render';

/**
 * Terminal rendering of a `context-report` event.
 *
 * The daemon emits measurements, not markup. It used to emit a hand-written
 * HTML `<div>` with web CSS variables, which the browser rendered and the
 * terminal dropped entirely — `render/src/markdown.tsx` has no `html` branch.
 */

export interface ContextReportData {
  model: string;
  windowTokens: number;
  usedTokens: number;
  reservedOutput: number;
  breakdown: { label: string; tokens: number }[];
}

const BAR_WIDTH = 24;
const LABEL_WIDTH = 20;

export function formatCtxTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n));
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length);
}

function padLeft(s: string, w: number): string {
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}

export function ContextReport({ data, theme }: { data: ContextReportData; theme?: ThemeColors }) {
  const fg = theme?.foreground ?? '#a9b1d6';
  const muted = theme?.muted ?? '#565f89';
  const primary = theme?.primary ?? '#7aa2f7';
  const warning = theme?.warning ?? '#e0af68';

  const usable = Math.max(1, data.windowTokens - data.reservedOutput);
  const pct = Math.min(100, Math.round((data.usedTokens / usable) * 100));
  const filled = Math.round((pct / 100) * BAR_WIDTH);
  const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
  const barColor = pct >= 85 ? '#ef4444' : pct >= 50 ? warning : primary;

  // Rank by size so the component that actually filled the window reads first —
  // that ordering is the whole diagnostic value of the breakdown.
  const rows = [...data.breakdown].sort((a, b) => b.tokens - a.tokens).filter((r) => r.tokens > 0);
  const largest = rows[0]?.tokens ?? 0;

  return (
    <Box flexDirection="column" paddingX={1} marginY={1}>
      <Box>
        <Text bold color={primary}>Context Window</Text>
        <Text color={muted}>{`  ${data.model}`}</Text>
      </Box>
      <Box>
        <Text color={barColor}>{bar}</Text>
        <Text bold color={barColor}>{padLeft(`${String(pct)}%`, 6)}</Text>
        <Text color={muted}>
          {`  ${formatCtxTokens(data.usedTokens)} / ${formatCtxTokens(usable)} usable`}
          {`  (${formatCtxTokens(data.windowTokens)} window, ${formatCtxTokens(data.reservedOutput)} reserved)`}
        </Text>
      </Box>
      {rows.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {rows.map((r) => {
            const share = data.usedTokens > 0 ? Math.round((r.tokens / data.usedTokens) * 100) : 0;
            const width = largest > 0 ? Math.max(1, Math.round((r.tokens / largest) * 12)) : 0;
            return (
              <Box key={r.label}>
                <Text color={fg}>{padRight(r.label, LABEL_WIDTH)}</Text>
                <Text color={muted}>{padLeft(formatCtxTokens(r.tokens), 8)}</Text>
                <Text color={muted}>{padLeft(`${String(share)}%`, 6)}</Text>
                <Text color={primary}>{`  ${'▪'.repeat(width)}`}</Text>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
