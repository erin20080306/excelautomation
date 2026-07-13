import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import axios from 'axios';
import FormData from 'form-data';
import type { PrismaClient, Prisma } from '@prisma/client';
import {
  analysisSchema,
  runIntegration,
  type DataSet,
  type PipelineOperation,
  type ProcessingQueueMessage,
  type WorkbookAnalysis
} from '@excelmaster/shared';

export interface ProcessorStorage {
  download(key: string, target: string): Promise<void>;
  upload(key: string, source: string, contentType: string): Promise<void>;
}

export interface TaskProcessorOptions {
  prisma: PrismaClient;
  storage: ProcessorStorage;
  parserUrl: string;
  parserSecret?: string;
  requestTimeoutMs?: number;
  maxOutputBytes?: number;
}

export interface TaskProcessor {
  analyzeItem(message: Extract<ProcessingQueueMessage, { type: 'analyze-file' }>): Promise<void>;
  exportWorkbook(message: Extract<ProcessingQueueMessage, { type: 'export-workbook' }>): Promise<void>;
}

function parserHeaders(secret: string | undefined): Record<string, string> {
  return secret ? { 'x-excelmaster-parser-secret': secret } : {};
}

export function gasCompanionScript(): string {
  return `/**
 * ExcelMaster Google Apps Script
 * 在 Google Sheets：擴充功能 → Apps Script，貼上本檔後執行「建立整合新檔」。
 * 腳本會自動尋找表頭、統一常見欄位語意、合併所有資料並建立專業分析頁。
 */
const EXCELMASTER_ALIASES = {
  date: ['日期','交易日期','訂單日期','出貨日期','date'],
  customer: ['客戶','客戶名稱','公司名稱','買方','customer','client'],
  product: ['商品','商品名稱','產品','品名','product','item'],
  sku: ['品號','料號','商品編號','sku','itemcode'],
  quantity: ['數量','數目','件數','qty','quantity'],
  unit_price: ['單價','售價','價格','unitprice','price'],
  amount: ['金額','總額','合計','銷售額','amount','total'],
  warehouse: ['倉庫','倉別','庫別','warehouse'],
  salesperson: ['業務','業務員','負責人','salesperson','owner'],
  image_url: ['圖片','圖片網址','圖片連結','照片','照片網址','image','imageurl','imageuri','photo','photourl','logo']
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ExcelMaster')
    .addItem('建立整合新檔', 'excelMasterCreateIntegratedFile')
    .addItem('重建專業分析', 'excelMasterRefreshReport')
    .addItem('加入報告封面／Logo', 'excelMasterAddReportImage')
    .addToUi();
}

function excelMasterCreateIntegratedFile() {
  const source = SpreadsheetApp.getActive();
  const target = SpreadsheetApp.create(source.getName() + '_整合結果_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmm'));
  const output = target.getSheets()[0];
  output.setName('整合總表');
  const headers = ['_來源檔案', '_來源工作表', '_來源列'];
  const records = [];
  const details = [];

  source.getSheets().filter(sheet => !/^00_|^01_|^02_|^03_|^GAS_|^整合總表$/.test(sheet.getName())).forEach(sheet => {
    const values = sheet.getDataRange().getDisplayValues();
    if (!values.length) return;
    const headerIndex = excelMasterDetectHeader_(values);
    const rawHeaders = values[headerIndex].map((value, index) => value || ('未命名欄位_' + (index + 1)));
    const normalizedHeaders = rawHeaders.map(excelMasterSemanticHeader_);
    normalizedHeaders.forEach(header => { if (!headers.includes(header)) headers.push(header); });
    let rowCount = 0;
    for (let rowIndex = headerIndex + 1; rowIndex < values.length; rowIndex += 1) {
      const row = values[rowIndex];
      if (!row.some(value => String(value).trim())) continue;
      if (excelMasterIsSummaryRow_(row)) continue;
      const record = { _來源檔案: source.getName(), _來源工作表: sheet.getName(), _來源列: rowIndex + 1 };
      normalizedHeaders.forEach((header, column) => { record[header] = row[column] ?? ''; });
      records.push(record);
      rowCount += 1;
    }
    const semanticCount = normalizedHeaders.filter((header, index) => header !== rawHeaders[index]).length;
    details.push([sheet.getName(), headerIndex + 1, rawHeaders.length, rowCount, semanticCount, rawHeaders.length ? semanticCount / rawHeaders.length : 0]);
  });

  if (!records.length) throw new Error('找不到可整合的資料列。');
  const imageUrlColumnIndex = headers.indexOf('image_url');
  if (imageUrlColumnIndex >= 0) headers.push('圖片預覽');
  const matrix = [headers, ...records.map(record => headers.map(header => header === '圖片預覽' ? '' : excelMasterSafeValue_(record[header] ?? '')))];
  output.getRange(1, 1, matrix.length, headers.length).setValues(matrix);
  output.setFrozenRows(1);
  output.getRange(1, 1, 1, headers.length).setBackground('#0F766E').setFontColor('#FFFFFF').setFontWeight('bold');
  output.getDataRange().createFilter();
  output.autoResizeColumns(1, Math.min(headers.length, 30));
  if (imageUrlColumnIndex >= 0) {
    const imageUrlColumn = imageUrlColumnIndex + 1;
    const previewColumn = headers.indexOf('圖片預覽') + 1;
    const relativeOffset = imageUrlColumn - previewColumn;
    if (records.length) {
      output.getRange(2, previewColumn, records.length, 1).setFormulaR1C1('=IFERROR(IMAGE(RC[' + relativeOffset + '],4,80,80),"")');
      output.setRowHeights(2, records.length, 84);
      output.setColumnWidth(previewColumn, 100);
    }
  }
  excelMasterBuildReport_(target, details, records.length, headers.length);
  SpreadsheetApp.getUi().alert('整合完成', '已建立新 Google Sheet：' + target.getUrl(), SpreadsheetApp.getUi().ButtonSet.OK);
}

function excelMasterRefreshReport() {
  const spreadsheet = SpreadsheetApp.getActive();
  const data = spreadsheet.getSheetByName('整合總表');
  if (!data) throw new Error('找不到「整合總表」。');
  const rows = Math.max(0, data.getLastRow() - 1);
  const columns = data.getLastColumn();
  excelMasterBuildReport_(spreadsheet, [['整合總表', 1, columns, rows, columns, 1]], rows, columns);
}

function excelMasterDetectHeader_(rows) {
  let bestIndex = 0;
  let bestScore = -1;
  rows.slice(0, 80).forEach((row, index) => {
    const cells = row.map(value => String(value).trim()).filter(Boolean);
    if (cells.length < 2) return;
    const density = cells.length / Math.max(1, row.length);
    const unique = new Set(cells.map(excelMasterNormalize_)).size / cells.length;
    const known = cells.filter(value => excelMasterSemanticHeader_(value) !== value).length / cells.length;
    const next = rows[index + 1] || [];
    const nextDensity = next.filter(value => String(value).trim()).length / Math.max(1, row.length);
    const score = density * .35 + unique * .2 + known * .3 + nextDensity * .15;
    if (score > bestScore) { bestScore = score; bestIndex = index; }
  });
  return bestIndex;
}

function excelMasterSemanticHeader_(header) {
  const normalized = excelMasterNormalize_(header);
  for (const [key, aliases] of Object.entries(EXCELMASTER_ALIASES)) {
    if (aliases.some(alias => normalized === excelMasterNormalize_(alias))) return key;
  }
  return String(header).trim() || '未命名欄位';
}

function excelMasterNormalize_(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^\\p{L}\\p{N}]/gu, '');
}

function excelMasterSafeValue_(value) {
  if (typeof value === 'string' && /^[=+\\-@\\t\\r]/.test(value)) return "'" + value;
  return value;
}

function excelMasterIsSummaryRow_(row) {
  const text = row.map(excelMasterNormalize_).join('|');
  return /(^|\\|)(總計|合計|小計|subtotal|total)(\\||$)/.test(text);
}

function excelMasterAddReportImage() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('加入報告封面／Logo', '請輸入可公開讀取的 HTTPS 圖片網址（PNG、JPG 或 WebP）：', ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const url = response.getResponseText().trim();
  if (!/^https:\\/\\//i.test(url)) throw new Error('圖片網址必須使用 HTTPS。');
  const report = SpreadsheetApp.getActive().getSheetByName('GAS_專業分析');
  if (!report) throw new Error('請先建立或重建 GAS 專業分析。');
  const fetched = UrlFetchApp.fetch(url, { followRedirects: true, muteHttpExceptions: true });
  if (fetched.getResponseCode() < 200 || fetched.getResponseCode() >= 300) throw new Error('圖片下載失敗，請確認網址可公開存取。');
  const image = report.insertImage(fetched.getBlob(), 7, 1);
  image.setAltTextDescription('ExcelMaster 報告封面圖片');
  image.setWidth(180).setHeight(90);
  ui.alert('圖片已加入 GAS 專業分析頁。');
}

function excelMasterBuildReport_(spreadsheet, details, totalRows, totalColumns) {
  const old = spreadsheet.getSheetByName('GAS_專業分析');
  if (old) spreadsheet.deleteSheet(old);
  const report = spreadsheet.insertSheet('GAS_專業分析', 0);
  report.setHiddenGridlines(true);
  const mappingRate = details.length ? details.reduce((sum, row) => sum + Number(row[5] || 0), 0) / details.length : 0;
  const qualityScore = Math.max(0, Math.min(1, mappingRate * .55 + (totalRows > 0 ? .3 : 0) + (details.length > 0 ? .15 : 0)));
  report.getRange('A1:H1').merge().setValue('ExcelMaster GAS 專業整合分析報告').setBackground('#0F766E').setFontColor('#FFFFFF').setFontSize(20).setFontWeight('bold').setVerticalAlignment('middle');
  report.setRowHeight(1, 38);
  report.getRange('A2:H2').merge().setValue('產生時間：' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') + ' | 內容式表頭與欄位語意辨識，不依賴固定模板').setFontColor('#475569');
  report.getRange('A4:B5').merge().setValue(details.length + ' 張工作表').setBackground('#ECFDF5').setFontSize(16).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle');
  report.getRange('C4:D5').merge().setValue(totalRows + ' 筆資料').setBackground('#ECFDF5').setFontSize(16).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle');
  report.getRange('E4:F5').merge().setValue(totalColumns + ' 個欄位').setBackground('#ECFDF5').setFontSize(16).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle');
  report.getRange('G4:H5').merge().setValue(qualityScore).setNumberFormat('0%').setBackground(qualityScore >= .8 ? '#DCFCE7' : qualityScore >= .6 ? '#FEF3C7' : '#FEE2E2').setFontSize(18).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle');
  report.getRange('G3:H3').merge().setValue('品質分數').setFontWeight('bold').setFontColor('#64748B').setHorizontalAlignment('center');
  report.getRange('A8:F8').setValues([['工作表', '自動表頭列', '欄位數', '有效資料筆數', '語意對應欄位', '欄位對應率']]).setBackground('#115E59').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  if (details.length) {
    report.getRange(9, 1, details.length, 6).setValues(details);
    report.getRange(9, 6, details.length, 1).setNumberFormat('0%');
    details.forEach((row, index) => {
      const rate = Number(row[5] || 0);
      report.getRange(9 + index, 6).setBackground(rate >= .8 ? '#DCFCE7' : rate >= .5 ? '#FEF3C7' : '#FEE2E2');
    });
    const chart = report.newChart().asColumnChart()
      .addRange(report.getRange(8, 1, details.length + 1, 1))
      .addRange(report.getRange(8, 4, details.length + 1, 1))
      .setPosition(8, 8, 0, 0)
      .setOption('title', '各工作表有效資料筆數')
      .setOption('legend', { position: 'none' })
      .setOption('colors', ['#0F766E'])
      .setOption('height', 300)
      .setOption('width', 520)
      .build();
    report.insertChart(chart);
  }
  const insightRow = details.length + 11;
  report.getRange('A' + insightRow + ':F' + insightRow).merge().setValue('系統判讀與管理建議').setFontSize(14).setFontWeight('bold').setFontColor('#0F172A');
  const insights = [
    '• 已自動尋找每張工作表的表頭列，並排除總計、小計及空白列。',
    '• 常見中文／英文欄名已統一為標準語意，平均欄位對應率為 ' + Utilities.formatString('%.0f%%', mappingRate * 100) + '。',
    qualityScore >= .8 ? '• 品質分數良好，可抽樣核對後使用整合總表。' : '• 品質分數未達 80%，建議優先核對低對應率工作表。',
    '• 新檔與原始來源分離，所有來源工作表均未被覆蓋。'
  ];
  insights.forEach((value, index) => {
    report.getRange(insightRow + 1 + index, 1, 1, 6).merge().setValue(value).setWrap(true).setFontColor('#334155').setBackground('#F8FAFC');
  });
  report.setFrozenRows(8);
  report.setColumnWidth(1, 220);
  report.setColumnWidths(2, 5, 115);
  report.setColumnWidths(8, 6, 95);
}
`;
}

