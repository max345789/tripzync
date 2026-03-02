ALTER TABLE "Trip"
ADD COLUMN "startCity" TEXT,
ADD COLUMN "startLatitude" DOUBLE PRECISION,
ADD COLUMN "startLongitude" DOUBLE PRECISION;

UPDATE "Trip"
SET "startCity" = "destination"
WHERE "startCity" IS NULL OR trim("startCity") = '';

ALTER TABLE "Trip"
ALTER COLUMN "startCity" SET NOT NULL;

ALTER TABLE "Activity"
ADD COLUMN "durationMinutes" INTEGER,
ADD COLUMN "travelToNextMinutes" INTEGER,
ADD COLUMN "travelToNextKm" DOUBLE PRECISION,
ADD COLUMN "travelMode" TEXT;

UPDATE "Activity"
SET "durationMinutes" = 90
WHERE "durationMinutes" IS NULL;

ALTER TABLE "Activity"
ALTER COLUMN "durationMinutes" SET NOT NULL;

ALTER TABLE "User"
ADD COLUMN "socialProvider" TEXT,
ADD COLUMN "socialSubject" TEXT;

CREATE INDEX "Trip_startCity_idx" ON "Trip"("startCity");
CREATE UNIQUE INDEX "User_socialProvider_socialSubject_key" ON "User"("socialProvider", "socialSubject");
