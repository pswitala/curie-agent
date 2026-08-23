import { CanvasTexture, Sprite, SpriteMaterial, type Texture } from 'three';

/**
 * Coloured halo sprites, used to give nodes a glow on **light** themes.
 *
 * Bloom cannot do this job on a light background. `UnrealBloomPass` brightens
 * pixels above a luminance threshold, but on `[data-theme="white"]` the surface
 * (#f1f1f1, L≈0.88) is far *brighter* than any palette colour (--red L≈0.17,
 * --green L≈0.10, --chart-1 L≈0.19). Any threshold low enough to catch a node
 * catches the entire background first, which veils the whole graph rather than
 * glowing anything.
 *
 * A billboarded radial-gradient sprite in the node's own colour has no such
 * dependency on being brighter than the backdrop, so it reads as an aura on
 * white. Dark themes keep using bloom; each theme gets exactly one glow
 * mechanism so they never stack.
 */

/** 3d-force-graph derives sphere radius as cbrt(val) * nodeRelSize. */
export const DEFAULT_NODE_REL_SIZE = 4;

export function nodeRadiusFor(val: number, nodeRelSize = DEFAULT_NODE_REL_SIZE): number {
  const safe = Number.isFinite(val) && val > 0 ? val : 1;
  return Math.cbrt(safe) * nodeRelSize;
}

/** How far the halo extends past the sphere, as a multiple of its diameter. */
export const HALO_SCALE = 3.2;

export function haloSizeFor(val: number, nodeRelSize = DEFAULT_NODE_REL_SIZE): number {
  return nodeRadiusFor(val, nodeRelSize) * HALO_SCALE;
}

const TEXTURE_SIZE = 128;

/**
 * One texture per colour, not per node — a 79-node graph needs four.
 * Keyed by colour so a theme switch naturally produces a fresh set.
 */
export function createHaloTextures(): {
  get: (color: string) => Texture | null;
  dispose: () => void;
} {
  const cache = new Map<string, Texture>();

  const get = (color: string): Texture | null => {
    const key = color.toLowerCase();
    const hit = cache.get(key);
    if (hit) return hit;

    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const half = TEXTURE_SIZE / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    // Opaque only at the very centre, where the sphere hides it anyway; the
    // visible part is the soft falloff.
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.22, color);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.fill();

    const texture = new CanvasTexture(canvas);
    cache.set(key, texture);
    return texture;
  };

  const dispose = () => {
    for (const texture of cache.values()) texture.dispose();
    cache.clear();
  };

  return { get, dispose };
}

/** A halo billboard for one node. */
export function createHaloSprite(texture: Texture, size: number, opacity: number): Sprite {
  const material = new SpriteMaterial({
    map: texture,
    // No `color` tint: the gradient texture already carries the node's colour,
    // and SpriteMaterial multiplies the two — squaring it darkened the aura into
    // something that read as a grey drop shadow rather than a coloured glow.
    transparent: true,
    opacity,
    // Never occlude the spheres or each other.
    depthWrite: false,
  });
  const sprite = new Sprite(material);
  sprite.scale.set(size, size, 1);
  return sprite;
}