export function createTaskProcessor(options: TaskProcessorOptions): TaskProcessor {
  const { prisma, storage } = options;
  const parserUrl = options.parserUrl.replace(/\/$/, '');
  const timeout = options.requestTimeoutMs ?? 10 * 60 * 1000;

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
    }, { maxWait: 10_000, timeout: 30_000 });
  }

  function normalized(value: unknown): string {
    return String(value ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  }

  async function applyWorkspaceMemory(workspaceId: string, analysis: WorkbookAnalysis, useParsingTemplates = false): Promise<void> {
    const [mappingRules, templates] = await Promise.all([
      prisma.mappingRule.findMany({ where: { workspaceId, active: true, OR: [{ reportTypeKey: null }, { reportTypeKey: analysis.classification.type }] } }),
      useParsingTemplates
        ? prisma.parsingTemplate.findMany({ where: { workspaceId, active: true, OR: [{ reportTypeId: null }, { reportType: { key: analysis.classification.type } }] }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } })
        : Promise.resolve([])
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

  async function analyzeItem(message: Extract<ProcessingQueueMessage, { type: 'analyze-file' }>): Promise<void> {
    const { itemId, processingJobId } = message;
    const item = await prisma.processingJobItem.findUnique({ where: { id: itemId }, include: { sourceFile: true, job: { include: { project: true } } } });
    if (!item || item.status === 'completed' || item.job.status === 'cancelled') return;
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'excelmaster-worker-'));
    const localPath = path.join(tempDir, `source${item.sourceFile.extension}`);
    try {
      await prisma.processingJob.update({ where: { id: processingJobId }, data: { status: 'downloading', startedAt: new Date() } });
      await updateStage(itemId, 'downloading', 8);
      await storage.download(item.sourceFile.storageKey, localPath);
      await updateStage(itemId, 'validating', 18);
      const form = new FormData();
      form.append('file', fs.createReadStream(localPath), { filename: item.sourceFile.name, contentType: item.sourceFile.mimeType });
      form.append('original_name', item.sourceFile.name);
      await updateStage(itemId, 'analyzing', 35);
      const response = await axios.post(`${parserUrl}/analyze`, form, { headers: { ...form.getHeaders(), ...parserHeaders(options.parserSecret) }, maxBodyLength: Infinity, maxContentLength: Infinity, timeout });
      await updateStage(itemId, 'classifying', 58);
      const analysis = analysisSchema.parse(response.data);
      await updateStage(itemId, 'mapping', 75);
      const projectConfig = (item.job.project?.config ?? {}) as Record<string, any>;
      await applyWorkspaceMemory(item.job.workspaceId, analysis, projectConfig.useParsingTemplates === true);
      await persistAnalysis(item.sourceFileId, item.job.workspaceId, analysis);
      await updateStage(itemId, 'cleaning', 92);
      await prisma.processingJobItem.update({ where: { id: itemId }, data: { status: 'completed', progress: 100, completedAt: new Date(), error: null } });
    } catch (error) {
      const errorMessage = axios.isAxiosError(error) ? String(error.response?.data?.detail ?? error.message) : error instanceof Error ? error.message : '未知處理錯誤';
      await prisma.processingJobItem.update({ where: { id: itemId }, data: { status: 'failed', error: errorMessage.slice(0, 2000), completedAt: new Date() } });
      await prisma.sourceFile.update({ where: { id: item.sourceFileId }, data: { status: 'failed' } });
      throw error;
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
      await finalizeBatch(processingJobId);
    }
  }

  async function exportWorkbook(message: Extract<ProcessingQueueMessage, { type: 'export-workbook' }>): Promise<void> {
    const exportJob = await prisma.exportJob.findUnique({ where: { id: message.exportJobId }, include: { processingJob: { include: { project: true, items: { include: { sourceFile: { include: { analyses: { orderBy: { version: 'desc' }, take: 1 } } } } } } } } });
    if (!exportJob?.processingJob) throw new Error('匯出批次不存在');
    if (exportJob.status === 'COMPLETED') return;
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'excelmaster-export-'));
    const output = path.join(tempDir, 'result.xlsx');
    const gasOutput = path.join(tempDir, 'ExcelMaster_Google_Sheets.gs');
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
      const response = await axios.post(`${parserUrl}/export`, { name: exportJob.name, config: exportJob.config, analyses, dataSets }, { headers: parserHeaders(options.parserSecret), responseType: 'arraybuffer', timeout, maxBodyLength: Infinity, maxContentLength: Infinity });
      const bytes = Buffer.from(response.data);
      if (options.maxOutputBytes && bytes.length > options.maxOutputBytes) throw new Error('線上版輸出超過大小限制，請縮小單批資料或使用訂閱安裝版');
      await fsp.writeFile(output, bytes);
      const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      const storageKey = `${exportJob.workspaceId}/exports/${exportJob.id}/${Date.now()}.xlsx`;
      await storage.upload(storageKey, output, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const config = exportJob.config as Record<string, any>;
      const creates = [prisma.exportFile.create({ data: { exportJobId: exportJob.id, name: `${exportJob.name.replace(/\.xlsx$/i, '')}.xlsx`, storageKey, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: bytes.length, sha256 } })];
      if (config.includeGasReport !== false) {
        const gasBytes = Buffer.from(gasCompanionScript(), 'utf8');
        await fsp.writeFile(gasOutput, gasBytes);
        const gasStorageKey = `${exportJob.workspaceId}/exports/${exportJob.id}/${Date.now()}-google-sheets.gs`;
        await storage.upload(gasStorageKey, gasOutput, 'text/plain; charset=utf-8');
        creates.push(prisma.exportFile.create({ data: { exportJobId: exportJob.id, name: `${exportJob.name.replace(/\.xlsx$/i, '')}_Google_Sheets.gs`, storageKey: gasStorageKey, mimeType: 'text/plain; charset=utf-8', size: gasBytes.length, sha256: crypto.createHash('sha256').update(gasBytes).digest('hex') } }));
      }
      await prisma.$transaction([...creates, prisma.exportJob.update({ where: { id: exportJob.id }, data: { status: 'COMPLETED', completedAt: new Date(), error: null } })]);
    } catch (error) {
      const errorMessage = axios.isAxiosError(error) ? String(error.response?.data?.detail ?? error.message) : error instanceof Error ? error.message : '未知匯出錯誤';
      await prisma.exportJob.update({ where: { id: exportJob.id }, data: { status: 'FAILED', error: errorMessage.slice(0, 2000), completedAt: new Date() } });
      throw error;
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  }

  return { analyzeItem, exportWorkbook };
}
