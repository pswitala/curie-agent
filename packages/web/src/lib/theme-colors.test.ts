import { describe, it, expect } from 'vitest';
import {
  THEME_VARS,
  FALLBACK_THEME,
  hexToRgb,
  luminance,
  mixHex,
  isLightTheme,
  readThemeColors,
  type ThemeColors,
} from './theme-colors.js';

describe('hexToRgb', () => {
  it('parses 6-digit hex with and without the hash', () => {
    expect(hexToRgb('#3987e5')).toEqual([0x39, 0x87, 0xe5]);
    expect(hexToRgb('3987e5')).toEqual([0x39, 0x87, 0xe5]);
  });

  it('expands 3-digit hex', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('#08f')).toEqual([0, 0x88, 255]);
  });

  it('parses rgb() and rgba(), which is what some browsers return for custom properties', () => {
    expect(hexToRgb('rgb(57, 135, 229)')).toEqual([57, 135, 229]);
    expect(hexToRgb('rgba(57, 135, 229, 0.5)')).toEqual([57, 135, 229]);
    expect(hexToRgb('rgb(57 135 229)')).toEqual([57, 135, 229]);
  });

  it('is case-insensitive and tolerates whitespace', () => {
    expect(hexToRgb('  #3987E5  ')).toEqual([0x39, 0x87, 0xe5]);
  });

  it('falls back to black rather than throwing on garbage', () => {
    expect(hexToRgb('not-a-colour')).toEqual([0, 0, 0]);
    expect(hexToRgb('')).toEqual([0, 0, 0]);
  });
});

describe('luminance', () => {
  it('spans 0..1 for black and white', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('orders the dark theme surfaces below the light one', () => {
    const black = luminance('#0a0a0a');   // [data-theme="black"] --s1
    const nord = luminance('#242933');    // [data-theme="nord"] --s1
    const white = luminance('#f1f1f1');   // [data-theme="white"] --s1
    expect(black).toBeLessThan(nord);
    expect(nord).toBeLessThan(white);
    expect(white).toBeGreaterThan(0.5);
    expect(nord).toBeLessThan(0.5);
  });
});

describe('mixHex', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('blends the midpoint', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('clamps t outside 0..1', () => {
    expect(mixHex('#000000', '#ffffff', -3)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 42)).toBe('#ffffff');
  });

  it('always emits 6-digit hex, including for single-digit channels', () => {
    expect(mixHex('#000000', '#0f0f0f', 0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('isLightTheme', () => {
  const withS1 = (s1: string): ThemeColors => ({ ...FALLBACK_THEME, '--s1': s1 });

  it('detects the white theme and rejects the dark ones', () => {
    expect(isLightTheme(withS1('#f1f1f1'))).toBe(true);
    expect(isLightTheme(withS1('#0a0a0a'))).toBe(false);
    expect(isLightTheme(withS1('#242933'))).toBe(false);
    expect(isLightTheme(FALLBACK_THEME)).toBe(false);
  });
});

describe('FALLBACK_THEME', () => {
  it('defines every variable the renderer can ask for', () => {
    for (const name of THEME_VARS) {
      expect(FALLBACK_THEME[name], name).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('readThemeColors', () => {
  it('returns the fallback set when there is no document (vitest node env)', () => {
    expect(readThemeColors()).toEqual(FALLBACK_THEME);
  });

  it('returns a copy, so callers cannot corrupt the fallback', () => {
    const first = readThemeColors();
    first['--gold'] = '#000000';
    expect(FALLBACK_THEME['--gold']).not.toBe('#000000');
  });
});
