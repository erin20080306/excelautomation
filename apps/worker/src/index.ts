import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker, type Job } from 'bullmq';
import axios from 'axios';
import FormData from 'form-data';
import { PrismaClient, type Prisma } from '@prisma/client';
import { analysisSchema, runIntegration, type DataSet, type PipelineOperation, type WorkbookAnalysis } from '@excelmaster/shared';
import { createWorkerStorage } from './storage.js';

const prisma = new PrismaClient();
const storage = createWorkerStorage();
const parserUrl = process.env.PARSER_URL ?? 'http://localhost:8000';
const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
const connection = {
  host: redisUrl.hostname, port: Number(redisUrl.port || 6379), username: redisUrl.username || undefined,
  password: redisUrl.password || undefined, db: Number(redisUrl.pathname.slice(1) || 0), tls: redisUrl.protocol === 'rediss:' ? {} : undefined
};

async function updateStage(itemId: string, status: any, progress: number): Promise<void> {
  await prisma.processingJobItem.update({ where: { id: itemId }, data: { status, progress, startedAt: progress > 0 ? new Date() : undefined } });
}

async function finalizeBatch(processingJobId: string): Promise<void> {
  const items = await prisma.processingJobItem.findMany({ where: { jobId: processingJobId } });
  const completedItems = items.filter((item) => item.status === 'completed').length;
  const failedItems = items.filter((item) => item.status === 'failed').length;
  const terminal = items.filter((item) => ['completed', 'failed', 'cancelled'].includes(item.status)).length;
  const progress = items.length ? Math.round(items.reduce((sum, item) => sum + item.progress, 0) / items.length) : 0;
  let status: any = terminal === items.length ? (completedItems ? 'completed' : 'failed') : 'analyzing';
  if (terminal === items.length && completedItems) {
    const openReviews = await prisma.reviewTask.count({ where: { sourceFileId: { in: items.map((item) => item.sourceFileId) }, status: 'OPEN' } });
    if (openReviews) status = 'awaiting_review';
  }
  await prisma.processingJob.update({ where: { id: processingJobId }, data: { status, progress, completedItems, failedItems, completedAt: terminal === items.length ? new Date() : undefined } });
}

async function persistAnalysis(sourceFileId: string, workspaceId: string, analysis: WorkbookAnalysis): Promise<void> {
  const last = await prisma.analysisResult.aggregate({ where: { sourceFileId }, _max: { version: true } });
  const version = (last._max.version ?? 0) + 1;
  const thresholdSetting = await prisma.appSetting.findUnique({ where: { workspaceId_key: { workspaceId, key: 'reviewThreshold' } } });
  const configuredThreshold = typeof thresholdSetting?.value === 'number' ? thresholdSetting.value : 0.7;
  const threshold = Math.max(0.5, Math.min(0.95, configuredThreshold));
  const sheets = analysis.workbook.sheets as any[];
  const requiresReview = analysis.classification.confidence < threshold || sheets.some((sheet) => sheet.headerConfidence < threshold || (sheet.fields ?? []).some((field: any) => field.confidence < threshold));
  await prisma.$transaction(async (tx) => {
    await tx.sourceSheet.deleteMany({ where: { sourceFileId } });
    await tx.reviewTask.deleteMany({ where: { workspaceId, sourceFileId, status: 'OPEN' } });
    for (const sheet of sheets) {
      await tx.sourceSheet.create({ data: {
        sourceFileId, name: sheet.name, position: sheet.position, maxRow: sheet.maxRow, maxColumn: sheet.maxColumn, hidden: sheet.hidden,
        metadata: { usedRange: sheet.usedRange, headerRow: sheet.headerRow, headerLevels: sheet.headerLevels, dataStartRow: sheet.dataStartRow, dataEndRow: sheet.dataEndRow, dataRowCount: sheet.dataRowCount, mergedCells: sheet.mergedCells, hiddenRows: sheet.hiddenRows, hiddenColumns: sheet.hiddenColumns, formulaCount: sheet.formulaCount },
        regions: { create: (sheet.regions ?? []).map((region: any) => ({ type: region.type, startRow: region.startRow, endRow: region.endRow, startColumn: region.startColumn, endColumn: region.endColumn, confidence: region.confidence })) },
        fields: { create: (sheet.fields ?? []).map((field: any) => ({ sourceName: field.sourceName, normalizedName: field.normalizedName, columnIndex: field.columnIndex, targetKey: field.targetKey, dataType: field.dataType, confidence: field.confidence, evidence: field.evidence })) }
      } });
    }
    const storedAnalysis = { ...analysis, requiresReview };
    await tx.analysisResult.create({ data: { sourceFileId, version, result: storedAnalysis as unknown as Prisma.InputJsonValue, confidence: analysis.classification.confidence, requiresReview } });
    await tx.sourceFile.update({ where: { id: sourceFileId }, data: { status: requiresReview ? 'awaiting_review' : 'completed', reportTypeKey: analysis.classification.type, confidence: analysis.classification.confidence } });
    if (analysis.classification.confidence < threshold) {
      await tx.reviewTask.create({ data: { workspaceId, sourceFileId, type: 'classification', title: `確認「${analysis.fileName}」的報表類型`, payload: analysis.classification as unknown as Prisma.InputJsonValue } });
    }
    for (const sheet of sheets) {
      if (sheet.headerConfidence < threshold) await tx.reviewTask.create({ data: { workspaceId, sourceFileId, type: 'header', title: `確認 ${sheet.name} 的表頭列`, payload: { sheet: sheet.name, suggestedRow: sheet.headerRow, confidence: sheet.headerConfidence } } });
      for (const field of sheet.fields ?? []) {
        if (field.confidence < threshold) await tx.reviewTask.create({ data: { workspaceId, sourceFileId, type: 'field_mapping', title: `確認欄位「${field.sourceName}」`, payload: { sheet: sheet.name, ...field } } });
      }
    }
  });
}

