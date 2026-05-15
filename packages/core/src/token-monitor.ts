import { estimateCost, parseTieredPricing, selectTier, type PriceTier } from './pricing.js';
export { estimateCost, PriceTier, parseTieredPricing, selectTier } from './pricing.js';

export type TokenEvent =
  | { type: 'context-warning'; fillPct: number; message: string }
  | { type: 'context-compaction-needed'; fillPct: number; message: string }
  | { type: 'context-forced-compaction'; fillPct: number; message: string }
  | { type: 'tier-warning'; threshold: number; oldTier: PriceTier; newTier: PriceTier; message: string };

export interface TokenMonitorConfig {
  contextWindowSize: number;
  thresholdPct: number;
  warnThresholdPct: number;
  forcedThresholdPct: number;
  pricingTierWarn: boolean;
  /** Model name for cost estimation (e.g., 'claude-sonnet-4-6'). */
  model?: string;
}

export class TokenMonitor {
  config: TokenMonitorConfig;
  cumulativeInputTokens: number;
  lastTrackedTokens: number;
  private acknowledged = new Set<string>();

  constructor(config: TokenMonitorConfig) {
    this.config = config;
    this.cumulativeInputTokens = 0;
    this.lastTrackedTokens = 0;
  }

  getFillPct(): number {
    if (this.config.contextWindowSize <= 0) return 0;
    return Math.min(100, Math.round((this.cumulativeInputTokens / this.config.contextWindowSize) * 100));
  }

  getStatus(): 'ok' | 'warning' | 'compaction-needed' | 'forced-compaction' {
    const pct = this.getFillPct();
    if (pct >= this.config.forcedThresholdPct) return 'forced-compaction';
    if (pct >= this.config.thresholdPct) return 'compaction-needed';
    if (pct >= this.config.warnThresholdPct) return 'warning';
    return 'ok';
  }

  private parseTiers(tiersRaw?: PriceTier[]): PriceTier[] {
    if (!tiersRaw || tiersRaw.length === 0) return [];
    return tiersRaw;
  }

  private selectTier(tiers: PriceTier[], totalTokens: number): [PriceTier, PriceTier] {
    let result: PriceTier = tiers[0] ?? { in: 0, out: 0 };
    for (const tier of tiers) {
      if (tier.threshold !== undefined && totalTokens >= tier.threshold) {
        result = tier;
      }
    }
    // Find the tier just below the current one
    let prev: PriceTier = tiers[0] ?? { in: 0, out: 0 };
    for (let i = 0; i < tiers.length; i++) {
      if (tiers[i] === result) {
        prev = i > 0 ? tiers[i - 1]! : tiers[0]!;
        break;
      }
    }
    return [prev, result];
  }

  checkTierCrossing(tiersRaw?: PriceTier[]): TokenEvent | null {
    if (!this.config.pricingTierWarn) return null;
    const tiers = this.parseTiers(tiersRaw);
    if (tiers.length < 2) return null;

    const [prevTier, newTier] = this.selectTier(tiers, this.cumulativeInputTokens);
    if (prevTier.in === newTier.in) return null;

    const threshold = newTier.threshold ?? 0;
    const key = `tier-${threshold}`;
    if (this.acknowledged.has(key)) return null;

    const oldRate = `$${prevTier.in.toFixed(2)}/$${prevTier.out.toFixed(2)} per 1M tokens`;
    const newRate = `$${newTier.in.toFixed(2)}/$${newTier.out.toFixed(2)} per 1M tokens`;
    const cost = estimateCost(this.config.model || 'claude-sonnet-4-6', this.cumulativeInputTokens, 0);
    const oldCost = estimateCost(this.config.model || 'claude-sonnet-4-6', this.cumulativeInputTokens, 0, undefined);

    return {
      type: 'tier-warning',
      threshold,
      oldTier: prevTier,
      newTier,
      message: `⚠ Entering ${Math.round(threshold / 1000)}k+ tier — ${oldRate} -> ${newRate} (current session cost: $${cost.toFixed(2)})`,
    };
  }

  addTokens(inputTokens: number, outputTokens: number, tiersRaw?: PriceTier[]): TokenEvent[] {
    this.cumulativeInputTokens += inputTokens;
    const events: TokenEvent[] = [];

    const status = this.getStatus();
    const pct = this.getFillPct();
    if (status === 'warning') {
      events.push({ type: 'context-warning', fillPct: pct, message: `Context window ${pct}% full (warning threshold: ${this.config.warnThresholdPct}%)` });
    } else if (status === 'compaction-needed') {
      events.push({ type: 'context-compaction-needed', fillPct: pct, message: `Context window ${pct}% full (compaction threshold: ${this.config.thresholdPct}%)` });
    } else if (status === 'forced-compaction') {
      events.push({ type: 'context-forced-compaction', fillPct: pct, message: `Context window ${pct}% full (forced compaction at ${this.config.forcedThresholdPct}%)` });
    }

    const tierEvent = this.checkTierCrossing(tiersRaw);
    if (tierEvent) {
      events.push(tierEvent);
    }

    if (events.length > 0) {
      this.lastTrackedTokens = this.cumulativeInputTokens;
    }

    return events;
  }

  acknowledge(eventType: string): void {
    this.acknowledged.add(eventType);
  }

  reset(): void {
    this.cumulativeInputTokens = 0;
    this.lastTrackedTokens = 0;
    this.acknowledged.clear();
  }

  setContextWindowSize(size: number): void {
    this.config.contextWindowSize = size;
  }

  setThresholdPct(pct: number): void {
    this.config.thresholdPct = pct;
  }

  setWarnThresholdPct(pct: number): void {
    this.config.warnThresholdPct = pct;
  }

  setForcedThresholdPct(pct: number): void {
    this.config.forcedThresholdPct = pct;
  }
}
