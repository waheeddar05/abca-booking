'use client';

import { useEffect, useState } from 'react';
import { Plus, Loader2, Trash2, Pencil, Check, X } from 'lucide-react';
import { Field, TextInput, NumberInput, SelectInput, PrimaryButton, SecondaryButton, Banner } from './centerForms';

type MachineRow = {
  id: string;
  name: string;
  shortName: string | null;
  isActive: boolean;
  displayOrder: number;
  legacyMachineId: string | null;
  resourceId: string | null;
  machineType: { id: string; code: string; name: string; ballType: string };
  resource: { id: string; name: string; type: string } | null;
};

type MachineType = { id: string; code: string; name: string; ballType: string; isActive: boolean };
type ResourceLite = { id: string; name: string; type: string; category: string; isActive: boolean };

export function CenterMachinesTab({ centerId }: { centerId: string }) {
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [types, setTypes] = useState<MachineType[]>([]);
  const [resources, setResources] = useState<ResourceLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [mRes, tRes, rRes] = await Promise.all([
        fetch(`/api/admin/centers/${centerId}/machines`),
        fetch(`/api/admin/machine-types`),
        fetch(`/api/admin/centers/${centerId}/resources`),
      ]);
      if (mRes.ok) setMachines(await mRes.json());
      if (tRes.ok) setTypes(await tRes.json());
      if (rRes.ok) setResources(await rRes.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, [centerId]);

  const remove = async (id: string) => {
    if (!confirm('Deactivate this machine? It will be hidden from new bookings; existing bookings keep their reference.')) return;
    const res = await fetch(`/api/admin/centers/${centerId}/machines/${id}`, { method: 'DELETE' });
    if (res.ok) refresh();
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-slate-400 py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>;
  }

  if (types.length === 0) {
    return (
      <Banner kind="info">
        No machine types exist yet. Create at least one machine type via the API <code>POST /api/admin/machine-types</code> before adding machines.
        ABCA's three default types (Yantra, Gravity, Leverage) are seeded automatically on migration.
      </Banner>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-400">
          Each machine is an instance at this center. The same machine type can have multiple instances (e.g. two Yantras).
        </p>
        <PrimaryButton onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4" /> Add machine
        </PrimaryButton>
      </div>

      {showNew && (
        <MachineEditor
          centerId={centerId}
          types={types}
          resources={resources}
          onCancel={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); refresh(); }}
        />
      )}

      {machines.length === 0 ? (
        <div className="text-center text-slate-500 py-6 text-sm">No machines configured yet.</div>
      ) : (
        <div className="space-y-2">
          {machines.map((m) => (
            <div key={m.id} className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-3">
              {editingId === m.id ? (
                <MachineEditor
                  centerId={centerId}
                  types={types}
                  resources={resources}
                  initial={m}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => { setEditingId(null); refresh(); }}
                />
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-white">{m.name}</span>
                      {!m.isActive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 uppercase tracking-wide">inactive</span>}
                      {m.legacyMachineId && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-400 uppercase tracking-wide">
                          legacy: {m.legacyMachineId}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {m.machineType.name} ({m.machineType.ballType.toLowerCase()})
                      {m.resource && <> · default lane: {m.resource.name}</>}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => setEditingId(m.id)}
                      className="p-2 rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white cursor-pointer"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => remove(m.id)}
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

function MachineEditor({
  centerId,
  types,
  resources,
  initial,
  onCancel,
  onSaved,
}: {
  centerId: string;
  types: MachineType[];
  resources: ResourceLite[];
  initial?: Partial<MachineRow>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial?.id;
  const [machineTypeId, setMachineTypeId] = useState(initial?.machineType?.id || types[0]?.id || '');
  const [name, setName] = useState(initial?.name || '');
  const [shortName, setShortName] = useState(initial?.shortName || '');
  const [resourceId, setResourceId] = useState(initial?.resourceId || '');
  const [displayOrder, setDisplayOrder] = useState(initial?.displayOrder ?? 0);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      const url = isEdit
        ? `/api/admin/centers/${centerId}/machines/${initial!.id}`
        : `/api/admin/centers/${centerId}/machines`;
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEdit ? {} : { machineTypeId }),
          name,
          shortName: shortName || null,
          resourceId: resourceId || null,
          displayOrder,
          isActive,
        }),
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
        {!isEdit && (
          <Field label="Machine type" required>
            <SelectInput value={machineTypeId} onChange={(e) => setMachineTypeId(e.target.value)} required>
              {types.filter((t) => t.isActive).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.ballType.toLowerCase()})
                </option>
              ))}
            </SelectInput>
          </Field>
        )}
        <Field label="Display name" required>
          <TextInput required value={name} onChange={(e) => setName(e.target.value)} placeholder="Yantra 1" />
        </Field>
        <Field label="Short name">
          <TextInput value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="Yantra" />
        </Field>
        <Field label="Default lane / resource" help="Optional: which net or wicket this machine usually sits on. Machines are still movable per booking.">
          <SelectInput value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
            <option value="">— Roaming —</option>
            {resources.filter((r) => r.isActive).map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({r.type.toLowerCase()})</option>
            ))}
          </SelectInput>
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
