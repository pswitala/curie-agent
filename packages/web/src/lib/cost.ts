/**
 * Cost estimation for the web dashboard.
 *
 * One implementation. There were three — in `ChatArea.tsx`, `App.tsx`, and
 * (differently) in `@curie-agent/core` — with divergent fallback tables, so the
 * same session could show different costs in different panes.
 */

/** Fallback per-million prices, used only when the provider has no `model_cost` set. */
const FALLBACK_PRICING: Record<string, { in: number; out: number }> = {
  opus: { in: 15, out: 75 },
  sonnet: { in: 3, out: 15 },
  haiku: { in: 0.8, out: 4 },
  'gpt-4o': { in: 2.5, out: 10 },
  'gpt-4': { in: 5, out: 15 },
  qwen: { in: 0.112, out: 0.224 },
};

const DEFAULT_KEY = 'sonnet';

/**
 * @param modelCost Provider's configured `model_cost` string (`"in;out"`, per million).
 *                  Takes precedence over the fallback table when parseable.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  modelCost?: string,
): number {
  if (modelCost) {
    const [inStr, outStr] = modelCost.split(';');
    const inPrice = parseFloat(inStr || '0');
    const outPrice = parseFloat(outStr || '0');
    if (!isNaN(inPrice) && !isNaN(outPrice)) {
      return (inputTokens * inPrice + outputTokens * outPrice) / 1_000_000;
    }
  }
  const lower = model.toLowerCase();
  const key = Object.keys(FALLBACK_PRICING).find((k) => lower.includes(k)) ?? DEFAULT_KEY;
  const p = FALLBACK_PRICING[key]!;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}
