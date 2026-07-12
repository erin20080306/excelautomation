export const PLAN_ORDER = ['TRIAL', 'STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'] as const;
export type PlanKey = (typeof PLAN_ORDER)[number];

export const PLAN_CATALOG: Record<PlanKey, {
  name: string; priceTwd: number; fileQuota: number; totalMbQuota: number; outputMbQuota: number;
  downloadQuota: number; seats: number; devices: number; supportMonths: number; features: string[];
}> = {
  TRIAL: { name: '線上試用', priceTwd: 0, fileQuota: 5, totalMbQuota: 3, outputMbQuota: 4, downloadQuota: 0, seats: 1, devices: 0, supportMonths: 0, features: ['Vercel 小量試用', 'Excel 分析與匯出'] },
  STARTER: { name: '個人版', priceTwd: 12_800, fileQuota: 10, totalMbQuota: 4, outputMbQuota: 4.2, downloadQuota: 2, seats: 1, devices: 1, supportMonths: 12, features: ['Windows 或 macOS 安裝包', '本機批次處理', '一年更新'] },
  PROFESSIONAL: { name: '專業版', priceTwd: 36_800, fileQuota: 20, totalMbQuota: 4, outputMbQuota: 4.2, downloadQuota: 6, seats: 5, devices: 3, supportMonths: 12, features: ['Windows 與 macOS 安裝包', '進階整合規則', '背景 Queue 與重試', '一年標準支援'] },
  BUSINESS: { name: '企業版', priceTwd: 98_000, fileQuota: 20, totalMbQuota: 4, outputMbQuota: 4.2, downloadQuota: 20, seats: 20, devices: 10, supportMonths: 12, features: ['多使用者部署', 'S3/API 資料來源', '稽核與權限管理', '一年優先支援'] },
  ENTERPRISE: { name: '企業授權版', priceTwd: 268_000, fileQuota: 20, totalMbQuota: 4, outputMbQuota: 4.2, downloadQuota: 100, seats: 999, devices: 50, supportMonths: 12, features: ['大型內部部署', '客製部署協助', '優先修補與升級', '授權範圍另約定'] }
};

export function planIncludes(current: PlanKey, required: PlanKey): boolean {
  return PLAN_ORDER.indexOf(current) >= PLAN_ORDER.indexOf(required);
}
