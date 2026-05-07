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
  timingType: string;
  totalSessions: number;
  validityDays: number;
  price: number;
  isActive: boolean;
  createdAt: string;
  _count?: { userPackages: number };
}

const inputClass =
  'w-full bg-white/[0.04] border border-white/[0.1] text-white placeholder:text-slate-500 rounded-lg px-3 py-2 text-sm outline-none focus:border-accent';

const emptyForm = {
  name: '',
  category: 'MACHINE' as string,
  machineRowId: '' as string,
  timingType: 'BOTH' as string,
  totalSessions: 4,
  validityDays: 30,
  price: 1000,
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
      const body = {
        name: form.name,
        category: form.category,
        machineRowId: form.machineRowId || null,
        machineType: 'LEATHER',
        timingType: form.timingType,
        totalSessions: form.totalSessions,
        validityDays: form.validityDays,
        price: form.price,
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
    setEditingId(p.id);
    setForm({
      name: p.name,
      category: (p.category ?? 'MACHINE') as string,
      machineRowId: p.machineRowId ?? '',
      timingType: p.timingType,
      totalSessions: p.totalSessions,
      validityDays: p.validityDays,
      price: p.price,
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
