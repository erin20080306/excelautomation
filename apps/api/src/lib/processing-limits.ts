export type ProcessingLimitInput = {
  processingMode: 'inline' | 'queue';
  inlineFileQuota: number;
  inlineTotalMbQuota: number;
  inlineOutputMbQuota: number;
};

export type ProcessingAuthInput = {
  platformRole: 'USER' | 'SUPERADMIN';
  fileQuota: number;
  totalMbQuota: number;
  outputMbQuota: number;
};

export function resolveProcessingLimits(config: ProcessingLimitInput, auth: ProcessingAuthInput) {
  const inline = config.processingMode === 'inline';
  const productUnlimited = auth.platformRole === 'SUPERADMIN';
  return {
    inline,
    unlimited: productUnlimited && !inline,
    fileQuota: inline ? Math.min(auth.fileQuota, config.inlineFileQuota) : auth.fileQuota,
    totalMbQuota: inline ? Math.min(auth.totalMbQuota, config.inlineTotalMbQuota) : auth.totalMbQuota,
    outputMbQuota: inline ? Math.min(auth.outputMbQuota, config.inlineOutputMbQuota) : auth.outputMbQuota
  };
}
