-- Add NET booking category — bare-net booking with no machine, coach, or
-- staff. Lets users reserve a single net for self-directed practice.
-- Pitch type is picked from the per-center NET_PITCH_TYPES policy.
ALTER TYPE "BookingCategory" ADD VALUE IF NOT EXISTS 'NET';
