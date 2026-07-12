import { describe, expect, it } from 'vitest';
import { hasPermission, hasUnlimitedUsage } from './access.js';

describe('access control', () => {
  it('keeps workspace ownership separate from paid entitlement', () => {
    expect(hasUnlimitedUsage('USER')).toBe(false);
    expect(hasUnlimitedUsage('SUPERADMIN')).toBe(true);
  });

  it('enforces the workspace role matrix', () => {
    expect(hasPermission('VIEWER', 'content:write')).toBe(false);
    expect(hasPermission('EDITOR', 'content:write')).toBe(true);
    expect(hasPermission('ADMIN', 'workspace:manage')).toBe(true);
  });
});
