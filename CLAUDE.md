# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PlayOrbit (`abca-booking`) is a cricket practice booking platform built with Next.js 16 (App Router). Users book sessions on bowling machines (Gravity, Yantra, Leverage Indoor/Outdoor) across pitch types (Astro, Cement, Natural), with online payment via Razorpay or cash. Roles: USER, ADMIN, MODERATOR, OPERATOR, COACH, SIDEARM_STAFF. Deployed on Vercel as a PWA with Android TWA support.

**MODERATOR** is a restricted admin (both a `UserRole` and a `MembershipRole`). A moderator runs the day-to-day floor — Dashboard, Bookings, Slots, Packages, Ledger — and nothing else. Blocked outright: **Users, Settings, My Center, Operators, Sidearm, Personal Coach, Ground Staff, Offers**. They also cannot cancel/refund bookings or reassign booking staff, and cannot mutate packages (create/edit/activate, user-package changes, or assign). Staff management is full-admin only: `requireCenterStaffManagerForCenter` (`src/lib/adminAuth.ts`) is now just an alias of `requireCenterAdminForCenter`, and the Offers / Operators / recurring-discount routes reject on the `isModerator` flag. Enforced in the middleware (`/admin` path blocklist), the API guards, and the admin UI (`layout.tsx` + `AdminMobileNav`). Detect it via `isCenterModerator(user, centerId)` (`src/lib/auth.ts`) on the backend or the `isModerator` flag from `requireCenterAdmin`; on the client use `useAdminRole()` (`src/lib/useAdminRole.ts`).

The self-service exception stands: a user whose own `UserRole` is `SIDEARM_SPECIALIST` or `COACH` still reaches `/admin/sidearm` / `/admin/coach` to manage their own availability.

**Multi-center**: The system is being evolved from single-center to multi-center. Most domain data is center-scoped via a `centerId` FK. ABCA's seeded center ID is `ctr_abca`; new centers (e.g. Toplay) are added via the super admin UI. Machines, payment config (per-center Razorpay), admins/operators, pricing, and policies are configurable per center. See "Multi-Center Architecture" section below.

## Commands

```bash
# Development
npm run dev                # Start dev server (TZ=Asia/Kolkata)
npm run build              # Production build
npm run build:local        # Build with migration resolve + deploy
npm start                  # Start production server

# Database
npx prisma generate        # Regenerate Prisma client (also runs on postinstall)
npx prisma migrate deploy  # Apply pending migrations
npx prisma studio          # Visual DB browser
npm run db:check           # Verify migration state
npm run db:migrate         # Deploy migrations with IST timezone

# Testing
npm test                   # Run tests once (vitest run)
npm run test:watch         # Watch mode (vitest)
npm run test:coverage      # Coverage report (v8 provider)
# Run a single test file:
npx vitest run src/lib/__tests__/pricing.test.ts

# Linting
npm run lint               # ESLint (flat config, eslint.config.mjs)

# Scripts
npx tsx scripts/make-admin.ts <email|mobile> [--super] [--center <slug>]
                           # Grant ADMIN / super admin / center-admin membership
npx tsx scripts/check-migrations.ts            # Verify DB tables
npx tsx scripts/seed-centers.ts                # Verify/seed centers, ABCA machines, super admin
npx tsx scripts/seed-centers.ts --check        # Verify only, no writes
```

## Architecture

### Tech Stack
- **Next.js 16.1.4** (App Router, React 19, Turbopack)
- **Prisma 6** + PostgreSQL (Supabase/Vercel Postgres)
- **NextAuth 4** (mounted for legacy sessions only, no provider registered) + custom JWT — login is WhatsApp OTP
- **Razorpay** for payments, **Zod** for validation
- **Tailwind CSS v4**, **Lucide React** icons
- **Vitest** + React Testing Library + jsdom

### Auth — WhatsApp OTP only

**Login is WhatsApp OTP. There is no other way in.** Two steps, both public because they *are* the front door:

1. `POST /api/auth/otp/request` — validates the number, finds-or-creates the account keyed on `mobileNumber`, issues a 6-digit code and sends it.
2. `POST /api/auth/otp/verify` — checks the code, flips `mobileVerified`, and sets the `token` cookie (custom JWT, `src/lib/jwt.ts`). Receiving the code **is** proof of the number, so a WhatsApp login is verified by construction and never meets the `/verify-mobile` gate.

`signToken`/`verifyToken` in `src/lib/jwt.ts` are **async** and built on `jose`, not `jsonwebtoken` — see the Edge Runtime note under Middleware for why that is not interchangeable. The token format is unchanged (HS256 over `JWT_SECRET`).

`POST /api/auth/logout` clears that cookie. It has to be server-side: the cookie is `httpOnly`, so the `document.cookie = 'token=…'` that the navbar and staff layout used to run never removed anything and left users signed in through a "Sign out" they'd already been shown.

**Delivery** lives in `src/lib/otp-delivery.ts` (`issueAndSendOtp`), shared with `/api/auth/whatsapp/send-otp`: an approved WhatsApp auth template first, then the `playorbit_account_pin` utility template, then SMS as a backstop — a BSP outage must not lock everyone out of the only login. A send that reached nobody deletes its own OTP row so an outage can't burn the user's budget.

**Three limits guard the front door**, and all of them matter because `/api/auth/otp/request` is public, creates accounts, and spends money per call:
- **3 codes / 10 min per account** — the ordinary abuse case.
- **`OTP_GLOBAL_PER_MINUTE` (default 30) platform-wide** — the per-account limit is keyed on the account, so an attacker cycling fresh numbers never trips it while every call bills a WhatsApp template or an SMS. This is the spend circuit breaker.
- **`OTP_MAX_ATTEMPTS` (default 5) wrong guesses per code**, counted on `Otp.attempts`; the code is burned on the last allowed miss. A 6-digit code with no attempt cap is fully guessable inside its TTL.

**Google is off.** `authOptions` registers no provider unless `GOOGLE_LOGIN_ENABLED=true`, so no new Google session can be created (including via `/api/auth/signin/google`). NextAuth stays mounted so sessions issued before the cutover keep working until they expire instead of logging everyone out mid-booking, and `getAuthenticatedUser` still reads them.

