import { Box, Text } from 'ink';
import type { TabId } from './tab-bar.js';
import type { ThemeColors } from '../../render/src/themes.js';
import { TABS } from './tab-bar.js';
import { KittIndicator } from './kitt-indicator.js';

interface FooterProps {
  status: string;
  mode: string;
  effort?: string;
  model?: string;
  project?: string;
  duration?: string;
  totalTokens?: number;
  costUsd?: number;
  activeTab?: TabId;
  theme?: ThemeColors;
  contextFillPct?: number;
  contextWarning?: string;
  contextWindowSize?: number;
  inputTokens?: number;
  outputTokens?: number;
}

function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatCtxSize(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

export function Footer({ status, mode, effort, model, project, duration, totalTokens, costUsd, activeTab, theme, contextFillPct = 0, contextWarning, contextWindowSize = 200_000, inputTokens = 0, outputTokens = 0 }: FooterProps) {
  const activeTabLabel = TABS.find(t => t.id === activeTab)?.label ?? 'Assistant';
  const primary = theme?.primary || '#7aa2f7';
  const muted = theme?.muted || '#565f89';
  const border = theme?.border || '#414868';
  const fg = theme?.foreground || '#a9b1d6';
  const warning = theme?.warning || '#e0af68';
  const ctxColor = contextFillPct >= 85 ? '#ef4444' : contextFillPct >= 50 ? warning : contextFillPct >= 25 ? primary : muted;

  return (
    <Box flexDirection="column" width="100%">
      <Box
        borderStyle="single"
        borderColor={border}
        paddingX={1}
        justifyContent="space-between"
      >
        <Box>
          <KittIndicator active={status !== 'idle'} theme={theme} />
          {model ? (
            <>
              <Text color={muted}>  |  </Text>
              <Text color={primary}>{model}</Text>
            </>
          ) : null}
        </Box>
        <Text color={fg}>
          <Text color={primary}>{activeTabLabel}</Text>{' '}
          <Text color={muted}>[Tab]</Text>
          <Text color={muted}>  |  </Text>
          <Text color={primary}>{mode}</Text>{' '}
          <Text color={muted}>[Ctrl+F]</Text>
          <Text color={muted}>  |  </Text>
          <Text color={primary}>{effort ?? 'auto'}</Text>{' '}
          <Text color={muted}>[Ctrl+E]</Text>
        </Text>
      </Box>
      <Box paddingX={1} justifyContent="space-between">
        {project ? (
          <Text color={fg}>
            <Text color={muted}>[{project}]</Text>
            {duration ? (
              <>
                {' '}<Text color={muted}>|</Text>{' '}
                <Text color={muted}>[{duration}]</Text>
              </>
            ) : null}
            {totalTokens != null ? (
              <>
                {' '}<Text color={muted}>|</Text>{' '}
                <Text color={muted}>{formatTokens(totalTokens)} tok | {formatCost(costUsd ?? 0)}</Text>
              </>
            ) : null}
            <>
              {' '}<Text color={muted}>|</Text>{' '}
              <Text color={ctxColor}>{`ctx ${formatCtxSize(inputTokens)}/${formatCtxSize(contextWindowSize)} (${contextFillPct}%)`}</Text>
            </>
            {contextWarning ? (
              <>
                {' '}<Text color={muted}>|</Text>{' '}
                <Text color={warning}>{contextWarning}</Text>
              </>
            ) : null}
          </Text>
        ) : null}
        <Text color={muted}>
          <Text color={fg}>/help</Text>{' '}
          <Text color={muted}>|</Text>{' '}
          <Text color={fg}>Esc</Text>
        </Text>
      </Box>
    </Box>
  );
}
