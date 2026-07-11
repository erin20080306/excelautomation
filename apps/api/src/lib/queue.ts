import { Queue } from 'bullmq';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
export const queueConnection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  username: redisUrl.username || undefined,
  password: redisUrl.password || undefined,
  db: Number(redisUrl.pathname.slice(1) || 0),
  tls: redisUrl.protocol === 'rediss:' ? {} : undefined
};
export const processingQueue = new Queue('excel-processing', { connection: queueConnection });
