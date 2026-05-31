# PlayOrbit — Session Handoff (→ Claude Cowork)

_Updated after Cowork session on 2026-05-31. Read top to bottom, then jump to **§7 Immediate next action**._

---

## 1. Who/what
- Repo: `waheeddar05/playorbit` (`abca-booking`) — Next.js 16 + Prisma 6 + Postgres, multi-center cricket booking platform.
- Two live environments, **separate databases**:
  - **Production** — `https://www.playorbit.in` (+ `playorbit.in`) — Vercel project **`playorbit`**, `main` branch. Prod DB = Prisma Postgres (`db.prisma.io`).
  - **UAT** — `https://test.playorbit.in` — Vercel project **`playorbit`**, `uat` branch, separate Neon DB.
- Vercel team: `team_CMm0HDZknn2YFYFiz6DNbunq` (slug `waheeddar05s-projects`). Project id `prj_xkBio8oKbWj6zYTeIpre1u4DP1tv`.
- Vercel CLI is installed at `/opt/homebrew/bin/vercel` and already linked to the `playorbit` project (`.vercel/` dir exists in repo root).

## 2. DB access from local
- **Prod DB** (Prisma Postgres, `db.prisma.io`) — port 5432 is reachable from the Mac directly. Fresh credentials via:
  ```bash
  cd /Users/waheeddar/IdeaProjects/playorbit
  vercel env pull .env.prod-fresh --environment=production --yes
  # then use DATABASE_URL from .env.prod-fresh
  ```
