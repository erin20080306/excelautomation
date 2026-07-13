import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const required = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/excelmaster',
  JWT_SECRET: 'a-secure-secret-with-at-least-32-characters',
  FIELD_ENCRYPTION_KEY: 'a'.repeat(64)
};

describe('loadConfig', () => {
  it('uses a hosting provider PORT when API_PORT is not set', () => {
    expect(loadConfig({ ...required, PORT: '8080' }).API_PORT).toBe(8080);
  });

  it('prefers API_PORT when both port variables are set', () => {
    expect(loadConfig({ ...required, PORT: '8080', API_PORT: '4000' }).API_PORT).toBe(4000);
  });

  it('parses the S3 path-style switch without treating false as truthy', () => {
    expect(loadConfig({ ...required, S3_FORCE_PATH_STYLE: 'false' }).S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('supports the bounded Vercel inline processing mode', () => {
    const config = loadConfig({
      ...required,
      PROCESSING_MODE: 'inline',
      TRIAL_MAX_FILES: '5',
      TRIAL_MAX_TOTAL_MB: '3',
      TRIAL_MAX_OUTPUT_MB: '4'
    });
    expect(config.PROCESSING_MODE).toBe('inline');
    expect(config.TRIAL_MAX_FILES).toBe(5);
    expect(config.TRIAL_MAX_TOTAL_MB).toBe(3);
  });

  it('treats blank optional service settings as not configured', () => {
    const config = loadConfig({ ...required, STRIPE_SECRET_KEY: '', ECPAY_MERCHANT_ID: '', TURNSTILE_SECRET_KEY: '' });
    expect(config.STRIPE_SECRET_KEY).toBeUndefined();
    expect(config.ECPAY_MERCHANT_ID).toBeUndefined();
    expect(config.TURNSTILE_SECRET_KEY).toBeUndefined();
  });
});
