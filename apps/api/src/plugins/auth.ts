import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { hasPermission, type WorkspacePermission } from '../lib/access.js';
import { subscriptionSnapshot } from '../lib/subscription.js';

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('auth');
  app.decorate('authorize', async (request: FastifyRequest, permission: WorkspacePermission) => {
    if (!hasPermission(request.auth.role, permission)) throw app.httpErrors.forbidden('目前角色沒有此操作權限');
  });
  app.decorate('authenticate', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw app.httpErrors.unauthorized('需要登入');
    let payload: { userId: string; workspaceId: string };
    try {
      payload = jwt.verify(header.slice(7), app.config.JWT_SECRET, { audience: 'excelmaster-api' }) as typeof payload;
    } catch {
      throw app.httpErrors.unauthorized('登入憑證已失效');
    }
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: payload.workspaceId, userId: payload.userId } },
      include: { user: true, workspace: true }
    });
    if (!member) throw app.httpErrors.forbidden('無此工作區權限');
    if (member.user.status !== 'ACTIVE' || !member.user.emailVerifiedAt) throw app.httpErrors.unauthorized('帳號尚未啟用或已停權');
    if (member.workspace.suspendedAt && member.user.platformRole !== 'SUPERADMIN') throw app.httpErrors.forbidden('工作區已停用');
    const entitlement = subscriptionSnapshot(member.workspace);
    request.auth = {
      userId: payload.userId,
      workspaceId: payload.workspaceId,
      role: member.role,
      platformRole: member.user.platformRole,
      workspacePlan: entitlement.effectivePlan,
      purchasedPlan: entitlement.purchasedPlan,
      subscriptionActive: entitlement.active,
      subscriptionStatus: entitlement.status,
      subscriptionEndsAt: entitlement.endsAt,
      fileQuota: entitlement.catalog.fileQuota,
      totalMbQuota: entitlement.catalog.totalMbQuota,
      outputMbQuota: entitlement.catalog.outputMbQuota,
      downloadQuota: entitlement.catalog.downloadQuota
    };
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest): Promise<void>;
    authorize(request: FastifyRequest, permission: import('../lib/access.js').WorkspacePermission): Promise<void>;
    config: import('../config.js').AppConfig;
  }
}
