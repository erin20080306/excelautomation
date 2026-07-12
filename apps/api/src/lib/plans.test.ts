import { describe, expect, it } from 'vitest';
import { PLAN_CATALOG, planIncludes } from './plans.js';

describe('plan catalog', () => {
  it('keeps trial downloads disabled and paid plans profitable-sized', () => {
    expect(PLAN_CATALOG.TRIAL.downloadQuota).toBe(0);
    expect(PLAN_CATALOG.STARTER.priceTwd).toBeGreaterThanOrEqual(10_000);
  });

  it('orders download entitlements', () => {
    expect(planIncludes('PROFESSIONAL', 'STARTER')).toBe(true);
    expect(planIncludes('STARTER', 'BUSINESS')).toBe(false);
  });
});
