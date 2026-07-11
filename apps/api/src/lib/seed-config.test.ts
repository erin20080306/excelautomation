import { describe, expect, it } from 'vitest';
import { parseSeedConfig } from './seed-config.js';

describe('seed admin configuration', () => {
  it('accepts an environment-driven test owner without hardcoded credentials', () => {
    const config = parseSeedConfig({
      NODE_ENV: 'test',
      SEED_ADMIN_EMAIL: 'OWNER@EXAMPLE.COM',
      SEED_ADMIN_PASSWORD: 'safe-test-password',
      SEED_ADMIN_NAME: '測試擁有者',
      SEED_WORKSPACE_NAME: '測試工作區'
    });
    expect(config.SEED_ADMIN_EMAIL).toBe('owner@example.com');
    expect(config.SEED_ADMIN_PASSWORD).toHaveLength(18);
  });

  it('refuses production seeding unless it is explicitly authorized', () => {
    expect(() => parseSeedConfig({
      NODE_ENV: 'production',
      SEED_ADMIN_EMAIL: 'owner@example.com',
      SEED_ADMIN_PASSWORD: 'safe-test-password'
    })).toThrow('正式環境禁止執行測試帳號 seed');
  });
});
