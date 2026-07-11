import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { bootstrapWorkspace } from '../lib/workspace-bootstrap.js';
import { writeAudit } from '../lib/audit.js';

const credentials = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), password: z.string().min(10).max(128) });

function issueToken(app: FastifyInstance, userId: string, workspaceId: string): string {
  return jwt.sign({ userId, workspaceId }, app.config.JWT_SECRET, { expiresIn: '8h', audience: 'excelmaster-api' });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/register', async (request, reply) => {
    const body = credentials.extend({ name: z.string().trim().min(2).max(80), workspaceName: z.string().trim().min(2).max(100) }).parse(request.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return reply.code(409).send({ message: '此 Email 已註冊' });
    const passwordHash = await bcrypt.hash(body.password, 12);
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: body.email, name: body.name, passwordHash } });
      const workspace = await tx.workspace.create({ data: { name: body.workspaceName, members: { create: { userId: user.id, role: 'OWNER' } } } });
      await bootstrapWorkspace(tx, workspace.id);
      return { user, workspace };
    });
    await writeAudit({ workspaceId: result.workspace.id, userId: result.user.id, action: 'auth.register', ipAddress: request.ip });
    return reply.code(201).send({ token: issueToken(app, result.user.id, result.workspace.id), user: { id: result.user.id, email: result.user.email, name: result.user.name }, workspace: { id: result.workspace.id, name: result.workspace.name, role: 'OWNER' } });
  });

  app.post('/login', async (request, reply) => {
    const body = credentials.parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email }, include: { memberships: { include: { workspace: true }, orderBy: { workspace: { createdAt: 'asc' } } } } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) return reply.code(401).send({ message: '帳號或密碼錯誤' });
    const membership = user.memberships[0];
    if (!membership) return reply.code(403).send({ message: '帳號尚未加入工作區' });
    await writeAudit({ workspaceId: membership.workspaceId, userId: user.id, action: 'auth.login', ipAddress: request.ip });
    return { token: issueToken(app, user.id, membership.workspaceId), user: { id: user.id, email: user.email, name: user.name }, workspace: { id: membership.workspaceId, name: membership.workspace.name, role: membership.role } };
  });

  app.get('/me', { preHandler: app.authenticate }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.auth.userId }, select: { id: true, email: true, name: true } });
    const membership = await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: request.auth.workspaceId, userId: request.auth.userId } }, include: { workspace: true } });
    return { user, workspace: { id: membership.workspaceId, name: membership.workspace.name, role: membership.role } };
  });

  app.get('/workspaces', { preHandler: app.authenticate }, async (request) => {
    const items = await prisma.workspaceMember.findMany({ where: { userId: request.auth.userId }, include: { workspace: true } });
    return { items: items.map((item) => ({ id: item.workspaceId, name: item.workspace.name, role: item.role })) };
  });

  app.post('/switch-workspace', { preHandler: app.authenticate }, async (request) => {
    const { workspaceId } = z.object({ workspaceId: z.string().cuid() }).parse(request.body);
    const membership = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: request.auth.userId } }, include: { workspace: true, user: true } });
    if (!membership) throw app.httpErrors.forbidden('無此工作區權限');
    return { token: issueToken(app, membership.userId, workspaceId), user: { id: membership.user.id, email: membership.user.email, name: membership.user.name }, workspace: { id: workspaceId, name: membership.workspace.name, role: membership.role } };
  });
}
