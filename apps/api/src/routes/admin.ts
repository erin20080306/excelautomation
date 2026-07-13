import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { PLAN_CATALOG } from '../lib/plans.js';

const planSchema = z.enum(['TRIAL', 'STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE']);

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request) => {
    await app.authenticate(request);
    if (request.auth.platformRole !== 'SUPERADMIN') throw app.httpErrors.forbidden('需要平台 SUPERADMIN 權限');
  });

  app.get('/overview', async () => {
    const [users, workspaces, paidOrders, downloads, suspendedUsers] = await Promise.all([
      prisma.user.count(), prisma.workspace.count(), prisma.paymentOrder.count({ where: { status: 'PAID' } }), prisma.packageDownload.count({ where: { usedAt: { not: null } } }), prisma.user.count({ where: { status: 'SUSPENDED' } })
    ]);
    return { users, workspaces, paidOrders, downloads, suspendedUsers };
  });

  app.get('/users', async (request) => {
    const { q } = z.object({ q: z.string().trim().optional() }).parse(request.query);
    const items = await prisma.user.findMany({ where: q ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] } : {}, include: { memberships: { include: { workspace: true } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { items: items.map(({ passwordHash: _passwordHash, mfaSecretEncrypted: _mfaSecret, ...user }) => user) };
  });

  app.patch('/users/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const body = z.object({ status: z.enum(['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED']).optional(), platformRole: z.enum(['USER', 'SUPERADMIN']).optional(), emailVerified: z.boolean().optional() }).parse(request.body);
    if (id === request.auth.userId && ((body.status && body.status !== 'ACTIVE') || body.platformRole === 'USER' || body.emailVerified === false)) return reply.code(400).send({ message: '不可停權、取消驗證或降級目前登入的 SUPERADMIN' });
    const item = await prisma.user.update({ where: { id }, data: { status: body.status, platformRole: body.platformRole, emailVerifiedAt: body.emailVerified === undefined ? undefined : body.emailVerified ? new Date() : null } });
    await prisma.platformAudit.create({ data: { actorUserId: request.auth.userId, action: 'admin.user.update', entityType: 'User', entityId: id, metadata: body, ipAddress: request.ip } });
    return { id: item.id, status: item.status, platformRole: item.platformRole, emailVerifiedAt: item.emailVerifiedAt };
  });

  app.get('/workspaces', async () => {
    const items = await prisma.workspace.findMany({ include: { _count: { select: { members: true, sourceFiles: true, packageDownloads: true } }, members: { where: { role: 'OWNER' }, take: 1, include: { user: { select: { email: true, name: true } } } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { items };
  });

  app.patch('/workspaces/:id', async (request) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const body = z.object({ plan: planSchema.optional(), suspended: z.boolean().optional(), fileQuota: z.number().int().min(1).max(10_000).optional(), totalMbQuota: z.number().positive().max(5000).optional(), outputMbQuota: z.number().positive().max(5000).optional(), downloadQuota: z.number().int().min(0).max(10_000).optional() }).parse(request.body);
    const defaults = body.plan ? PLAN_CATALOG[body.plan] : null;
    const item = await prisma.workspace.update({ where: { id }, data: {
      plan: body.plan, suspendedAt: body.suspended === undefined ? undefined : body.suspended ? new Date() : null,
      fileQuota: body.fileQuota ?? defaults?.fileQuota, totalMbQuota: body.totalMbQuota ?? defaults?.totalMbQuota,
      outputMbQuota: body.outputMbQuota ?? defaults?.outputMbQuota, downloadQuota: body.downloadQuota ?? defaults?.downloadQuota
    } });
    await prisma.platformAudit.create({ data: { actorUserId: request.auth.userId, action: 'admin.workspace.update', entityType: 'Workspace', entityId: id, metadata: body, ipAddress: request.ip } });
    return item;
  });

  app.get('/payments', async () => ({ items: await prisma.paymentOrder.findMany({ include: { user: { select: { email: true, name: true } }, workspace: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }) }));
  app.get('/downloads', async () => ({ items: await prisma.packageDownload.findMany({ include: { user: { select: { email: true } }, workspace: { select: { name: true, plan: true } }, release: { select: { version: true, platform: true, sha256: true } } }, orderBy: { requestedAt: 'desc' }, take: 200 }) }));
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
