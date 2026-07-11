import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    auth: { userId: string; workspaceId: string; role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' };
  }
}
