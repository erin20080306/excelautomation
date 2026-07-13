import { describe, expect, it } from 'vitest';
import { resolveProcessingLimits } from './processing-limits.js';

const auth = { platformRole: 'SUPERADMIN' as const, fileQuota: 500, totalMbQuota: 2_000, outputMbQuota: 2_000 };

describe('processing infrastructure limits', () => {
  it('never lets a superadmin bypass serverless payload limits', () => {
    expect(resolveProcessingLimits({ processingMode: 'inline', inlineFileQuota: 5, inlineTotalMbQuota: 3, inlineOutputMbQuota: 4 }, auth)).toMatchObject({ unlimited: false, fileQuota: 5, totalMbQuota: 3, outputMbQuota: 4 });
  });

  it('keeps the local queue superadmin product-unlimited', () => {
    expect(resolveProcessingLimits({ processingMode: 'queue', inlineFileQuota: 5, inlineTotalMbQuota: 3, inlineOutputMbQuota: 4 }, auth).unlimited).toBe(true);
  });
});
