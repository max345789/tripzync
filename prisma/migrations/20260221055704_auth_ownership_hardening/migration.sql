-- DropForeignKey
ALTER TABLE "Trip" DROP CONSTRAINT "Trip_userId_fkey";

-- DropIndex
DROP INDEX "Trip_userId_idx";

-- AlterTable
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

-- Backfill legacy owner for orphaned trips
INSERT INTO "User" ("id", "email", "name", "passwordHash", "createdAt", "updatedAt")
VALUES (
  'legacy-system-user',
  'legacy-system-user@tripzync.local',
  'Legacy System User',
  'LEGACY_MIGRATION_ONLY',
  NOW(),
  NOW()
)
ON CONFLICT ("id") DO NOTHING;

-- Backfill existing users that predate auth
UPDATE "User"
SET "passwordHash" = 'LEGACY_MIGRATION_ONLY'
WHERE "passwordHash" IS NULL;

-- Assign orphaned trips to legacy owner
UPDATE "Trip"
SET "userId" = 'legacy-system-user'
WHERE "userId" IS NULL;

-- AlterTable
ALTER TABLE "Trip" ALTER COLUMN "userId" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "passwordHash" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Trip_userId_createdAt_idx" ON "Trip"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
