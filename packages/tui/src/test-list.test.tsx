import { render } from 'ink-testing-library';
import React from 'react';
import { Box, Text } from 'ink';

test('list in single text', () => {
  const App = () => (
    <Box flexDirection="column">
      <Text>- item one\n- item two\n- item three</Text>
    </Box>
  );
  const { output } = render(<App />, { width: 80, height: 10 });
  console.log('Output:', JSON.stringify(output));
  expect(output).toContain('- item one');
});
