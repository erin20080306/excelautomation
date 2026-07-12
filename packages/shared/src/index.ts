import { z } from 'zod';

export const REPORT_TYPES = [
  'quotation', 'order', 'purchase', 'sales', 'inventory', 'attendance', 'payroll',
  'customer', 'employee', 'product', 'finance', 'recruitment', 'logistics',
  'reconciliation', 'unknown', 'custom'
] as const;

export type ReportTypeKey = (typeof REPORT_TYPES)[number];

export const JOB_STATUSES = [
  'queued', 'downloading', 'validating', 'analyzing', 'classifying', 'parsing',
  'mapping', 'cleaning', 'awaiting_review', 'exporting', 'completed', 'failed', 'cancelled'
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const PROCESSING_QUEUE_NAME = 'excel_processing';

export const processingQueueMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('analyze-file'),
    processingJobId: z.string().cuid(),
    itemId: z.string().cuid(),
    maxAttempts: z.number().int().min(1).max(10).default(3)
  }),
  z.object({
    type: z.literal('export-workbook'),
    exportJobId: z.string().cuid(),
    maxAttempts: z.number().int().min(1).max(10).default(2)
  })
]);

export type ProcessingQueueMessage = z.infer<typeof processingQueueMessageSchema>;

export function queueRetryDelaySeconds(readCount: number, baseSeconds = 2, maximumSeconds = 300): number {
  const safeReadCount = Math.max(1, Math.floor(readCount));
  const safeBase = Math.max(1, Math.floor(baseSeconds));
  const safeMaximum = Math.max(safeBase, Math.floor(maximumSeconds));
  return Math.min(safeMaximum, safeBase * 2 ** (safeReadCount - 1));
}

export const reportTypeLabels: Record<ReportTypeKey, string> = {
  quotation: '報價資料', order: '訂單資料', purchase: '採購資料', sales: '銷售資料',
  inventory: '庫存資料', attendance: '出勤資料', payroll: '薪資資料', customer: '客戶資料',
  employee: '員工資料', product: '商品資料', finance: '財務資料', recruitment: '招募資料',
  logistics: '物流資料', reconciliation: '對帳資料', unknown: '未辨識資料', custom: '自訂報表'
};

export const analysisSchema = z.object({
  fileName: z.string(),
  fileHash: z.string(),
  workbook: z.object({ sheetCount: z.number().int(), hasMacros: z.boolean(), sheets: z.array(z.any()) }),
  classification: z.object({
    type: z.enum(REPORT_TYPES), confidence: z.number().min(0).max(1),
    reasons: z.array(z.string()), candidates: z.array(z.object({ type: z.enum(REPORT_TYPES), confidence: z.number() }))
  }),
  fields: z.array(z.any()),
  warnings: z.array(z.string()),
  requiresReview: z.boolean()
});

export type WorkbookAnalysis = z.infer<typeof analysisSchema>;

export const integrationModes = ['append', 'join', 'lookup', 'group', 'split', 'transform'] as const;
export type IntegrationMode = (typeof integrationModes)[number];

export interface ApiList<T> { items: T[]; total: number }

export interface UserSession {
  token: string;
  user: { id: string; email: string; name: string; platformRole: 'USER' | 'SUPERADMIN'; mfaEnabled: boolean };
  workspace: {
    id: string; name: string; role: string;
    plan: 'TRIAL' | 'STARTER' | 'PROFESSIONAL' | 'BUSINESS' | 'ENTERPRISE';
    fileQuota: number; totalMbQuota: number; outputMbQuota: number; downloadQuota: number;
  };
}

export interface DashboardSummary {
  files: number;
  jobsThisMonth: number;
  completedJobs: number;
  reviewTasks: number;
  recentJobs: Array<{ id: string; name: string; status: JobStatus; createdAt: string; progress: number }>;
}

export * from './integration.js';
