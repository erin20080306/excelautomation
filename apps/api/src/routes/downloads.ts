import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { PLAN_CATALOG, planIncludes, type PlanKey } from '../lib/plans.js';
import { sha256 } from '../lib/security.js';
import { paidSubscriptionActive } from '../lib/subscription.js';

const activationInput = z.object({
  activationCode: z.string().min(24).max(120),
  deviceId: z.string().trim().min(12).max(200),
  deviceName: z.string().trim().min(1).max(100).optional()
});

function newActivationCode(): string {
  return `EM-${crypto.randomBytes(24).toString('base64url')}`;
}

async function findLicense(activationCode: string) {
  return prisma.licenseActivation.findUnique({
    where: { codeHash: sha256(Buffer.from(activationCode)) },
    include: { workspace: true, download: true }
  });
}

function activeLicenseResponse(item: Awaited<ReturnType<typeof findLicense>>) {
  return {
    active: true,
    plan: item!.workspace.plan,
    platform: item!.platform,
    expiresAt: item!.workspace.subscriptionEndsAt,
    nextCheckSeconds: 900
  };
}

export async function downloadRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request) => {
    if ((request.routeOptions.config as unknown as Record<string, unknown>).public) return;
    await app.authenticate(request);
  });

  app.get('/releases', async (request) => {
    const items = await prisma.releaseArtifact.findMany({ where: { active: true }, select: { id: true, version: true, name: true, platform: true, minimumPlan: true, size: true, sha256: true, publishedAt: true }, orderBy: [{ publishedAt: 'desc' }, { platform: 'asc' }] });
    const superadmin = request.auth.platformRole === 'SUPERADMIN';
    return { items: items.map((item) => ({
      ...item,
      eligible: superadmin || (request.auth.subscriptionActive && planIncludes(request.auth.workspacePlan as PlanKey, item.minimumPlan as PlanKey)),
      reason: superadmin || request.auth.subscriptionActive ? null : '訂閱未生效或已到期'
    })) };
  });

  app.post('/request', async (request, reply) => {
    const { releaseId } = z.object({ releaseId: z.string().cuid() }).parse(request.body);
    const release = await prisma.releaseArtifact.findFirst({ where: { id: releaseId, active: true } });
    if (!release) throw app.httpErrors.notFound('找不到安裝包版本');
    const superadmin = request.auth.platformRole === 'SUPERADMIN';
    if (!superadmin && !request.auth.subscriptionActive) return reply.code(402).send({ message: '訂閱尚未生效或已到期，無法產生安裝包下載與啟用碼' });
    if (!superadmin && !planIncludes(request.auth.workspacePlan as PlanKey, release.minimumPlan as PlanKey)) return reply.code(403).send({ message: `此安裝包需要 ${release.minimumPlan} 或更高方案` });

    const token = crypto.randomBytes(32).toString('base64url');
    const activationCode = newActivationCode();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: request.auth.workspaceId } });
    const licenseExpiresAt = workspace.subscriptionEndsAt ?? new Date(Date.now() + 30 * 24 * 60 * 60_000);
    const data = { releaseId: release.id, userId: request.auth.userId, workspaceId: request.auth.workspaceId, tokenHash: sha256(Buffer.from(token)), expiresAt, ipAddress: request.ip, userAgent: request.headers['user-agent']?.slice(0, 500) };
    let item;
    try {
      item = await prisma.$transaction(async (tx) => {
        if (!superadmin) {
          const used = await tx.packageDownload.count({ where: {
            workspaceId: request.auth.workspaceId,
            requestedAt: workspace.subscriptionStartedAt ? { gte: workspace.subscriptionStartedAt } : undefined,
            OR: [{ usedAt: { not: null } }, { expiresAt: { gt: new Date() } }]
          } });
          if (used >= request.auth.downloadQuota) throw app.httpErrors.tooManyRequests(`本期下載額度已用完（${used}/${request.auth.downloadQuota}）`);
        }
        const download = await tx.packageDownload.create({ data });
        await tx.licenseActivation.create({ data: {
          workspaceId: request.auth.workspaceId, userId: request.auth.userId, downloadId: download.id,
          codeHash: sha256(Buffer.from(activationCode)), codeLast4: activationCode.slice(-4), platform: release.platform,
          expiresAt: licenseExpiresAt
        } });
        return download;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return reply.code(409).send({ message: '同時下載請求發生衝突，請重新操作' });
      throw error;
    }
    await prisma.platformAudit.create({ data: { actorUserId: request.auth.userId, action: 'release.download.requested', entityType: 'PackageDownload', entityId: item.id, metadata: { version: release.version, platform: release.platform, activationCodeLast4: activationCode.slice(-4) }, ipAddress: request.ip } });
    return {
      url: `${request.protocol}://${request.host}/api/downloads/file/${token}`,
      expiresIn: 600, sha256: release.sha256, name: release.name,
      activationCode,
      activationNotice: '啟用碼只顯示這一次。請妥善保存，安裝程式會要求輸入並綁定裝置。'
    };
  });

  app.get('/file/:token', { config: { public: true } }, async (request, reply) => {
    const { token } = z.object({ token: z.string().min(30).max(100) }).parse(request.params);
    const tokenHash = sha256(Buffer.from(token));
    const item = await prisma.packageDownload.findUnique({ where: { tokenHash }, include: { release: true, workspace: true, user: true } });
    if (!item || item.usedAt || item.expiresAt <= new Date()) return reply.code(410).send({ message: '下載連結已使用或過期' });
    if (item.user.platformRole !== 'SUPERADMIN' && !paidSubscriptionActive(item.workspace)) return reply.code(402).send({ message: '訂閱已到期，下載已停止' });
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

  app.post('/license/activate', { config: { public: true } }, async (request, reply) => {
    const input = activationInput.parse(request.body);
    const item = await findLicense(input.activationCode);
    if (!item || item.status === 'REVOKED') return reply.code(403).send({ active: false, message: '啟用碼無效或已撤銷' });
    if (!item.download.usedAt) return reply.code(403).send({ active: false, message: '必須先完成安裝包下載，才能啟用裝置' });
    if (!paidSubscriptionActive(item.workspace)) return reply.code(402).send({ active: false, message: '訂閱尚未生效或已到期' });
    const deviceHash = sha256(Buffer.from(input.deviceId));
    if (item.deviceHash && item.deviceHash !== deviceHash) return reply.code(403).send({ active: false, message: '此啟用碼已綁定其他裝置' });
    if (!item.deviceHash) {
      const activeDevices = await prisma.licenseActivation.findMany({ where: { workspaceId: item.workspaceId, status: 'ACTIVE', deviceHash: { not: null }, revokedAt: null }, distinct: ['deviceHash'], select: { deviceHash: true } });
      const limit = PLAN_CATALOG[item.workspace.plan as PlanKey].devices;
      if (activeDevices.length >= limit) return reply.code(403).send({ active: false, message: `方案裝置數已達上限（${activeDevices.length}/${limit}），請先由管理者撤銷舊裝置` });
    }
    const now = new Date();
    await prisma.licenseActivation.update({ where: { id: item.id }, data: {
      status: 'ACTIVE', deviceHash, deviceName: input.deviceName ?? null,
      activatedAt: item.activatedAt ?? now, lastSeenAt: now, expiresAt: item.workspace.subscriptionEndsAt!
    } });
    await prisma.platformAudit.create({ data: { actorUserId: item.userId, action: 'license.device.activated', entityType: 'LicenseActivation', entityId: item.id, metadata: { platform: item.platform, deviceName: input.deviceName ?? null, codeLast4: item.codeLast4 }, ipAddress: request.ip } });
    return activeLicenseResponse(item);
  });

  app.post('/license/verify', { config: { public: true } }, async (request, reply) => {
    const input = activationInput.pick({ activationCode: true, deviceId: true }).parse(request.body);
    const item = await findLicense(input.activationCode);
    const deviceHash = sha256(Buffer.from(input.deviceId));
    if (!item || item.status !== 'ACTIVE' || item.revokedAt || item.deviceHash !== deviceHash) return reply.code(403).send({ active: false, message: '裝置授權無效或已撤銷' });
    if (!paidSubscriptionActive(item.workspace)) return reply.code(402).send({ active: false, message: '訂閱已到期，請續訂後再使用安裝版' });
    await prisma.licenseActivation.update({ where: { id: item.id }, data: { lastSeenAt: new Date(), expiresAt: item.workspace.subscriptionEndsAt! } });
    return activeLicenseResponse(item);
  });

  app.get('/usage', async (request) => {
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: request.auth.workspaceId } });
    const used = await prisma.packageDownload.count({ where: {
      workspaceId: request.auth.workspaceId,
      requestedAt: workspace.subscriptionStartedAt ? { gte: workspace.subscriptionStartedAt } : undefined,
      OR: [{ usedAt: { not: null } }, { expiresAt: { gt: new Date() } }]
    } });
    return {
      used, quota: request.auth.platformRole === 'SUPERADMIN' ? null : request.auth.downloadQuota,
      plan: request.auth.workspacePlan, purchasedPlan: request.auth.purchasedPlan,
      subscription: { active: request.auth.subscriptionActive, status: request.auth.subscriptionStatus, endsAt: request.auth.subscriptionEndsAt },
      catalog: PLAN_CATALOG[request.auth.workspacePlan as PlanKey]
    };
  });
}
