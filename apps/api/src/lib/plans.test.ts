import { describe, expect, it } from 'vitest';
import { PLAN_CATALOG, planIncludes } from './plans.js';

describe('plan catalog', () => {
  it('keeps trial downloads disabled and offers a discounted annual term', () => {
    expect(PLAN_CATALOG.TRIAL.downloadQuota).toBe(0);
    expect(PLAN_CATALOG.STARTER.monthlyPriceTwd).toBeGreaterThan(0);
    expect(PLAN_CATALOG.STARTER.annualPriceTwd).toBeLessThan(PLAN_CATALOG.STARTER.monthlyPriceTwd * 12);
  });

  it('orders download entitlements', () => {
    expect(planIncludes('PROFESSIONAL', 'STARTER')).toBe(true);
    expect(planIncludes('STARTER', 'BUSINESS')).toBe(false);
  });
});
