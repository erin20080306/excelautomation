import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { fileTypeFromBuffer } from 'file-type';
import unzipper from 'unzipper';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { enqueueProcessingMessage, enqueueProcessingMessages } from '../lib/queue.js';
import type { StorageAdapter } from '../lib/storage.js';
import { assertSafeArchivePath, safeFileName } from '../lib/security.js';
import { writeAudit } from '../lib/audit.js';
import { createInlineProcessor } from '../lib/processor.js';
import { hasUnlimitedUsage } from '../lib/access.js';

const allowedExtensions = new Set(['.xlsx', '.xlsm', '.xls', '.csv', '.tsv']);
const allowedMime = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12', 'application/vnd.ms-excel',
  'text/csv', 'text/tab-separated-values', 'text/plain', 'application/zip'
]);

async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function validateSpreadsheet(filePath: string, originalName: string): Promise<{ extension: string; mimeType: string }> {
  const extension = path.extname(originalName).toLowerCase();
  if (!allowedExtensions.has(extension)) throw new Error(`不支援的檔案格式：${extension || '無副檔名'}`);
  const handle = await fsp.open(filePath, 'r');
  const prefix = Buffer.alloc(8192);
  const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
  await handle.close();
  const detected = await fileTypeFromBuffer(prefix.subarray(0, bytesRead));
  const mimeType = detected?.mime ?? (extension === '.csv' ? 'text/csv' : extension === '.tsv' ? 'text/tab-separated-values' : 'application/vnd.ms-excel');
  if (!allowedMime.has(mimeType)) throw new Error(`檔案內容與試算表格式不符：${originalName}`);
  if (extension === '.xlsx' || extension === '.xlsm') {
    if (detected?.ext !== 'xlsx' && detected?.ext !== 'zip') throw new Error(`Office 檔案結構無效：${originalName}`);
  }
  return { extension, mimeType };
}

async function persistSourceFile(input: {
  workspaceId: string; filePath: string; originalName: string; originalPath?: string; storage: StorageAdapter;
}): Promise<{ id: string; duplicate: boolean }> {
  const stat = await fsp.stat(input.filePath);
  const { extension, mimeType } = await validateSpreadsheet(input.filePath, input.originalName);
  const sha256 = await hashFile(input.filePath);
  const existing = await prisma.sourceFile.findUnique({ where: { workspaceId_sha256: { workspaceId: input.workspaceId, sha256 } } });
  if (existing) return { id: existing.id, duplicate: true };
  const fileName = safeFileName(input.originalName);
  const storageKey = `${input.workspaceId}/sources/${new Date().getUTCFullYear()}/${nanoid()}${extension}`;
  await input.storage.put(storageKey, input.filePath, mimeType);
  const created = await prisma.sourceFile.create({ data: {
    workspaceId: input.workspaceId, name: fileName, originalPath: input.originalPath,
    mimeType, extension, size: stat.size, sha256, storageKey,
    versions: { create: { version: 1, size: stat.size, sha256, storageKey } }
  } });
  return { id: created.id, duplicate: false };
}

async function extractZip(zipPath: string, tempDir: string, maxUncompressedBytes: number): Promise<Array<{ path: string; name: string; originalPath: string }>> {
  const archive = await unzipper.Open.file(zipPath);
  let total = 0;
  const output: Array<{ path: string; name: string; originalPath: string }> = [];
  for (const entry of archive.files) {
    if (entry.type !== 'File') continue;
    assertSafeArchivePath(entry.path);
    total += entry.uncompressedSize;
    if (total > maxUncompressedBytes) throw new Error('ZIP 解壓縮後大小超過限制');
    const extension = path.extname(entry.path).toLowerCase();
    if (!allowedExtensions.has(extension)) continue;
    const target = path.join(tempDir, `${nanoid()}${extension}`);
    await pipeline(entry.stream(), fs.createWriteStream(target, { flags: 'wx' }));
    output.push({ path: target, name: path.basename(entry.path), originalPath: entry.path });
  }
  if (!output.length) throw new Error('ZIP 內沒有可處理的試算表');
  if (output.length > 5000) throw new Error('單一 ZIP 最多包含 5,000 份試算表');
  return output;
}

