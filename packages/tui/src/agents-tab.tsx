import React from 'react';
import { Box, Text, useStdout } from 'ink';
import type { ThemeColors } from '../../render/src/themes.js';

export interface AgentEntry {
  id: string;
  prompt: string;
  output: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  startedAt: number;
  doneAt?: number;
}

interface AgentsTabProps {
  agents: Map<string, AgentEntry>;
  isActive: boolean;
  theme?: ThemeColors;
}

const MAX_OUTPUT_LINES = 20;

export function AgentsTab({ agents, theme }: AgentsTabProps) {
  const primary = theme?.primary || '#7aa2f7';
  const muted = theme?.muted || '#565f89';
  const fg = theme?.foreground || '#a9b1d6';
  const runningColor = theme?.primary || '#7aa2f7';
  const completedColor = theme?.success || '#9ece6a';
  const errorColor = theme?.error || '#f7768e';

  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 100;

  const agentArray = Array.from(agents.entries());

  if (agentArray.length === 0) {
    return (
      <Box paddingX={1} paddingY={1}>
        <Text color={muted}>No active agents. Use /agent &lt;prompt&gt; to launch one.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text color={primary} bold>Agents</Text>
      <Box borderBottom borderColor={muted} marginTop={1} marginBottom={1} />

      {agentArray.map(([id, agent]) => {
        const statusColor =
          agent.status === 'running' ? runningColor :
          agent.status === 'completed' ? completedColor :
          errorColor;

        const statusText =
          agent.status === 'running' ? 'running' :
          agent.status === 'completed' ? 'done' :
          agent.status === 'cancelled' ? 'cancelled' :
          'error';

        const promptTruncated = agent.prompt.length > cols - 30 ? agent.prompt.slice(0, cols - 33) + '...' : agent.prompt;

        // Split output into lines and trim to last MAX_OUTPUT_LINES
        const outputLines = agent.output.split('\n').filter(Boolean);
        const visibleLines = outputLines.slice(-MAX_OUTPUT_LINES);
        const hasMore = outputLines.length > MAX_OUTPUT_LINES;

        const elapsedMs = agent.doneAt ? (agent.doneAt - agent.startedAt) : (Date.now() - agent.startedAt);
        const elapsed = formatDuration(elapsedMs);
        const tokenTotal = agent.inputTokens + agent.outputTokens;

        return (
          <Box key={id} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={statusColor} bold>
                [{statusText}]
              </Text>
              <Text color={fg}> Agent: {promptTruncated}</Text>
            </Box>
            <Box marginTop={0}>
              <Text color={muted}>
                {elapsed} · {agent.toolCalls} tools{tokenTotal > 0 ? ` · ${(tokenTotal / 1000).toFixed(1)}k tok` : ''}
              </Text>
            </Box>
            {visibleLines.length > 0 && (
              <Box flexDirection="column" paddingX={1}>
                {hasMore && (
                  <Text color={muted}>
                    ... ({outputLines.length - MAX_OUTPUT_LINES} more lines)
                  </Text>
                )}
                {visibleLines.map((line, i) => (
                  <Text key={i} color={muted} wrap="truncate">
                    {line}
                  </Text>
                ))}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSec = secs % 60;
  return `${mins}m${remainSec}s`;
}
