'use client';

import { useEffect, useState } from 'react';
import { Plus, Loader2, Trash2, Pencil, Check, X } from 'lucide-react';
import { Field, TextInput, SelectInput, PrimaryButton, SecondaryButton, Banner } from './centerForms';

type PitchTypeId = 'ASTRO' | 'TURF' | 'CEMENT' | 'NATURAL';
type BallTypeId = 'TENNIS' | 'LEATHER' | 'MACHINE';

type MachineRow = {
  id: string;
  name: string;
  shortName: string | null;
  isActive: boolean;
  displayOrder: number;
  legacyMachineId: string | null;
  resourceId: string | null;
  supportedPitchTypes: PitchTypeId[];
  supportedBallTypes: BallTypeId[];
  machineType: { id: string; code: string; name: string; ballType: string };
  resource: { id: string; name: string; type: string } | null;
};

type MachineType = { id: string; code: string; name: string; ballType: string; isActive: boolean };

// Three surfaces only — Astro Turf, Cement, Natural Turf. The legacy
// 'TURF' enum value is kept in the schema but is no longer offered.
const PITCH_TYPE_OPTIONS: Array<{ id: PitchTypeId; label: string }> = [
  { id: 'ASTRO',   label: 'Astro Turf' },
  { id: 'CEMENT',  label: 'Cement' },
  { id: 'NATURAL', label: 'Natural Turf' },
];

const BALL_TYPE_OPTIONS: Array<{ id: BallTypeId; label: string }> = [
  { id: 'LEATHER', label: 'Leather' },
  { id: 'TENNIS',  label: 'Tennis' },
  { id: 'MACHINE', label: 'Machine balls' },
];

export function CenterMachinesTab({ centerId }: { centerId: string }) {
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [types, setTypes] = useState<MachineType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // We no longer fetch resources here — the "default lane" picker has
  // been removed from the simplified editor. Resources are still
  // managed in the Resources tab.
  const refresh = async () => {
    setLoading(true);
    try {
      const [mRes, tRes] = await Promise.all([
        fetch(`/api/admin/centers/${centerId}/machines`),
        fetch(`/api/admin/machine-types`),
      ]);
      if (mRes.ok) setMachines(await mRes.json());
      if (tRes.ok) setTypes(await tRes.json());
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
        No machine types are available yet. Ask a super admin to add one
        in the machine-type catalog before configuring a machine here.
        ABCA&apos;s defaults (Yantra, Gravity, Leverage) are seeded
        automatically on migration; if they&apos;re missing the
        catalog likely needs to be re-seeded.
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
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {m.machineType.name} ({m.machineType.ballType.toLowerCase()})
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {m.supportedPitchTypes.length > 0 && m.supportedPitchTypes.map((p) => (
                        <span
                          key={`p-${p}`}
                          className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20"
                        >
                          {PITCH_TYPE_OPTIONS.find((o) => o.id === p)?.label ?? p}
                        </span>
                      ))}
                      {m.supportedBallTypes.length > 0 && m.supportedBallTypes.map((b) => (
                        <span
                          key={`b-${b}`}
                          className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20"
                        >
                          {BALL_TYPE_OPTIONS.find((o) => o.id === b)?.label ?? b}
                        </span>
                      ))}
                      {m.supportedPitchTypes.length === 0 && m.supportedBallTypes.length === 0 && (
                        <span className="text-[10px] text-slate-600 italic">
                          No pitch / ball types configured — user-side picker hidden.
                        </span>
                      )}
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
  initial,
  onCancel,
  onSaved,
}: {
  centerId: string;
  types: MachineType[];
  initial?: Partial<MachineRow>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial?.id;
  const [machineTypeId, setMachineTypeId] = useState(initial?.machineType?.id || types[0]?.id || '');
  const [name, setName] = useState(initial?.name || '');
  const [shortName, setShortName] = useState(initial?.shortName || '');
  // Display order / default lane / active toggle and resourcing have been
  // removed from this simplified editor. They keep their existing DB
  // values on edit (we don't send them in the PATCH) and default to
  // sensible values on create (server-side defaults: displayOrder 0,
  // isActive true, no resource lane).
  const [supportedPitchTypes, setSupportedPitchTypes] = useState<PitchTypeId[]>(
    initial?.supportedPitchTypes ?? [],
  );
  const [supportedBallTypes, setSupportedBallTypes] = useState<BallTypeId[]>(
    initial?.supportedBallTypes ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const togglePitch = (id: PitchTypeId) =>
    setSupportedPitchTypes((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  const toggleBall = (id: BallTypeId) =>
    setSupportedBallTypes((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

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
          supportedPitchTypes,
          supportedBallTypes,
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
      </div>

      {/* Pitch + ball type compatibility — drives the user-facing chip
          rows on the resource-based slot picker. Leave empty to hide the
          picker entirely (e.g. centers that don't differentiate). */}
      <div className="space-y-3">
        <ChipPicker
          label="Supported pitch types"
          help="Which pitches users can pick when booking this machine. Empty = no pitch picker shown."
          options={PITCH_TYPE_OPTIONS}
          selected={supportedPitchTypes}
          onToggle={(id) => togglePitch(id as PitchTypeId)}
        />
        <ChipPicker
          label="Supported ball types"
          help={`Which ball types users can pick. Empty = falls back to the machine type's default (${types.find((t) => t.id === machineTypeId)?.ballType?.toLowerCase() ?? '—'}).`}
          options={BALL_TYPE_OPTIONS}
          selected={supportedBallTypes}
          onToggle={(id) => toggleBall(id as BallTypeId)}
        />
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

/**
 * Multi-select chip picker. Used by the machine editor for pitch + ball
 * compatibility. Mirrors the look of the legacy `/admin/configuration`
 * pitch-compatibility tiles so admins moving from ABCA to a new center
 * recognise the UX.
 */
function ChipPicker({
  label,
  help,
  options,
  selected,
  onToggle,
}: {
  label: string;
  help?: string;
  options: Array<{ id: string; label: string }>;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">
        {label}
      </div>
      {help && <div className="text-[10px] text-slate-500 mb-2">{help}</div>}
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onToggle(opt.id)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold border cursor-pointer transition-all ${
                active
                  ? 'bg-accent/15 text-accent border-accent/40'
                  : 'bg-white/[0.04] text-slate-400 border-white/[0.08] hover:border-accent/30'
              }`}
            >
              {active && <Check className="w-3 h-3" />}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
