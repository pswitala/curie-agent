import React from 'react';
import { Box, Text } from 'ink';
import type { ThemeColors } from '../../render/src/themes.js';

function stringifyInput(input: Record<string, unknown>): string {
  if (!input || Object.keys(input).length === 0) return '';
  const entries = Object.entries(input);
  if (entries.length === 1) {
    const entry = entries[0];
    if (!entry) return '';
    const k = entry[0];
    const v = entry[1];
    const val = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
    return `${k}: ${val}`;
  }
  return entries.map(([k, v]) => {
    const val = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v);
    return `${k}: ${val}`;
  }).join('\n');
}

interface ApprovalPickerProps {
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
  selected: 'allow' | 'deny';
  theme?: ThemeColors;
}

export function ApprovalPicker({ toolName, input, reason, selected, theme }: ApprovalPickerProps) {
  const primary = theme?.primary || '#7aa2f7';
  const muted = theme?.muted || '#565f89';
  const border = theme?.border || '#414868';
  const fg = theme?.foreground || '#a9b1d6';
  const bg = theme?.background || '#1a1b26';
  const warning = theme?.warning || '#e0af68';

  const preview = stringifyInput(input);
  const truncated = preview.length > 80 ? preview.slice(0, 77) + '…' : preview;

  return (
    <Box justifyContent="center" alignItems="center" flexGrow={1}>
      <Box flexDirection="column" borderStyle="round" borderColor={warning} paddingX={1}>
        <Text bold color={warning} backgroundColor={bg}>{' Approval required '}</Text>
        <Text backgroundColor={bg}>{' '}</Text>
        <Text color={fg} backgroundColor={bg}>{`  ${toolName}(${truncated})  `}</Text>
        <Text color={muted} backgroundColor={bg}>{`  ${reason}  `}</Text>
        <Text backgroundColor={bg}>{' '}</Text>
        <Box backgroundColor={bg}>
          <Text color={selected === 'allow' ? primary : fg} backgroundColor={selected === 'allow' ? border : bg} bold={selected === 'allow'}>
            {selected === 'allow' ? ' › Allow ' : '   Allow '}
          </Text>
          <Text> </Text>
          <Text color={selected === 'deny' ? primary : fg} backgroundColor={selected === 'deny' ? border : bg} bold={selected === 'deny'}>
            {selected === 'deny' ? ' › Deny  ' : '   Deny  '}
          </Text>
        </Box>
        <Text backgroundColor={bg}>{' '}</Text>
        <Text color={muted} backgroundColor={bg}>{' y=allow · n=deny · Tab · Enter '}</Text>
      </Box>
    </Box>
  );
}
