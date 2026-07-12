import type { Prisma, PrismaClient } from '@prisma/client';
import { PROCESSING_QUEUE_NAME } from '@excelmaster/shared';

export interface DatabaseQueueMessageRecord {
  msg_id: bigint;
  read_ct: bigint;
  enqueued_at: Date;
  vt: Date;
  message: Prisma.JsonValue;
}

export async function ensureProcessingQueue(prisma: PrismaClient): Promise<void> {
  await prisma.queueMessage.count({ where: { queue: PROCESSING_QUEUE_NAME } });
}

export async function readProcessingMessages(
  prisma: PrismaClient,
  visibilityTimeoutSeconds: number,
  quantity: number
): Promise<DatabaseQueueMessageRecord[]> {
  const timeoutSeconds = Math.max(1, Math.floor(visibilityTimeoutSeconds));
  const limit = Math.max(1, Math.floor(quantity));
  return prisma.$queryRaw<DatabaseQueueMessageRecord[]>`
    UPDATE "QueueMessage" AS message
    SET
      "readCount" = message."readCount" + 1,
      "visibleAt" = (NOW() AT TIME ZONE 'UTC') + (${timeoutSeconds} * INTERVAL '1 second'),
      "updatedAt" = (NOW() AT TIME ZONE 'UTC')
    WHERE message."id" IN (
      SELECT candidate."id"
      FROM "QueueMessage" AS candidate
      WHERE candidate."queue" = ${PROCESSING_QUEUE_NAME}
        AND candidate."archivedAt" IS NULL
        AND candidate."visibleAt" <= (NOW() AT TIME ZONE 'UTC')
      ORDER BY candidate."id"
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING
      message."id" AS msg_id,
      message."readCount"::bigint AS read_ct,
      message."createdAt" AS enqueued_at,
      message."visibleAt" AS vt,
      message."payload" AS message
  `;
}

export async function deleteProcessingMessage(prisma: PrismaClient, messageId: bigint): Promise<void> {
  await prisma.queueMessage.deleteMany({ where: { id: messageId, queue: PROCESSING_QUEUE_NAME } });
}

export async function archiveProcessingMessage(prisma: PrismaClient, messageId: bigint): Promise<void> {
  await prisma.queueMessage.updateMany({ where: { id: messageId, queue: PROCESSING_QUEUE_NAME }, data: { archivedAt: new Date() } });
}

export async function delayProcessingMessage(prisma: PrismaClient, messageId: bigint, delaySeconds: number): Promise<void> {
  const visibleAt = new Date(Date.now() + Math.max(1, Math.floor(delaySeconds)) * 1000);
  await prisma.queueMessage.updateMany({ where: { id: messageId, queue: PROCESSING_QUEUE_NAME }, data: { visibleAt } });
}
