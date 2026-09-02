-- Brute-force protection for the WhatsApp login.
--
-- The OTP is 6 digits and stays valid for OTP_TTL_MINUTES, and /api/auth/otp/verify
-- had no attempt limit — so the whole 10^6 keyspace was guessable inside the window.
-- That was survivable while Google was the real login; it is the front door now.
--
-- `attempts` counts wrong guesses against a single code. The verify route refuses
-- the code once it passes the cap, so an attacker gets a handful of tries per
-- issued code instead of unlimited ones.
ALTER TABLE "Otp" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
