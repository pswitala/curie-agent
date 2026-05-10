import React from 'react';
import { Text } from 'ink';
import { color } from './colors.js';

interface ProgressProps {
  value: number;
  width?: number;
  label?: string;
  barChar?: string;
  emptyChar?: string;
  colorHex?: string;
}

export function Progress({
  value,
  width = 40,
  label,
  barChar = '█',
  emptyChar = '░',
  colorHex = '#7aa2f7',
}: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = barChar.repeat(filled) + emptyChar.repeat(empty);
  const pct = `${clamped}%`;
  const cBar = colorHex ? color(bar, colorHex) : bar;
  const parts = [label ? `${label} ` : '', cBar, ` ${pct}`];

  return (
    <Text>{parts.join('')}</Text>
  );
}
