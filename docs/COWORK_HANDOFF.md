# PlayOrbit — Session Handoff (→ Claude Cowork)

_Generated mid-task. Everything below is committed/pushed to git, so this repo IS the source of truth. Read this top to bottom, then jump to **§7 Immediate next action**._

---

## 1. Who/what
- Repo: `waheeddar05/playorbit` (`abca-booking`) — Next.js 16 + Prisma 6 + Postgres, multi-center cricket booking platform.
- Two live environments, **separate databases**:
  - **Production** — `https://www.playorbit.in` (+ `playorbit.in`) — Vercel project **`playorbit`**, `main` branch. Prod DB = Prisma Postgres (`db.prisma.io`), currently **only center `ctr_abca`**.
  - **UAT** — `https://test.playorbit.in` — same Vercel project **`playorbit`**, **`uat` branch**, pointed at a **separate uat DB** (has the `toplay` center). The uat DB URL is the playorbit project's **branch-specific** value: `vercel env pull --environment=preview --git-branch=uat`.
- Vercel team: `team_CMm0HDZknn2YFYFiz6DNbunq` (slug `waheeddar05s-projects`). Project id `prj_xkBio8oKbWj6zYTeIpre1u4DP1tv`.
- `booking-nets` / `booking-frontend` Vercel projects are **old/unrelated** (different repo, Railway). Ignore.

## 2. Two pieces of work
- **(A) DONE — uat→main merge + prod DB reconciliation.** Already executed and live (behind maintenance). See §3–§5.
- **(B) IN PROGRESS — migrate the ABCA center from `MACHINE_PITCH` (legacy) to `RESOURCE_BASED` (like Toplay).** This is the active task. See §6–§7.

## 3. Git state (all pushed to origin)
| Branch | Commit | Meaning |
|---|---|---|
| `main` | `f8cf72b` | Merged multi-center code + prod reconciliation migration. **Live in production**, behind maintenance. |
| `merge/uat-to-main` | `c407cca` | `main` + `scripts/inspect-center.mjs` (the Toplay inspector). Work branch. |
| `backup/main-pre-uat-merge-20260530` | `805a4e6` | Pre-merge rollback point (old prod code). |

`main` == `f8cf72b`; `merge/uat-to-main` is `f8cf72b` + one tooling commit.

