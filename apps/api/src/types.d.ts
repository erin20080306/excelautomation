import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    auth: {
      userId: string;
      workspaceId: string;
      role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
      platformRole: 'USER' | 'SUPERADMIN';
      workspacePlan: 'TRIAL' | 'STARTER' | 'PROFESSIONAL' | 'BUSINESS' | 'ENTERPRISE';
      purchasedPlan: 'TRIAL' | 'STARTER' | 'PROFESSIONAL' | 'BUSINESS' | 'ENTERPRISE';
      subscriptionActive: boolean;
      subscriptionStatus: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED' | 'SUSPENDED';
      subscriptionEndsAt: Date | null;
      fileQuota: number;
      totalMbQuota: number;
      outputMbQuota: number;
      downloadQuota: number;
    };
  }
}
