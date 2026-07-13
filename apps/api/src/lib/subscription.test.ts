import { describe, expect, it } from 'vitest';
import { addBillingPeriod, paidSubscriptionActive, subscriptionSnapshot } from './subscription.js';

const active = {
  plan: 'PROFESSIONAL' as const, subscriptionStatus: 'ACTIVE' as const, subscriptionInterval: 'MONTHLY' as const,
  subscriptionStartedAt: new Date('2026-01-01T00:00:00Z'), subscriptionEndsAt: new Date('2026-02-01T00:00:00Z')
};

describe('subscription entitlement', () => {
  it('uses the server-side end date and falls back to trial after expiry', () => {
    expect(paidSubscriptionActive(active, new Date('2026-01-31T23:59:59Z'))).toBe(true);
    expect(paidSubscriptionActive(active, new Date('2026-02-01T00:00:00Z'))).toBe(false);
    expect(subscriptionSnapshot(active, new Date('2026-02-02T00:00:00Z'))).toMatchObject({ active: false, effectivePlan: 'TRIAL', status: 'EXPIRED' });
  });

  it('keeps month-end billing dates valid', () => {
    expect(addBillingPeriod(new Date('2026-01-31T12:00:00Z'), 'MONTHLY').toISOString()).toBe('2026-02-28T12:00:00.000Z');
    expect(addBillingPeriod(new Date('2024-02-29T12:00:00Z'), 'YEARLY').toISOString()).toBe('2025-02-28T12:00:00.000Z');
  });
});
