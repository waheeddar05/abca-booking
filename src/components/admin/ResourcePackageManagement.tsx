'use client';

/**
 * Package management UI for RESOURCE_BASED centers (Toplay et al.).
 *
 * Sister component to the legacy MACHINE_PITCH `AdminPackagesLegacy`
 * form in /admin/packages/page.tsx. The legacy form is shaped around
 * the (machineId enum × machineType × ballType × wicketType) tuple;
 * resource-based packages instead identify what they redeem for via
 * a BookingCategory + optional Machine row.
 *
 * Each package = N sessions of category X (optionally pinned to a
 * specific machine), expiring after `validityDays`. Bookings made
 * against the package via /api/slots/book-resource decrement
 * `usedSessions` atomically.
 */

import { useEffect, useState } from 'react';
import { Package, Plus, Pencil, Loader2, Trash2, ToggleLeft, ToggleRight, Sun, Moon, Clock, Calendar, Zap } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useCenter } from '@/lib/center-context';
import { PACKAGE_WICKET_LABEL, PACKAGE_CATEGORY_LABEL, ballOptionsFromEffective, coerceBallTypeFromEffective } from '@/lib/package-admin-labels';
import { LABEL_MAP } from '@/lib/client-constants';

const labelMap = LABEL_MAP;

const CATEGORY_OPTIONS = [
  { id: 'MACHINE', label: 'Bowling Machine' },
  { id: 'SIDEARM', label: 'Sidearm' },
  { id: 'COACHING', label: 'Personal Coaching' },
  { id: 'NET', label: 'Cricket Nets' },
  { id: 'FULL_COURT', label: 'Full Indoor Court' },
];

// Standardized timing labels — plain "Day" / "Evening" with "Any time"
// retained as the BOTH option for resource-based packages that aren't
// timing-restricted. Matches the labels used everywhere else in the
// admin packages UI (see src/lib/package-admin-labels.ts).
const TIMING_OPTIONS = [
  { id: 'DAY', label: 'Day' },
  { id: 'EVENING', label: 'Evening' },
];

interface CenterMachineLite {
  id: string;
  name: string;
  shortName?: string | null;
  isActive: boolean;
  // Machine catalog category. `ballType` is 'LEATHER' for leather
  // machines (Gravity/Yantra) and 'TENNIS' for tennis machines
  // (Master 200/iWinner/Leverage).
  machineType?: { ballType?: string } | null;
  // The ball types this specific machine actually supports, computed
  // server-side (machine restriction → machineType fallback). Tennis
  // machines resolve to ['TENNIS']; leather machines to
  // ['LEATHER','MACHINE']. Drives the Ball Type options when pinned.
  effectiveBallTypes?: string[] | null;
}

interface PackageRow {
  id: string;
  name: string;
  category: string | null;
  machineRowId: string | null;
  ballType: string | null;
  wicketType: string | null;
  timingType: string;
  totalSessions: number;
  validityDays: number;
  price: number;
  isActive: boolean;
  createdAt: string;
  // Extra-charge rules JSON. Toplay populates `timingUpgrade` (DAY →
  // evening), `ballTypeUpgrade` (MACHINE ball package → leather
  // booking), and `wicketTypeUpgrades` (per-path pitch upgrade fees).
  // The column carries the full ABCA-shape blob.
  extraChargeRules?: {
    timingUpgrade?: number;
    ballTypeUpgrade?: number;
    wicketTypeUpgrades?: Record<string, number>;
  } | null;
  _count?: { userPackages: number };
}

const inputClass =
  'w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent';

// Wicket-upgrade paths the admin can price independently. Same set as
// ABCA's `ALL_WICKET_UPGRADE_PATHS` at /admin/packages — keeps the
// JSON shape on `extraChargeRules.wicketTypeUpgrades` identical so
// the server can use the existing helper.
// Labels use the standardized PACKAGE_WICKET_LABEL ("Astroturf",
// "Cement", "Natural Turf") so the upgrade-path captions match the
// rest of the admin packages UI.
const WICKET_UPGRADE_PATHS: Array<{ from: string; to: string; label: string }> = [
  { from: 'ASTRO',  to: 'CEMENT',  label: `${PACKAGE_WICKET_LABEL.ASTRO} → ${PACKAGE_WICKET_LABEL.CEMENT}` },
  { from: 'ASTRO',  to: 'NATURAL', label: `${PACKAGE_WICKET_LABEL.ASTRO} → ${PACKAGE_WICKET_LABEL.NATURAL}` },
  { from: 'CEMENT', to: 'NATURAL', label: `${PACKAGE_WICKET_LABEL.CEMENT} → ${PACKAGE_WICKET_LABEL.NATURAL}` },
];

