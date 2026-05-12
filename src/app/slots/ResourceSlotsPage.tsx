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

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { format, parseISO } from 'date-fns';
import {
  AlertTriangle,
  Calendar,
  Check,
  IndianRupee,
  Loader2,
  Settings2,
  Users,
  UserCog,
  LayoutGrid,
  Package as PackageIcon,
} from 'lucide-react';
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
  /** Categories blocked at this slot by an admin block. Empty when the
   *  slot is fully open. Used to grey out the slot card for the active
   *  category — without this, the user could tap an apparently-free
   *  slot and only get the 409 at submit. */
  blockedCategories?: string[];
  /** Specific Machine rows blocked at this slot by an admin block.
   *  When the user has pinned a MACHINE booking to one of these rows,
   *  the slot is unbookable for them even if other machines are free. */
  blockedMachineRowIds?: string[];
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
    case 'TURF_WICKET':   return 'turf';
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
  { key: 'NET',             label: 'Cricket Nets Booking', icon: LayoutGrid, sub: 'Bare net for self practice' },
  { key: 'SIDEARM',         label: 'Sidearm',             icon: Users,      sub: 'Bowled by a specialist' },
  { key: 'COACHING',        label: 'Personal Coaching',   icon: UserCog,    sub: 'With a coach' },
  { key: 'CORPORATE_BATCH', label: 'Corporate Batch',     icon: Users,      sub: 'Group session' },
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
  const [useWallet, setUseWallet] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number>(0);

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
    totalSessions: number;
    usedSessions: number;
    remainingSessions: number;
    status: string;
    pendingActivation?: boolean;
  }
  const [myPackages, setMyPackages] = useState<MyPackageLite[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);

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
      // ABCA-shape packages have category=null and redeem against any
      // category (legacy back-compat). Resource-shape packages must
      // match the active category exactly.
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
    }
    // Pitch — default to first option whenever current value isn't
    // valid for the new option set.
    if (pitchOptions.length > 0 && (!pitchType || !pitchOptions.includes(pitchType))) {
      setPitchType(pitchOptions[0]);
    } else if (pitchOptions.length === 0 && pitchType !== null) {
      setPitchType(null);
    }
    // Ball — same story (only relevant for MACHINE).
    if (ballOptions.length > 0 && (!ballType || !ballOptions.includes(ballType))) {
      setBallType(ballOptions[0]);
    } else if (ballOptions.length === 0 && ballType !== null) {
      setBallType(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, machineId, machines, data?.sidearmPitchTypes, data?.netPitchTypes]);

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
    const blockedCats = s.blockedCategories ?? [];
    const blockedRows = s.blockedMachineRowIds ?? [];
    if (blockedCats.includes(cat)) {
      return { ok: false, reason: 'Slot blocked by admin' };
    }
    if (cat === 'MACHINE' && machineId && blockedRows.includes(machineId)) {
      return { ok: false, reason: 'This machine is blocked for this slot' };
    }

    if (cat === 'MACHINE') {
      if (s.freeIndoorNets.length === 0 && s.freeOutdoorResources.length === 0) {
        return { ok: false, reason: 'No nets free' };
      }
      // Operator gating — only for non-tennis (leather) machines. Tennis
      // machines (LEVERAGE) can self-operate, so a busy operator pool
      // doesn't block them. Mirrors ABCA's behaviour in
      // /api/slots/available:360-377 — leather goes to OperatorUnavailable,
      // tennis falls back to self-operate.
      const selectedMachine = machineId ? filteredMachines.find((m) => m.id === machineId) : null;
      const isTennisMachine = selectedMachine?.machineType?.code === 'LEVERAGE';
      if (!isTennisMachine && s.operatorAvailable === false && s.selfOperate === false) {
        return { ok: false, reason: 'All operators are booked for this slot' };
      }
      return { ok: true };
    }
    if (cat === 'SIDEARM') {
      if (s.freeSidearmStaff.length === 0) return { ok: false, reason: 'No sidearm specialist free' };
      if (s.freeIndoorNets.length === 0) return { ok: false, reason: 'No nets free' };
      return { ok: true };
    }
    if (cat === 'COACHING') {
      if (s.freeCoaches.length === 0) return { ok: false, reason: 'No coaches free' };
      if (s.freeIndoorNets.length === 0) return { ok: false, reason: 'No nets free' };
      return { ok: true };
    }
    if (cat === 'FULL_COURT') {
      if (!s.fullCourtAvailable) {
        return {
          ok: false,
          reason: s.corporateBatchHolds > 0 ? 'Corporate batch holds the indoor pool' : 'Not all indoor nets are free',
        };
      }
      return { ok: true };
    }
    if (cat === 'NET') {
      if (s.freeIndoorNets.length === 0 && s.freeOutdoorResources.length === 0) {
        return { ok: false, reason: 'No nets free' };
      }
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
        return typeof r.consecutive === 'number' ? r.consecutive / 2 : null;
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
   *  sees what they'll actually pay (server recomputes on book). */
  const discountFor = (s: ResourceSlot): {
    amount: number;
    promoName: string | null;
  } | null => {
    const d = s.discountsByCategory?.[category];
    if (!d || d.total <= 0) return null;
    return { amount: d.total, promoName: d.promoName };
  };

  const slotBaseFor = (s: ResourceSlot): number => {
    const slab = s.timeSlab;
    const cfg = data?.pricingConfig;

    if (!cfg) return s.prices[category] || 0;

    if (category === 'MACHINE' && machineId) {
      const consecutive = isSlotConsecutive(s);
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
      const v = cfg.sidearmPricing?.[pitchType];
      if (v && v[slab] != null) return v[slab];
    }
    if (category === 'NET' && pitchType) {
      const v = cfg.netPricing?.[pitchType];
      if (v && v[slab] != null) return v[slab];
    }

    return cfg.categoryRates[category]?.[slab] ?? s.prices[category] ?? 0;
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

  const totalPrice = useMemo(() => {
    if (packageCoversBooking) return 0;
    return selectedSlots.reduce((sum, s) => sum + slotPriceFor(s), 0);
    // slotPriceFor depends on every selection that affects the cascade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlots, category, machineId, pitchType, ballType, data?.pricingConfig, packageCoversBooking]);

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
      const walletDeduction = useWallet && walletBalance > 0
        ? Math.min(walletBalance, totalPrice)
        : 0;
      const amountAfterWallet = Math.max(0, totalPrice - walletDeduction);
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
          Session Type
        </label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {CATEGORIES.filter(
            ({ key }) => !data?.enabledCategories || data.enabledCategories.includes(key),
          ).map(({ key, label, icon: Icon }) => {
            const active = category === key;
            return (
              <button
                key={key}
                onClick={() => setCategory(key)}
                className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer min-w-0 ${
                  active
                    ? 'bg-accent text-primary shadow-sm'
                    : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-accent/20'
                }`}
              >
                <Icon className="w-3.5 h-3.5 flex-shrink-0" />
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
            <div className="flex flex-wrap gap-2">
              {filteredMachines.map((m) => {
                const active = machineId === m.id;
                const imageUrl = m.machineType.imageUrl;
                const surface = describeResourceType(m.resource?.type);
                const subParts = [
                  m.machineType.ballType.toLowerCase(),
                  m.resource ? `${surface}: ${m.resource.name}` : null,
                ].filter(Boolean);
                return (
                  <button
                    key={m.id}
                    onClick={() => setMachineId(active ? null : m.id)}
                    className={`flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition-all max-w-[16rem] min-w-0 ${
                      active
                        ? 'bg-accent text-primary border-accent shadow-sm'
                        : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:border-accent/30'
                    }`}
                  >
                    {imageUrl ? (
                      <Image
                        src={imageUrl}
                        alt={m.machineType.name}
                        width={28}
                        height={28}
                        className="w-7 h-7 rounded-md object-cover bg-white/5 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-md bg-white/5 flex items-center justify-center flex-shrink-0">
                        <Settings2 className={`w-3.5 h-3.5 ${active ? 'text-primary/70' : 'text-slate-500'}`} />
                      </div>
                    )}
                    <span className="leading-tight text-left min-w-0">
                      <span className="block truncate">{m.machineType.name}</span>
                      <span className={`block text-[10px] font-medium truncate ${active ? 'text-primary/70' : 'text-slate-500'}`}>
                        {subParts.join(' · ')}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </PickerRow>
      )}

      {/* Pitch + ball — driven by per-machine effective lists. */}
      {category === 'MACHINE' && machineId && (() => {
        const m = filteredMachines.find((x) => x.id === machineId);
        if (!m) return null;
        const pitchOptions = m.effectivePitchTypes ?? m.supportedPitchTypes ?? [];
        const ballOptions = m.effectiveBallTypes ?? m.supportedBallTypes ?? [];
        return (
          <>
            {pitchOptions.length > 0 && (
              <ChipSelector
                label="Pitch Type"
                required={pitchOptions.length > 1}
                options={pitchOptions.map((id) => ({ id, label: PITCH_TYPE_LABELS[id] }))}
                value={pitchType}
                onChange={(v) => setPitchType(v as PitchTypeId | null)}
              />
            )}
            {ballOptions.length > 0 && (
              <ChipSelector
                label="Ball Type"
                required={ballOptions.length > 1}
                options={ballOptions.map((id) => ({ id, label: BALL_TYPE_LABELS[id] }))}
                value={ballType}
                onChange={(v) => setBallType(v as BallTypeId | null)}
              />
            )}
          </>
        );
      })()}

      {category === 'SIDEARM' && (data?.sidearmPitchTypes?.length ?? 0) > 0 && (
        <ChipSelector
          label="Pitch Type"
          required={(data!.sidearmPitchTypes.length) > 1}
          options={data!.sidearmPitchTypes.map((id) => ({ id, label: PITCH_TYPE_LABELS[id] }))}
          value={pitchType}
          onChange={(v) => setPitchType(v as PitchTypeId | null)}
        />
      )}

      {category === 'NET' && (data?.netPitchTypes?.length ?? 0) > 0 && (
        <ChipSelector
          label="Pitch Type"
          required={(data!.netPitchTypes.length) > 1}
          options={data!.netPitchTypes.map((id) => ({ id, label: PITCH_TYPE_LABELS[id] }))}
          value={pitchType}
          onChange={(v) => setPitchType(v as PitchTypeId | null)}
        />
      )}

      {category === 'COACHING' && (
        <PeoplePicker
          label="Coach"
          help="Leave empty to auto-assign the first available coach."
          options={data?.slots[0]?.freeCoaches ?? []}
          value={coachId}
          onChange={setCoachId}
          emptyMessage="No coaches free for the selected slots."
        />
      )}

      {category === 'SIDEARM' && (
        <PeoplePicker
          label="Sidearm Specialist"
          help="Leave empty to auto-assign."
          options={data?.slots[0]?.freeSidearmStaff ?? []}
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
        {eligiblePackages.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">
              Redeem from package
            </p>
            <div className="flex flex-wrap gap-2">
              {eligiblePackages.map((p) => {
                const isSelected = selectedPackageId === p.id;
                const tooFewSessions = p.remainingSessions < selectedSlots.length;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPackageId(isSelected ? null : p.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all border ${
                      isSelected
                        ? 'bg-purple-500/15 border-purple-400/50 text-purple-200'
                        : 'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:border-purple-400/30'
                    }`}
                    title={tooFewSessions && isSelected
                      ? `Not enough sessions left (${p.remainingSessions}) to cover ${selectedSlots.length}`
                      : `${p.remainingSessions} session(s) remaining`}
                  >
                    <PackageIcon className={`w-3.5 h-3.5 ${isSelected ? 'text-purple-300' : 'text-slate-500'}`} />
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold leading-tight">{p.packageName}</div>
                      <div className="text-[9px] opacity-70">
                        {p.remainingSessions}/{p.totalSessions} sessions left
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {selectedPackage && selectedSlots.length > 0 && (
              <p className={`mt-2 text-[10px] ${packageCoversBooking ? 'text-emerald-400' : 'text-amber-400'}`}>
                {packageCoversBooking
                  ? `Will redeem ${selectedSlots.length} session${selectedSlots.length === 1 ? '' : 's'} from "${selectedPackage.packageName}" · No charge`
                  : `Not enough sessions in "${selectedPackage.packageName}" (${selectedPackage.remainingSessions} left, ${selectedSlots.length} selected)`}
              </p>
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
              const price = slotPriceFor(slot);
              const isUnavailable = !bookable.ok;
              const bgClass = isUnavailable
                ? 'bg-white/[0.02] border border-white/[0.05] cursor-not-allowed'
                : selected
                  ? 'bg-accent text-primary shadow-md shadow-accent/20 border border-accent'
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
                    : 'Open';
              const statusColor = isUnavailable
                ? 'text-red-400'
                : selected
                  ? 'text-primary/80'
                  : 'text-green-400';
              return (
                <button
                  key={slot.startTime}
                  onClick={() => bookable.ok && toggleSlot(slot)}
                  disabled={isUnavailable || submitting}
                  className={`relative p-3.5 rounded-xl transition-all text-left cursor-pointer ${bgClass}`}
                  title={bookable.reason}
                >
                  {selected && (
                    <div className="absolute top-2 right-2">
                      <Check className="w-4 h-4" />
                    </div>
                  )}

                  <div className={`text-sm font-bold ${isUnavailable ? 'text-slate-600' : selected ? '' : 'text-white'}`}>
                    {format(parseISO(slot.startTime), 'HH:mm')}
                  </div>
                  <div className={`text-[10px] mt-0.5 ${
                    isUnavailable ? 'text-slate-600' : selected ? 'text-primary/70' : 'text-slate-400'
                  }`}>
                    to {format(parseISO(slot.endTime), 'HH:mm')}
                  </div>

                  <div className="flex items-center justify-between mt-1.5">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${statusColor}`}>
                      {statusLabel}
                    </span>
                    {!isUnavailable && (
                      <span className={`text-[10px] font-medium ${selected ? 'text-primary/70' : 'text-slate-400'}`}>
                        ₹{price}
                      </span>
                    )}
                  </div>

                  {slot.corporateBatchHolds > 0 && !isUnavailable && category !== 'FULL_COURT' && (
                    <div className={`mt-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full text-center ${
                      selected ? 'bg-primary/20 text-primary/80' : 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                    }`}>
                      Batch holds {slot.corporateBatchHolds} net{slot.corporateBatchHolds === 1 ? '' : 's'}
                    </div>
                  )}

                  {/* Self-operate badge — appears for MACHINE slots when
                      no operator will be assigned. Two cases:
                        a) Center has 0 operators scheduled for this slot
                           (`slot.selfOperate` from the server).
                        b) Operators exist but are all busy AND the user
                           picked a tennis (LEVERAGE) machine — the booking
                           still goes through, just as self-operate.
                      Leather machines don't show this because they hard-
                      require an operator and the slot is already greyed
                      out by `slotIsBookable`. */}
                  {category === 'MACHINE' && !isUnavailable && (() => {
                    const sel = machineId ? filteredMachines.find((m) => m.id === machineId) : null;
                    const isTennis = sel?.machineType?.code === 'LEVERAGE';
                    const showBadge = slot.selfOperate
                      || (isTennis && slot.operatorAvailable === false);
                    if (!showBadge) return null;
                    return (
                      <div className={`mt-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full text-center ${
                        selected ? 'bg-primary/20 text-primary/80' : 'bg-sky-500/15 text-sky-300 border border-sky-500/20'
                      }`}>
                        Self-operate
                      </div>
                    );
                  })()}

                  {/* Discount badge — recurring or promotional offer
                      applicable to this slot under the active category.
                      Mirrors ABCA's slot-grid badging from /api/slots/
                      available. */}
                  {!isUnavailable && (() => {
                    const disc = discountFor(slot);
                    if (!disc) return null;
                    const label = disc.promoName ?? `₹${disc.amount} off`;
                    return (
                      <div className={`mt-1 text-[8px] font-bold px-1.5 py-0.5 rounded-full text-center truncate ${
                        selected ? 'bg-primary/20 text-primary/80' : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                      }`}
                        title={`Recurring/promo discount: ₹${disc.amount} off`}>
                        {label}
                      </div>
                    );
                  })()}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Payment method (online / cash / wallet). Same component ABCA uses
          so wallet behaviour is identical across centers. Rendered
          whenever any payment surface is on AND the user has selected
          slots AND it's not a free booking. */}
      {selectedSlots.length > 0
        && (
          (paymentConfig?.paymentEnabled && paymentConfig?.slotPaymentRequired)
          || paymentConfig?.cashPaymentEnabled
          || paymentConfig?.walletEnabled
        )
        && !isFreeBooking
        && !packageCoversBooking
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
              totalAmount={totalPrice}
              useWallet={useWallet}
              onUseWalletChange={setUseWallet}
              onWalletBalanceLoaded={setWalletBalance}
            />
          </div>
        )}

      <ContactFooter />

      {(() => {
        const isCashPayment = paymentMethod === 'CASH';
        const walletDeduction = useWallet && walletBalance > 0
          ? Math.min(walletBalance, totalPrice)
          : 0;
        const amountAfterWallet = Math.max(0, totalPrice - walletDeduction);
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
        if (isFreeBooking) {
          lines.push('Total: FREE');
        } else if (walletCoversAll) {
          lines.push(`Total: ₹${totalPrice} (Wallet — ₹${walletDeduction} deducted)`);
        } else if (walletDeduction > 0 && isCashPayment) {
          lines.push(`₹${walletDeduction} from wallet · ₹${amountAfterWallet} at center`);
        } else if (walletDeduction > 0) {
          lines.push(`₹${walletDeduction} from wallet · ₹${amountAfterWallet} online`);
        } else if (isCashPayment) {
          lines.push(`Total: ₹${totalPrice} (Pay at center)`);
        } else {
          lines.push(`Total: ₹${totalPrice}`);
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
              </p>
              <div className="flex items-center gap-1 mt-0.5">
                {packageCoversBooking ? (
                  // Package redemption: server consumes one session per
                  // slot and charges nothing. Show the package label so
                  // the user can see exactly what's being decremented.
                  <span className="text-sm font-bold text-purple-300 uppercase tracking-wider truncate"
                    title={`Redeem ${selectedSlots.length} session(s) from "${selectedPackage?.packageName ?? ''}"`}>
                    Package redemption
                  </span>
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
                    <span className="text-sm font-bold text-accent">
                      {totalPrice.toLocaleString()}
                    </span>
                  </>
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

  return (
    <PickerRow label={label} required={required}>
      <div className="flex gap-2">
        {options.map((opt) => {
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onChange(opt.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                active
                  ? 'bg-accent text-primary shadow-sm'
                  : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-accent/20'
              }`}
            >
              {opt.label}
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
  return (
    <PickerRow label={label}>
      {help && <div className="text-[10px] text-slate-500 mb-1.5">{help}</div>}
      {options.length === 0 ? (
        <span className="text-xs text-amber-400">{emptyMessage}</span>
      ) : (
        <div className="flex gap-2 flex-wrap">
          {options.map((p) => {
            const active = value === p.userId;
            return (
              <button
                key={p.userId}
                onClick={() => onChange(p.userId)}
                className={`flex-1 min-w-[5rem] flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  active
                    ? 'bg-accent text-primary shadow-sm'
                    : 'bg-white/[0.04] text-slate-400 border border-white/[0.08] hover:border-accent/20'
                }`}
              >
                {p.name || '(no name)'}
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
