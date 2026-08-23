import { mixHex, type ThemeColors, type ThemeVar } from '../lib/theme-colors.js';

/**
 * Maps wiki categories onto the active theme's semantic colours.
 *
 * The semantic set only carries three real hues (`--red`, `--green`, `--gold`)
 * plus neutrals, so the four known categories get pinned slots and anything
 * beyond them falls back to progressively less saturated neutrals. `--yellow`
 * sits last in the overflow ladder because it is byte-identical to `--gold` in
 * seven of the nine themes.
 */

/** Pinned so a user's mental map of the graph survives a theme switch. */
export const PINNED: Record<string, ThemeVar> = {
  concepts: '--red',
  entities: '--green',
  summaries: '--gold',
  other: '--b3',
};

export const OVERFLOW_SLOTS: readonly ThemeVar[] = [
  '--wood-light', '--text2', '--muted', '--muted2', '--yellow',
];

/**
 * Category -> concrete colour. Overflow categories are assigned alphabetically
 * so the mapping is stable across renders and across sessions.
 *
 * Deduplication happens on *resolved* values, not on variable names, because
 * several themes alias distinct variables to the same colour — `--muted` equals
 * `--b3` in curie, and `--yellow` equals `--gold` in seven of the nine themes.
 * Assigning by name alone would silently hand an overflow category the same
 * colour as a pinned one.
 */
export function buildPalette(categories: string[], colors: ThemeColors): Map<string, string> {
  const palette = new Map<string, string>();
  const overflow: string[] = [];

  // Reserve every pinned colour, not just the ones present in this graph, so a
  // given colour never means "entities" in one wiki and "notes" in another.
  const used = new Set(Object.values(PINNED).map(v => colors[v].toLowerCase()));

  for (const category of categories) {
    const pinned = PINNED[category.toLowerCase()];
    if (pinned) palette.set(category, colors[pinned]);
    else overflow.push(category);
  }

  const candidates = OVERFLOW_SLOTS
    .map(slot => colors[slot])
    .filter(color => {
      const key = color.toLowerCase();
      if (used.has(key)) return false;
      used.add(key);
      return true;
    });

  overflow.sort();
  overflow.forEach((category, i) => {
    if (candidates.length === 0) {
      // Every neutral in this theme collided with a pinned hue. Walk away from
      // the foreground colour so repeats stay tellable apart.
      palette.set(category, mixHex(colors['--fg'], colors['--s1'], (i % 5) * 0.18));
      return;
    }
    const base = candidates[i % candidates.length]!;
    // Past the end of the ladder, darken each successive lap so a large wiki
    // still gets distinguishable colours instead of exact repeats.
    const lap = Math.floor(i / candidates.length);
    palette.set(category, lap === 0 ? base : mixHex(base, colors['--s1'], Math.min(0.6, lap * 0.22)));
  });

  return palette;
}

/** Colour for a category, falling back to the `other` slot. */
export function categoryColor(
  category: string,
  palette: ReadonlyMap<string, string>,
  colors: ThemeColors,
): string {
  return palette.get(category) ?? colors[PINNED.other!];
}
