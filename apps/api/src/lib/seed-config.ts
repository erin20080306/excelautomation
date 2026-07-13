import { z } from 'zod';

const seedConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ALLOW_PRODUCTION_SEED: z.enum(['true', 'false']).default('false'),
  SEED_ADMIN_EMAIL: z.string().email().transform((value) => value.toLowerCase()),
  SEED_ADMIN_PASSWORD: z.string().min(10).max(128),
  SEED_ADMIN_NAME: z.string().trim().min(2).max(80).default('測試管理者'),
  SEED_WORKSPACE_NAME: z.string().trim().min(2).max(100).default('ExcelMaster 測試工作區')
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && value.ALLOW_PRODUCTION_SEED !== 'true') {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '正式環境禁止執行測試帳號 seed；如確有需要，必須明確設定 ALLOW_PRODUCTION_SEED=true' });
  }
});

export type SeedConfig = z.infer<typeof seedConfigSchema>;

export function parseSeedConfig(environment: NodeJS.ProcessEnv): SeedConfig {
  let decodedPassword = environment.SEED_ADMIN_PASSWORD;
  if (!decodedPassword && environment.SEED_ADMIN_PASSWORD_BASE64) {
    const encoded = environment.SEED_ADMIN_PASSWORD_BASE64.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('測試管理者 seed 設定錯誤：密碼 Base64 格式錯誤');
    decodedPassword = Buffer.from(encoded, 'base64').toString('utf8');
  }
  const result = seedConfigSchema.safeParse({ ...environment, SEED_ADMIN_PASSWORD: decodedPassword });
  if (!result.success) {
    throw new Error(`測試管理者 seed 設定錯誤：${result.error.issues.map((issue) => issue.message).join('；')}`);
  }
  return result.data;
}
