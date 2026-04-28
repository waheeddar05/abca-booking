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
 *   3. (Conditional) Pick a machine / coach / sidearm staff member.
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

type Category = 'MACHINE' | 'SIDEARM' | 'COACHING' | 'FULL_COURT';

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
  };
  /** Per-machine final price for this slot, keyed by machineId — honours
   *  per-machine-type overrides (e.g. Yantra premium). Empty when the
   *  center has no active machines. */
  machinePrices?: Record<string, number>;
}

interface ResourceAvailabilityResponse {
  date: string;
  centerId: string;
  centerSlug: string;
  indoorNetsTotal: number;
  outdoorResourcesTotal: number;
  coachesTotal: number;
  sidearmStaffTotal: number;
  corporateBatchConfig: { enabled: boolean; days: number[]; startTime: string; endTime: string; netsConsumed: number };
  slots: ResourceSlot[];
}

interface MachineLite {
  id: string;
  name: string;
  isActive: boolean;
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

const CATEGORIES: Array<{ key: Category; label: string; icon: typeof Settings2; sub: string }> = [
  { key: 'MACHINE', label: 'Bowling Machine', icon: Settings2, sub: 'Yantra / Leverage' },
  { key: 'SIDEARM', label: 'Sidearm', icon: Users, sub: 'Bowled by staff' },
  { key: 'COACHING', label: 'Personal Coaching', icon: UserCog, sub: 'With a coach' },
  { key: 'FULL_COURT', label: 'Full Indoor Court', icon: LayoutGrid, sub: 'All indoor nets' },
];

export default function ResourceSlotsPage() {
  const { currentCenter } = useCenter();
  const router = useRouter();
  const toast = useToast();

  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [category, setCategory] = useState<Category>('MACHINE');
  const [machineId, setMachineId] = useState<string | null>(null);
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
    setCoachId(null);
    setStaffId(null);
  }, [category]);

  // Reset selected slots when date changes (availability is per-date)
  useEffect(() => { setSelectedSlots([]); }, [selectedDate]);

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

  // Fetch machines once per center (used for the MACHINE category picker)
  useEffect(() => {
    if (!currentCenter) return;
    setMachinesLoading(true);
    fetch(`/api/admin/centers/${currentCenter.id}/machines`)
      .then((r) => r.ok ? r.json() : [])
      .then((rows: MachineLite[]) => setMachines(rows.filter((m) => m.isActive)))
      .catch(() => setMachines([]))
      .finally(() => setMachinesLoading(false));
  }, [currentCenter]);

  // Per-slot bookability under the current category
  const slotIsBookable = (s: ResourceSlot, cat: Category): { ok: boolean; reason?: string } => {
    if (cat === 'MACHINE') {
      if (s.freeIndoorNets.length === 0 && s.freeOutdoorResources.length === 0) {
        return { ok: false, reason: 'No nets free' };
      }
      return { ok: true };
    }
    if (cat === 'SIDEARM') {
      if (s.freeSidearmStaff.length === 0) return { ok: false, reason: 'No sidearm staff free' };
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
    return { ok: false };
  };

  /** Final ₹ for this slot under the active category — honours per-machine
   *  override (e.g. Yantra premium) when MACHINE category has a machine
   *  selected. Falls back to the base category rate otherwise. */
  const slotPriceFor = (s: ResourceSlot): number => {
    if (category === 'MACHINE' && machineId && s.machinePrices?.[machineId] != null) {
      return s.machinePrices[machineId];
    }
    return s.prices[category] || 0;
  };

  const totalPrice = useMemo(() => {
    return selectedSlots.reduce((sum, s) => sum + slotPriceFor(s), 0);
    // slotPriceFor depends on `category` and `machineId`, so list them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlots, category, machineId]);

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
    if (category === 'COACHING' && !coachId) {
      // Allowed — engine picks the first free coach if not pinned. But UX
      // is better if user explicitly chose. We'll let it through.
    }

    setSubmitting(true);
    try {
      const body = {
        slots: selectedSlots.map((s) => ({
          date: data!.date,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
        category,
        playerName: 'Player', // Phase 5b minimal: ask in confirm dialog later
        machineId: category === 'MACHINE' ? machineId : undefined,
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
            {data && data.sidearmStaffTotal > 0 ? ` · ${data.sidearmStaffTotal} sidearm staff` : ''}
          </p>
        </div>

        <DateSelector selectedDate={selectedDate} onSelect={setSelectedDate} />

        {/* Category tabs */}
        <div className="mb-5">
          <label className="block text-[10px] font-medium text-accent mb-2 uppercase tracking-wider">
            Session type
          </label>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {CATEGORIES.map(({ key, label, icon: Icon, sub }) => {
              const active = category === key;
              return (
                <button
                  key={key}
                  onClick={() => setCategory(key)}
                  className={`flex flex-col items-start gap-1 px-3 py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    active
                      ? 'bg-accent/10 border-accent/40 ring-1 ring-accent/30'
                      : 'bg-white/[0.02] border-white/[0.06] hover:border-accent/20 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className={`w-3.5 h-3.5 ${active ? 'text-accent' : 'text-slate-400'}`} />
                    <span className={`text-xs font-semibold ${active ? 'text-accent' : 'text-white'}`}>
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
                      className={`flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-lg text-xs font-semibold border cursor-pointer transition-all ${
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
                          className="w-7 h-7 rounded-md object-cover bg-white/5"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-md bg-white/5 flex items-center justify-center">
                          <Settings2 className="w-3.5 h-3.5 text-slate-500" />
                        </div>
                      )}
                      <span className="leading-tight text-left">
                        <span className="block">{m.name}</span>
                        <span className="block text-[10px] text-slate-500 font-medium">
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
            label="Sidearm staff"
            help="Leave empty to auto-assign."
            options={data?.slots[0]?.freeSidearmStaff ?? []}
            value={staffId}
            onChange={setStaffId}
            emptyMessage="No sidearm staff free for the selected slots."
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
