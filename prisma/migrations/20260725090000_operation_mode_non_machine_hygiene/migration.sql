-- Data-only cleanup: `operationMode` is a MACHINE-booking concept.
--
-- `Booking.operationMode` defaults to WITH_OPERATOR, and the resource
-- booking engine only ever set it inside the `category = 'MACHINE'`
-- branch. Every net / sidearm / coaching / full-court / match-practice
-- row therefore persisted as WITH_OPERATOR with `operatorId = NULL` —
-- the exact shape the admin dashboard counts as "bookings with an
-- unassigned operator", which inflated that number with rows that never
-- had an operator to begin with.
--
-- The engine now writes SELF_OPERATE for those categories; this
-- back-fills the rows created before that change. MACHINE rows are left
-- untouched: their WITH_OPERATOR/SELF_OPERATE value is meaningful and
-- an unassigned MACHINE booking is a real thing to go fix.
UPDATE "Booking"
SET "operationMode" = 'SELF_OPERATE'
WHERE "category" <> 'MACHINE'
  AND "operationMode" = 'WITH_OPERATOR';