## 4. Production cutover status (piece A — essentially complete)
- The uat tree was merged into `main` (unrelated histories; main adopted uat's tree wholesale). Builds pass, 84 tests pass.
- **Prod DB was drifted** (half-migrated multi-center from an earlier attempt). Fixed by a single **idempotent/guarded** migration `prisma/migrations/20260531000000_prod_schema_reconciliation/migration.sql`, applied cleanly. **No data lost.** What it did:
  - backfilled NULL `centerId` → `ctr_abca` on 10 tables (Booking 267, Payment 172, Wallet 72, BlockedSlot 14, Package 10, RecurringSlotDiscount 1), then `SET NOT NULL`;
  - renamed legacy enum `MachineType` → `PackageMachineType` (retyped `Package.machineType`);
  - promoted the orphaned `MachineType_archived` table back to `MachineType` (preserved 3 rows + Machine FKs);
  - dropped unused `Package.pitchTypes` (0 rows populated); dropped stale indexes; aligned `Refund→Payment` FK.
- Build command is now `prisma generate && prisma migrate deploy && next build` (the temporary `reconcile-migrations.mjs` gate was removed; that script remains in `scripts/` for reference, unused).
- Production deploy `dpl_3yWvE7XqoQP4UmM92r7159ERFQUY` is READY and serving `www.playorbit.in`.

## 5. OUTSTANDING for piece A: go-live (needs a human with env access)
- Production is **still in maintenance mode** (`MAINTENANCE_MODE=true` env var on the `playorbit` Production env).
- **To verify:** open `https://www.playorbit.in/?mbk=<MAINTENANCE_BYPASS_KEY>` (sets a bypass cookie; key is the `MAINTENANCE_BYPASS_KEY` env var). Click through slots/bookings/packages/admin.
- **To go live:** set `MAINTENANCE_MODE=false` (or delete it) on the Production env, then **redeploy** `main` (env is read at deploy time).
- Rollback if needed: redeploy `dpl_EFNBUubw…` (commit `bcdf547`, old prod, still a Vercel rollback candidate); DB has the user's pre-merge backup.
- **Decision pending from user:** whether to lift maintenance now, OR keep it down and do piece B (ABCA resource migration) in the SAME window. User chose **"do it in this same window"** — i.e. keep maintenance on, migrate ABCA, then lift once. So go-live is intentionally deferred until piece B is done.

## 6. Piece B — ABCA → RESOURCE_BASED (the active task)
**Goal (user picked "all"):** enable the new booking categories for ABCA (Coaching, Sidearm, Full-Court, bare-Net), consolidate onto the one resource engine, and model real physical nets (no more legacy machine×pitch double-lanes).

**Key model facts (from code):**
- `Booking` already carries both worlds (legacy `machineId`/`pitchType` AND `category` + `BookingResourceAssignment`). `Center.bookingModel` is just a flag. So flipping ABCA is **data + config + backfill**, not a schema change.
- Resource engine: `MACHINE`=1 NET+1 Machine; `SIDEARM`=1 NET+1 SIDEARM_SPECIALIST; `COACHING`=1 NET+1 COACH; `FULL_COURT`=all active indoor nets; `NET`=bare net; `CORPORATE_BATCH`=virtual reservation overlay. (`src/lib/resource-booking.ts`.)
- A `Machine` links to the net it sits on via `Machine.resourceId`. Pitch type is per-machine (`Machine.supportedPitchTypes`) / per-net policy (`NET_PITCH_TYPES`), not a separate lane.
- Resource-center config lives in `CenterPolicy` rows, keys: `RESOURCE_PRICING_CONFIG`, `ENABLED_BOOKING_CATEGORIES`, `NET_PITCH_TYPES`, `MACHINE_PITCH_TYPES`, `COACHING_PITCH_TYPES`, `SIDEARM_PITCH_TYPES`, `CORPORATE_BATCH_CONFIG`.

**ABCA current state (prod DB):** `bookingModel = MACHINE_PITCH`; 4 machines (Gravity, Yantra leather; Leverage Indoor, Leverage Outdoor tennis) with `legacyMachineId` set and `supportedPitchTypes` backfilled; **0 Resource rows**; ~519 bookings (now all `centerId=ctr_abca`, `category=MACHINE`, no resource assignments).

**Migration steps (once layout + prices + staff known):**
1. Create `Resource` rows matching ABCA's real physical nets/wickets/courts.
2. Link each `Machine.resourceId` to its net; confirm `supportedPitchTypes`/`supportedBallTypes`.
3. Author `CenterPolicy` rows for ABCA: `RESOURCE_PRICING_CONFIG` (port legacy `pricing.ts` matrix + set NEW-category prices), `ENABLED_BOOKING_CATEGORIES`, `*_PITCH_TYPES`, `CORPORATE_BATCH_CONFIG`.
4. Add `CenterMembership` rows for ABCA coaches (COACH) and sidearm specialists (SIDEARM_SPECIALIST).
5. **Backfill `BookingResourceAssignment` for all FUTURE-dated existing bookings** → map `(machineId, pitchType)`→net. **Mandatory**: the resource availability engine only counts bookings with resource assignments / `assignedMachineId`; legacy bookings have neither → double-booking risk if skipped (`resource-booking.ts:419-445`).
6. Migrate operator assignments (legacy `MachineId` enum → `machineRowId`) and any active `UserPackage`s.
7. Flip `Center.bookingModel = RESOURCE_BASED`. Verify via bypass. Lift maintenance.

**Risks:** pricing parity (legacy pricing is rich: per machine/pitch/slab, consecutive discount, Yantra premium — must replicate exactly); capacity changes (legacy allowed machine×pitch parallel lanes the physical model won't); the future-booking backfill.

## 7. IMMEDIATE NEXT ACTION (what to do first in Cowork)
Cowork has the DB/credential access this web sandbox lacked. Do this:

1. **Inspect Toplay (the template) on the uat DB** — read-only, already in the repo:
   ```bash
   git fetch origin merge/uat-to-main && git checkout merge/uat-to-main
   npm ci && npx prisma generate
   vercel link        # choose the "playorbit" project
   vercel env pull .env.uat --environment=preview --git-branch=uat
   DATABASE_URL="$(grep '^DATABASE_URL=' .env.uat | cut -d= -f2- | tr -d '\"')" \
     node scripts/inspect-center.mjs toplay
   ```
   This prints Toplay's Resources, Machines+net links, memberships by role, and all CenterPolicy rows — the exact shape to replicate for ABCA.

2. **Gather ABCA specifics from the user** (can't be inferred): physical nets (count, indoor/outdoor, surface per net), which machine sits on which net, what "full court" comprises, prices for the new categories (Coaching/Sidearm/Full-Court/bare-Net), and the coach/sidearm-staff people.

3. **Then build the migration** per §6, ideally as a script that: seeds Resources, links machines, writes CenterPolicy, adds memberships, backfills future bookings, and flips `bookingModel` — all in one reviewable transaction, runnable against the **prod** DB (ABCA lives in prod). Keep it idempotent. Production is still in maintenance, so there's a safe window.

## 8. Gotchas learned
- **Preview builds in the `playorbit` project hit the PROD DB** (not uat). Only the `uat` branch uses the uat DB (branch-specific env). Don't assume a preview = uat.
- This web sandbox: no outbound egress to the DBs, no `gh`/Vercel-env tools; DB writes only happen through the Vercel build pipeline. Cowork/local won't have this limitation.
- Admin **Users list is center-scoped** (a user shows if they have a membership OR a booking at the current center). ABCA shows ~140 of 266 by default; the super-admin "All centers" toggle shows all 266. This is expected (uat behavior), not a bug. User chose to keep it and use the toggle.
- Don't push to `main` casually — it auto-deploys production. Use `merge/uat-to-main` for previews (but remember: previews hit the prod DB and run `migrate deploy`).
