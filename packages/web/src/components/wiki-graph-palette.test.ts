import { describe, it, expect } from 'vitest';
import { FALLBACK_THEME, hexToRgb } from '../lib/theme-colors.js';
import { buildPalette, categoryColor, PINNED, OVERFLOW_SLOTS } from './wiki-graph-palette.js';

const colors = FALLBACK_THEME;

describe('buildPalette', () => {
  it('gives the four known categories their pinned theme colours', () => {
    const palette = buildPalette(['concepts', 'entities', 'summaries', 'other'], colors);
    expect(palette.get('concepts')).toBe(colors['--red']);
    expect(palette.get('entities')).toBe(colors['--green']);
    expect(palette.get('summaries')).toBe(colors['--chart-1']);
    expect(palette.get('other')).toBe(colors['--b3']);
  });

  it('assigns red, green and blue to the three real categories', () => {
    const dominant = (hex: string): 'r' | 'g' | 'b' => {
      const [r, g, b] = hexToRgb(hex);
      if (r >= g && r >= b) return 'r';
      if (g >= b) return 'g';
      return 'b';
    };
    const palette = buildPalette(['concepts', 'entities', 'summaries'], colors);
    expect(dominant(palette.get('concepts')!)).toBe('r');
    expect(dominant(palette.get('entities')!)).toBe('g');
    expect(dominant(palette.get('summaries')!)).toBe('b');
  });

  it('pins case-insensitively', () => {
    expect(buildPalette(['Concepts'], colors).get('Concepts')).toBe(colors['--red']);
  });

  it('assigns unknown categories from the overflow ladder, alphabetically', () => {
    const palette = buildPalette(['zebra', 'apple', 'concepts'], colors);
    expect(palette.get('apple')).toBe(colors[OVERFLOW_SLOTS[0]!]);
    expect(palette.get('zebra')).toBe(colors[OVERFLOW_SLOTS[1]!]);
    expect(palette.get('concepts')).toBe(colors['--red']);
  });

  it('is deterministic regardless of input order', () => {
    const a = buildPalette(['zebra', 'apple', 'mango'], colors);
    const b = buildPalette(['mango', 'zebra', 'apple'], colors);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });

  it('never hands an overflow category a pinned colour', () => {
    const many = Array.from({ length: 20 }, (_, i) => `cat-${String(i).padStart(2, '0')}`);
    const palette = buildPalette([...many, 'concepts', 'entities'], colors);
    const pinnedColours = new Set(Object.values(PINNED).map(v => colors[v]));
    for (const category of many) {
      expect(pinnedColours.has(palette.get(category)!), category).toBe(false);
    }
  });

  it('cycles the ladder rather than dropping categories past its end', () => {
    const many = Array.from({ length: OVERFLOW_SLOTS.length + 3 }, (_, i) => `c${String(i).padStart(2, '0')}`);
    const palette = buildPalette(many, colors);
    expect(palette.size).toBe(many.length);
    expect(many.every(c => typeof palette.get(c) === 'string')).toBe(true);
  });

  it('returns an empty palette for no categories', () => {
    expect(buildPalette([], colors).size).toBe(0);
  });
});

describe('categoryColor', () => {
  it('resolves a known category', () => {
    const palette = buildPalette(['concepts'], colors);
    expect(categoryColor('concepts', palette, colors)).toBe(colors['--red']);
  });

  it('falls back to the "other" slot for a category not in the palette', () => {
    expect(categoryColor('nope', new Map(), colors)).toBe(colors['--b3']);
  });
});

describe('OVERFLOW_SLOTS', () => {
  it('does not reuse a pinned variable', () => {
    const pinnedVars = new Set(Object.values(PINNED));
    for (const slot of OVERFLOW_SLOTS) {
      expect(pinnedVars.has(slot), slot).toBe(false);
    }
  });
});
