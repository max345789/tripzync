-- CreateIndex
CREATE INDEX "Activity_itineraryDayId_sortOrder_idx" ON "Activity"("itineraryDayId", "sortOrder");

-- CreateIndex
CREATE INDEX "ItineraryDay_tripId_idx" ON "ItineraryDay"("tripId");

-- CreateIndex
CREATE INDEX "Trip_userId_idx" ON "Trip"("userId");

-- CreateIndex
CREATE INDEX "Trip_createdAt_idx" ON "Trip"("createdAt");

-- CreateIndex
CREATE INDEX "Trip_destination_idx" ON "Trip"("destination");
