# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PlayOrbit (`abca-booking`) is a cricket practice booking platform built with Next.js 16 (App Router). Users book sessions on bowling machines (Gravity, Yantra, Leverage Indoor/Outdoor) across pitch types (Astro, Cement, Natural), with online payment via Razorpay or cash. Three roles: USER, ADMIN, OPERATOR. Deployed on Vercel as a PWA with Android TWA support.

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

`getAuthenticatedUser(req)` in `src/lib/auth.ts` is the universal auth helper for API routes — checks NextAuth first, falls back to OTP token, returns `{ id, name, role, email, isSuperAdmin, isFreeUser }` or `null`.

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
Key models: User, Booking, Slot, Package, UserPackage, PackageBooking, Payment, BlockedSlot, OperatorAssignment, CashPaymentUser, Policy, Notification, Otp. Booking uniqueness: `[date, startTime, machineId, pitchType]`. Payment tracks Razorpay order/payment/signature/refund lifecycle.

### Policy System
Feature flags stored in the `Policy` model (key-value). Used for: `PAYMENT_GATEWAY_ENABLED`, `SLOT_PAYMENT_REQUIRED`, `PACKAGE_PAYMENT_REQUIRED`, `PRICING_CONFIG`, `TIME_SLAB_CONFIG`, `MACHINE_PITCH_CONFIG`, maintenance mode settings. Queried via `prisma.policy.findUnique({ where: { key } })`.

### API Route Pattern
All API routes are in `src/app/api/`. Standard pattern for protected routes:
```typescript
import { getAuthenticatedUser } from '@/lib/auth';
const user = await getAuthenticatedUser(req);
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
// For admin routes, also check: if (user.role !== 'ADMIN') ...
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
