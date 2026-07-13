import { PLAN_CATALOG, type BillingIntervalKey, type PlanKey } from './plans.js';

export type SubscriptionStatusKey = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED' | 'SUSPENDED';

export type SubscriptionWorkspace = {
  plan: PlanKey;
  subscriptionStatus: SubscriptionStatusKey;
  subscriptionInterval: BillingIntervalKey | null;
  subscriptionStartedAt: Date | null;
  subscriptionEndsAt: Date | null;
};

export function addBillingPeriod(start: Date, interval: BillingIntervalKey): Date {
  if (interval === 'MANUAL') return new Date(start);
  const months = interval === 'YEARLY' ? 12 : 1;
  const result = new Date(start);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function paidSubscriptionActive(workspace: SubscriptionWorkspace, now = new Date()): boolean {
  return workspace.plan !== 'TRIAL'
    && workspace.subscriptionStatus === 'ACTIVE'
    && workspace.subscriptionEndsAt instanceof Date
    && workspace.subscriptionEndsAt.getTime() > now.getTime();
}

export function subscriptionSnapshot(workspace: SubscriptionWorkspace, now = new Date()) {
  const active = paidSubscriptionActive(workspace, now);
  const effectivePlan: PlanKey = workspace.plan === 'TRIAL' || active ? workspace.plan : 'TRIAL';
  const derivedStatus: SubscriptionStatusKey = workspace.plan === 'TRIAL'
    ? 'TRIALING'
    : workspace.subscriptionStatus === 'ACTIVE' && !active ? 'EXPIRED' : workspace.subscriptionStatus;
  return {
    active,
    effectivePlan,
    purchasedPlan: workspace.plan,
    status: derivedStatus,
    interval: workspace.subscriptionInterval,
    startedAt: workspace.subscriptionStartedAt,
    endsAt: workspace.subscriptionEndsAt,
    catalog: PLAN_CATALOG[effectivePlan]
  };
}
