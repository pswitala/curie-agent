import React from 'react';
import { Box, Text } from 'ink';

interface Column {
  header: string;
  key: string;
  width?: number;
}

interface TableProps<T extends Record<string, unknown>> {
  columns: Column[];
  rows: T[];
  border?: boolean;
  align?: 'left' | 'right' | 'center';
}

function pad(str: string, width: number, align: 'left' | 'right' | 'center'): string {
  const len = Math.min(str.length, width);
  const padded = str.slice(0, width);
  const rem = width - padded.length;
  if (align === 'right') return ' '.repeat(rem) + padded;
  if (align === 'center') return ' '.repeat(Math.floor(rem / 2)) + padded + ' '.repeat(rem - Math.floor(rem / 2));
  return padded + ' '.repeat(rem);
}

export function Table<T extends Record<string, unknown>>({
  columns,
  rows,
  border = true,
  align = 'left',
}: TableProps<T>) {
  const widths = columns.map((col) => {
    if (col.width) return col.width;
    let max = col.header.length;
    for (const row of rows) {
      const v = String(row[col.key] ?? '');
      if (v.length > max) max = v.length;
    }
    return Math.min(max, 60);
  });

  const headerCells = columns.map((c, i) => pad(c.header, widths[i]!, align)).join(' ');
  const separator = widths.map((w) => '─'.repeat(w!)).join('─');

  return (
    <Box flexDirection="column">
      <Text bold>{headerCells}</Text>
      {border && <Text dimColor>{separator}</Text>}
      {rows.map((row, idx) => {
        const cells = columns.map((c, i) => pad(String(row[c.key] ?? ''), widths[i] ?? 10, align)).join(' ');
        return (
          <Box key={idx}>
            <Text>{cells}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
