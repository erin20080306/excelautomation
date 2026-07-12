import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  FIELD_ENCRYPTION_KEY: z.string().min(32),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  PARSER_URL: z.string().url().default('http://localhost:8000'),
  STORAGE_DRIVER: z.enum(['local', 's3', 'database']).default('local'),
  STORAGE_LOCAL_PATH: z.string().default('./storage'),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(50),
  MAX_ZIP_UNCOMPRESSED_MB: z.coerce.number().positive().default(500),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).transform((value) => value === 'true').optional()
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse({
    ...environment,
    API_PORT: environment.API_PORT ?? environment.PORT
  });
  if (!parsed.success) {
    throw new Error(`環境變數設定錯誤: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ')}`);
  }
  return parsed.data;
}
