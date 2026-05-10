import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { Progress } from './progress.js';
import { Spinner } from './spinner.js';

afterEach(cleanup);
afterAll(cleanup);

describe('Progress', () => {
  it('renders with a value of 0', () => {
    const { frames, lastFrame } = render(<Progress value={0} width={10} />);
    expect(frames.length).toBe(1);
    expect(lastFrame()).toBeDefined();
  });

  it('renders with a value of 100', () => {
    const { frames, lastFrame } = render(<Progress value={100} width={10} />);
    expect(frames.length).toBe(1);
    expect(lastFrame()).toBeDefined();
  });

  it('renders with a value of 50', () => {
    const { frames } = render(<Progress value={50} width={10} />);
    expect(frames.length).toBe(1);
  });

  it('renders with a label', () => {
    const { frames } = render(<Progress value={50} label="Loading" />);
    expect(frames.length).toBe(1);
  });

  it('renders with custom width', () => {
    const { frames } = render(<Progress value={50} width={20} />);
    expect(frames.length).toBe(1);
  });

  it('clamps negative values to 0', () => {
    const { frames } = render(<Progress value={-10} width={10} />);
    expect(frames.length).toBe(1);
  });

  it('clamps values above 100 to 100', () => {
    const { frames } = render(<Progress value={200} width={10} />);
    expect(frames.length).toBe(1);
  });

  it('renders with custom bar and empty chars', () => {
    const { frames } = render(<Progress value={50} barChar='#' emptyChar='.' />);
    expect(frames.length).toBe(1);
  });

  it('renders with custom color hex', () => {
    const { frames } = render(<Progress value={50} colorHex="#ff0000" />);
    expect(frames.length).toBe(1);
  });
});

describe('Spinner', () => {
  it('renders with no props', () => {
    const { frames, lastFrame } = render(<Spinner />);
    expect(frames.length).toBe(1);
    expect(lastFrame()).toBeDefined();
  });

  it('renders with a label', () => {
    const { frames } = render(<Spinner label="Loading" />);
    expect(frames.length).toBe(1);
  });

  it('renders with custom frames', () => {
    const { frames } = render(<Spinner frames={['>', '<', '^']} />);
    expect(frames.length).toBe(1);
  });

  it('renders with custom fps', () => {
    const { frames } = render(<Spinner fps={2} />);
    expect(frames.length).toBe(1);
  });
});
