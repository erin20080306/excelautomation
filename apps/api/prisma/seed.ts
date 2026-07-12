import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma.js';
import { parseSeedConfig } from '../src/lib/seed-config.js';
import { bootstrapWorkspace } from '../src/lib/workspace-bootstrap.js';

const config = parseSeedConfig(process.env);

try {
  const passwordHash = await bcrypt.hash(config.SEED_ADMIN_PASSWORD, 12);
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { email: config.SEED_ADMIN_EMAIL },
      include: { memberships: { include: { workspace: true }, orderBy: { workspace: { createdAt: 'asc' } } } }
    });
    const user = existing
      ? await tx.user.update({ where: { id: existing.id }, data: { name: config.SEED_ADMIN_NAME, passwordHash, platformRole: 'SUPERADMIN', status: 'ACTIVE', emailVerifiedAt: existing.emailVerifiedAt ?? new Date(), failedLoginCount: 0, lockedUntil: null } })
      : await tx.user.create({ data: { email: config.SEED_ADMIN_EMAIL, name: config.SEED_ADMIN_NAME, passwordHash, platformRole: 'SUPERADMIN', status: 'ACTIVE', emailVerifiedAt: new Date() } });

    const existingMembership = existing?.memberships[0];
    if (existingMembership) {
      await tx.workspaceMember.update({ where: { id: existingMembership.id }, data: { role: 'OWNER' } });
      await tx.auditLog.create({ data: { workspaceId: existingMembership.workspaceId, userId: user.id, action: 'seed.test-owner.refresh', metadata: { source: 'environment' } } });
      return { user, workspace: existingMembership.workspace };
    }

    const workspace = await tx.workspace.create({
      data: { name: config.SEED_WORKSPACE_NAME, members: { create: { userId: user.id, role: 'OWNER' } } }
    });
    await bootstrapWorkspace(tx, workspace.id);
    await tx.auditLog.create({ data: { workspaceId: workspace.id, userId: user.id, action: 'seed.test-owner.create', metadata: { source: 'environment' } } });
    return { user, workspace };
  }, { maxWait: 10_000, timeout: 120_000 });
  console.log(`平台管理者已就緒：${result.user.email} / ${result.workspace.name} / SUPERADMIN`);
} finally {
  await prisma.$disconnect();
}
