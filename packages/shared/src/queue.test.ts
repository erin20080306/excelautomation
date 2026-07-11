import { describe, expect, it } from 'vitest';
import { pgmqRetryDelaySeconds, processingQueueMessageSchema } from './index.js';

describe('Supabase queue messages', () => {
  it('applies the analyze retry default', () => {
    const message = processingQueueMessageSchema.parse({
      type: 'analyze-file',
      processingJobId: 'cm12345678901234567890123',
      itemId: 'cm12345678901234567890124'
    });
    expect(message.maxAttempts).toBe(3);
  });

  it('rejects unsupported message types', () => {
    expect(() => processingQueueMessageSchema.parse({ type: 'unknown' })).toThrow();
  });

  it('uses capped exponential retry delays', () => {
    expect([1, 2, 3, 10].map((attempt) => pgmqRetryDelaySeconds(attempt))).toEqual([2, 4, 8, 300]);
  });
});
