import React, { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { loadStatsData, type StatsData } from './stats-data.js';
import type { ThemeColors } from '../../render/src/themes.js';

interface StatsTabProps {
  theme?: ThemeColors;
  isActive: boolean;
  /** Current model name. */
  model?: string;
  /** Total input tokens (system prompt + history + tools). */
  inputTokens?: number;
  /** Total output tokens (model response). */
  outputTokens?: number;
  /** Cached input tokens (subset of inputTokens), when the provider reports them. */
  cacheReadTokens?: number;
  /** Model's context window size in tokens (default 200k). */
  contextWindowSize?: number;
}

const CHART_ROWS = 6;
const BAR_WIDTH = 25;
const MODEL_NAME_WIDTH = 22;
const PARTIAL_BLOCKS = ['', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

function formatK(n: number): string {
  if (n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function padRight(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

function padLeft(s: string, n: number): string {
  if (s.length >= n) return s;
  return ' '.repeat(n - s.length) + s;
}

export function StatsTab({ theme, isActive, model, inputTokens, outputTokens, cacheReadTokens, contextWindowSize }: StatsTabProps) {
  const primary = theme?.primary || '#7aa2f7';
  const muted = theme?.muted || '#565f89';
  const fg = theme?.foreground || '#a9b1d6';

  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 100;

  const [data, setData] = useState<StatsData | null>(null);

  useEffect(() => {
    if (isActive) setData(loadStatsData());
  }, [isActive]);

  if (!data) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text color={muted}>Loading stats…</Text>
      </Box>
    );
  }

  if (data.totalSessions === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text color={muted}>No session history yet. Start a conversation to populate the stats.</Text>
      </Box>
    );
  }

  const totals = data.tokensPerDay.map(d => d.input + d.output);
  const maxTokens = Math.max(1, ...totals);
  const yAxisLabels: string[] = [];
  for (let r = CHART_ROWS; r >= 0; r--) {
    yAxisLabels.push(padLeft(formatK(Math.round((maxTokens * r) / CHART_ROWS)), 5));
  }
  const yLabelWidth = 5;

  const renderBarCell = (value: number, row: number): string => {
    // row is 0..CHART_ROWS-1, counted from bottom.
    const rowsFilled = (value / maxTokens) * CHART_ROWS;
    const fullRows = Math.floor(rowsFilled);
    if (row < fullRows) return '█';
    if (row === fullRows) {
      const frac = rowsFilled - fullRows;
      const step = Math.round(frac * 8);
      return PARTIAL_BLOCKS[step] ?? '';
    }
    return ' ';
  };

  const xFirst = data.tokensPerDay[0]?.date ?? '';
  const xLast = data.tokensPerDay[data.tokensPerDay.length - 1]?.date ?? '';
  const chartInnerWidth = data.tokensPerDay.length * 2 - 1; // bar + space
  const maxModelCount = Math.max(1, ...data.modelUsage.map(m => m.turns));

  // Context window inline data
  const windowSize = contextWindowSize ?? 200_000;
  const ctxInput = inputTokens ?? 0;
  const ctxOutput = outputTokens ?? 0;
  const ctxPct = ctxInput > 0 ? Math.min(100, Math.round((ctxInput / windowSize) * 100)) : 0;
  const ctxFilled = Math.round((ctxPct / 100) * 24);
  const ctxBar = '█'.repeat(ctxFilled) + '░'.repeat(24 - ctxFilled);
  const ctxFmt = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
    return String(n);
  };
  const ctxModel = model || 'unknown';
  const ctxLabel = ' ' + padLeft(`${ctxPct}%`, 12) + `(${ctxFmt(ctxInput)}/${ctxFmt(windowSize)})`;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      {/* Context Window Section */}
      <Box marginBottom={1}>
        <Text color={primary} bold>Context Window</Text>
      </Box>
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text color={fg}>{padRight(ctxModel, 24)}</Text>
          <Text color={primary}>{ctxBar}</Text>
          <Text color={muted}>{ctxLabel}</Text>
        </Box>
        {ctxInput > 0 && ctxOutput > 0 && (
          <Box>
            <Text color={muted}>
              {'  └─ '}{ctxFmt(ctxInput)} in / {ctxFmt(ctxOutput)} out
              {cacheReadTokens && cacheReadTokens > 0 ? ` (${ctxFmt(cacheReadTokens)} cached)` : ''}
            </Text>
          </Box>
        )}
        {ctxInput === 0 && (
          <Box>
            <Text color={muted}>No context data yet. Start a conversation to see fill level.</Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1} marginBottom={1}>
        <Text color={primary} bold>Tokens per day (last 14 days)</Text>
      </Box>

      {/* Chart body: Y-axis label + bars row by row, top to bottom. */}
      {Array.from({ length: CHART_ROWS }, (_, i) => {
        const row = CHART_ROWS - 1 - i;
        const label = padLeft(formatK(Math.round((maxTokens * (row + 1)) / CHART_ROWS)), yLabelWidth);
        return (
          <Box key={`r${row}`}>
            <Text color={muted}>{label + ' │ '}</Text>
            <Text color={primary}>
              {data.tokensPerDay.map(d => renderBarCell(d.input + d.output, row)).join(' ')}
            </Text>
          </Box>
        );
      })}
      <Box>
        <Text color={muted}>{padLeft('0', yLabelWidth) + ' └' + '─'.repeat(Math.max(2, chartInnerWidth + 1))}</Text>
      </Box>
      <Box>
        <Text color={muted}>
          {' '.repeat(yLabelWidth + 3)}
          {padRight(xFirst, Math.max(10, chartInnerWidth - xLast.length))}
          {xLast}
        </Text>
      </Box>

      <Box marginTop={1} marginBottom={1}>
        <Text color={primary} bold>Model usage (most → least)</Text>
      </Box>

      {data.modelUsage.length === 0 ? (
        <Text color={muted}>No model data.</Text>
      ) : (
        data.modelUsage.map(m => {
          const filled = Math.max(1, Math.round((m.turns / maxModelCount) * BAR_WIDTH));
          const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
          return (
            <Box key={m.model}>
              <Text color={fg}>{padRight(m.model, MODEL_NAME_WIDTH) + '  '}</Text>
              <Text color={primary}>{bar}</Text>
              <Text color={muted}>{'  ' + padLeft(String(m.turns), 4)}</Text>
            </Box>
          );
        })
      )}

      {data.modelUsage.some(m => m.tokens > 0) && (
        <>
          <Box marginTop={1} marginBottom={1}>
            <Text color={primary} bold>Model tokens (total)</Text>
          </Box>
          {data.modelUsage
            .filter(m => m.tokens > 0)
            .map(m => {
              const totalTokens = data.modelUsage.reduce((sum, x) => sum + x.tokens, 0);
              const pct = totalTokens > 0 ? Math.round((m.tokens / totalTokens) * 100) : 0;
              const filled = Math.max(1, Math.round((m.tokens / Math.max(1, ...data.modelUsage.map(x => x.tokens))) * BAR_WIDTH));
              const bar = '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled);
              return (
                <Box key={`tok-${m.model}`}>
                  <Text color={fg}>{padRight(m.model, MODEL_NAME_WIDTH) + '  '}</Text>
                  <Text color={primary}>{bar}</Text>
                  <Text color={muted}>{'  ' + padLeft(`${pct}%`, 4) + ' ' + padLeft(formatK(m.tokens), 8)}</Text>
                </Box>
              );
            })
          }
        </>
      )}

      {cols < 70 && (
        <Box marginTop={1}>
          <Text color={muted}>(widen terminal for better chart layout)</Text>
        </Box>
      )}
    </Box>
  );
}