> **Migration risk, know this before touching it:** a Google account is keyed on **email**, a WhatsApp login on **mobileNumber**. An account created by Google that never linked a number is unreachable by phone — its owner signing in with WhatsApp lands on a *fresh* account, leaving bookings, wallet, packages and center memberships on the orphaned row. Admins can't set another user's `mobileNumber` (`PATCH /api/admin/users` doesn't accept it), so the only recovery is `GOOGLE_LOGIN_ENABLED=true` → sign in → link the number on `/verify-mobile`.

**Client-side session: use `useCurrentUser()`, never `useSession()`.** `src/lib/current-user.tsx` reads `GET /api/user/profile`, which goes through `getAuthenticatedUser` and therefore sees both mechanisms. `useSession()` only ever sees NextAuth, so every gate written against it reports "signed out" for a WhatsApp user — i.e. for everyone. That was not hypothetical: it collapsed the admin sidebar to zero links, hid the super-admin pages from super admins, locked `/admin/maintenance` and `/admin/db-cleanup` behind an email match that a phone-only account doesn't have, and silently charged free users and super admins on the slots page. `useAdminRole()` reads it too. `useSession()` is now legitimate in exactly two places — `MobileNumberCheck` and `/verify-mobile`, both NextAuth-specific — plus deciding *which* sign-out to run.

`getAuthenticatedUser(req)` in `src/lib/auth.ts` is the universal auth helper for API routes — checks NextAuth first, falls back to OTP token, returns `{ id, name, role, email, isSuperAdmin, isFreeUser, isSpecialUser, mobileVerified, centerIds, centerMemberships }` or `null`. `centerMemberships` is the list of `{ centerId, role }` rows for the user; use it (or the helpers `canAccessCenter`, `hasMembershipRole`, `adminCenterIds`) to enforce per-center access in API routes.

### Middleware (`src/middleware.ts`)
- Protects all routes except explicit public paths (/, /login, /otp, /api/auth, static assets). `/login` is a bare redirect to `/`; the login form is the modal on the landing page (`src/components/LoginModal.tsx`).
- Redirects logged-in users from /login, /otp to /slots (or /operator for OPERATOR role)
- The `/verify-mobile` gate keys off the **NextAuth** token only, so it catches legacy Google sessions with no linked number and never a WhatsApp login.
- Enforces role-based access: `/admin/*` requires ADMIN, `/operator/*` requires OPERATOR or ADMIN
- Checks maintenance mode via internal API call; super admin and allowlisted emails bypass

> **Middleware runs in the Edge Runtime — no Node built-ins.** Everything it imports, transitively, must work on Web Crypto and `fetch` alone. Turbopack does **not** fail the build on a Node-only import: it swaps the module for a stub that throws only when touched, so the breakage ships and then fires per-request in production.
>
> That is precisely the 2026-09-02 login outage. `@/lib/jwt` used `jsonwebtoken` (→ `jws` → `crypto.createHmac`), so `verifyToken` threw on the edge and its `catch` returned `null`: middleware read every WhatsApp session as *signed out* and bounced it from `/slots` to `/`, while `src/app/page.tsx` — Node runtime, same helper, same cookie — read it fine and redirected back to `/slots`. An infinite redirect loop; nobody could log in. Unit tests run in Node, where the import works, so none of them caught it.
>
> `src/lib/jwt.ts` is `jose` (Web Crypto) and both `signToken` and `verifyToken` are **async**. `src/__tests__/middleware-edge-safety.test.ts` walks middleware's import graph and fails on any package not on its edge-safe list — extend that list only after confirming the package really runs on the edge.
>
> The same failure shape has a second source: two readers of one cookie disagreeing about the *secret*. `src/lib/auth-secret.ts` is the single place `NEXTAUTH_SECRET` is read; use it rather than reaching for `process.env` again.

### Pricing Engine (`src/lib/pricing.ts`)
Dynamic pricing based on machine ID, pitch type, ball type, and time slab (morning/evening). Consecutive slot bookings get a discounted rate. Config stored in Policy table as `PRICING_CONFIG` JSON, with `DEFAULT_PRICING_CONFIG` as fallback. Yantra has premium pricing tiers. Key functions: `getSlotPrice()`, `getConsecutivePrice()`, `calculateNewPricing()`.

### Machine & Pitch Config (`src/lib/constants.ts`)
Four machines defined in `MACHINES` record: GRAVITY, YANTRA (leather), LEVERAGE_INDOOR, LEVERAGE_OUTDOOR (tennis). Each has ball type, category, and compatible pitch types. Machine-pitch compatibility can be overridden via `MACHINE_PITCH_CONFIG` policy key.

### Database Schema (`prisma/schema.prisma`)
Key models: Center, CenterMembership, Resource, MachineType, Machine, CenterPolicy, User, Booking, Slot, Package, UserPackage, PackageBooking, Payment, BlockedSlot, OperatorAssignment, CashPaymentUser, Policy, Notification, Otp. Booking uniqueness: `[centerId, date, startTime, machineId, pitchType]` (center-scoped). Payment tracks Razorpay order/payment/signature/refund lifecycle.

### Policy System (with center override)
Two tables:
- `Policy` — global defaults (key-value), unchanged from before.
- `CenterPolicy` — per-center overrides, unique on `(centerId, key)`.

Resolution: center → global → code default. Use `getPolicyValue(key, centerId, fallback?)` / `getPolicyJson(...)` / `isPolicyEnabled(...)` from `src/lib/policy.ts`. Existing global feature flags (`PAYMENT_GATEWAY_ENABLED`, `SLOT_PAYMENT_REQUIRED`, `PRICING_CONFIG`, `TIME_SLAB_CONFIG`, `MACHINE_PITCH_CONFIG`, etc.) keep working unchanged; per-center overrides can be added without code changes by inserting `CenterPolicy` rows.

`policy-cache.ts` (`getCachedPolicy`) is the legacy global-only helper. Prefer the new `policy.ts` resolver in any new code.

### Booking notice (`BOOKING_NOTICE`)

A must-read facility rule rendered **in red** wherever the user meets a booking confirmation: the `ConfirmDialog`'s `notice` prop (louder than the existing amber `warning` prop — `warning` is advice about the booking, `notice` is a rule the player has to act on) on both `ResourceSlotsPage` and `MatchPracticePanel`, plus a banner at the top of `/bookings`, since the booking flow redirects there and the dialog is gone by the time the confirmed booking is read.

Text resolves center → global → `DEFAULT_BOOKING_NOTICE` (`src/lib/client-constants.ts`, defaults to the TopPlay outside-shoes rule) and reaches the client via `bookingNotice` on `/api/payments/config`. **A stored empty string means "no notice"** and is a real value — only an unset policy falls back to the default, so a center without a shoe rule turns it off by saving blank. Edited on Admin → Configuration → **Booking Notice** (with a live red preview), saved by that page's single Save button.

Not carried on WhatsApp: `booking_detail` is a Meta-approved fixed-param template, so adding a line would need re-approval.

### API Route Pattern
All API routes are in `src/app/api/`. Standard pattern for protected, center-scoped routes:
```typescript
import { getAuthenticatedUser, canAccessCenter, hasMembershipRole } from '@/lib/auth';
import { resolveCurrentCenter } from '@/lib/centers';

const user = await getAuthenticatedUser(req);
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

const center = await resolveCurrentCenter(req, user);
if (!center) return NextResponse.json({ error: 'No center' }, { status: 400 });

// Always scope DB queries by centerId, e.g. prisma.booking.findMany({ where: { centerId: center.id, ... } })
// For admin-only routes:
if (!hasMembershipRole(user, center.id, 'ADMIN')) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

### Directory Layout
- `src/app/api/` — API routes (auth, bookings, slots, packages, payments, admin/*, operator/*)
- `src/app/admin/` — Admin dashboard pages
- `src/app/operator/` — Operator dashboard
- `src/app/slots/`, `src/app/bookings/`, `src/app/packages/` — User-facing pages
- `src/components/` — React components (Navbar, BookingForm, slots/, ui/)
- `src/hooks/` — Custom hooks (useSlots, usePackages, usePricing)
- `src/lib/` — Core business logic (auth, pricing, prisma, razorpay, constants, schemas, sms, time, jwt, api-client)
- `src/lib/__tests__/` — Unit tests
- `prisma/` — Schema and migrations
- `scripts/` — Admin utilities
- `public/` — PWA assets (sw.js, manifest.json, icons/)

## Timezone Handling

All times are IST (Asia/Kolkata). The `TZ` env var is set in npm scripts and in `src/lib/prisma.ts` (`process.env.TZ = 'Asia/Kolkata'`). PostgreSQL timezone is configured via connection string options parameter. Time slab determination uses `toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })`.

## Testing

Tests use Vitest with jsdom environment. Path alias `@` maps to `./src`. Setup file at `src/__tests__/setup.ts`. Test files match `src/**/*.{test,spec}.{ts,tsx}`. Coverage targets `src/lib/**` and `src/components/**`.

## Key Environment Variables

`DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `JWT_SECRET`, `FAST2SMS_API_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `INITIAL_ADMIN_EMAIL`, `SUPER_ADMIN_EMAIL`. See `.env.example` for full list.

`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` are now treated as the **fallback** for any center that hasn't configured its own keys. Each `Center` row may store `razorpayKeyId` / `razorpayKeySecret` / `razorpayWebhookSecret`; the payment helper picks center-specific keys when present (phase 6 — pending).

## Multi-Center Architecture

### Concepts
- **Center** (`prisma.center`): an independent operational unit. ABCA seeded as `ctr_abca` (slug `abca`). New centers added via super admin UI. Each has its own location, contacts, Razorpay keys, machines, admins, pricing, and policies.
- **CenterMembership** (`prisma.centerMembership`): links a User to a Center with a role (`ADMIN`, `OPERATOR`, `COACH`, `SIDEARM_STAFF`). Multiple memberships per user supported.
- **Resource** (`prisma.resource`): a physical bookable unit at a center — `NET`, `TURF_WICKET`, `CEMENT_WICKET`, `COURT`. Used by the resource-based booking model (Toplay).
- **MachineType** (`prisma.machineType`): catalog of machine designs (Yantra/Leverage/Gravity/…). Adding a new model is data-only.
- **Machine** (`prisma.machine`): a specific machine instance at a center. ABCA's four legacy machines are seeded with `legacyMachineId` set, bridging the existing `MachineId` enum to the new table.
- **Booking model** (`Center.bookingModel`): `MACHINE_PITCH` (ABCA — legacy enum-based) or `RESOURCE_BASED` (Toplay — consumes Resources). New centers default to `MACHINE_PITCH`; switch to `RESOURCE_BASED` in the center config when needed.

### Center resolution (current center for a request)
Order (first match wins): `?center=<slug>` query → `selectedCenterId` cookie → user's first membership → first active center. Implemented in `src/lib/centers.ts → resolveCurrentCenter()`. **No subdomain, no path prefix** — keeps URLs stable for TWA/PWA installs and existing bookmarks.

### Super admin
The `User.isSuperAdmin` boolean column is the source of truth. Super admins bypass center scoping (`canAccessCenter` returns true for any centerId).

**Granting it is three separate things**, and you usually need more than one:

| Grant | Unlocks |
|---|---|
| `User.role = 'ADMIN'` | past the middleware into `/admin` |
| `User.isSuperAdmin = true` | cross-center pages (Centers, Orphan Payments, Maintenance, DB Cleanup) and a bypass of every center scope check |
| `CenterMembership(role='ADMIN')` | center-scoped **writes** — without it you can open Configuration but `POST /api/admin/policies` 403s on Save |

`npx tsx scripts/make-admin.ts <email|mobile> [--super] [--center <slug>]` does all three. **No admin UI writes `isSuperAdmin`** — `PATCH /api/admin/users` accepts `role` but not that column, by design.

> **The env fallback does not work for a WhatsApp account.** `SUPER_ADMIN_EMAIL` is matched against `dbUser.email` in `auth.ts`, and `scripts/seed-centers.ts` looks the user up by email too — but login is WhatsApp OTP, so accounts are keyed on `mobileNumber` and typically have **no email at all**. Both paths silently no-op for a phone-only account. Bootstrap by mobile with `make-admin.ts` instead; the account must exist first, so sign in once before running it.

`requireSuperAdmin(req)` from `src/lib/adminAuth.ts` is the API-route guard for cross-center operations (managing centers, the machine-type catalog, etc.). Use `requireAdmin(req)` for center-scoped admin actions and combine with `hasMembershipRole(user, centerId, 'ADMIN')` to enforce the user is admin at *this* center.

### Center management UI (`/admin/centers/*`)
- `/admin/centers` — list, create new center
- `/admin/centers/[id]` — edit, with tabs: General · Payment · Machines · Resources · Members · Policies
- Tab components live under `src/components/admin/centers/` so the page file stays focused on routing
- Only visible to super admins (link in admin sidebar gated on `session.user.isSuperAdmin`)
- API routes: `/api/admin/centers`, `/api/admin/centers/[id]`, `/api/admin/centers/[id]/{machines,resources,members,policies}`, `/api/admin/machine-types`

### Center switcher (admin sidebar)
`src/components/admin/CenterSwitcher.tsx` shows the active center and lets admins/super-admins switch via `POST /api/centers/select`, which sets the `selectedCenterId` cookie and reloads. Hidden when the user has only one center option.

### User-side center experience (phase 4)
- `CenterProvider` in `src/lib/center-context.tsx` is mounted via `Providers.tsx`. Any user-app component can call `useCenter()` to read `{ centers, currentCenter, switchTo, refresh }`.
- `src/components/CenterSelector.tsx` — compact pill in the user `Navbar` (auto-hides for single-center installs). Lets users switch centers and links to `/centers`.
- `src/app/centers/page.tsx` — public listing of all active centers. Shows address/phone/email; "Use my location" button computes Haversine distance and sorts ascending. Tapping a center calls `switchTo(id)`, which sets the cookie and reloads to the URL passed in `?next=` (defaults to `/slots`).
- `ContactFooter` reads from the current center's `contactPhone`, `contactEmail`, `mapUrl`. Falls back to the platform-wide `CONTACT_NUMBERS`/`LOCATION_URL` constants when those fields are blank.
- `LandingPageClient` renders a "N locations available" pill that links to `/centers` only when multiple centers exist.
- `/centers` and `/api/centers/*` are publicly accessible (added to middleware allowlist).

### When adding new code
- Every API route that reads/writes center-scoped data must scope by `centerId`. Use `resolveCurrentCenter(req, user)` and check `canAccessCenter(user, center.id)`.
- New domain tables: add `centerId` + FK to `Center` + `(centerId, ...)` composite index/unique. Backfill in the same migration.
- New config keys: read via `getPolicyValue(key, centerId, fallback)` to inherit center→global→default.
- Razorpay calls: use the center's keys (phase 6 — `getRazorpayInstance(center)` will replace the env-based singleton).

### `?allCenters=true` convention
Admin/operator GET routes that return aggregate or list data accept an optional `allCenters=true` query param. When set, the route ignores the current center and returns data across every center — gated to super admins only. The default (no param) always scopes to the resolved current center. Use this for the platform-wide super-admin dashboard; never for plain admin views.

**Exception — `/api/admin/users`:** the admin Users listing lets *any* admin pass `allCenters=true` (the `All users` / `This center` toggle on `/admin/users`). User lookup is intentionally cross-center so a center admin can find someone who hasn't booked at their center yet. This only widens *read* visibility — mutating actions on that route stay individually gated (delete and free-user toggles remain super-admin only).

### Resource-based booking engine (phase 5)

Centers with `bookingModel = RESOURCE_BASED` (e.g. Toplay) use a different booking primitive than ABCA. Instead of `(machineId, pitchType)` lanes, every booking consumes one or more `Resource` rows (nets/courts/turf wickets) plus optionally a `Machine`, a coach (User with COACH membership), or a sidearm-staff member (SIDEARM_STAFF membership).

**Booking categories** (`Booking.category`, `BookingCategory` enum):
- `MACHINE` — bowling machine session: 1 net + 1 Machine instance.
- `SIDEARM` — sidearm-staff session: 1 net + 1 SIDEARM_STAFF user.
- `COACHING` — personal coaching: 1 net + 1 COACH user.
- `FULL_COURT` — full indoor court: every active indoor net.
- `CORPORATE_BATCH` — seat-based Match Practice enrollment (see "Match Practice" below).
- `MATCH_SIMULATION` — seat-based Match Practice group session (see below).

ABCA's existing rows default to `MACHINE` and have no `BookingResourceAssignment` rows; nothing changes for them.

**Category labels** live in one place — `src/lib/booking-categories.ts` (`BOOKING_CATEGORY_LABELS` / `bookingCategoryLabel`), which every admin surface that names a category reads: the bookings CSV, the packages CSV (via `packageCategoryLabel`), and the Assign Package picker. The label is **always the base category**: a Corporate Batch or Match Simulation row exports as `Corporate Batch` / `Match Simulation` with no `(Monthly)` / `(Regular)` purchase-mode suffix, so a sheet can be grouped or pivoted on the column directly. The mode/period still lives on `Booking.corporateBatchMode` / `enrollmentPeriod` and is rendered as its own "Enrollment" row on the booking card — it just never rides along inside the category string. `expandBookableCategories()` turns a center's `ENABLED_BOOKING_CATEGORIES` list into real enum values, expanding the `MATCH_PRACTICE` umbrella into `CORPORATE_BATCH` + `MATCH_SIMULATION`; the admin Bookings category filter and Packages → Assign both drive their dropdowns from it, so enabling/disabling a category in Admin → Settings flows through with no code change.

**Key files**:
- `src/lib/resource-booking.ts` — availability lookup (`getSlotAvailability`, `computeSlotAvailability`), booking-plan resolution (`planBooking`, `BookingResourceError`), and atomic resource-assignment persistence (`persistResourceAssignments`). The corporate-batch indoor-net hold is a virtual reservation overlay driven by the `CORPORATE_BATCH_CONFIG` policy.
- `src/lib/resource-pricing.ts` — per-category pricing (`RESOURCE_PRICING_CONFIG` policy) with optional Yantra/Leverage overrides via `MachineType.code`.
- `/api/slots/resource-availability` — slot grid for RESOURCE_BASED centers (returns free nets, coaches, staff, full-court status, and per-category prices).
- `/api/slots/book-resource` — booking creation for RESOURCE_BASED centers; serializable transaction with retry on serialization conflicts.

**Default `CORPORATE_BATCH_CONFIG`**: Mon/Wed/Fri, 07:00–09:00 IST, 2 indoor nets held, disabled until the admin turns it on. Override via `CenterPolicy('CORPORATE_BATCH_CONFIG')` — the same key also carries the Match Practice enrollment knobs (coach, fees, capacity, half-month; see below).

**User UI**: `/slots` page now routes via `SlotsRouter` based on `currentCenter.bookingModel`:
- `MACHINE_PITCH` → existing `SlotsContent` (legacy ABCA flow, untouched).
- `RESOURCE_BASED` → `src/app/slots/ResourceSlotsPage.tsx` — date picker, category tabs (Machine / Sidearm / Coaching / Full Court / Match Practice), per-category secondary picker (machine / coach / staff), slot grid with per-slot bookability + price, multi-slot selection, sticky booking bar, confirm dialog, submits to `/api/slots/book-resource`.

### Operator availability & capacity

Operators are staffed exactly like Ground Staff / Coaches / Sidearm Specialists — there is no operator-specific configuration model any more. Each `CenterMembership(role='OPERATOR')` carries weekly `MembershipAvailability` windows (with an optional effective date range) plus a `priority` (1 = first pick), both edited on **Admin → Operators** (`src/app/admin/operators/page.tsx`), which is a 1:1 mirror of Admin → Ground Staff and reuses `SpecialistAvailabilityCard` / the `…/members/[membershipId]/availability` endpoint.

Rules, all in `src/lib/operatorAssign.ts`:
- **On duty** = the operator's weekly schedule covers the slot. **No schedule configured = NOT available** — an operator is only eligible for auto-assignment once an admin has entered a window that covers the slot. This is the coach / sidearm rule (`slotMatchesMembershipAvailability` returns false on an empty schedule), **not** the ground-staff rule; `pickGroundStaffForSlot` keeps its "unscheduled = always on the floor" fallback because ground staff are a floor contact rather than an assignable resource. Consequence when rolling out to a center that hasn't filled schedules in yet: capacity is 0, so LEATHER is unbookable and TENNIS self-operates until the schedules exist. Admin → Operators warns about unscheduled operators by count.
- **One operator, one booking.** The number of operator-assisted MACHINE bookings a slot can hold equals the number of operators available for that slot — never the roster size. `getOperatorSlotCapacity` returns `{ onDuty, busy, free, freeOperatorIds }`; `autoAssignOperator` takes the highest-priority free one, or null when the slot is at capacity.
- `onDuty === 0` → nobody available: LEATHER machines are unbookable, TENNIS falls back to `SELF_OPERATE`. Same fallback when `free === 0`. Enforced server-side in `/api/slots/book-resource` (409 for LEATHER) and surfaced to the grid by `/api/slots/resource-availability` as `operatorCount` / `operatorsBusy` / `operatorAvailable` / `selfOperate`.
- The **manual** operator reassignment on Admin → Bookings (`canOperateAtCenter`) is deliberately *not* availability-gated — it is an admin override for the off-schedule case.
- Changing an operator's availability does **not** cancel or refund existing bookings (`bookingAssignmentFilter` returns null for OPERATOR, as for GROUND_STAFF) — operators are fungible and never user-picked, so an admin reassigns from Admin → Bookings instead.

**Removed, do not reintroduce**: the `OPERATOR_SCHEDULE_CONFIG` and `OPERATOR_DATE_OVERRIDES` policies, the `NUMBER_OF_OPERATORS` fallback for staffing, the day+slab priority matrix on `User.operator*Priority`, and the per-machine `OperatorAssignment` table. The columns/table survive in the schema marked DEPRECATED so existing rows aren't destroyed, but nothing reads them. `/api/admin/operators` is now GET-only (the Admin → Bookings reassignment dropdown); `/api/admin/override-cancellations` is gone.

### Staff Mode booking visibility (`/staff`)

One page, one tab per `CenterMembership` role the user holds (admins see all four). Each tab is that role's **operational category**, not a personal worklist — `/api/staff/bookings?role=…`:

| Tab | Shows | Scoped by assignee? |
|---|---|---|
| Operator | `category = MACHINE` — every bowling-machine session at the center | ❌ no |
| Ground Staff | every facility category: `NET`, `FULL_COURT`, `MATCH_SIMULATION`, `CORPORATE_BATCH` | ❌ no |
| Sidearm | `category = SIDEARM` | ✅ `assignedStaffId = viewer` |
| Coach | `category = COACHING` | ✅ `assignedCoachId = viewer` |

Operator and Ground Staff are deliberately **assignment-blind**: any operator sees every machine booking whoever it's assigned to, and any ground-staff member sees every facility booking, so the floor can be coordinated by whoever is on it. Sidearm specialists and coaches stay scoped to their own sessions (those are personally-booked resources). Admins keep full visibility on every tab.

The Ground Staff category set is expressed as the **complement** of `GROUND_STAFF_EXCLUDED_CATEGORIES` (`MACHINE`, `SIDEARM`, `COACHING`) rather than an allowlist, so a new facility category shows up without a code change — and it lines up with the booking engine, where exactly those three categories leave `assignedGroundStaffId` null.

### Match Practice (Corporate Batch + Match Simulation)

Seat-based booking category for RESOURCE_BASED centers — no machine, ball type, pitch type, or operator anywhere in the flow. The user-facing "Match Practice" tab (`MATCH_PRACTICE` in `ENABLED_BOOKING_CATEGORIES`, a UI umbrella, NOT a `BookingCategory` value) renders `src/app/slots/MatchPracticePanel.tsx` with two subcategories:

- **Corporate Batch** (`Booking.category = CORPORATE_BATCH`): fixed weekly batch (default Mon/Wed/Fri 07:00–09:00, coach Govind Lashkare, capacity 25). Two purchase modes on `Booking.corporateBatchMode`: `MONTHLY` (₹2000 default; one row per user per month, `enrollmentPeriod = "YYYY-MM"`; optional `HALF_MONTH` split — "YYYY-MM-H1"/"-H2" — when enabled in config) and `REGULAR` (₹200/session default; one row per attended date; renamed from `ADHOC` — config key `regularFee`, legacy `adhocFee` still read). Session seats = members whose period covers the date + regular (per-session) rows for that date. Config: `CORPORATE_BATCH_CONFIG` (shared with the net-hold overlay).
- **Match Simulation** (`Booking.category = MATCH_SIMULATION`): admin-CRUD session list in `MATCH_SIMULATION_CONFIG` — each session has days (default Tue/Thu/Fri/Sat/Sun), a time window (default 07:00–09:00), capacity (default 10), fee, optional coach, and an enabled flag; multiple sessions per day supported. Seats counted per `(date, startTime)`.

**Session Type box**: shown whenever **at least one** subcategory is enabled, listing only the enabled ones — with a single type it stays as one selected tile so the user can still see what they're booking. It is hidden only when *both* are disabled, and that case already short-circuits to the "not available at this center" state before the box renders. Do not gate it on "both enabled" again; a center that runs only Match Simulation still needs the label.

**Landing defaults**: tapping Match Practice arrives on **Match Simulation** + **Regular** (per-day session) for both subcategories, so the user only has to pick a session. Match Simulation is the fallback-second choice only when it is the disabled one. Both stay freely switchable.

**Key files**: `src/lib/match-practice.ts` (config normalization, session/occurrence generation, `resolveMatchPracticePlans`, in-tx `assertMatchPracticeSeat` capacity + duplicate guards), `/api/match-practice/availability` (months with enrollment counts + upcoming sessions with seat counts), `/api/slots/book-resource` (dispatches both categories through the same payment/wallet/refund machinery; capacity re-checked inside the serializable tx), `src/components/admin/MatchPracticeConfigEditor.tsx` (Admin → Settings → Match Practice card). Fees are flat admin-set amounts — recurring/promotional discounts and packages don't apply; admin blocks (`BlockedSlot.categories`) do.

### Booking notifications by role (`BOOKING_NOTIFICATION_CONFIG`)

Who, beyond the customer, hears about a booking. Two disjoint kinds of recipient, both delivered by the same pair of helpers in `src/lib/notifications.ts` (`notifyAssignedStaffNewBooking` / `notifyAssignedStaffBookingCancelled`):

- **Assigned** (`StaffRecipient.kind = 'ASSIGNED'`) — the people pinned to *that* booking: its operator / coach / sidearm specialist / ground staff. Unchanged, always on, worded "assigned to you".
- **Subscribed** (`kind = 'SUBSCRIBED'`) — everyone holding a `CenterMembership` role the center has switched on. They get the same alert for **every** booking at the center, worded "at your center" (nothing is assigned to them). This is how a moderator running the floor sees every booking.

Config is the per-center `BOOKING_NOTIFICATION_CONFIG` policy, resolved center → global → code default by `getPolicyJson` and coerced by `normalizeBookingNotificationConfig` (`src/lib/booking-notifications.ts` — a **pure module with no Prisma import**, so the admin editor and the server share one normalizer):

```json
{
  "roles": { "ADMIN": false, "MODERATOR": true, "OPERATOR": false,
             "COACH": false, "SIDEARM_SPECIALIST": false, "GROUND_STAFF": false },
  "events": { "created": true, "cancelled": true },
  "whatsapp": true
}
```

**`MODERATOR` is the only role on by default** — moderators get every booking with zero configuration, and turning the feature up can never silently start messaging a center's whole roster. Every `MembershipRole` is configurable; `MEMBERSHIP_ROLE_LABELS` is typed `Record<MembershipRole, string>` so adding a role to the enum is a compile error until it's labelled (a parity test asserts it too). The normalizer is tolerant by design (the row is hand-editable on `/admin/policies`): per-field fallback, string booleans accepted, unknown keys dropped, and a bare `["MODERATOR","ADMIN"]` array read as "these on, all others off".

**Dedup, in `withRoleSubscribers`**: the exclude set is seeded from the already-collected assigned recipients, every booking row's `userId`, and — on cancellations — the `actorUserId` of whoever performed it. So an assigned coach who also holds a `COACH` membership is paged once (keeping the richer "assigned" copy), a user holding two enabled roles is paged once under the earlier canonical role, a moderator who books their own slot gets only the customer confirmation, and an admin who blocks a morning isn't sent one message per cancelled booking narrating their own click. `cancelledBy` can't serve as the actor — it's a display name, not an id — so all four cancel call sites pass `actorUserId` explicitly.

**Delivery**: in-app is always created and now carries `bookingId`, so a subscriber's alert renders the full Bookings-page card, not a pipe-separated summary. WhatsApp goes through an **approved template** (`WHATSAPP_STAFF_BOOKING_TEMPLATE` / `_CANCEL_TEMPLATE` when set, else the approved customer `booking_detail` / `booking_cancelled`) — free-form text only delivers inside the 24h service window and a subscriber has almost certainly never messaged the business. `config.whatsapp: false` keeps subscribers in-app only *without* muting assigned staff; it exists because the BSP bills per template message, so a center with five admins pays 5× per booking.

**Never throws**: `loadRoleSubscribers` catches everything and returns `[]`, so a policy or membership failure can't strand the assigned-staff alerts, which are the load-bearing ones.

**Volume**: creation batches a multi-slot submission into **one** message per recipient; cancellation is per booking row, so an admin block that cancels N bookings sends N alerts per recipient (pre-existing for assigned staff, amplified across a role by subscribers). Batch it there if it becomes a problem.

**Edited on Admin → Configuration → "Booking Notifications"** (`src/components/admin/BookingNotificationsEditor.tsx`, saved by the page's single Save button via `POST /api/admin/policies`). That page is **admin-only** — moderators *receive* these notifications but cannot configure them, and `/admin/configuration` stays in the middleware moderator blocklist.

**Reading them**: `/notifications` is the inbox, linked from the admin sidebar and admin bottom nav ("Alerts") so a recipient doesn't have to leave the panel. That page's auth gate is driven by the API response, **not** `useSession()` — PlayOrbit has two login paths and gating on the NextAuth session alone locked every mobile-OTP user (i.e. most staff) out of their own alerts. Signed-out has two shapes there: the route's 401, and the middleware's redirect of `/api/*` to the landing page, which arrives as a followed 307 (status 200, HTML body) — both are treated as signed out, a thrown fetch is not.

An alert about **someone else's** booking is a staff / role-subscriber one, and `GET /api/notifications` flags it with `isOwnBooking: false`. The view then renders the card **and** keeps the message text underneath. The card alone is not enough for staff: it is a snapshot of the *first* row (so a 4-slot booking would show one half-hour window and one slot's price instead of the batch span and total), and `mapBookingForCard` emits no customer contact at all, so the booker's phone — which the message carries and floor staff act on — appears nowhere on it. Switching the card to `role="operator"` does **not** fix that (the field isn't in the payload) and would drop the refund block, so the role stays `user` and the message supplies the rest.

The card is also **re-authorised on every fetch**, because it is re-read live rather than frozen like the message: someone else's booking only renders a card while the viewer still holds a `CenterMembership` at that booking's center (`canAccessCenter`). Without that, a revoked operator's months-old alerts would keep streaming those bookings' current status, price and refunds. Dropping the card leaves the historical message text — exactly what staff alerts showed before they carried a `bookingId`.

### Ledger (manual revenue & expenses)

Admin → **Ledger** (`/admin/ledger`) records money the booking engine never sees. Two tabs over one `LedgerEntry` table, discriminated by `kind`:

- **Manual Revenue** (`kind = REVENUE`) — walk-in cash, off-platform transfers. Fields: `revenueCategory`, `customerName`.
- **Expenses** (`kind = EXPENSE`) — `expenseCategory` (`REPAIRS_MAINTENANCE`, `BALLS`, `STAFF_PAYMENTS`, `UTILITIES_CONSUMABLES`, `MISCELLANEOUS`), `expenseSubcategory` (TEXT code validated against the catalog in `src/lib/ledger.ts`, so it grows without a migration), `description`, `paidTo`.

`LedgerRevenueCategory` mirrors `BookingCategory` **one-for-one** — `MACHINE`, `NET`, `SIDEARM`, `COACHING`, `FULL_COURT`, `CORPORATE_BATCH`, `MATCH_SIMULATION` — plus `OTHER` for income with no service behind it. Corporate Batch and Match Simulation are listed individually, *not* as the `MATCH_PRACTICE` UI umbrella (which isn't a `BookingCategory` and has no dashboard bucket). A test in `ledger.test.ts` asserts this parity, so adding a booking category fails loudly until the ledger follows.

Shared columns (both kinds): `amount`, `entryDate`/`entryTime` (when the money actually moved), `paymentMethod` (`LedgerPaymentMethod`: `CASH` / `ONLINE` / `OTHER`), `remarks`, `collectedById`, `recordedById`.

**Session timing is REVENUE-only**: `serviceDate`/`serviceStartTime`/`serviceEndTime` (the session this revenue was earned from, as an optional From/To range, separate from when the money moved). Expenses have no session behind them — the expense form omits the block, the expense Zod schema doesn't accept the fields, `toLedgerColumns` nulls them, and the expense CSV has no session columns. The columns stay on the shared table.

**List + detail**: the list shows only Date · Category · Amount · Payment Method · Collected By ("Expense Made By" for expenses) so it fits a phone with no horizontal scrolling; tapping a row opens `LedgerDetailDialog` with everything else (customer/description, vendor, session, remarks, recorded by) plus Edit/Delete. Deletion confirms through the app-wide `ConfirmDialog` (`variant="danger"`), not `window.confirm`.

**Filters**: date range · category · payment method · who handled the money · recorded by · free-text search, all combinable and all shared with the CSV export through `buildLedgerWhere`. The money-handler filter is one column (`collectedById`) wearing two labels — **Collected By** on Manual Revenue, **Expenses Made By** on Expenses — matching the list header, which already renames itself per kind. Its options come from the GET response's `handlers` (everyone who *appears* as `collectedBy` on an entry here), not from `collectors` (active members, the entry form's picker): a staff member who leaves must stay filterable or their history becomes unreachable. Same rule as `recorders`.

- **`collectedById`** — who physically handled the money; a `User` FK (nullable), *not* an enum of staff names, so the picker tracks the center's live roster. The API rejects any user without an active `CenterMembership` at the center. Defaults in the form to whoever is adding the entry.
- **`recordedById`** — who keyed it in. **Always stamped from the session server-side, never accepted from the request body**, and never rewritten on edit (the moderator edit check keys off it, so rewriting would let an edit hand ownership away).

**Naming**: this was specced as "Ad Hoc Revenue / Ad Hoc Expenses". "Ad hoc" already means the per-session Match Practice purchase mode (`CorporateBatchMode.REGULAR`, formerly `ADHOC`) and both would appear on the same dashboard, so the module is the **Ledger** and its sides are "Manual Revenue" and "Expenses". Nothing user-visible says "ad hoc".

**Key files**: `src/lib/ledger.ts` (labels, subcategory catalog, discriminated-union Zod schema, `toLedgerColumns` — which nulls the other kind's columns so switching kind on edit can't leave stale data), `src/components/admin/ledger/LedgerDetailDialog.tsx`, `src/lib/ledger-query.ts` (`buildLedgerWhere`, shared by list + CSV so an export always matches the screen), `/api/admin/ledger` (GET list + totals, POST), `/api/admin/ledger/[id]` (PATCH, DELETE), `/api/admin/ledger/export` (CSV), `src/app/admin/ledger/page.tsx`, `src/components/admin/ledger/`.

**Permissions** (`requireCenterAdmin`, which admits both roles and reports `isModerator`):

| | View all | Create | Edit own | Edit others' | Delete |
|---|---|---|---|---|---|
| Center ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ |
| MODERATOR | ✅ | ✅ | ✅ | ❌ 403 | ❌ 403 |

The GET response carries `canDelete`, `canEditAll` and `viewerId` so the UI can gate per row; every rule is re-enforced in `[id]/route.ts`. `/admin/ledger` is intentionally absent from the middleware moderator blocklist.

**Dashboard**: `/api/admin/stats` adds `manualRevenue` and `manualExpenses` (grouped by `kind` + `revenueCategory`, scoped by `entryDate` against the dashboard range). **Total Revenue = booking + package + manual revenue**; expenses are a separate card and are never netted off revenue. See "Admin dashboard revenue" below for how manual revenue folds into the charts.

### Admin dashboard revenue (`/admin` + `/api/admin/stats`)

Every rupee comes from **one formula**, applied to bookings, package purchases and Ledger entries alike:

```
Revenue = Σ(online) + Σ(wallet) − Σ(refunds)
```

`src/lib/dashboard-revenue.ts` is the single fold. The route turns each money source into a `RevenueRow` (`{ category, online, wallet, refunds, machineName }`) and `aggregateRevenue` buckets them, so two rules hold **by construction** — not by coincidence — and are asserted in `dashboard-revenue.test.ts`:

1. **Σ(Revenue-by-Category bars) === Total Revenue** (=== Bookings + Packages + Manual).
2. **Σ(Revenue-by-Machine bars) === the Bowling Machine category bar.**

Consequences worth knowing:

- **Manual revenue merges into the same category bars as system revenue** — a hand-recorded sidearm session sits on the Sidearm bar next to the booked ones. The only extra category bar is `OTHER` (manual income with no service behind it). It reaches the **machine** chart too, under a `Manual Entry` bar (`MANUAL_MACHINE_LABEL`), because a manual entry names a category but never a machine and rule 2 has to hold. A machine booking that names no machine lands on `Other` (`UNATTRIBUTED_MACHINE_LABEL`).
- **CANCELLED bookings and packages are included, net of their refunds.** A cancellation that retained a fee retained money; excluding the row reported that fee as ₹0. A fully refunded one nets to zero on its own.
- **Refunds are subtracted unclamped** (`splitAmountNetSigned`, not `splitAmountNet`). A refund is sized from the slot's mutable `price` and can exceed that slot's even share of its order, so zeroing a negative row before summing would strand the excess and over-report the order. The clamped `splitAmountNet` stays the **one-row display** figure (admin bookings list, CSV).
- **Cash collects nothing through these rails and contributes 0** — walk-in cash belongs in the Ledger as Manual Revenue.
- **Profit = Total Revenue − Expenses**, derived on the client from the two cards beside it so the three can never disagree on screen.

**Operator Sessions card**: all four numbers count the same universe — non-cancelled `category = MACHINE` bookings in range — partitioned into three disjoint, exhaustive buckets so `Total = Σ(per-operator) + Self-Operate + Unassigned` always holds: `operatorId` set / no operator + `SELF_OPERATE` / no operator + `WITH_OPERATOR`. The `category: MACHINE` scope is what makes the identity true: `operationMode` is a non-null column defaulting to `WITH_OPERATOR` and the resource engine stamps every non-machine row `SELF_OPERATE`, so counting across all categories dumped every net / sidearm / coaching / match-practice booking into the Self-Operate and Unassigned buckets.

### Per-center Razorpay (phase 6)

Each `Center` row may store its own `razorpayKeyId`, `razorpayKeySecret`, and `razorpayWebhookSecret`. When set, every Razorpay operation for that center routes to its own merchant account; centers without keys fall back to the env (`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET`).

**Helpers in `src/lib/razorpay.ts`**:
- `getCenterRazorpayCredentials(centerId)` — returns `{ keyId, keySecret, webhookSecret, fromEnvFallback }` or null.
- `getRazorpayInstanceForCenter(centerId)` — cached SDK client per center (keyed by `centerId`, env fallback under `__env__`).
- `createRazorpayOrder({ centerId, amount, receipt, notes })` — adds `centerId` to order notes automatically.
- `verifyPaymentSignatureForCenter({ centerId, ... })` — looks up secret + verifies HMAC.
- `verifyPaymentSignatureWithSecret({ keySecret, ... })` — sync version when caller already has the secret.
- `verifyWebhookSignatureWithSecret({ body, signature, webhookSecret })` — webhook-side HMAC.
- `initiateRefund({ centerId, paymentId, amount, notes })` — refunds against the originating center's account.
- `fetchPaymentDetails(centerId, paymentId)` — fetch via the center's account.

The legacy `getRazorpayInstance()` and `verifyPaymentSignature(...)` are deprecated env-only shims kept for any unmigrated callers.

**Webhook routing** (`/api/webhooks/razorpay`): all centers point their dashboards at the same URL. The handler reads the body, looks up the local `Payment` row by `razorpayOrderId` to identify the center, then verifies the signature with that center's webhook secret (env fallback if unset). Without a valid signature the request is rejected; without a matching Payment row the webhook returns `no_record` (200 OK so Razorpay doesn't retry).

**Client init** (`/api/payments/config`): returns `razorpayKeyId` resolved from the user's current center, with env fallback. The client uses this to bootstrap Razorpay Checkout against the right merchant account.

**Configuration UI**: super admin → `/admin/centers/[id]` → Payment tab. Secrets are masked on read and only re-sent when the admin types a new value.

### Center-scoped data — current state
| Table | Scope | Notes |
|---|---|---|
| Booking, Slot, BlockedSlot | center | unique on `(centerId, …)` |
| Package, UserPackage | center via Package | `Package.centerId` is authoritative; `UserPackage` derives via join |
| Payment, Refund | center | per-center Razorpay account |
| LedgerEntry | center | manual revenue + expenses; `(centerId, kind, entryDate)` index |
| **Wallet, WalletTransaction** | **center** | `(userId, centerId)` unique; per-center balances; refunds at center X credit user's center-X wallet only |
| PromotionalOffer, RecurringSlotDiscount | center | |
| OperatorAssignment, CashPaymentUser | center | |
| Policy / CenterPolicy | global default + per-center override | use `getPolicyValue(key, centerId)` |
| User, Notification, Otp | global | a single user spans centers via `CenterMembership` |

A `WALLET_SCOPE` policy ('CENTER' | 'GLOBAL') is reserved for future use — wallets stay per-center for now. To switch to global wallets later: relax `Wallet.centerId` to nullable, add a resolver that picks the right wallet based on the policy, and migrate existing per-center balances into a single global row per user.
