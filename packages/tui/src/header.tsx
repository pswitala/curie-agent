import { Box, Text } from 'ink';
import type { ThemeColors } from '../../render/src/themes.js';

interface HeaderProps {
  theme?: ThemeColors;
}

export function Header({ theme }: HeaderProps) {
  const border = theme?.border || '#414868';

  return (
    <Box flexDirection="row" width="100%">
      <Box
        borderStyle="single"
        borderColor={border}
        paddingX={1}
        flexGrow={1}
        flexDirection="row"
      >
        <Box flexDirection="column" marginRight={2}>
          <Text bold color="cyan">{'████ █  █ ████ ████ █ ████     █   ████ ████ ██ █ █████'}</Text>
          <Text bold color="cyan">{'█    █  █ █ █  █ █  █ ██      ███  █ ▀█ █▀▀  ████   █  '}</Text>
          <Text bold color="cyan">{'████ ████ █  █ █  █ █ ████   █   █ ████ ████ █ ██   █  '}</Text>
          <Text bold color="cyan">{'OpenSource community project for free Agentic AI'}</Text>
        </Box>
      </Box>
    </Box>
  );
}
