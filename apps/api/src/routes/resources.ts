import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { writeAudit } from '../lib/audit.js';
import { encryptSecret, maskSensitive } from '../lib/security.js';
import { REPORT_TYPES, reportTypeLabels } from '@excelmaster/shared';
import type { Prisma } from '@prisma/client';

const listQuery = z.object({ q: z.string().trim().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });

export async function resourceRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request) => {
    await app.authenticate(request);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) await app.authorize(request, 'content:write');
  });

  app.get('/dashboard', async (request) => {
    const workspaceId = request.auth.workspaceId;
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const [files, jobsThisMonth, completedJobs, reviewTasks, recentJobs] = await Promise.all([
      prisma.sourceFile.count({ where: { workspaceId } }),
      prisma.processingJob.count({ where: { workspaceId, createdAt: { gte: monthStart } } }),
      prisma.processingJob.count({ where: { workspaceId, status: 'completed' } }),
      prisma.reviewTask.count({ where: { workspaceId, status: 'OPEN' } }),
      prisma.processingJob.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, name: true, status: true, createdAt: true, progress: true } })
    ]);
    return { files, jobsThisMonth, completedJobs, reviewTasks, recentJobs };
  });

  app.get('/projects', async (request) => {
    const query = listQuery.parse(request.query);
    const where = { workspaceId: request.auth.workspaceId, ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}) };
    const [items, total] = await Promise.all([
      prisma.integrationProject.findMany({ where, include: { schema: { select: { id: true, name: true } }, _count: { select: { jobs: true } } }, orderBy: { updatedAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.integrationProject.count({ where })
    ]);
    return { items, total };
  });

  app.post('/projects', async (request, reply) => {
    const body = z.object({ name: z.string().trim().min(2).max(100), description: z.string().trim().max(500).optional(), reportTypeKey: z.enum(REPORT_TYPES).optional(), schemaId: z.string().cuid().optional(), mode: z.enum(['append', 'join', 'lookup', 'group', 'split', 'transform']).default('append'), config: z.record(z.unknown()).default({}) }).parse(request.body);
    if (body.schemaId) {
      const schema = await prisma.dynamicSchema.findFirst({ where: { id: body.schemaId, workspaceId: request.auth.workspaceId } });
      if (!schema) throw app.httpErrors.badRequest('欄位 Schema 不存在');
    }
    const item = await prisma.integrationProject.create({ data: { ...body, workspaceId: request.auth.workspaceId, config: body.config as object } });
    await writeAudit({ workspaceId: request.auth.workspaceId, userId: request.auth.userId, action: 'project.create', entityType: 'IntegrationProject', entityId: item.id, ipAddress: request.ip });
    return reply.code(201).send(item);
  });

  app.patch('/projects/:id', async (request) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const body = z.object({ name: z.string().trim().min(2).max(100).optional(), description: z.string().trim().max(500).nullable().optional(), reportTypeKey: z.enum(REPORT_TYPES).nullable().optional(), schemaId: z.string().cuid().nullable().optional(), mode: z.enum(['append', 'join', 'lookup', 'group', 'split', 'transform']).optional(), config: z.record(z.unknown()).optional(), active: z.boolean().optional() }).parse(request.body);
    const owned = await prisma.integrationProject.findFirst({ where: { id, workspaceId: request.auth.workspaceId } });
    if (!owned) throw app.httpErrors.notFound('找不到整合專案');
    const item = await prisma.integrationProject.update({ where: { id }, data: { ...body, config: body.config as object | undefined } });
    await writeAudit({ workspaceId: request.auth.workspaceId, userId: request.auth.userId, action: 'project.update', entityType: 'IntegrationProject', entityId: id });
    return item;
  });

  app.get('/schemas', async (request) => {
    const items = await prisma.dynamicSchema.findMany({ where: { workspaceId: request.auth.workspaceId }, include: { reportType: true, fields: { orderBy: { position: 'asc' }, include: { aliases: true } } }, orderBy: { updatedAt: 'desc' } });
    return { items, total: items.length };
  });

  app.post('/schemas', async (request, reply) => {
    const body = z.object({ name: z.string().trim().min(2).max(100), reportTypeKey: z.enum(REPORT_TYPES).optional(), fields: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]*$/), name: z.string().trim().min(1), type: z.enum(['text', 'integer', 'decimal', 'money', 'date', 'datetime', 'percentage', 'boolean', 'email', 'phone', 'option', 'custom']), required: z.boolean().default(false), uniqueKey: z.boolean().default(false), aliases: z.array(z.string().trim().min(1)).default([]), defaultValue: z.string().optional(), formula: z.string().optional() })).min(1) }).parse(request.body);
    const reportType = body.reportTypeKey ? await prisma.reportType.findUnique({ where: { workspaceId_key: { workspaceId: request.auth.workspaceId, key: body.reportTypeKey } } }) : null;
    const item = await prisma.dynamicSchema.create({ data: { workspaceId: request.auth.workspaceId, name: body.name, reportTypeId: reportType?.id, fields: { create: body.fields.map((field, position) => ({ key: field.key, name: field.name, type: field.type, required: field.required, uniqueKey: field.uniqueKey, position, defaultValue: field.defaultValue, formula: field.formula, aliases: { create: field.aliases.map((alias) => ({ alias, normalized: alias.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') })) } })) } }, include: { fields: { include: { aliases: true } } } });
    await writeAudit({ workspaceId: request.auth.workspaceId, userId: request.auth.userId, action: 'schema.create', entityType: 'DynamicSchema', entityId: item.id });
    return reply.code(201).send(item);
  });

  app.get('/report-types', async (request) => {
    const items = await prisma.reportType.findMany({ where: { workspaceId: request.auth.workspaceId }, orderBy: { name: 'asc' } });
    return { items, total: items.length };
  });

  app.get('/sources', async (request) => {
    const items = await prisma.dataSource.findMany({ where: { workspaceId: request.auth.workspaceId }, orderBy: { updatedAt: 'desc' }, select: { id: true, name: true, kind: true, config: true, enabled: true, lastSyncedAt: true, createdAt: true, updatedAt: true } });
    return { items, total: items.length, capabilities: { google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET), microsoft: Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET), s3: app.config.STORAGE_DRIVER === 's3' } };
  });

  app.post('/sources', async (request, reply) => {
    const body = z.object({ name: z.string().trim().min(2).max(100), kind: z.enum(['UPLOAD', 'FOLDER', 'ZIP', 'GOOGLE_DRIVE', 'ONEDRIVE', 'SHAREPOINT', 'GMAIL', 'OUTLOOK', 'LOCAL_AGENT', 'S3', 'API']), config: z.record(z.unknown()).default({}), credential: z.string().min(1).optional() }).parse(request.body);
    const external = ['GOOGLE_DRIVE', 'ONEDRIVE', 'SHAREPOINT', 'GMAIL', 'OUTLOOK', 'S3'];
    if (external.includes(body.kind) && !body.credential) throw app.httpErrors.badRequest('此資料來源需要授權憑證');
    const item = await prisma.dataSource.create({ data: { workspaceId: request.auth.workspaceId, name: body.name, kind: body.kind, config: body.config as object, encryptedCredential: body.credential ? encryptSecret(body.credential, app.config.FIELD_ENCRYPTION_KEY) : undefined } });
    await writeAudit({ workspaceId: request.auth.workspaceId, userId: request.auth.userId, action: 'source.create', entityType: 'DataSource', entityId: item.id, metadata: { kind: body.kind } });
    return reply.code(201).send({ ...item, encryptedCredential: undefined });
  });

  app.delete('/sources/:id', async (request, reply) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const result = await prisma.dataSource.deleteMany({ where: { id, workspaceId: request.auth.workspaceId } });
    if (!result.count) throw app.httpErrors.notFound('找不到資料來源');
    await writeAudit({ workspaceId: request.auth.workspaceId, userId: request.auth.userId, action: 'source.delete', entityType: 'DataSource', entityId: id });
    return reply.code(204).send();
  });

  app.get('/reviews', async (request) => {
    const query = z.object({ status: z.enum(['OPEN', 'RESOLVED', 'IGNORED']).default('OPEN') }).parse(request.query);
    const items = await prisma.reviewTask.findMany({ where: { workspaceId: request.auth.workspaceId, status: query.status }, orderBy: { createdAt: 'desc' } });
    return { items, total: items.length };
  });

  app.patch('/reviews/:id', async (request) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const body = z.object({ status: z.enum(['RESOLVED', 'IGNORED']), resolution: z.record(z.unknown()).default({}), applyToTemplate: z.boolean().default(false) }).parse(request.body);
    const task = await prisma.reviewTask.findFirst({ where: { id, workspaceId: request.auth.workspaceId } });
    if (!task) throw app.httpErrors.notFound('找不到待確認項目');
    const updated = await prisma.reviewTask.update({ where: { id }, data: { status: body.status, resolution: body.resolution as object, resolvedAt: new Date() } });
    if (body.status === 'RESOLVED' && task.sourceFileId) {
      const payload = task.payload as Record<string, any>;
      const latest = await prisma.analysisResult.findFirst({ where: { sourceFileId: task.sourceFileId }, orderBy: { version: 'desc' } });
      if (latest) {
        const analysis = structuredClone(latest.result) as Record<string, any>;
        if (task.type === 'classification') {
          const selectedType = String(body.resolution.selectedType ?? body.resolution.targetKey ?? '');
          if (!REPORT_TYPES.includes(selectedType as any)) throw app.httpErrors.badRequest('報表類型不存在');
          analysis.classification = { ...analysis.classification, type: selectedType, confidence: 1, reasons: ['使用者人工確認'] };
          await prisma.sourceFile.update({ where: { id: task.sourceFileId }, data: { reportTypeKey: selectedType, confidence: 1 } });
        }
        if (task.type === 'field_mapping') {
          const targetKey = String(body.resolution.targetKey ?? '');
          if (!targetKey) throw app.httpErrors.badRequest('請指定標準欄位');
          for (const sheet of analysis.workbook?.sheets ?? []) {
            if (sheet.name !== payload.sheet) continue;
            const field = sheet.fields?.find((candidate: any) => candidate.sourceName === payload.sourceName);
            if (field) Object.assign(field, { targetKey, confidence: 1, requiresReview: false, evidence: ['使用者人工確認'] });
          }
          await prisma.detectedField.updateMany({ where: { sourceName: String(payload.sourceName), sourceSheet: { sourceFileId: task.sourceFileId, name: String(payload.sheet) } }, data: { targetKey, confidence: 1, evidence: ['使用者人工確認'] } });
          if (body.applyToTemplate) await prisma.mappingRule.create({ data: { workspaceId: request.auth.workspaceId, sourcePattern: String(payload.sourceName), targetFieldKey: targetKey, reportTypeKey: analysis.classification?.type, confidence: 1 } });
        }
        if (task.type === 'header') {
          const selectedRow = Number(body.resolution.targetKey ?? body.resolution.selectedRow);
          if (!Number.isInteger(selectedRow) || selectedRow < 1) throw app.httpErrors.badRequest('表頭列必須是正整數');
          const sheet = analysis.workbook?.sheets?.find((candidate: any) => candidate.name === payload.sheet);
          if (sheet) Object.assign(sheet, { headerRow: selectedRow, headerConfidence: 1 });
        }
        const remaining = await prisma.reviewTask.count({ where: { workspaceId: request.auth.workspaceId, sourceFileId: task.sourceFileId, status: 'OPEN' } });
        analysis.requiresReview = remaining > 0;
        await prisma.analysisResult.update({ where: { id: latest.id }, data: { result: analysis as Prisma.InputJsonValue, requiresReview: remaining > 0 } });
        if (!remaining) await prisma.sourceFile.update({ where: { id: task.sourceFileId }, data: { status: 'completed' } });
      }
    }
    await writeAudit({ workspaceId: request.auth.workspaceId, userId: request.auth.userId, action: 'review.resolve', entityType: 'ReviewTask', entityId: id });
    return updated;
  });

  app.get('/templates', async (request) => {
    const items = await prisma.parsingTemplate.findMany({ where: { workspaceId: request.auth.workspaceId }, include: { reportType: true, versions: { orderBy: { version: 'desc' }, take: 1 } }, orderBy: { updatedAt: 'desc' } });
    return { items, total: items.length };
  });

  app.post('/templates', async (request, reply) => {
    const body = z.object({ name: z.string().trim().min(2).max(100), reportTypeKey: z.enum(REPORT_TYPES).optional(), config: z.record(z.unknown()) }).parse(request.body);
    const reportType = body.reportTypeKey ? await prisma.reportType.findUnique({ where: { workspaceId_key: { workspaceId: request.auth.workspaceId, key: body.reportTypeKey } } }) : null;
    const item = await prisma.parsingTemplate.create({ data: { workspaceId: request.auth.workspaceId, name: body.name, reportTypeId: reportType?.id, createdById: request.auth.userId, versions: { create: { version: 1, config: body.config as object } } }, include: { versions: true } });
    await writeAudit({ workspaceId: request.auth.workspaceId, userId: request.auth.userId, action: 'template.create', entityType: 'ParsingTemplate', entityId: item.id });
    return reply.code(201).send(item);
  });

  app.post('/templates/:id/versions', async (request, reply) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const body = z.object({ config: z.record(z.unknown()).optional(), fromVersion: z.number().int().positive().optional() }).refine((value) => Boolean(value.config) !== Boolean(value.fromVersion), '請提供 config 或 fromVersion 其中一項').parse(request.body);
    const template = await prisma.parsingTemplate.findFirst({ where: { id, workspaceId: request.auth.workspaceId } });
    if (!template) throw app.httpErrors.notFound('找不到解析模板');
    let config = body.config;
    if (body.fromVersion) {
      const source = await prisma.parsingTemplateVersion.findUnique({ where: { templateId_version: { templateId: id, version: body.fromVersion } } });
      if (!source) throw app.httpErrors.notFound('找不到指定的舊版本');
      config = source.config as Record<string, unknown>;
    }
    const nextVersion = template.currentVersion + 1;
    const version = await prisma.$transaction(async (tx) => {
      const created = await tx.parsingTemplateVersion.create({ data: { templateId: id, version: nextVersion, config: config as object } });
      await tx.parsingTemplate.update({ where: { id }, data: { currentVersion: nextVersion } });
      return created;
    });
    await writeAudit({ workspaceId: request.auth.workspaceId, userId: request.auth.userId, action: body.fromVersion ? 'template.rollback' : 'template.version.create', entityType: 'ParsingTemplate', entityId: id, metadata: { version: nextVersion, fromVersion: body.fromVersion } });
    return reply.code(201).send(version);
  });

  app.patch('/templates/:id', async (request) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const { active } = z.object({ active: z.boolean() }).parse(request.body);
    const result = await prisma.parsingTemplate.updateMany({ where: { id, workspaceId: request.auth.workspaceId }, data: { active } });
    if (!result.count) throw app.httpErrors.notFound('找不到解析模板');
    await writeAudit({ workspaceId: request.auth.workspaceId, userId: request.auth.userId, action: 'template.status.update', entityType: 'ParsingTemplate', entityId: id, metadata: { active } });
    return { ok: true };
  });

  app.get('/jobs', async (request) => {
    const query = z.object({ status: z.enum(['queued', 'downloading', 'validating', 'analyzing', 'classifying', 'parsing', 'mapping', 'cleaning', 'awaiting_review', 'exporting', 'completed', 'failed', 'cancelled']).optional() }).parse(request.query);
    const items = await prisma.processingJob.findMany({ where: { workspaceId: request.auth.workspaceId, status: query.status }, include: { _count: { select: { items: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { items, total: items.length };
  });

  app.post('/jobs/:id/cancel', async (request) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const job = await prisma.processingJob.findFirst({ where: { id, workspaceId: request.auth.workspaceId } });
    if (!job) throw app.httpErrors.notFound('找不到處理批次');
    if (['completed', 'failed', 'cancelled'].includes(job.status)) throw app.httpErrors.badRequest('此批次已結束');
    await prisma.$transaction([
      prisma.processingJob.update({ where: { id }, data: { status: 'cancelled', completedAt: new Date() } }),
      prisma.processingJobItem.updateMany({ where: { jobId: id, status: { notIn: ['completed', 'failed'] } }, data: { status: 'cancelled' } })
    ]);
    await writeAudit({ workspaceId: request.auth.workspaceId, userId: request.auth.userId, action: 'job.cancel', entityType: 'ProcessingJob', entityId: id });
    return { ok: true };
  });

  app.get('/audit-logs', async (request) => {
    const query = listQuery.parse(request.query);
    const where = { workspaceId: request.auth.workspaceId, ...(query.q ? { action: { contains: query.q, mode: 'insensitive' as const } } : {}) };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({ where, include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.auditLog.count({ where })
    ]);
    return { items: items.map((item) => ({ ...item, metadata: Object.fromEntries(Object.entries(item.metadata as object).map(([key, value]) => [key, maskSensitive(value)])) })), total };
  });

  app.get('/settings', async (request) => {
    const items = await prisma.appSetting.findMany({ where: { workspaceId: request.auth.workspaceId, encrypted: false } });
    return Object.fromEntries(items.map((item) => [item.key, item.value]));
  });

  app.put('/settings', async (request) => {
    await app.authorize(request, 'workspace:manage');
    const settings = z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.unknown()), z.record(z.unknown())])).parse(request.body);
    await prisma.$transaction(Object.entries(settings).map(([key, value]) => prisma.appSetting.upsert({ where: { workspaceId_key: { workspaceId: request.auth.workspaceId, key } }, create: { workspaceId: request.auth.workspaceId, key, value: value as any }, update: { value: value as any } })));
    await writeAudit({ workspaceId: request.auth.workspaceId, userId: request.auth.userId, action: 'settings.update', metadata: { keys: Object.keys(settings) } });
    return { ok: true };
  });

  app.get('/search', async (request) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(100) }).parse(request.query);
    const workspaceId = request.auth.workspaceId;
    const [files, projects, jobs] = await Promise.all([
      prisma.sourceFile.findMany({ where: { workspaceId, name: { contains: q, mode: 'insensitive' } }, take: 10, select: { id: true, name: true, status: true, createdAt: true } }),
      prisma.integrationProject.findMany({ where: { workspaceId, name: { contains: q, mode: 'insensitive' } }, take: 10, select: { id: true, name: true, mode: true, updatedAt: true } }),
      prisma.processingJob.findMany({ where: { workspaceId, name: { contains: q, mode: 'insensitive' } }, take: 10, select: { id: true, name: true, status: true, createdAt: true } })
    ]);
    return { files, projects, jobs };
  });

  app.get('/metadata/report-types', async () => ({ items: REPORT_TYPES.map((key) => ({ key, label: reportTypeLabels[key] })) }));
}
