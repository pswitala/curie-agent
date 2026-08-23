import { luminance, type ThemeColors } from '../lib/theme-colors.js';

export interface BloomParams {
  /** False on light themes, where bloom has nothing useful to do. */
  enabled: boolean;
  strength: number;
  radius: number;
  threshold: number;
}

/**
 * Scale the bloom pass to the theme's background.
 *
 * Bloom *adds* light, so a strength tuned for `black` turns the light `white`
 * theme (`--s1: #f1f1f1`) into a featureless white field. Deriving from
 * background luminance keeps the glow where it reads and effectively switches it
 * off where it doesn't: raising `threshold` alongside dropping `strength` means
 * only genuinely bright pixels bloom at all on a light background.
 *
 * The floor on `threshold` matters more than `strength`, for two reasons found by
 * eye on a real 79-node / 344-link wiki:
 *
 *  - A link-dense graph fills the viewport, and at a low threshold every edge
 *    blooms, so contributions stack into a white wash however modest the strength.
 *  - Bloom is luminance-gated, and the semantic palette spans a wide luminance
 *    range — `--gold` (#ebcb8b) is far brighter than `--red` (#bf616a). Too low a
 *    threshold blows the bright categories into white blobs while leaving the
 *    dark ones crisp, destroying the colour coding the palette exists to provide.
 *
 * The values below were calibrated by eye against a real 79-node / 344-link wiki
 * across themes; at this threshold only near-white highlights bloom, so the halo
 * reads without eating the hue. Note the shader gates on *lit* pixel luminance,
 * so the useful threshold sits below the raw palette luminances — Lambert shading
 * puts most of each sphere well under its base colour.
 *
 * On a light theme bloom is switched **off** rather than merely weakened. Simply
 * turning the strength down is not enough: `[data-theme="white"]`'s surface
 * (#f1f1f1, L≈0.88) is brighter than any threshold that still lets nodes glow, so
 * the background itself blooms and veils the whole graph — observed as washed-out
 * pastel nodes and invisible links. A light background has nothing to bloom.
 */
export function bloomParamsFor(colors: ThemeColors): BloomParams {
  const l = Math.max(0, Math.min(1, luminance(colors['--s1'])));
  const dark = 1 - l;
  const threshold = 0.45 + 0.32 * l;
  return {
    // Off once the backdrop itself would cross the threshold.
    enabled: l < threshold,
    strength: 0.10 + 0.52 * Math.pow(dark, 1.5),
    radius: 0.34 + 0.12 * dark,
    threshold,
  };
}
