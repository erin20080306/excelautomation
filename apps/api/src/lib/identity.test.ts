import { describe, expect, it } from 'vitest';
import { buildOtpAuthUri, createTotpSecret, generateTotpCode, verifyTotp } from './identity.js';

describe('TOTP identity protection', () => {
  it('creates authenticator-compatible secrets and verifies a narrow time window', () => {
    const secret = createTotpSecret(); const now = 1_800_000_000_000; const code = generateTotpCode(secret, now);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, code, now + 120_000)).toBe(false);
    expect(buildOtpAuthUri('owner@example.com', secret)).toContain('otpauth://totp/');
  });
});
