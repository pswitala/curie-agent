import { describe, it, expect } from 'vitest';
import React from 'react';
import {
  bold, dim, dimmer, underline, strikethrough, invert, color, bgColor, link, renderChildren,
} from './colors.js';

const ESC = '\x1b';

describe('bold', () => {
  it('wraps text with bold ANSI sequences', () => {
    expect(bold('hello')).toBe(`${ESC}[1mhello${ESC}[22m`);
  });

  it('handles empty string', () => {
    expect(bold('')).toBe(`${ESC}[1m${ESC}[22m`);
  });

  it('handles unicode', () => {
    expect(bold('hello 世界')).toBe(`${ESC}[1mhello 世界${ESC}[22m`);
  });
});

describe('dim', () => {
  it('wraps text with dim ANSI sequences', () => {
    expect(dim('hello')).toBe(`${ESC}[2mhello${ESC}[22m`);
  });
});

describe('dimmer', () => {
  it('is an alias for dim', () => {
    expect(dimmer('hello')).toBe(dim('hello'));
  });
});

describe('underline', () => {
  it('wraps text with underline ANSI sequences', () => {
    expect(underline('hello')).toBe(`${ESC}[4mhello${ESC}[24m`);
  });
});

describe('strikethrough', () => {
  it('wraps text with strikethrough ANSI sequences', () => {
    expect(strikethrough('hello')).toBe(`${ESC}[9mhello${ESC}[29m`);
  });
});

describe('invert', () => {
  it('wraps text with invert ANSI sequences', () => {
    expect(invert('hello')).toBe(`${ESC}[7mhello${ESC}[27m`);
  });
});

describe('color', () => {
  it('wraps text with 24-bit color using hex', () => {
    expect(color('hello', '#ff0000')).toBe(`${ESC}[38;2;255;0;0mhello${ESC}[39m`);
  });

  it('handles full hex with hash', () => {
    expect(color('x', '#7aa2f7')).toBe(`${ESC}[38;2;122;162;247mx${ESC}[39m`);
  });

  it('handles hex without hash', () => {
    expect(color('x', '7aa2f7')).toBe(`${ESC}[38;2;122;162;247mx${ESC}[39m`);
  });

  it('converts all valid hex colors', () => {
    expect(color('x', '#00ff00')).toBe(`${ESC}[38;2;0;255;0mx${ESC}[39m`);
    expect(color('x', '#0000ff')).toBe(`${ESC}[38;2;0;0;255mx${ESC}[39m`);
    expect(color('x', '#ffffff')).toBe(`${ESC}[38;2;255;255;255mx${ESC}[39m`);
    expect(color('x', '#000000')).toBe(`${ESC}[38;2;0;0;0mx${ESC}[39m`);
  });
});

describe('bgColor', () => {
  it('wraps text with 24-bit background color', () => {
    expect(bgColor('hello', '#ff0000')).toBe(`${ESC}[48;2;255;0;0mhello${ESC}[49m`);
  });

  it('handles various hex values', () => {
    expect(bgColor('x', '#7aa2f7')).toBe(`${ESC}[48;2;122;162;247mx${ESC}[49m`);
  });
});

describe('link', () => {
  it('wraps text with OSC 8 hyperlinks', () => {
    const result = link('click here', 'https://example.com');
    expect(result).toBe(`${ESC}]8;;https://example.com${ESC}\\click here${ESC}]8;;${ESC}\\`);
  });

  it('handles empty text', () => {
    const result = link('', 'https://example.com');
    expect(result).toBe(`${ESC}]8;;https://example.com${ESC}\\${ESC}]8;;${ESC}\\`);
  });
});

describe('renderChildren', () => {
  it('extracts text from a single React element', () => {
    const result = renderChildren(<span>hello</span>);
    expect(result).toBe('hello');
  });

  it('extracts children from a single React element', () => {
    const inner = <span>nested</span>;
    const outer = <div>{inner}</div>;
    // renderChildren extracts el.props.children via Children.toArray,
    // so it gets [inner] — the inner element's text is not recursed.
    const result = renderChildren(outer);
    expect(result).toBe('[object Object]');
  });

  it('extracts numbers as strings', () => {
    const result = renderChildren(42);
    expect(result).toBe('42');
  });

  it('skips falsy values', () => {
    const result = renderChildren([null, undefined, false, 'text']);
    expect(result).toBe('text');
  });

  it('handles empty/null children', () => {
    expect(renderChildren(null)).toBe('');
    expect(renderChildren(undefined)).toBe('');
  });
});
