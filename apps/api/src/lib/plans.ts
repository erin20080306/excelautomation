export const PLAN_ORDER = ['TRIAL', 'STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'] as const;
export type PlanKey = (typeof PLAN_ORDER)[number];
export type PaidPlanKey = Exclude<PlanKey, 'TRIAL'>;
export type BillingIntervalKey = 'MONTHLY' | 'YEARLY' | 'MANUAL';

export type PlanDefinition = {
  name: string;
  tagline: string;
  monthlyPriceTwd: number;
  annualPriceTwd: number;
  fileQuota: number;
  totalMbQuota: number;
  outputMbQuota: number;
  downloadQuota: number;
  seats: number;
  devices: number;
  features: string[];
};

export const PLAN_CATALOG: Record<PlanKey, PlanDefinition> = {
  TRIAL: {
    name: '線上試用', tagline: '先驗證智慧表頭與合併流程', monthlyPriceTwd: 0, annualPriceTwd: 0,
    fileQuota: 5, totalMbQuota: 3, outputMbQuota: 4, downloadQuota: 0, seats: 1, devices: 0,
    features: ['Excel／Google Sheets 小量試用', '智慧表頭與欄位語意辨識', 'Excel 與 GAS 報告預覽']
  },
  STARTER: {
    name: '個人版', tagline: '個人與自由工作者的日常整合', monthlyPriceTwd: 399, annualPriceTwd: 3_990,
    fileQuota: 20, totalMbQuota: 50, outputMbQuota: 50, downloadQuota: 2, seats: 1, devices: 1,
    features: ['Windows／macOS 一鍵安裝包', '多檔 Excel／Google Sheets 合併', '專業 Excel 與 GAS 圖文報告', '1 台已授權裝置']
  },
  PROFESSIONAL: {
    name: '專業版', tagline: '小型團隊的自動化與重複工作', monthlyPriceTwd: 1_290, annualPriceTwd: 12_900,
    fileQuota: 100, totalMbQuota: 500, outputMbQuota: 500, downloadQuota: 6, seats: 5, devices: 3,
    features: ['個人版全部功能', '背景 Queue、重試與大量批次', '進階整合規則與資料清理', '3 台已授權裝置']
  },
  BUSINESS: {
    name: '商務版', tagline: '部門級權限、稽核與多資料來源', monthlyPriceTwd: 3_990, annualPriceTwd: 39_900,
    fileQuota: 500, totalMbQuota: 2_000, outputMbQuota: 2_000, downloadQuota: 20, seats: 20, devices: 10,
    features: ['專業版全部功能', '多使用者與角色權限', 'S3／API 資料來源', '稽核、下載與裝置管理']
  },
  ENTERPRISE: {
    name: '企業授權', tagline: '大型內部部署與客製治理', monthlyPriceTwd: 9_900, annualPriceTwd: 99_000,
    fileQuota: 5_000, totalMbQuota: 5_000, outputMbQuota: 5_000, downloadQuota: 100, seats: 999, devices: 50,
    features: ['商務版全部功能', '大型內部部署與客製協助', '優先修補、升級與支援', '授權與 SLA 依合約約定']
  }
};

export function planIncludes(current: PlanKey, required: PlanKey): boolean {
  return PLAN_ORDER.indexOf(current) >= PLAN_ORDER.indexOf(required);
}

export function priceForPlan(plan: PaidPlanKey, interval: Exclude<BillingIntervalKey, 'MANUAL'>): number {
  return interval === 'YEARLY' ? PLAN_CATALOG[plan].annualPriceTwd : PLAN_CATALOG[plan].monthlyPriceTwd;
}
