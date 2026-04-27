'use client';

import { useEffect, useState } from 'react';
import { Plus, Loader2, Trash2, Pencil, Check, X } from 'lucide-react';
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
  TURF_WICKET: 'Turf wicket',
  CEMENT_WICKET: 'Cement wicket',
  COURT: 'Full court',
};

export function CenterResourcesTab({ centerId }: { centerId: string }) {
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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

  const remove = async (id: string) => {
    if (!confirm('Deactivate this resource? Existing bookings retain their reference; new bookings cannot use it.')) return;
    const res = await fetch(`/api/admin/centers/${centerId}/resources/${id}`, { method: 'DELETE' });
    if (res.ok) refresh();
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-slate-400 py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center gap-3">
        <p className="text-xs text-slate-400">
          Bookable units (nets, courts, turf wickets). Used by the resource-based engine for availability.
          Centers using the legacy machine/pitch model can leave this empty.
        </p>
        <PrimaryButton onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4" /> Add resource
        </PrimaryButton>
      </div>

      {showNew && (
        <ResourceEditor
          centerId={centerId}
          onCancel={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); refresh(); }}
        />
      )}

      {resources.length === 0 ? (
        <div className="text-center text-slate-500 py-6 text-sm">No resources configured.</div>
      ) : (
        <div className="space-y-2">
          {resources.map((r) => (
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
                      {TYPE_LABELS[r.type]} · {r.category.toLowerCase()}
                      {r.capacity > 1 && <> · capacity {r.capacity}</>}
                      {r._count?.machines ? <> · {r._count.machines} machine{r._count.machines === 1 ? '' : 's'}</> : null}
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
                    <button
                      onClick={() => remove(r.id)}
                      className="p-2 rounded-lg text-red-400/70 hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
                      title="Deactivate"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
  const [category, setCategory] = useState<ResourceRow['category']>(initial?.category || 'INDOOR');
  const [capacity, setCapacity] = useState<number>(initial?.capacity ?? 1);
  const [displayOrder, setDisplayOrder] = useState<number>(initial?.displayOrder ?? 0);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
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
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Name" required>
          <TextInput required value={name} onChange={(e) => setName(e.target.value)} placeholder="Indoor Net 1" />
        </Field>
        <Field label="Type" required>
          <SelectInput value={type} onChange={(e) => setType(e.target.value as ResourceRow['type'])}>
            <option value="NET">Net</option>
            <option value="TURF_WICKET">Turf wicket</option>
            <option value="CEMENT_WICKET">Cement wicket</option>
            <option value="COURT">Full court (composed of nets)</option>
          </SelectInput>
        </Field>
        <Field label="Category" required>
          <SelectInput value={category} onChange={(e) => setCategory(e.target.value as ResourceRow['category'])}>
            <option value="INDOOR">Indoor</option>
            <option value="OUTDOOR">Outdoor</option>
          </SelectInput>
        </Field>
        <Field label="Capacity" help="Concurrent bookings supported. Default 1.">
          <NumberInput min={1} value={capacity} onChange={(e) => setCapacity(Math.max(1, Number(e.target.value)))} />
        </Field>
        <Field label="Display order">
          <NumberInput value={displayOrder} onChange={(e) => setDisplayOrder(Number(e.target.value))} />
        </Field>
        <Field label="Active">
          <SelectInput value={isActive ? 'true' : 'false'} onChange={(e) => setIsActive(e.target.value === 'true')}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </SelectInput>
        </Field>
      </div>

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
