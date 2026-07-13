import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { PLAN_CATALOG, PLAN_ORDER, type PlanKey } from '../lib/plans.js';

const paidPlan = z.enum(['STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE']);

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/plans', async () => ({ items: PLAN_ORDER.map((key) => ({ key, ...PLAN_CATALOG[key] })) }));

  app.post('/checkout', { preHandler: app.authenticate }, async (request, reply) => {
    if (!app.config.STRIPE_SECRET_KEY) return reply.code(503).send({ message: '付款服務尚未啟用' });
    const { plan } = z.object({ plan: paidPlan }).parse(request.body);
    if (PLAN_ORDER.indexOf(plan) <= PLAN_ORDER.indexOf(request.auth.workspacePlan)) return reply.code(400).send({ message: '只能購買高於目前方案的升級方案' });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.auth.userId } });
    const catalog = PLAN_CATALOG[plan];
    const order = await prisma.paymentOrder.create({ data: { userId: request.auth.userId, workspaceId: request.auth.workspaceId, plan, amountTwd: catalog.priceTwd, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } });
    const form = new URLSearchParams();
    form.set('mode', 'payment');
    form.set('success_url', `${app.config.APP_URL}/billing?success=1&session_id={CHECKOUT_SESSION_ID}`);
    form.set('cancel_url', `${app.config.APP_URL}/billing?cancelled=1`);
    form.set('client_reference_id', order.id);
    form.set('customer_email', user.email);
    form.set('line_items[0][quantity]', '1');
    form.set('line_items[0][price_data][currency]', 'twd');
    form.set('line_items[0][price_data][unit_amount]', String(catalog.priceTwd * 100));
    form.set('line_items[0][price_data][product_data][name]', `ExcelMaster ${catalog.name}`);
    form.set('metadata[order_id]', order.id);
    form.set('metadata[workspace_id]', order.workspaceId);
    form.set('metadata[plan]', plan);
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST', headers: { authorization: `Bearer ${app.config.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': order.id }, body: form
    });
    const result = await response.json() as { id?: string; url?: string; error?: { message?: string } };
    if (!response.ok || !result.id || !result.url) {
      await prisma.paymentOrder.update({ where: { id: order.id }, data: { status: 'EXPIRED' } });
      return reply.code(502).send({ message: result.error?.message ?? '無法建立付款頁面' });
    }
    await prisma.paymentOrder.update({ where: { id: order.id }, data: { providerSessionId: result.id } });
    return { checkoutUrl: result.url, orderId: order.id };
  });

  app.get('/orders', { preHandler: app.authenticate }, async (request) => {
    const items = await prisma.paymentOrder.findMany({ where: { workspaceId: request.auth.workspaceId }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { items };
  });
}

export function verifyStripeSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const values = Object.fromEntries(signature.split(',').map((part) => part.split('=', 2) as [string, string]));
  const timestamp = values.t;
  const expected = values.v1;
  if (!timestamp || !expected || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const actual = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody.toString('utf8')}`).digest('hex');
  return actual.length === expected.length && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function billingWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhook', async (request, reply) => {
    if (!app.config.STRIPE_WEBHOOK_SECRET) return reply.code(503).send({ message: 'Webhook 尚未設定' });
    const rawBody = request.body as Buffer;
    const signature = request.headers['stripe-signature'];
    if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string' || !verifyStripeSignature(rawBody, signature, app.config.STRIPE_WEBHOOK_SECRET)) return reply.code(400).send({ message: 'Webhook 簽章錯誤' });
    const event = JSON.parse(rawBody.toString('utf8')) as { type: string; data: { object: any } };
    const session = event.data.object;
    const orderId = String(session.metadata?.order_id ?? session.client_reference_id ?? '');
    if (!orderId) return { received: true };
    if (event.type === 'checkout.session.completed' && session.payment_status === 'paid') {
      const order = await prisma.paymentOrder.findUnique({ where: { id: orderId } });
      if (order && order.status !== 'PAID') {
        const plan = order.plan as PlanKey;
        const catalog = PLAN_CATALOG[plan];
        await prisma.$transaction([
          prisma.paymentOrder.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: new Date(), providerPaymentId: String(session.payment_intent ?? '') } }),
          prisma.workspace.update({ where: { id: order.workspaceId }, data: { plan, fileQuota: catalog.fileQuota, totalMbQuota: catalog.totalMbQuota, outputMbQuota: catalog.outputMbQuota, downloadQuota: catalog.downloadQuota } }),
          prisma.platformAudit.create({ data: { actorUserId: order.userId, action: 'billing.order.paid', entityType: 'PaymentOrder', entityId: order.id, metadata: { plan, amountTwd: order.amountTwd, providerSessionId: session.id } } })
        ]);
      }
    }
    if (event.type === 'checkout.session.expired') await prisma.paymentOrder.updateMany({ where: { id: orderId, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    return { received: true };
  });
}
