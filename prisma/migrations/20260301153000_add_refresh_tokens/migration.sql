ALTER TABLE "User"
ADD COLUMN "refreshTokenHash" TEXT,
ADD COLUMN "refreshTokenExpiresAt" TIMESTAMP(3);

CREATE INDEX "User_refreshTokenExpiresAt_idx" ON "User"("refreshTokenExpiresAt");
