import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { bootstrapWorkspace } from '../lib/workspace-bootstrap.js';
import { writeAudit } from '../lib/audit.js';
import { decryptSecret, encryptSecret } from '../lib/security.js';
import {
  buildOtpAuthUri, consumeAuthToken, createAuthToken, createTotpSecret, identityServicesReady,
  sendEmail, verifyCaptcha, verifyTotp
} from '../lib/identity.js';
import { subscriptionSnapshot } from '../lib/subscription.js';

const baseCredentials = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), password: z.string().min(10).max(128) });

function issueToken(app: FastifyInstance, userId: string, workspaceId: string): string {
  return jwt.sign({ userId, workspaceId }, app.config.JWT_SECRET, { expiresIn: '8h', audience: 'excelmaster-api' });
}

function sessionPayload(app: FastifyInstance, user: any, membership: any) {
  const workspace = membership.workspace;
  const entitlement = subscriptionSnapshot(workspace);
  return {
    token: issueToken(app, user.id, membership.workspaceId),
    user: { id: user.id, email: user.email, name: user.name, platformRole: user.platformRole, mfaEnabled: Boolean(user.mfaEnabledAt) },
    workspace: {
      id: workspace.id, name: workspace.name, role: membership.role, plan: entitlement.effectivePlan,
      purchasedPlan: entitlement.purchasedPlan,
      subscription: { active: entitlement.active, status: entitlement.status, interval: entitlement.interval, startedAt: entitlement.startedAt, endsAt: entitlement.endsAt },
      fileQuota: entitlement.catalog.fileQuota, totalMbQuota: entitlement.catalog.totalMbQuota,
      outputMbQuota: entitlement.catalog.outputMbQuota, downloadQuota: entitlement.catalog.downloadQuota
    }
  };
}

