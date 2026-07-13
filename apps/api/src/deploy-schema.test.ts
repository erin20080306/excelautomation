import { describe, expect, it } from 'vitest';
import { subscriptionMigrationStatements } from './deploy-schema.js';

describe('subscription deployment schema', () => {
  it('uses idempotent DDL and preserves existing paid workspaces with a transition period', () => {
    const sql = subscriptionMigrationStatements.join('\n');
    expect(sql).toContain('IF NOT EXISTS');
    expect(sql).toContain('WHEN duplicate_object');
    expect(sql).toContain("INTERVAL '30 days'");
    expect(sql).toContain('LicenseActivation');
    expect(sql).toContain('CodeGeneration');
    expect(sql).toContain('CodeGenerationStatus');
  });
});
