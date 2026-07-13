import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { ZodError } from 'zod';
import { loadConfig } from './config.js';
import { ensureProcessingQueue } from './lib/queue.js';
import { createStorage } from './lib/storage.js';
import { authPlugin } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { resourceRoutes } from './routes/resources.js';
import { fileRoutes } from './routes/files.js';
import { exportRoutes } from './routes/exports.js';
import { adminRoutes } from './routes/admin.js';
import { billingRoutes, billingWebhookRoutes } from './routes/billing.js';
import { downloadRoutes } from './routes/downloads.js';
import { createInstalledLicenseGuard } from './lib/installed-license.js';
import { codeStudioRoutes } from './routes/code-studio.js';

export async function buildApp(existingApp?: FastifyInstance): Promise<FastifyInstance> {
  const config = loadConfig();
  if (config.PROCESSING_MODE === 'queue') await ensureProcessingQueue();
  const storage = createStorage(config);
  const app = existingApp ?? Fastify({
    logger: { level: config.NODE_ENV === 'development' ? 'info' : 'warn', redact: ['req.headers.authorization', 'req.headers.cookie', 'body.password', 'body.credential'] },
    bodyLimit: config.MAX_FILE_SIZE_MB * 1024 * 1024 + 1024 * 1024,
    maxParamLength: 512,
    trustProxy: true
  });

  app.decorate('config', config);
  const verifyInstalledLicense = createInstalledLicenseGuard(config);
  if (config.LICENSE_ENFORCEMENT) await verifyInstalledLicense(true);
  await app.register(sensible);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute', ban: 3 });
  await app.register(multipart, {
    limits: { fileSize: config.MAX_FILE_SIZE_MB * 1024 * 1024, files: 1000, fields: 20, parts: 1020 },
    throwFileSizeLimit: false,
    preservePath: true
  });
  await app.register(authPlugin);
  app.addHook('onRequest', async () => verifyInstalledLicense());

  app.addHook('preSerialization', async (_request, _reply, payload) => {
    const convert = (value: unknown): unknown => {
      if (typeof value === 'bigint') return value.toString();
      if (Array.isArray(value)) return value.map(convert);
      if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, convert(child)]));
      return value;
    };
    return convert(payload);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ message: '輸入資料格式錯誤', issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
    const handled = error instanceof Error ? error : new Error(String(error));
    const statusCode = 'statusCode' in handled && typeof handled.statusCode === 'number' ? handled.statusCode : 500;
    if (statusCode >= 500) request.log.error(handled);
    return reply.code(statusCode).send({ message: statusCode >= 500 && config.NODE_ENV === 'production' ? '伺服器處理失敗' : handled.message });
  });

  app.get('/health', async () => ({ status: 'ok', service: 'api', processingMode: config.PROCESSING_MODE }));
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(['application/json', 'application/x-www-form-urlencoded'], { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
    await scope.register(billingWebhookRoutes);
  }, { prefix: '/api/billing' });
  await app.register(billingRoutes, { prefix: '/api/billing' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(downloadRoutes, { prefix: '/api/downloads' });
  await app.register(codeStudioRoutes, { prefix: '/api/code-studio' });
  await app.register(resourceRoutes, { prefix: '/api' });
  await app.register(async (scope) => fileRoutes(scope, storage), { prefix: '/api/files' });
  await app.register(async (scope) => exportRoutes(scope, storage), { prefix: '/api/exports' });
  return app;
}
