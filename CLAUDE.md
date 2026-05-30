# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PlayOrbit (`abca-booking`) is a cricket practice booking platform built with Next.js 16 (App Router). Users book sessions on bowling machines (Gravity, Yantra, Leverage Indoor/Outdoor) across pitch types (Astro, Cement, Natural), with online payment via Razorpay or cash. Roles: USER, ADMIN, OPERATOR, COACH, SIDEARM_STAFF. Deployed on Vercel as a PWA with Android TWA support.

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
npx tsx scripts/make-admin.ts <email|mobile>   # Promote user to ADMIN
npx tsx scripts/check-migrations.ts            # Verify DB tables
npx tsx scripts/seed-centers.ts                # Verify/seed centers, ABCA machines, super admin
npx tsx scripts/seed-centers.ts --check        # Verify only, no writes
```

## Architecture

### Tech Stack
- **Next.js 16.1.4** (App Router, React 19, Turbopack)
- **Prisma 6** + PostgreSQL (Supabase/Vercel Postgres)
- **NextAuth 4** (Google OAuth) + custom JWT (OTP via Fast2SMS)
- **Razorpay** for payments, **Zod** for validation
- **Tailwind CSS v4**, **Lucide React** icons
- **Vitest** + React Testing Library + jsdom

### Dual Auth System
Two parallel auth mechanisms checked in `src/middleware.ts` and `src/lib/auth.ts`:
1. **NextAuth** (Google OAuth) — session via `getToken()`, configured in `src/lib/authOptions.ts`
2. **Custom OTP JWT** — stored in `token` cookie, verified via `verifyToken()` from `src/lib/jwt.ts`

`getAuthenticatedUser(req)` in `src/lib/auth.ts` is the universal auth helper for API routes — checks NextAuth first, falls back to OTP token, returns `{ id, name, role, email, isSuperAdmin, isFreeUser, isSpecialUser, mobileVerified, centerIds, centerMemberships }` or `null`. `centerMemberships` is the list of `{ centerId, role }` rows for the user; use it (or the helpers `canAccessCenter`, `hasMembershipRole`, `adminCenterIds`) to enforce per-center access in API routes.

### Middleware (`src/middleware.ts`)
- Protects all routes except explicit public paths (/, /login, /otp, /api/auth, static assets)
- Redirects logged-in users from /login, /otp to /slots (or /operator for OPERATOR role)
- Enforces role-based access: `/admin/*` requires ADMIN, `/operator/*` requires OPERATOR or ADMIN
- Checks maintenance mode via internal API call; super admin and allowlisted emails bypass

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
The `User.isSuperAdmin` boolean column is the source of truth. The `SUPER_ADMIN_EMAIL` env var (default `waheeddar8@gmail.com`) is used as a bootstrap fallback in `auth.ts` and is auto-applied to the User row on next Google sign-in. Super admins bypass center scoping (`canAccessCenter` returns true for any centerId).

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

### Resource-based booking engine (phase 5)

Centers with `bookingModel = RESOURCE_BASED` (e.g. Toplay) use a different booking primitive than ABCA. Instead of `(machineId, pitchType)` lanes, every booking consumes one or more `Resource` rows (nets/courts/turf wickets) plus optionally a `Machine`, a coach (User with COACH membership), or a sidearm-staff member (SIDEARM_STAFF membership).

**Booking categories** (`Booking.category`, `BookingCategory` enum):
- `MACHINE` — bowling machine session: 1 net + 1 Machine instance.
- `SIDEARM` — sidearm-staff session: 1 net + 1 SIDEARM_STAFF user.
- `COACHING` — personal coaching: 1 net + 1 COACH user.
- `FULL_COURT` — full indoor court: every active indoor net.
- `CORPORATE_BATCH` — admin-only group session.

ABCA's existing rows default to `MACHINE` and have no `BookingResourceAssignment` rows; nothing changes for them.

**Key files**:
- `src/lib/resource-booking.ts` — availability lookup (`getSlotAvailability`, `computeSlotAvailability`), booking-plan resolution (`planBooking`, `BookingResourceError`), and atomic resource-assignment persistence (`persistResourceAssignments`). Corporate batch is handled here as a virtual reservation overlay (no real Booking row), driven by the `CORPORATE_BATCH_CONFIG` policy.
- `src/lib/resource-pricing.ts` — per-category pricing (`RESOURCE_PRICING_CONFIG` policy) with optional Yantra/Leverage overrides via `MachineType.code`.
- `/api/slots/resource-availability` — slot grid for RESOURCE_BASED centers (returns free nets, coaches, staff, full-court status, and per-category prices).
- `/api/slots/book-resource` — booking creation for RESOURCE_BASED centers; serializable transaction with retry on serialization conflicts.

**Default `CORPORATE_BATCH_CONFIG`**: Mon–Fri, 07:30–09:30 IST, 2 indoor nets held. Override via `CenterPolicy('CORPORATE_BATCH_CONFIG')`.

**User UI**: `/slots` page now routes via `SlotsRouter` based on `currentCenter.bookingModel`:
- `MACHINE_PITCH` → existing `SlotsContent` (legacy ABCA flow, untouched).
- `RESOURCE_BASED` → `src/app/slots/ResourceSlotsPage.tsx` — date picker, category tabs (Machine / Sidearm / Coaching / Full Court), per-category secondary picker (machine / coach / staff), slot grid with per-slot bookability + price, multi-slot selection, sticky booking bar, confirm dialog, submits to `/api/slots/book-resource`.

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
| **Wallet, WalletTransaction** | **center** | `(userId, centerId)` unique; per-center balances; refunds at center X credit user's center-X wallet only |
| PromotionalOffer, RecurringSlotDiscount | center | |
| OperatorAssignment, CashPaymentUser | center | |
| Policy / CenterPolicy | global default + per-center override | use `getPolicyValue(key, centerId)` |
| User, Notification, Otp | global | a single user spans centers via `CenterMembership` |

A `WALLET_SCOPE` policy ('CENTER' | 'GLOBAL') is reserved for future use — wallets stay per-center for now. To switch to global wallets later: relax `Wallet.centerId` to nullable, add a resolver that picks the right wallet based on the policy, and migrate existing per-center balances into a single global row per user.
