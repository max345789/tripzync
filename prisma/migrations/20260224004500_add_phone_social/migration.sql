-- Add phone column nullable unique
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_key" ON "User"("phone") WHERE "phone" IS NOT NULL;