const emptyForm = {
  name: '',
  category: 'MACHINE' as string,
  machineRowId: '' as string,
  timingType: 'DAY' as string,
  totalSessions: 4,
  validityDays: 30,
  price: 1000,
  // Ball type the package covers for MACHINE category. MACHINE = the
  // package is for machine-balls only; LEATHER = leather-balls only.
  // Mirrors ABCA's `Package.ballType`. Only meaningful
  // when category=MACHINE; ignored for SIDEARM/COACHING/etc.
  ballType: 'MACHINE' as string,
  // Wicket type the package covers. ASTRO/CEMENT/NATURAL pin to a
  // specific pitch. Only meaningful when category uses
  // a pitch (MACHINE / SIDEARM / NET). Mirrors ABCA's
  // `Package.wicketType`.
  wicketType: 'ASTRO' as string,
  // Per-slot extra charge when a DAY package is redeemed against an
  // evening slot. Mirrors ABCA's `extraChargeRules.timingUpgrade`.
  // Default 0 = no upgrade fee (DAY packages can't cover evening).
  // Set to e.g. 125 to charge ₹125/slot when DAY package books evening.
  timingUpgrade: 0,
  // Per-slot extra charge when a MACHINE-ball package is redeemed
  // against a leather-ball booking. Mirrors ABCA's
  // `extraChargeRules.ballTypeUpgrade` (default 100). Only meaningful
  // when ballType=MACHINE.
  ballTypeUpgrade: 0,
  // Per-path wicket upgrade fees, keyed by `${from}_TO_${to}`. Same
  // shape ABCA writes to `extraChargeRules.wicketTypeUpgrades`. Only
  // meaningful when wicketType is a specific pitch (not BOTH).
  wicketTypeUpgrades: {} as Record<string, number>,
};

