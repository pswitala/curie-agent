import { describe, it, expect } from 'vitest';
import { themes, getTheme } from './themes.js';

describe('themes', () => {
  it('contains at least the core themes', () => {
    expect(themes['tokyo-night']).toBeDefined();
    expect(themes.nord).toBeDefined();
    expect(themes.dracula).toBeDefined();
    expect(themes.solarized).toBeDefined();
    expect(themes.gruvbox).toBeDefined();
  });

  it('has at least 5 themes', () => {
    expect(Object.keys(themes).length).toBeGreaterThanOrEqual(5);
  });
});

describe('ThemeColors', () => {
  const baseKeys: (keyof ReturnType<typeof getTheme>)[] = [
    'primary', 'secondary', 'success', 'warning', 'error',
    'background', 'foreground', 'muted', 'border', 'title',
  ];

  for (const [name, theme] of Object.entries(themes)) {
    describe(`${name}`, () => {
      it('has all required color keys with valid hex values', () => {
        for (const key of baseKeys) {
          const val = theme[key];
          expect(val).toBeDefined();
          expect(typeof val).toBe('string');
          expect(val).toMatch(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        }
      });

      it('has valid userBackground and userForeground when defined', () => {
        if (theme.userBackground !== undefined) {
          expect(typeof theme.userBackground).toBe('string');
          expect(theme.userBackground).toMatch(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        }
        if (theme.userForeground !== undefined) {
          expect(typeof theme.userForeground).toBe('string');
          expect(theme.userForeground).toMatch(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        }
      });

      it('background and foreground are different', () => {
        expect(theme.background).not.toBe(theme.foreground);
      });
    });
  }
});

describe('getTheme', () => {
  it('returns the requested theme', () => {
    expect(getTheme('nord')).toBe(themes.nord);
    expect(getTheme('dracula')).toBe(themes.dracula);
  });

  it('returns tokyo-night as default for unknown theme names', () => {
    expect(getTheme('nonexistent')).toBe(themes['tokyo-night']);
    expect(getTheme('')).toBe(themes['tokyo-night']);
    expect(getTheme('asdf123')).toBe(themes['tokyo-night']);
  });

  it('returns the same reference for the same theme (memoized)', () => {
    const a = getTheme('tokyo-night');
    const b = getTheme('tokyo-night');
    expect(a).toBe(b);
  });
});

describe('theme uniqueness', () => {
  const entries = Object.entries(themes);

  it('no two themes share the same primary color', () => {
    const primaries = new Set(entries.map(([, t]) => t.primary));
    expect(primaries.size).toBe(entries.length);
  });

  it('no two themes share the same background color', () => {
    const backgrounds = new Set(entries.map(([, t]) => t.background));
    expect(backgrounds.size).toBe(entries.length);
  });
});
