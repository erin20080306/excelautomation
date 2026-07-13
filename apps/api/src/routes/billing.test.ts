import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyStripeSignature } from './billing.js';

describe('Stripe webhook signature', () => {
  it('accepts the signed raw body and rejects tampering', () => {
    const body = Buffer.from('{"type":"checkout.session.completed"}'); const secret = 'whsec_test_secret'; const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body.toString('utf8')}`).digest('hex');
    expect(verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret)).toBe(true);
    expect(verifyStripeSignature(Buffer.from('{}'), `t=${timestamp},v1=${signature}`, secret)).toBe(false);
  });
});
