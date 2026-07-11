import type { Prisma, PrismaClient } from '@prisma/client';
import { PROCESSING_QUEUE_NAME } from '@excelmaster/shared';

export interface PgmqMessageRecord {
  msg_id: bigint;
  read_ct: bigint;
  enqueued_at: Date;
  vt: Date;
  message: Prisma.JsonValue;
}

export async function ensureProcessingQueue(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pgmq');
  await prisma.$queryRaw`SELECT pgmq.create(${PROCESSING_QUEUE_NAME})`;
}

export async function readProcessingMessages(
  prisma: PrismaClient,
  visibilityTimeoutSeconds: number,
  quantity: number
): Promise<PgmqMessageRecord[]> {
  return prisma.$queryRaw<PgmqMessageRecord[]>`
    SELECT * FROM pgmq.read(
      ${PROCESSING_QUEUE_NAME},
      ${Math.max(1, Math.floor(visibilityTimeoutSeconds))},
      ${Math.max(1, Math.floor(quantity))}
    )
  `;
}

export async function deleteProcessingMessage(prisma: PrismaClient, messageId: bigint): Promise<void> {
  await prisma.$queryRaw`SELECT pgmq.delete(${PROCESSING_QUEUE_NAME}, ${messageId})`;
}

export async function archiveProcessingMessage(prisma: PrismaClient, messageId: bigint): Promise<void> {
  await prisma.$queryRaw`SELECT pgmq.archive(${PROCESSING_QUEUE_NAME}, ${messageId})`;
}

export async function delayProcessingMessage(prisma: PrismaClient, messageId: bigint, delaySeconds: number): Promise<void> {
  await prisma.$queryRaw`
    SELECT * FROM pgmq.set_vt(
      ${PROCESSING_QUEUE_NAME},
      ${messageId},
      ${Math.max(1, Math.floor(delaySeconds))}
    )
  `;
}
