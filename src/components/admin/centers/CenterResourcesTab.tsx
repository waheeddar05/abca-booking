'use client';

import { useEffect, useState } from 'react';
import { Plus, Loader2, Trash2, Pencil, Check, X, Eye, EyeOff, Power, PowerOff } from 'lucide-react';
import { Field, TextInput, NumberInput, SelectInput, PrimaryButton, SecondaryButton, Banner } from './centerForms';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

type ResourceRow = {
  id: string;
  name: string;
  type: 'NET' | 'TURF_WICKET' | 'CEMENT_WICKET' | 'COURT';
  category: 'INDOOR' | 'OUTDOOR';
  capacity: number;
  isActive: boolean;
  displayOrder: number;
  _count?: { machines: number };
};

const TYPE_LABELS: Record<ResourceRow['type'], string> = {
  // The TYPE enum is a physical surface; the admin UI presents it purely
  // as a "Pitch Type" so it matches the booking screen's pitch picker
  // (Astro Turf / Natural Turf / Cement). NET is the indoor synthetic
  // turf → "Astro Turf"; TURF_WICKET → "Natural Turf"; CEMENT_WICKET →
  // "Cement". COURT is legacy/unused (Full Indoor Court is a booking
  // category, not a surface) — kept only so any old row still renders.
  NET: 'Astro Turf',
  TURF_WICKET: 'Natural Turf',
  CEMENT_WICKET: 'Cement',
  COURT: 'Full court (legacy)',
};

// Maps a pitch-type selection to the Resource.category the engine
// expects: Astro Turf is the INDOOR net pool; Natural Turf and Cement
// are OUTDOOR surfaces. Keeps freeIndoorNets / freeOutdoorResources and
// the per-pitch pools correct without exposing a separate category field.
function categoryForType(type: ResourceRow['type']): ResourceRow['category'] {
  return type === 'NET' ? 'INDOOR' : 'OUTDOOR';
}

