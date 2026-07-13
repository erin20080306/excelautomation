import { describe, expect, it } from 'vitest';
import { effectivePlatformRole, isAllowedSuperadmin } from './admin-access.js';

describe('admin allowlist', () => {
  const allowed = 'erin20080306@gmail.com';

  it('allows only the configured account', () => {
    expect(isAllowedSuperadmin('ERIN20080306@gmail.com', allowed)).toBe(true);
    expect(isAllowedSuperadmin('other@example.com', allowed)).toBe(false);
  });

  it('demotes a database superadmin that is not allowlisted', () => {
    expect(effectivePlatformRole('SUPERADMIN', 'other@example.com', allowed)).toBe('USER');
    expect(effectivePlatformRole('SUPERADMIN', 'erin20080306@gmail.com', allowed)).toBe('SUPERADMIN');
  });
});
