import { useState, useEffect } from 'react';
import { readThemeColors, type ThemeColors } from '../lib/theme-colors.js';

/**
 * Resolved theme colours for the active `data-theme`, re-read whenever it changes.
 *
 * Watches the attribute rather than going through `useConfig()` on purpose:
 * `useConfig` fires five RPC calls per mount, and `App.tsx` already mirrors the
 * theme setting onto `<html data-theme>`. Observing that attribute costs nothing
 * and works no matter which client changed the theme (web UI, TUI `/theme`, or
 * Telegram).
 */
export function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState<ThemeColors>(() => readThemeColors());

  useEffect(() => {
    if (typeof MutationObserver !== 'function' || typeof document === 'undefined') return;

    const root = document.documentElement;
    // Re-read once on mount: the attribute may have been set between the
    // initial useState call and this effect running.
    setColors(readThemeColors(root));

    const observer = new MutationObserver(() => { setColors(readThemeColors(root)); });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { observer.disconnect(); };
  }, []);

  return colors;
}
