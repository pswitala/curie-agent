/**
 * Resolves theme CSS variables to concrete colour values.
 *
 * `charts/colors.ts` hands `'var(--chart-N)'` strings straight to the DOM, which
 * is all a chart needs. WebGL can't do that — three.js parses colours itself and
 * has no idea what a custom property is — so anything rendered on a canvas has
 * to read the *computed* value off the document element instead.
 */

export const THEME_VARS = [
  '--bg', '--s1', '--s2', '--s3',
  '--b1', '--b2', '--b3',
  '--fg', '--text2', '--muted', '--muted2',
  '--green', '--yellow', '--red', '--gold', '--cream', '--wood-light',
] as const;

export type ThemeVar = (typeof THEME_VARS)[number];
export type ThemeColors = Record<ThemeVar, string>;

/**
 * The `:root` (curie) block from index.css. Used per-key whenever
 * `getComputedStyle` yields nothing — during SSR-less first paint, and under
 * vitest's `node` environment where there is no document at all.
 */
export const FALLBACK_THEME: ThemeColors = {
  '--bg': '#1a1410',
  '--s1': '#14100c',
  '--s2': '#221c16',
  '--s3': '#2e261e',
  '--b1': '#3d3328',
  '--b2': '#56483a',
  '--b3': '#8b7355',
  '--fg': '#f5e6d0',
  '--text2': '#bfae94',
  '--muted': '#8b7355',
  '--muted2': '#56483a',
  '--green': '#a3be8c',
  '--yellow': '#e8c170',
  '--red': '#c76d5e',
  '--gold': '#d4a54a',
  '--cream': '#f5e6d0',
  '--wood-light': '#5c4530',
};

/**
 * Parse a CSS colour to an RGB triple. Handles 3- and 6-digit hex plus
 * `rgb()`/`rgba()`, because `getPropertyValue` normalisation differs between
 * browsers — Chrome hands back the authored hex, others resolve to `rgb()`.
 * Unparseable input yields black rather than throwing; a wrong colour is a
 * cosmetic bug, an exception mid-render is a blank canvas.
 */
export function hexToRgb(value: string): [number, number, number] {
  const v = value.trim();

  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v);
  if (fn) {
    return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  }

  const hex = v.startsWith('#') ? v.slice(1) : v;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return [
      parseInt(hex[0]! + hex[0]!, 16),
      parseInt(hex[1]! + hex[1]!, 16),
      parseInt(hex[2]! + hex[2]!, 16),
    ];
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  return [0, 0, 0];
}

function toHex(n: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(n)));
  return clamped.toString(16).padStart(2, '0');
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(value: string): number {
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = hexToRgb(value);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Linear blend in sRGB space. `t = 0` returns `a`, `t = 1` returns `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return `#${toHex(ar + (br - ar) * k)}${toHex(ag + (bg - ag) * k)}${toHex(ab + (bb - ab) * k)}`;
}

/** `[data-theme="white"]` is currently the only light theme, but detect by
 *  luminance rather than by name so a future light theme works for free. */
export function isLightTheme(colors: ThemeColors): boolean {
  return luminance(colors['--s1']) > 0.5;
}

export function readThemeColors(el?: HTMLElement): ThemeColors {
  const root = el ?? (typeof document === 'undefined' ? null : document.documentElement);
  if (!root || typeof getComputedStyle !== 'function') return { ...FALLBACK_THEME };

  const computed = getComputedStyle(root);
  const out = {} as ThemeColors;
  for (const name of THEME_VARS) {
    const value = computed.getPropertyValue(name).trim();
    out[name] = value === '' ? FALLBACK_THEME[name] : value;
  }
  return out;
}
