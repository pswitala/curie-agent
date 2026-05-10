import React from 'react';
import { Box, Text } from 'ink';
import { color, bold } from './colors.js';

interface Frame {
  file: string;
  line: number;
  column: number;
  function?: string;
}

interface TracebackProps {
  error: string;
  frames: Frame[];
  cause?: string;
}

export function Traceback({ error, frames, cause }: TracebackProps) {
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color="red">{bold('Error')}</Text>
        <Text color="red">{`: ${error}`}</Text>
      </Box>
      {cause && (
        <Box>
          <Text dimColor>{`  caused by: ${cause}`}</Text>
        </Box>
      )}
      {frames.map((frame, i) => (
        <Box key={i}>
          <Text dimColor>{`  at `}</Text>
          {frame.function && <Text color="magenta">{`${frame.function} (`}</Text>}
          <Text color="cyan">{`${frame.file}`}</Text>
          <Text color="yellow">{`:${frame.line}:${frame.column}`}</Text>
          {frame.function && <Text color="magenta">{`)`}</Text>}
        </Box>
      ))}
    </Box>
  );
}
