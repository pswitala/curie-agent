import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { Markdown } from './markdown.js';

afterEach(cleanup);

describe('Markdown list rendering', () => {
  it('renders compact list without extra breaks', () => {
    const md = `- P1: Call Marta\n- P2: Victrix firing pin\n- P3: Oskar birthday`;
    const { frames, lastFrame } = render(<Markdown value={md} />, { width: 80, height: 10 });
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const output = lastFrame() ?? '';
    console.log('Output:', JSON.stringify(output));
    expect(output).toContain('- P1: Call Marta');
    expect(output).toContain('- P2: Victrix firing pin');
    expect(output).toContain('- P3: Oskar birthday');
    // No blank lines between items — each item on consecutive lines
    const lines = output.split('\n').filter(l => l.trim() === '');
    console.log('Blank lines:', lines.length);
    expect(lines.length).toBeLessThanOrEqual(1);
  });

  it('handles dash on separate line', () => {
    const md = '-\n  AI Solution Architect';
    const { frames, lastFrame } = render(<Markdown value={md} />, { width: 80, height: 10 });
    expect(frames.length).toBeGreaterThanOrEqual(1);
    const output = lastFrame() ?? '';
    console.log('Dash-separate:', JSON.stringify(output));
    expect(output).toContain('AI Solution Architect');
  });
});
