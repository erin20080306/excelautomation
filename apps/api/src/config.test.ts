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
});
