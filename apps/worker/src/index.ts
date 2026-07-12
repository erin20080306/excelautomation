import { PrismaClient } from '@prisma/client';
import {
  processingQueueMessageSchema,
  queueRetryDelaySeconds,
  type ProcessingQueueMessage
} from '@excelmaster/shared';
import { createTaskProcessor } from '@excelmaster/processor';
import { createWorkerStorage } from './storage.js';
import {
  archiveProcessingMessage,
  delayProcessingMessage,
  deleteProcessingMessage,
  ensureProcessingQueue,
  readProcessingMessages,
  type DatabaseQueueMessageRecord
} from './queue.js';

const prisma = new PrismaClient();
const storage = createWorkerStorage(prisma);
const parserUrl = process.env.PARSER_URL ?? 'http://localhost:8000';
const processor = createTaskProcessor({
  prisma,
  storage,
  parserUrl,
  parserSecret: process.env.PARSER_SHARED_SECRET
});

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const concurrency = positiveInteger(process.env.WORKER_CONCURRENCY, 3);
const visibilityTimeoutSeconds = positiveInteger(process.env.QUEUE_VISIBILITY_TIMEOUT_SECONDS, 1800);
const pollIntervalMs = positiveInteger(process.env.QUEUE_POLL_INTERVAL_MS, 1000);
const retryBaseSeconds = positiveInteger(process.env.QUEUE_RETRY_BASE_SECONDS, 2);

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withVisibilityHeartbeat(messageId: bigint, task: () => Promise<void>): Promise<void> {
  const heartbeatIntervalMs = Math.max(5000, Math.floor((visibilityTimeoutSeconds * 1000) / 3));
  let heartbeatInFlight = Promise.resolve();
  let heartbeatError: unknown;
  const timer = setInterval(() => {
    heartbeatInFlight = heartbeatInFlight
      .then(() => delayProcessingMessage(prisma, messageId, visibilityTimeoutSeconds))
      .catch((error) => {
        heartbeatError = error;
        console.error(JSON.stringify({ event: 'queue.heartbeat_failed', messageId: messageId.toString(), message: error instanceof Error ? error.message : String(error) }));
      });
  }, heartbeatIntervalMs);
  timer.unref();
  let taskError: unknown;
  try {
    await task();
  } catch (error) {
    taskError = error;
  }
  clearInterval(timer);
  await heartbeatInFlight;
  if (heartbeatError) throw heartbeatError;
  if (taskError) throw taskError;
}

async function processMessage(record: DatabaseQueueMessageRecord): Promise<void> {
  let message: ProcessingQueueMessage;
  try {
    message = processingQueueMessageSchema.parse(record.message);
  } catch (error) {
    await archiveProcessingMessage(prisma, record.msg_id);
    console.error(JSON.stringify({ event: 'queue.invalid', messageId: record.msg_id.toString(), error: error instanceof Error ? error.message : String(error) }));
    return;
  }

  try {
    await withVisibilityHeartbeat(record.msg_id, async () => {
      if (message.type === 'analyze-file') await processor.analyzeItem(message);
      else await processor.exportWorkbook(message);
    });
    await deleteProcessingMessage(prisma, record.msg_id);
    console.log(JSON.stringify({ event: 'queue.completed', messageId: record.msg_id.toString(), type: message.type }));
  } catch (error) {
    const attempts = Number(record.read_ct);
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (attempts >= message.maxAttempts) {
      await archiveProcessingMessage(prisma, record.msg_id);
      console.error(JSON.stringify({ event: 'queue.failed', messageId: record.msg_id.toString(), type: message.type, attempts, message: errorMessage }));
      return;
    }
    const delaySeconds = queueRetryDelaySeconds(attempts, retryBaseSeconds);
    await delayProcessingMessage(prisma, record.msg_id, delaySeconds);
    console.warn(JSON.stringify({ event: 'queue.retry', messageId: record.msg_id.toString(), type: message.type, attempts, delaySeconds, message: errorMessage }));
  }
}

let stopping = false;
process.once('SIGTERM', () => { stopping = true; });
process.once('SIGINT', () => { stopping = true; });

async function runWorker(): Promise<void> {
  await ensureProcessingQueue(prisma);
  console.log(JSON.stringify({ event: 'worker.ready', queue: 'excel_processing', concurrency, visibilityTimeoutSeconds }));
  while (!stopping) {
    try {
      const messages = await readProcessingMessages(prisma, visibilityTimeoutSeconds, concurrency);
      if (messages.length) await Promise.all(messages.map(processMessage));
      else await sleep(pollIntervalMs);
    } catch (error) {
      console.error(JSON.stringify({ event: 'queue.poll_failed', message: error instanceof Error ? error.message : String(error) }));
      await sleep(Math.max(1000, pollIntervalMs));
    }
  }
}

try {
  await runWorker();
} finally {
  await prisma.$disconnect();
}
