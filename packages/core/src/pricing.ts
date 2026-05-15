export interface PriceTier {
  threshold?: number;
  in: number;
  out: number;
}

/**
 * Parse a MODEL_COST string into structured tiers.
 *
 * Flat format: "0.25;1.50" → single tier with no threshold.
 * Tiered format: "0.25;1.50|200000<1.0;4.0" → base tier + one or more thresholded tiers.
 *
 * Tiers are separated by '|'. Each tiered segment uses "threshold<input;output>".
 * Returns empty array if the string is malformed.
 */
export function parseTieredPricing(cost: string): PriceTier[] {
  // If no tier delimiter '|', treat as flat pricing (backward compatible)
  if (!cost.includes('|')) {
    const [inStr = '', outStr = ''] = cost.split(';');
    const inC = parseFloat(inStr);
    const outC = parseFloat(outStr);
    if (!isNaN(inC) && !isNaN(outC)) return [{ in: inC, out: outC }];
    return [];
  }
  const rawTiers = cost.split('|').map(s => s.trim());
  const tiers: PriceTier[] = [];
  const [inStr = '', outStr = ''] = rawTiers[0]?.split(';') ?? ['', ''];
  const baseIn = parseFloat(inStr);
  const baseOut = parseFloat(outStr);
  if (isNaN(baseIn) || isNaN(baseOut)) return [];
  tiers.push({ in: baseIn, out: baseOut });
  for (let i = 1; i < rawTiers.length; i++) {
    const tier = rawTiers[i]!;
    // Tiered segment: "threshold<input;output>"
    const pipeIdx = tier.indexOf('<');
    if (pipeIdx === -1) break;
    const threshold = parseInt(tier.substring(0, pipeIdx).trim(), 10);
    const rest = tier.substring(pipeIdx + 1).trim();
    const [tierInStr = '', tierOutStr = ''] = rest.split(';');
    const tierIn = parseFloat(tierInStr);
    const tierOut = parseFloat(tierOutStr);
    if (isNaN(threshold) || isNaN(tierIn) || isNaN(tierOut)) break;
    tiers.push({ threshold, in: tierIn, out: tierOut });
  }
  return tiers;
}

/**
 * Select the pricing tier applicable for a given total token count.
 * Walks tiers top-to-bottom; the highest threshold that totalTokens >= threshold wins.
 * Falls back to the base tier (index 0) if no threshold is exceeded.
 */
export function selectTier(tiers: PriceTier[], totalTokens: number): [number, number] {
  let result: [number, number] = [tiers[0]?.in ?? 0, tiers[0]?.out ?? 0];
  for (const tier of tiers) {
    if (tier.threshold !== undefined && totalTokens >= tier.threshold) {
      result = [tier.in, tier.out];
    }
  }
  return result;
}

/**
 * Estimate the USD cost of a token exchange given model and optional custom pricing.
 *
 * Uses custom pricing (flat or tiered) when provided, otherwise falls back
 * to hardcoded Claude model rates.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  customCost?: string,
): number {
  if (customCost) {
    const tiers = parseTieredPricing(customCost);
    if (tiers.length > 0) {
      const [inC, outC] = selectTier(tiers, inputTokens + outputTokens);
      if (!isNaN(inC) && !isNaN(outC)) {
        return (inputTokens * inC + outputTokens * outC) / 1_000_000;
      }
    }
  }
  // Rough per-million-token pricing in USD; fall back to Sonnet rates.
  const pricing: Record<string, { in: number; out: number }> = {
    'claude-opus': { in: 15, out: 75 },
    'claude-sonnet': { in: 3, out: 15 },
    'claude-haiku': { in: 0.8, out: 4 },
  };
  const key = Object.keys(pricing).find(k => model.includes(k)) || 'claude-sonnet';
  const p = pricing[key]!;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}
