'use client';

import { useEffect, useState } from 'react';
import { Plus, Loader2, Trash2, Pencil, Check, X, Eye, EyeOff } from 'lucide-react';
import { Field, TextInput, NumberInput, SelectInput, PrimaryButton, SecondaryButton, Banner } from './centerForms';

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
  NET: 'Net',
  // "Natural Turf" is the user-facing label even though the DB enum
  // value is TURF_WICKET — keeps the admin UI in sync with what the
  // pitch picker says on the booking screen ("Astro Turf / Cement /
  // Natural Turf"). The legacy "Turf wicket" label confused admins
  // into thinking turf wickets and natural turf were distinct.
  TURF_WICKET: 'Natural Turf',
  CEMENT_WICKET: 'Cement wicket',
  COURT: 'Full court',
};

export function CenterResourcesTab({ centerId }: { centerId: string }) {
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

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
  const deactivate = async (id: string) => {
    if (!confirm('Deactivate this resource? Existing bookings retain their reference; new bookings cannot use it.')) return;
    setActionError(null);
    const res = await fetch(`/api/admin/centers/${centerId}/resources/${id}`, { method: 'DELETE' });
    if (res.ok) refresh();
    else {
      const data = await res.json().catch(() => ({}));
      setActionError(data?.error || `Deactivate failed (HTTP ${res.status})`);
    }
  };

  // Hard delete — only allowed when nothing references the resource.
  // The server rejects with 409 + a count of linked bookings / machines
  // when refs exist; we render that message so the admin knows why.
  const hardDelete = async (r: ResourceRow) => {
    if (!confirm(`Permanently delete "${r.name}"? This cannot be undone. Bookings or machines that reference this resource will block the delete.`)) return;
    setActionError(null);
    const res = await fetch(`/api/admin/centers/${centerId}/resources/${r.id}?hard=true`, { method: 'DELETE' });
    if (res.ok) {
      refresh();
      return;
    }
    const data = await res.json().catch(() => ({}));
    setActionError(data?.error || `Delete failed (HTTP ${res.status})`);
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
        <p className="text-xs text-slate-400 min-w-0 flex-1">
          Bookable units (nets, courts, natural turf). Used by the resource-based engine for availability.
          Centers using the legacy machine/pitch model can leave this empty.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {inactiveCount > 0 && (
            <SecondaryButton onClick={() => setShowInactive((v) => !v)}>
              {showInactive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              {showInactive ? 'Hide inactive' : `Show inactive (${inactiveCount})`}
            </SecondaryButton>
          )}
          <PrimaryButton onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4" /> Add resource
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
            ? 'No resources configured.'
            : 'No active resources. Toggle "Show inactive" to see deactivated rows.'}
        </div>
      ) : (
        <div className="space-y-2">
          {visibleResources.map((r) => (
            <div key={r.id} className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3">
              {editingId === r.id ? (
                <ResourceEditor
                  centerId={centerId}
                  initial={r}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => { setEditingId(null); refresh(); }}
                />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{r.name}</span>
                      {!r.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 uppercase tracking-wide">inactive</span>}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {TYPE_LABELS[r.type]} · capacity {r.capacity}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => setEditingId(r.id)}
                      className="p-2 rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white cursor-pointer"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {/* Active rows get the soft-deactivate button.
                        Inactive rows get a permanent-delete button —
                        the server still refuses if any bookings or
                        machines reference the row, so this is safe to
                        expose. */}
                    {r.isActive ? (
                      <button
                        onClick={() => deactivate(r.id)}
                        className="p-2 rounded-lg text-amber-400/70 hover:bg-amber-500/10 hover:text-amber-400 cursor-pointer"
                        title="Deactivate (preserves history)"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => hardDelete(r)}
                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium text-red-300/80 hover:text-red-300 bg-red-500/5 hover:bg-red-500/10 border border-red-500/15 cursor-pointer"
                        title="Permanently delete — refused if any bookings or machines still reference it"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
  // Preserved from `initial` so an edit doesn't silently clobber these
  // back to defaults — but no longer exposed as form fields. New rows
  // default to INDOOR / order 0 / active.
  const category: ResourceRow['category'] = initial?.category ?? 'INDOOR';
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
        body: JSON.stringify({ name, type, category, capacity, displayOrder, isActive }),
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
      <div className="grid sm:grid-cols-3 gap-3">
        <Field label="Name" required>
          <TextInput required value={name} onChange={(e) => setName(e.target.value)} placeholder="Indoor Net 1" />
        </Field>
        <Field label="Type" required>
          <SelectInput value={type} onChange={(e) => setType(e.target.value as ResourceRow['type'])}>
            <option value="NET">Net</option>
            <option value="TURF_WICKET">Natural Turf</option>
            <option value="CEMENT_WICKET">Cement wicket</option>
            <option value="COURT">Full court (composed of nets)</option>
          </SelectInput>
        </Field>
        <Field label="Capacity" help="Concurrent bookings supported. Default 1.">
          <NumberInput min={1} value={capacity} onChange={(e) => setCapacity(Math.max(1, Number(e.target.value)))} />
        </Field>
      </div>
      {/* Category / displayOrder / active are kept in state so edits
          don't accidentally clear them on save, but they're no longer
          surfaced as form fields — they were near-never used by admins.
          New resources default to INDOOR + active + order 0. */}

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
