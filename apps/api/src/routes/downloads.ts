import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { PLAN_CATALOG, planIncludes, type PlanKey } from '../lib/plans.js';
import { sha256 } from '../lib/security.js';

export async function downloadRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request) => {
    if ((request.routeOptions.config as unknown as Record<string, unknown>).public) return;
    await app.authenticate(request);
  });

  app.get('/releases', async (request) => {
    const items = await prisma.releaseArtifact.findMany({ where: { active: true }, select: { id: true, version: true, name: true, platform: true, minimumPlan: true, size: true, sha256: true, publishedAt: true }, orderBy: [{ publishedAt: 'desc' }, { platform: 'asc' }] });
    return { items: items.map((item) => ({ ...item, eligible: request.auth.platformRole === 'SUPERADMIN' || planIncludes(request.auth.workspacePlan as PlanKey, item.minimumPlan as PlanKey) })) };
  });

  app.post('/request', async (request, reply) => {
    const { releaseId } = z.object({ releaseId: z.string().cuid() }).parse(request.body);
    const release = await prisma.releaseArtifact.findFirst({ where: { id: releaseId, active: true } });
    if (!release) throw app.httpErrors.notFound('找不到安裝包版本');
    const superadmin = request.auth.platformRole === 'SUPERADMIN';
    if (!superadmin && !planIncludes(request.auth.workspacePlan as PlanKey, release.minimumPlan as PlanKey)) return reply.code(403).send({ message: `此安裝包需要 ${release.minimumPlan} 或更高方案` });
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const data = { releaseId: release.id, userId: request.auth.userId, workspaceId: request.auth.workspaceId, tokenHash: sha256(Buffer.from(token)), expiresAt, ipAddress: request.ip, userAgent: request.headers['user-agent']?.slice(0, 500) };
    let item;
    try {
      item = superadmin
        ? await prisma.packageDownload.create({ data })
        : await prisma.$transaction(async (tx) => {
            const now = new Date();
            const used = await tx.packageDownload.count({ where: { workspaceId: request.auth.workspaceId, OR: [{ usedAt: { not: null } }, { expiresAt: { gt: now } }] } });
            if (used >= request.auth.downloadQuota) throw app.httpErrors.tooManyRequests(`目前方案下載額度已用完（${used}/${request.auth.downloadQuota}）`);
            return tx.packageDownload.create({ data });
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return reply.code(409).send({ message: '同時下載請求發生衝突，請重新操作' });
      throw error;
    }
    await prisma.platformAudit.create({ data: { actorUserId: request.auth.userId, action: 'release.download.requested', entityType: 'PackageDownload', entityId: item.id, metadata: { version: release.version, platform: release.platform }, ipAddress: request.ip } });
    return { url: `${request.protocol}://${request.host}/api/downloads/file/${token}`, expiresIn: 600, sha256: release.sha256, name: release.name };
  });

  app.get('/file/:token', { config: { public: true } }, async (request, reply) => {
    const { token } = z.object({ token: z.string().min(30).max(100) }).parse(request.params);
    const tokenHash = sha256(Buffer.from(token));
    const item = await prisma.packageDownload.findUnique({ where: { tokenHash }, include: { release: true } });
    if (!item || item.usedAt || item.expiresAt <= new Date()) return reply.code(410).send({ message: '下載連結已使用或過期' });
    const claimed = await prisma.packageDownload.updateMany({ where: { id: item.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (!claimed.count) return reply.code(410).send({ message: '下載連結已使用或過期' });
    await prisma.platformAudit.create({ data: { actorUserId: item.userId, action: 'release.download.completed', entityType: 'PackageDownload', entityId: item.id, metadata: { version: item.release.version, platform: item.release.platform, sha256: item.release.sha256 }, ipAddress: request.ip } });
    reply.header('Content-Type', item.release.contentType);
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(item.release.name)}`);
    reply.header('Content-Length', String(item.release.size));
    reply.header('Digest', `sha-256=${Buffer.from(item.release.sha256, 'hex').toString('base64')}`);
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(Buffer.from(item.release.data));
  });

  app.get('/usage', async (request) => {
    const used = await prisma.packageDownload.count({ where: { workspaceId: request.auth.workspaceId, OR: [{ usedAt: { not: null } }, { expiresAt: { gt: new Date() } }] } });
    return { used, quota: request.auth.platformRole === 'SUPERADMIN' ? null : request.auth.downloadQuota, plan: request.auth.workspacePlan, catalog: PLAN_CATALOG[request.auth.workspacePlan as PlanKey] };
  });
}