export async function fileRoutes(app: FastifyInstance, storage: StorageAdapter): Promise<void> {
  app.addHook('preHandler', async (request) => {
    await app.authenticate(request);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) await app.authorize(request, 'content:write');
  });

  app.get('/', async (request) => {
    const query = z.object({ q: z.string().trim().optional(), reportType: z.string().optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
    const where = { workspaceId: request.auth.workspaceId, ...(query.q ? { name: { contains: query.q, mode: 'insensitive' as const } } : {}), ...(query.reportType ? { reportTypeKey: query.reportType } : {}) };
    const [items, total] = await Promise.all([
      prisma.sourceFile.findMany({ where, include: { sheets: { select: { id: true, name: true, maxRow: true, maxColumn: true } }, analyses: { orderBy: { version: 'desc' }, take: 1, select: { result: true, requiresReview: true } } }, orderBy: { createdAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      prisma.sourceFile.count({ where })
    ]);
    return { items, total };
  });

  app.get('/:id', async (request) => {
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const item = await prisma.sourceFile.findFirst({ where: { id, workspaceId: request.auth.workspaceId }, include: { sheets: { include: { regions: true, fields: true } }, analyses: { orderBy: { version: 'desc' }, take: 1 }, jobItems: { orderBy: { startedAt: 'desc' }, take: 1 } } });
    if (!item) throw app.httpErrors.notFound('找不到來源檔案');
    return item;
  });

  app.post('/upload', async (request, reply) => {
    const unlimited = hasUnlimitedUsage(request.auth.platformRole);
    const inlineProcessor = app.config.PROCESSING_MODE === 'inline' ? createInlineProcessor(storage, app.config, { unlimited, maxOutputMb: request.auth.outputMbQuota }) : null;
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'excelmaster-upload-'));
    const accepted: string[] = [];
    const duplicates: string[] = [];
    const rejected: Array<{ name: string; error: string }> = [];
    const processingErrors: Array<{ sourceFileId: string; error: string }> = [];
    let uploadedBytes = 0;
    let candidateCount = 0;
    let projectId: string | undefined;
    let batchName = `批次 ${new Date().toLocaleString('zh-TW', { hour12: false })}`;
    try {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'field') {
          if (part.fieldname === 'projectId' && typeof part.value === 'string' && part.value) projectId = part.value;
          if (part.fieldname === 'batchName' && typeof part.value === 'string' && part.value.trim()) batchName = part.value.trim().slice(0, 100);
          continue;
        }
        const incomingName = safeFileName(part.filename);
        const incomingPath = path.join(tempDir, `${nanoid()}${path.extname(incomingName).toLowerCase()}`);
        try {
          await pipeline(part.file, fs.createWriteStream(incomingPath, { flags: 'wx' }));
          if (part.file.truncated) throw new Error('檔案大小超過限制');
          if (inlineProcessor && !unlimited) {
            uploadedBytes += (await fsp.stat(incomingPath)).size;
            if (uploadedBytes > request.auth.totalMbQuota * 1024 * 1024) throw new Error(`目前方案單批上傳總量上限為 ${request.auth.totalMbQuota} MB`);
          }
          const candidates = path.extname(incomingName).toLowerCase() === '.zip'
            ? await extractZip(incomingPath, tempDir, app.config.MAX_ZIP_UNCOMPRESSED_MB * 1024 * 1024)
            : [{ path: incomingPath, name: incomingName, originalPath: part.filename }];
          for (const candidate of candidates) {
            try {
              candidateCount += 1;
              if (inlineProcessor && !unlimited && candidateCount > request.auth.fileQuota) throw new Error(`目前方案單批最多處理 ${request.auth.fileQuota} 份檔案`);
              const result = await persistSourceFile({ workspaceId: request.auth.workspaceId, filePath: candidate.path, originalName: candidate.name, originalPath: candidate.originalPath, storage });
              (result.duplicate ? duplicates : accepted).push(result.id);
            } catch (error) {
              rejected.push({ name: candidate.name, error: error instanceof Error ? error.message : '檔案驗證失敗' });
            }
          }
        } catch (error) {
          rejected.push({ name: incomingName, error: error instanceof Error ? error.message : '上傳失敗' });
        }
      }
      if (projectId) {
        const project = await prisma.integrationProject.findFirst({ where: { id: projectId, workspaceId: request.auth.workspaceId } });
        if (!project) throw app.httpErrors.badRequest('整合專案不存在');
      }
      let processingJob = null;
      if (accepted.length) {
        processingJob = await prisma.$transaction(async (tx) => {
          const created = await tx.processingJob.create({ data: { workspaceId: request.auth.workspaceId, projectId, name: batchName, totalItems: accepted.length, items: { create: accepted.map((sourceFileId) => ({ sourceFileId })) } }, include: { items: true } });
          if (!inlineProcessor) await enqueueProcessingMessages(tx, created.items.map((item) => ({ type: 'analyze-file', processingJobId: created.id, itemId: item.id, maxAttempts: 3 })));
          return created;
        }, { maxWait: 10_000, timeout: 30_000 });
        if (inlineProcessor) {
          for (const item of processingJob.items) {
            try {
              await inlineProcessor.analyzeItem({ type: 'analyze-file', processingJobId: processingJob.id, itemId: item.id, maxAttempts: 1 });
            } catch (error) {
              processingErrors.push({ sourceFileId: item.sourceFileId, error: error instanceof Error ? error.message : '分析失敗' });
            }
          }
          processingJob = await prisma.processingJob.findUnique({ where: { id: processingJob.id }, include: { items: true } });
        }
      }
      await writeAudit({ workspaceId: request.auth.workspaceId, userId: request.auth.userId, action: 'files.upload', entityType: 'ProcessingJob', entityId: processingJob?.id, metadata: { accepted: accepted.length, duplicates: duplicates.length, rejected: rejected.length }, ipAddress: request.ip });
      return reply.code(inlineProcessor ? 201 : 202).send({ job: processingJob, accepted: accepted.length, duplicates: duplicates.length, rejected, processingErrors, processingMode: inlineProcessor ? 'inline' : 'queue' });
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  app.post('/:id/reanalyze', async (request, reply) => {
    const unlimited = hasUnlimitedUsage(request.auth.platformRole);
    const inlineProcessor = app.config.PROCESSING_MODE === 'inline' ? createInlineProcessor(storage, app.config, { unlimited, maxOutputMb: request.auth.outputMbQuota }) : null;
    const { id } = z.object({ id: z.string().cuid() }).parse(request.params);
    const source = await prisma.sourceFile.findFirst({ where: { id, workspaceId: request.auth.workspaceId } });
    if (!source) throw app.httpErrors.notFound('找不到來源檔案');
    const job = await prisma.$transaction(async (tx) => {
      const created = await tx.processingJob.create({ data: { workspaceId: request.auth.workspaceId, name: `重新分析：${source.name}`, totalItems: 1, items: { create: { sourceFileId: id } } }, include: { items: true } });
      const item = created.items[0];
      if (!item) throw new Error('無法建立處理項目');
      if (!inlineProcessor) await enqueueProcessingMessage(tx, { type: 'analyze-file', processingJobId: created.id, itemId: item.id, maxAttempts: 3 });
      return created;
    }, { maxWait: 10_000, timeout: 30_000 });
    if (inlineProcessor) {
      const item = job.items[0];
      if (!item) throw new Error('無法建立處理項目');
      await inlineProcessor.analyzeItem({ type: 'analyze-file', processingJobId: job.id, itemId: item.id, maxAttempts: 1 });
      return reply.code(200).send(await prisma.processingJob.findUniqueOrThrow({ where: { id: job.id }, include: { items: true } }));
    }
    return reply.code(202).send(job);
  });
}