- **UAT DB** (Neon, `ep-bitter-fire-a1bdvv1o.ap-southeast-1.aws.neon.tech`) — direct endpoint (non-pooler) is reachable from Mac. Credentials in `.env.uat`. Note: the pooler endpoint (`-pooler`) does NOT work from local.
- **Prisma Accelerate URL** (`prisma+postgres://accelerate.prisma-data.net/...`) — the API key in `.env.prod-fresh` as `PRISMA_DATABASE_URL` is sometimes rate-limited/rotated. Prefer the direct `DATABASE_URL` (`postgres://...@db.prisma.io:5432/...`).
- **Important**: The Prisma client in the repo is generated against the current `uat` branch schema which is slightly ahead of the UAT DB (e.g. `Resource.description`, `Center.contactPhones` don't exist yet in UAT DB). Use `$queryRawUnsafe` to bypass schema validation, or work against the prod DB which matches the `main` branch schema.
- **Desktop Commander MCP** (`mcp__Desktop_Commander__start_process`) is the right tool for DB scripts — it runs on the user's Mac which has network access. The Cowork Linux sandbox has no outbound DB egress.

## 3. Git state
| Branch | Notes |
|---|---|
| `main` | Live in production. Has the full multi-center + reconciliation migration. Do NOT push casually — it auto-deploys prod. |
| `uat` | UAT environment. Current working branch in the repo checkout. |
| `merge/uat-to-main` | Work branch from previous session; has `scripts/inspect-center.mjs` (older version). |

The local checkout at `/Users/waheeddar/IdeaProjects/playorbit` is on the `uat` branch.

## 4. What is DONE (both pieces A and B)

### Piece A — uat→main merge + prod DB reconciliation ✅
- Fully merged and live in production behind maintenance mode.
- Build command: `prisma generate && prisma migrate deploy && next build`.
- Production deploy `dpl_3yWvE7XqoQP4UmM92r7159ERFQUY` is READY.

### Piece B — ABCA migrated to RESOURCE_BASED ✅ (completed this session)
The following was applied to the **prod DB** on 2026-05-31:

1. **6 Resource rows created** for `ctr_abca`:
   - `res_abca_indoor_1` … `res_abca_indoor_4` — `NET / INDOOR`
   - `res_abca_outdoor_1`, `res_abca_outdoor_2` — `NET / OUTDOOR`

2. **4 Machine → Net links set** (`Machine.resourceId`):
   - `mch_abca_gravity` → `res_abca_indoor_1`
   - `mch_abca_yantra` → `res_abca_indoor_2`
   - `mch_abca_leverage_indoor` → `res_abca_indoor_3`
   - `mch_abca_leverage_outdoor` → `res_abca_outdoor_1`
   - Indoor Net 4 (`res_abca_indoor_4`) and Outdoor Net 2 (`res_abca_outdoor_2`) are spare (no machine).
   - Gravity's `supportedBallTypes` updated to `[MACHINE, LEATHER]`.

3. **3 CenterPolicy rows written** for `ctr_abca`:
   - `ENABLED_BOOKING_CATEGORIES`: `["MACHINE"]` (MACHINE only for now; Coaching/Sidearm/Net/Full-Court deferred)
   - `TIME_SLAB_CONFIG`: inherited from global Policy (06:30–18:00 morning / 18:00–22:30 evening)
   - `RESOURCE_PRICING_CONFIG`: full `machineRowPricing` matrix per machine/pitch/ball type, ported from `DEFAULT_PRICING_CONFIG` in `src/lib/pricing.ts`

4. **5 future bookings backfilled**:
   - `Booking.assignedMachineId` set to the machine row ID
   - `BookingResourceAssignment` rows inserted (booking → net)

5. **`Center.bookingModel` flipped to `RESOURCE_BASED`** for `ctr_abca`.

The migration script is at `scripts/migrate-abca-to-resource-based.mjs` — idempotent, supports `--dry-run` and `--check` flags.

## 5. OUTSTANDING — go-live (the only remaining step)

Production is **still in maintenance mode** (`MAINTENANCE_MODE=true` env var on the Production environment).

**To verify before lifting:**
1. Open `https://www.playorbit.in/?mbk=<MAINTENANCE_BYPASS_KEY>` (key = `MAINTENANCE_BYPASS_KEY` env var). This sets a bypass cookie.
2. Check: slots page loads and shows bookable slots, existing bookings display correctly, the 5 future bookings still appear and aren't double-booked.
3. Admin panel: confirm ABCA shows `RESOURCE_BASED` model.

**To go live:**
```bash
# In Vercel dashboard OR via CLI:
vercel env rm MAINTENANCE_MODE production
# OR set it to "false"
# Then redeploy main:
vercel deploy --prod
```

**Rollback if needed:** redeploy the previous production deployment from Vercel dashboard (it's still available as a rollback candidate). The migration script is idempotent — re-running it after a rollback does nothing harmful.

## 6. What was deliberately deferred

- **Coaching / Sidearm / Full-Court / bare-Net categories** — user chose MACHINE-only for now. To enable later:
  1. Add coach/sidearm-staff users as `CenterMembership` rows (role `COACH` / `SIDEARM_SPECIALIST`) for `ctr_abca`.
  2. Update `ENABLED_BOOKING_CATEGORIES` CenterPolicy to add the new categories.
  3. Extend `RESOURCE_PRICING_CONFIG` with `sidearmPricing`, `netPricing`, `categoryRates` for the new categories.
  4. No schema change needed — the engine already supports all categories.

- **Operator assignment migration** — legacy `OperatorAssignment` rows use the `MachineId` enum. If operators are assigned per-machine, those rows may need `machineRowId` set. Not urgent while only MACHINE category is live.

- **Package machine types** — `UserPackage` / `Package` use the legacy `PackageMachineType` enum. No change needed for now since packages still work against the legacy MACHINE category path.

## 7. IMMEDIATE NEXT ACTION

**Verify and lift maintenance:**

1. Get the `MAINTENANCE_BYPASS_KEY` value from Vercel (dashboard → playorbit project → Production env vars, or `vercel env pull`).
2. Open `https://www.playorbit.in/?mbk=<KEY>` and manually test:
   - Slots page (ABCA) — can you see and book a slot?
   - My Bookings — do the 5 future bookings appear?
   - Admin → Bookings — correct machine names shown?
3. If all good: set `MAINTENANCE_MODE=false` in Vercel Production env and trigger a redeploy of `main`.

## 8. Gotchas / lessons learned this session

- The Prisma Accelerate URL (`prisma+postgres://accelerate.prisma-data.net/...`) can fail with `P6002 API Key invalid` — fall back to the direct `postgres://...@db.prisma.io:5432/...` URL which works fine from the Mac.
- The UAT DB Neon pooler endpoint (`-pooler`) is unreachable from local; use the direct endpoint.
- The local Prisma client is generated from the `uat` branch schema which has columns (`contactPhones`, `Resource.description`) not yet in the UAT DB. Use `$queryRawUnsafe` for UAT DB queries, or check `information_schema.columns` first.
- PostgreSQL enum columns need explicit casting in raw SQL: `$1::"ResourceType"`, `$1::"ResourceCategory"`, `$1::"BallType"[]`.
- `BookingStatus` enum only has `BOOKED`, `CANCELLED`, `DONE` — no `REFUNDED`.
- Desktop Commander's `start_process` is the right tool for running Node/DB scripts that need Mac network access. The Cowork Linux sandbox blocks outbound TCP to external DBs.
- The UAT center slug is `top-play` (not `toplay`).
