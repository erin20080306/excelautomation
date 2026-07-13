import { describe, expect, it, vi } from 'vitest';
import { createInstalledLicenseGuard } from './installed-license.js';

const config = {
  LICENSE_ENFORCEMENT: true, LICENSE_SERVER_URL: 'https://license.example.com', LICENSE_ACTIVATION_CODE: 'EM-123456789012345678901234',
  LICENSE_DEVICE_ID: 'device-1234567890', LICENSE_CHECK_INTERVAL_MINUTES: 15, LICENSE_OFFLINE_GRACE_HOURS: 24
} as any;

describe('installed license guard', () => {
  it('caches a successful server-authoritative verification', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ active: true, nextCheckSeconds: 900 }), { status: 200 }));
    const guard = createInstalledLicenseGuard(config, request as typeof fetch);
    await guard(); await guard();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('blocks startup when no successful verification exists', async () => {
    const guard = createInstalledLicenseGuard(config, vi.fn(async () => { throw new Error('offline'); }) as typeof fetch);
    await expect(guard(true)).rejects.toMatchObject({ statusCode: 402 });
  });
});
