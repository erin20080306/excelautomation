import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { PLAN_CATALOG } from '../lib/plans.js';
import { subscriptionSnapshot } from '../lib/subscription.js';
import { isAllowedSuperadmin } from '../lib/admin-access.js';

const planSchema = z.enum(['TRIAL', 'STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE']);

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request) => {
    await app.authenticate(request);
    if (request.auth.platformRole !== 'SUPERADMIN' || !isAllowedSuperadmin(request.auth.email, app.config.SUPERADMIN_EMAILS)) throw app.httpErrors.forbidden('此帳號沒有平台管理權限');
  });

  app.get('/overview', async () => {
    const [users, workspaces, paidOrders, downloads, suspendedUsers, activeSubscriptions, activeDevices] = await Promise.all([
      prisma.user.count(), prisma.workspace.count(), prisma.paymentOrder.count({ where: { status: 'PAID' } }), prisma.packageDownload.count({ where: { usedAt: { not: null } } }), prisma.user.count({ where: { status: 'SUSPENDED' } }),
      prisma.workspace.count({ where: { subscriptionStatus: 'ACTIVE', subscriptionEndsAt: { gt: new Date() } } }),
      prisma.licenseActivation.count({ where: { status: 'ACTIVE', revokedAt: null } })
    ]);
    return { users, workspaces, paidOrders, downloads, suspendedUsers, activeSubscriptions, activeDevices };
  });

  app.get('/users', async (request) => {
    const { q } = z.object({ q: z.string().trim().optional() }).parse(request.query);
    const items = await prisma.user.findMany({ where: q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] } : {}, include: { memberships: { include: { workspace: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { items: items.map(({ passwordHash: _passwordHash, mfaSecretEncrypted: _mfaSecret, ...user }) => user) };
  });

  app.patch('/users/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const body = z.object({ status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED']).optional(), platformRole: z.enum(['USER', 'SUPERADMIN']).optional(), emailVerified: z.boolean().optional() }).parse(request.body);
    const target = await prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true } });
    if (body.platformRole === 'SUPERADMIN' && !isAllowedSuperadmin(target.email, app.config.SUPERADMIN_EMAILS)) return reply.code(400).send({ message: '此 Email 不在平台管理者允許清單中' });
    if (id === request.auth.userId && ((body.status && body.status !== 'ACTIVE') || body.platformRole === 'USER' || body.emailVerified === false)) return reply.code(400).send({ message: '不可停權、取消驗證或降級目前登入的 SUPERADMIN' });
    const item = await prisma.user.update({ where: { id }, data: { status: body.status, platformRole: body.platformRole, emailVerifiedAt: body.emailVerified === undefined ? undefined : body.emailVerified ? new Date() : null } });
    await prisma.platformAudit.create({ data: { actorUserId: request.auth.userId, action: 'admin.user.update', entityType: 'User', entityId: id, metadata: body, ipAddress: request.ip } });
    return { id: item.id, status: item.status, platformRole: item.platformRole, emailVerifiedAt: item.emailVerifiedAt };
  });

  app.get('/workspaces', async () => {
    const items = await prisma.workspace.findMany({ include: { _count: { select: { members: true, sourceFiles: true, packageDownloads: true, licenseActivations: true, paymentOrders: true } }, members: { where: { role: 'OWNER' }, take: 1, include: { user: { select: { email: true, name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { items: items.map((item) => ({ ...item, entitlement: subscriptionSnapshot(item) })) };
  });

  app.patch('/workspaces/:id', async (request) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const body = z.object({
      plan: planSchema.optional(), suspended: z.boolean().optional(),
      subscriptionStatus: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'SUSPENDED']).optional(),
      subscriptionInterval: z.enum(['MONTHLY', 'YEARLY', 'MANUAL']).nullable().optional(),
      subscriptionEndsAt: z.string().datetime().nullable().optional(),
      fileQuota: z.number().int().min(1).max(10_000).optional(), totalMbQuota: z.number().positive().max(5000).optional(), outputMbQuota: z.number().positive().max(5000).optional(), downloadQuota: z.number().int().min(0).max(10_000).optional()
    }).parse(request.body);
    const defaults = body.plan ? PLAN_CATALOG[body.plan] : null;
    const now = new Date();
    const paidPlanSelected = body.plan && body.plan !== 'TRIAL';
    const defaultEnd = paidPlanSelected ? new Date(now.getTime() + 30 * 24 * 60 * 60_000) : undefined;
    const item = await prisma.workspace.update({ where: { id }, data: {
      plan: body.plan, suspendedAt: body.suspended === undefined ? undefined : body.suspended ? new Date() : null,
      subscriptionStatus: body.plan === 'TRIAL' ? 'TRIALING' : body.subscriptionStatus ?? (paidPlanSelected ? 'ACTIVE' : undefined),
      subscriptionInterval: body.plan === 'TRIAL' ? null : body.subscriptionInterval ?? (paidPlanSelected ? 'MANUAL' : undefined),
      subscriptionStartedAt: paidPlanSelected ? now : body.plan === 'TRIAL' ? null : undefined,
      subscriptionEndsAt: body.plan === 'TRIAL' ? null : body.subscriptionEndsAt === null ? null : body.subscriptionEndsAt ? new Date(body.subscriptionEndsAt) : defaultEnd,
      subscriptionGraceEndsAt: body.plan === 'TRIAL' ? null : undefined,
      fileQuota: body.fileQuota ?? defaults?.fileQuota, totalMbQuota: body.totalMbQuota ?? defaults?.totalMbQuota,
      outputMbQuota: body.outputMbQuota ?? defaults?.outputMbQuota, downloadQuota: body.downloadQuota ?? defaults?.downloadQuota
    } });
    await prisma.platformAudit.create({ data: { actorUserId: request.auth.userId, action: 'admin.workspace.update', entityType: 'Workspace', entityId: id, metadata: body, ipAddress: request.ip } });
    return item;
  });

  app.get('/payments', async () => ({ items: await prisma.paymentOrder.findMany({ include: { user: { select: { email: true, name: true } }, workspace: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }) }));
  app.get('/downloads', async () => ({ items: await prisma.packageDownload.findMany({ include: { user: { select: { email: true } }, workspace: { select: { name: true, plan: true, subscriptionStatus: true, subscriptionEndsAt: true } }, release: { select: { version: true, platform: true, sha256: true } }, licenseActivation: { select: { id: true, codeLast4: true, status: true, deviceName: true, activatedAt: true, lastSeenAt: true, revokedAt: true, expiresAt: true } } }, orderBy: { requestedAt: 'desc' }, take: 200 }) }));
  app.get('/licenses', async () => ({ items: await prisma.licenseActivation.findMany({ include: {
    user: { select: { email: true, name: true } }, workspace: { select: { name: true, plan: true, subscriptionStatus: true, subscriptionEndsAt: true } },
    download: { include: { release: { select: { version: true, platform: true, sha256: true } } } }
  }, orderBy: { createdAt: 'desc' }, take: 300 }) }));

  app.patch('/licenses/:id', async (request) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const { revoked } = z.object({ revoked: z.boolean() }).parse(request.body);
    const item = await prisma.licenseActivation.update({ where: { id }, data: { status: revoked ? 'REVOKED' : 'PENDING', revokedAt: revoked ? new Date() : null, deviceHash: revoked ? undefined : null, deviceName: revoked ? undefined : null } });
    await prisma.platformAudit.create({ data: { actorUserId: request.auth.userId, action: revoked ? 'admin.license.revoked' : 'admin.license.reset', entityType: 'LicenseActivation', entityId: id, metadata: { codeLast4: item.codeLast4 }, ipAddress: request.ip } });
    return { id: item.id, status: item.status, revokedAt: item.revokedAt };
  });
  app.get('/audit', async () => ({ items: await prisma.platformAudit.findMany({ include: { actor: { select: { email: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 300 }) }));

  app.get('/releases', async () => ({ items: await prisma.releaseArtifact.findMany({ select: { id: true, version: true, name: true, platform: true, minimumPlan: true, size: true, sha256: true, active: true, publishedAt: true }, orderBy: { publishedAt: 'desc' } }) }));

  app.post('/releases', async (request, reply) => {
    const fields: Record<string, string> = {}; let fileName = ''; const chunks: Buffer[] = [];
    for await (const part of request.parts()) {
      if (part.type === 'field') { fields[part.fieldname] = String(part.value); continue; }
      fileName = part.filename;
      for await (const chunk of part.file) chunks.push(Buffer.from(chunk));
      if (part.file.truncated) throw app.httpErrors.payloadTooLarge('安裝包超過上傳限制');
    }
    const input = z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/), platform: z.enum(['WINDOWS', 'MACOS']), minimumPlan: z.enum(['STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE']) }).parse(fields);
    const data = Buffer.concat(chunks);
    if (!data.length || !fileName.toLowerCase().endsWith('.zip')) throw app.httpErrors.badRequest('請上傳 ZIP 安裝包');
    const digest = crypto.createHash('sha256').update(data).digest('hex');
    const item = await prisma.releaseArtifact.upsert({ where: { version_platform: { version: input.version, platform: input.platform } }, create: { ...input, name: fileName, data, size: data.length, sha256: digest }, update: { minimumPlan: input.minimumPlan, name: fileName, data, size: data.length, sha256: digest, active: true, publishedAt: new Date() } });
    await prisma.platformAudit.create({ data: { actorUserId: request.auth.userId, action: 'admin.release.publish', entityType: 'ReleaseArtifact', entityId: item.id, metadata: { version: item.version, platform: item.platform, size: data.length, sha256: digest }, ipAddress: request.ip } });
    return reply.code(201).send({ id: item.id, version: item.version, platform: item.platform, minimumPlan: item.minimumPlan, size: item.size, sha256: item.sha256 });
  });

  app.patch('/releases/:id', async (request) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params); const { active } = z.object({ active: z.boolean() }).parse(request.body);
    const item = await prisma.releaseArtifact.update({ where: { id }, data: { active } });
    await prisma.platformAudit.create({ data: { actorUserId: request.auth.userId, action: 'admin.release.status', entityType: 'ReleaseArtifact', entityId: item.id, metadata: { active }, ipAddress: request.ip } });
    return { id: item.id, active: item.active };
  });
}
