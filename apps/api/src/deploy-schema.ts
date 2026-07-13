import { PrismaClient } from '@prisma/client';

export const subscriptionMigrationStatements = [
  `DO $$ BEGIN CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY','YEARLY','MANUAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING','ACTIVE','PAST_DUE','CANCELLED','EXPIRED','SUSPENDED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN CREATE TYPE "LicenseStatus" AS ENUM ('PENDING','ACTIVE','REVOKED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING'`,
  `ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "subscriptionInterval" "BillingInterval"`,
  `ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "subscriptionStartedAt" TIMESTAMP(3)`,
  `ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "subscriptionEndsAt" TIMESTAMP(3)`,
  `ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "subscriptionGraceEndsAt" TIMESTAMP(3)`,
  `ALTER TABLE "PaymentOrder" ADD COLUMN IF NOT EXISTS "billingInterval" "BillingInterval" NOT NULL DEFAULT 'MONTHLY'`,
  `CREATE TABLE IF NOT EXISTS "LicenseActivation" (
    "id" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "userId" TEXT NOT NULL, "downloadId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL, "codeLast4" TEXT NOT NULL, "platform" "ReleasePlatform" NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'PENDING', "deviceHash" TEXT, "deviceName" TEXT,
    "activatedAt" TIMESTAMP(3), "lastSeenAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "LicenseActivation_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "LicenseActivation_downloadId_key" ON "LicenseActivation"("downloadId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "LicenseActivation_codeHash_key" ON "LicenseActivation"("codeHash")`,
  `CREATE INDEX IF NOT EXISTS "LicenseActivation_workspaceId_status_lastSeenAt_idx" ON "LicenseActivation"("workspaceId","status","lastSeenAt")`,
  `CREATE INDEX IF NOT EXISTS "LicenseActivation_deviceHash_idx" ON "LicenseActivation"("deviceHash")`,
  `DO $$ BEGIN ALTER TABLE "LicenseActivation" ADD CONSTRAINT "LicenseActivation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN ALTER TABLE "LicenseActivation" ADD CONSTRAINT "LicenseActivation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN ALTER TABLE "LicenseActivation" ADD CONSTRAINT "LicenseActivation_downloadId_fkey" FOREIGN KEY ("downloadId") REFERENCES "PackageDownload"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `UPDATE "Workspace" SET "subscriptionStatus"='ACTIVE', "subscriptionInterval"=COALESCE("subscriptionInterval",'MANUAL'), "subscriptionStartedAt"=COALESCE("subscriptionStartedAt",CURRENT_TIMESTAMP), "subscriptionEndsAt"=COALESCE("subscriptionEndsAt",CURRENT_TIMESTAMP + INTERVAL '30 days') WHERE "plan" <> 'TRIAL' AND "subscriptionEndsAt" IS NULL`
] as const;

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (tx) => {
      for (const statement of subscriptionMigrationStatements) await tx.$executeRawUnsafe(statement);
    }, { maxWait: 10_000, timeout: 60_000 });
    console.log(`Applied ${subscriptionMigrationStatements.length} idempotent subscription schema steps.`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('deploy-schema.ts') || process.argv[1]?.endsWith('deploy-schema.js')) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : 'Schema deployment failed'); process.exitCode = 1; });
}
