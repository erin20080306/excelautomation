import type { AppConfig } from '../config.js';

type VerifyResult = { active?: boolean; message?: string; expiresAt?: string; nextCheckSeconds?: number };

export function createInstalledLicenseGuard(config: AppConfig, request: typeof fetch = fetch) {
  let lastSuccessAt = 0;
  let nextCheckAt = 0;

  return async function verifyInstalledLicense(force = false): Promise<void> {
    if (!config.LICENSE_ENFORCEMENT) return;
    const now = Date.now();
    if (!force && now < nextCheckAt) return;
    try {
      const response = await request(`${config.LICENSE_SERVER_URL}/api/downloads/license/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activationCode: config.LICENSE_ACTIVATION_CODE, deviceId: config.LICENSE_DEVICE_ID }),
        signal: AbortSignal.timeout(10_000)
      });
      const result = await response.json() as VerifyResult;
      if (!response.ok || !result.active) throw Object.assign(new Error(result.message ?? '訂閱已到期或裝置授權已撤銷'), { authoritative: true });
      lastSuccessAt = now;
      const serverInterval = Math.max(300, Math.min(result.nextCheckSeconds ?? config.LICENSE_CHECK_INTERVAL_MINUTES * 60, 3_600));
      nextCheckAt = now + serverInterval * 1_000;
    } catch (error) {
      const authoritative = error instanceof Error && 'authoritative' in error;
      const withinGrace = !authoritative && lastSuccessAt > 0 && now - lastSuccessAt <= config.LICENSE_OFFLINE_GRACE_HOURS * 3_600_000;
      if (withinGrace) {
        nextCheckAt = now + 5 * 60_000;
        return;
      }
      const reason = error instanceof Error ? error.message : '無法連線授權伺服器';
      throw Object.assign(new Error(`ExcelMaster 安裝版授權驗證失敗：${reason}`), { statusCode: 402 });
    }
  };
}
