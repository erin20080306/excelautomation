import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { writeAudit } from '../lib/audit.js';
import { buildSourceContext, generateGeminiCode, inspectGeneratedCode, type CodeTarget } from '../lib/gemini-code.js';

const targetSchema = z.enum(['VBA', 'APPS_SCRIPT', 'BOTH']);

function currentUtcMonth(): { start: Date; end: Date } {
  const now = new Date();
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  };
}

async function usageForMonth(workspaceId: string): Promise<number> {
  const { start, end } = currentUtcMonth();
  return prisma.codeGeneration.count({ where: { workspaceId, status: 'SUCCEEDED', createdAt: { gte: start, lt: end } } });
}

export async function codeStudioRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request) => {
    await app.authenticate(request);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) await app.authorize(request, 'content:write');
  });

  app.get('/capabilities', async (request) => {
    const used = await usageForMonth(request.auth.workspaceId);
    const quota = request.auth.platformRole === 'SUPERADMIN' ? null : request.auth.codeGenerationQuota;
    return {
      enabled: Boolean(app.config.GEMINI_API_KEY),
      model: app.config.GEMINI_MODEL,
      used,
      quota,
      remaining: quota == null ? null : Math.max(0, quota - used),
      privacy: '僅傳送工作表結構、表頭與欄位語意；不傳送原始儲存格資料。',
      execution: '產生的程式碼不會自動執行，請先檢查並在副本測試。'
    };
  });

  app.get('/history', async (request) => {
    const items = await prisma.codeGeneration.findMany({
      where: { workspaceId: request.auth.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, target: true, requirement: true, result: true, model: true, status: true, totalTokens: true, estimatedCostUsd: true, errorMessage: true, createdAt: true }
    });
    return { items, total: items.length };
  });

  app.post('/generate', async (request, reply) => {
    const body = z.object({
      target: targetSchema.default('BOTH'),
      requirement: z.string().trim().min(10, '請至少輸入 10 個字的需求').max(4_000),
      sourceFileIds: z.array(z.string().cuid()).max(5).default([])
    }).parse(request.body);
    if (!app.config.GEMINI_API_KEY) return reply.code(503).send({ message: '智慧程式碼服務尚未啟用，管理員需先設定伺服器端 Gemini 金鑰。' });
    const used = await usageForMonth(request.auth.workspaceId);
    if (request.auth.platformRole !== 'SUPERADMIN' && used >= request.auth.codeGenerationQuota) {
      return reply.code(429).send({ message: `本月智慧程式碼額度 ${request.auth.codeGenerationQuota} 次已用完，請升級方案或等候下月重置。` });
    }

    const sourceFileIds = [...new Set(body.sourceFileIds)];
    const files = sourceFileIds.length ? await prisma.sourceFile.findMany({
      where: { id: { in: sourceFileIds }, workspaceId: request.auth.workspaceId },
      include: { sheets: { orderBy: { position: 'asc' }, include: { fields: { orderBy: { columnIndex: 'asc' } } } } }
    }) : [];
    if (files.length !== sourceFileIds.length) return reply.code(400).send({ message: '部分來源檔案不存在或不屬於目前工作區。' });
    const pending = files.filter((file) => !['completed', 'awaiting_review'].includes(file.status));
    if (pending.length) return reply.code(409).send({ message: `請先完成來源分析：${pending.map((file) => file.name).join('、')}` });
    const sourceContext = buildSourceContext(files);

    try {
      const generated = await generateGeminiCode({ config: app.config, target: body.target as CodeTarget, requirement: body.requirement, sourceContext });
      const inspection = inspectGeneratedCode(generated.result);
      if (inspection.blocked) {
        await prisma.codeGeneration.create({ data: {
          workspaceId: request.auth.workspaceId,
          userId: request.auth.userId,
          target: body.target,
          requirement: body.requirement,
          sourceContext: sourceContext as Prisma.InputJsonValue,
          model: app.config.GEMINI_MODEL,
          status: 'FAILED',
          errorMessage: inspection.warnings.join('；'),
          ...generated.usage
        } });
        return reply.code(422).send({ message: '安全檢查攔截了危險程式碼，未提供下載。請調整需求後重新產生。', safetyNotes: inspection.warnings });
      }
      const result = { ...generated.result, safetyNotes: [...new Set([...generated.result.safetyNotes, ...inspection.warnings])] };
      const item = await prisma.codeGeneration.create({ data: {
        workspaceId: request.auth.workspaceId,
        userId: request.auth.userId,
        target: body.target,
        requirement: body.requirement,
        sourceContext: sourceContext as Prisma.InputJsonValue,
        result: result as Prisma.InputJsonValue,
        model: app.config.GEMINI_MODEL,
        status: 'SUCCEEDED',
        ...generated.usage
      } });
      await writeAudit({
        workspaceId: request.auth.workspaceId,
        userId: request.auth.userId,
        action: 'code.generate',
        entityType: 'CodeGeneration',
        entityId: item.id,
        metadata: { target: body.target, sourceFiles: sourceFileIds.length, model: app.config.GEMINI_MODEL, totalTokens: generated.usage.totalTokens },
        ipAddress: request.ip
      });
      return reply.code(201).send({ item: { ...item, result }, usage: { used: used + 1, quota: request.auth.platformRole === 'SUPERADMIN' ? null : request.auth.codeGenerationQuota } });
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 1_000) : '智慧程式碼產生失敗';
      await prisma.codeGeneration.create({ data: {
        workspaceId: request.auth.workspaceId,
        userId: request.auth.userId,
        target: body.target,
        requirement: body.requirement,
        sourceContext: sourceContext as Prisma.InputJsonValue,
        model: app.config.GEMINI_MODEL,
        status: 'FAILED',
        errorMessage: message
      } });
      request.log.warn({ err: error, target: body.target, sourceFileCount: sourceFileIds.length }, 'Gemini code generation failed');
      return reply.code(502).send({ message });
    }
  });
}
