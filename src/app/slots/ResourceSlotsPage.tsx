'use client';

/**
 * Resource-based slot booking UI (Toplay et al.).
 *
 * Lives next to `/slots/page.tsx`; the page picks which version to
 * render based on the active center's `bookingModel`.
 *
 * UX:
 *   1. Pick a date.
 *   2. Pick a booking category (Machine / Sidearm / Coaching / Full Court).
 *   3. (Conditional) Pick a machine / coach / sidearm specialist member.
 *   4. Tap one or more slots. Each slot becomes its own Booking row.
 *   5. Confirm → POST /api/slots/book-resource.
 *
 * The grid only shows slots that are bookable under the selected
 * category — e.g. when "Coaching" is active, slots with no free coach
 * are greyed out, and the disabled reason is surfaced on hover/long-press.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { format, parseISO } from 'date-fns';
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronDown,
  IndianRupee,
  Loader2,
  Settings2,
  Users,
  UserCog,
  LayoutGrid,
  Target,
  Goal,
  Hand,
  GraduationCap,
  Package as PackageIcon,
} from 'lucide-react';

/**
 * Center-agnostic display of a MachineType. Toplay rebranded the
 * Leverage tennis machine as "Master 200" (UI-only); ball type is
 * surfaced inline so users see "<Machine> (Leather|Tennis)" everywhere
 * the machine is named.
 */
function formatMachineDisplayName(name: string, ballType: string | null | undefined): string {
  const displayName = /leverage/i.test(name) ? 'Master 200' : name;
  const ball = (ballType || '').toUpperCase();
  const ballLabel = ball === 'LEATHER' ? 'Leather' : ball === 'TENNIS' ? 'Tennis' : ball.toLowerCase();
  return ballLabel ? `${displayName} (${ballLabel})` : displayName;
}
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageBackground } from '@/components/ui/PageBackground';
import { DateSelector } from '@/components/slots/DateSelector';
import { PaymentMethodSelector } from '@/components/ui/PaymentMethodSelector';
import { ContactFooter } from '@/components/ContactFooter';
import { useCenter } from '@/lib/center-context';
import { api } from '@/lib/api-client';
import { useRazorpay, usePaymentConfig } from '@/lib/useRazorpay';

type Category = 'MACHINE' | 'SIDEARM' | 'COACHING' | 'FULL_COURT' | 'NET' | 'CORPORATE_BATCH';

interface NetLite { id: string; name: string }
interface ResourceLite { id: string; name: string; type: string }
interface PersonLite { userId: string; name: string | null }

interface ResourceSlot {
  startTime: string;
  endTime: string;
  timeSlab: 'morning' | 'evening';
  freeIndoorNets: NetLite[];
  freeOutdoorResources: ResourceLite[];
  /**
   * Per-pitch free pool. When the user has picked a pitch, the slot
   * card consults this entry instead of `freeIndoorNets` so a NATURAL
   * booking doesn't read as "available" because indoor nets are free.
   * Server-side `pickNetFor` mirrors the same mapping.
   */
  freeByPitch?: {
    ASTRO: ResourceLite[];
    CEMENT: ResourceLite[];
    NATURAL: ResourceLite[];
  };
  freeCoaches: PersonLite[];
  freeSidearmStaff: PersonLite[];
  fullCourtAvailable: boolean;
  corporateBatchHolds: number;
  prices: {
    MACHINE: number;
    SIDEARM: number;
    COACHING: number;
    FULL_COURT: number;
    NET: number;
    CORPORATE_BATCH: number;
  };
  /** Per-machine final price for this slot, keyed by machineId — honours
   *  per-machine-type overrides (e.g. Yantra premium). Empty when the
   *  center has no active machines. */
  machinePrices?: Record<string, number>;
  /** Total operators configured for this slot/day/slab. 0 means
   *  self-operate (no operator required). Only consumed by the
   *  MACHINE category — SIDEARM/COACHING/FULL_COURT ignore. */
  operatorCount?: number;
  operatorsBusy?: number;
  /** True when an operator can still take this slot (or self-operate). */
  operatorAvailable?: boolean;
  /** True when the center has 0 operators scheduled for this slot —
   *  the booking proceeds, but the user is expected to operate the
   *  machine themselves. Mirrors ABCA's tennis-machine self-operate. */
  selfOperate?: boolean;
  /** Per-category discount preview. The active category's entry (if any)
   *  is rendered as a small "₹X off" badge on the slot card and
   *  subtracted from the displayed slot price; the actual booking
   *  recomputes server-side. Mirrors ABCA's recurring/promo slot
   *  badging from /api/slots/available. */
  discountsByCategory?: Partial<Record<Category, {
    recurring: number;
    promo: number;
    promoName: string | null;
    total: number;
  }>>;
  /** Per-Machine-row discount preview for MACHINE bookings. Includes
   *  offers pinned to specific machineRowIds, which would otherwise
   *  be invisible at the category level (no way to know which machine
   *  the user picks from a category-aggregate). When the user has
   *  selected a machine, the slot card uses this entry; falls back to
   *  discountsByCategory.MACHINE when absent. */
  machineDiscounts?: Record<string, {
    recurring: number;
    promo: number;
    promoName: string | null;
    total: number;
  }>;
  /** Categories blocked at this slot by an admin block. Empty when the
   *  slot is fully open. Used to grey out the slot card for the active
   *  category — without this, the user could tap an apparently-free
   *  slot and only get the 409 at submit. */
  blockedCategories?: string[];
  /** Specific Machine rows blocked at this slot by an admin block.
   *  When the user has pinned a MACHINE booking to one of these rows,
   *  the slot is unbookable for them even if other machines are free. */
  blockedMachineRowIds?: string[];
  /** Per-pitch granular blocking info. */
  blockedByPitch?: Record<string, { categories: string[]; machineRowIds: string[] }>;
  /** Machine rows already booked at this slot. Distinct from
   *  `blockedMachineRowIds`: a machine is "busy" when another booking
   *  claimed it; it's "blocked" when an admin policy hides it. Either
   *  way the user's pinned machine is unbookable, but the labels
   *  read differently. */
  busyMachineIds?: string[];
}

interface PerSlabRates { morning: number; evening: number }

/** Resolved RESOURCE_PRICING_CONFIG, mirrored from lib/resource-pricing. */
type ClientSlabRate = number | { single?: number; consecutive?: number };
interface ClientPerSlabRates {
  morning: ClientSlabRate;
  evening: ClientSlabRate;
}
interface ClientPricingConfig {
  categoryRates: Record<Category, PerSlabRates>;
  machineTypeOverrides?: Record<string, PerSlabRates>;
  /** machinePricing[machineTypeCode][pitchType][ballType] → rates. */
  machinePricing?: Record<string, Record<string, Record<string, PerSlabRates>>>;
  /** machineRowPricing[machineId][pitchType][ballType] → pair rates.
   *  Most-specific override; uses {single,consecutive} pairs so the
   *  consecutive discount mirrors ABCA. */
  machineRowPricing?: Record<string, Record<string, Record<string, ClientPerSlabRates>>>;
  /** sidearmPricing[pitchType] → rates. */
  sidearmPricing?: Record<string, PerSlabRates>;
  netPricing?: Record<string, PerSlabRates>;
}

interface ResourceAvailabilityResponse {
  date: string;
  centerId: string;
  centerSlug: string;
  indoorNetsTotal: number;
  outdoorResourcesTotal: number;
  coachesTotal: number;
  sidearmStaffTotal: number;
  /** Pitch types the user can pick when booking SIDEARM at this center.
   *  Read from center policy; defaults to all four. */
  sidearmPitchTypes: PitchTypeId[];
  /** Same idea for bare-net bookings. */
  netPitchTypes: PitchTypeId[];
  /** Same idea for Personal Coaching bookings — driven by the
   *  COACHING_PITCH_TYPES per-center policy. */
  coachingPitchTypes?: PitchTypeId[];
  /** Booking categories the admin has enabled for this center. The UI
   *  hides any tab not in this list. Defaults to every category. */
  enabledCategories: Category[];
  /** Full RESOURCE_PRICING_CONFIG so the client can recompute the
   *  price for a specific (machine × pitch × ball) choice without an
   *  extra round-trip. */
  pricingConfig: ClientPricingConfig;
  corporateBatchConfig: { enabled: boolean; days: number[]; startTime: string; endTime: string; netsConsumed: number };
  slots: ResourceSlot[];
}

type PitchTypeId = 'ASTRO' | 'TURF' | 'CEMENT' | 'NATURAL';
type BallTypeId = 'TENNIS' | 'LEATHER' | 'MACHINE';

interface MachineLite {
  id: string;
  name: string;
  isActive: boolean;
  /** Raw configured list (may be empty). Use `effectivePitchTypes` for
   *  what the user should actually see — empty falls back to all four. */
  supportedPitchTypes: PitchTypeId[];
  supportedBallTypes: BallTypeId[];
  /** Server-resolved effective lists — empty configured arrays already
   *  expanded to the full universe by the API. Always use these for
   *  rendering chips. */
  effectivePitchTypes: PitchTypeId[];
  effectiveBallTypes: BallTypeId[];
  machineType: {
    id: string;
    code: string;
    name: string;
    ballType: string;
    /** Optional public asset path inherited from the type — every Yantra
     *  instance shows the same Yantra photo without per-instance config. */
    imageUrl?: string | null;
  };
  /** Default lane / surface this machine usually sits on. Surfaces the
   *  configured pitch type ("Turf 1", "Cement 2", …) on the picker so
   *  users see what they'll actually play on. Null = roaming. */
  resource?: { id: string; name: string; type: string } | null;
}

// Three surfaces only — see lib/pitch-config.ts. The legacy 'TURF'
// label is intentionally omitted; rows that still reference it are read-
// only history and won't be offered as a fresh booking option.
const PITCH_TYPE_LABELS: Record<PitchTypeId, string> = {
  ASTRO:   'Astro Turf',
  TURF:    'Turf', // legacy — not offered, kept so old rows render
  CEMENT:  'Cement Wicket',
  NATURAL: 'Natural Turf',
};

const BALL_TYPE_LABELS: Record<BallTypeId, string> = {
  LEATHER: 'Leather',
  TENNIS:  'Tennis',
  MACHINE: 'Machine',
};

/**
 * Human-readable surface from the Resource enum (NET / TURF_WICKET / …).
 * Used as a tiny secondary label on the machine pill so the configured
 * lane is obvious before the user picks a slot.
 */
function describeResourceType(type: string | null | undefined): string {
  if (!type) return '';
  switch (type) {
    case 'NET':           return 'indoor net';
    case 'TURF_WICKET':   return 'natural turf';
    case 'CEMENT_WICKET': return 'cement';
    case 'COURT':         return 'court';
    default:              return type.toLowerCase().replace(/_/g, ' ');
  }
}

// Order matches the user-facing booking funnel — most-used categories
// first, batch / full-court at the end. CRICKET_NET ('Cricket Nets
// Booking') is the renamed NET category from the schema; the enum value
// stays NET for back-compat.
const CATEGORIES: Array<{ key: Category; label: string; icon: typeof Settings2; sub: string }> = [
  { key: 'MACHINE',         label: 'Bowling Machine',     icon: Settings2,  sub: 'Yantra / Leverage' },
  { key: 'NET',             label: 'Cricket Nets',         icon: LayoutGrid, sub: 'Bare net for self practice' },
  { key: 'SIDEARM',         label: 'Sidearm',             icon: Users,      sub: 'Bowled by a specialist' },
  { key: 'COACHING',        label: 'Personal Coaching',   icon: UserCog,    sub: 'With a coach' },
  // CORPORATE_BATCH intentionally hidden — kept as a DB enum value
  // so existing historical bookings stay valid, but the user-facing
  // slot picker no longer exposes a tab for it.
  { key: 'FULL_COURT',      label: 'Full Indoor Court',   icon: LayoutGrid, sub: 'All indoor nets' },
];