export function ResourcePackageManagement() {
  const { currentCenter } = useCenter();
  const toast = useToast();

  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [machines, setMachines] = useState<CenterMachineLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...emptyForm });

  const reload = async () => {
    if (!currentCenter) return;
    setLoading(true);
    try {
      const [pkgRes, mRes] = await Promise.all([
        fetch('/api/admin/packages').then((r) => (r.ok ? r.json() : [])),
        fetch(`/api/centers/${currentCenter.id}/machines`).then((r) => (r.ok ? r.json() : [])),
      ]);
      setPackages(Array.isArray(pkgRes) ? pkgRes : []);
      setMachines(
        (Array.isArray(mRes) ? mRes : []).filter((m: CenterMachineLite) => m.isActive),
      );
    } catch {
      toast.error('Failed to load packages');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCenter?.id]);

  const reset = () => {
    setEditingId(null);
    setShowForm(false);
    setForm({ ...emptyForm });
  };

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required');
      return;
    }
    if (form.totalSessions < 1) {
      toast.error('Sessions must be at least 1');
      return;
    }
    if (form.price < 0) {
      toast.error('Price must be non-negative');
      return;
    }
    setSubmitting(true);
    try {
      // The legacy machineType field is required by the API (non-null
      // column). For resource-based packages we always send 'LEATHER'
      // as a placeholder — the new `category` field is the real
      // discriminator and the old field is unused at redemption time.
      // Categories that involve a pitch (and therefore a wicket type).
      // ABCA's wicket-upgrade concept only applies when there's an
      // actual pitch to upgrade between.
      const wicketRelevantCategories = new Set(['MACHINE', 'SIDEARM', 'NET']);

      // Resolve the pinned machine's ball-type category. Tennis machines
      // get machineType=TENNIS so the (Machine/Tennis) ballType passes
      // the server-side compatibility check; everything else stays
      // LEATHER (the placeholder the resource model has always used).
      const submitMachine = machines.find((m) => m.id === form.machineRowId);
      const submitMachineType = submitMachine?.machineType?.ballType === 'TENNIS' ? 'TENNIS' : 'LEATHER';

      // Assemble `extraChargeRules`:
      //   - timingUpgrade: applies only when timingType=DAY
      //   - ballTypeUpgrade: applies only when category=MACHINE AND
      //     ballType=MACHINE
      //   - wicketTypeUpgrades: per-path map (ASTRO_TO_CEMENT etc.)
      //     applies only when wicketType is a specific pitch
      // Anything else stays out of the JSON blob so the server-side
      // validator doesn't fire on an axis the package already covers.
      const rules: {
        timingUpgrade?: number;
        ballTypeUpgrade?: number;
        wicketTypeUpgrades?: Record<string, number>;
      } = {};
      if (form.timingType === 'DAY' && form.timingUpgrade > 0) {
        rules.timingUpgrade = form.timingUpgrade;
      }
      if (
        form.category === 'MACHINE'
        && form.ballType === 'MACHINE'
        && submitMachineType !== 'TENNIS'
        && form.ballTypeUpgrade > 0
      ) {
        rules.ballTypeUpgrade = form.ballTypeUpgrade;
      }
      if (
        wicketRelevantCategories.has(form.category)
      ) {
        // Keep only paths that *start* at the package's wicketType
        // (upgrading FROM that pitch to a higher tier). Drops stale
        // entries left over from changing wicketType in the form.
        const filtered: Record<string, number> = {};
        for (const [key, val] of Object.entries(form.wicketTypeUpgrades)) {
          if (val > 0 && key.startsWith(`${form.wicketType}_TO_`)) {
            filtered[key] = val;
          }
        }
        if (Object.keys(filtered).length > 0) {
          rules.wicketTypeUpgrades = filtered;
        }
      }
      const extraChargeRules = Object.keys(rules).length > 0 ? rules : null;

      // ballType + wicketType are only meaningful for the relevant
      // categories. Sending null elsewhere keeps the columns clean.
      const ballType = form.category === 'MACHINE' ? form.ballType : null;
      const wicketType = wicketRelevantCategories.has(form.category)
        ? form.wicketType
        : null;

      const body = {
        name: form.name,
        category: form.category,
        machineRowId: form.machineRowId || null,
        machineType: submitMachineType,
        ballType,
        wicketType,
        timingType: form.timingType,
        totalSessions: form.totalSessions,
        validityDays: form.validityDays,
        price: form.price,
        extraChargeRules,
      };
      const res = editingId
        ? await fetch('/api/admin/packages', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: editingId, ...body }),
          })
        : await fetch('/api/admin/packages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      toast.success(editingId ? 'Package updated' : 'Package created');
      reset();
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (p: PackageRow) => {
    // Pull existing extraChargeRules off the JSON blob (if any) so
    // editing a saved package round-trips the same values back into
    // the inputs.
    const rules = p.extraChargeRules ?? null;
    setEditingId(p.id);
    setShowForm(true);
    setForm({
      name: p.name,
      category: (p.category ?? 'MACHINE') as string,
      machineRowId: p.machineRowId ?? '',
      ballType: (p.ballType ?? 'MACHINE') as string,
      wicketType: (p.wicketType ?? 'ASTRO') as string,
      timingType: p.timingType ?? 'DAY',
      totalSessions: p.totalSessions,
      validityDays: p.validityDays,
      price: p.price,
      timingUpgrade: rules?.timingUpgrade ?? 0,
      ballTypeUpgrade: rules?.ballTypeUpgrade ?? 0,
      wicketTypeUpgrades: rules?.wicketTypeUpgrades ?? {},
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleActive = async (p: PackageRow) => {
    try {
      const res = await fetch('/api/admin/packages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, isActive: !p.isActive }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update');
      }
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  // Ball Type options follow the *pinned* machine's actual supported
  // ball types. A tennis machine (e.g. Master 200) supports tennis only,
  // so its dropdown shows just "Tennis"; a leather machine shows
  // "Leather" / "Machine". With no machine pinned we fall back to the
  // broad Machine / Leather set.
  const selectedMachine = machines.find((m) => m.id === form.machineRowId);
  const ballTypeOptions = ballOptionsFromEffective(selectedMachine?.effectiveBallTypes);
  const isTennisMachine = selectedMachine?.machineType?.ballType === 'TENNIS';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          {packages.length} {packages.length === 1 ? 'Package' : 'Packages'}
        </h3>
        <button
          onClick={() => {
            if (showForm) reset();
            else setShowForm(true);
          }}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-4 py-2 rounded-lg text-sm font-bold transition-all cursor-pointer shadow-lg shadow-accent/10 active:scale-95"
        >
          {showForm && !editingId ? (
            <>Cancel</>
          ) : (
            <>
              <Plus className="w-4 h-4" />
              Create Package
            </>
          )}
        </button>
      </div>

      {/* Add / edit form */}
      {showForm && (
        <div className={`bg-white/[0.03] border rounded-xl p-4 animate-in fade-in slide-in-from-top-2 duration-300 ${
          editingId ? 'border-accent/40 ring-1 ring-accent/20' : 'border-white/[0.07]'
        }`}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-accent" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                {editingId ? 'Edit Package' : 'Create Package'}
              </h3>
              {editingId && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/15 text-accent font-semibold uppercase tracking-wider">
                  Editing
                </span>
              )}
            </div>
            {editingId && (
              <button
                type="button"
                onClick={reset}
                className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer"
                title="Discard changes and start fresh"
              >
                Cancel edit
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Name *</label>
              <input
                type="text"
                value={form.name}
                placeholder="e.g. 10 sessions of bowling machine"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Category *</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value, machineRowId: '', ballType: 'MACHINE' })}
                className={inputClass}
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.id} value={c.id} className="bg-[#1a2a40]">
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {form.category === 'MACHINE' && machines.length > 0 && (
            <div className="mt-3">
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Machine (optional) <span className="text-slate-600">— pin redemption to one machine</span>
              </label>
              <select
                value={form.machineRowId}
                onChange={(e) => {
                  const m = machines.find((mm) => mm.id === e.target.value);
                  // Auto-clear an incompatible ball type when pinning a
                  // machine that doesn't support the current selection
                  // (e.g. Leather → a tennis machine that only offers Tennis).
                  setForm({ ...form, machineRowId: e.target.value, ballType: coerceBallTypeFromEffective(m?.effectiveBallTypes, form.ballType) });
                }}
                className={inputClass}
              >
                <option value="" className="bg-[#1a2a40]">Any machine of this category</option>
                {machines.map((m) => (
                  <option key={m.id} value={m.id} className="bg-[#1a2a40]">
                    {m.shortName ?? m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Sessions *</label>
              <input
                type="number"
                min={1}
                value={form.totalSessions}
                onChange={(e) => setForm({ ...form, totalSessions: parseInt(e.target.value, 10) || 0 })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Validity (days) *</label>
              <input
                type="number"
                min={1}
                value={form.validityDays}
                onChange={(e) => setForm({ ...form, validityDays: parseInt(e.target.value, 10) || 0 })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Price (₹) *</label>
              <input
                type="number"
                min={0}
                value={form.price}
                onChange={(e) => setForm({ ...form, price: parseInt(e.target.value, 10) || 0 })}
                className={inputClass}
              />
            </div>
          </div>

          {/* Ball type — only meaningful for MACHINE category packages.
              Options mirror the pinned machine's supported ball types:
              leather machines → Leather / Machine, tennis machines →
              Tennis only. */}
          {form.category === 'MACHINE' && (
            <div className="mt-3">
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Ball type</label>
              <select
                value={form.ballType}
                onChange={(e) => setForm({ ...form, ballType: e.target.value })}
                className={inputClass}
              >
                {ballTypeOptions.map((o) => (
                  <option key={o.value} value={o.value} className="bg-[#1a2a40]">{o.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Leather upgrade fee — leather machines only. Tennis machines
              have no leather-ball axis, so the fee doesn't apply. */}
          {form.category === 'MACHINE' && form.ballType === 'MACHINE' && !isTennisMachine && (
            <div className="mt-3">
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Leather upgrade (₹ per slot)
              </label>
              <input
                type="number"
                min={0}
                value={form.ballTypeUpgrade}
                onChange={(e) =>
                  setForm({ ...form, ballTypeUpgrade: parseInt(e.target.value, 10) || 0 })
                }
                placeholder="0 = no upgrade allowed"
                className={inputClass}
              />
              <p className="mt-1 text-[10px] text-slate-500">
                Charged per slot when a user with this machine-ball package books a leather-ball
                session. Set to 0 to disallow leather-ball redemption entirely.
              </p>
            </div>
          )}

          {/* Wicket / pitch type */}
          {(form.category === 'MACHINE' || form.category === 'SIDEARM' || form.category === 'NET') && (
            <div className="mt-3">
              <label className="block text-[11px] font-medium text-slate-400 mb-1">Wicket type</label>
              <select
                value={form.wicketType}
                onChange={(e) => setForm({ ...form, wicketType: e.target.value })}
                className={inputClass}
              >
                <option value="ASTRO"   className="bg-[#1a2a40]">{PACKAGE_WICKET_LABEL.ASTRO}</option>
                <option value="CEMENT"  className="bg-[#1a2a40]">{PACKAGE_WICKET_LABEL.CEMENT}</option>
                <option value="NATURAL" className="bg-[#1a2a40]">{PACKAGE_WICKET_LABEL.NATURAL}</option>
              </select>
            </div>
          )}

          {/* Wicket upgrade paths */}
          {(form.category === 'MACHINE' || form.category === 'SIDEARM' || form.category === 'NET')
            && WICKET_UPGRADE_PATHS.some((p) => p.from === form.wicketType) && (
            <div className="mt-3">
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Wicket upgrade paths (₹ per slot)
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {WICKET_UPGRADE_PATHS
                  .filter((path) => path.from === form.wicketType)
                  .map((path) => {
                    const key = `${path.from}_TO_${path.to}`;
                    return (
                      <div
                        key={key}
                        className="bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.06]"
                      >
                        <label className="block text-[10px] text-accent/80 font-medium mb-1">
                          {path.label}
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-slate-500">₹</span>
                          <input
                            type="number"
                            min={0}
                            value={form.wicketTypeUpgrades?.[key] || 0}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                wicketTypeUpgrades: {
                                  ...form.wicketTypeUpgrades,
                                  [key]: parseInt(e.target.value, 10) || 0,
                                },
                              })
                            }
                            placeholder="0"
                            className={inputClass}
                          />
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          <div className="mt-3">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Timing</label>
            <select
              value={form.timingType}
              onChange={(e) => setForm({ ...form, timingType: e.target.value })}
              className={inputClass}
            >
              {TIMING_OPTIONS.map((t) => (
                <option key={t.id} value={t.id} className="bg-[#1a2a40]">
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Evening upgrade fee */}
          {form.timingType === 'DAY' && (
            <div className="mt-3">
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Evening upgrade (₹ per slot)
              </label>
              <input
                type="number"
                min={0}
                value={form.timingUpgrade}
                onChange={(e) =>
                  setForm({ ...form, timingUpgrade: parseInt(e.target.value, 10) || 0 })
                }
                placeholder="0 = no upgrade allowed"
                className={inputClass}
              />
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <button
              onClick={submit}
              disabled={submitting}
              className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-6 py-2.5 rounded-xl text-sm font-bold transition-all cursor-pointer disabled:opacity-50 shadow-lg shadow-accent/10 active:scale-95"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {editingId ? 'Update Package' : 'Create Package'}
            </button>
            <button
              onClick={reset}
              className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {packages.length === 0 ? (
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-8 text-center">
          <Package className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-500 italic">No packages yet. Click &lsquo;Create Package&rsquo; to start.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {packages.map((p) => {
            const cat = (p.category ?? 'MACHINE') as string;
            const machineName = p.machineRowId
              ? machines.find((m) => m.id === p.machineRowId)?.shortName ?? machines.find((m) => m.id === p.machineRowId)?.name
              : null;
            const showBallType = cat === 'MACHINE' && !!p.ballType;

            return (
              <div
                key={p.id}
                className="bg-white/[0.04] backdrop-blur-sm rounded-xl border border-white/[0.08] hover:border-white/[0.12] transition-colors"
              >
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-white leading-tight">{p.name}</h4>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-purple-500/15 text-purple-300">
                          {PACKAGE_CATEGORY_LABEL[cat] || cat}
                        </span>
                        {!p.isActive && (
                          <span className="text-[10px] text-slate-500 px-1.5 py-0.5 rounded bg-slate-500/10">
                            inactive
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                        {cat === 'MACHINE' && machineName && (
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Package className="w-3 h-3 text-slate-500" />
                            {machineName}
                          </span>
                        )}
                        {showBallType && (
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <Zap className="w-3 h-3 text-slate-500" />
                            {labelMap[p.ballType!] || p.ballType}
                          </span>
                        )}
                        {p.wicketType && (
                          <span className="text-[10px] text-slate-400 flex items-center gap-1">
                            <span className="text-slate-500">Pitch:</span>
                            <span className="text-slate-300">{PACKAGE_WICKET_LABEL[p.wicketType] || p.wicketType}</span>
                          </span>
                        )}
                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                          {p.timingType === 'DAY' ? <Sun className="w-3 h-3 text-slate-500" /> : p.timingType === 'EVENING' ? <Moon className="w-3 h-3 text-slate-500" /> : <Clock className="w-3 h-3 text-slate-500" />}
                          {TIMING_OPTIONS.find(t => t.id === p.timingType)?.label || p.timingType}
                        </span>
                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-slate-500" />
                          {p.totalSessions} Sessions · {p.validityDays} Days Validity
                        </span>
                        {p._count && p._count.userPackages > 0 && (
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                            <Plus className="w-3 h-3" />
                            {p._count.userPackages} purchased
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <span className="text-sm font-bold text-accent">₹{p.price}</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => toggleActive(p)}
                          className="p-1.5 text-slate-500 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
                          title={p.isActive ? 'Deactivate' : 'Activate'}
                        >
                          {p.isActive ? <ToggleRight className="w-4 h-4 text-accent" /> : <ToggleLeft className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => startEdit(p)}
                          className="p-1.5 text-accent hover:bg-accent/10 rounded-lg transition-colors cursor-pointer"
                          title="Edit this package"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