export function CenterResourcesTab({ centerId }: { centerId: string }) {
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    warning?: string;
    confirmLabel: string;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/centers/${centerId}/resources`);
      if (res.ok) setResources(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [centerId]);

  // Soft delete — sets isActive=false. Existing bookings keep their
  // BookingResourceAssignment refs intact; the resource just stops
  // appearing in pickers and counting toward live capacity.
  const deactivate = (id: string) => {
    setPendingConfirm({
      title: 'Deactivate pitch type?',
      message: 'Existing bookings retain their reference; new bookings cannot use it. You can re-activate it later.',
      confirmLabel: 'Deactivate',
      onConfirm: () => doDeactivate(id),
    });
  };

  const doDeactivate = async (id: string) => {
    setActionError(null);
    const res = await fetch(`/api/admin/centers/${centerId}/resources/${id}`, { method: 'DELETE' });
    if (res.ok) refresh();
    else {
      const data = await res.json().catch(() => ({}));
      setActionError(data?.error || `Deactivate failed (HTTP ${res.status})`);
    }
  };

  // Re-activate a previously deactivated pitch type. Non-destructive, so
  // it applies immediately without a confirmation dialog.
  const activate = async (id: string) => {
    setActionError(null);
    const res = await fetch(`/api/admin/centers/${centerId}/resources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: true }),
    });
    if (res.ok) refresh();
    else {
      const data = await res.json().catch(() => ({}));
      setActionError(data?.error || `Activate failed (HTTP ${res.status})`);
    }
  };

  // Hard delete — only allowed when nothing references the resource.
  // The server rejects with 409 + a count of linked bookings / machines
  // when refs exist; we render that message so the admin knows why.
  const hardDelete = (r: ResourceRow) => {
    setPendingConfirm({
      title: 'Delete permanently?',
      message: `Permanently delete "${r.name}"? Bookings or machines that reference this pitch type will block the delete.`,
      warning: 'This cannot be undone.',
      confirmLabel: 'Delete',
      onConfirm: () => doHardDelete(r),
    });
  };

  const doHardDelete = async (r: ResourceRow) => {
    setActionError(null);
    const res = await fetch(`/api/admin/centers/${centerId}/resources/${r.id}?hard=true`, { method: 'DELETE' });
    if (res.ok) {
      refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setActionError(data?.error || `Delete failed (HTTP ${res.status})`);
  };

  const handleConfirm = async () => {
    if (!pendingConfirm) return;
    setConfirmLoading(true);
    try {
      await pendingConfirm.onConfirm();
    } finally {
      setConfirmLoading(false);
      setPendingConfirm(null);
    }
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-slate-400 py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }

  // Default view hides inactive rows so the list isn't cluttered by
  // soft-deleted resources kept around for audit. Toggle reveals them
  // with a 'Delete permanently' affordance.
  const visibleResources = showInactive ? resources : resources.filter((r) => r.isActive);
  const inactiveCount = resources.filter((r) => !r.isActive).length;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <p className="text-[11px] text-slate-500 leading-tight flex-1">
          Pitch types (Astro Turf, Natural Turf, Cement) and their capacity. Used by the resource-based engine.
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          {inactiveCount > 0 && (
            <SecondaryButton onClick={() => setShowInactive((v) => !v)} className="!px-2 !py-1 !text-[10px] rounded-md">
              {showInactive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showInactive ? 'Hide' : `Show (${inactiveCount})`}
            </SecondaryButton>
          )}
          <PrimaryButton onClick={() => setShowNew(true)} className="shrink-0">
            <Plus className="w-4 h-4" /> Add pitch type
          </PrimaryButton>
        </div>
      </div>

      {actionError && <Banner kind="error">{actionError}</Banner>}

      {showNew && (
        <ResourceEditor
          centerId={centerId}
          onCancel={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); refresh(); }}
        />
      )}

      {visibleResources.length === 0 ? (
        <div className="text-center text-slate-500 py-6 text-sm">
          {resources.length === 0
            ? 'No pitch types configured.'
            : 'No active pitch types.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
          {visibleResources.map((r) => (
            <div key={r.id} className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-2.5">
              {editingId === r.id ? (
                <ResourceEditor
                  centerId={centerId}
                  initial={r}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => { setEditingId(null); refresh(); }}
                />
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-semibold text-white">{r.name}</span>
                      {!r.isActive && <span className="text-[9px] px-1 py-0.5 rounded bg-red-500/10 text-red-400 uppercase tracking-wide">inactive</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 whitespace-nowrap">
                      {TYPE_LABELS[r.type]} · Capacity {r.capacity}
                    </div>
                  </div>
                  <div className="flex gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => setEditingId(r.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white cursor-pointer"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    {r.isActive ? (
                      <button
                        onClick={() => deactivate(r.id)}
                        className="p-1.5 rounded-lg text-amber-400/70 hover:bg-amber-500/10 hover:text-amber-400 cursor-pointer"
                        title="Deactivate"
                      >
                        <PowerOff className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => activate(r.id)}
                          className="p-1.5 rounded-lg text-emerald-400/70 hover:bg-emerald-500/10 hover:text-emerald-400 cursor-pointer"
                          title="Activate"
                        >
                          <Power className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => hardDelete(r)}
                          className="p-1.5 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                          title="Delete permanently"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.title || ''}
        message={pendingConfirm?.message || ''}
        warning={pendingConfirm?.warning}
        confirmLabel={pendingConfirm?.confirmLabel || 'Confirm'}
        variant="danger"
        loading={confirmLoading}
        onConfirm={handleConfirm}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}

function ResourceEditor({
  centerId,
  initial,
  onCancel,
  onSaved,
}: {
  centerId: string;
  initial?: Partial<ResourceRow>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial?.id;
  const [name, setName] = useState(initial?.name || '');
  const [type, setType] = useState<ResourceRow['type']>(initial?.type || 'NET');
  const [capacity, setCapacity] = useState<number>(initial?.capacity ?? 1);
  // Category is derived from the pitch type on save (Astro → INDOOR,
  // Natural/Cement → OUTDOOR) so the engine's pools stay correct without
  // a separate field. displayOrder / isActive are preserved from the row.
  const displayOrder: number = initial?.displayOrder ?? 0;
  const isActive: boolean = initial?.isActive ?? true;
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const url = isEdit
        ? `/api/admin/centers/${centerId}/resources/${initial!.id}`
        : `/api/admin/centers/${centerId}/resources`;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, category: categoryForType(type), capacity, displayOrder, isActive }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data?.error || 'Save failed');
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-3 rounded-xl bg-white/[0.02] border border-white/[0.06] p-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Name" required>
          <TextInput required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Astro Turf" className="!py-1.5 !text-xs" />
        </Field>
        <Field label="Pitch Type" required>
          <SelectInput value={type} onChange={(e) => setType(e.target.value as ResourceRow['type'])} className="!py-1.5 !text-xs">
            <option value="NET">Astro Turf</option>
            <option value="TURF_WICKET">Natural Turf</option>
            <option value="CEMENT_WICKET">Cement</option>
            {/* Legacy fallback: only shown when editing an old "Full court"
                row so saving it doesn't silently change its type. New rows
                can't pick it. */}
            {initial?.type === 'COURT' && <option value="COURT">Full court (legacy)</option>}
          </SelectInput>
        </Field>
        <div className="col-span-2 sm:col-span-1">
          <Field label="Capacity" help="Concurrent bookings supported. Default 1.">
            <NumberInput min={1} value={capacity} onChange={(e) => setCapacity(Math.max(1, Number(e.target.value)))} className="!py-1.5 !text-xs" />
          </Field>
        </div>
      </div>
      {/* Category is derived from the pitch type on save (see
          categoryForType); displayOrder / isActive are preserved from the
          row. None are surfaced as fields — they were near-never used. */}

      {err && <Banner kind="error">{err}</Banner>}

      <div className="flex justify-end gap-2">
        <SecondaryButton type="button" onClick={onCancel}>
          <X className="w-4 h-4" /> Cancel
        </SecondaryButton>
        <PrimaryButton type="submit" disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          {isEdit ? 'Save' : 'Add'}
        </PrimaryButton>
      </div>
    </form>
  );
}
