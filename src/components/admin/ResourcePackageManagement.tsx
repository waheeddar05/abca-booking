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
import { Package, Plus, Pencil, Loader2, Trash2, ToggleLeft, ToggleRight } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useCenter } from '@/lib/center-context';

const CATEGORY_OPTIONS = [
  { id: 'MACHINE', label: 'Bowling Machine' },
  { id: 'SIDEARM', label: 'Sidearm' },
  { id: 'COACHING', label: 'Personal Coaching' },
  { id: 'NET', label: 'Cricket Nets' },
  { id: 'FULL_COURT', label: 'Full Indoor Court' },
];

const TIMING_OPTIONS = [
  { id: 'DAY', label: 'Day (morning slabs)' },
  { id: 'EVENING', label: 'Evening' },
  { id: 'BOTH', label: 'Any time' },
];

interface CenterMachineLite {
  id: string;
  name: string;
  shortName?: string | null;
  isActive: boolean;
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
const WICKET_UPGRADE_PATHS: Array<{ from: string; to: string; label: string }> = [
  { from: 'ASTRO',  to: 'CEMENT',  label: 'Astro Turf → Cement' },
  { from: 'ASTRO',  to: 'NATURAL', label: 'Astro Turf → Natural Turf' },
  { from: 'CEMENT', to: 'NATURAL', label: 'Cement → Natural Turf' },
];

const emptyForm = {
  name: '',
  category: 'MACHINE' as string,
  machineRowId: '' as string,
  timingType: 'BOTH' as string,
  totalSessions: 4,
  validityDays: 30,
  price: 1000,
  // Ball type the package covers for MACHINE category. MACHINE = the
  // package is for machine-balls only; LEATHER = leather-balls only;
  // BOTH = either. Mirrors ABCA's `Package.ballType`. Only meaningful
  // when category=MACHINE; ignored for SIDEARM/COACHING/etc.
  ballType: 'BOTH' as string,
  // Wicket type the package covers. ASTRO/CEMENT/NATURAL pin to a
  // specific pitch; BOTH = any. Only meaningful when category uses
  // a pitch (MACHINE / SIDEARM / NET). Mirrors ABCA's
  // `Package.wicketType`.
  wicketType: 'BOTH' as string,
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
  const [form, setForm] = useState({ ...emptyForm });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
        && form.ballTypeUpgrade > 0
      ) {
        rules.ballTypeUpgrade = form.ballTypeUpgrade;
      }
      if (
        wicketRelevantCategories.has(form.category)
        && form.wicketType !== 'BOTH'
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
        machineType: 'LEATHER',
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
    setForm({
      name: p.name,
      category: (p.category ?? 'MACHINE') as string,
      machineRowId: p.machineRowId ?? '',
      ballType: (p.ballType ?? 'BOTH') as string,
      wicketType: (p.wicketType ?? 'BOTH') as string,
      timingType: p.timingType,
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

  return (
    <div className="space-y-5">
      {/* Add / edit form */}
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Package className="w-4 h-4 text-accent" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">
            {editingId ? 'Edit Package' : 'Create Package'}
          </h3>
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
              onChange={(e) => setForm({ ...form, category: e.target.value, machineRowId: '' })}
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
              onChange={(e) => setForm({ ...form, machineRowId: e.target.value })}
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
            Determines which ball types this package covers (same model
            as ABCA's `Package.ballType`):
              MACHINE → machine-balls only (cheaper)
              LEATHER → leather-balls only (premium)
              BOTH    → either, no upgrade fee ever
            Hidden for SIDEARM/COACHING/etc. where there's no bowling
            machine and ballType doesn't apply. */}
        {form.category === 'MACHINE' && (
          <div className="mt-3">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Ball type</label>
            <select
              value={form.ballType}
              onChange={(e) => setForm({ ...form, ballType: e.target.value })}
              className={inputClass}
            >
              <option value="BOTH" className="bg-[#1a2a40]">Both (machine + leather)</option>
              <option value="MACHINE" className="bg-[#1a2a40]">Machine balls only</option>
              <option value="LEATHER" className="bg-[#1a2a40]">Leather balls only</option>
            </select>
          </div>
        )}

        {/* Leather upgrade fee — only relevant when the package is
            machine-ball only. ABCA exposes the same control under
            `extraChargeRules.ballTypeUpgrade`. Leave at 0 to keep
            machine-ball packages strictly machine-ball; set > 0 to
            let users redeem on a leather-ball slot for the fee. */}
        {form.category === 'MACHINE' && form.ballType === 'MACHINE' && (
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

        {/* Wicket / pitch type — only meaningful for categories that
            involve a pitch (MACHINE / SIDEARM / NET). Determines which
            pitch this package covers; users booking on a higher tier
            (Astro → Cement → Natural) pay the path-specific upgrade
            fee below. Mirrors ABCA's `Package.wicketType`. */}
        {(form.category === 'MACHINE' || form.category === 'SIDEARM' || form.category === 'NET') && (
          <div className="mt-3">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Wicket type</label>
            <select
              value={form.wicketType}
              onChange={(e) => setForm({ ...form, wicketType: e.target.value })}
              className={inputClass}
            >
              <option value="BOTH"    className="bg-[#1a2a40]">Any wicket</option>
              <option value="ASTRO"   className="bg-[#1a2a40]">Astro Turf only</option>
              <option value="CEMENT"  className="bg-[#1a2a40]">Cement only</option>
              <option value="NATURAL" className="bg-[#1a2a40]">Natural Turf only</option>
            </select>
          </div>
        )}

        {/* Wicket upgrade paths — only when the package pins a specific
            pitch (not "Any wicket"). Renders only the paths that start
            at the chosen pitch, since downgrade paths don't apply. Same
            shape ABCA writes to `extraChargeRules.wicketTypeUpgrades`. */}
        {(form.category === 'MACHINE' || form.category === 'SIDEARM' || form.category === 'NET')
          && form.wicketType !== 'BOTH'
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
            <p className="mt-1 text-[10px] text-slate-500">
              Charged per slot when a user with this {form.wicketType.toLowerCase()} package books
              a higher-tier pitch. Set 0 on a path to disallow that upgrade entirely.
            </p>
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

        {/* Evening upgrade fee — only relevant when the package is
            DAY-only. ABCA exposes the same control under
            `extraChargeRules.timingUpgrade`. Leave at 0 to keep DAY
            packages strictly daytime; set > 0 to let users redeem on
            an evening slot for the extra fee per session. */}
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
            <p className="mt-1 text-[10px] text-slate-500">
              Charged per slot when a user redeems this DAY package on an evening slot.
              Set to 0 to disallow evening redemption entirely.
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-4">
          <button
            onClick={submit}
            disabled={submitting}
            className="inline-flex items-center gap-2 bg-accent hover:bg-accent-light text-primary px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {editingId ? 'Update' : 'Create'}
          </button>
          {editingId && (
            <button
              onClick={reset}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Package className="w-4 h-4 text-accent" />
          <h3 className="text-xs font-bold text-white uppercase tracking-wider">Packages</h3>
        </div>
        {packages.length === 0 ? (
          <p className="text-xs text-slate-500 italic py-6 text-center">No packages yet.</p>
        ) : (
          <div className="space-y-2">
            {packages.map((p) => {
              const machineName = p.machineRowId
                ? machines.find((m) => m.id === p.machineRowId)?.shortName ?? machines.find((m) => m.id === p.machineRowId)?.name
                : null;
              return (
                <div
                  key={p.id}
                  className="flex items-start justify-between gap-3 bg-white/[0.02] border border-white/[0.06] rounded-lg px-3 py-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{p.name}</span>
                      {!p.isActive && (
                        <span className="text-[10px] text-slate-500 px-1.5 py-0.5 rounded bg-slate-500/10">
                          inactive
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                      {p.category && (
                        <span className="text-[10px] text-purple-300/80 px-1.5 py-0.5 rounded bg-purple-500/10">
                          {CATEGORY_OPTIONS.find((c) => c.id === p.category)?.label ?? p.category}
                        </span>
                      )}
                      {machineName && (
                        <span className="text-[10px] text-cyan-300/80 px-1.5 py-0.5 rounded bg-cyan-500/10">
                          {machineName}
                        </span>
                      )}
                      <span className="text-[10px] text-slate-300 px-1.5 py-0.5 rounded bg-white/[0.04]">
                        {p.totalSessions} sessions · {p.validityDays}d · ₹{p.price}
                      </span>
                      <span className="text-[10px] text-slate-300 px-1.5 py-0.5 rounded bg-white/[0.04]">
                        {p.timingType.toLowerCase()}
                      </span>
                      {p._count && p._count.userPackages > 0 && (
                        <span className="text-[10px] text-emerald-300/80 px-1.5 py-0.5 rounded bg-emerald-500/10">
                          {p._count.userPackages} purchased
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 gap-1">
                    <button
                      onClick={() => toggleActive(p)}
                      className="p-1.5 text-slate-500 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
                      title={p.isActive ? 'Deactivate' : 'Activate'}
                    >
                      {p.isActive ? <ToggleRight className="w-4 h-4 text-accent" /> : <ToggleLeft className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => startEdit(p)}
                      className="p-1.5 text-slate-500 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteId(p.id)}
                      className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                      title="Delete"
                      disabled
                    >
                      <Trash2 className="w-3.5 h-3.5 opacity-30" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete package?"
        message="Existing user packages remain valid; the package just becomes uneditable. This is irreversible."
        confirmLabel="Delete"
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
