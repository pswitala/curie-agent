import { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import type { ThemeColors } from '../../render/src/themes.js';

interface KittIndicatorProps {
  active: boolean;
  theme?: ThemeColors;
  width?: number;
}

export function KittIndicator({ active, theme, width = 10 }: KittIndicatorProps) {
  const bg = theme?.background || '#1a1b26';
  const KITT_COLORS = ['#ff3333', '#e60000', '#990000', bg];
  const [head, setHead] = useState(0);
  const dirRef = useRef(1);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      setHead((h) => {
        const next = h + dirRef.current;
        if (next >= width - 1) {
          dirRef.current = -1;
          return width - 2;
        }
        if (next <= 0) {
          dirRef.current = 1;
          return 1;
        }
        return next;
      });
    }, 40);
    return () => clearInterval(id);
  }, [active, width]);

  if (!active) {
    return <Text backgroundColor={bg}>{' '.repeat(width)}</Text>;
  }

  const segments = [];
  for (let i = 0; i < width; i++) {
    const dist = Math.abs(i - head);
    const c = dist === 0
      ? KITT_COLORS[0]
      : KITT_COLORS[Math.min(dist, KITT_COLORS.length - 1)] || KITT_COLORS[3];
    segments.push(<Text key={i} color={c} backgroundColor={bg}>█</Text>);
  }

  return <Box backgroundColor={bg}>{segments}</Box>;
}
