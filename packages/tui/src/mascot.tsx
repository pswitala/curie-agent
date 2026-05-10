import React from 'react';
import { Text, Box } from 'ink';

export function MascotBanner() {
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">{'██  ██ ██████ █████  █████  ██████ █████      ████  ██████ ███████ ██ ██████'}</Text>
      <Text bold color="cyan">{'██████ ██  ██ ██▀▀██ ██▀▀██ ██▀▀▀  ██▀▀██    ██▀▀██ ██ ▀██ ██▀▀▀  ██████   ██'}</Text>
      <Text bold color="cyan">{'██  ██ ██████ ██     ██     ██████ ██  ██    ██  ██ ██████ ██████ ██ ▀██   ██'}</Text>
      <Text>{'\n  An open-source personal agent.\n'}</Text>
    </Box>
  );
}
