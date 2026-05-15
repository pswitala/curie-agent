import { describe, it, expect } from 'vitest';
import { TokenMonitor, parseTieredPricing } from './token-monitor.js';

describe('TokenMonitor', () => {
  const createMonitor = (overrides = {}) => {
    const config = {
      contextWindowSize: 200_000,
      thresholdPct: 75,
      warnThresholdPct: 60,
      forcedThresholdPct: 85,
      pricingTierWarn: true,
      ...overrides,
    };
    return new TokenMonitor(config);
  };

  describe('getFillPct', () => {
    it('returns 0% when no tokens tracked', () => {
      const monitor = createMonitor();
      expect(monitor.getFillPct()).toBe(0);
    });

    it('returns correct percentage', () => {
      const monitor = createMonitor();
      monitor.addTokens(60_000, 10_000);
      expect(monitor.getFillPct()).toBe(30);
    });

    it('caps at 100%', () => {
      const monitor = createMonitor();
      monitor.addTokens(300_000, 50_000);
      expect(monitor.getFillPct()).toBe(100);
    });

    it('handles zero window size', () => {
      const monitor = createMonitor({ contextWindowSize: 0 });
      monitor.addTokens(10_000, 1_000);
      expect(monitor.getFillPct()).toBe(0);
    });
  });

  describe('getStatus', () => {
    it('returns ok below warning threshold', () => {
      const monitor = createMonitor();
      monitor.addTokens(50_000, 10_000); // 25%
      expect(monitor.getStatus()).toBe('ok');
    });

    it('returns warning at warning threshold (60%)', () => {
      const monitor = createMonitor();
      monitor.addTokens(120_000, 10_000); // 60%
      expect(monitor.getStatus()).toBe('warning');
    });

    it('returns compaction-needed at threshold (75%)', () => {
      const monitor = createMonitor();
      monitor.addTokens(150_000, 10_000); // 75%
      expect(monitor.getStatus()).toBe('compaction-needed');
    });

    it('returns forced-compaction at forced threshold (85%)', () => {
      const monitor = createMonitor();
      monitor.addTokens(170_000, 10_000); // 85%
      expect(monitor.getStatus()).toBe('forced-compaction');
    });
  });

  describe('addTokens', () => {
    it('accumulates tokens across calls', () => {
      const monitor = createMonitor();
      monitor.addTokens(30_000, 5_000);
      monitor.addTokens(30_000, 5_000);
      expect(monitor.cumulativeInputTokens).toBe(60_000);
    });

    it('emits warning event at 60%', () => {
      const monitor = createMonitor();
      monitor.addTokens(120_000, 10_000);
      const events = monitor.addTokens(1_000, 100);
      expect(events.some(e => e.type === 'context-warning')).toBe(true);
    });

    it('emits compaction-needed event at 75%', () => {
      const monitor = createMonitor();
      monitor.addTokens(150_000, 10_000);
      const events = monitor.addTokens(1_000, 100);
      expect(events.some(e => e.type === 'context-compaction-needed')).toBe(true);
    });

    it('emits forced-compaction event at 85%', () => {
      const monitor = createMonitor();
      monitor.addTokens(170_000, 10_000);
      const events = monitor.addTokens(1_000, 100);
      expect(events.some(e => e.type === 'context-forced-compaction')).toBe(true);
    });
  });

  describe('reset', () => {
    it('clears cumulative tokens and acknowledgments', () => {
      const monitor = createMonitor();
      monitor.addTokens(100_000, 10_000);
      monitor.acknowledge('tier-200000');
      monitor.reset();
      expect(monitor.cumulativeInputTokens).toBe(0);
      expect(monitor.lastTrackedTokens).toBe(0);
    });
  });

  describe('pricing tier warning', () => {
    it('emits tier-warning when crossing tier threshold', () => {
      const monitor = createMonitor();
      const tiers = parseTieredPricing('3;15|200000<5;25');
      // Add tokens up to the threshold
      monitor.addTokens(190_000, 10_000);
      // Cross into next tier (pass tiers so checkTierCrossing can work)
      const events = monitor.addTokens(15_000, 1_000, tiers); // total 205_000
      const tierEvent = events.find(e => e.type === 'tier-warning');
      expect(tierEvent).toBeDefined();
      if (tierEvent) {
        expect(tierEvent.type).toBe('tier-warning');
        expect(tierEvent.threshold).toBe(200_000);
      }
    });

    it('does not re-fire tier warning after acknowledgment', () => {
      const monitor = createMonitor();
      const tiers = parseTieredPricing('3;15|200000<5;25');
      monitor.addTokens(190_000, 10_000);
      const events1 = monitor.addTokens(15_000, 1_000, tiers);
      expect(events1.some(e => e.type === 'tier-warning')).toBe(true);

      // Acknowledge and add more tokens
      monitor.acknowledge('tier-200000');
      const events2 = monitor.addTokens(50_000, 5_000, tiers);
      expect(events2.some(e => e.type === 'tier-warning')).toBe(false);
    });

    it('does not emit tier warning when disabled', () => {
      const monitor = createMonitor({ pricingTierWarn: false });
      const tiers = parseTieredPricing('3;15|200000<5;25');
      monitor.addTokens(190_000, 10_000);
      monitor.addTokens(15_000, 1_000, tiers);
      const events = monitor.addTokens(1_000, 100, tiers);
      expect(events.some(e => e.type === 'tier-warning')).toBe(false);
    });

    it('does not emit tier warning with fewer than 2 tiers', () => {
      const monitor = createMonitor();
      const tiers = parseTieredPricing('3;15'); // flat pricing, single tier
      monitor.addTokens(300_000, 50_000, tiers);
      const events = monitor.addTokens(1_000, 100, tiers);
      expect(events.some(e => e.type === 'tier-warning')).toBe(false);
    });

    it('does not emit tier warning when no tiers provided', () => {
      const monitor = createMonitor();
      monitor.addTokens(300_000, 50_000);
      const events = monitor.addTokens(1_000, 100);
      expect(events.some(e => e.type === 'tier-warning')).toBe(false);
    });
  });
});

describe('parseTieredPricing', () => {
  it('parses flat pricing', () => {
    const tiers = parseTieredPricing('0.25;1.50');
    expect(tiers).toEqual([{ in: 0.25, out: 1.50 }]);
  });

  it('parses tiered pricing', () => {
    const tiers = parseTieredPricing('3;15|200000<5;25');
    expect(tiers).toEqual([
      { in: 3, out: 15 },
      { threshold: 200_000, in: 5, out: 25 },
    ]);
  });

  it('returns empty array for malformed input', () => {
    expect(parseTieredPricing('invalid')).toEqual([]);
  });
});
