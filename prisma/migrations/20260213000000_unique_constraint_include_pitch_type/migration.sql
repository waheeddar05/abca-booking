-- DropIndex (old unique constraint)
DROP INDEX IF EXISTS "Booking_date_startTime_ballType_key";

-- CreateIndex (new unique constraint including pitchType)
CREATE UNIQUE INDEX "Booking_date_startTime_ballType_pitchType_key" ON "Booking"("date", "startTime", "ballType", "pitchType");