export default function ResourceSlotsPage() {
  const { currentCenter } = useCenter();
  const router = useRouter();
  const toast = useToast();
  const { data: session } = useSession();
  const isFreeBooking = !!session?.user?.isSuperAdmin || !!session?.user?.isFreeUser;

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [category, setCategory] = useState<Category>('MACHINE');
  const [machineId, setMachineId] = useState<string | null>(null);
  const [pitchType, setPitchType] = useState<PitchTypeId | null>(null);
  const [ballType, setBallType] = useState<BallTypeId | null>(null);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [staffId, setStaffId] = useState<string | null>(null);

  const [data, setData] = useState<ResourceAvailabilityResponse | null>(null);
  const [machines, setMachines] = useState<MachineLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [machinesLoading, setMachinesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedSlots, setSelectedSlots] = useState<ResourceSlot[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Payment method + wallet — mirrors ABCA's /slots flow. Default to
  // ONLINE; the PaymentMethodSelector flips to CASH when the user picks
  // "Pay at Center", and exposes a wallet toggle when the center has
  // wallet enabled and the user has a positive balance.
  const [paymentMethod, setPaymentMethod] = useState<'ONLINE' | 'CASH'>('ONLINE');

  // Kit rental — mirrors ABCA's flow. The checkbox card appears when
  // the center has kit rental enabled in its KIT_RENTAL_CONFIG policy
  // AND the user is on the MACHINE category AND has picked a leather-
  // ball machine. Per-slot charge gets added to the total and sent
  // to /api/slots/book-resource as `kitRental: true, kitRentalCharge`.
  const [kitRental, setKitRental] = useState(false);
  const [useWallet, setUseWallet] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number>(0);

  // Operation mode for MACHINE bookings (tennis only). Mirrors ABCA's
  // OptionsPanel toggle — leather machines hard-require an operator
  // server-side, so the toggle is hidden for them. WITH_OPERATOR is
  // the default; user can flip to SELF_OPERATE on tennis machines and
  // the booking goes through without an assigned operator.
  const [operationMode, setOperationMode] = useState<'WITH_OPERATOR' | 'SELF_OPERATE'>('WITH_OPERATOR');

  // ─── Package redemption (Toplay parity with ABCA) ─────────────
  // /api/packages/my returns active (non-expired) UserPackages with the
  // resource-based axes (category, machineRowId) populated when present.
  // The picker below filters those packages down to ones compatible with
  // the user's current category + machineId selection.
  interface MyPackageLite {
    id: string;
    packageName: string;
    category: string | null;
    machineRowId: string | null;
    /** Display name of the pinned machine row, if any. */
    machineRowName: string | null;
    totalSessions: number;
    usedSessions: number;
    remainingSessions: number;
    status: string;
    pendingActivation?: boolean;
  }
  const [myPackages, setMyPackages] = useState<MyPackageLite[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  // Tracks whether the user explicitly picked "Don't use a package"
  // — once they do, auto-select stops nagging them. Mirrors ABCA's
  // `usePackages.userDeclinedPackage` flag.
  const [userDeclinedPackage, setUserDeclinedPackage] = useState(false);
  // Auto-select-machine effect should fire at most once per page load —
  // otherwise switching machines manually would yank you back to the
  // package's pinned machine. Ref so the effect can self-arm without
  // becoming a state-tracked dependency.
  const hasAutoSelectedMachineRef = useRef(false);

  // Package validation — mirrors ABCA's `usePackages.validation`. When
  // a package is selected and slots are picked, we POST to
  // `/api/packages/validate-booking` to get the server's verdict:
  //   - valid: boolean
  //   - error?: human reason when invalid
  //   - extraCharge?: ₹ on top of the package (e.g. DAY package booking
  //     an evening slot). Surfaced in the package panel + booking bar
  //     so the user knows the cart isn't free even though a package
  //     is selected.
  interface PackageValidation {
    valid: boolean;
    error?: string;
    extraCharge?: number;
    extraChargeType?: string;
  }
  const [packageValidation, setPackageValidation] = useState<PackageValidation | null>(null);
  const [packageValidating, setPackageValidating] = useState(false);

  // Payment gateway integration (mirrors ABCA's /slots flow). When
  // SLOT_PAYMENT_REQUIRED is on for the center, we route the booking
  // through Razorpay; the verify route then creates the bookings
  // atomically via executeResourceBooking.
  const { config: paymentConfig } = usePaymentConfig();
  const { initiatePayment, processing: paymentProcessing } = useRazorpay(
    {
      onFailure: (msg) => toast.error(msg),
    },
    !!paymentConfig?.paymentEnabled,
  );

  // Snap paymentMethod back to ONLINE when the center disables cash — the
  // PaymentMethodSelector self-hides the cash button but the state could
  // already be stuck on CASH from a previous render.
  useEffect(() => {
    if (paymentConfig && !paymentConfig.cashPaymentEnabled && paymentMethod === 'CASH') {
      setPaymentMethod('ONLINE');
    }
  }, [paymentConfig, paymentMethod]);

  // Reset selections when category changes. We deliberately DON'T
  // reset pitchType / ballType / coachId / staffId here — the
  // dedicated effects below default each one to the first available
  // option for the new context, so users never see an empty picker.
  useEffect(() => {
    setSelectedSlots([]);
    setMachineId(null);
    // Drop the selected package when the user switches category — the
    // category gate on the server will reject it anyway. We'll let the
    // user re-pick if a different package still applies.
    setSelectedPackageId(null);
    // Reset the "user declined" gate too so the next category can
    // auto-select fresh. Mirrors ABCA's pkg.reset() on machine switch.
    setUserDeclinedPackage(false);
  }, [category]);

  // Drop the package selection when the user switches machines if the
  // selected package is pinned to a different machine row.
  useEffect(() => {
    if (!selectedPackageId) return;
    const pkg = myPackages.find((p) => p.id === selectedPackageId);
    if (pkg?.machineRowId && pkg.machineRowId !== machineId) {
      setSelectedPackageId(null);
    }
  }, [machineId, selectedPackageId, myPackages]);

  /** Active packages compatible with the current category + machine
   *  selection. Mirrors the server-side gates in
   *  `/api/slots/book-resource` (category match, machineRowId match if
   *  pinned, status ACTIVE, sessions remaining). */
  const eligiblePackages = useMemo(() => {
    return myPackages.filter((p) => {
      if (p.status !== 'ACTIVE') return false;
      if (p.remainingSessions <= 0) return false;
      // Category must match (or be null on legacy ABCA-shape packages).
      if (p.category && p.category !== category) return false;
      // If pinned to a machine row, the user must have picked that one.
      if (p.machineRowId && p.machineRowId !== machineId) return false;
      return true;
    });
  }, [myPackages, category, machineId]);

  const selectedPackage = useMemo(
    () => eligiblePackages.find((p) => p.id === selectedPackageId) ?? null,
    [eligiblePackages, selectedPackageId],
  );

  // ─── Auto-select first eligible package ──────────────────────────
  // Mirrors ABCA's effect at src/app/slots/page.tsx:180. The moment a
  // user has any active package compatible with the current view
  // (category + machine pin), it becomes the default selection.
  //
  // Depends on `eligiblePackages` (not just `myPackages`) so that when
  // the auto-select-machine effect below switches the machine to a
  // pinned package's home, this effect picks the package up on the
  // next render — without that dependency, machine-pinned packages
  // would land unselected even though everything was ready.
  useEffect(() => {
    if (userDeclinedPackage) return;
    if (eligiblePackages.length === 0 || selectedPackageId) return;
    setSelectedPackageId(eligiblePackages[0].id);
  }, [eligiblePackages, selectedPackageId, userDeclinedPackage]);

  // ─── Auto-select compatible package once slots are chosen ─────────
  // Mirrors ABCA's effect at src/app/slots/page.tsx:194. Prefers a
  // machine-pinned package over a category-only package, and only
  // picks one with enough remaining sessions for the cart.
  useEffect(() => {
    if (userDeclinedPackage) return;
    if (myPackages.length === 0 || selectedSlots.length === 0 || selectedPackageId) return;

    // Prefer exact machine match: package pinned to the same machine
    // row the user picked.
    const exactMatch = eligiblePackages.find(
      (p) =>
        p.machineRowId && p.machineRowId === machineId &&
        p.remainingSessions >= selectedSlots.length,
    );

    // Otherwise fall back to a category-match package (no machine pin)
    // with enough remaining sessions.
    const categoryMatch = !exactMatch
      ? eligiblePackages.find(
          (p) => !p.machineRowId && p.remainingSessions >= selectedSlots.length,
        )
      : null;

    const compatible = exactMatch || categoryMatch;
    if (compatible) setSelectedPackageId(compatible.id);
  }, [myPackages, eligiblePackages, selectedSlots, selectedPackageId, machineId, userDeclinedPackage]);

  // ─── Validate selected package against the current selection ─────
  // Mirrors ABCA's effect at src/app/slots/page.tsx:155. When a package
  // is selected and the user has picked at least one slot, POST to
  // /api/packages/validate-booking to learn (a) whether the package is
  // still valid for this booking and (b) any extra charge that applies
  // (e.g. DAY package booking an evening slot). The result drives the
  // green-check / red-AlertTriangle panel below the dropdown and the
  // "Extra: ₹X" line in the bottom booking bar.
  useEffect(() => {
    if (!selectedPackageId || selectedSlots.length === 0) {
      setPackageValidation(null);
      return;
    }
    const pkg = myPackages.find((p) => p.id === selectedPackageId);
    if (!pkg) {
      setPackageValidation(null);
      return;
    }
    let cancelled = false;
    setPackageValidating(true);
    // Resource-based packages don't carry ballType — the server now
    // skips the legacy machineType compatibility check when the
    // package has a `category` set (see `validatePackageBooking`).
    // We still send a defensible ballType so the legacy ABCA path
    // through the same endpoint keeps working when a non-Toplay
    // package is wired here later.
    const fallbackBall = ballType ?? 'TENNIS';
    fetch('/api/packages/validate-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userPackageId: selectedPackageId,
        ballType: fallbackBall,
        pitchType: pitchType ?? null,
        startTime: selectedSlots[0].startTime,
        numberOfSlots: selectedSlots.length,
        slotTimes: selectedSlots.map((s) => s.startTime),
        machineId: machineId ?? null,
      }),
    })
      .then((res) => res.json())
      .then((data: PackageValidation) => {
        if (cancelled) return;
        setPackageValidation(data);
      })
      .catch(() => {
        if (cancelled) return;
        setPackageValidation({ valid: false, error: 'Could not validate package' });
      })
      .finally(() => {
        if (!cancelled) setPackageValidating(false);
      });
    return () => { cancelled = true; };
  }, [selectedPackageId, selectedSlots, myPackages, ballType, pitchType, machineId]);

  // ─── Auto-select machine based on user's package ─────────────────
  // Mirrors ABCA's effect at src/app/slots/page.tsx:251. If the user
  // has a machine-pinned package and lands on the MACHINE category,
  // switch the machine picker to that pinned machine so the package
  // becomes immediately usable. Fires at most once per page load —
  // the ref short-circuits subsequent re-runs so the user can still
  // manually switch machines without being yanked back.
  useEffect(() => {
    if (hasAutoSelectedMachineRef.current) return;
    if (category !== 'MACHINE') return;
    if (myPackages.length === 0) return;

    const pinned = myPackages.find(
      (p) =>
        p.status === 'ACTIVE' &&
        p.remainingSessions > 0 &&
        p.machineRowId &&
        (!p.category || p.category === 'MACHINE'),
    );
    if (pinned?.machineRowId && pinned.machineRowId !== machineId) {
      // Confirm the pinned machine still exists at this center
      // (might have been deactivated since the user bought the
      // package). `machines` is the raw active list for the center;
      // we use it instead of `filteredMachines` to avoid the
      // top-level TDZ from declaring `filteredMachines` further
      // down.
      const exists = machines.find((m) => m.id === pinned.machineRowId);
      if (exists) {
        setMachineId(pinned.machineRowId);
        hasAutoSelectedMachineRef.current = true;
      }
    }
  }, [category, myPackages, machines, machineId]);

  // Picking a different machine wipes pitch/ball — they're per-machine
  // — but only because the *next* effect will repopulate them with the
  // new machine's first effective option. Doing both in the same
  // render cycle prevents a "no chip selected" flicker.
  useEffect(() => {
    setPitchType(null);
    setBallType(null);
  }, [machineId]);

  // Default-select the first pitch + ball type whenever the picker's
  // option set changes. This is the single source of truth for the
  // "pitch and ball must always be selected" UX rule the product
  // wants — covers MACHINE (per-machine effective lists), SIDEARM
  // (per-center policy), NET (per-center policy), and any future
  // category that exposes pitch/ball chips.
  //
  // Capacity-aware pick: prefer pitches that actually have at least
  // one slot with free capacity in the loaded day. If none do, fall
  // back to the first option (slot grid will show 'full' but the
  // chip still highlights the user's natural starting point). Re-runs
  // when `data` arrives because per-slot freeByPitch is what tells
  // us which pitches have any availability today.
  useEffect(() => {
    let pitchOptions: PitchTypeId[] = [];
    let ballOptions: BallTypeId[] = [];
    if (category === 'MACHINE' && machineId) {
      const m = machines.find((x) => x.id === machineId);
      if (m) {
        pitchOptions = m.effectivePitchTypes ?? m.supportedPitchTypes ?? [];
        ballOptions = m.effectiveBallTypes ?? m.supportedBallTypes ?? [];
      }
    } else if (category === 'SIDEARM') {
      pitchOptions = data?.sidearmPitchTypes ?? [];
    } else if (category === 'NET') {
      pitchOptions = data?.netPitchTypes ?? [];
    } else if (category === 'COACHING') {
      // Coaching gained a pitch picker so admins can offer the same
      // 'Astro / Cement / Natural' choice they expose on cricket
      // nets. Defaults to every pitch when the policy isn't set.
      pitchOptions = data?.coachingPitchTypes ?? data?.netPitchTypes ?? [];
    }

    // Helper: does this pitch have at least one slot with free
    // capacity in the loaded day? Mirrors the server's per-pitch pool.
    // Returns true when freeByPitch isn't on the response (legacy
    // shape) so the auto-pick still falls back to the first option.
    const pitchHasAnyFreeSlot = (p: PitchTypeId): boolean => {
      const slots = data?.slots ?? [];
      if (slots.length === 0) return true;
      const key = p === 'CEMENT' || p === 'NATURAL' || p === 'ASTRO' ? p : null;
      if (!key) return true;
      return slots.some((slot) => {
        const fb = slot.freeByPitch;
        return fb ? (fb[key].length > 0) : (slot.freeIndoorNets.length > 0);
      });
    };

    // Pitch — re-evaluate when the option set changes OR when the
    // current pick now has zero availability across the day.
    if (pitchOptions.length > 0) {
      const currentIsValid = pitchType && pitchOptions.includes(pitchType);
      const currentHasCapacity = currentIsValid && pitchHasAnyFreeSlot(pitchType!);
      if (!currentIsValid || !currentHasCapacity) {
        const withCapacity = pitchOptions.find((p) => pitchHasAnyFreeSlot(p));
        setPitchType(withCapacity ?? pitchOptions[0]);
      }
    } else if (pitchOptions.length === 0 && pitchType !== null) {
      setPitchType(null);
    }
    // Ball — same default-first story (only relevant for MACHINE).
    if (ballOptions.length > 0 && (!ballType || !ballOptions.includes(ballType))) {
      setBallType(ballOptions[0]);
    } else if (ballOptions.length === 0 && ballType !== null) {
      setBallType(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, machineId, machines, data?.sidearmPitchTypes, data?.netPitchTypes, data?.coachingPitchTypes, data?.slots]);

  // Default-select the first coach / sidearm staff for those tabs.
  // Auto-assign happens server-side too, but the UI shows the first
  // free coach as already-picked so the booking bar reflects who
  // they're getting.
  useEffect(() => {
    if (category !== 'COACHING') {
      if (coachId !== null) setCoachId(null);
      return;
    }
    const coaches = data?.slots[0]?.freeCoaches ?? [];
    if (coaches.length > 0 && (!coachId || !coaches.some((c) => c.userId === coachId))) {
      setCoachId(coaches[0].userId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, data?.slots]);

  useEffect(() => {
    if (category !== 'SIDEARM') {
      if (staffId !== null) setStaffId(null);
      return;
    }
    const staff = data?.slots[0]?.freeSidearmStaff ?? [];
    if (staff.length > 0 && (!staffId || !staff.some((s) => s.userId === staffId))) {
      setStaffId(staff[0].userId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, data?.slots]);

  // Reset selected slots when date changes (availability is per-date)
  useEffect(() => { setSelectedSlots([]); }, [selectedDate]);

  // If the current category isn't in the admin's enabled list, snap to
  // the first enabled one. Keeps the picker honest after an admin
  // disables a category mid-session.
  useEffect(() => {
    if (!data?.enabledCategories?.length) return;
    if (!data.enabledCategories.includes(category)) {
      setCategory(data.enabledCategories[0]);
    }
  }, [data?.enabledCategories, category]);

  // Fetch the user's active packages once per center. Used by the
  // package-redemption picker further down; gracefully no-ops on
  // unauthenticated users (the API returns 401).
  useEffect(() => {
    if (!currentCenter || !session?.user) {
      setMyPackages([]);
      return;
    }
    api
      .get<MyPackageLite[]>(`/api/packages/my`)
      .then((res) => {
        if (Array.isArray(res)) setMyPackages(res);
      })
      .catch(() => {/* non-critical; user simply can't redeem */});
    // We intentionally don't depend on MyPackageLite (it's a local interface)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCenter?.id, session?.user]);

  // Fetch availability whenever date / center changes
  useEffect(() => {
    if (!currentCenter) return;
    setLoading(true);
    setError(null);
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    api
      .get<ResourceAvailabilityResponse>(`/api/slots/resource-availability?date=${dateStr}`)
      .then((res) => setData(res))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load slots'))
      .finally(() => setLoading(false));
  }, [selectedDate, currentCenter]);

  // Fetch machines once per center (used for the MACHINE category picker).
  // Uses the public `/api/centers/[id]/machines` endpoint — the admin one
  // is super-admin gated and would 403 for regular users.
  useEffect(() => {
    if (!currentCenter) return;
    setMachinesLoading(true);
    fetch(`/api/centers/${currentCenter.id}/machines`)
      .then((r) => r.ok ? r.json() : [])
      .then((rows: MachineLite[]) => setMachines(rows.filter((m) => m.isActive)))
      .catch(() => setMachines([]))
      .finally(() => setMachinesLoading(false));
  }, [currentCenter]);

  // Auto-select the first active machine when the user lands on the
  // MACHINE tab — saves the "tap any machine to continue" extra step.
  // Re-runs when the category becomes MACHINE again, the machine list
  // changes (e.g. center switch), or the previously-picked machine
  // disappears from the list. Single-machine centers stay pinned to
  // that one row by definition.
  useEffect(() => {
    if (category !== 'MACHINE') return;
    if (machines.length === 0) return;
    if (machineId && machines.some((m) => m.id === machineId)) return;
    setMachineId(machines[0].id);
  }, [category, machines, machineId]);

  // Per-slot bookability under the current category
  const slotIsBookable = (s: ResourceSlot, cat: Category): { ok: boolean; reason?: string } => {
    // Admin blocks — check before per-category capacity so the grid
    // greys out blocked slots up front (without this, the user could
    // tap a slot, get into the booking flow, and only see the 409
    // "Slot blocked" error at submit).
    //
    // Pitch-aware check: use the per-pitch blocked lists when a pitch
    // is selected, otherwise fallback to global sets.
    let blockedCats = s.blockedCategories ?? [];
    let blockedRows = s.blockedMachineRowIds ?? [];

    if (pitchType && s.blockedByPitch?.[pitchType]) {
      const perPitch = s.blockedByPitch[pitchType];
      blockedCats = perPitch.categories;
      blockedRows = perPitch.machineRowIds;
    }

    if (blockedCats.includes(cat)) {
      return { ok: false, reason: 'Slot blocked by admin' };
    }
    if (cat === 'MACHINE' && machineId && blockedRows.includes(machineId)) {
      return { ok: false, reason: 'This machine is blocked for this slot' };
    }

    // Helper: free pool for the user's currently-picked pitch. Slot
    // availability mirrors the picked pitch so the grid says exactly
    // what the booking endpoint will accept. Auto-switch effect lower
    // down moves the pitch chip itself to a pool with capacity, so the
    // user doesn't get stranded on a full pitch.
    const poolForPicked = (): { pool: ResourceLite[] | NetLite[]; usedFallback: boolean } => {
      if (pitchType && s.freeByPitch) {
        return { pool: s.freeByPitch[pitchType as 'ASTRO' | 'CEMENT' | 'NATURAL'] ?? [], usedFallback: false };
      }
      return { pool: s.freeIndoorNets, usedFallback: true };
    };
    const reasonForEmptyPool = (): string => {
      if (pitchType === 'NATURAL') return 'All natural turf wickets are taken';
      if (pitchType === 'CEMENT') return 'All cement wickets are taken';
      return 'All nets are taken at this slot';
    };

    if (cat === 'MACHINE') {
      // Selected machine itself busy? If yes, the slot is unbookable for
      // this user regardless of what nets / operators look like. Without
      // this check the grid could read "Open" and the server would 409
      // at submit. The user can switch to a different machine and the
      // grid will re-evaluate.
      if (machineId && (s.busyMachineIds ?? []).includes(machineId)) {
        return { ok: false, reason: 'This machine is already booked at this slot' };
      }
      // Slot availability mirrors the *picked* pitch's pool. ASTRO eats
      // indoor net capacity, CEMENT eats cement-wicket capacity,
      // NATURAL eats outdoor turf-wicket capacity — each pool is
      // independent. If the user has picked ASTRO and indoor is full,
      // the slot greys out even when natural turf still has capacity;
      // the auto-switch effect further down moves the chip selection
      // to the next available pitch when it can, so the picker doesn't
      // strand the user.
      const { pool } = poolForPicked();
      if (!pool || pool.length === 0) {
        return { ok: false, reason: reasonForEmptyPool() };
      }
      // Operator gating — only for non-tennis (leather) machines. Tennis
      // machines can self-operate, so a busy operator pool doesn't block
      // them. Mirrors ABCA's behaviour in /api/slots/available:360-377 —
      // leather goes to OperatorUnavailable, tennis falls back to
      // self-operate. The source of truth is the machine type's
      // ballType — relying on the code string would silently miss any
      // future Tennis machine added with a different code than
      // 'LEVERAGE'.
      //
      // Two operator-unavailability paths to cover:
      //   1. Admin marked operators unavailable for this window
      //      (date override or schedule sets count to 0).
      //      → s.selfOperate === true, s.operatorAvailable === true.
      //      Tennis machines fall back to self-operate; leather
      //      machines need an operator who isn't there — Not Available.
      //   2. Operators scheduled but every one is already booked.
      //      → s.operatorAvailable === false.
      //      Same rule: tennis self-operates, leather greys out.
      const selectedMachine = machineId ? filteredMachines.find((m) => m.id === machineId) : null;
      const isTennisMachine = selectedMachine?.machineType?.ballType === 'TENNIS';
      if (!isTennisMachine) {
        // Leather machines always need an operator. A center configured
        // for self-operate (operatorCount = 0) leaves leather machines
        // unbookable for the window — the machine can't run itself.
        if (s.selfOperate === true) {
          return { ok: false, reason: 'Operator unavailable — this machine requires an operator' };
        }
        if (s.operatorAvailable === false) {
          return { ok: false, reason: 'All operators are booked for this slot' };
        }
      }
      return { ok: true };
    }
    if (cat === 'SIDEARM') {
      if (s.freeSidearmStaff.length === 0) return { ok: false, reason: 'No sidearm specialist free' };
      if (staffId && !s.freeSidearmStaff.some((p) => p.userId === staffId)) {
        return { ok: false, reason: 'Selected specialist is busy in this slot' };
      }
      const { pool } = poolForPicked();
      if (!pool || pool.length === 0) return { ok: false, reason: reasonForEmptyPool() };
      return { ok: true };
    }
    if (cat === 'COACHING') {
      if (s.freeCoaches.length === 0) return { ok: false, reason: 'No coaches free' };
      if (coachId && !s.freeCoaches.some((p) => p.userId === coachId)) {
        return { ok: false, reason: 'Selected coach is busy in this slot' };
      }
      const { pool } = poolForPicked();
      if (!pool || pool.length === 0) return { ok: false, reason: reasonForEmptyPool() };
      return { ok: true };
    }
    if (cat === 'FULL_COURT') {
      if (!s.fullCourtAvailable) {
        return {
          ok: false,
          reason: s.corporateBatchHolds > 0 ? 'Corporate batch holds the indoor pool' : 'Not Available',
        };
      }
      return { ok: true };
    }
    if (cat === 'NET') {
      // Picked-pitch availability. Auto-switch effect ensures the
      // chip lands on a pitch with capacity at the visible slots,
      // so the slot grid stays accurate to whatever the user actually
      // intends to book.
      const { pool } = poolForPicked();
      if (!pool || pool.length === 0) return { ok: false, reason: reasonForEmptyPool() };
      return { ok: true };
    }
    if (cat === 'CORPORATE_BATCH') {
      // The engine claims `corporateBatchHolds` nets at booking time,
      // so a slot is only bookable when at least one indoor net is free
      // beyond what the policy already reserves.
      if (s.freeIndoorNets.length === 0) {
        return { ok: false, reason: 'No indoor nets free' };
      }
      return { ok: true };
    }
    return { ok: false };
  };

  /**
   * Final ₹ for this slot, mirroring the server cascade in
   * lib/resource-pricing.ts → getResourceSlotPrice. Walks from most-
   * specific override (machine × pitch × ball) down to category default.
   * Falls back to the per-slot base price when the config payload is
   * missing (e.g. older API response).
   */
  /** Pick a number from a single-or-pair rate. Consecutive flag is
   *  computed by the caller from the user's slot selection.
   *  `consecutive` stores the TOTAL for a 2-slot pair (ABCA convention,
   *  matches the admin editor's "2 Cons." input), so per-slot in a
   *  chain is `consecutive / 2`. Mirrors `pickRate` server-side. */
  const pickClientRate = (
    r: ClientSlabRate | number | undefined,
    isConsecutive: boolean,
  ): number | null => {
    if (r == null) return null;
    if (typeof r === 'number') return r;
    if (typeof r === 'object') {
      if (isConsecutive) {
        // Mirror the server's `pickRate` semantics: when the admin
        // left `consecutive` blank / zero, treat that as "no
        // consecutive discount configured" and fall back to the
        // per-slot single price instead of returning 0 (which would
        // make back-to-back bookings free).
        if (typeof r.consecutive === 'number' && r.consecutive > 0) {
          return r.consecutive / 2;
        }
        return typeof r.single === 'number' && r.single > 0 ? r.single : null;
      }
      return typeof r.single === 'number' ? r.single : null;
    }
    return null;
  };

  /** True if this slot is part of a chain of back-to-back selected
   *  slots — same rule the server uses to pick the consecutive
   *  rate. Single-slot bookings are always non-consecutive. */
  const isSlotConsecutive = (s: ResourceSlot): boolean => {
    if (selectedSlots.length < 2) return false;
    const sStart = new Date(s.startTime).getTime();
    const sEnd = new Date(s.endTime).getTime();
    return selectedSlots.some((other) => {
      if (other.startTime === s.startTime) return false;
      const oStart = new Date(other.startTime).getTime();
      const oEnd = new Date(other.endTime).getTime();
      return sStart === oEnd || sEnd === oStart;
    });
  };

  // NOTE: declared BEFORE `slotPriceFor` and `totalPrice` because both
  // close over `filteredMachines`. Moving it down triggers a temporal-
  // dead-zone crash ("Cannot access … before initialization") whenever
  // the totalPrice useMemo runs on a render where selectedSlots is
  // already populated — minified production builds report this as a
  // mangled identifier (e.g. "Cannot access 'ee' before initialization").
  const filteredMachines = useMemo(() => {
    // Phase 5b doesn't filter by ball type; the engine accepts any active machine.
    return machines;
  }, [machines]);

  /** Server-computed discount preview for this slot under the active
   *  category. Returns null when no recurring or promotional offer
   *  applies. The slot card uses this to render a "₹X off" badge and
   *  `slotPriceFor` subtracts it from the displayed price so the user
   *  sees what they'll actually pay (server recomputes on book).
   *
   *  For MACHINE bookings, prefer the per-machine discount entry
   *  (s.machineDiscounts[machineId]) so machine-row-pinned offers
   *  reflect in the card. Falls back to the category-level bucket
   *  when no per-machine entry exists. */
  const discountFor = (s: ResourceSlot): {
    amount: number;
    promoName: string | null;
  } | null => {
    if (category === 'MACHINE' && machineId) {
      const mDisc = s.machineDiscounts?.[machineId];
      if (mDisc && mDisc.total > 0) {
        return { amount: mDisc.total, promoName: mDisc.promoName };
      }
    }
    const d = s.discountsByCategory?.[category];
    if (!d || d.total <= 0) return null;
    return { amount: d.total, promoName: d.promoName };
  };

  /** Shared backend — picks the right rate against the prefetched
   *  pricingConfig. `consecutive=true` selects the pair rate when
   *  available. Declared first so the two thin wrappers below can
   *  close over it without hitting a temporal-dead-zone error in
   *  minified production builds (see the comment further up about
   *  `filteredMachines` for the same pattern). */
  const slotPriceWithConsecutive = (s: ResourceSlot, consecutive: boolean): number => {
    const slab = s.timeSlab;
    const cfg = data?.pricingConfig;

    if (!cfg) return s.prices[category] || 0;

    if (category === 'MACHINE' && machineId) {
      // Most-specific axis first: per-Machine-row pair pricing.
      if (pitchType && ballType) {
        const v = cfg.machineRowPricing?.[machineId]?.[pitchType]?.[ballType];
        const r = pickClientRate(v?.[slab], consecutive);
        if (r != null) return r;
      }
      if (pitchType) {
        const v = cfg.machineRowPricing?.[machineId]?.[pitchType]?.['*'];
        const r = pickClientRate(v?.[slab], consecutive);
        if (r != null) return r;
      }

      const machine = filteredMachines.find((m) => m.id === machineId);
      const code = machine?.machineType.code;
      if (code) {
        if (pitchType && ballType) {
          const v = cfg.machinePricing?.[code]?.[pitchType]?.[ballType];
          if (v && v[slab] != null) return v[slab];
        }
        if (pitchType) {
          const v = cfg.machinePricing?.[code]?.[pitchType]?.['*'];
          if (v && v[slab] != null) return v[slab];
        }
        const legacy = cfg.machineTypeOverrides?.[code];
        if (legacy && legacy[slab] != null) return legacy[slab];
      }
      return cfg.categoryRates.MACHINE?.[slab] ?? s.prices.MACHINE;
    }

    if (category === 'SIDEARM' && pitchType) {
      // SIDEARM / NET pricing is now pair-shaped per pitch (single +
      // consecutive). Run the pair through pickClientRate so the
      // consecutive total / 2 gets used in a back-to-back chain;
      // reading v[slab] directly would return the {single,consecutive}
      // object and render '[object Object]' in the bottom bar.
      const v = cfg.sidearmPricing?.[pitchType];
      const r = pickClientRate(v?.[slab], consecutive);
      if (r != null) return r;
    }
    if (category === 'NET' && pitchType) {
      const v = cfg.netPricing?.[pitchType];
      const r = pickClientRate(v?.[slab], consecutive);
      if (r != null) return r;
    }

    return cfg.categoryRates[category]?.[slab] ?? s.prices[category] ?? 0;
  };

  /** Per-slot price WITH consecutive rate applied. Used by the totalPrice
   *  aggregate (bar) so back-to-back chains pay the pair rate. */
  const slotBaseFor = (s: ResourceSlot): number => {
    return slotPriceWithConsecutive(s, isSlotConsecutive(s));
  };

  /** Always-single per-slot price for the card. Independent of how many
   *  slots are currently in the cart, so the displayed per-slot ₹
   *  doesn't shift when the user adds a second back-to-back slot. The
   *  consecutive savings get surfaced as "Save ₹X" on the booking bar
   *  instead — matches ABCA's getSlotDisplayPrice. */
  const slotSinglePriceFor = (s: ResourceSlot): number => {
    return slotPriceWithConsecutive(s, false);
  };

  /** Final ₹ for this slot after applying recurring + promo discounts. */
  const slotPriceFor = (s: ResourceSlot): number => {
    const base = slotBaseFor(s);
    const disc = discountFor(s);
    if (!disc) return base;
    return Math.max(0, base - disc.amount);
  };

  /** Whether the active package covers every selected slot (consumes
   *  one session per slot). If so, totalPrice drops to 0 and the
   *  Razorpay/cash/wallet flow is skipped — the booking POSTs directly
   *  with userPackageId. */
  const packageCoversBooking = !!selectedPackage
    && selectedSlots.length > 0
    && selectedPackage.remainingSessions >= selectedSlots.length;

  // ─── Kit rental availability + total ─────────────────────────────
  // RESOURCE_BASED centers (Toplay) store per-Machine-row config in
  // `kitRentalConfig.machineRowConfigs` — each machine has its own
  // enabled toggle + price. Falls back to the legacy global
  // enabled/price for any machine without an explicit override.
  const kitRentalCfg = paymentConfig?.kitRentalConfig;
  const selectedMachineForKit = machineId
    ? filteredMachines.find((m) => m.id === machineId)
    : null;
  // Lookup the picked machine's row-specific kit config; null when no
  // override exists.
  const machineRowKitCfg = machineId
    ? kitRentalCfg?.machineRowConfigs?.[machineId] ?? null
    : null;
  // Effective per-slot price: row override → global default.
  const kitRentalCharge = machineRowKitCfg?.price ?? kitRentalCfg?.price ?? 200;
  // Kit rental is available only when:
  //   - the overall center-level toggle is on, AND
  //   - the picked machine has either (a) an explicit override with
  //     `enabled: true`, or (b) no override AND it's a leather-ball
  //     machine (the legacy default for which kits make sense).
  const kitRentalGlobalEnabled = kitRentalCfg?.enabled ?? false;
  const isLeatherMachine = selectedMachineForKit?.machineType?.ballType === 'LEATHER';
  const machineKitEnabled = machineRowKitCfg
    ? machineRowKitCfg.enabled
    : isLeatherMachine; // no explicit override → leather default
  const isKitRentalAvailable =
    kitRentalGlobalEnabled
    && category === 'MACHINE'
    && !!machineId
    && machineKitEnabled;
  const kitRentalTotal =
    kitRental && isKitRentalAvailable ? kitRentalCharge * selectedSlots.length : 0;

  // Drop the kit-rental toggle whenever the user lands somewhere it no
  // longer applies (changed category, picked a tennis machine, etc.)
  // so the total can't drift out of sync with the visible checkbox.
  useEffect(() => {
    if (!isKitRentalAvailable && kitRental) {
      setKitRental(false);
    }
  }, [isKitRentalAvailable, kitRental]);

  const totalPrice = useMemo(() => {
    // Package covers the booking → user only pays the timing /
    // upgrade extra (₹0 when the package matches the slot's slab).
    // Without this, a DAY package booking an evening slot would
    // appear free here but be charged at the server, which would be
    // a nasty surprise. Mirrors ABCA's BookingBar logic that uses
    // `validation.extraCharge` as the displayed total when a package
    // is selected.
    if (packageCoversBooking) {
      return packageValidation?.valid ? (packageValidation.extraCharge || 0) : 0;
    }
    return selectedSlots.reduce((sum, s) => sum + slotPriceFor(s), 0);
    // slotPriceFor depends on every selection that affects the cascade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlots, category, machineId, pitchType, ballType, data?.pricingConfig, packageCoversBooking, packageValidation]);

  /** Sum of SINGLE-slot rates — what the user would've paid if every
   *  slot were billed independently (no consecutive pair pricing, no
   *  recurring offer, no promo). The booking bar renders this struck-
   *  through next to the actual total so the user can see the full
   *  "Save ₹X" — same convention as ABCA's BookingBar. */
  const originalTotal = useMemo(() => {
    if (packageCoversBooking) return 0;
    return selectedSlots.reduce((sum, s) => sum + slotSinglePriceFor(s), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlots, category, machineId, pitchType, ballType, data?.pricingConfig, packageCoversBooking]);

  /** Aggregate per-slot discount preview into two buckets for the
   *  booking-bar breakdown. promoLabel uses the first non-null
   *  promoName encountered so the user sees a real offer name when
   *  one is in play. */
  const discountBreakdown = useMemo(() => {
    let recurring = 0;
    let promo = 0;
    let promoLabel: string | null = null;
    for (const s of selectedSlots) {
      // For MACHINE bookings with a picked machine, the per-machine
      // bucket wins so machine-row-pinned offers count toward the
      // bottom-bar Save line. Falls back to the category bucket when
      // no per-machine entry exists.
      const d = category === 'MACHINE' && machineId
        ? (s.machineDiscounts?.[machineId] ?? s.discountsByCategory?.[category])
        : s.discountsByCategory?.[category];
      if (!d) continue;
      recurring += d.recurring || 0;
      promo += d.promo || 0;
      if (!promoLabel && d.promoName) promoLabel = d.promoName;
    }
    return { recurring, promo, promoLabel };
  }, [selectedSlots, category, machineId]);
  const totalSavings = originalTotal - totalPrice;

  const toggleSlot = (slot: ResourceSlot) => {
    const idx = selectedSlots.findIndex((s) => s.startTime === slot.startTime);
    if (idx >= 0) {
      setSelectedSlots((prev) => prev.filter((_, i) => i !== idx));
    } else {
      setSelectedSlots((prev) => [...prev, slot].sort((a, b) => a.startTime.localeCompare(b.startTime)));
    }
  };

  const submit = async () => {
    if (selectedSlots.length === 0) return;
    if (category === 'MACHINE' && !machineId) {
      toast.error('Select a machine first');
      return;
    }
    // Pitch/ball type are required only when the chip row has more than
    // one option. Single-option rows auto-select.
    if (category === 'MACHINE' && machineId) {
      const m = filteredMachines.find((x) => x.id === machineId);
      if (m && m.effectivePitchTypes.length > 1 && !pitchType) {
        toast.error('Select a pitch type');
        return;
      }
      if (m && m.effectiveBallTypes.length > 1 && !ballType) {
        toast.error('Select a ball type');
        return;
      }
    }
    if (category === 'SIDEARM' && data && data.sidearmPitchTypes.length > 1 && !pitchType) {
      toast.error('Select a pitch type');
      return;
    }
    if (category === 'NET' && data && data.netPitchTypes.length > 1 && !pitchType) {
      toast.error('Select a pitch type');
      return;
    }
    if (category === 'COACHING' && !coachId) {
      // Allowed — engine picks the first free coach if not pinned. But UX
      // is better if user explicitly chose. We'll let it through.
    }

    setSubmitting(true);
    try {
      // Pitch type is meaningful for MACHINE / SIDEARM / NET. Ball type
      // only for MACHINE (the others don't use a bowling machine).
      const wantsPitch = category === 'MACHINE' || category === 'SIDEARM' || category === 'NET';

      // Resolve payment intent. Three terminal paths, mutually exclusive:
      //   - walletCoversAll → POST direct with paymentMethod=WALLET
      //   - CASH (pay at center) → POST direct with paymentMethod=CASH
      //   - else → Razorpay flow (with optional partial wallet debit
      //     applied server-side after capture)
      const isCashPayment = paymentMethod === 'CASH';
      // Kit rental sits on top of the slot total; the wallet can be
      // used against the combined amount, and the Razorpay capture
      // (when needed) covers whatever the wallet doesn't.
      const grandTotal = totalPrice + kitRentalTotal;
      const walletDeduction = useWallet && walletBalance > 0
        ? Math.min(walletBalance, grandTotal)
        : 0;
      const amountAfterWallet = Math.max(0, grandTotal - walletDeduction);
      const walletCoversAll =
        !isFreeBooking && walletDeduction > 0 && amountAfterWallet === 0;

      const body: Record<string, unknown> = {
        slots: selectedSlots.map((s) => ({
          date: data!.date,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
        category,
        playerName: session?.user?.name || 'Player',
        machineId: category === 'MACHINE' ? machineId : undefined,
        pitchType: wantsPitch ? pitchType : undefined,
        ballType: category === 'MACHINE' ? ballType : undefined,
        coachId: category === 'COACHING' ? coachId : undefined,
        staffId: category === 'SIDEARM' ? staffId : undefined,
        // Package redemption — server validates the package belongs to
        // the user, is at this center, active, has enough sessions, and
        // matches the booking's category + pinned machine row.
        ...(packageCoversBooking && selectedPackageId
          ? { userPackageId: selectedPackageId }
          : {}),
        // Kit rental — only sent when both available and toggled on
        // for this booking. Server reads the same KIT_RENTAL_CONFIG
        // policy and persists per-slot.
        ...(kitRental && isKitRentalAvailable
          ? { kitRental: true, kitRentalCharge }
          : {}),
        // Operation mode — only meaningful for MACHINE bookings.
        // Leather machines always WITH_OPERATOR (server enforces);
        // tennis machines honour the user's pick.
        ...(category === 'MACHINE'
          ? { operationMode }
          : {}),
        ...(walletCoversAll
          ? { paymentMethod: 'WALLET' as const, walletDeduction }
          : isCashPayment
            ? { paymentMethod: 'CASH' as const, ...(walletDeduction > 0 ? { walletDeduction } : {}) }
            : walletDeduction > 0
              ? { walletDeduction }
              : {}),
      };

      // Route through Razorpay when the center has the payment gateway
      // on AND slot payment is required AND the wallet doesn't cover
      // the full amount AND the user isn't paying at center. Free/super-
      // admin users always skip Razorpay. Zero-price bookings too.
      const requiresOnlinePayment =
        !!paymentConfig?.paymentEnabled &&
        !!paymentConfig?.slotPaymentRequired &&
        !isFreeBooking &&
        !isCashPayment &&
        !walletCoversAll &&
        amountAfterWallet > 0;

      if (requiresOnlinePayment) {
        const categoryLabel = CATEGORIES.find((c) => c.key === category)?.label ?? category;
        const paymentResult = await initiatePayment({
          type: 'SLOT_BOOKING',
          amount: amountAfterWallet,
          slots: body.slots as Array<{ date: string; startTime: string; endTime: string }>,
          walletDeduction: walletDeduction > 0 ? walletDeduction : undefined,
          // Verify route parses bookingPayload[0] against
          // ResourceBookingBodySchema and calls executeResourceBooking,
          // so the bookings are created atomically post-capture. The
          // wallet portion (if any) is debited server-side after the
          // bookings commit.
          bookingPayload: [body],
          description: `${selectedSlots.length} slot(s) · ${categoryLabel} · ${format(selectedDate, 'MMM d')}`,
          prefill: {
            name: session?.user?.name || undefined,
            email: session?.user?.email || undefined,
          },
        });

        if (!paymentResult) {
          // User cancelled or payment failed (error already surfaced by hook).
          return;
        }

        if (!paymentResult.bookings || paymentResult.bookings.length === 0) {
          // Payment captured but the server didn't return any bookings —
          // we used to say "Booking confirmed" here, which is a lie. Show
          // a clear error so the user knows to contact admin (the server
          // also flagged the payment for recovery).
          toast.error(
            'Payment captured but no booking was created. Our team has been notified. Please contact admin.',
          );
          return;
        }

        toast.success(
          `Payment successful! Booked ${paymentResult.bookings.length} slot${paymentResult.bookings.length === 1 ? '' : 's'}.`,
        );
        router.push('/bookings');
        return;
      }

      const res = await api.post<{ bookings: { id: string }[] }>('/api/slots/book-resource', body);
      toast.success(
        isCashPayment
          ? walletDeduction > 0
            ? `Booking confirmed! ₹${walletDeduction} from wallet. Pay ₹${amountAfterWallet} at center.`
            : 'Booking confirmed! Pay at center when you arrive.'
          : walletCoversAll
            ? 'Booking confirmed! Payment deducted from wallet.'
            : `Booked ${res.bookings.length} slot${res.bookings.length === 1 ? '' : 's'}`,
      );
      router.push('/bookings');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Booking failed';
      toast.error(msg);
    } finally {
      setSubmitting(false);
      setShowConfirm(false);
    }
  };

  // ABCA's BookingBar shows "<Category> · <secondary>" as the label —
  // mirror that here so the sticky bar reads consistently. Declared
  // above the early `!currentCenter` return so the hook order stays
  // stable across renders (react-hooks/rules-of-hooks).
  const machineLabel = useMemo(() => {
    const cat = CATEGORIES.find((c) => c.key === category);
    const baseLabel = cat?.label ?? category;
    if (category === 'MACHINE' && machineId) {
      const m = filteredMachines.find((x) => x.id === machineId);
      const parts = [m?.name];
      if (ballType) parts.push(BALL_TYPE_LABELS[ballType]);
      if (pitchType) parts.push(PITCH_TYPE_LABELS[pitchType]);
      return `${baseLabel} · ${parts.filter(Boolean).join(' / ')}`;
    }
    if ((category === 'SIDEARM' || category === 'NET') && pitchType) {
      return `${baseLabel} · ${PITCH_TYPE_LABELS[pitchType]}`;
    }
    return baseLabel;
  }, [category, machineId, filteredMachines, ballType, pitchType]);

  if (!currentCenter) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-5 pb-40 md:pb-28">
      <PageBackground />

      {/* Page header — same calendar-icon header as ABCA's /slots */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-accent/10 flex items-center justify-center">
          <Calendar className="w-4 h-4 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">Book Your Slot</h1>
          <p className="text-[11px] text-slate-400">Select session, date & time</p>
        </div>
      </div>

      {/* Category tabs — styled like ABCA's OptionsPanel toggles
          (`flex-1` accent-solid pills) but in a 2/3-col grid because we
          have up to six categories. */}
      <div className="mb-4">
        <label className="block text-[10px] font-medium text-accent mb-1 uppercase tracking-wider">
          Booking Category
        </label>
        {/* Session category tiles. Icon + label are left-aligned so the
            row reads like a list of options, not a row of centered
            chips — admins specifically asked for the icon-left layout
            so Bowling Machine / Cricket Nets / Full Indoor Court /
            Sidearm have a visual anchor on the left, with the name
            text aligned underneath each other. */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
          {CATEGORIES.filter(
            ({ key }) => !data?.enabledCategories || data.enabledCategories.includes(key),
          ).map(({ key, label, icon: Icon }) => {
            const active = category === key;
            return (
              <button
                key={key}
                onClick={() => setCategory(key)}
                className={`flex items-center justify-start gap-2 px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all cursor-pointer min-w-0 text-left border ${
                  active
                    ? 'bg-accent text-primary border-accent shadow-sm'
                    : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-accent/20'
                }`}
              >
                <div className={`w-5 h-5 sm:w-6 sm:h-6 rounded-md flex items-center justify-center flex-shrink-0 ${
                  active ? 'bg-primary/15' : 'bg-white/[0.04]'
                }`}>
                  <Icon className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${active ? 'text-primary' : 'text-accent'}`} />
                </div>
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <hr className="border-white/[0.06] my-4" />

      {/* Machine picker — keeps richer pill-with-image layout (ABCA's
          MachineSelector also uses cards-with-images) but the chips line
          up with the same accent treatment. */}
      {category === 'MACHINE' && (
        <PickerRow label="Machine" required>
          {machinesLoading ? (
            <span className="text-xs text-slate-500 px-1">Loading…</span>
          ) : filteredMachines.length === 0 ? (
            <span className="text-xs text-amber-400">
              No machines configured at this center yet.
            </span>
          ) : (
            // Equal-width machine cards. The previous wrap-with-pills
            // layout produced uneven widths because each pill sized to
            // its content. A 2-column grid (single column on phone-
            // narrow) gives every machine the same footprint and lines
            // them up visually — admins specifically asked for this.
            <div
              className={`grid gap-1.5 ${
                filteredMachines.length === 1
                  ? 'grid-cols-1'
                  : filteredMachines.length === 3
                    ? 'grid-cols-3'
                    : filteredMachines.length === 4
                      ? 'grid-cols-4'
                      : filteredMachines.length > 4
                        ? 'grid-cols-2 sm:grid-cols-4'
                        : 'grid-cols-2'
              }`}
            >
              {filteredMachines.map((m) => {
                const active = machineId === m.id;
                const imageUrl = m.machineType.imageUrl;
                const ballLabel = m.machineType.ballType.charAt(0)
                  + m.machineType.ballType.slice(1).toLowerCase(); // 'LEATHER' → 'Leather'
                // Display name: prefer the machine row's own name
                // (e.g. 'Master 200') over the machine type name
                // (e.g. 'Leverage Tennis'). Falls back to the type
                // name when the row has no specific name set.
                const displayName = m.name || m.machineType.name;
                const surface = describeResourceType(m.resource?.type);
                return (
                  <button
                    key={m.id}
                    onClick={() => setMachineId(active ? null : m.id)}
                    className={`flex items-center gap-2 px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-lg text-[11px] sm:text-xs font-semibold border cursor-pointer transition-all min-w-0 text-left ${
                      active
                        ? 'bg-accent text-primary border-accent shadow-sm'
                        : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:border-accent/30'
                    }`}
                  >
                    {imageUrl ? (
                      <Image
                        src={imageUrl}
                        alt={displayName}
                        width={28}
                        height={28}
                        className="w-6 h-6 sm:w-7 sm:h-7 rounded-md object-cover bg-white/5 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-md bg-white/5 flex items-center justify-center flex-shrink-0">
                        <Settings2 className={`w-3.5 h-3.5 ${active ? 'text-primary/70' : 'text-slate-500'}`} />
                      </div>
                    )}
                    <span className="leading-tight text-left min-w-0 flex-1">
                      <span className="block truncate text-[11px]">
                        {displayName}
                      </span>
                      <span className={`block text-[10px] font-medium truncate ${active ? 'text-primary/70' : 'text-slate-500'}`}>
                        {ballLabel}{m.resource ? ` • ${m.resource.name}` : ''}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </PickerRow>
      )}

      {/* Pitch + ball — driven by per-machine effective lists. The
          center-wide BALL_TYPE_SELECTION_ENABLED /
          PITCH_TYPE_SELECTION_ENABLED policy toggles let admins
          collapse the picker even when the machine supports >1 value;
          the auto-select effect on machine change still picks the
          first option so bookings carry a concrete value. */}
      {category === 'MACHINE' && machineId && (() => {
        const m = filteredMachines.find((x) => x.id === machineId);
        if (!m) return null;
        const pitchOptions = m.effectivePitchTypes ?? m.supportedPitchTypes ?? [];
        const ballOptions = m.effectiveBallTypes ?? m.supportedBallTypes ?? [];
        const pitchPickerOn = paymentConfig?.pitchTypeSelectionEnabled !== false;
        const ballPickerOn = paymentConfig?.ballTypeSelectionEnabled !== false;
        return (
          <>
            {pitchPickerOn && pitchOptions.length > 0 && (
              <ChipSelector
                label="Pitch Type"
                required={pitchOptions.length > 1}
                options={pitchOptions.map((id) => ({ id, label: PITCH_TYPE_LABELS[id] }))}
                value={pitchType}
                onChange={(v) => setPitchType(v as PitchTypeId | null)}
              />
            )}
            {ballPickerOn && ballOptions.length > 0 && (
              <ChipSelector
                label="Ball Type"
                required={ballOptions.length > 1}
                options={ballOptions.map((id) => ({ id, label: BALL_TYPE_LABELS[id] }))}
                value={ballType}
                onChange={(v) => setBallType(v as BallTypeId | null)}
              />
            )}
            {/* Operation mode toggle — sits right after Pitch + Ball
                so the booking flow reads top-to-bottom: machine →
                pitch → ball → operation mode → slot grid. Tennis
                machines only; leather forces WITH_OPERATOR server-
                side. Previously rendered way down past the slot grid,
                which made admins miss it and complain that 'self
                operate isn't an option' — now it's visible before
                they ever scroll. */}
            {m.machineType?.ballType === 'TENNIS' && (
              <div className="mb-2.5">
                <label className="block text-[10px] font-medium text-accent mb-1 uppercase tracking-wider">
                  Operation Mode
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setOperationMode('WITH_OPERATOR')}
                    className={`flex-1 flex items-center justify-center gap-2 px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all cursor-pointer border min-w-0 text-center ${
                      operationMode === 'WITH_OPERATOR'
                        ? 'bg-accent text-primary border-accent shadow-sm'
                        : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-accent/20'
                    }`}
                  >
                    <span className="truncate">With Operator</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setOperationMode('SELF_OPERATE')}
                    className={`flex-1 flex items-center justify-center gap-2 px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all cursor-pointer border min-w-0 text-center ${
                      operationMode === 'SELF_OPERATE'
                        ? 'bg-accent text-primary border-accent shadow-sm'
                        : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-accent/20'
                    }`}
                  >
                    <span className="truncate">Self Operate</span>
                  </button>
                </div>
                {operationMode === 'SELF_OPERATE' && (
                  <p className="text-[11px] text-amber-400/80 mt-1.5 leading-relaxed">
                    No machine operator will be assigned. You&apos;ll need to operate the machine yourself — please be familiar with it before booking.
                  </p>
                )}
              </div>
            )}
          </>
        );
      })()}

      {category === 'SIDEARM'
        && paymentConfig?.pitchTypeSelectionEnabled !== false
        && (data?.sidearmPitchTypes?.length ?? 0) > 0 && (
        <ChipSelector
          label="Pitch Type"
          required={(data!.sidearmPitchTypes.length) > 1}
          options={data!.sidearmPitchTypes.map((id) => ({ id, label: PITCH_TYPE_LABELS[id] }))}
          value={pitchType}
          onChange={(v) => setPitchType(v as PitchTypeId | null)}
        />
      )}

      {category === 'NET'
        && paymentConfig?.pitchTypeSelectionEnabled !== false
        && (data?.netPitchTypes?.length ?? 0) > 0 && (
        <ChipSelector
          label="Pitch Type"
          required={(data!.netPitchTypes.length) > 1}
          options={data!.netPitchTypes.map((id) => ({ id, label: PITCH_TYPE_LABELS[id] }))}
          value={pitchType}
          onChange={(v) => setPitchType(v as PitchTypeId | null)}
        />
      )}

      {/* Coaching pitch picker — gated by COACHING_PITCH_TYPES policy
          set in Admin → Settings. Hidden when no pitches are
          configured for coaching (defaults to all three per pitch-
          config.ts). pitchTypeSelectionEnabled toggle also gates it
          for parity with sidearm/net. */}
      {category === 'COACHING'
        && paymentConfig?.pitchTypeSelectionEnabled !== false
        && ((data?.coachingPitchTypes?.length ?? data?.netPitchTypes?.length ?? 0) > 0) && (
        <ChipSelector
          label="Pitch Type"
          required={((data?.coachingPitchTypes ?? data?.netPitchTypes ?? []).length) > 1}
          options={(data?.coachingPitchTypes ?? data?.netPitchTypes ?? []).map((id) => ({ id, label: PITCH_TYPE_LABELS[id] }))}
          value={pitchType}
          onChange={(v) => setPitchType(v as PitchTypeId | null)}
        />
      )}

      {category === 'COACHING' && (
        <PeoplePicker
          label="Coach"
          options={(() => {
            const seen = new Set<string>();
            const all: PersonLite[] = [];
            data?.slots.forEach((s) => {
              s.freeCoaches.forEach((p) => {
                if (!seen.has(p.userId)) {
                  seen.add(p.userId);
                  all.push(p);
                }
              });
            });
            return all;
          })()}
          value={coachId}
          onChange={setCoachId}
          emptyMessage="No coaches free for the selected slots."
        />
      )}

      {category === 'SIDEARM' && (
        <PeoplePicker
          label="Sidearm Specialist"
          options={(() => {
            const seen = new Set<string>();
            const all: PersonLite[] = [];
            data?.slots.forEach((s) => {
              s.freeSidearmStaff.forEach((p) => {
                if (!seen.has(p.userId)) {
                  seen.add(p.userId);
                  all.push(p);
                }
              });
            });
            return all;
          })()}
          value={staffId}
          onChange={setStaffId}
          emptyMessage="No sidearm specialist free for the selected slots."
        />
      )}

      <DateSelector selectedDate={selectedDate} onSelect={setSelectedDate} />

      <hr className="border-white/[0.06] my-4" />

      {/* Slot grid — matches ABCA's SlotGrid look exactly:
          `grid-cols-2 sm:grid-cols-3 gap-2.5`, `p-3.5 rounded-xl`, big
          start time + small "to <end>" line + uppercase status row +
          right-aligned price. Selected slots flip to a solid accent
          background with a Check icon, exactly like the ABCA card. */}
      <div className="mb-5">
        <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
          Available Slots
        </label>
        {/* Package picker — only when the user has an active package
            compatible with the current category + machine selection.
            Mirrors ABCA's package redemption: tapping the chip routes
            the booking through `userPackageId`, zeros the bill, and
            consumes one session per slot on commit. */}
        {/* Package picker — mirrors ABCA's `PackageSelector`:
            a single dropdown with "Don't use a package (Direct Payment)"
            at the top, then each active package as an option. Picking
            an option routes the booking through `userPackageId`,
            zeros the bill (or surfaces the extra charge), and consumes
            one session per slot on commit. Auto-select is handled by
            the two effects above; choosing "Direct Payment" sets the
            `userDeclinedPackage` flag so we don't auto-select again. */}
        {eligiblePackages.length > 0 && (
          <div className="mb-4">
            <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
              Use a Package
            </label>
            <div className="relative">
              <select
                value={selectedPackageId ?? ''}
                onChange={(e) => {
                  const next = e.target.value;
                  setSelectedPackageId(next === '' ? null : next);
                  setUserDeclinedPackage(next === '');
                }}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-3 text-xs text-white outline-none focus:border-accent appearance-none transition-all truncate"
              >
                <option value="" className="bg-[#0f1d2f]">
                  Don&apos;t use a package (Direct Payment)
                </option>
                {eligiblePackages.map((p) => (
                  <option key={p.id} value={p.id} className="bg-[#0f1d2f]">
                    {p.packageName}{p.machineRowName ? ` (${p.machineRowName})` : ''} — {p.remainingSessions} session{p.remainingSessions === 1 ? '' : 's'} left
                  </option>
                ))}
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>

            {selectedPackage && (
              <div className="mt-3 p-3 rounded-xl bg-accent/5 border border-accent/20">
                <div className="flex items-center gap-2 mb-1">
                  <PackageIcon className="w-4 h-4 text-accent" />
                  <span className="text-xs font-bold text-accent">Package Selected</span>
                </div>

                {selectedSlots.length === 0 ? (
                  // No slots picked yet — just announce the package is
                  // armed. Validation can't run server-side without slot
                  // context, so this branch never hits the API.
                  <p className="text-[11px] text-slate-400">
                    {selectedPackage.remainingSessions} session{selectedPackage.remainingSessions === 1 ? '' : 's'} remaining. Pick slots below to redeem.
                  </p>
                ) : packageValidating ? (
                  <div className="flex items-center gap-2 text-[10px] text-slate-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Validating package rules...
                  </div>
                ) : packageValidation ? (
                  packageValidation.valid ? (
                    <div className="space-y-1">
                      <p className="text-[11px] text-green-400 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Valid for this booking. {selectedSlots.length} session{selectedSlots.length === 1 ? '' : 's'} will be deducted.
                      </p>
                      {packageValidation.extraCharge && packageValidation.extraCharge > 0 && (
                        <div className="mt-2 pt-2 border-t border-white/5">
                          <p className="text-[11px] font-bold text-amber-400">
                            Extra Charge: ₹{packageValidation.extraCharge}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {packageValidation.extraChargeType === 'TIMING'
                              ? 'Evening timing upgrade'
                              : packageValidation.extraChargeType === 'BALL_TYPE'
                                ? 'Leather ball upgrade'
                                : packageValidation.extraChargeType === 'WICKET_TYPE'
                                  ? 'Wicket type upgrade'
                                  : 'Booking upgrade'}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-red-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      {packageValidation.error || 'This package cannot be used for the current selection'}
                    </p>
                  )
                ) : packageCoversBooking ? (
                  // Validation hasn't resolved yet but the cart fits the
                  // package's session count — show optimistic green so the
                  // user isn't staring at a blank panel between renders.
                  <p className="text-[11px] text-green-400 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Valid for this booking. {selectedSlots.length} session{selectedSlots.length === 1 ? '' : 's'} will be deducted.
                  </p>
                ) : (
                  <p className="text-[11px] text-red-400 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" />
                    Not enough sessions ({selectedPackage.remainingSessions} left, {selectedSlots.length} selected).
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[88px] rounded-xl bg-white/[0.03] animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        ) : !data || data.slots.length === 0 ? (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
            <Calendar className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-xs text-slate-400">No slots available for this date</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {data.slots.map((slot) => {
              const bookable = slotIsBookable(slot, category);
              const selected = selectedSlots.some((s) => s.startTime === slot.startTime);
              // Slot card always shows the single-slot rate. Consecutive
              // savings + recurring/promo discounts get aggregated into
              // the booking bar at the bottom so per-card numbers don't
              // shift when the user picks a second back-to-back slot.
              // Mirrors ABCA's getSlotDisplayPrice which never applies
              // consecutive pricing on the card itself.
              const basePrice = slotSinglePriceFor(slot);
              const isUnavailable = !bookable.ok;

              // Self-operate state — drives the amber warning theme below
              // (matches ABCA SlotGrid). True when no operator will be
              // assigned to this booking: either operatorCount=0 at the
              // slot, or operators exist but are all busy AND the user
              // picked a tennis machine (LEVERAGE ballType). Leather
              // machines are never self-operate — they need an operator
              // who, when absent, makes the slot unavailable (gated
              // above in slotIsBookable).
              const sel = machineId ? filteredMachines.find((m) => m.id === machineId) : null;
              const isTennisMachine = sel?.machineType?.ballType === 'TENNIS';
              const isSelfOperate = !isUnavailable && category === 'MACHINE' && isTennisMachine && (
                slot.selfOperate === true
                || slot.operatorAvailable === false
              );

              const bgClass = isUnavailable
                ? 'bg-white/[0.02] border border-white/[0.05] cursor-not-allowed'
                : selected
                  ? 'bg-accent text-primary shadow-md shadow-accent/20 border border-accent'
                  : isSelfOperate
                    ? 'bg-amber-500/10 border border-amber-500/20 hover:border-amber-500/30 active:scale-[0.97]'
                    : 'bg-white/[0.04] border border-white/[0.08] hover:border-accent/40 active:scale-[0.97]';

              // "Blocked" is louder than "Not Available" — surface it so
              // the user knows the slot was specifically taken off the
              // schedule (vs. just being booked out).
              const isBlocked = isUnavailable && (
                (slot.blockedCategories ?? []).includes(category)
                || (category === 'MACHINE' && !!machineId && (slot.blockedMachineRowIds ?? []).includes(machineId))
              );
              const statusLabel = isBlocked
                ? 'Blocked'
                : isUnavailable
                  ? 'Not Available'
                  : selected
                    ? 'Selected'
                    : isSelfOperate
                      ? 'Self Operate'
                      : 'Open';
              const statusColor = isUnavailable
                ? 'text-red-400'
                : selected
                  ? 'text-primary/80'
                  : isSelfOperate
                    ? 'text-amber-400'
                    : 'text-green-400';
              return (
                <button
                  key={slot.startTime}
                  onClick={() => bookable.ok && toggleSlot(slot)}
                  disabled={isUnavailable || submitting}
                  className={`relative px-2.5 py-2 rounded-lg transition-all text-left cursor-pointer ${bgClass}`}
                  title={bookable.reason ?? (isSelfOperate ? 'You will run this machine yourself' : undefined)}
                >
                  {selected && (
                    <div className="absolute top-1.5 right-1.5">
                      <Check className="w-3.5 h-3.5" />
                    </div>
                  )}
                  {/* Warning triangle on self-operate slots (only when
                      not selected — the Check icon takes that spot once
                      the slot is in the cart). Matches ABCA's SlotGrid
                      visual cue. */}
                  {isSelfOperate && !selected && (
                    <div className="absolute top-1.5 right-1.5">
                      <AlertTriangle className="w-3 h-3 text-amber-500" />
                    </div>
                  )}

                  {/* Slot timing on a single line: '15:00 – 15:30'.
                      Previously the start and end times wrapped onto
                      two lines, which read awkwardly especially in
                      narrow grid columns. tabular-nums keeps the
                      digits aligned across slots; whitespace-nowrap
                      stops the en-dash + times from breaking. */}
                  <div className={`text-xs font-bold tabular-nums whitespace-nowrap ${
                    isUnavailable ? 'text-slate-600' : selected ? '' : 'text-white'
                  }`}>
                    {format(parseISO(slot.startTime), 'HH:mm')} – {format(parseISO(slot.endTime), 'HH:mm')}
                  </div>

                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-[9px] font-semibold uppercase tracking-wider ${statusColor}`}>
                      {statusLabel}
                    </span>
                    {!isUnavailable && (
                      <span className={`text-[9px] font-medium ${selected ? 'text-primary/70' : 'text-slate-400'}`}>
                        ₹{basePrice}
                      </span>
                    )}
                  </div>
                  {/* Surface the specific unavailable reason on the card
                      so users don't have to hover for the tooltip. Keeps
                      the existing "NOT AVAILABLE" / "BLOCKED" header. */}
                  {isUnavailable && bookable.reason && bookable.reason !== 'Not Available' && (
                    <div className="mt-1 text-[9px] text-slate-500 leading-snug line-clamp-2">
                      {bookable.reason}
                    </div>
                  )}

                  {slot.corporateBatchHolds > 0 && !isUnavailable && category !== 'FULL_COURT' && (
                    <div className={`mt-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full text-center ${
                      selected ? 'bg-primary/20 text-primary/80' : 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                    }`}>
                      Batch holds {slot.corporateBatchHolds} net{slot.corporateBatchHolds === 1 ? '' : 's'}
                    </div>
                  )}

                  {/* Recurring / promotional offer pill — shown when the
                      server-computed discount preview is non-zero for the
                      active category. Mirrors ABCA's SlotGrid which shows
                      "Extra ₹X off" on each qualifying slot card. Without
                      this badge, admins who configure a recurring or promo
                      offer can't see it's taking effect until they pick a
                      slot and look at the booking bar. */}
                  {!isUnavailable && (() => {
                    const disc = discountFor(slot);
                    if (!disc || disc.amount <= 0) return null;
                    return (
                      <div className={`mt-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full text-center ${
                        selected
                          ? 'bg-primary/20 text-primary/80'
                          : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                      }`}>
                        {disc.promoName ? `${disc.promoName}: ` : ''}₹{disc.amount} off
                      </div>
                    );
                  })()}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Operation Mode used to render here, after the slot grid. It
          was moved up to sit right below Pitch + Ball Type so the
          booking flow reads top-to-bottom without surprises. See the
          MACHINE picker block above. */}

      {/* Kit rental option (mirrors ABCA). Surfaces a checkbox card
          when the center has KIT_RENTAL_CONFIG enabled, the user is on
          the MACHINE category, and they've picked a leather-ball
          machine (the only kind kits make sense for). The charge gets
          added to the total and the booking row stores `kitRental` +
          `kitRentalCharge`. */}
      {isKitRentalAvailable && selectedSlots.length > 0 && (
        <div className="mb-4">
          <label className="flex items-start gap-3 p-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl cursor-pointer hover:bg-white/[0.06] transition-colors">
            <input
              type="checkbox"
              checked={kitRental}
              onChange={(e) => setKitRental(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-accent rounded"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white">
                {kitRentalCfg?.title || 'Cricket Kit & Bat Rental'}
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {kitRentalCfg?.description || 'Rent cricket kit and bat for your session'} at{' '}
                <span className="text-accent font-semibold">&#8377;{kitRentalCharge}/session</span>
              </p>
              {kitRentalCfg?.note && (
                <p className="text-[10px] text-amber-400/80 mt-1">Note: {kitRentalCfg.note}</p>
              )}
              {kitRental && selectedSlots.length > 0 && (
                <p className="text-[11px] text-accent font-medium mt-1">
                  +&#8377;{kitRentalTotal} ({selectedSlots.length} session{selectedSlots.length > 1 ? 's' : ''})
                </p>
              )}
            </div>
          </label>
        </div>
      )}

      {/* Payment method (online / cash / wallet). Same component ABCA uses
          so wallet behaviour is identical across centers. Rendered
          whenever any payment surface is on AND there's actually
          something to pay (slot price or kit rental on top of a
          package). A package that fully covers the booking with no
          kit rental skips this. */}
      {selectedSlots.length > 0
        && (
          (paymentConfig?.paymentEnabled && paymentConfig?.slotPaymentRequired)
          || paymentConfig?.cashPaymentEnabled
          || paymentConfig?.walletEnabled
        )
        && !isFreeBooking
        && totalPrice + kitRentalTotal > 0
        && (
          <div className="mb-4">
            <p className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">Payment</p>
            <PaymentMethodSelector
              selected={paymentMethod}
              onChange={setPaymentMethod}
              disabled={submitting || paymentProcessing}
              showOnline={!!(paymentConfig?.paymentEnabled && paymentConfig?.slotPaymentRequired)}
              showCash={paymentConfig?.cashPaymentEnabled}
              showWallet={paymentConfig?.walletEnabled}
              totalAmount={totalPrice + kitRentalTotal}
              useWallet={useWallet}
              onUseWalletChange={setUseWallet}
              onWalletBalanceLoaded={setWalletBalance}
            />
          </div>
        )}

      <ContactFooter />

      {(() => {
        const isCashPayment = paymentMethod === 'CASH';
        // Use grandTotal here too so the confirm dialog and the
        // submit path agree on what the user is paying.
        const dialogGrand = totalPrice + kitRentalTotal;
        const walletDeduction = useWallet && walletBalance > 0
          ? Math.min(walletBalance, dialogGrand)
          : 0;
        const amountAfterWallet = Math.max(0, dialogGrand - walletDeduction);
        const walletCoversAll =
          !isFreeBooking && walletDeduction > 0 && amountAfterWallet === 0;
        const requiresOnline =
          !!paymentConfig?.paymentEnabled
          && !!paymentConfig?.slotPaymentRequired
          && !isFreeBooking
          && !isCashPayment
          && !walletCoversAll
          && amountAfterWallet > 0;

        const lines = [
          `${CATEGORIES.find((c) => c.key === category)?.label} on ${format(selectedDate, 'EEE, dd MMM yyyy')}`,
          `Slots: ${selectedSlots.map((s) => formatTimeRangeIST(s.startTime, s.endTime)).join(', ')}`,
        ];
        if (kitRental && isKitRentalAvailable && kitRentalTotal > 0) {
          lines.push(`+ Kit rental: ₹${kitRentalTotal} (${selectedSlots.length} × ₹${kitRentalCharge})`);
        }
        if (isFreeBooking) {
          lines.push('Total: FREE');
        } else if (walletCoversAll) {
          lines.push(`Total: ₹${dialogGrand} (Wallet — ₹${walletDeduction} deducted)`);
        } else if (walletDeduction > 0 && isCashPayment) {
          lines.push(`₹${walletDeduction} from wallet · ₹${amountAfterWallet} at center`);
        } else if (walletDeduction > 0) {
          lines.push(`₹${walletDeduction} from wallet · ₹${amountAfterWallet} online`);
        } else if (isCashPayment) {
          lines.push(`Total: ₹${dialogGrand} (Pay at center)`);
        } else {
          lines.push(`Total: ₹${dialogGrand}`);
        }

        const confirmLabel = requiresOnline
          ? `Pay ₹${amountAfterWallet.toLocaleString()}`
          : walletCoversAll
            ? 'Confirm (Wallet)'
            : isCashPayment
              ? 'Confirm Booking'
              : 'Confirm Booking';

        return (
          <ConfirmDialog
            open={showConfirm}
            title="Confirm Booking"
            message={lines.join('\n')}
            confirmLabel={confirmLabel}
            cancelLabel="Go Back"
            onCancel={() => setShowConfirm(false)}
            onConfirm={submit}
            loading={submitting || paymentProcessing}
          />
        );
      })()}

      {/* Booking bar — same fixed position, dark glassy bar, IndianRupee
          accent price, slot count + date + label, Confirm button as
          ABCA's `BookingBar`. */}
      {selectedSlots.length > 0 && (
        <div className="fixed bottom-0 md:bottom-0 left-0 right-0 bg-[#0f1d2f]/95 backdrop-blur-md border-t border-white/[0.08] p-4 z-40 mb-[60px] md:mb-0 safe-bottom">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-white">
                {selectedSlots.length} slot{selectedSlots.length > 1 ? 's' : ''} selected
              </p>
              <p className="text-[11px] text-slate-400">
                {format(selectedDate, 'EEE, MMM d')} &middot; {machineLabel}
                {/* Show "Self Operate" inline next to the date when any
                    selected slot will run without an operator. Matches
                    ABCA's BookingBar subtitle treatment. */}
                {category === 'MACHINE' && selectedSlots.some((s) => {
                  const m = machineId ? filteredMachines.find((mm) => mm.id === machineId) : null;
                  const tennis = m?.machineType?.ballType === 'TENNIS';
                  // Only tennis machines self-operate. Leather selections
                  // are blocked upstream when no operator is free.
                  return tennis && (s.selfOperate === true || s.operatorAvailable === false);
                }) && (
                  <span> &middot; <span className="text-amber-400">Self Operate</span></span>
                )}
              </p>
              <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                {packageCoversBooking ? (
                  // Package redemption: server consumes one session per
                  // slot. If validation surfaced an extra charge
                  // (timing upgrade etc.), show it inline like ABCA's
                  // BookingBar does — "Extra: ₹X" — instead of the
                  // bare "Package redemption" label, so the user is
                  // never surprised at the payment step.
                  packageValidation?.valid && packageValidation.extraCharge && packageValidation.extraCharge > 0 ? (
                    <>
                      <IndianRupee className="w-3 h-3 text-amber-400" />
                      <span className="text-sm font-bold text-amber-400">
                        Extra: ₹{packageValidation.extraCharge.toLocaleString()}
                      </span>
                      <span className="text-[10px] text-purple-300 ml-1 uppercase tracking-wider truncate"
                        title={`Redeem ${selectedSlots.length} session(s) from "${selectedPackage?.packageName ?? ''}"`}>
                        from package
                      </span>
                    </>
                  ) : (
                    <span className="text-sm font-bold text-purple-300 uppercase tracking-wider truncate"
                      title={`Redeem ${selectedSlots.length} session(s) from "${selectedPackage?.packageName ?? ''}"`}>
                      Included in Package
                    </span>
                  )
                ) : isFreeBooking ? (
                  // Free booking (super admin or free user) — server zeroes
                  // out the price; show that here instead of the slot rate
                  // so the user isn't confused about whether they'll be
                  // charged. Mirrors ABCA's free-booking label.
                  <span className="text-sm font-bold text-emerald-400 uppercase tracking-wider">
                    Free booking
                  </span>
                ) : (
                  <>
                    <IndianRupee className="w-3 h-3 text-accent" />
                    {/* Main payable amount — kit rental folds into the
                        bottom-bar total so the displayed number always
                        matches what /api/slots/book-resource will charge.
                        Before this, the bar showed slots-only with a
                        "(incl. Kit: +X)" annotation, leaving users
                        wondering why the payment step charged more than
                        the bar indicated. */}
                    <span className="text-sm font-bold text-accent">
                      {(totalPrice + kitRentalTotal).toLocaleString()}
                    </span>
                    {/* Discount breakdown — mirrors ABCA's BookingBar.
                        Original total struck through + "Save ₹X" pill,
                        with recurring + promo lines underneath when
                        either bucket is non-zero. */}
                    {totalSavings > 0 && (
                      <>
                        <span className="text-[10px] text-slate-500 line-through ml-1">
                          ₹{originalTotal.toLocaleString()}
                        </span>
                        <span className="text-[10px] text-green-400 ml-1">
                          Save ₹{totalSavings.toLocaleString()}
                        </span>
                      </>
                    )}
                    {discountBreakdown.recurring > 0 && (
                      <span className="text-[10px] text-emerald-400 ml-1">
                        (incl. Slot Discount: -₹{discountBreakdown.recurring})
                      </span>
                    )}
                    {discountBreakdown.promo > 0 && (
                      <span className="text-[10px] text-amber-400 ml-1">
                        ({discountBreakdown.promoLabel || 'Promo'}: -₹{discountBreakdown.promo})
                      </span>
                    )}
                    {/* Kit rental annotation — the bottom-bar number
                        already includes the kit (see above). This line
                        breaks the total down so the user can see WHY
                        the number jumped when they toggled the kit. */}
                    {kitRentalTotal > 0 && (
                      <span className="text-[10px] text-amber-400 ml-1">
                        (incl. Kit: +₹{kitRentalTotal})
                      </span>
                    )}
                  </>
                )}
                {/* When a package fully covers the slots but the user
                    also opted into kit rental, show the kit line so
                    they know there's still a payable amount. */}
                {packageCoversBooking && kitRentalTotal > 0 && (
                  <span className="text-[10px] text-amber-400 ml-1">
                    + Kit: ₹{kitRentalTotal}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => setShowConfirm(true)}
              disabled={submitting || paymentProcessing}
              className="flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-6 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.97] disabled:opacity-50 cursor-pointer"
            >
              {submitting || paymentProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {paymentProcessing ? 'Processing payment...' : 'Booking...'}
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Confirm
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

/**
 * Section wrapper — same `text-[10px] mb-1` label treatment as ABCA's
 * `OptionsPanel`, so picker rows on Toplay sit at exactly the same
 * vertical rhythm as ball-type / pitch-type / operation-mode rows on
 * ABCA.
 */
function PickerRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5">
      <label className="block text-[10px] font-medium text-accent mb-1 uppercase tracking-wider">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

/**
 * Same flex-1 accent-solid toggle row as ABCA's `OptionsPanel.ToggleButton`.
 * Auto-defaults to the first option when the current value isn't in
 * the set (covers fresh mount, machine switch, parent-driven reset).
 * Single-option rows hide themselves — no point asking the user to tap
 * a chip they can't change.
 */
function ChipSelector({
  label,
  required,
  options,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  options: Array<{ id: string; label: string }>;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  useEffect(() => {
    if (options.length === 0) return;
    const has = value && options.some((o) => o.id === value);
    if (!has) onChange(options[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.map((o) => o.id).join(','), value]);

  if (options.length <= 1) return null;

  // Layout mirrors the Session Type tiles above: 2-col grid (3-col
  // on sm+), icon-on-the-left visual marker, left-aligned label,
  // consistent padding/border-radius. Admins specifically asked that
  // Pitch Type / Ball Type chips share dimensions + alignment with
  // the session category cards so the whole picker reads as one
  // coherent design.
  return (
    <PickerRow label={label} required={required}>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {options.map((opt) => {
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onChange(opt.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all cursor-pointer border min-w-0 text-center ${
                active
                  ? 'bg-accent text-primary border-accent shadow-sm'
                  : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-accent/20'
              }`}
            >
              <span className="truncate">{opt.label}</span>
            </button>
          );
        })}
      </div>
    </PickerRow>
  );
}

function PeoplePicker({
  label,
  help,
  options,
  value,
  onChange,
  emptyMessage,
}: {
  label: string;
  help?: string;
  options: PersonLite[];
  value: string | null;
  onChange: (v: string | null) => void;
  emptyMessage: string;
}) {
  // Same grid + icon-on-left layout as Session Type tiles, machine
  // cards, and ChipSelector. Coach / Sidearm Specialist used to sit
  // in a centered flex-wrap row that didn't line up with anything
  // else in the picker; the unified visual makes the whole booking
  // flow read as one consistent design.
  return (
    <PickerRow label={label}>
      {help && <div className="text-[10px] text-slate-500 mb-1.5">{help}</div>}
      {options.length === 0 ? (
        <span className="text-xs text-amber-400">{emptyMessage}</span>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {options.map((p) => {
            const active = value === p.userId;
            return (
              <button
                key={p.userId}
                onClick={() => onChange(p.userId)}
                className={`flex items-center justify-start gap-2 px-2.5 py-2 sm:px-3 sm:py-2.5 rounded-lg text-[11px] sm:text-xs font-semibold transition-all cursor-pointer border min-w-0 text-left ${
                  active
                    ? 'bg-accent text-primary border-accent shadow-sm'
                    : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-accent/20'
                }`}
              >
                <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
                  active ? 'bg-primary/15' : 'bg-white/[0.04]'
                }`}>
                  <UserCog className={`w-4 h-4 ${active ? 'text-primary' : 'text-accent'}`} />
                </div>
                <span className="truncate">{p.name || '(no name)'}</span>
              </button>
            );
          })}
        </div>
      )}
    </PickerRow>
  );
}

function formatTimeRangeIST(startISO: string, endISO: string): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    });
  };
  return `${fmt(startISO)}–${fmt(endISO)}`;
}
