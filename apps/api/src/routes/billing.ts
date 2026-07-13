import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { createEcpayCheckMacValue, ecpayCheckoutUrl, verifyEcpayCheckMacValue, type EcpayFields } from '../lib/ecpay.js';
import { PLAN_CATALOG, PLAN_ORDER, type PlanKey } from '../lib/plans.js';

const paidPlan = z.enum(['STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE']);

function ecpayReady(app: FastifyInstance): boolean {
  return Boolean(app.config.ECPAY_MERCHANT_ID && app.config.ECPAY_HASH_KEY && app.config.ECPAY_HASH_IV);
}

function taipeiDate(value = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

function newMerchantTradeNo(): string {
  return `EM${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`.slice(0, 20);
}

async function markOrderPaid(input: { orderId: string; provider: string; providerSessionId: string; providerPaymentId: string; amountTwd: number }): Promise<boolean> {
  const order = await prisma.paymentOrder.findUnique({ where: { id: input.orderId } });
  if (!order || order.provider !== input.provider || order.providerSessionId !== input.providerSessionId || order.amountTwd !== input.amountTwd) return false;
  const plan = order.plan as PlanKey;
  const catalog = PLAN_CATALOG[plan];
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.paymentOrder.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { status: 'PAID', paidAt: new Date(), providerPaymentId: input.providerPaymentId } });
    if (!claimed.count) return order.status === 'PAID';
    await tx.workspace.update({ where: { id: order.workspaceId }, data: { plan, fileQuota: catalog.fileQuota, totalMbQuota: catalog.totalMbQuota, outputMbQuota: catalog.outputMbQuota, downloadQuota: catalog.downloadQuota } });
    await tx.platformAudit.create({ data: { actorUserId: order.userId, action: 'billing.order.paid', entityType: 'PaymentOrder', entityId: order.id, metadata: { plan, amountTwd: order.amountTwd, provider: input.provider, providerSessionId: input.providerSessionId } } });
    return true;
  });
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/plans', async () => ({ items: PLAN_ORDER.map((key) => ({ key, ...PLAN_CATALOG[key] })) }));

  app.post('/checkout', { preHandler: app.authenticate }, async (request, reply) => {
    const { plan } = z.object({ plan: paidPlan }).parse(request.body);
    if (PLAN_ORDER.indexOf(plan) <= PLAN_ORDER.indexOf(request.auth.workspacePlan)) return reply.code(400).send({ message: '只能購買高於目前方案的升級方案' });
    const catalog = PLAN_CATALOG[plan];

    if (ecpayReady(app)) {
      if (plan === 'ENTERPRISE') return reply.code(400).send({ message: '企業授權版超過一般線上刷卡單筆上限，請由管理者建立報價與人工付款訂單' });
      const merchantTradeNo = newMerchantTradeNo();
      const order = await prisma.paymentOrder.create({ data: { userId: request.auth.userId, workspaceId: request.auth.workspaceId, plan, amountTwd: catalog.priceTwd, provider: 'ecpay', providerSessionId: merchantTradeNo, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } });
      const fields: EcpayFields = {
        MerchantID: app.config.ECPAY_MERCHANT_ID!, MerchantTradeNo: merchantTradeNo, MerchantTradeDate: taipeiDate(),
        PaymentType: 'aio', TotalAmount: String(catalog.priceTwd), TradeDesc: 'ExcelMaster software license',
        ItemName: `ExcelMaster ${catalog.name}`, ReturnURL: `${request.protocol}://${request.host}/api/billing/ecpay/notify`,
        ChoosePayment: 'Credit', EncryptType: '1', NeedExtraPaidInfo: 'N', ClientBackURL: `${app.config.APP_URL}/billing?order_id=${encodeURIComponent(order.id)}`
      };
      fields.CheckMacValue = createEcpayCheckMacValue(fields, app.config.ECPAY_HASH_KEY!, app.config.ECPAY_HASH_IV!);
      return { provider: 'ecpay', orderId: order.id, checkoutForm: { action: ecpayCheckoutUrl(app.config.ECPAY_TEST_MODE), fields } };
    }

    if (!app.config.STRIPE_SECRET_KEY) return reply.code(503).send({ message: '付款服務尚未啟用；台灣商家請設定綠界 ECPay 商店金鑰' });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.auth.userId } });
    const order = await prisma.paymentOrder.create({ data: { userId: request.auth.userId, workspaceId: request.auth.workspaceId, plan, amountTwd: catalog.priceTwd, provider: 'stripe', expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } });
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
    return { provider: 'stripe', checkoutUrl: result.url, orderId: order.id };
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
      const paid = await markOrderPaid({ orderId, provider: 'stripe', providerSessionId: String(session.id ?? ''), providerPaymentId: String(session.payment_intent ?? ''), amountTwd: Number(session.amount_total) / 100 });
      if (!paid) return reply.code(400).send({ message: '付款訂單資料不一致' });
    }
    if (event.type === 'checkout.session.expired') await prisma.paymentOrder.updateMany({ where: { id: orderId, provider: 'stripe', status: 'PENDING' }, data: { status: 'EXPIRED' } });
    return { received: true };
  });

  app.post('/ecpay/notify', async (request, reply) => {
    reply.type('text/plain; charset=utf-8');
    if (!ecpayReady(app) || !Buffer.isBuffer(request.body)) return reply.code(503).send('0|Config Error');
    const fields = Object.fromEntries(new URLSearchParams((request.body as Buffer).toString('utf8')).entries()) as EcpayFields;
    if (fields.MerchantID !== app.config.ECPAY_MERCHANT_ID || !verifyEcpayCheckMacValue(fields, app.config.ECPAY_HASH_KEY!, app.config.ECPAY_HASH_IV!)) return reply.code(400).send('0|CheckMacValue Error');
    if (fields.RtnCode !== '1' || (!app.config.ECPAY_TEST_MODE && fields.SimulatePaid === '1')) return reply.send('1|OK');
    const callback = z.object({ MerchantTradeNo: z.string().min(1).max(20), TradeNo: z.string().max(30).optional(), TradeAmt: z.string().regex(/^\d+$/) }).safeParse(fields);
    if (!callback.success) return reply.code(400).send('0|Invalid Payload');
    const order = await prisma.paymentOrder.findUnique({ where: { providerSessionId: callback.data.MerchantTradeNo } });
    if (!order) return reply.code(400).send('0|Order Not Found');
    const paid = await markOrderPaid({ orderId: order.id, provider: 'ecpay', providerSessionId: callback.data.MerchantTradeNo, providerPaymentId: callback.data.TradeNo ?? '', amountTwd: Number(callback.data.TradeAmt) });
    return paid ? reply.send('1|OK') : reply.code(400).send('0|Order Mismatch');
  });
}
