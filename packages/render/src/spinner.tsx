import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

interface SpinnerProps {
  label?: string;
  frames?: string[];
  fps?: number;
}

export function Spinner({
  label,
  frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  fps = 8,
}: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 1000 / fps);
    return () => clearInterval(interval);
  }, [frames, fps]);

  return (
    <Text>
      <Text color="cyan">{frames[frame]}</Text>
      {label ? ` ${label}` : ''}
    </Text>
  );
}
