import { prisma } from './prisma.js';

export async function writeAudit(input: {
  workspaceId: string; userId?: string; action: string; entityType?: string; entityId?: string;
  metadata?: Record<string, unknown>; ipAddress?: string;
}): Promise<void> {
  await prisma.auditLog.create({ data: { ...input, metadata: (input.metadata ?? {}) as object } });
}
