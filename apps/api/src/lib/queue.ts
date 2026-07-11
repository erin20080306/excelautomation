import { Prisma, type PrismaClient } from '@prisma/client';
import { PROCESSING_QUEUE_NAME, type ProcessingQueueMessage } from '@excelmaster/shared';
import { prisma } from './prisma.js';

type QueueClient = Pick<PrismaClient, '$queryRaw'> | Prisma.TransactionClient;

export async function ensureProcessingQueue(): Promise<void> {
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pgmq');
  await prisma.$queryRaw`SELECT pgmq.create(${PROCESSING_QUEUE_NAME})`;
}

export async function enqueueProcessingMessage(
  client: QueueClient,
  message: ProcessingQueueMessage,
  delaySeconds = 0
): Promise<bigint> {
  const messageIds = await enqueueProcessingMessages(client, [message], delaySeconds);
  const messageId = messageIds[0];
  if (messageId === undefined) throw new Error('Supabase Queue 未回傳訊息 ID');
  return messageId;
}

export async function enqueueProcessingMessages(
  client: QueueClient,
  messages: ProcessingQueueMessage[],
  delaySeconds = 0
): Promise<bigint[]> {
  if (!messages.length) return [];
  const payloads = Prisma.join(messages.map((message) => Prisma.sql`CAST(${JSON.stringify(message)} AS jsonb)`));
  const rows = await client.$queryRaw<Array<{ send_batch: bigint }>>`
    SELECT * FROM pgmq.send_batch(
      ${PROCESSING_QUEUE_NAME},
      ARRAY[${payloads}]::jsonb[],
      ${Math.max(0, Math.floor(delaySeconds))}
    )
  `;
  if (rows.length !== messages.length) throw new Error('Supabase Queue 批次入列數量不符');
  return rows.map((row) => row.send_batch);
}
