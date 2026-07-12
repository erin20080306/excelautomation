import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    auth: {
      userId: string;
      workspaceId: string;
      role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
      platformRole: 'USER' | 'SUPERADMIN';
      workspacePlan: 'TRIAL' | 'STARTER' | 'PROFESSIONAL' | 'BUSINESS' | 'ENTERPRISE';
      fileQuota: number;
      totalMbQuota: number;
      outputMbQuota: number;
      downloadQuota: number;
    };
  }
}