function normalized(value: unknown): string {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

async function applyWorkspaceMemory(workspaceId: string, analysis: WorkbookAnalysis): Promise<void> {
  const [mappingRules, templates] = await Promise.all([
    prisma.mappingRule.findMany({ where: { workspaceId, active: true, OR: [{ reportTypeKey: null }, { reportTypeKey: analysis.classification.type }] } }),
    prisma.parsingTemplate.findMany({ where: { workspaceId, active: true, OR: [{ reportTypeId: null }, { reportType: { key: analysis.classification.type } }] }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } })
  ]);
  const sheets = analysis.workbook.sheets as any[];
  for (const sheet of sheets) {
    for (const field of sheet.fields ?? []) {
      const rule = mappingRules.find((candidate) => normalized(candidate.sourcePattern) === field.normalizedName);
      if (rule) Object.assign(field, { targetKey: rule.targetFieldKey, confidence: Math.max(field.confidence, rule.confidence), requiresReview: false, evidence: ['工作區映射記憶', ...(field.evidence ?? [])] });
    }
  }
  for (const template of templates) {
    const config = template.versions[0]?.config as Record<string, any> | undefined;
    if (!config) continue;
    const fileNeedle = normalized(config.fileNameContains ?? config.filePattern ?? '');
    if (fileNeedle && !normalized(analysis.fileName).includes(fileNeedle)) continue;
    let applied = false;
    for (const sheet of sheets) {
      const sheetNeedle = normalized(config.sheetNameContains ?? '');
      if (sheetNeedle && !normalized(sheet.name).includes(sheetNeedle)) continue;
      if (Number.isInteger(config.headerRow) && config.headerRow > 0) Object.assign(sheet, { headerRow: config.headerRow, headerConfidence: 1 });
      const mappings = config.fieldMappings && typeof config.fieldMappings === 'object' ? config.fieldMappings : {};
      for (const field of sheet.fields ?? []) {
        const targetKey = mappings[field.sourceName] ?? mappings[field.normalizedName];
        if (typeof targetKey === 'string' && targetKey) Object.assign(field, { targetKey, confidence: 1, requiresReview: false, evidence: ['解析模板', ...(field.evidence ?? [])] });
      }
      sheet.usedTemplate = { id: template.id, name: template.name, version: template.currentVersion };
      applied = true;
    }
    if (applied) await prisma.parsingTemplate.update({ where: { id: template.id }, data: { usageCount: { increment: 1 }, successCount: { increment: 1 } } });
  }
}

