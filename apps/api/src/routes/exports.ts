import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { enqueueProcessingMessage } from '../lib/queue.js';
import type { StorageAdapter } from '../lib/storage.js';
import { signDownload, verifyDownload } from '../lib/security.js';
import { writeAudit } from '../lib/audit.js';
import { createInlineProcessor } from '../lib/processor.js';
import { hasUnlimitedUsage } from '../lib/access.js';

const exportConfig = z.object({
  separateFiles: z.boolean().default(false),
  separateSourceSheets: z.boolean().default(true),
  mergeAll: z.boolean().default(true),
  mergeByType: z.boolean().default(true),
  includeAllDetails: z.boolean().default(true),
  includeProfessionalReport: z.boolean().default(true),
  includeGasReport: z.boolean().default(true),
  includeOverview: z.boolean().default(true),
  includeStatistics: z.boolean().default(false),
  preserveRaw: z.boolean().default(false),
  includeExceptions: z.boolean().default(true),
  includeMappings: z.boolean().default(true),
  includeAudit: z.boolean().default(true),
  splitBy: z.string().trim().optional()
});

export async function exportRoutes(app: FastifyInstance, storage: StorageAdapter): Promise<void> {
  app.addHook('preHandler', async (request) => {
    if ((request.routeOptions.config as unknown as Record<string, unknown>).public) return;
    await app.authenticate(request);
    if (request.method === 'POST' && !request.routeOptions.url?.endsWith('/:id/sign')) await app.authorize(request, 'content:write');
  });

  app.get('/', async (request) => {
    const items = await prisma.exportJob.findMany({ where: { workspaceId: request.auth.workspaceId }, include: { files: true, processingJob: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { items, total: items.length };
  });

  app.post('/', async (request, reply) => {
    const unlimited = hasUnlimitedUsage(request.auth.platformRole);
    const inlineProcessor = app.config.PROCESSING_MODE === 'inline' ? createInlineProcessor(storage, app.config, { unlimited, maxOutputMb: request.auth.outputMbQuota }) : null;
    const body = z.object({ processingJobId: z.string().cuid(), name: z.string().trim().min(2).max(120), config: exportConfig }).parse(request.body);
    const processingJob = await prisma.processingJob.findFirst({ where: { id: body.processingJobId, workspaceId: request.auth.workspaceId }, include: { items: true } });
    if (!processingJob) throw app.httpErrors.notFound('找不到處理批次');
    if (!['completed', 'awaiting_review'].includes(processingJob.status)) throw app.httpErrors.badRequest('批次尚未完成分析');
    let exportJob = await prisma.$transaction(async (tx) => {
      const created = await tx.exportJob.create({ data: { workspaceId: request.auth.workspaceId, processingJobId: body.processingJobId, name: body.name, config: body.config } });
      if (!inlineProcessor) await enqueueProcessingMessage(tx, { type: 'export-workbook', exportJobId: created.id, maxAttempts: 2 });
      return created;
    }, { maxWait: 10_000, timeout: 30_000 });
    if (inlineProcessor) {
      await inlineProcessor.exportWorkbook({ type: 'export-workbook', exportJobId: exportJob.id, maxAttempts: 1 });
      exportJob = await prisma.exportJob.findUniqueOrThrow({ where: { id: exportJob.id }, include: { files: true } });
    }
    await writeAudit({ workspaceId: request.auth.workspaceId, userId: request.auth.userId, action: 'export.create', entityType: 'ExportJob', entityId: exportJob.id });
    return reply.code(inlineProcessor ? 201 : 202).send(exportJob);
  });

  app.post('/:id/sign', async (request) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const file = await prisma.exportFile.findFirst({ where: { id, exportJob: { workspaceId: request.auth.workspaceId } } });
    if (!file) throw app.httpErrors.notFound('找不到匯出檔案');
    const token = signDownload({ exportFileId: file.id, workspaceId: request.auth.workspaceId }, app.config.JWT_SECRET);
    return { url: `${request.protocol}://${request.host}/api/exports/download/${token}`, expiresIn: 600 };
  });

  app.get('/download/:token', { config: { public: true } }, async (request, reply) => {
    const { token } = z.object({ token: z.string().min(20) }).parse(request.params);
    let payload: { exportFileId: string; workspaceId: string };
    try { payload = verifyDownload(token, app.config.JWT_SECRET); }
    catch { return reply.code(401).send({ message: '下載連結已失效' }); }
    const file = await prisma.exportFile.findFirst({ where: { id: payload.exportFileId, exportJob: { workspaceId: payload.workspaceId } } });
    if (!file) throw app.httpErrors.notFound('找不到匯出檔案');
    reply.header('Content-Type', file.mimeType);
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(await storage.getStream(file.storageKey));
  });
}
