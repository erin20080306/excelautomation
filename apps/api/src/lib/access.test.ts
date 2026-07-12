import { describe, expect, it } from 'vitest';
import { hasUnlimitedAccess } from './access.js';

describe('hasUnlimitedAccess', () => {
  it.each(['OWNER', 'ADMIN'])('allows %s to bypass trial quotas', (role) => {
    expect(hasUnlimitedAccess(role)).toBe(true);
  });

  it.each(['EDITOR', 'VIEWER', ''])('keeps trial quotas for %s', (role) => {
    expect(hasUnlimitedAccess(role)).toBe(false);
  });
});
