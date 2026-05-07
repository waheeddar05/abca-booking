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
import { format } from 'date-fns';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Settings2,
  Users,
  UserCog,
  LayoutGrid,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageBackground } from '@/components/ui/PageBackground';
import { DateSelector } from '@/components/slots/DateSelector';
import { ContactFooter } from '@/components/ContactFooter';
import { useCenter } from '@/lib/center-context';
import { api } from '@/lib/api-client';

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
}

interface PerSlabRates { morning: number; evening: number }

/** Resolved RESOURCE_PRICING_CONFIG, mirrored from lib/resource-pricing. */
interface ClientPricingConfig {
  categoryRates: Record<Category, PerSlabRates>;
  machineTypeOverrides?: Record<string, PerSlabRates>;
  /** machinePricing[machineTypeCode][pitchType][ballType] → rates. */
  machinePricing?: Record<string, Record<string, Record<string, PerSlabRates>>>;
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
  CEMENT:  'Cement',
  NATURAL: 'Natural Turf',
};

const BALL_TYPE_LABELS: Record<BallTypeId, string> = {
  LEATHER: 'Leather',
  TENNIS:  'Tennis',
  MACHINE: 'Machine balls',
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

  // Reset selections when category changes — different category, different staff
  useEffect(() => {
    setSelectedSlots([]);
    setMachineId(null);
    setPitchType(null);
    setBallType(null);
    setCoachId(null);
    setStaffId(null);
  }, [category]);

  // Picking a different machine wipes pitch/ball — they're per-machine.
  useEffect(() => {
    setPitchType(null);
    setBallType(null);
  }, [machineId]);

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
    if (cat === 'MACHINE') {
      if (s.freeIndoorNets.length === 0 && s.freeOutdoorResources.length === 0) {
        return { ok: false, reason: 'No nets free' };
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
  const slotPriceFor = (s: ResourceSlot): number => {
    const slab = s.timeSlab;
    const cfg = data?.pricingConfig;

    if (!cfg) return s.prices[category] || 0;

    if (category === 'MACHINE' && machineId) {
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

  const totalPrice = useMemo(() => {
    return selectedSlots.reduce((sum, s) => sum + slotPriceFor(s), 0);
    // slotPriceFor depends on every selection that affects the cascade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlots, category, machineId, pitchType, ballType, data?.pricingConfig]);

  const filteredMachines = useMemo(() => {
    // Phase 5b doesn't filter by ball type; the engine accepts any active machine.
    return machines;
  }, [machines]);

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
      const body = {
        slots: selectedSlots.map((s) => ({
          date: data!.date,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
        category,
        playerName: 'Player', // Phase 5b minimal: ask in confirm dialog later
        machineId: category === 'MACHINE' ? machineId : undefined,
        pitchType: wantsPitch ? pitchType : undefined,
        ballType: category === 'MACHINE' ? ballType : undefined,
        coachId: category === 'COACHING' ? coachId : undefined,
        staffId: category === 'SIDEARM' ? staffId : undefined,
      };
      const res = await api.post<{ bookings: { id: string }[] }>('/api/slots/book-resource', body);
      toast.success(`Booked ${res.bookings.length} slot${res.bookings.length === 1 ? '' : 's'}`);
      router.push('/bookings');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Booking failed';
      toast.error(msg);
    } finally {
      setSubmitting(false);
      setShowConfirm(false);
    }
  };

  if (!currentCenter) {
    return (
      <main className="min-h-screen flex items-center justify-center text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </main>
    );
  }

  return (
    <>
      <PageBackground />
      <main className="max-w-4xl mx-auto px-4 py-6 md:py-8">
        <div className="mb-5">
          <h1 className="text-xl md:text-2xl font-bold text-white">Book a session</h1>
          <p className="text-xs text-slate-400 mt-1">
            {currentCenter.name} · {data?.indoorNetsTotal ?? '—'} indoor nets
            {data?.outdoorResourcesTotal ? ` · ${data.outdoorResourcesTotal} outdoor` : ''}
            {data && data.coachesTotal > 0 ? ` · ${data.coachesTotal} coaches` : ''}
            {data && data.sidearmStaffTotal > 0 ? ` · ${data.sidearmStaffTotal} sidearm specialist` : ''}
          </p>
        </div>

        <DateSelector selectedDate={selectedDate} onSelect={setSelectedDate} />

        {/* Category tabs */}
        <div className="mb-5">
          <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
            Session type
          </label>
          {/* 2 cols on phones (3 rows of 2), 3 cols on tablets, 6 cols
              on desktop — keeps the tile size readable across breakpoints
              and avoids the lopsided 4+2 split that md:grid-cols-4
              produced once we added a 6th category. */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {CATEGORIES.filter(
              // Hide categories the admin disabled for this center.
              // Default (no policy / response not ready yet) is all enabled.
              ({ key }) => !data?.enabledCategories || data.enabledCategories.includes(key),
            ).map(({ key, label, icon: Icon, sub }) => {
              const active = category === key;
              return (
                <button
                  key={key}
                  onClick={() => setCategory(key)}
                  className={`flex flex-col items-start gap-1 px-2.5 py-2 rounded-xl border text-left transition-all cursor-pointer min-w-0 ${
                    active
                      ? 'bg-accent/10 border-accent/40 ring-1 ring-accent/30'
                      : 'bg-white/[0.02] border-white/[0.06] hover:border-accent/20 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 w-full">
                    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? 'text-accent' : 'text-slate-400'}`} />
                    <span className={`text-[11px] sm:text-xs font-semibold truncate ${active ? 'text-accent' : 'text-white'}`}>
                      {label}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-medium">{sub}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Per-category secondary picker */}
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
                  // Two info bits: ball type (e.g. "leather") + lane/pitch
                  // (e.g. "turf — Turf 1"). Joined with a dot when both are
                  // present so the pill stays scannable.
                  const subParts = [
                    m.machineType.ballType.toLowerCase(),
                    m.resource ? `${surface}: ${m.resource.name}` : null,
                  ].filter(Boolean);
                  return (
                    <button
                      key={m.id}
                      onClick={() => setMachineId(active ? null : m.id)}
                      // max-w caps the pill at one phone-friendly width so
                      // a long lane subtext doesn't push the row off-screen
                      // — the inner text truncates rather than wraps.
                      className={`flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition-all max-w-[16rem] min-w-0 ${
                        active
                          ? 'bg-accent/15 text-accent border-accent/40'
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
                          <Settings2 className="w-3.5 h-3.5 text-slate-500" />
                        </div>
                      )}
                      <span className="leading-tight text-left min-w-0">
                        <span className="block truncate">{m.name}</span>
                        <span className="block text-[10px] text-slate-500 font-medium truncate">
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

        {/* Pitch + ball type chips for the BOWLING MACHINE flow — driven
            by the machine's effective lists (server-resolved: empty
            configured array → all four pitch types). */}
        {category === 'MACHINE' && machineId && (() => {
          const m = filteredMachines.find((x) => x.id === machineId);
          if (!m) return null;
          const pitchOptions = m.effectivePitchTypes ?? m.supportedPitchTypes ?? [];
          const ballOptions = m.effectiveBallTypes ?? m.supportedBallTypes ?? [];
          return (
            <>
              {pitchOptions.length > 0 && (
                <ChipSelector
                  label="Pitch type"
                  required={pitchOptions.length > 1}
                  options={pitchOptions.map((id) => ({ id, label: PITCH_TYPE_LABELS[id] }))}
                  value={pitchType}
                  onChange={(v) => setPitchType(v as PitchTypeId | null)}
                />
              )}
              {ballOptions.length > 0 && (
                <ChipSelector
                  label="Ball type"
                  required={ballOptions.length > 1}
                  options={ballOptions.map((id) => ({ id, label: BALL_TYPE_LABELS[id] }))}
                  value={ballType}
                  onChange={(v) => setBallType(v as BallTypeId | null)}
                />
              )}
            </>
          );
        })()}

        {/* Sidearm pitch type — read from per-center SIDEARM_PITCH_TYPES policy. */}
        {category === 'SIDEARM' && (data?.sidearmPitchTypes?.length ?? 0) > 0 && (
          <ChipSelector
            label="Pitch type"
            required={(data!.sidearmPitchTypes.length) > 1}
            options={data!.sidearmPitchTypes.map((id) => ({ id, label: PITCH_TYPE_LABELS[id] }))}
            value={pitchType}
            onChange={(v) => setPitchType(v as PitchTypeId | null)}
          />
        )}

        {/* Net-only pitch type — read from per-center NET_PITCH_TYPES policy. */}
        {category === 'NET' && (data?.netPitchTypes?.length ?? 0) > 0 && (
          <ChipSelector
            label="Pitch type"
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

        {/* Slot grid */}
        <div className="mb-5">
          <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
            Available slots
          </label>
          {loading ? (
            <div className="flex items-center gap-2 text-slate-400 py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : error ? (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
            </div>
          ) : !data || data.slots.length === 0 ? (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center text-xs text-slate-500">
              No slots configured for this date.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {data.slots.map((slot) => {
                const bookable = slotIsBookable(slot, category);
                const selected = selectedSlots.some((s) => s.startTime === slot.startTime);
                const price = slotPriceFor(slot);
                return (
                  <button
                    key={slot.startTime}
                    onClick={() => bookable.ok && toggleSlot(slot)}
                    disabled={!bookable.ok}
                    className={`relative p-2.5 rounded-xl border transition-all text-left ${
                      !bookable.ok
                        ? 'bg-white/[0.01] border-white/[0.04] text-slate-600 cursor-not-allowed'
                        : selected
                          ? 'bg-accent/10 border-accent/40 text-accent ring-1 ring-accent/30 cursor-pointer'
                          : 'bg-white/[0.04] border-white/[0.08] text-slate-200 hover:border-accent/30 hover:bg-white/[0.06] cursor-pointer'
                    }`}
                    title={bookable.reason}
                  >
                    <div className="text-xs font-bold tabular-nums">
                      {formatTimeRangeIST(slot.startTime, slot.endTime)}
                    </div>
                    <div className="text-[10px] text-slate-500 capitalize">
                      {slot.timeSlab}
                    </div>
                    {bookable.ok ? (
                      <div className="text-[11px] font-semibold mt-0.5">₹{price}</div>
                    ) : (
                      <div className="text-[10px] mt-0.5 text-slate-600 line-clamp-1">{bookable.reason}</div>
                    )}
                    {slot.corporateBatchHolds > 0 && bookable.ok && category !== 'FULL_COURT' && (
                      <div className="text-[9px] text-amber-400 mt-0.5">
                        Batch holds {slot.corporateBatchHolds} net{slot.corporateBatchHolds === 1 ? '' : 's'}
                      </div>
                    )}
                    {selected && (
                      <CheckCircle2 className="absolute top-1 right-1 w-3.5 h-3.5 text-accent" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Booking bar */}
        {selectedSlots.length > 0 && (
          <div className="sticky bottom-0 left-0 right-0 -mx-4 px-4 py-3 bg-[#060d1b]/95 backdrop-blur-xl border-t border-white/[0.06] z-30">
            <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-slate-400">
                  {selectedSlots.length} slot{selectedSlots.length === 1 ? '' : 's'}
                </div>
                <div className="text-base font-bold text-white">₹{totalPrice}</div>
              </div>
              <button
                onClick={() => setShowConfirm(true)}
                disabled={submitting}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-black font-semibold hover:bg-accent/90 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-all"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Book'}
                {!submitting && <ArrowRight className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}

        <ContactFooter />
      </main>

      <ConfirmDialog
        open={showConfirm}
        title="Confirm booking"
        message={[
          `${CATEGORIES.find((c) => c.key === category)?.label} on ${format(selectedDate, 'EEE, dd MMM yyyy')}`,
          `Slots: ${selectedSlots.map((s) => formatTimeRangeIST(s.startTime, s.endTime)).join(', ')}`,
          `Total: ₹${totalPrice}`,
        ].join('\n')}
        confirmLabel="Confirm"
        onCancel={() => setShowConfirm(false)}
        onConfirm={submit}
        loading={submitting}
      />
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

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
    <div className="mb-5">
      <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

/**
 * Single-select chip row. Auto-defaults to the first option whenever
 * the current `value` isn't in the option set (covers initial mount,
 * machine switch, category switch, …). Single-option rows hide
 * themselves entirely — no point asking the user to tap a chip they
 * can't change. Empty options also hide the row.
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
  // Default-to-first whenever the current value is missing from the
  // list of options — covers fresh mount, option-set change, AND a
  // parent-driven reset to null (e.g. switching machines wipes
  // pitch/ball; we still want the new selector to land on its first
  // chip). Listing `value` in the deps is what makes the reset case
  // refire — once a valid value is set, `has` is true and onChange
  // isn't called again, so no loop.
  useEffect(() => {
    if (options.length === 0) return;
    const has = value && options.some((o) => o.id === value);
    if (!has) onChange(options[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.map((o) => o.id).join(','), value]);

  // Nothing to choose between — hide the row.
  if (options.length <= 1) return null;

  return (
    <PickerRow label={label} required={required}>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = value === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onChange(active ? null : opt.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-all ${
                active
                  ? 'bg-accent/15 text-accent border-accent/40'
                  : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:border-accent/30'
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
      {help && <div className="text-[10px] text-slate-500 mb-2">{help}</div>}
      {options.length === 0 ? (
        <span className="text-xs text-amber-400">{emptyMessage}</span>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((p) => {
            const active = value === p.userId;
            return (
              <button
                key={p.userId}
                onClick={() => onChange(active ? null : p.userId)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-all ${
                  active
                    ? 'bg-accent/15 text-accent border-accent/40'
                    : 'bg-white/[0.04] text-slate-300 border-white/[0.08] hover:border-accent/30'
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