async function analyzeItem(job: Job<{ processingJobId: string; itemId: string }>): Promise<void> {
  const { itemId, processingJobId } = job.data;
  const item = await prisma.processingJobItem.findUnique({ where: { id: itemId }, include: { sourceFile: true, job: true } });
  if (!item || item.job.status === 'cancelled') return;
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'excelmaster-worker-'));
  const localPath = path.join(tempDir, `source${item.sourceFile.extension}`);
  try {
    await prisma.processingJob.update({ where: { id: processingJobId }, data: { status: 'downloading', startedAt: new Date() } });
    await updateStage(itemId, 'downloading', 8); await job.updateProgress(8);
    await storage.download(item.sourceFile.storageKey, localPath);
    await updateStage(itemId, 'validating', 18); await job.updateProgress(18);
    const form = new FormData();
    form.append('file', fs.createReadStream(localPath), { filename: item.sourceFile.name, contentType: item.sourceFile.mimeType });
    form.append('original_name', item.sourceFile.name);
    await updateStage(itemId, 'analyzing', 35); await job.updateProgress(35);
    const response = await axios.post(`${parserUrl}/analyze`, form, { headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 10 * 60 * 1000 });
    await updateStage(itemId, 'classifying', 58); await job.updateProgress(58);
    const analysis = analysisSchema.parse(response.data);
    await updateStage(itemId, 'mapping', 75); await job.updateProgress(75);
    await applyWorkspaceMemory(item.job.workspaceId, analysis);
    await persistAnalysis(item.sourceFileId, item.job.workspaceId, analysis);
    await updateStage(itemId, 'cleaning', 92); await job.updateProgress(92);
    await prisma.processingJobItem.update({ where: { id: itemId }, data: { status: 'completed', progress: 100, completedAt: new Date(), error: null } });
    await job.updateProgress(100);
  } catch (error) {
    const message = axios.isAxiosError(error) ? String(error.response?.data?.detail ?? error.message) : error instanceof Error ? error.message : '未知處理錯誤';
    await prisma.processingJobItem.update({ where: { id: itemId }, data: { status: 'failed', error: message.slice(0, 2000), completedAt: new Date() } });
    await prisma.sourceFile.update({ where: { id: item.sourceFileId }, data: { status: 'failed' } });
    throw error;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
    await finalizeBatch(processingJobId);
  }
}

async function exportWorkbook(job: Job<{ exportJobId: string }>): Promise<void> {
  const exportJob = await prisma.exportJob.findUnique({ where: { id: job.data.exportJobId }, include: { processingJob: { include: { project: true, items: { include: { sourceFile: { include: { analyses: { orderBy: { version: 'desc' }, take: 1 } } } } } } } } });
  if (!exportJob?.processingJob) throw new Error('匯出批次不存在');
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'excelmaster-export-'));
  const output = path.join(tempDir, 'result.xlsx');
  try {
    await prisma.exportJob.update({ where: { id: exportJob.id }, data: { status: 'PROCESSING' } });
    const analyses = exportJob.processingJob.items.map((item) => item.sourceFile.analyses[0]?.result).filter(Boolean) as unknown as WorkbookAnalysis[];
    const projectConfig = (exportJob.processingJob.project?.config ?? {}) as Record<string, any>;
    const operations = Array.isArray(projectConfig.operations) ? projectConfig.operations as PipelineOperation[] : [];
    let dataSets: DataSet[] | undefined;
    if (operations.length) {
      const sources = analyses.flatMap((analysis) => analysis.workbook.sheets.map((sheet: any) => ({ name: `${analysis.fileName}_${sheet.name}`, rows: sheet.normalizedRows })));
      dataSets = runIntegration(sources, operations);
    }
    const response = await axios.post(`${parserUrl}/export`, { name: exportJob.name, config: exportJob.config, analyses, dataSets }, { responseType: 'arraybuffer', timeout: 10 * 60 * 1000, maxBodyLength: Infinity, maxContentLength: Infinity });
    await fsp.writeFile(output, Buffer.from(response.data));
    const bytes = await fsp.readFile(output);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const storageKey = `${exportJob.workspaceId}/exports/${exportJob.id}/${Date.now()}.xlsx`;
    await storage.upload(storageKey, output, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await prisma.exportFile.create({ data: { exportJobId: exportJob.id, name: `${exportJob.name.replace(/\.xlsx$/i, '')}.xlsx`, storageKey, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: bytes.length, sha256 } });
    await prisma.exportJob.update({ where: { id: exportJob.id }, data: { status: 'COMPLETED', completedAt: new Date(), error: null } });
  } catch (error) {
    const message = axios.isAxiosError(error) ? String(error.response?.data?.detail ?? error.message) : error instanceof Error ? error.message : '未知匯出錯誤';
    await prisma.exportJob.update({ where: { id: exportJob.id }, data: { status: 'FAILED', error: message.slice(0, 2000), completedAt: new Date() } });
    throw error;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

const worker = new Worker('excel-processing', async (job) => {
  if (job.name === 'analyze-file') return analyzeItem(job as Job<{ processingJobId: string; itemId: string }>);
  if (job.name === 'export-workbook') return exportWorkbook(job as Job<{ exportJobId: string }>);
  throw new Error(`不支援的工作類型：${job.name}`);
}, { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 3), lockDuration: 10 * 60 * 1000 });

worker.on('failed', (job, error) => console.error(JSON.stringify({ event: 'job.failed', jobId: job?.id, message: error.message })));
worker.on('completed', (job) => console.log(JSON.stringify({ event: 'job.completed', jobId: job.id })));

async function shutdown(): Promise<void> {
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
