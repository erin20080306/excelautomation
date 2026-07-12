import { describe, expect, it } from 'vitest';
import { signDownload, verifyDownload } from './security.js';

describe('download signatures', () => {
  it('round-trips inside the configured Fastify path parameter limit', () => {
    const payload = {
      exportFileId: 'cm1234567890abcdefghijklmnopqrstuvwxyz',
      workspaceId: 'cm0987654321abcdefghijklmnopqrstuvwxyz'
    };
    const token = signDownload(payload, 'test-secret-with-at-least-32-characters');

    expect(token.length).toBeLessThan(512);
    expect(verifyDownload(token, 'test-secret-with-at-least-32-characters')).toMatchObject(payload);
  });
});
