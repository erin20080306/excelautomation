import { Prisma, type PrismaClient } from '@prisma/client';
import { PROCESSING_QUEUE_NAME, type ProcessingQueueMessage } from '@excelmaster/shared';
import { prisma } from './prisma.js';

type QueueClient = Pick<PrismaClient, 'queueMessage'> | Prisma.TransactionClient;

export async function ensureProcessingQueue(): Promise<void> {
  await prisma.queueMessage.count({ where: { queue: PROCESSING_QUEUE_NAME } });
}

export async function enqueueProcessingMessage(
  client: QueueClient,
  message: ProcessingQueueMessage,
  delaySeconds = 0
): Promise<bigint> {
  const messageIds = await enqueueProcessingMessages(client, [message], delaySeconds);
  const messageId = messageIds[0];
  if (messageId === undefined) throw new Error('資料庫 Queue 未回傳訊息 ID');
  return messageId;
}

export async function enqueueProcessingMessages(
  client: QueueClient,
  messages: ProcessingQueueMessage[],
  delaySeconds = 0
): Promise<bigint[]> {
  if (!messages.length) return [];
  const visibleAt = new Date(Date.now() + Math.max(0, Math.floor(delaySeconds)) * 1000);
  const rows = await client.queueMessage.createManyAndReturn({
    data: messages.map((message) => ({
      queue: PROCESSING_QUEUE_NAME,
      payload: message as unknown as Prisma.InputJsonValue,
      visibleAt
    })),
    select: { id: true }
  });
  if (rows.length !== messages.length) throw new Error('資料庫 Queue 批次入列數量不符');
  return rows.map((row) => row.id);
}
