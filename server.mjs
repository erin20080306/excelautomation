import Fastify from 'fastify';
import { buildApp } from './apps/api/dist/app.js';

const configuredLimit = Number(process.env.MAX_FILE_SIZE_MB ?? 3);
const maxFileSizeMb = Number.isFinite(configuredLimit) && configuredLimit > 0 ? configuredLimit : 3;
const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'development' ? 'info' : 'warn',
    redact: ['req.headers.authorization', 'req.headers.cookie', 'body.password', 'body.credential']
  },
  bodyLimit: maxFileSizeMb * 1024 * 1024 + 1024 * 1024,
  maxParamLength: 512,
  trustProxy: true
});
await buildApp(app);
app.listen({ port: 3000 });
