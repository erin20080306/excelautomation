import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';

export const authPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('auth');
  app.decorate('authenticate', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw app.httpErrors.unauthorized('需要登入');
    let payload: { userId: string; workspaceId: string };
    try {
      payload = jwt.verify(header.slice(7), app.config.JWT_SECRET, { audience: 'excelmaster-api' }) as typeof payload;
    } catch {
      throw app.httpErrors.unauthorized('登入憑證已失效');
    }
    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: payload.workspaceId, userId: payload.userId } }
    });
    if (!member) throw app.httpErrors.forbidden('無此工作區權限');
    request.auth = { userId: payload.userId, workspaceId: payload.workspaceId, role: member.role };
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest): Promise<void>;
    config: import('../config.js').AppConfig;
  }
}
