import React, { useState, useEffect } from 'react';
import { Text } from 'ink';
import type { ThemeColors } from '../../render/src/themes.js';

interface WaitingDotProps {
  theme?: ThemeColors;
}

export function WaitingDot({ theme }: WaitingDotProps) {
  const [dot, setDot] = useState('.');
  const color = theme?.muted || '#565f89';

  useEffect(() => {
    const interval = setInterval(() => {
      setDot(prev => prev === '.' ? '..' : prev === '..' ? '...' : '.');
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return <Text color={color}>{dot}</Text>;
}