async function sendVerification(app: FastifyInstance, user: { id: string; email: string }): Promise<void> {
  const token = await createAuthToken(user.id, 'VERIFY_EMAIL', 60);
  const url = `${app.config.APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await sendEmail(app.config, { to: user.email, subject: '驗證您的 ExcelMaster 帳號', html: `<p>請在 60 分鐘內完成 Email 驗證：</p><p><a href="${url}">驗證帳號</a></p>` });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/capabilities', async () => ({
    registrationEnabled: identityServicesReady(app.config), captchaRequired: app.config.NODE_ENV === 'production',
    processing: {
      mode: app.config.PROCESSING_MODE,
      maxFilesPerBatch: app.config.PROCESSING_MODE === 'inline' ? app.config.INLINE_MAX_FILES : null,
      maxUploadMb: app.config.PROCESSING_MODE === 'inline' ? Math.min(app.config.MAX_FILE_SIZE_MB, app.config.INLINE_MAX_TOTAL_MB) : null,
      maxOutputMb: app.config.PROCESSING_MODE === 'inline' ? app.config.INLINE_MAX_OUTPUT_MB : null
    }
  }));

  app.post('/register', async (request, reply) => {
    if (!identityServicesReady(app.config)) return reply.code(503).send({ message: '公開註冊尚未啟用，請聯絡管理者設定驗證服務' });
    const body = baseCredentials.extend({ name: z.string().trim().min(2).max(80), workspaceName: z.string().trim().min(2).max(100), captchaToken: z.string().min(1) }).parse(request.body);
    if (!(await verifyCaptcha(app.config, body.captchaToken, request.ip))) return reply.code(400).send({ message: '人機驗證失敗，請重新操作' });
    const existing = await prisma.user.findUnique({ where: { email: body.email } });
    if (existing) return reply.code(409).send({ message: '此 Email 已註冊' });
    const passwordHash = await bcrypt.hash(body.password, 12);
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: body.email, name: body.name, passwordHash, status: 'PENDING_VERIFICATION', platformRole: 'USER' } });
      const workspace = await tx.workspace.create({ data: { name: body.workspaceName, plan: 'TRIAL', fileQuota: app.config.TRIAL_MAX_FILES, totalMbQuota: app.config.TRIAL_MAX_TOTAL_MB, outputMbQuota: app.config.TRIAL_MAX_OUTPUT_MB, downloadQuota: 0, members: { create: { userId: user.id, role: 'OWNER' } } } });
      await bootstrapWorkspace(tx, workspace.id);
      return { user, workspace };
    }, { maxWait: 10_000, timeout: 30_000 });
    await sendVerification(app, result.user);
    await writeAudit({ workspaceId: result.workspace.id, userId: result.user.id, action: 'auth.register.pending', ipAddress: request.ip });
    return reply.code(201).send({ verificationRequired: true, message: '驗證信已寄出，完成 Email 驗證後才能登入' });
  });

  app.post('/verify-email', async (request, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(200) }).parse(request.body);
    const userId = await consumeAuthToken(token, 'VERIFY_EMAIL');
    if (!userId) return reply.code(400).send({ message: '驗證連結無效或已過期' });
    const user = await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE', emailVerifiedAt: new Date(), failedLoginCount: 0, lockedUntil: null } });
    await prisma.platformAudit.create({ data: { actorUserId: user.id, action: 'auth.email.verified', entityType: 'User', entityId: user.id, ipAddress: request.ip } });
    return { ok: true };
  });

  app.post('/resend-verification', async (request, reply) => {
    if (!identityServicesReady(app.config)) return reply.code(503).send({ message: 'Email 驗證服務尚未設定' });
    const { email, captchaToken } = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), captchaToken: z.string().min(1) }).parse(request.body);
    if (!(await verifyCaptcha(app.config, captchaToken, request.ip))) return reply.code(400).send({ message: '人機驗證失敗' });
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && !user.emailVerifiedAt && user.status !== 'SUSPENDED') await sendVerification(app, user);
    return reply.code(202).send({ ok: true });
  });

  app.post('/login', async (request, reply) => {
    const body = baseCredentials.extend({ mfaCode: z.string().regex(/^\d{6}$/).optional() }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email }, include: { memberships: { include: { workspace: true }, orderBy: { workspace: { createdAt: 'asc' } } } } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      if (user) {
        const failures = user.failedLoginCount + 1;
        await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: failures, lockedUntil: failures >= app.config.LOGIN_MAX_FAILURES ? new Date(Date.now() + app.config.LOGIN_LOCK_MINUTES * 60_000) : undefined } });
      }
      return reply.code(401).send({ message: '帳號或密碼錯誤' });
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) return reply.code(423).send({ message: `登入嘗試過多，請於 ${user.lockedUntil.toLocaleString('zh-TW')} 後再試` });
    if (user.status === 'PENDING_VERIFICATION' || !user.emailVerifiedAt) return reply.code(403).send({ message: '請先完成 Email 驗證' });
    if (user.status === 'SUSPENDED') return reply.code(403).send({ message: '帳號已停權，請聯絡平台管理者' });
    if (user.mfaEnabledAt && user.mfaSecretEncrypted) {
      if (!body.mfaCode) return reply.code(202).send({ mfaRequired: true });
      if (!verifyTotp(decryptSecret(user.mfaSecretEncrypted, app.config.FIELD_ENCRYPTION_KEY), body.mfaCode)) return reply.code(401).send({ message: 'MFA 驗證碼錯誤' });
    }
    const membership = user.memberships[0];
    if (!membership) return reply.code(403).send({ message: '帳號尚未加入工作區' });
    if (membership.workspace.suspendedAt && user.platformRole !== 'SUPERADMIN') return reply.code(403).send({ message: '工作區已停用' });
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
    await writeAudit({ workspaceId: membership.workspaceId, userId: user.id, action: 'auth.login', ipAddress: request.ip });
    return sessionPayload(app, user, membership);
  });

  app.post('/forgot-password', async (request, reply) => {
    if (!identityServicesReady(app.config)) return reply.code(503).send({ message: '密碼重設服務尚未設定' });
    const { email, captchaToken } = z.object({ email: z.string().email().transform((value) => value.toLowerCase()), captchaToken: z.string().min(1) }).parse(request.body);
    if (!(await verifyCaptcha(app.config, captchaToken, request.ip))) return reply.code(400).send({ message: '人機驗證失敗' });
    const user = await prisma.user.findUnique({ where: { email } });
    if (user && user.status !== 'SUSPENDED') {
      const token = await createAuthToken(user.id, 'RESET_PASSWORD', 30);
      const url = `${app.config.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
      await sendEmail(app.config, { to: user.email, subject: '重設 ExcelMaster 密碼', html: `<p>請在 30 分鐘內重設密碼：</p><p><a href="${url}">重設密碼</a></p>` });
    }
    return reply.code(202).send({ ok: true, message: '如果帳號存在，重設信將寄到該信箱' });
  });

  app.post('/reset-password', async (request, reply) => {
    const { token, password } = z.object({ token: z.string().min(20).max(200), password: z.string().min(12).max(128) }).parse(request.body);
    const userId = await consumeAuthToken(token, 'RESET_PASSWORD');
    if (!userId) return reply.code(400).send({ message: '重設連結無效或已過期' });
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(password, 12), failedLoginCount: 0, lockedUntil: null } });
    await prisma.platformAudit.create({ data: { actorUserId: userId, action: 'auth.password.reset', entityType: 'User', entityId: userId, ipAddress: request.ip } });
    return { ok: true };
  });

  app.get('/me', { preHandler: app.authenticate }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.auth.userId } });
    const membership = await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: request.auth.workspaceId, userId: request.auth.userId } }, include: { workspace: true } });
    return sessionPayload(app, user, membership);
  });

  app.get('/workspaces', { preHandler: app.authenticate }, async (request) => {
    const items = await prisma.workspaceMember.findMany({ where: { userId: request.auth.userId }, include: { workspace: true } });
    return { items: items.map((item) => { const entitlement = subscriptionSnapshot(item.workspace); return { id: item.workspaceId, name: item.workspace.name, role: item.role, plan: entitlement.effectivePlan, purchasedPlan: entitlement.purchasedPlan, subscription: { active: entitlement.active, status: entitlement.status, endsAt: entitlement.endsAt } }; }) };
  });

  app.post('/switch-workspace', { preHandler: app.authenticate }, async (request) => {
    const { workspaceId } = z.object({ workspaceId: z.string().cuid() }).parse(request.body);
    const membership = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: request.auth.userId } }, include: { workspace: true, user: true } });
    if (!membership) throw app.httpErrors.forbidden('無此工作區權限');
    return sessionPayload(app, membership.user, membership);
  });

  app.post('/mfa/setup', { preHandler: app.authenticate }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.auth.userId } });
    const secret = createTotpSecret();
    await prisma.user.update({ where: { id: user.id }, data: { mfaSecretEncrypted: encryptSecret(secret, app.config.FIELD_ENCRYPTION_KEY), mfaEnabledAt: null } });
    return { secret, otpauthUri: buildOtpAuthUri(user.email, secret) };
  });

  app.post('/mfa/enable', { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(request.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.auth.userId } });
    if (!user.mfaSecretEncrypted || !verifyTotp(decryptSecret(user.mfaSecretEncrypted, app.config.FIELD_ENCRYPTION_KEY), code)) return reply.code(400).send({ message: 'MFA 驗證碼錯誤' });
    await prisma.user.update({ where: { id: user.id }, data: { mfaEnabledAt: new Date() } });
    return { ok: true };
  });

  app.post('/mfa/disable', { preHandler: app.authenticate }, async (request, reply) => {
    const { password, code } = z.object({ password: z.string().min(10), code: z.string().regex(/^\d{6}$/) }).parse(request.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.auth.userId } });
    if (!(await bcrypt.compare(password, user.passwordHash)) || !user.mfaSecretEncrypted || !verifyTotp(decryptSecret(user.mfaSecretEncrypted, app.config.FIELD_ENCRYPTION_KEY), code)) return reply.code(400).send({ message: '密碼或 MFA 驗證碼錯誤' });
    await prisma.user.update({ where: { id: user.id }, data: { mfaSecretEncrypted: null, mfaEnabledAt: null } });
    return { ok: true };
  });
}
